import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { join, basename, dirname } from 'node:path';
import { access, mkdir, cp } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { createStore, type TadashiStore } from '../../../packages/persistence/src';
import { EventBus } from '../../../packages/monitoring/src';
import { FileMonitor, GitMonitor, NotificationService } from '../../../packages/monitoring/src';
import { ApiAgentAdapter, CliAgentAdapter, CommandCodeAdapter, type AgentAdapter } from '../../../packages/agents/src';
import { AnthropicClient, BrainService, OpenAiCompatibleClient, checkLlamaHealth, type ModelClient } from '../../../packages/brain/src';
import { ApprovalService, EncryptedCredentialStore, GitService, GitHubProvider, GitLabProvider, Orchestrator, ProjectService, defaultAutonomyPolicy, projectFromPath, selectGitHostProvider } from '../../../packages/orchestrator/src';
import { buildManifest, detectSetupStatus, detectTargetDrive, installComponent, totalRequiredBytes, type SetupEvent } from '../../../packages/setup/src';
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

/** Spawns the local llama.cpp brain server hidden and probes until it is healthy. */
function startEmbeddedBrain(): void {
  const serverPath = 'D:\\TadashiAI\\llama\\runtime\\llama-server.exe';
  const modelPath = 'D:\\TadashiAI\\models\\Qwen3-8B-Q4_K_M.gguf';
  const logPath = 'D:\\TadashiAI\\logs\\brain-server.log';
  spawn(serverPath, ['--model', modelPath, '--host', '127.0.0.1', '--port', '8080', '--ctx-size', '8192', '--n-gpu-layers', '999', '--flash-attn', 'on', '--threads', '8', '--parallel', '1', '--log-file', logPath], { shell: false, windowsHide: true, stdio: 'ignore' });
  const probeInterval = setInterval(() => {
    void fetch('http://127.0.0.1:8080/health', { signal: AbortSignal.timeout(2000) })
      .then((response) => { if (response.ok) { clearInterval(probeInterval); brainReady = true; refreshStatus(); } })
      .catch(() => { /* still loading */ });
  }, 3000);
  setTimeout(() => clearInterval(probeInterval), 90_000);
}

/** Resolves the command-code CLI path (cmdc shim on PATH, or an explicit D: install). */
async function resolveCommandCodeCli(preferred = commandCodePath): Promise<string> {
  if (preferred !== 'cmdc') {
    try { await access(preferred); return preferred; } catch { return preferred; }
  }
  const lookup = process.platform === 'win32' ? spawnSync('where', ['cmdc'], { shell: false, windowsHide: true, timeout: 10_000 }) : spawnSync('which', ['cmdc'], { shell: false, timeout: 10_000 });
  if (lookup.status !== 0) return preferred;
  const first = String(lookup.stdout).split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return first || preferred;
}

/** Ensures the Command Code CLI is available on this machine (npm global install). */
async function installCommandCodeCli(): Promise<string> {
  const destination = commandCodePath;
  if (destination !== 'cmdc' && !destination.startsWith('D:\\')) throw new Error('Command Code CLI must live on the D: drive or be the global cmdc.');
  // Prefer the npm-global CLI (cmdc on PATH) installed via `npm i -g command-code`.
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const install = spawnSync(npm, ['i', '-g', 'command-code'], { shell: false, windowsHide: true, timeout: 300_000, encoding: 'utf8' });
  if (install.status !== 0) throw new Error(`Command Code CLI install failed: ${String(install.stderr).slice(0, 200)}`);
  return destination;
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
      sandbox: true,
      nodeIntegration: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else mainWindow.loadFile(join(__dirname, '../../dist/index.html'));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
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
  ipcMain.handle('state:list', () => currentState());
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
    if (!speechToText) throw new Error('Local speech transcription is not configured yet. Set TADASHI_WHISPER_EXECUTABLE.');
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
    const resolved = commandCodePath !== 'cmdc' ? commandCodePath : await resolveCommandCodeCli();
    let installed = false;
    try { await access(resolved); installed = true; } catch {}
    let authenticated = false;
    if (installed) {
      const check = spawnSync(resolved, ['--version'], { shell: false, windowsHide: true, timeout: 10_000 });
      authenticated = check.status === 0 && !check.stderr.toString().includes('not authenticated');
    }
    return { installed, authenticated, path: resolved, brainReady, delegateModelTier };
  });
  ipcMain.handle('delegate:install', async () => {
    const path = await installCommandCodeCli();
    return { installed: true, path };
  });
  ipcMain.handle('delegate:tier', async (_event, rawTier) => {
    const tier = rawTier === 'auto' ? 'auto' : 'free-only';
    delegateModelTier = tier;
    refreshStatus();
    return { delegateModelTier: tier };
  });
  ipcMain.handle('setup:status', async () => {
    const drive = detectTargetDrive(totalRequiredBytes());
    return { ...detectSetupStatus(), drive: drive?.mount ?? 'C:\\', freeBytes: drive?.freeBytes ?? 0, requiredBytes: totalRequiredBytes() };
  });
  ipcMain.handle('setup:run', async () => {
    if (setupRunning) throw new Error('Setup is already running.');
    setupRunning = true;
    setupAbort = new AbortController();
    const drive = detectTargetDrive(totalRequiredBytes());
    const root = `${(drive?.mount ?? 'C:\\').replace(/[\\/]$/, '')}\\TadashiAI`;
    const status = detectSetupStatus();
    const manifest = buildManifest(root);
    const pending = manifest.filter((component) => !status.components[component.id as keyof typeof status.components]);
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
  const whisperExecutable = process.env.TADASHI_WHISPER_EXECUTABLE;
  if (whisperExecutable) speechToText = new WhisperSpeechToText(whisperExecutable);
  const brainProtocol = process.env.TADASHI_BRAIN_PROTOCOL ?? 'openai-compatible';
  const brainBaseUrl = process.env.TADASHI_BRAIN_BASE_URL ?? 'http://127.0.0.1:8080/v1/chat/completions';
  const brainModelConfig = process.env.TADASHI_BRAIN_MODEL ?? 'Qwen3-8B-Q4_K_M';
  if (brainBaseUrl && brainModelConfig && (brainProtocol === 'openai-compatible' || brainProtocol === 'anthropic')) {
    const modelClient: ModelClient = brainProtocol === 'anthropic'
      ? new AnthropicClient(brainModelConfig, brainBaseUrl, process.env.TADASHI_BRAIN_API_KEY ?? '')
      : new OpenAiCompatibleClient(brainModelConfig, brainBaseUrl, process.env.TADASHI_BRAIN_API_KEY);
    brainReady = true;
    brainModel = brainModelConfig;
    brainProvider = brainProtocol;
    brain = new BrainService(modelClient, { timeoutMs: Number(process.env.TADASHI_BRAIN_TIMEOUT_MS ?? 60_000) });
  }
  if (process.env.TADASHI_VOICE_OUTPUT === 'true') {
    speaker = new NativeTextToSpeech();
    ttsQueue = new TtsQueue(speaker);
  }
  voiceLoop = new VoiceLoop({ ...defaultVoiceLoopConfig, enabled: process.env.TADASHI_VOICE_ALWAYS_LISTENING === 'true', wakePhrase: process.env.TADASHI_WAKE_PHRASE ?? defaultVoiceLoopConfig.wakePhrase });
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
  orchestrator = new Orchestrator({ store, bus: eventBus, agents, defaultAgentId, brain, speaker, delegateModelTier });
  approvalService = new ApprovalService(store);
  void (async () => {
    if (!brain) return;
    const health = await checkLlamaHealth({ modelPath: process.env.TADASHI_LLAMA_MODEL_PATH, modelName: brainModel, endpoint: process.env.TADASHI_BRAIN_BASE_URL ?? '' }).catch(() => undefined);
    if (health && !health.reachable) brainFallBackReason = health.message;
    refreshStatus();
  })();
  eventBus.subscribe((event) => mainWindow?.webContents.send('event:project', event));
  startEmbeddedBrain();
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
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) makeWindow(); });
