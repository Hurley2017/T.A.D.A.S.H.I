import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createStore } from '../../packages/persistence/src';
import type { Project } from '../../packages/contracts/src';

const project: Project = {
  id: 'project-persisted', name: 'demo', path: 'C:\\projects\\demo',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('local persistence', () => {
  it('round-trips projects and events through an atomic state file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tadashi-test-'));
    const filePath = join(directory, 'state.json');
    try {
      const first = createStore(filePath);
      first.projects.upsert(project);
      first.events.add({ id: 'event-1', projectId: project.id, type: 'git.changed', timestamp: '2026-01-01T00:00:01.000Z', payload: { changedFiles: 1 } });
      first.close();

      const second = createStore(filePath);
      expect(second.projects.list()).toEqual([project]);
      expect(second.events.list(project.id)[0].payload.changedFiles).toBe(1);
      expect(JSON.parse(await readFile(filePath, 'utf8')).projects[0].name).toBe('demo');
      second.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
