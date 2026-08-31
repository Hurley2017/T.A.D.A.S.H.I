import type { Task } from '@contracts/index';

type Props = { tasks: Task[] };

const statusLabels: Record<Task['status'], string> = {
  queued: 'Queued',
  'awaiting-approval': 'Awaiting approval',
  running: 'In progress',
  blocked: 'Blocked',
  completed: 'Complete',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function TaskBoard({ tasks }: Props) {
  return (
    <section className="task-section" aria-labelledby="task-heading">
      <div className="panel-heading compact">
        <div>
          <div className="section-kicker">Work queue</div>
          <h2 id="task-heading">Tasks in motion</h2>
        </div>
        <span className="count-badge">{tasks.length || '—'}</span>
      </div>
      {tasks.length === 0 ? (
        <div className="empty-row"><span className="empty-marker">○</span><span>Nothing queued yet</span><small>New instructions appear here</small></div>
      ) : (
        <div className="task-list">
          {tasks.slice(0, 5).map((task) => (
            <article className="task-row" key={task.id}>
              <span className={`task-status status-${task.status}`} aria-label={statusLabels[task.status]}>{task.status === 'completed' ? '✓' : task.status === 'running' ? '◌' : task.status === 'blocked' || task.status === 'failed' ? '!' : '·'}</span>
              <div className="task-copy"><strong>{task.title}</strong><small>{task.agentId} · {statusLabels[task.status]}</small></div>
              <span className="row-chevron" aria-hidden="true">›</span>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
