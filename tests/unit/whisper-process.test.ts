import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const spawned: string[][] = [];

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    mkdtemp: vi.fn(async () => 'C:\\temp\\tadashi-whisper-test'),
    writeFile: vi.fn(async () => undefined),
    readFile: vi.fn(async () => 'hello tadashi'),
    rm: vi.fn(async () => undefined),
  };
});

vi.mock('node:child_process', () => ({
  spawn: (executable: string, args: string[]) => {
    spawned.push([executable, ...args]);
    const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
    child.stderr = new EventEmitter();
    queueMicrotask(() => child.emit('close', 0));
    return child;
  },
}));

import { WhisperProcess } from '../../packages/voice/src';

describe('WhisperProcess', () => {
  it('passes the model flag when a model path is configured', async () => {
    const process = new WhisperProcess('C:\\whisper\\whisper-cli.exe', 'C:\\whisper\\ggml-base.en.bin');
    const transcript = await process.transcribe(new Uint8Array([1, 2, 3]), 'audio/wav');
    expect(transcript).toBe('hello tadashi');
    expect(spawned[0]).toEqual(['C:\\whisper\\whisper-cli.exe', '-f', 'C:\\temp\\tadashi-whisper-test\\input.wav', '-otxt', '-of', 'C:\\temp\\tadashi-whisper-test\\transcript', '-m', 'C:\\whisper\\ggml-base.en.bin']);
  });
});
