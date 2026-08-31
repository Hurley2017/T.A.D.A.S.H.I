import { spawn } from 'node:child_process';
import type { ProjectEvent } from '../../contracts/src';
import { EventBus } from './event-bus';

export class TestMonitor {
  constructor(private readonly bus: EventBus, private readonly publish: (event: ProjectEvent) => void) {}

  run(projectId: string, projectPath: string, executable: string, args: string[]): Promise<number> {
    return new Promise((resolve) => {
      const child = spawn(executable, args, { cwd: projectPath, shell: false, windowsHide: true });
      let output = '';
      child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
      child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
      child.on('close', (code) => {
        const event: ProjectEvent = { id: crypto.randomUUID(), projectId, type: 'test.completed', timestamp: new Date().toISOString(), payload: { passed: code === 0, exitCode: code ?? -1, output: output.slice(-4000) } };
        this.publish(event);
        resolve(code ?? -1);
      });
    });
  }
}
