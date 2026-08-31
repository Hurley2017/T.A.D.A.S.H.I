import { describe, expect, it, vi } from 'vitest';
import { AnthropicClient, OpenAiCompatibleClient } from '../../packages/brain/src';

function streamFrom(...chunks: string[]) {
  const encoder = new TextEncoder();
  const values = chunks.map((chunk) => encoder.encode(chunk));
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const value = values.shift();
      if (value) controller.enqueue(value);
      else controller.close();
    },
  });
}

describe('brain providers', () => {
  it('normalizes split OpenAI-compatible text deltas', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(streamFrom('data: {"choices":[{"delta":{"content":"Hel', 'lo"}}]}\n\n', 'data: [DONE]\n\n'), { status: 200 })));
    const client = new OpenAiCompatibleClient('test-model', 'http://localhost/v1/chat/completions');
    const completion = await client.complete({ requestId: 'request-1', timeoutMs: 1000, messages: [{ role: 'user', content: 'Hi' }] });
    expect(completion.text).toBe('Hello');
    vi.unstubAllGlobals();
  });

  it('sends Anthropic system and API headers', async () => {
    const fetchMock = vi.fn(async () => new Response(streamFrom('event: content_block_delta\ndata: {"delta":{"text":"Ready"}}\n\n', 'event: message_stop\ndata: {"type":"message_stop"}\n\n'), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new AnthropicClient('claude-test', 'http://localhost/v1/messages', 'secret');
    const completion = await client.complete({ requestId: 'request-2', timeoutMs: 1000, messages: [{ role: 'system', content: 'Be concise.' }, { role: 'user', content: 'Status?' }] });
    expect(completion.text).toBe('Ready');
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const request = call[1];
    expect(request.headers).toMatchObject({ 'x-api-key': 'secret', 'anthropic-version': '2023-06-01' });
    vi.unstubAllGlobals();
  });
});
