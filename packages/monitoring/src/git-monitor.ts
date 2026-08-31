import { spawn } from 'node:child_process';
import type { ProjectEvent } from '../../contracts/src';
import { EventBus } from './event-bus';

export class GitMonitor {
  private timer?: NodeJS.Timeout;
  private lastSnapshot?: string;

  constructor(private readonly bus: EventBus, private readonly publish: (event: ProjectEvent) => void) {}

  start(projectId: string, projectPath: string, intervalMs = 10_000): void {
    this.stop();
    const poll = () => {
      const child = spawn('git', ['status', '--porcelain=v2', '--branch'], { cwd: projectPath, shell: false, windowsHide: true });
      let output = '';
      child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
      child.on('error', () => undefined);
      child.on('close', (code) => {
        if (code !== 0) return;
        if (output === this.lastSnapshot) return;
        this.lastSnapshot = output;
        const lines = output.split(/\r?\n/).filter(Boolean);
        const event: ProjectEvent = { id: crypto.randomUUID(), projectId, type: 'git.changed', timestamp: new Date().toISOString(), payload: { branch: lines.find((line) => line.startsWith('# branch.head'))?.split(' ').at(-1) ?? 'unknown', changedFiles: lines.filter((line) => !line.startsWith('#')).length } };
        this.publish(event);
      });
    };
    poll();
    this.timer = setInterval(poll, intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.lastSnapshot = undefined;
  }
}
