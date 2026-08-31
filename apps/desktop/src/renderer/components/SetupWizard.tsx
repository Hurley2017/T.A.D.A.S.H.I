import { useEffect, useState } from 'react';

interface SetupStatusView {
  complete: boolean;
  drive: string;
  freeBytes: number;
  requiredBytes: number;
  components: { node: boolean; llama: boolean; model: boolean; whisper: boolean; cli: boolean; python: boolean };
  missing: string[];
}

const COMPONENT_LABELS: Record<string, string> = {
  node: 'Node.js runtime',
  llama: 'llama.cpp GPU engine',
  model: 'Qwen3-8B brain model (4.7 GB)',
  whisper: 'Whisper speech-to-text',
  cli: 'Command Code worker',
  python: 'Python runtime',
};

export function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const [status, setStatus] = useState<SetupStatusView>();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string>('');

  async function refresh() {
    const next = await window.tadashi.setupStatus();
    setStatus(next);
    if (next.complete) onComplete();
  }

  useEffect(() => {
    void refresh();
    return window.tadashi.onEvent((event) => {
      const payload = event.payload as { source?: string; event?: { kind: string; component?: string; label?: string; received?: number; total?: number } };
      if (payload?.source === 'setup' && payload.event) {
        const e = payload.event;
        if (e.kind === 'download-progress' && e.total) setProgress(`${e.label ?? COMPONENT_LABELS[e.component ?? ''] ?? e.component}: ${Math.round((e.received ?? 0) / e.total * 100)}%`);
        else if (e.kind === 'execute') setProgress(e.label ?? 'Running install step…');
        else if (e.kind === 'verify') setProgress(`${COMPONENT_LABELS[e.component ?? ''] ?? e.component} verified`);
        else if (e.kind === 'component-start') setProgress(`Installing ${e.label}…`);
      }
      if (payload?.source === 'setup' && !running) void refresh();
    });
  }, [running]);

  async function install() {
    setRunning(true);
    setProgress('Preparing setup…');
    try {
      await window.tadashi.setupRun();
      await refresh();
    } finally {
      setRunning(false);
    }
  }

  if (!status) return <div className="setup-wizard"><p>Checking your system…</p></div>;
  if (status.complete) return null;

  return (
    <div className="setup-wizard" role="dialog" aria-label="TADASHI setup">
      <div className="setup-card-header">
        <div className="setup-glyph" aria-hidden="true">T</div>
        <div>
          <h2>Setting up T.A.D.A.S.H.I.</h2>
          <p>One-time setup downloads the local brain, model, and worker (~5 GB total) to {status.drive}.</p>
        </div>
        <span className="setup-space">{Math.round(status.requiredBytes / 1_000_000_000)} GB needed · {Math.round(status.freeBytes / 1_000_000_000)} GB free</span>
      </div>
      <ul className="setup-steps">
        {Object.entries(COMPONENT_LABELS).map(([id, label]) => (
          <li key={id} className={status.components[id as keyof typeof status.components] ? 'done' : running ? 'active' : 'pending'}>
            <span aria-hidden="true">{status.components[id as keyof typeof status.components] ? '✓' : '·'}</span>
            {label}
          </li>
        ))}
      </ul>
      {progress && <p className="setup-progress" role="status">{progress}</p>}
      <div className="setup-actions">
        {!running && status.missing.length > 0 && (
          <button className="primary-button" type="button" onClick={() => void install()}>Install everything</button>
        )}
        {running && (
          <button className="ghost-button" type="button" onClick={() => void window.tadashi.setupCancel()}>Cancel</button>
        )}
      </div>
    </div>
  );
}
