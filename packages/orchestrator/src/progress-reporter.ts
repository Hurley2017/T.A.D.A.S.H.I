import type { ProjectEvent, Task } from '../../contracts/src';

export function summarizeProgress(tasks: Task[], events: ProjectEvent[]): string {
  const running = tasks.filter((task) => task.status === 'running').length;
  const blocked = tasks.filter((task) => task.status === 'blocked' || task.status === 'failed').length;
  const completed = tasks.filter((task) => task.status === 'completed').length;
  const latest = events.at(-1);
  if (blocked) return `${blocked} task${blocked === 1 ? '' : 's'} need attention.`;
  if (running) return `${running} agent run${running === 1 ? '' : 's'} active. Latest signal: ${latest?.type ?? 'starting'}.`;
  if (completed) return `${completed} task${completed === 1 ? '' : 's'} completed.`;
  return 'No active work. I am ready for your next instruction.';
}
