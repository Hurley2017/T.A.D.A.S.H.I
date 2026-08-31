import { describe, expect, it } from 'vitest';
import type { AgentAdapter, AgentOutputEvent, AgentRunRequest } from '../../packages/agents/src';
import { EventBus } from '../../packages/monitoring/src';
import { createMemoryStore } from '../../packages/persistence/src';
import { Orchestrator } from '../../packages/orchestrator/src';
import type { AgentConfig, Project } from '../../packages/contracts/src';

const project: Project = {
  id: 'project-1', name: 'demo', path: 'C:\\projects\\demo',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

const agentConfig: AgentConfig = {
  id: 'fake-agent', name: 'Fake agent', type: 'cli', executable: 'fake', args: [], protocol: 'openai-compatible', enabled: true,
};

class FakeAgent implements AgentAdapter {
  config = agentConfig;
  async capabilities() { return { streaming: true, toolUse: true, network: false }; }
  async *run(request: AgentRunRequest): AsyncIterable<AgentOutputEvent> {
    yield { type: 'started', runId: request.runId };
    yield { type: 'output', runId: request.runId, stream: 'stdout', content: 'Inspecting the project.' };
    yield { type: 'completed', runId: request.runId, exitCode: 0 };
  }
  async cancel() { return undefined; }
}

describe('Orchestrator', () => {
  it('asks for clarification when a request is too vague', async () => {
    const store = createMemoryStore();
    const bus = new EventBus();
    const orchestrator = new Orchestrator({ store, bus, agents: new Map(), defaultAgentId: 'fake-agent' });

    const result = await orchestrator.submit(project, 'help');

    expect(result.task).toBeUndefined();
    expect(result.question).toContain('What would you like');
    expect(store.events.list(project.id).map((event) => event.type)).toContain('clarification.requested');
  });

  it('creates an approval-ready task and executes a configured agent', async () => {
    const store = createMemoryStore();
    const bus = new EventBus();
    const events: string[] = [];
    bus.subscribe((event) => events.push(event.type));
    const orchestrator = new Orchestrator({ store, bus, agents: new Map([['fake-agent', new FakeAgent()]]), defaultAgentId: 'fake-agent' });

    const result = await orchestrator.submit(project, 'Inspect the onboarding flow and explain the failing test');
    expect(result.task?.status).toBe('awaiting-approval');

    await orchestrator.execute(project, result.task!);

    expect(store.tasks.list(project.id)[0].status).toBe('completed');
    expect(store.runs.list(project.id)[0].status).toBe('completed');
    expect(events).toContain('agent.output');
    expect(events).toContain('agent.completed');
  });

  it('blocks a task when its agent is unavailable', async () => {
    const store = createMemoryStore();
    const orchestrator = new Orchestrator({ store, bus: new EventBus(), agents: new Map(), defaultAgentId: 'missing-agent' });
    const result = await orchestrator.submit(project, 'Inspect the onboarding flow and explain the failing test');

    await expect(orchestrator.execute(project, result.task!)).rejects.toThrow('No enabled agent');
    expect(store.tasks.list(project.id)[0].status).toBe('blocked');
  });
});
