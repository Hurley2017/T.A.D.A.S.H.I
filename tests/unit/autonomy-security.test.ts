import { describe, it, expect } from 'vitest';
import { GitService } from '../../packages/orchestrator/src/git-service';
import { defaultAutonomyPolicy, evaluateAutonomyRequest } from '../../packages/orchestrator/src/autonomy-policy';

describe('autonomy policy', () => {
  it('blocks force operations by default', () => {
    const result = evaluateAutonomyRequest(defaultAutonomyPolicy, { kind: 'force_operation', description: 'force push main' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/force/i);
  });

  it('blocks git push by default', () => {
    const result = evaluateAutonomyRequest(defaultAutonomyPolicy, { kind: 'git_push', description: 'push branch' });
    expect(result.allowed).toBe(false);
  });

  it('blocks project delete by default', () => {
    const result = evaluateAutonomyRequest(defaultAutonomyPolicy, { kind: 'project_delete', description: 'remove project' });
    expect(result.allowed).toBe(false);
  });

  it('allows project creation without confirmation', () => {
    const result = evaluateAutonomyRequest(defaultAutonomyPolicy, { kind: 'project_create', description: 'new project' });
    expect(result.allowed).toBe(true);
  });
});

describe('git service safety', () => {
  it('refuses mutating operations through the read-only runner', async () => {
    const git = new GitService({ get: () => undefined, set: () => undefined, delete: () => undefined });
    await expect(git.run({ id: 'p', name: 'p', path: 'C:/project', createdAt: '', updatedAt: '' }, 'commit' as never)).rejects.toThrow(/approval/i);
  });

  it('rejects invalid remote URLs', async () => {
    const git = new GitService({ get: () => undefined, set: () => undefined, delete: () => undefined });
    await expect(git.setRemote({ id: 'p', name: 'p', path: 'C:/project', createdAt: '', updatedAt: '' }, 'ftp://example.com/repo.git')).rejects.toThrow(/https/i);
  });
});
