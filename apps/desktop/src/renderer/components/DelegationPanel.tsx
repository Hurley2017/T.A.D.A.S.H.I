import { useEffect, useState } from 'react';

interface DelegateStatus {
  installed: boolean;
  authenticated: boolean;
  path: string;
  brainReady: boolean;
  delegateModelTier: 'free-only' | 'auto';
}

export function DelegationPanel({ tier, onTierChange, delegatePath, brainReady, brainModel }: { tier: 'free-only' | 'auto'; onTierChange: (tier: 'free-only' | 'auto') => void; delegatePath: string; brainReady: boolean; brainModel: string }) {
  const [status, setStatus] = useState<DelegateStatus>();
  const [installing, setInstalling] = useState(false);

  async function refreshStatus() {
    try {
      setStatus(await window.tadashi.delegateStatus());
    } catch {}
  }

  useEffect(() => {
    void refreshStatus();
  }, [tier, brainReady]);

  async function install() {
    setInstalling(true);
    try {
      await window.tadashi.delegateInstall();
      await refreshStatus();
    } finally {
      setInstalling(false);
    }
  }

  return (
    <section className="panel delegate-panel" aria-labelledby="delegate-heading">
      <div className="panel-heading"><div><div className="section-kicker">Delegation</div><h2 id="delegate-heading">Worker routing</h2></div><span className={`signal-state ${brainReady ? 'live' : 'idle'}`}>{brainReady ? 'Brain online' : 'Brain offline'}</span></div>
      <div className="delegate-card">
        <span className={`delegate-dot ${brainReady ? 'live' : 'idle'}`} aria-hidden="true" />
        <div>
          <strong>Local brain · {brainModel || 'Qwen3-8B'}</strong>
          <small>Assesses task complexity, then picks the cheapest capable model.</small>
        </div>
      </div>
      <div className="tier-selector" role="group" aria-label="Model tier">
        <button className={tier === 'free-only' ? 'is-selected' : ''} type="button" onClick={() => onTierChange('free-only')}>Free only</button>
        <button className={tier === 'auto' ? 'is-selected' : ''} type="button" onClick={() => onTierChange('auto')}>Auto · cheapest capable</button>
      </div>
      {status && !status.installed ? (
        <div className="setup-card">
          <strong>Command Code worker not installed</strong>
          <p>Install the worker CLI on D:\TadashiAI to enable delegation.</p>
          <button className="primary-button" type="button" onClick={() => void install()} disabled={installing}>{installing ? 'Installing…' : 'Install worker'}</button>
        </div>
      ) : status?.installed && !status.authenticated ? (
        <div className="setup-card">
          <strong>Worker not authenticated</strong>
          <p>Sign in once with Command Code; Tadashi will use it invisibly after.</p>
          <button className="primary-button" type="button" onClick={() => { window.open(delegatePath, '_blank'); }}>Open login</button>
        </div>
      ) : (
        <div className="delegate-hint"><span className="signal-state live">✓ Ready to delegate</span><small>{status?.path ?? delegatePath}</small></div>
      )}
    </section>
  );
}
