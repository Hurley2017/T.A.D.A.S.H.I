import { describe, it, expect } from 'vitest';
import { CommandCodeAdapter, parseCommandCodeStream } from '../../packages/agents/src/command-code-adapter';

describe('command code NDJSON parser', () => {
  it('parses tool_running frames', () => {
    const frames = parseCommandCodeStream(['{"type":"event","event":{"type":"tool_running","toolName":"edit_file","description":"Update src/auth.ts"}}']);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ type: 'event', event: { type: 'tool_running', toolName: 'edit_file' } });
  });

  it('parses success result frames with session id', () => {
    const frames = parseCommandCodeStream(['{"type":"result","subtype":"success","sessionId":"9f4e1c0a","finalText":"Done.","usage":{"inputTokens":10}}']);
    expect(frames[0]).toMatchObject({ type: 'result', subtype: 'success', sessionId: '9f4e1c0a', finalText: 'Done.' });
  });

  it('parses error result frames', () => {
    const frames = parseCommandCodeStream(['{"type":"result","subtype":"error","error":"Not authenticated"}']);
    expect(frames[0]).toMatchObject({ type: 'result', subtype: 'error', error: 'Not authenticated' });
  });

  it('parses max_turns result frames', () => {
    const frames = parseCommandCodeStream(['{"type":"result","subtype":"max_turns"}']);
    expect(frames[0]).toMatchObject({ type: 'result', subtype: 'max_turns' });
  });

  it('ignores non-JSON lines', () => {
    const frames = parseCommandCodeStream(['warning: this is noise', '{"type":"result","subtype":"success"}']);
    expect(frames).toHaveLength(1);
  });
});

describe('command code adapter construction', () => {
  it('rejects non-command-code configs', () => {
    expect(() => new CommandCodeAdapter({ id: 'x', name: 'x', type: 'cli', executable: 'cmd', args: [], protocol: 'openai-compatible', enabled: true })).toThrow(/command-code/i);
  });
});
