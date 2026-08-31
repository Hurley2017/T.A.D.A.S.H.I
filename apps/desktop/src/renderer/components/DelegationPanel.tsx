import { useEffect, useState } from 'react';

interface DelegateStatus {
  installed: boolean;
  authenticated: boolean;
  path: string;
  brainReady: boolean;
  delegateModelTier: 'free-only' | 'auto';
}

interface ModelInfo {
  models: string[];
  current: string;
  path: string;
}

export function DelegationPanel({ tier, onTierChange, delegatePath, brainReady, brainModel }: { tier: 'free-only' | 'auto'; onTierChange: (tier: 'free-only' | 'auto') => void; delegatePath: string; brainReady: boolean; brainModel: string }) {
  const [status, setStatus] = useState<DelegateStatus>();
  const [busy, setBusy] = useState<'install' | 'login' | 'model' | 'connect' | undefined>();
  const [error, setError] = useState<string>();
  const [models, setModels] = useState<ModelInfo>();
  const [selectedModel, setSelectedModel] = useState<string>(brainModel);
  const [manualPath, setManualPath] = useState<string>('');

  async function refreshStatus() {
    try {
      setStatus(await window.tadashi.delegateStatus());
    } catch {}
  }

  async function refreshModels() {
    try {
      const info = await window.tadashi.brainModels();
      setModels(info);
      if (info.current) setSelectedModel(info.current);
    } catch {}
  }

  useEffect(() => {
    void refreshStatus();
    void refreshModels();
  }, [tier, brainReady, brainModel]);

  async function install() {
    setBusy('install');
    setError(undefined);
    try {
      await window.tadashi.delegateInstall();
      await refreshStatus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Worker install failed.');
    } finally {
      setBusy(undefined);
    }
  }

  async function login() {
    setBusy('login');
    try {
      await window.tadashi.delegateLogin();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in could not be opened.');
    } finally {
      setBusy(undefined);
    }
  }

  async function connect() {
    const path = manualPath.trim();
    if (!path) { setError('Enter the CLI path first (e.g. cmdc or C:\\Users\\you\\AppData\\Roaming\\npm\\cmdc.cmd).'); return; }
    setBusy('connect');
    setError(undefined);
    try {
      const result = await window.tadashi.delegateConnect(path);
      if (!result.ok) {
        setError(result.reason ?? 'The CLI was not found at that path.');
      } else {
        setManualPath('');
        await refreshStatus();
        if (!result.authenticated) setError('Connected — now sign in to Command Code.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not connect the worker.');
    } finally {
      setBusy(undefined);
    }
  }

  async function changeModel(modelName: string) {
    if (modelName === '__browse__') {
      await browseModel();
      return;
    }
    if (!models) return;
    setBusy('model');
    setError(undefined);
    setSelectedModel(modelName);
    try {
      const result = await window.tadashi.brainSelectModel(`${models.path}\\${modelName}`);
      if (!result.loaded) setError('The model could not be loaded — check it is compatible with llama.cpp.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Model switch failed.');
    } finally {
      setBusy(undefined);
      void refreshModels();
    }
  }

  async function browseModel() {
    setBusy('model');
    setError(undefined);
    try {
      const result = await window.tadashi.brainSelectModel('');
      if (result.ok && result.loaded) {
        setSelectedModel(result.model);
        await refreshModels();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Model switch failed.');
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <section className="delegate-panel" aria-labelledby="delegate-heading">
      <div className="panel-heading">
        <div>
          <div className="section-kicker">Delegation</div>
          <h2 id="delegate-heading">Worker routing</h2>
        </div>
        <span className={`signal-state ${brainReady ? 'active' : ''}`}>{brainReady ? 'Ready to roll' : 'Brain loading'}</span>
      </div>
      <div className={`delegate-row ${brainReady ? 'is-loaded' : ''}`}>
        <span className={`connection-dot ${brainReady ? 'is-active' : ''}`} aria-hidden="true" />
        <div>
          <strong>{selectedModel || brainModel || 'Qwen3-8B'}</strong>
          <small className={brainReady ? 'ready-text' : ''}>{brainReady ? 'Model loaded on GPU — ready for tasks.' : 'Model is loading on your GPU…'}</small>
        </div>
      </div>

      <div className="model-picker" role="group" aria-label="Brain model">
        <label htmlFor="brain-model">Loaded model</label>
        <select id="brain-model" value={selectedModel} onChange={(event) => void changeModel(event.target.value)} disabled={busy === 'model'}>
          {(models?.models ?? []).map((model) => <option key={model} value={model}>{model}</option>)}
          {models && models.models.length === 0 && <option value="">No models found in {models.path}</option>}
          <option value="__browse__">Browse for a model…</option>
        </select>
        <small className="model-hint">{busy === 'model' ? 'Switching model — this takes a moment…' : 'Switch or browse for a GGUF model file.'}</small>
      </div>

      {status?.installed === false && (
        <div className="delegate-setup">
          <p>I delegate tasks to the Command Code worker. It is not installed yet.</p>
          <button className="deny-button" type="button" onClick={() => void install()} disabled={busy !== undefined}>{busy === 'install' ? 'Installing…' : 'Install worker'}</button>
        </div>
      )}
      {error && <p className="delegate-error">{error}</p>}
      {status?.installed === true && status.authenticated === false && (
        <div className="delegate-setup">
          <p>Worker is installed but not signed in. Sign in once — I'll use it invisibly after.</p>
          <button className="deny-button" type="button" onClick={() => void login()} disabled={busy !== undefined}>{busy === 'login' ? 'Opening sign-in…' : 'Sign in to Command Code'}</button>
        </div>
      )}
      {status?.installed === true && status.authenticated === true && (
        <div className="delegate-hint">
          <span className="signal-state active">✓ Worker connected</span>
          <small>Command Code · ready to receive tasks</small>
        </div>
      )}

      <div className="manual-connect" role="group" aria-label="Connect worker manually">
        <label htmlFor="cc-path">Already installed? Connect manually</label>
        <div className="manual-connect-row">
          <input id="cc-path" value={manualPath} onChange={(event) => setManualPath(event.target.value)} placeholder="Path to cmdc.cmd (or cmdc)" spellCheck={false} />
          <button className="ghost-button" type="button" onClick={() => void connect()} disabled={busy !== undefined}>{busy === 'connect' ? 'Connecting…' : 'Connect'}</button>
        </div>
      </div>

      <div className="tier-selector" role="group" aria-label="Model tier">
        <button className={`tier-button ${tier === 'free-only' ? 'is-selected' : ''}`} type="button" onClick={() => onTierChange('free-only')}>Free only</button>
        <button className={`tier-button ${tier === 'auto' ? 'is-selected' : ''}`} type="button" onClick={() => onTierChange('auto')}>Auto</button>
      </div>
    </section>
  );
}
