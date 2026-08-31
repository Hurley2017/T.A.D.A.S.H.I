import { isAbsolute, relative, resolve } from 'node:path';

export function isInsideProject(projectPath: string, candidatePath: string): boolean {
  const project = resolve(projectPath);
  const candidate = resolve(candidatePath);
  if (!isAbsolute(candidate)) return false;
  const difference = relative(project, candidate);
  return difference === '' || (!difference.startsWith('..') && !isAbsolute(difference));
}

export function assertInsideProject(projectPath: string, candidatePath: string): void {
  if (!isInsideProject(projectPath, candidatePath)) throw new Error('Path is outside the selected project.');
}
