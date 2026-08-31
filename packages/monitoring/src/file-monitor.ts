import chokidar, { type FSWatcher } from 'chokidar';
import { relative } from 'node:path';
import type { ProjectEvent } from '../../contracts/src';
import { EventBus } from './event-bus';

const ignored = [/(^|[\\/])\.git([\\/]|$)/, /(^|[\\/])node_modules([\\/]|$)/, /(^|[\\/])(dist|build|release)([\\/]|$)/];

export class FileMonitor {
  private watcher?: FSWatcher;

  constructor(private readonly bus: EventBus, private readonly publish: (event: ProjectEvent) => void) {}

  start(projectId: string, projectPath: string): void {
    this.stop();
    this.watcher = chokidar.watch(projectPath, { ignored, ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 50 } });
    const changed = (path: string, change: 'added' | 'changed' | 'removed') => {
      const event: ProjectEvent = { id: crypto.randomUUID(), projectId, type: 'file.changed', timestamp: new Date().toISOString(), payload: { change, path: relative(projectPath, path) } };
      this.publish(event);
    };
    this.watcher.on('add', (path) => changed(path, 'added')).on('change', (path) => changed(path, 'changed')).on('unlink', (path) => changed(path, 'removed'));
  }

  stop(): void {
    void this.watcher?.close();
    this.watcher = undefined;
  }
}

export function summarizeFileChanges(events: ProjectEvent[]): string {
  const paths = events.filter((event) => event.type === 'file.changed').map((event) => String(event.payload.path));
  const unique = [...new Set(paths)];
  return unique.length === 0 ? 'No file changes detected.' : `${unique.length} file${unique.length === 1 ? '' : 's'} changed: ${unique.slice(0, 3).join(', ')}${unique.length > 3 ? '…' : ''}`;
}
