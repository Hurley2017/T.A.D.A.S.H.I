import type { ModelClient } from '../model-client';
import type { ModelCompletion, ModelEvent, ModelRequest } from '../schemas';
import { SseParser } from '../sse-parser';

export class AnthropicClient implements ModelClient {
  readonly provider = 'anthropic';
  private readonly controllers = new Map<string, AbortController>();

  constructor(readonly model: string, private readonly endpoint: string, private readonly apiKey: string) {}

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
      const system = request.messages.find((message) => message.role === 'system')?.content;
      const messages = request.messages.filter((message) => message.role !== 'system');
      const response = await fetch(this.endpoint, {
        method: 'POST', signal: controller.signal,
        headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': this.apiKey },
        body: JSON.stringify({ model: this.model, system, messages, stream: true, max_tokens: request.maxTokens ?? 2048, temperature: request.temperature }),
      });
      if (!response.ok) throw new Error(`Anthropic endpoint returned HTTP ${response.status}.`);
      if (!response.body) throw new Error('Anthropic endpoint returned no stream.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = new SseParser();
      let finished = false;
      while (!finished) {
        const { value, done } = await reader.read();
        const chunk = decoder.decode(value, { stream: !done });
        for (const frame of [...parser.push(chunk), ...(done ? parser.flush() : [])]) {
          const event = parseAnthropicFrame(request.requestId, frame.event, frame.data);
          if (event) {
            yield event;
            if (event.type === 'completed') finished = true;
          }
        }
        if (done) break;
      }
      if (!finished) yield { type: 'completed', requestId: request.requestId };
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Anthropic request timed out or was cancelled.');
      throw error instanceof Error ? error : new Error('Anthropic request failed.');
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(request.requestId);
    }
  }

  async cancel(requestId: string): Promise<void> {
    this.controllers.get(requestId)?.abort();
  }
}

function parseAnthropicFrame(requestId: string, eventName: string | undefined, data: string): ModelEvent | undefined {
  try {
    const parsed = JSON.parse(data) as { type?: string; delta?: { type?: string; text?: string; stop_reason?: string }; message?: { usage?: { input_tokens?: number; output_tokens?: number } } };
    if (eventName === 'content_block_delta' && parsed.delta?.text) return { type: 'text.delta', requestId, text: parsed.delta.text };
    if (eventName === 'message_delta' || parsed.type === 'message_stop') return { type: 'completed', requestId, finishReason: parsed.delta?.stop_reason, usage: parsed.message?.usage ? { inputTokens: parsed.message.usage.input_tokens, outputTokens: parsed.message.usage.output_tokens } : undefined };
    return undefined;
  } catch {
    throw new Error('Anthropic endpoint returned malformed SSE data.');
  }
}
