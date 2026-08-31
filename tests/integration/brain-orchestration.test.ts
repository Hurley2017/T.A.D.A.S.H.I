import { describe, expect, it } from 'vitest';
import type { AgentAdapter, AgentRunRequest, AgentOutputEvent } from '../../packages/agents/src';
import { BrainService, type ModelClient, type ModelCompletion, type ModelEvent, type ModelRequest } from '../../packages/brain/src';
import { EventBus } from '../../packages/monitoring/src';
import { createMemoryStore } from '../../packages/persistence/src';
import { Orchestrator } from '../../packages/orchestrator/src';
import type { AgentConfig, Project } from '../../packages/contracts/src';

const project: Project = { id: 'brain-project', name: 'brain-demo', path: 'C:\\projects\\brain-demo', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
const agentConfig: AgentConfig = { id: 'fake-agent', name: 'Fake agent', type: 'cli', executable: 'fake', args: [], protocol: 'openai-compatible', enabled: true };

class FakeModel implements ModelClient {
  provider = 'test';
  model = 'brain-test';
  async complete(request: ModelRequest): Promise<ModelCompletion> {
    return {
      requestId: request.requestId,
      text: JSON.stringify({ kind: 'plan', response: 'I have split the work into a safe inspection and a focused fix.', tasks: [
        { id: 'inspect', title: 'Inspect the failing test', description: 'Inspect the failing test and capture evidence.', agentId: 'fake-agent', dependsOn: [], action: { type: 'agent', summary: 'Run inspection agent.', paths: [], args: [] }, expectedEvidence: ['Test output'] },
        { id: 'fix', title: 'Prepare the fix', description: 'Prepare a fix using the inspection evidence.', agentId: 'fake-agent', dependsOn: ['inspect'], action: { type: 'agent', summary: 'Run fix agent.', paths: [], args: [] }, expectedEvidence: ['Changed file and passing test'] },
      ] }),
    };
  }
  async *stream(_request: ModelRequest): AsyncIterable<ModelEvent> { yield { type: 'completed', requestId: 'test' }; }
  async cancel() { return undefined; }
}

class FakeAgent implements AgentAdapter {
  config = agentConfig;
  async capabilities() { return { streaming: true, toolUse: true, network: false }; }
  async *run(request: AgentRunRequest): AsyncIterable<AgentOutputEvent> { yield { type: 'started', runId: request.runId }; yield { type: 'completed', runId: request.runId, exitCode: 0 }; }
  async cancel() { return undefined; }
}

describe('brain orchestration', () => {
  it('uses the LLM brain to create a dependency-aware plan', async () => {
    const store = createMemoryStore();
    const orchestrator = new Orchestrator({ store, bus: new EventBus(), agents: new Map([['fake-agent', new FakeAgent()]]), brain: new BrainService(new FakeModel()), defaultAgentId: 'fake-agent' });
    const result = await orchestrator.submit(project, 'Investigate the failing onboarding test and prepare a fix');

    expect(result.brainMode).toBe('llm');
    expect(result.decisionKind).toBe('plan');
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks?.[1].dependsOn).toEqual(['inspect']);
    expect(store.brainDecisions.list(project.id)).toHaveLength(1);
    expect(store.messages.list(project.id).at(-1)?.content).toContain('split the work');
  });
});
