import { mkdir, rm } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import type { Project } from '../../contracts/src';

export class ProjectService {
  async createLocal(parentPath: string, name: string): Promise<Project> {
    const safeName = name.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(safeName)) throw new Error('Project name contains unsupported characters.');
    const path = resolve(parentPath, safeName);
    await mkdir(path, { recursive: false });
    return projectFromPath(path);
  }

  async open(path: string): Promise<Project> {
    return projectFromPath(resolve(path));
  }

  async deleteLocal(project: Project): Promise<void> {
    await rm(project.path, { recursive: true, force: false });
  }

  async initializeGit(project: Project): Promise<void> {
    await runGit(project.path, ['init']);
  }
}

function projectFromPath(path: string): Project {
  const timestamp = new Date().toISOString();
  return { id: crypto.randomUUID(), name: basename(path), path, createdAt: timestamp, updatedAt: timestamp };
}

function runGit(cwd: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', args, { cwd, shell: false, windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolvePromise() : reject(new Error(stderr.trim() || `git ${args[0]} failed.`)));
  });
}
