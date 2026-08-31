import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { AgentConfig } from '../../contracts/src';
import type { AgentAdapter, AgentOutputEvent, AgentRunRequest } from './agent-adapter';

/** Parsed NDJSON frame from `cmd --output-format json`. */
export interface CommandCodeAgentEvent {
  type: string;
  toolName?: string;
  description?: unknown;
  [key: string]: unknown;
}

export type CommandCodeStreamEvent =
  | { type: 'event'; event: CommandCodeAgentEvent }
  | { type: 'result'; subtype: 'success' | 'error' | 'max_turns'; sessionId?: string; finalText?: string; error?: string; usage?: { inputTokens?: number; outputTokens?: number } };

/** Parses newline-delimited JSON frames from a command-code headless run. */
export function parseCommandCodeStream(lines: string[]): CommandCodeStreamEvent[] {
  const frames: CommandCodeStreamEvent[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as { type?: unknown; event?: unknown; subtype?: unknown; sessionId?: unknown; finalText?: unknown; error?: unknown; usage?: unknown };
      if (parsed.type === 'event') {
        if (typeof parsed.event === 'object' && parsed.event) frames.push({ type: 'event', event: parsed.event as CommandCodeAgentEvent });
      } else if (parsed.type === 'result') {
        const subtype = parsed.subtype;
        if (subtype === 'success' || subtype === 'error' || subtype === 'max_turns') {
          frames.push({
            type: 'result',
            subtype,
            sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : undefined,
            finalText: typeof parsed.finalText === 'string' ? parsed.finalText : undefined,
            error: typeof parsed.error === 'string' ? parsed.error : undefined,
            usage: typeof parsed.usage === 'object' && parsed.usage ? parsed.usage as { inputTokens?: number; outputTokens?: number } : undefined,
          });
        }
      }
    } catch {
      // Ignore non-JSON lines (warnings etc.) so a noisy stream never kills the run.
    }
  }
  return frames;
}

export class CommandCodeAdapter implements AgentAdapter {
  readonly config: AgentConfig;
  private readonly processes = new Map<string, ChildProcessWithoutNullStreams>();
  private readonly cancelledRuns = new Set<string>();

  constructor(config: AgentConfig) {
    if (config.type !== 'cli' || !config.executable) throw new Error('A Command Code agent needs an executable.');
    if (config.delegate !== 'command-code') throw new Error('This adapter is only valid for the command-code delegate.');
    this.config = config;
  }

  async capabilities() {
    return { streaming: true, toolUse: true, network: true };
  }

  async *run(request: AgentRunRequest): AsyncIterable<AgentOutputEvent> {
    const executable = this.config.executable;
    if (!executable) throw new Error('Missing Command Code executable.');

    const args = [...this.config.args, '-p', request.prompt, '--output-format', 'json', '--skip-onboarding', '-t'];
    if (request.model) args.push('-m', request.model);
    if (request.sessionId) args.push('--resume', request.sessionId);
    if (request.allowWrites) args.push('--yolo');

    yield { type: 'started', runId: request.runId };

    const child = spawn(executable, args, {
      cwd: request.workspace,
      shell: /\.(cmd|ps1)$/i.test(executable),
      windowsHide: true,
      env: { ...process.env, TADASHI_RUN_ID: request.runId, COMMAND_CODE_HEADLESS: '1' },
    });
    this.processes.set(request.runId, child);

    const queue: AgentOutputEvent[] = [];
    let finished = false;
    let failure: string | undefined;
    let timedOut = false;
    let sessionId: string | undefined;
    let stdoutRemainder = '';
    let stderrRemainder = '';

    let terminalReceived = false;
    const push = (event: AgentOutputEvent) => queue.push(event);
    const feedLine = (line: string) => {
      for (const frame of parseCommandCodeStream([line])) {
        if (frame.type === 'event') {
          const { type, toolName, description } = frame.event;
          if (type === 'tool_running' && toolName) {
            push({ type: 'output', runId: request.runId, stream: 'stdout', content: `▶ ${toolName} — ${description ?? ''}` });
          } else if (type === 'tool_result' || type === 'text' || type === 'reasoning') {
            push({ type: 'output', runId: request.runId, stream: 'stdout', content: typeof description === 'string' ? description : '' });
          }
        } else {
          if (frame.sessionId) {
            sessionId = frame.sessionId;
            push({ type: 'output', runId: request.runId, stream: 'stderr', content: `session:${frame.sessionId}` });
          }
          if (frame.subtype === 'success') {
            if (frame.finalText && !terminalReceived) push({ type: 'output', runId: request.runId, stream: 'stdout', content: frame.finalText });
            if (!terminalReceived) push({ type: 'completed', runId: request.runId, exitCode: 0 });
            terminalReceived = true;
          } else if (frame.subtype === 'error') {
            if (!terminalReceived) push({ type: 'failed', runId: request.runId, error: frame.error ?? 'Command Code run failed.' });
            terminalReceived = true;
          } else if (frame.subtype === 'max_turns') {
            if (!terminalReceived) push({ type: 'failed', runId: request.runId, error: 'Maximum turns reached before the task was completed.' });
            terminalReceived = true;
          }
        }
      }
    };

    child.stdout.on('data', (chunk: Buffer) => {
      const text = stdoutRemainder + chunk.toString();
      const lines = text.split('\n');
      stdoutRemainder = lines.pop() ?? '';
      for (const line of lines) feedLine(line);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const text = stderrRemainder + chunk.toString();
      const lines = text.split('\n');
      stderrRemainder = lines.pop() ?? '';
      for (const line of lines) {
        if (line.includes('session: ')) sessionId = line.split('session: ')[1].trim();
        else if (line) push({ type: 'output', runId: request.runId, stream: 'stderr', content: line });
      }
    });
    child.on('error', (error) => { if (!this.cancelledRuns.has(request.runId)) failure = error.message; finished = true; });
    child.on('close', (code) => {
      if (!this.cancelledRuns.has(request.runId)) {
        if (code !== 0 && !terminalReceived) {
          const map: Record<number, string> = { 3: 'Not authenticated with Command Code. Log in first.', 4: 'Permission denied by Command Code.', 5: 'Rate limit reached. Try again shortly.', 8: 'Maximum turns reached.', 130: 'Interrupted.' };
          failure = failure ?? map[code ?? 0] ?? `Command Code exited with code ${code ?? 'unknown'}.`;
        }
      }
      finished = true;
    });

    const timeout = setTimeout(() => { timedOut = true; child.kill(); }, request.timeoutMs ?? 30 * 60 * 1000);
    try {
      while (!finished || queue.length > 0) {
        const next = queue.shift();
        if (next) yield next;
        else if (!finished) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      if (this.cancelledRuns.has(request.runId)) yield { type: 'cancelled', runId: request.runId };
      else if (timedOut) yield { type: 'failed', runId: request.runId, error: 'Command Code agent timed out.' };
      else if (failure) yield { type: 'failed', runId: request.runId, error: failure };
      else yield { type: 'completed', runId: request.runId, exitCode: 0 };
    } finally {
      clearTimeout(timeout);
      this.processes.delete(request.runId);
      this.cancelledRuns.delete(request.runId);
    }
  }

  async cancel(runId: string): Promise<void> {
    const process = this.processes.get(runId);
    if (!process) return;
    this.cancelledRuns.add(runId);
    process.kill();
  }
}
