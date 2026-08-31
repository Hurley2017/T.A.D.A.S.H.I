import { randomUUID } from 'node:crypto';
import type { Intent } from '../../contracts/src';

export class IntentService {
  extract(projectId: string, sourceMessageId: string, content: string): Intent {
    const objective = content.trim();
    return {
      id: randomUUID(), projectId, sourceMessageId, objective,
      constraints: [], requestedAutonomy: 'propose', ambiguities: objective.length < 12 ? ['Please describe the task in a little more detail.'] : [],
      createdAt: new Date().toISOString(),
    };
  }
}
