import type { AgentRun, ProjectEvent } from '@contracts/index';

type Props = { runs: AgentRun[]; events: ProjectEvent[]; agentReady: boolean };

export function AgentRunPanel({ runs, events, agentReady }: Props) {
  const latestRun = runs[0];
  const outputEvents = events.filter((event) => event.type === 'agent.output').slice(-4).reverse();
  return (
    <section className="agent-panel" aria-labelledby="agent-heading">
      <div className="panel-heading compact">
        <div><div className="section-kicker">Agent channel</div><h2 id="agent-heading">What is happening</h2></div>
        <span className={`connection-dot ${latestRun?.status === 'running' ? 'is-active' : ''}`} role="status" title={latestRun?.status ?? 'Standby'} aria-label={latestRun?.status ?? 'Standby'} />
      </div>
      {latestRun ? (
        <div className="run-summary">
          <div className="agent-avatar">{latestRun.agentId.slice(0, 1).toUpperCase()}</div>
          <div><strong>{latestRun.agentId}</strong><small>{runLabel(latestRun.status)}</small></div>
          <span className="run-time">{formatTime(latestRun.startedAt)}</span>
        </div>
      ) : (
        <div className="agent-idle"><span className="idle-line" aria-hidden="true" /><strong>{agentReady ? 'Agent channel ready' : 'No agent configured'}</strong><small>{agentReady ? 'Approve a task to begin a run.' : 'Set TADASHI_CLI_EXECUTABLE to connect a CLI.'}</small></div>
      )}
      <div className="output-window" aria-label="Latest agent output">
        {outputEvents.length === 0 ? <code>$ waiting for the next signal…</code> : outputEvents.map((event) => <code key={event.id}><span>›</span> {String(event.payload.content)}</code>)}
      </div>
    </section>
  );
}

function runLabel(status: AgentRun['status']): string {
  return status === 'running' || status === 'starting' ? 'Working now' : status === 'completed' ? 'Finished cleanly' : status === 'failed' ? 'Needs attention' : status;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}
