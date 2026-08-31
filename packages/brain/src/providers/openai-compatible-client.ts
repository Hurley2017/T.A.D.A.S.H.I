import type { ModelClient } from '../model-client';
import type { ModelCompletion, ModelEvent, ModelRequest } from '../schemas';
import { SseParser } from '../sse-parser';

export class OpenAiCompatibleClient implements ModelClient {
  readonly provider = 'openai-compatible';
  private readonly controllers = new Map<string, AbortController>();

  constructor(readonly model: string, private readonly endpoint: string, private readonly apiKey?: string) {}

  async complete(request: ModelRequest): Promise<ModelCompletion> {
    let text = '';
    let completion: ModelCompletion = { requestId: request.requestId, text };
    for await (const event of this.stream(request)) {
      if (event.type === 'text.delta') text += event.text;
      if (event.type === 'completed') completion = { ...completion, text, finishReason: event.finishReason, usage: event.usage };
    }
    return completion;
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    const controller = new AbortController();
    this.controllers.set(request.requestId, controller);
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST', signal: controller.signal,
        headers: { 'content-type': 'application/json', ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
        body: JSON.stringify({ model: this.model, messages: request.messages, stream: true, temperature: request.temperature, max_tokens: request.maxTokens }),
      });
      if (!response.ok) throw new Error(`Model endpoint returned HTTP ${response.status}.`);
      if (!response.body) throw new Error('Model endpoint returned no stream.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = new SseParser();
      let finished = false;
      while (!finished) {
        const { value, done } = await reader.read();
        const chunk = decoder.decode(value, { stream: !done });
        for (const frame of [...parser.push(chunk), ...(done ? parser.flush() : [])]) {
          const event = parseOpenAiFrame(request.requestId, frame.data);
          if (event) {
            yield event;
            if (event.type === 'completed') finished = true;
          }
        }
        if (done) break;
      }
      if (!finished) yield { type: 'completed', requestId: request.requestId };
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Model request timed out or was cancelled.');
      throw error instanceof Error ? error : new Error('Model request failed.');
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(request.requestId);
    }
  }

  async cancel(requestId: string): Promise<void> {
    this.controllers.get(requestId)?.abort();
  }
}

function parseOpenAiFrame(requestId: string, data: string): ModelEvent | undefined {
  if (data === '[DONE]') return { type: 'completed', requestId, finishReason: 'stop' };
  try {
    const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string; tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const choice = parsed.choices?.[0];
    const text = choice?.delta?.content;
    if (text) return { type: 'text.delta', requestId, text };
    const tool = choice?.delta?.tool_calls?.[0]?.function;
    if (tool?.name) return { type: 'tool.call', requestId, name: tool.name, arguments: tool.arguments ?? '' };
    if (choice?.finish_reason || parsed.usage) return { type: 'completed', requestId, finishReason: choice?.finish_reason, usage: parsed.usage ? { inputTokens: parsed.usage.prompt_tokens, outputTokens: parsed.usage.completion_tokens } : undefined };
    return undefined;
  } catch {
    throw new Error('Model endpoint returned malformed SSE data.');
  }
}
