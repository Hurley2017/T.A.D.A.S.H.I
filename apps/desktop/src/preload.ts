import { contextBridge, ipcRenderer } from 'electron';
import type { ApprovalRequest, Project, ProjectEvent, Task, AgentRun, ConversationMessage } from '../../../packages/contracts/src';

const api = {
  listState: () => ipcRenderer.invoke('state:list'),
  selectProject: () => ipcRenderer.invoke('project:select'),
  activateProject: (projectId: string) => ipcRenderer.invoke('project:activate', projectId),
  createProject: (parentPath: string, name: string) => ipcRenderer.invoke('project:create', { parentPath, name }),
  deleteProject: (projectId: string) => ipcRenderer.invoke('project:delete', projectId),
  submitMessage: (projectId: string, content: string) => ipcRenderer.invoke('message:submit', { projectId, content }),
  resolveApproval: (approvalId: string, decision: 'approved' | 'denied', scope?: 'once' | 'task' | 'project') => ipcRenderer.invoke('approval:resolve', { approvalId, decision, scope }),
  transcribeAudio: (audio: Uint8Array, mimeType: string) => ipcRenderer.invoke('voice:transcribe', { audio, mimeType }),
  toggleVoice: () => ipcRenderer.invoke('voice:toggle'),
  gitStatus: (projectId: string) => ipcRenderer.invoke('git:status', projectId),
  gitPush: (projectId: string, branch?: string) => ipcRenderer.invoke('git:push', { projectId, branch }),
  gitRemote: (projectId: string, url: string) => ipcRenderer.invoke('git:remote', { projectId, url }),
  hostStatus: () => ipcRenderer.invoke('host:status'),
  delegateStatus: () => ipcRenderer.invoke('delegate:status'),
  delegateInstall: () => ipcRenderer.invoke('delegate:install'),
  delegateSetTier: (tier: 'free-only' | 'auto') => ipcRenderer.invoke('delegate:tier', tier),
  setupStatus: () => ipcRenderer.invoke('setup:status'),
  setupProbe: () => ipcRenderer.invoke('setup:probe'),
  setupRun: (choices: { root: string; modelId: string; delegateTier: 'free-only' | 'auto'; wakePhrase: string; voiceOutput: boolean; alwaysListening: boolean; whisperModel: 'base.en' | 'small.en' }) => ipcRenderer.invoke('setup:run', choices),
  setupCancel: () => ipcRenderer.invoke('setup:cancel'),
  onEvent: (listener: (event: ProjectEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, event: ProjectEvent) => listener(event);
    ipcRenderer.on('event:project', handler);
    return () => ipcRenderer.removeListener('event:project', handler);
  },
};

contextBridge.exposeInMainWorld('tadashi', api);

export type TadashiApi = {
  listState: () => Promise<{
    projects: Project[];
    project?: Project;
    messages: ConversationMessage[];
    tasks: Task[];
    runs: AgentRun[];
    approvals: ApprovalRequest[];
    events: ProjectEvent[];
    agentReady: boolean;
    brainReady: boolean;
    brainModel: string;
    brainProvider: 'openai-compatible' | 'anthropic' | 'fallback';
    brainFallBackReason: string;
    voiceOutput: boolean;
    voiceState: 'idle' | 'listening' | 'wake-detected' | 'recording' | 'transcribing' | 'thinking' | 'speaking' | 'muted' | 'error';
    autonomyPolicy: { voiceConfirmedDestructive: boolean; voiceConfirmedNetwork: boolean; voiceConfirmedGitPush: boolean; voiceConfirmedProjectDelete: boolean; voiceConfirmedForceOperation: boolean; allowedProjects: 'all' | 'selected' | 'explicit' };
    gitConfigured: boolean;
    gitProvider: 'github' | 'gitlab';
    delegateModelTier: 'free-only' | 'auto';
    commandCodePath: string;
  }>;
  selectProject: () => Promise<Project | undefined>;
  activateProject: (projectId: string) => Promise<Project>;
  createProject: (parentPath: string, name: string) => Promise<Project>;
  deleteProject: (projectId: string) => Promise<{ deleted: string }>;
  submitMessage: (projectId: string, content: string) => Promise<{ messageId: string; task?: Task; tasks?: Task[]; question?: string; response: string; brainMode: 'llm' | 'fallback'; decisionKind: string }>;
  resolveApproval: (approvalId: string, decision: 'approved' | 'denied', scope?: 'once' | 'task' | 'project') => Promise<ApprovalRequest>;
  transcribeAudio: (audio: Uint8Array, mimeType: string) => Promise<string>;
  toggleVoice: () => Promise<string>;
  gitStatus: (projectId: string) => Promise<string>;
  gitPush: (projectId: string, branch?: string) => Promise<string>;
  gitRemote: (projectId: string, url: string) => Promise<string>;
  hostStatus: () => Promise<{ configured: boolean; provider: string; ok: boolean; user?: string }>;
  delegateStatus: () => Promise<{ installed: boolean; authenticated: boolean; path: string; brainReady: boolean; delegateModelTier: 'free-only' | 'auto' }>;
  delegateInstall: () => Promise<{ installed: boolean; path: string }>;
  delegateSetTier: (tier: 'free-only' | 'auto') => Promise<{ delegateModelTier: 'free-only' | 'auto' }>;
  setupStatus: () => Promise<{ complete: boolean; drive: string; freeBytes: number; requiredBytes: number; components: { node: boolean; llama: boolean; model: boolean; whisper: boolean; cli: boolean; python: boolean }; missing: string[] }>;
  setupProbe: () => Promise<{ gpu: { vendor: string; name: string; vramGb: number | null }; cpuCount: number; ramGb: number; drives: { mount: string; freeBytes: number; preferred: boolean }[] }>;
  setupRun: (choices: { root: string; modelId: string; delegateTier: 'free-only' | 'auto'; wakePhrase: string; voiceOutput: boolean; alwaysListening: boolean; whisperModel: 'base.en' | 'small.en' }) => Promise<{ ok: boolean; root: string }>;
  setupCancel: () => Promise<{ cancelled: boolean }>;
  onEvent: (listener: (event: ProjectEvent) => void) => () => void;
};
