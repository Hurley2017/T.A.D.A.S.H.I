import type { AgentConfig } from '../../contracts/src';
import type { AgentAdapter, AgentOutputEvent, AgentRunRequest } from './agent-adapter';

export class ApiAgentAdapter implements AgentAdapter {
  readonly config: AgentConfig;
  private readonly controllers = new Map<string, AbortController>();
  private readonly getApiKey: () => Promise<string | undefined>;

  constructor(config: AgentConfig, getApiKey: () => Promise<string | undefined>) {
    if (config.type !== 'api' || !config.baseUrl || !config.model) throw new Error('An API agent needs a base URL and model.');
    this.config = config;
    this.getApiKey = getApiKey;
  }

  async capabilities() {
    return { streaming: true, toolUse: false, network: true };
  }

  async *run(request: AgentRunRequest): AsyncIterable<AgentOutputEvent> {
    if (!this.config.baseUrl || !this.config.model) throw new Error('Missing API configuration.');
    const controller = new AbortController();
    this.controllers.set(request.runId, controller);
    yield { type: 'started', runId: request.runId };
    try {
      const key = await this.getApiKey();
      const response = await fetch(this.config.baseUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: this.config.protocol === 'anthropic'
          ? { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', ...(key ? { 'x-api-key': key } : {}) }
          : { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify(this.config.protocol === 'anthropic'
          ? { model: this.config.model, max_tokens: 2048, stream: true, messages: [{ role: 'user', content: request.prompt }] }
          : { model: this.config.model, stream: true, messages: [{ role: 'user', content: request.prompt }] }),
      });
      if (!response.ok) throw new Error(`Agent API responded with ${response.status}.`);
      if (!response.body) throw new Error('Agent API returned no stream.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const content = decoder.decode(value, { stream: true });
        if (content) yield { type: 'output', runId: request.runId, stream: 'stdout', content };
      }
      yield { type: 'completed', runId: request.runId, exitCode: 0 };
    } catch (error) {
      if (controller.signal.aborted) yield { type: 'cancelled', runId: request.runId };
      else yield { type: 'failed', runId: request.runId, error: error instanceof Error ? error.message : 'Unknown API error.' };
    } finally {
      this.controllers.delete(request.runId);
    }
  }

  async cancel(runId: string): Promise<void> {
    this.controllers.get(runId)?.abort();
  }
}
