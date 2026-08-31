import { useEffect, useMemo, useState } from 'react';

interface SetupStatusView {
  complete: boolean;
  drive: string;
  freeBytes: number;
  requiredBytes: number;
  components: { node: boolean; llama: boolean; model: boolean; whisper: boolean; cli: boolean; python: boolean };
  missing: string[];
}

interface ProbeView {
  gpu: { vendor: string; name: string; vramGb: number | null };
  cpuCount: number;
  ramGb: number;
  drives: { mount: string; freeBytes: number; preferred: boolean }[];
}

interface ModelOptionView {
  id: string;
  label: string;
  description: string;
  minVramGb: number;
  sizeGb: number;
}

const COMPONENT_LABELS: Record<string, string> = {
  node: 'Node.js runtime',
  llama: 'llama.cpp GPU engine',
  model: 'Brain model',
  whisper: 'Whisper speech-to-text',
  cli: 'Command Code worker',
  python: 'Python runtime',
};

export function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const [status, setStatus] = useState<SetupStatusView>();
  const [probe, setProbe] = useState<ProbeView>();
  const [step, setStep] = useState(0); // 0 = detect, 1 = customize, 2 = install
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [modelId, setModelId] = useState('qwen3-8b-q4');
  const [root, setRoot] = useState('D:\\TadashiAI');
  const [delegateTier, setDelegateTier] = useState<'free-only' | 'auto'>('free-only');
  const [wakePhrase, setWakePhrase] = useState('tadashi');
  const [voiceOutput, setVoiceOutput] = useState(true);
  const [alwaysListening, setAlwaysListening] = useState(true);
  const [whisperModel, setWhisperModel] = useState<'base.en' | 'small.en'>('base.en');

  const modelOptions: ModelOptionView[] = useMemo(() => [
    { id: 'qwen3-8b-q4', label: 'Qwen3 8B · Q4_K_M (balanced)', description: 'Best balance of speed and capability for 6+ GB GPUs. Recommended.', minVramGb: 6, sizeGb: 4.7 },
    { id: 'qwen3-4b-q8', label: 'Qwen3 4B · Q8_0 (lightweight)', description: 'Faster and lighter — suits 4-6 GB GPUs or CPU-only systems.', minVramGb: 4, sizeGb: 4.4 },
  ], []);

  async function detect() {
    try {
      setStatus(await window.tadashi.setupStatus());
      const nextProbe = await window.tadashi.setupProbe();
      setProbe(nextProbe);
      const recommended = (nextProbe.gpu.vramGb ?? 0) >= 6 ? 'qwen3-8b-q4' : 'qwen3-4b-q8';
      setModelId(recommended);
      const preferredDrive = nextProbe.drives.find((drive) => drive.mount === 'D:\\');
      const best = preferredDrive ?? nextProbe.drives[0];
      if (best) setRoot(`${best.mount.replace(/[\\/]$/, '')}\\TadashiAI`);
      setStep(1);
    } catch (cause) {
      setProgress(cause instanceof Error ? cause.message : 'System detection failed.');
    }
  }

  async function install() {
    setRunning(true);
    setStep(2);
    setProgress('Preparing setup…');
    try {
      await window.tadashi.setupRun({ root, modelId, delegateTier, wakePhrase, voiceOutput, alwaysListening, whisperModel });
      await refresh();
    } catch (cause) {
      setProgress(cause instanceof Error ? cause.message : 'Setup failed.');
    } finally {
      setRunning(false);
    }
  }

  async function refresh() {
    const next = await window.tadashi.setupStatus();
    setStatus(next);
    if (next.complete) onComplete();
  }

  useEffect(() => {
    void detect();
    return window.tadashi.onEvent((event) => {
      const payload = event.payload as { source?: string; event?: { kind: string; component?: string; label?: string; received?: number; total?: number } };
      if (payload?.source === 'setup' && payload.event) {
        const e = payload.event;
        if (e.kind === 'download-progress' && e.total) setProgress(`${COMPONENT_LABELS[e.component ?? ''] ?? e.component}: ${Math.round((e.received ?? 0) / e.total * 100)}%`);
        else if (e.kind === 'execute') setProgress(e.label ?? 'Running install step…');
        else if (e.kind === 'verify') setProgress(`${COMPONENT_LABELS[e.component ?? ''] ?? e.component} verified`);
        else if (e.kind === 'component-start') setProgress(`Installing ${e.label}…`);
      }
      if (payload?.source === 'setup' && !running) void refresh();
    });
  }, [running]);

  if (!status) return <div className="setup-wizard"><p>Checking your system…</p></div>;
  if (status.complete) return null;

  return (
    <div className="setup-wizard" role="dialog" aria-label="TADASHI setup">
      <div className="setup-card-header">
        <div className="setup-glyph" aria-hidden="true">T</div>
        <div>
          <h2>Setting up T.A.D.A.S.H.I.</h2>
          <p>{step === 0 ? 'Detecting your system…' : step === 1 ? 'Customize how T.A.D.A.S.H.I. runs.' : 'Installing your choices — this may take a while.'}</p>
        </div>
        {probe && <span className="setup-space">{probe.gpu.name} · {probe.ramGb} GB RAM</span>}
      </div>

      {step >= 1 && (
        <div className="setup-fields">
          <label className="setup-field">
            <span>Brain model</span>
            <select value={modelId} onChange={(e) => setModelId(e.target.value)} disabled={running}>
              {modelOptions.map((option) => <option key={option.id} value={option.id}>{option.label} (~{option.sizeGb} GB)</option>)}
            </select>
            <small>{modelOptions.find((option) => option.id === modelId)?.description}</small>
          </label>
          <label className="setup-field">
            <span>Install drive</span>
            <select value={root} onChange={(e) => setRoot(e.target.value)} disabled={running}>
              {(probe?.drives ?? []).map((drive) => <option key={drive.mount} value={`${drive.mount.replace(/[\\/]$/, '')}\\TadashiAI`}>{drive.mount} · {Math.round(drive.freeBytes / 1_000_000_000)} GB free</option>)}
            </select>
          </label>
          <label className="setup-field">
            <span>Delegate tier</span>
            <select value={delegateTier} onChange={(e) => setDelegateTier(e.target.value as 'free-only' | 'auto')} disabled={running}>
              <option value="free-only">Free only (zero cost)</option>
              <option value="auto">Auto · cheapest capable (paid on demand)</option>
            </select>
          </label>
          <label className="setup-field">
            <span>Wake phrase</span>
            <input type="text" value={wakePhrase} onChange={(e) => setWakePhrase(e.target.value)} disabled={running} />
            <small>Say this phrase to wake T.A.D.A.S.H.I. when hands-free.</small>
          </label>
          <label className="setup-check">
            <input type="checkbox" checked={voiceOutput} onChange={(e) => setVoiceOutput(e.target.checked)} disabled={running} />
            <span>Speak responses aloud (voice output)</span>
          </label>
          <label className="setup-check">
            <input type="checkbox" checked={alwaysListening} onChange={(e) => setAlwaysListening(e.target.checked)} disabled={running} />
            <span>Always listen for the wake phrase</span>
          </label>
          <label className="setup-field">
            <span>Whisper model</span>
            <select value={whisperModel} onChange={(e) => setWhisperModel(e.target.value as 'base.en' | 'small.en')} disabled={running}>
              <option value="base.en">base.en · fast (recommended)</option>
              <option value="small.en">small.en · more accurate, slower</option>
            </select>
          </label>
        </div>
      )}

      {step >= 2 && (
        <ul className="setup-steps">
          {Object.entries(COMPONENT_LABELS).map(([id, label]) => (
            <li key={id} className={status.components[id as keyof typeof status.components] ? 'done' : running ? 'active' : 'pending'}>
              <span aria-hidden="true">{status.components[id as keyof typeof status.components] ? '✓' : '·'}</span>
              {label}
            </li>
          ))}
        </ul>
      )}

      {progress && <p className="setup-progress" role="status">{progress}</p>}

      <div className="setup-actions">
        {step === 1 && !running && (
          <button className="primary-button" type="button" onClick={() => void install()}>Install my choices</button>
        )}
        {running && (
          <button className="ghost-button" type="button" onClick={() => void window.tadashi.setupCancel()}>Cancel</button>
        )}
      </div>
    </div>
  );
}
