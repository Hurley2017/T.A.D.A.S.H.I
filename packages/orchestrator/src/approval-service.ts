import { randomUUID } from 'node:crypto';
import type { ApprovalRequest, Project, Task } from '../../contracts/src';
import type { TadashiStore } from '../../persistence/src';

export class ApprovalService {
  constructor(private readonly store: TadashiStore) {}

  createForTask(project: Project, task: Task): ApprovalRequest {
    const action = task.action ?? { type: 'agent' as const, summary: `Start ${task.agentId} for this task.`, paths: [project.path], args: [] };
    const approval: ApprovalRequest = {
      id: randomUUID(), projectId: project.id, taskId: task.id, action: action.type === 'observe' ? 'agent' : action.type,
      summary: action.summary,
      command: action.executable ? [action.executable, ...action.args].join(' ') : undefined,
      executable: action.executable,
      args: action.args,
      agentId: task.agentId,
      networkDestination: action.networkDestination,
      estimatedCostUsd: action.estimatedCostUsd,
      workingDirectory: project.path, paths: action.paths.length > 0 ? action.paths : [project.path], status: 'pending', createdAt: new Date().toISOString(),
    };
    this.store.approvals.upsert(approval);
    return approval;
  }

  resolve(approval: ApprovalRequest, decision: 'approved' | 'denied', scope: ApprovalRequest['scope']): ApprovalRequest {
    const resolved = { ...approval, status: decision, scope };
    this.store.approvals.upsert(resolved);
    return resolved;
  }
}
