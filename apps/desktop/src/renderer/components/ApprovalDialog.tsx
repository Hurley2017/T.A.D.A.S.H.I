import type { ApprovalRequest } from '@contracts/index';

type Props = { approval?: ApprovalRequest; onResolve: (decision: 'approved' | 'denied') => Promise<void> };

export function ApprovalDialog({ approval, onResolve }: Props) {
  if (!approval) return <section className="approval-panel approval-empty" aria-labelledby="approval-heading"><div className="section-kicker">Safety gate</div><h2 id="approval-heading">No decisions waiting.</h2><p>I will pause before writes, commands, network calls, or Git changes.</p></section>;
  return (
    <section className="approval-panel" aria-labelledby="approval-heading">
      <div className="section-kicker">Safety gate · review needed</div>
      <h2 id="approval-heading">Before I route this</h2>
      <p className="approval-summary">{approval.summary}</p>
      <dl className="approval-details">
        <div><dt>Action</dt><dd>{approval.action}</dd></div>
        <div><dt>Working directory</dt><dd className="mono">{approval.workingDirectory}</dd></div>
        <div><dt>Scope</dt><dd>{approval.paths.join(', ')}</dd></div>
      </dl>
      {approval.command && <pre className="approval-command"><code>{approval.command}</code></pre>}
      <div className="approval-actions">
        <button className="deny-button" type="button" onClick={() => void onResolve('denied')}>Keep paused</button>
        <button className="approve-button" type="button" onClick={() => void onResolve('approved')}>Approve once <span aria-hidden="true">→</span></button>
      </div>
      <small className="approval-note">Approval applies to this task only. You can change the policy later.</small>
    </section>
  );
}
