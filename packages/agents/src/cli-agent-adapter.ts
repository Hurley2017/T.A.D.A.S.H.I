import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { AgentConfig } from '../../contracts/src';
import type { AgentAdapter, AgentOutputEvent, AgentRunRequest } from './agent-adapter';

export class CliAgentAdapter implements AgentAdapter {
  readonly config: AgentConfig;
  private readonly processes = new Map<string, ChildProcessWithoutNullStreams>();
  private readonly cancelledRuns = new Set<string>();

  constructor(config: AgentConfig) {
    if (config.type !== 'cli' || !config.executable) throw new Error('A CLI agent needs an executable.');
    this.config = config;
  }

  async capabilities() {
    return { streaming: true, toolUse: true, network: false };
  }

  async *run(request: AgentRunRequest): AsyncIterable<AgentOutputEvent> {
    if (!this.config.executable) throw new Error('Missing CLI executable.');
    const args = [...this.config.args, request.prompt];
    if (request.workspace !== request.projectPath) throw new Error('CLI execution must start at the selected project root.');
    const child = spawn(this.config.executable, args, {
      cwd: request.workspace,
      shell: false,
      windowsHide: true,
      env: { ...process.env, TADASHI_RUN_ID: request.runId },
    });
    this.processes.set(request.runId, child);
    yield { type: 'started', runId: request.runId };

    const queue: AgentOutputEvent[] = [];
    let finished = false;
    let failure: string | undefined;
    let timedOut = false;
    const push = (event: AgentOutputEvent) => queue.push(event);
    child.stdout.on('data', (chunk: Buffer) => push({ type: 'output', runId: request.runId, stream: 'stdout', content: chunk.toString() }));
    child.stderr.on('data', (chunk: Buffer) => push({ type: 'output', runId: request.runId, stream: 'stderr', content: chunk.toString() }));
    child.on('error', (error) => { if (!this.cancelledRuns.has(request.runId)) failure = error.message; finished = true; });
    child.on('close', (code) => { if (!this.cancelledRuns.has(request.runId) && code !== 0) failure = failure ?? `Agent exited with code ${code ?? 'unknown'}.`; finished = true; });

    const timeout = setTimeout(() => { timedOut = true; child.kill(); }, request.timeoutMs ?? 10 * 60 * 1000);
    try {
      while (!finished || queue.length > 0) {
        const next = queue.shift();
        if (next) {
          yield next;
        } else if (!finished) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
      if (this.cancelledRuns.has(request.runId)) yield { type: 'cancelled', runId: request.runId };
      else if (timedOut) yield { type: 'failed', runId: request.runId, error: 'Agent timed out.' };
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
