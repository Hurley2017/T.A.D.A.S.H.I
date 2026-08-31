import { randomUUID } from 'node:crypto';
import type { Intent, Task } from '../../contracts/src';

export class TaskPlanner {
  create(intent: Intent, agentId = 'local-cli'): Task[] {
    const createdAt = new Date().toISOString();
    return [{ id: randomUUID(), projectId: intent.projectId, intentId: intent.id, title: intent.objective.slice(0, 54), description: intent.objective, status: 'awaiting-approval', agentId, dependsOn: [], action: { type: 'agent', summary: `Start ${agentId} for this task.`, paths: [], args: [] }, expectedEvidence: [], retryCount: 0, createdAt, updatedAt: createdAt }];
  }
}
