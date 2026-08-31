import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import type { TadashiApi } from '../preload';

if (!window.tadashi) {
  // The web preview (vite dev server) has no Electron bridge; it gets a demo API for e2e smoke tests.
  // The packaged app must never fall back silently — a missing preload bridge is a real failure.
  if (location.protocol === 'http:') {
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
      delegateLogin: async () => ({ opened: false, path: '' }),
      delegateConnect: async (path) => ({ ok: false, installed: false, authenticated: false, path, reason: 'demo mode' }),
      delegateSetTier: async (tier) => ({ delegateModelTier: tier }),
      brainModels: async () => ({ models: ['Qwen3-8B-Q4_K_M.gguf'], current: 'Qwen3-8B-Q4_K_M', path: 'D:\\TadashiAI\\models' }),
      brainSelectModel: async (modelPath) => ({ ok: true, loaded: true, model: modelPath, path: modelPath }),
      setupStatus: async () => ({ complete: true, drive: 'D:\\', freeBytes: 0, requiredBytes: 0, components: { node: true, llama: true, model: true, whisper: true, cli: true, python: true }, missing: [] }),
      setupProbe: async () => ({ gpu: { vendor: 'nvidia', name: 'No GPU', vramGb: null }, cpuCount: 8, ramGb: 16, drives: [{ mount: 'D:\\', freeBytes: 0, preferred: true }] }),
      setupRun: async () => ({ ok: true, root: '' }),
      setupCancel: async () => ({ cancelled: true }),
      onEvent: () => () => undefined,
    };
    window.tadashi = demoApi;
  } else {
    throw new Error('The desktop bridge failed to load. Restart the app — real features are unavailable in this state.');
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
