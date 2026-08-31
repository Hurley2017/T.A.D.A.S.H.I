import { useEffect, useMemo, useState } from 'react';
import type { AgentRun, ApprovalRequest, ConversationMessage, Project, ProjectEvent, Task } from '@contracts/index';
import { ConversationPanel } from './components/ConversationPanel';
import { ProjectPicker } from './components/ProjectPicker';
import { TaskBoard } from './components/TaskBoard';
import { AgentRunPanel } from './components/AgentRunPanel';
import { ApprovalDialog } from './components/ApprovalDialog';
import { DelegationPanel } from './components/DelegationPanel';
import { SetupWizard } from './components/SetupWizard';

type State = { projects: Project[]; project?: Project; messages: ConversationMessage[]; tasks: Task[]; runs: AgentRun[]; approvals: ApprovalRequest[]; events: ProjectEvent[]; agentReady: boolean; brainReady: boolean; brainModel: string; brainProvider: 'openai-compatible' | 'anthropic' | 'fallback'; brainFallBackReason: string; voiceOutput: boolean; voiceState: 'idle' | 'listening' | 'wake-detected' | 'recording' | 'transcribing' | 'thinking' | 'speaking' | 'muted' | 'error'; autonomyPolicy: { voiceConfirmedDestructive: boolean; voiceConfirmedNetwork: boolean; voiceConfirmedGitPush: boolean; voiceConfirmedProjectDelete: boolean; voiceConfirmedForceOperation: boolean; allowedProjects: 'all' | 'selected' | 'explicit' }; gitConfigured: boolean; gitProvider: 'github' | 'gitlab'; delegateModelTier: 'free-only' | 'auto'; commandCodePath: string };
const emptyState: State = { projects: [], messages: [], tasks: [], runs: [], approvals: [], events: [], agentReady: false, brainReady: false, brainModel: '', brainProvider: 'fallback', brainFallBackReason: '', voiceOutput: false, voiceState: 'idle', autonomyPolicy: { voiceConfirmedDestructive: true, voiceConfirmedNetwork: true, voiceConfirmedGitPush: true, voiceConfirmedProjectDelete: true, voiceConfirmedForceOperation: true, allowedProjects: 'selected' }, gitConfigured: false, gitProvider: 'github', delegateModelTier: 'free-only', commandCodePath: '' };

export function App() {
  const [state, setState] = useState<State>(emptyState);
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [isAssessing, setIsAssessing] = useState(false);
  const [setupIncomplete, setSetupIncomplete] = useState(false);

  async function refresh() {
    try {
      setState(await window.tadashi.listState());
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The local orchestrator is unavailable.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    void window.tadashi.setupStatus().then((status) => setSetupIncomplete(!status.complete)).catch(() => undefined);
    return window.tadashi.onEvent(() => { void refresh(); });
  }, []);

  async function selectProject(projectId?: string) {
    try {
      if (projectId) await window.tadashi.activateProject(projectId);
      else await window.tadashi.selectProject();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The project folder could not be opened.');
    }
  }

  async function submitMessage(content: string) {
    if (!state.project) return;
    setIsAssessing(true);
    try {
      await window.tadashi.submitMessage(state.project.id, content);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The instruction could not be routed.');
    } finally {
      setIsAssessing(false);
    }
  }

  async function resolveApproval(decision: 'approved' | 'denied') {
    const approval = state.approvals.find((item) => item.status === 'pending');
    if (!approval) return;
    try {
      await window.tadashi.resolveApproval(approval.id, decision, 'once');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The approval could not be resolved.');
    }
  }

  const pendingApproval = state.approvals.find((item) => item.status === 'pending');
  const activeTasks = state.tasks.filter((task) => ['running', 'awaiting-approval', 'blocked', 'failed'].includes(task.status)).length;
  const latestGit = [...state.events].reverse().find((event) => event.type === 'git.changed');
  const latestFile = [...state.events].reverse().find((event) => event.type === 'file.changed');
  const pulseLabel = isAssessing ? 'Tadashi is assessing' : pendingApproval ? 'Decision needed' : activeTasks ? 'Agents in motion' : state.brainReady ? 'Brain online' : 'Fallback mode';
  const voiceLabel = state.voiceState === 'muted' ? 'Voice muted' : state.voiceState === 'listening' ? 'Listening for "tadashi"' : state.voiceState === 'recording' ? 'Recording command' : state.voiceState === 'thinking' ? 'Thinking' : state.voiceState === 'speaking' ? 'Speaking' : state.voiceState === 'error' ? 'Voice error' : 'Voice idle';
  const gitLabel = state.gitConfigured ? `${state.gitProvider} ready` : `${state.gitProvider} needs sign-in`;
  const report = useMemo(() => {
    if (isAssessing) return 'Tadashi is assessing the request and available agents.';
    if (pendingApproval) return 'I have a proposed action ready for your review.';
    if (activeTasks) return `${activeTasks} task${activeTasks === 1 ? '' : 's'} active in the workspace.`;
    return 'Your project is ready for direction.';
  }, [activeTasks, isAssessing, pendingApproval]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to workspace</a>
      <aside className="sidebar" aria-label="Project navigation">
        <div className="brand-lockup"><span className="brand-glyph" aria-hidden="true">T</span><span><strong>T.A.D.A.S.H.I.</strong><small>Project control room</small></span></div>
        <ProjectPicker projects={state.projects} activeProject={state.project} onSelect={(projectId) => void selectProject(projectId)} />
        <nav className="side-nav" aria-label="Workspace views">
          <button className="nav-item is-selected" type="button" aria-current="page"><span aria-hidden="true">◎</span> Overview <kbd>1</kbd></button>
          <button className="nav-item" type="button" onClick={() => setError('Activity timeline is coming next.')}><span aria-hidden="true">◫</span> Activity <span className="nav-count">{state.events.length || ''}</span></button>
          <button className="nav-item" type="button" onClick={() => setError(state.brainReady ? `${state.brainProvider} brain · ${state.brainModel}` : 'Set TADASHI_BRAIN_BASE_URL and TADASHI_BRAIN_MODEL to enable assessment.')}><span aria-hidden="true">◇</span> Agent roster <span className="nav-state"><i /> {state.agentReady ? 'Worker ready' : 'Configure worker'}</span></button>
        </nav>
        <div className="sidebar-footer"><div className="privacy-mark"><span aria-hidden="true">◉</span><span><strong>Local by default</strong><small>Project signals stay on this device</small></span></div><button className="settings-button" type="button" aria-label="Open settings" onClick={() => setError(`Voice: ${voiceLabel}. Git: ${gitLabel}.`)}>⚙</button></div>
      </aside>
      <main className="main-content" id="main-content">
        <header className="topbar"><div className="breadcrumb"><span>T.A.D.A.S.H.I.</span><span aria-hidden="true">/</span><strong>{state.project?.name ?? 'No workspace selected'}</strong></div><div className="topbar-actions"><span className={`system-state ${pendingApproval ? 'is-warning' : ''}`}><i /> {pulseLabel}</span><button className="icon-button" type="button" aria-label="Refresh project state" onClick={() => void refresh()}>↻</button><button className="avatar-button" type="button" aria-label="Open profile" onClick={() => setError('Profile settings are not part of this first slice.')}>TS</button></div></header>
        <div className="content-grid">
          <div className="center-column">
            <section className="status-banner" aria-label="Project status"><div className="status-visual" aria-hidden="true"><span className="status-core" /><span className="status-ring ring-one" /><span className="status-ring ring-two" /></div><div className="status-copy"><div className="section-kicker">{state.brainReady ? `${state.brainProvider} brain · ${state.brainModel}` : 'Fallback planner'}</div><h1>{state.project ? report : 'Open a project to begin.'}</h1><p>{state.project ? `${state.project.path} · ${latestGit ? `${String(latestGit.payload.changedFiles)} changed files` : 'Git state will appear here'}${latestFile ? ` · Last signal ${String(latestFile.payload.path)}` : ''}` : 'I’ll listen for your direction, then coordinate the right agent.'}</p></div><span className="status-time">{isLoading ? 'Syncing…' : 'Synced now'}</span></section>
            {error && <div className="error-banner" role="alert"><span aria-hidden="true">!</span><p>{error}</p><button type="button" onClick={() => setError(undefined)}>Dismiss</button></div>}
            <ConversationPanel messages={state.messages} disabled={!state.project || isAssessing} assessing={isAssessing} onSubmit={submitMessage} onVoiceError={setError} />
            <TaskBoard tasks={state.tasks} />
          </div>
          <aside className="right-column" aria-label="Project signals"><ApprovalDialog approval={pendingApproval} onResolve={resolveApproval} /><DelegationPanel tier={state.delegateModelTier} onTierChange={(tier) => void window.tadashi.delegateSetTier(tier).then(refresh)} delegatePath={state.commandCodePath} brainReady={state.brainReady} brainModel={state.brainModel} /><AgentRunPanel runs={state.runs} events={state.events} agentReady={state.agentReady} /><section className="signal-list" aria-labelledby="signals-heading"><div className="panel-heading compact"><div><div className="section-kicker">Signals</div><h2 id="signals-heading">Quiet monitoring</h2></div><span className="signal-count">{state.events.length}</span></div><Signal label="File system" value={latestFile ? String(latestFile.payload.path) : 'Watching project changes'} state={latestFile ? 'active' : 'idle'} /><Signal label="Git state" value={latestGit ? `${String(latestGit.payload.branch)} branch` : 'Waiting for repository'} state={latestGit ? 'active' : 'idle'} /><Signal label="Test runner" value="Runs after approved work" state="idle" /></section></aside>
        </div>
      </main>
      <div className="sr-only" role="status" aria-live="polite">{report}</div>
      {setupIncomplete && <SetupWizard onComplete={() => setSetupIncomplete(false)} />}
    </div>
  );
}

function Signal({ label, value, state }: { label: string; value: string; state: 'active' | 'idle' }) {
  return <div className="signal-row"><span className={`signal-icon ${state}`} aria-hidden="true">{state === 'active' ? '↗' : '·'}</span><span><strong>{label}</strong><small>{value}</small></span><span className={`signal-state ${state}`}>{state === 'active' ? 'Live' : 'Ready'}</span></div>;
}
