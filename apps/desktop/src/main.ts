import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { join, basename, dirname } from 'node:path';
import { access, mkdir, cp } from 'node:fs/promises';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import * as os from 'node:os';
import { createStore, type TadashiStore } from '../../../packages/persistence/src';
import { EventBus } from '../../../packages/monitoring/src';
import { FileMonitor, GitMonitor, NotificationService } from '../../../packages/monitoring/src';
import { ApiAgentAdapter, CliAgentAdapter, CommandCodeAdapter, type AgentAdapter } from '../../../packages/agents/src';
import { AnthropicClient, BrainService, OpenAiCompatibleClient, checkLlamaHealth, type ModelClient } from '../../../packages/brain/src';
import { ApprovalService, EncryptedCredentialStore, GitService, GitHubProvider, GitLabProvider, Orchestrator, ProjectService, defaultAutonomyPolicy, projectFromPath, selectGitHostProvider } from '../../../packages/orchestrator/src';
import { buildManifest, detectSetupStatus, detectTargetDrive, installComponent, listDrives, totalRequiredBytes, DEFAULT_CHOICES, type SetupChoices, type SetupEvent, type SystemProbe } from '../../../packages/setup/src';
import { NativeTextToSpeech, TtsQueue, VoiceLoop, defaultVoiceLoopConfig, type TextToSpeech } from '../../../packages/voice/src';
import { IdSchema, ResolveApprovalInputSchema, SubmitMessageInputSchema, TranscribeAudioInputSchema, type Project, type ProjectEvent } from '../../../packages/contracts/src';
import { safeStorage, Tray, Menu, Notification as ElectronNotification } from 'electron';
import { WhisperSpeechToText, type SpeechToText } from '../../../packages/voice/src';

let mainWindow: BrowserWindow | undefined;
let store: TadashiStore;
let eventBus: EventBus;
let orchestrator: Orchestrator;
let approvalService: ApprovalService;
let activeProject: Project | undefined;
let fileMonitor: FileMonitor | undefined;
let gitMonitor: GitMonitor | undefined;
let configuredAgentCount = 0;
let brainReady = false;
let brainFallBackReason = '';
let brainModel = '';
let brainProvider: 'openai-compatible' | 'anthropic' | 'fallback' = 'fallback';
let speechToText: SpeechToText | undefined;
let speaker: TextToSpeech | undefined;
let ttsQueue: TtsQueue | undefined;
let voiceLoop: VoiceLoop | undefined;
let tray: Tray | undefined;
let notifications: NotificationService | undefined;
let credentials: EncryptedCredentialStore | undefined;
let projectService: ProjectService | undefined;
let gitService: GitService | undefined;
let commandCodePath = process.env.TADASHI_COMMAND_CODE_EXECUTABLE ?? 'cmdc';
let delegateModelTier: 'free-only' | 'auto' = 'free-only';
let setupRunning = false;
let setupAbort: AbortController | undefined;
let brainSpawned = false;
let brainProcess: ReturnType<typeof spawn> | undefined;
let aiBackendProcess: ReturnType<typeof spawn> | undefined;
let aiBackendSpawned = false;

function isModelAt(root: string): boolean {
  return existsSync(join(root, 'models', 'Qwen3-8B-Q4_K_M.gguf'));
}

/** Finds the whisper model the installer downloaded, preferring the most accurate available. */
function findWhisperModel(): string | undefined {
  const candidates = [
    'D:\\TadashiAI\\whisper\\ggml-small.en.bin',
    'D:\\TadashiAI\\whisper\\ggml-base.en.bin',
    'D:\\TadashiAI\\whisper\\models\\ggml-small.en.bin',
    'D:\\TadashiAI\\whisper\\models\\ggml-base.en.bin',
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

/** Spawns the local llama.cpp brain server hidden and probes until it is healthy. */
function startEmbeddedBrain(): void {
  const serverPath = 'D:\\TadashiAI\\llama\\runtime\\llama-server.exe';
  const modelPath = 'D:\\TadashiAI\\models\\Qwen3-8B-Q4_K_M.gguf';
  const logPath = 'D:\\TadashiAI\\logs\\brain-server.log';

  // A brain may already be running (previous instance, manual start, another app copy).
  // Probe first; only spawn when nothing is serving on 8080 yet, and never spawn twice.
  void probeBrainHealth(2000).then((reachable) => {
    if (reachable) {
      brainReady = true;
      refreshStatus();
      return;
    }
    if (brainSpawned) return;
    brainSpawned = true;
    const child = spawn(serverPath, ['--model', modelPath, '--host', '127.0.0.1', '--port', '8080', '--ctx-size', '8192', '--n-gpu-layers', '999', '--flash-attn', 'on', '--threads', '8', '--parallel', '1', '--log-file', logPath], { shell: false, windowsHide: true, stdio: 'ignore' });
    brainProcess = child;
    child.on('error', (error) => {
      brainSpawned = false;
      brainReady = false;
      brainFallBackReason = `Brain server could not start: ${error.message}`;
      refreshStatus();
    });
    child.on('exit', () => {
      brainSpawned = false;
      if (brainReady) {
        brainReady = false;
        brainFallBackReason = 'The brain server stopped unexpectedly.';
        refreshStatus();
      }
    });
  });

  const probeInterval = setInterval(() => {
    void probeBrainHealth(2000).then((ok) => {
      if (ok) {
        clearInterval(probeInterval);
        brainReady = true;
        brainFallBackReason = '';
        refreshStatus();
      } else if (process.env.TADASHI_BRAIN_AUTO_RESTART === 'false') {
        clearInterval(probeInterval);
      }
    });
  }, 3000);
  setTimeout(() => clearInterval(probeInterval), 120_000);
}

async function probeBrainHealth(timeoutMs: number): Promise<boolean> {
  try {
    const response = await fetch('http://127.0.0.1:8080/health', { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok;
  } catch {
    return false;
  }
}

/** Scans the model folder (and any folder the user browsed) for GGUF models. */
function listLlamaModels(root = 'D:\\TadashiAI\\models'): string[] {
  const found: string[] = [];
  if (!existsSync(root)) return found;
  let entries: string[] = [];
  try { entries = readdirSync(root); } catch { return found; }
  for (const entry of entries) {
    const full = join(root, entry);
    try {
      if (statSync(full).isDirectory()) found.push(...listLlamaModels(full));
      else if (/\.gguf$/i.test(entry)) found.push(entry);
    } catch {}
  }
  return found;
}

/** Restarts the embedded brain with a chosen model. Returns whether it came back healthy. */
async function selectBrainModel(modelPath: string): Promise<boolean> {
  if (!existsSync(modelPath)) throw new Error(`Model not found: ${modelPath}`);
  brainProcess?.kill();
  brainProcess = undefined;
  brainSpawned = false;
  process.env.TADASHI_LLAMA_MODEL_PATH = modelPath;
  brainModel = modelPath.split('\\').pop()?.replace(/\.gguf$/i, '') ?? modelPath;
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await startEmbeddedBrainWith(modelPath).catch(() => undefined);
  const ok = await probeBrainHealth(60_000).catch(() => false);
  brainReady = ok;
  refreshStatus();
  return ok;
}

/** Like startEmbeddedBrain but with an explicit model path (used when the user switches models). */
function startEmbeddedBrainWith(modelPath: string): Promise<void> {
  const serverPath = 'D:\\TadashiAI\\llama\\runtime\\llama-server.exe';
  return new Promise((resolve) => {
    if (brainSpawned) return resolve();
    brainSpawned = true;
    brainProcess = spawn(serverPath, ['--model', modelPath, '--host', '127.0.0.1', '--port', '8080', '--ctx-size', '8192', '--n-gpu-layers', '999', '--flash-attn', 'on', '--threads', '8', '--parallel', '1', '--log-file', 'D:\\TadashiAI\\logs\\brain-server.log'], { shell: false, windowsHide: true, stdio: 'ignore' });
    brainProcess.on('error', () => resolve());
    brainProcess.on('exit', () => { brainSpawned = false; });
    resolve();
  });
}

function startAiBackend(): Promise<void> {
  return new Promise((resolve) => {
    if (aiBackendSpawned) return resolve();
    aiBackendSpawned = true;
    const exePath = app.isPackaged 
      ? join(process.resourcesPath, 'ai_backend', 'ai_backend.exe')
      : join(__dirname, '..', '..', '..', 'resources', 'ai_backend', 'dist', 'ai_backend.exe');
    
    aiBackendProcess = spawn(exePath, [], { shell: false, windowsHide: true, stdio: 'ignore' });
    aiBackendProcess.on('error', () => resolve());
    aiBackendProcess.on('exit', () => { aiBackendSpawned = false; });
    resolve();
  });
}

/** Resolves the command-code CLI: prefers the JS entry (node + index.mjs) to avoid Windows .cmd quoting issues. */
async function resolveCommandCodeCli(preferred = commandCodePath): Promise<string> {
  if (preferred !== 'cmdc') {
    // Explicit executable: could be a real .exe or a JS entry; probe it.
    try { await access(preferred); return preferred; } catch { return preferred; }
  }
  // Packaged apps often don't inherit a shell PATH with the npm global bin; probe known locations.
  const candidates = [
    process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'cmdc.cmd') : undefined,
    join(process.env.USERPROFILE ?? 'C:\\Users\\tushe', 'AppData', 'Roaming', 'npm', 'cmdc.cmd'),
    'D:\\TadashiAI\\cli\\cmdc.cmd',
    'D:\\TadashiAI\\node\\cmdc.cmd',
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      // cmdc.cmd shim wraps: node "%dp0%\node_modules\command-code\dist\index.mjs" %*
      const shimDir = dirname(candidate);
      const entry = join(shimDir, 'node_modules', 'command-code', 'dist', 'index.mjs');
      if (existsSync(entry)) return entry;
      return candidate;
    } catch {}
  }
  const lookup = process.platform === 'win32' ? spawnSync('where', ['cmdc'], { shell: false, windowsHide: true, timeout: 10_000 }) : spawnSync('which', ['cmdc'], { shell: false, timeout: 10_000 });
  if (lookup.status !== 0) return preferred;
  const first = String(lookup.stdout).split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (first && first.endsWith('.cmd')) {
    const entry = join(dirname(first), 'node_modules', 'command-code', 'dist', 'index.mjs');
    if (existsSync(entry)) return entry;
  }
  return first || preferred;
}

/** Returns { node, cli } for a usable npm on this machine (system Node, portable install, or PATH). */
function resolveNpm(): { node: string; cli: string } {
  const nodeCandidates = [
    'C:\\Program Files\\nodejs\\node.exe',
    join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'nodejs', 'node.exe'),
    'D:\\TadashiAI\\node\\node.exe',
  ];
  for (const candidate of nodeCandidates) {
    try {
      if (existsSync(candidate)) {
        const cli = join(dirname(candidate), 'node_modules', 'npm', 'bin', 'npm-cli.js');
        if (existsSync(cli)) return { node: candidate, cli };
        return { node: candidate, cli: join(dirname(candidate), 'node_modules', 'npm', 'bin', 'npm-cli.js') };
      }
    } catch {}
  }
  return { node: 'node', cli: 'npm-cli.js' };
}

/** Runs a command safely. npm and cmdc are invoked through node + JS entry (no .cmd, no quoting issues);
 * other executables are spawned directly with a quoted-safe path and no shell. */
function runCommand(command: string, args: string[], options: { timeout?: number; encoding?: 'utf8' } = {}): ReturnType<typeof spawnSync> {
  // If the command is a JS entry or node + entry, run through node.exe directly.
  if (/\.(mjs|js)$/i.test(command)) {
    const node = resolveNpm().node;
    return spawnSync(node, [command, ...args], { shell: false, windowsHide: true, timeout: options.timeout ?? 60_000, encoding: options.encoding });
  }
  if (/\.(cmd|ps1)$/i.test(command)) {
    // Fall back to the entry-point resolution if a .cmd slips through un-resolved.
    return spawnSync('cmd.exe', ['/d', '/c', command, ...args], { shell: false, windowsHide: true, timeout: options.timeout ?? 60_000, encoding: options.encoding });
  }
  return spawnSync(command, args, { shell: false, windowsHide: true, timeout: options.timeout ?? 60_000, encoding: options.encoding });
}

/** True when the CLI reports an authenticated session. */
async function isCommandCodeAuthenticated(resolved?: string): Promise<boolean> {
  try { const auth = runCommand(resolved ?? await resolveCommandCodeCli(), ['status'], { timeout: 10_000 }); return auth.status === 0 && !/not.*authenticated|not.*logged/i.test(String(auth.stderr) + String(auth.stdout)); } catch { return false; }
}

/** True when the CLI binary exists at the resolved path. */
async function isCommandCodeInstalled(resolved?: string): Promise<boolean> {
  const path = resolved ?? await resolveCommandCodeCli();
  try { await access(path); return true; } catch { return false; }
}

/** Installs the Command Code CLI globally via npm, surfacing errors clearly. */
async function installCommandCodeCli(): Promise<string> {
  const destination = commandCodePath;
  if (destination !== 'cmdc' && !destination.startsWith('D:\\')) throw new Error('Command Code CLI must live on the D: drive or be the global cmdc.');
  const npm = resolveNpm();
  const install = runCommand(npm.node, [npm.cli, 'i', '-g', 'command-code'], { timeout: 300_000 });
  const stderr = String(install.stderr ?? '').slice(0, 300);
  if (install.status !== 0) throw new Error(`Worker install failed (exit ${install.status}): ${stderr || 'npm was not reachable — install Node.js or connect a worker manually.'}`);
  return destination;
}

/** Opens the Command Code login flow in a visible terminal once, so the user can sign in. */
async function openCommandCodeLogin(): Promise<string> {
  const resolved = await resolveCommandCodeCli();
  // `cmdc login` needs a TTY; open it in a dedicated console window the user interacts with.
  const shell = process.platform === 'win32' ? 'cmd.exe' : 'bash';
  const child = spawn(shell, process.platform === 'win32' ? ['/c', 'start', '""', resolved, 'login'] : ['-c', `${resolved} login`], { shell: false, windowsHide: false });
  child.unref();
  return resolved;
}

function startProjectMonitoring(project: Project): void {
  fileMonitor?.stop();
  gitMonitor?.stop();
  fileMonitor = new FileMonitor(eventBus, publish);
  gitMonitor = new GitMonitor(eventBus, publish);
  fileMonitor.start(project.id, project.path);
  gitMonitor.start(project.id, project.path);
}

function makeWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: '#101110',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.mjs'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else mainWindow.loadFile(join(__dirname, '../../dist/index.html'));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Allow microphone capture for hold-to-talk; deny every other permission.
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });
  mainWindow.webContents.session.setPermissionCheckHandler((_webContents, permission) => permission === 'media');
  mainWindow.webContents.session.setDevicePermissionHandler(() => true);
  mainWindow.on('close', (event) => {
    if (process.env.TADASHI_KEEP_BACKGROUND === 'true' && tray && !tray.isDestroyed()) { event.preventDefault(); mainWindow?.hide(); }
  });
  installTray();
}

function installTray(): void {
  if (!notifications) return;
  const trayInstance = new Tray(join(app.getAppPath(), 'resources', 'icon.png').replace(/[\\/]electron\.png$/, ''));
  tray = trayInstance;
  tray.setToolTip('T.A.D.A.S.H.I. project control');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show control room', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: 'Mute voice', click: () => { voiceLoop?.mute(); notifications?.push({ kind: 'info', title: 'Voice muted', body: 'Tadashi will not speak until you unmute.' }); refreshStatus(); } },
    { label: 'Quit', click: () => { app.exit(); } },
  ]));
  notifications.on('notification', (notification) => {
    try { new ElectronNotification({ title: notification.title, body: notification.body }).show(); } catch {}
    trayInstance.displayBalloon?.({ title: notification.title, content: notification.body });
  });
}

function refreshStatus(): void { mainWindow?.webContents.send('event:project', { id: crypto.randomUUID(), projectId: activeProject?.id ?? '', type: 'progress.reported', timestamp: new Date().toISOString(), payload: { source: 'system' } }); }

function publish(event: ProjectEvent): void {
  store.events.add(event);
  eventBus.publish(event);
}

function currentState() {
  const project = activeProject ?? store.projects.list()[0];
  return {
    projects: store.projects.list(), project,
    messages: project ? store.messages.list(project.id) : [],
    tasks: project ? store.tasks.list(project.id) : [],
    runs: project ? store.runs.list(project.id) : [],
    approvals: project ? store.approvals.list(project.id) : [],
    events: project ? store.events.list(project.id) : [],
    agentReady: configuredAgentCount > 0,
    brainReady,
    brainModel,
    brainProvider,
    brainFallBackReason,
    voiceOutput: Boolean(speaker),
    voiceState: voiceLoop?.current() ?? 'idle',
    autonomyPolicy: defaultAutonomyPolicy,
    gitConfigured: Boolean(gitService?.credentialStatus().configured),
    gitProvider: process.env.TADASHI_GIT_PROVIDER ?? 'github',
    delegateModelTier,
    commandCodePath,
  };
}

/** Fires a live brain health check and pushes an updated state to the renderer. */
function refreshBrainStatus(): void {
  void probeBrainHealth(1500).then((ok) => {
    brainReady = ok ? true : process.env.TADASHI_BRAIN_AUTO_RESTART === 'false' ? false : brainReady;
    if (ok && activeProject) {
      publish({ id: crypto.randomUUID(), projectId: activeProject.id, type: 'progress.reported', timestamp: new Date().toISOString(), payload: { status: 'ready', model: brainModel } });
    }
    refreshStatus();
  });
}

async function selectProject(): Promise<Project | undefined> {
  if (!mainWindow) return undefined;
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || !result.filePaths[0]) return undefined;
  const path = result.filePaths[0];
  await access(path);
  const existing = store.projects.list().find((project) => project.path === path);
  activeProject = existing ?? projectFromPath(path);
  store.projects.upsert({ ...activeProject, name: basename(path), updatedAt: new Date().toISOString() });
  startProjectMonitoring(activeProject);
  return activeProject;
}

function registerIpc(): void {
  ipcMain.handle('state:list', async () => {
    // Live-check brain health so the UI never shows a stale "loading" state.
    if (process.env.TADASHI_BRAIN_BASE_URL?.includes('8080')) {
      const ok = await probeBrainHealth(800).catch(() => false);
      const previous = brainReady;
      brainReady = ok ? true : previous;
      if (ok && !previous) refreshStatus();
    }
    return currentState();
  });
  ipcMain.handle('project:select', () => selectProject());
  ipcMain.handle('project:activate', (_event, rawProjectId) => {
    const projectId = IdSchema.parse(rawProjectId);
    const project = store.projects.list().find((item) => item.id === projectId);
    if (!project) throw new Error('Project not found.');
    activeProject = project;
    startProjectMonitoring(project);
    return project;
  });
  ipcMain.handle('message:submit', async (_event, rawInput) => {
    const input = SubmitMessageInputSchema.parse(rawInput);
    const project = store.projects.list().find((item) => item.id === input.projectId);
    if (!project) throw new Error('Select a project before sending an instruction.');
    const result = await orchestrator.submit(project, input.content);
    for (const task of result.tasks ?? (result.task ? [result.task] : [])) {
      const approval = approvalService.createForTask(project, task);
      publish({ id: crypto.randomUUID(), projectId: project.id, type: 'approval.requested', timestamp: new Date().toISOString(), payload: { approvalId: approval.id, taskId: task.id } });
    }
    return result;
  });
  ipcMain.handle('approval:resolve', async (_event, rawInput) => {
    const input = ResolveApprovalInputSchema.parse(rawInput);
    const project = activeProject;
    if (!project) throw new Error('Select a project before resolving an approval.');
    const approval = store.approvals.list(project.id).find((item) => item.id === input.approvalId);
    if (!approval) throw new Error('Approval request not found.');
    if (approval.status !== 'pending') throw new Error('Approval request has already been resolved.');
    const resolved = approvalService.resolve(approval, input.decision, input.scope);
    publish({ id: crypto.randomUUID(), projectId: project.id, type: 'approval.resolved', timestamp: new Date().toISOString(), payload: { approvalId: resolved.id, decision: resolved.status } });
    const task = store.tasks.list(project.id).find((item) => item.id === resolved.taskId);
    if (task && input.decision === 'approved') {
      void orchestrator.execute(project, task).catch((error: unknown) => {
        publish({ id: crypto.randomUUID(), projectId: project.id, type: 'blocker.detected', timestamp: new Date().toISOString(), payload: { message: error instanceof Error ? error.message : 'Agent execution failed.' } });
      });
    }
    if (task && input.decision === 'denied') {
      store.tasks.upsert({ ...task, status: 'blocked', updatedAt: new Date().toISOString() });
      publish({ id: crypto.randomUUID(), projectId: project.id, type: 'task.updated', timestamp: new Date().toISOString(), payload: { taskId: task.id, status: 'blocked' } });
    }
    return resolved;
  });
  ipcMain.handle('voice:transcribe', async (_event, rawInput) => {
    const input = TranscribeAudioInputSchema.parse(rawInput);
    if (!speechToText) throw new Error('Local speech transcription is not configured yet. Run setup to install Whisper.');
    return speechToText.transcribe(input.audio, input.mimeType);
  });
  ipcMain.handle('voice:state', () => voiceLoop?.current() ?? 'idle');
  ipcMain.handle('voice:toggle', () => {
    if (!voiceLoop) throw new Error('Voice loop is not configured.');
    if (voiceLoop.current() === 'muted' || voiceLoop.current() === 'idle') voiceLoop.enable();
    else voiceLoop.mute();
    return voiceLoop.current();
  });
  ipcMain.handle('project:create', async (_event, rawInput) => {
    if (!projectService) throw new Error('Project service is not initialized.');
    const { parentPath, name } = rawInput as { parentPath: string; name: string };
    const project = await projectService.createLocal(parentPath, name);
    store.projects.upsert(project);
    return project;
  });
  ipcMain.handle('project:delete', async (_event, rawProjectId) => {
    if (!projectService) throw new Error('Project service is not initialized.');
    const projectId = IdSchema.parse(rawProjectId);
    const project = store.projects.list().find((item) => item.id === projectId);
    if (!project) throw new Error('Project not found.');
    await projectService.deleteLocal(project);
    return { deleted: projectId };
  });
  ipcMain.handle('git:status', async (_event, rawProjectId) => {
    if (!gitService) throw new Error('Git service is not initialized.');
    const projectId = IdSchema.parse(rawProjectId);
    const project = store.projects.list().find((item) => item.id === projectId);
    if (!project) throw new Error('Project not found.');
    return gitService.run(project, 'status');
  });
  ipcMain.handle('git:push', async (_event, rawInput) => {
    if (!gitService) throw new Error('Git service is not initialized.');
    const { projectId, branch } = rawInput as { projectId: string; branch?: string };
    const project = store.projects.list().find((item) => item.id === projectId);
    if (!project) throw new Error('Project not found.');
    return gitService.push(project, 'origin', branch);
  });
  ipcMain.handle('git:remote', async (_event, rawInput) => {
    if (!gitService) throw new Error('Git service is not initialized.');
    const { projectId, url } = rawInput as { projectId: string; url: string };
    const project = store.projects.list().find((item) => item.id === projectId);
    if (!project) throw new Error('Project not found.');
    return gitService.setRemote(project, url);
  });
  ipcMain.handle('host:status', async () => {
    if (!credentials) return { configured: false, provider: 'github', ok: false };
    const provider = selectGitHostProvider(process.env.TADASHI_GIT_PROVIDER ?? 'github', credentials);
    const status = await provider.validateCredentials().catch(() => ({ ok: false as const }));
    return { configured: true, provider: provider.name, ok: status.ok, user: 'user' in status ? status.user : undefined };
  });
  ipcMain.handle('delegate:status', async () => {
    const ok = await probeBrainHealth(1200).catch(() => false);
    if (ok) brainReady = true;
    else if (process.env.TADASHI_BRAIN_AUTO_RESTART === 'false') brainReady = false;
    const resolved = await resolveCommandCodeCli();
    const installed = await isCommandCodeInstalled(resolved);
    const authenticated = installed ? await isCommandCodeAuthenticated(resolved) : false;
    return { installed, authenticated, path: resolved, brainReady, delegateModelTier };
  });
  ipcMain.handle('delegate:install', async () => {
    const path = await installCommandCodeCli();
    return { installed: true, path };
  });
  ipcMain.handle('delegate:login', async () => {
    const path = await openCommandCodeLogin();
    return { opened: true, path };
  });
  ipcMain.handle('delegate:connect', async (_event, rawPath: string | undefined) => {
    // Manual connection: the user provides the CLI path (or cmdc as a command name).
    const path = (rawPath ?? '').trim();
    if (!path) return { ok: false, reason: 'No path provided.' };
    const resolved = await resolveCommandCodeCli(path);
    const installed = await isCommandCodeInstalled(resolved);
    const authenticated = installed ? await isCommandCodeAuthenticated(resolved) : false;
    if (installed) commandCodePath = resolved;
    return { ok: installed, installed, authenticated, path: resolved, reason: installed ? undefined : `Not found: ${resolved}` };
  });
  ipcMain.handle('delegate:tier', async (_event, rawTier) => {
    const tier = rawTier === 'auto' ? 'auto' : 'free-only';
    delegateModelTier = tier;
    refreshStatus();
    return { delegateModelTier: tier };
  });
  ipcMain.handle('brain:models', async () => {
    const models = listLlamaModels();
    return { models, current: brainModel, path: process.env.TADASHI_LLAMA_MODEL_PATH ?? 'D:\\TadashiAI\\models' };
  });
  ipcMain.handle('brain:selectModel', async (_event, rawPath: string) => {
    let modelPath = rawPath;
    if (!modelPath || !existsSync(modelPath)) {
      const picked = mainWindow ? dialog.showOpenDialogSync(mainWindow, { title: 'Choose a GGUF model', properties: ['openFile'], filters: [{ name: 'GGUF models', extensions: ['gguf'] }] }) : dialog.showOpenDialogSync({ title: 'Choose a GGUF model', properties: ['openFile'], filters: [{ name: 'GGUF models', extensions: ['gguf'] }] });
      if (!picked?.[0]) return { ok: false, loaded: false, cancelled: true };
      modelPath = picked[0];
    }
    const loaded = await selectBrainModel(modelPath);
    return { ok: true, loaded, model: brainModel, path: modelPath };
  });
  ipcMain.handle('setup:status', async () => {
    const drive = detectTargetDrive(totalRequiredBytes());
    return { ...detectSetupStatus(), drive: drive?.mount ?? 'C:\\', freeBytes: drive?.freeBytes ?? 0, requiredBytes: totalRequiredBytes() };
  });
  ipcMain.handle('setup:probe', async () => {
    // NVIDIA GPU detection via nvidia-smi; fall back to a conservative CPU-only profile.
    let gpu: SystemProbe['gpu'] = { vendor: 'unknown', name: 'No GPU detected', vramGb: null };
    try {
      const probe = spawnSync('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], { shell: false, windowsHide: true, timeout: 10_000 });
      if (probe.status === 0) {
        const first = String(probe.stdout).trim().split(/\r?\n/)[0];
        const [name, vram] = first.split(',').map((part) => part.trim());
        gpu = { vendor: 'nvidia', name, vramGb: Number(vram) / 1024 };
      }
    } catch {}
    return { gpu, cpuCount: os.cpus().length, ramGb: Math.round(os.totalmem() / 1024 ** 3), drives: listDrives() };
  });
  ipcMain.handle('setup:run', async (_event, rawChoices) => {
    if (setupRunning) throw new Error('Setup is already running.');
    setupRunning = true;
    setupAbort = new AbortController();
    const choices: SetupChoices = { ...DEFAULT_CHOICES, ...(rawChoices ?? {}) };
    const root = choices.root;
    const status = detectSetupStatus();
    const manifest = buildManifest(root, choices);
    const pending = manifest.filter((component) => !status.components[component.id as keyof typeof status.components] || (component.id === 'model' && !isModelAt(root)));
    try {
      for (const component of pending) {
        await installComponent(component, {
          root,
          signal: setupAbort.signal,
          onEvent: (event: SetupEvent) => publish({ id: crypto.randomUUID(), projectId: activeProject?.id ?? '', type: 'progress.reported', timestamp: new Date().toISOString(), payload: { source: 'setup', event } }),
        });
      }
      return { ok: true, root };
    } finally {
      setupRunning = false;
      setupAbort = undefined;
      refreshStatus();
    }
  });
  ipcMain.handle('setup:cancel', async () => {
    setupAbort?.abort();
    return { cancelled: true };
  });
}

app.whenReady().then(() => {
  store = createStore(join(app.getPath('userData'), 'tadashi.json'));
  eventBus = new EventBus();
  // Embedded mode: when the local brain is installed on D:, the app is self-contained.
  // No batch files or env vars required; everything is owned by the app.
  process.env.TADASHI_BRAIN_BASE_URL ??= 'http://127.0.0.1:8080/v1/chat/completions';
  process.env.TADASHI_BRAIN_MODEL ??= 'Qwen3-8B-Q4_K_M';
  process.env.TADASHI_BRAIN_PROTOCOL ??= 'openai-compatible';
  process.env.TADASHI_BRAIN_API_KEY ??= 'local';
  process.env.TADASHI_LLAMA_MODEL_PATH ??= 'D:\\TadashiAI\\models\\Qwen3-8B-Q4_K_M.gguf';
  const executable = process.env.TADASHI_CLI_EXECUTABLE;
  let brain: BrainService | undefined;
  const agents = new Map<string, AgentAdapter>();
  if (executable) agents.set('local-cli', new CliAgentAdapter({ id: 'local-cli', name: 'Local CLI', type: 'cli', executable, args: [], protocol: 'openai-compatible', enabled: true }));
  const whisperExecutable = process.env.TADASHI_WHISPER_EXECUTABLE
    ?? (existsSync('D:\\TadashiAI\\whisper\\runtime\\Release\\whisper-cli.exe') ? 'D:\\TadashiAI\\whisper\\runtime\\Release\\whisper-cli.exe' : undefined);
  const whisperModel = process.env.TADASHI_WHISPER_MODEL
    ?? findWhisperModel();
  if (whisperExecutable) speechToText = new WhisperSpeechToText(whisperExecutable, whisperModel);
  // Voice output (TTS) is enabled by default — the app should speak without env vars.
  const voiceOutput = process.env.TADASHI_VOICE_OUTPUT ? process.env.TADASHI_VOICE_OUTPUT === 'true' : true;
  if (voiceOutput) {
    speaker = new NativeTextToSpeech();
    ttsQueue = new TtsQueue(speaker);
  }
  voiceLoop = new VoiceLoop({ ...defaultVoiceLoopConfig, enabled: process.env.TADASHI_VOICE_ALWAYS_LISTENING === 'true', wakePhrase: process.env.TADASHI_WAKE_PHRASE ?? defaultVoiceLoopConfig.wakePhrase });
  const brainProtocol = process.env.TADASHI_BRAIN_PROTOCOL ?? 'openai-compatible';
  const brainBaseUrl = process.env.TADASHI_BRAIN_BASE_URL ?? 'http://127.0.0.1:8080/v1/chat/completions';
  const brainModelConfig = process.env.TADASHI_BRAIN_MODEL ?? 'Qwen3-8B-Q4_K_M';
  if (brainBaseUrl && brainModelConfig && (brainProtocol === 'openai-compatible' || brainProtocol === 'anthropic')) {
    const modelClient: ModelClient = brainProtocol === 'anthropic'
      ? new AnthropicClient(brainModelConfig, brainBaseUrl, process.env.TADASHI_BRAIN_API_KEY ?? '')
      : new OpenAiCompatibleClient(brainModelConfig, brainBaseUrl, process.env.TADASHI_BRAIN_API_KEY);
    // Do NOT claim the brain is ready here — that is decided by a live /health probe.
    brainReady = false;
    brainModel = brainModelConfig;
    brainProvider = brainProtocol;
    brain = new BrainService(modelClient, { timeoutMs: Number(process.env.TADASHI_BRAIN_TIMEOUT_MS ?? 60_000) });
  }
  notifications = new NotificationService();
  credentials = new EncryptedCredentialStore((value) => safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(value).toString('base64') : undefined, (value) => safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(value, 'base64')) : undefined, join(app.getPath('userData'), 'credentials.json'));
  projectService = new ProjectService();
  gitService = new GitService(credentials);
  const apiBaseUrl = process.env.TADASHI_API_BASE_URL;
  const apiModel = process.env.TADASHI_API_MODEL;
  if (apiBaseUrl && apiModel) {
    agents.set('api-agent', new ApiAgentAdapter({ id: 'api-agent', name: 'API agent', type: 'api', baseUrl: apiBaseUrl, model: apiModel, args: [], protocol: 'openai-compatible', enabled: true }, async () => process.env.TADASHI_API_KEY));
  }
  void resolveCommandCodeCli().then((resolved) => {
    commandCodePath = resolved;
    agents.set('command-code', new CommandCodeAdapter({ id: 'command-code', name: 'Command Code', type: 'cli', delegate: 'command-code', executable: resolved, args: [], protocol: 'openai-compatible', enabled: true }));
    configuredAgentCount = agents.size;
    refreshStatus();
  }).catch(() => {
    publish({ id: crypto.randomUUID(), projectId: activeProject?.id ?? '', type: 'delegate.setup-required', timestamp: new Date().toISOString(), payload: { reason: 'Command Code CLI is not installed.' } });
  });
  configuredAgentCount = agents.size;
  const defaultAgentId = process.env.TADASHI_DEFAULT_AGENT && agents.has(process.env.TADASHI_DEFAULT_AGENT) ? process.env.TADASHI_DEFAULT_AGENT : agents.keys().next().value;
  // Wrap the speaker so a TTS failure reaches the renderer instead of failing silently.
  const reportingSpeaker: TextToSpeech | undefined = speaker ? {
    speak: async (text) => {
      try {
        voiceLoop?.speak();
        refreshStatus();
        await ttsQueue?.enqueue(text);
      } catch (error) {
        publish({ id: crypto.randomUUID(), projectId: activeProject?.id ?? '', type: 'brain.fallback', timestamp: new Date().toISOString(), payload: { reason: `Voice output failed: ${error instanceof Error ? error.message : 'unknown error'}` } });
      } finally {
        voiceLoop?.finishSpeak();
        refreshStatus();
      }
    },
  } : undefined;
  orchestrator = new Orchestrator({ store, bus: eventBus, agents, defaultAgentId, brain, speaker: reportingSpeaker, delegateModelTier });
  approvalService = new ApprovalService(store);
  void (async () => {
    if (!brain) return;
    const health = await checkLlamaHealth({ modelPath: process.env.TADASHI_LLAMA_MODEL_PATH, modelName: brainModel, endpoint: process.env.TADASHI_BRAIN_BASE_URL ?? '' }).catch(() => undefined);
    if (health && !health.reachable) brainFallBackReason = health.message;
    refreshStatus();
  })();
  eventBus.subscribe((event) => mainWindow?.webContents.send('event:project', event));
  startEmbeddedBrain();
  startAiBackend();
  activeProject = store.projects.list()[0];
  if (activeProject) startProjectMonitoring(activeProject);
  registerIpc();
  makeWindow();
  mainWindow?.on('closed', () => { mainWindow = undefined; });
});

app.on('before-quit', () => {
  fileMonitor?.stop();
  gitMonitor?.stop();
  store?.close();
  // Kill the brain process we spawned so no orphaned llama-server keeps holding the GPU/port.
  if (brainProcess && brainSpawned) {
    brainProcess.kill();
    brainProcess = undefined;
  }
  if (aiBackendProcess && aiBackendSpawned) {
    aiBackendProcess.kill();
    aiBackendProcess = undefined;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) makeWindow(); });
