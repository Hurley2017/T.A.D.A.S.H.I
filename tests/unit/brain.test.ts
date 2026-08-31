import { describe, expect, it } from 'vitest';
import { BrainService, SseParser, TADASHI_PERSONA, type ModelClient } from '../../packages/brain/src';
import type { ModelCompletion, ModelEvent, ModelRequest } from '../../packages/brain/src';
import type { BrainContext } from '../../packages/brain/src';

const context: BrainContext = {
  project: { id: 'project-1', name: 'demo', path: 'C:\\projects\\demo' },
  recentMessages: [], tasks: [], recentEvents: [], agents: [{ id: 'fake-agent', name: 'Fake agent', type: 'cli', streaming: true, toolUse: true, network: false }],
};

class FakeModel implements ModelClient {
  provider = 'test';
  model = 'test-model';
  constructor(private readonly text: string) {}
  async complete(request: ModelRequest): Promise<ModelCompletion> { return { requestId: request.requestId, text: this.text }; }
  async *stream(_request: ModelRequest): AsyncIterable<ModelEvent> { yield { type: 'completed', requestId: 'test' }; }
  async cancel() { return undefined; }
}

describe('brain core', () => {
  it('parses a structured LLM plan and includes the onboard-AI persona', async () => {
    const brain = new BrainService(new FakeModel(JSON.stringify({ kind: 'plan', response: 'I have a controlled plan.', tasks: [{ id: 'task-1', title: 'Inspect tests', description: 'Inspect the failing tests.', agentId: 'fake-agent', dependsOn: [], action: { type: 'agent', summary: 'Start the worker.', paths: [], args: [] }, expectedEvidence: ['Test output'] }] })));
    const decision = await brain.decide('Find the failing test', context);
    expect(decision.kind).toBe('plan');
    if (decision.kind !== 'plan') throw new Error('Expected a plan decision.');
    expect(decision.tasks[0].agentId).toBe('fake-agent');
    expect(TADASHI_PERSONA).toContain('calm, concise, technically exact');
  });

  it('rejects a malformed decision before execution', async () => {
    const brain = new BrainService(new FakeModel('{"kind":"plan","response":"missing tasks"}'));
    await expect(brain.decide('Do work', context)).rejects.toThrow();
  });

  it('reassembles split SSE frames', () => {
    const parser = new SseParser();
    expect(parser.push('event: message\ndata: {"a":')).toEqual([]);
    expect(parser.push('1}\n\n')).toEqual([{ event: 'message', data: '{"a":1}' }]);
  });
});
