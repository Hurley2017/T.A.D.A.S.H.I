import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import type { TadashiApi } from '../preload';

if (!window.tadashi) {
  const demoApi: TadashiApi = {
    listState: async () => ({ projects: [], messages: [], tasks: [], runs: [], approvals: [], events: [], agentReady: false, brainReady: false, brainModel: '', brainProvider: 'fallback' as const, brainFallBackReason: '', voiceOutput: false, voiceState: 'idle' as const, autonomyPolicy: { voiceConfirmedDestructive: true, voiceConfirmedNetwork: true, voiceConfirmedGitPush: true, voiceConfirmedProjectDelete: true, voiceConfirmedForceOperation: true, allowedProjects: 'selected' as const }, gitConfigured: false, gitProvider: 'github' as const, delegateModelTier: 'free-only' as const, commandCodePath: '' }),
    selectProject: async () => undefined,
    activateProject: async () => { throw new Error('Project activation is available in the desktop app.'); },
    createProject: async () => { throw new Error('Project creation is available in the desktop app.'); },
    deleteProject: async () => { throw new Error('Project deletion is available in the desktop app.'); },
    submitMessage: async () => { throw new Error('The local desktop app is required to route instructions.'); },
    resolveApproval: async () => { throw new Error('The local desktop app is required to resolve approvals.'); },
    transcribeAudio: async (_audio, _mimeType) => { throw new Error('Local transcription is available in the desktop app.'); },
    toggleVoice: async () => 'unavailable',
    gitStatus: async () => '',
    gitPush: async () => '',
    gitRemote: async () => '',
    hostStatus: async () => ({ configured: false, provider: 'github', ok: false }),
    delegateStatus: async () => ({ installed: false, authenticated: false, path: '', brainReady: false, delegateModelTier: 'free-only' as const }),
    delegateInstall: async () => ({ installed: false, path: '' }),
    delegateSetTier: async (tier) => ({ delegateModelTier: tier }),
    setupStatus: async () => ({ complete: true, drive: 'D:\\', freeBytes: 0, requiredBytes: 0, components: { node: true, llama: true, model: true, whisper: true, cli: true, python: true }, missing: [] }),
    setupProbe: async () => ({ gpu: { vendor: 'nvidia', name: 'No GPU', vramGb: null }, cpuCount: 8, ramGb: 16, drives: [{ mount: 'D:\\', freeBytes: 0, preferred: true }] }),
    setupRun: async () => ({ ok: true, root: '' }),
    setupCancel: async () => ({ cancelled: true }),
    onEvent: () => () => undefined,
  };
  window.tadashi = demoApi;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
