import { describe, expect, it } from 'vitest';
import { summarizeProgress } from '../../packages/orchestrator/src';
import type { Task } from '../../packages/contracts/src';

const task: Task = {
  id: 'task-1', projectId: 'project-1', intentId: 'intent-1', title: 'Inspect failure', description: 'Inspect failure', agentId: 'local-cli', status: 'running', dependsOn: [], action: { type: 'agent', summary: 'Start agent', paths: [], args: [] }, expectedEvidence: [], retryCount: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('ProgressReporter', () => {
  it('summarizes active work without exposing raw event noise', () => {
    expect(summarizeProgress([task], [{ id: 'event-1', projectId: 'project-1', type: 'agent.started', timestamp: '2026-01-01T00:00:00.000Z', payload: {} }])).toContain('agent run');
  });

  it('prioritizes blockers over active work', () => {
    expect(summarizeProgress([{ ...task, status: 'failed' }], [])).toContain('need attention');
  });
});
