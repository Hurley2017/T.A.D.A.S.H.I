import { spawn } from 'node:child_process';
import { assertInsideProject } from '../../agents/src/process-sandbox';
import type { Project } from '../../contracts/src';
import type { CredentialStore } from './credential-store';

export type GitOperation = 'status' | 'diff' | 'branch' | 'commit' | 'push' | 'pull' | 'remote' | 'create-repository';

export class GitService {
  constructor(private readonly credentials: CredentialStore) {}

  credentialStatus(): { configured: boolean; provider: string } {
    return { configured: Boolean(this.credentials.get('git-token')), provider: process.env.TADASHI_GIT_PROVIDER ?? 'github' };
  }

  async run(project: Project, operation: GitOperation): Promise<string> {
    const readOnlyArgs: Record<'status' | 'diff' | 'branch', string[]> = { status: ['status', '--short'], diff: ['diff', '--'], branch: ['branch', '--show-current'] };
    if (!(operation in readOnlyArgs)) throw new Error('Mutating Git operations require an explicit approval token.');
    return execute(project.path, ['git', ...readOnlyArgs[operation as 'status' | 'diff' | 'branch']]);
  }

  async commit(project: Project, message: string, paths: string[]): Promise<string> {
    if (!message.trim()) throw new Error('Commit message is required.');
    for (const path of paths) assertInsideProject(project.path, path);
    return execute(project.path, ['git', 'commit', '-m', message.trim(), '--', ...paths.map((path) => path.replace(/^.*[\\/]/, ''))]);
  }

  async push(project: Project, remote = 'origin', branch?: string): Promise<string> {
    if (!/^[a-zA-Z0-9._-]+$/.test(remote)) throw new Error('Remote name is invalid.');
    if (branch && !/^[a-zA-Z0-9._/-]+$/.test(branch)) throw new Error('Branch name is invalid.');
    return execute(project.path, ['git', 'push', remote, ...(branch ? [branch] : [])]);
  }

  async setRemote(project: Project, url: string): Promise<string> {
    const parsed = new URL(url);
    if (!['https:', 'ssh:'].includes(parsed.protocol)) throw new Error('Only HTTPS and SSH Git remotes are supported.');
    return execute(project.path, ['git', 'remote', 'set-url', 'origin', url]);
  }
}

function execute(cwd: string, command: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const [executable, ...args] = command;
    const child = spawn(executable, args, { cwd, shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || `${executable} failed.`)));
  });
}
