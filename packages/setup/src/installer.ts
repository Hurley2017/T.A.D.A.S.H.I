import { mkdirSync, createWriteStream, writeFileSync, rmSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import type { ComponentManifest } from './manifest';
import { verifyComponent } from './manifest';

export type SetupEvent =
  | { kind: 'component-start'; component: string; label: string }
  | { kind: 'download-progress'; component: string; step: number; received: number; total: number }
  | { kind: 'extract'; component: string; step: number }
  | { kind: 'execute'; component: string; label: string }
  | { kind: 'verify'; component: string; ok: boolean }
  | { kind: 'done'; ok: boolean; component: string };

export interface InstallerOptions {
  root: string;
  onEvent?: (event: SetupEvent) => void;
  signal?: AbortSignal;
}

export async function installComponent(component: ComponentManifest, options: InstallerOptions): Promise<boolean> {
  const { root, onEvent, signal } = options;
  if (verifyComponent(component, root)) {
    onEvent?.({ kind: 'verify', component: component.id, ok: true });
    return true;
  }
  onEvent?.({ kind: 'component-start', component: component.id, label: component.label });
  try {
    for (let index = 0; index < component.steps.length; index += 1) {
      const step = component.steps[index];
      onEvent?.({ kind: 'download-progress', component: component.id, step: index, received: 0, total: 0 });
      // step.targetDir is already absolute (built from root); only fall back to root when relative.
      const destRoot = isAbsolute(step.targetDir) ? step.targetDir : join(root, step.targetDir);
      await downloadAndExtract(step.url, destRoot, step.kind, (stepIndex, received, total) => onEvent?.({ kind: 'download-progress', component: component.id, step: index, received, total }), signal);
      if (step.runAfter) {
        onEvent?.({ kind: 'extract', component: component.id, step: index });
      }
    }
    for (const script of component.postInstall ?? []) {
      onEvent?.({ kind: 'execute', component: component.id, label: script.label });
      await runCommand(script.command, script.args, root, signal ?? new AbortController().signal, onEvent, component.id);
    }
    const ok = verifyComponent(component, root);
    onEvent?.({ kind: 'verify', component: component.id, ok });
    onEvent?.({ kind: 'done', ok, component: component.id });
    return ok;
  } catch (error) {
    onEvent?.({ kind: 'done', ok: false, component: component.id });
    throw error;
  }
}

async function downloadAndExtract(url: string, targetDir: string, kind: 'archive' | 'single', onProgress: (step: number, received: number, total: number) => void, signal?: AbortSignal): Promise<void> {
  mkdirSync(targetDir, { recursive: true });
  const response = await fetch(url, { redirect: 'follow', signal });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}) for ${url}`);
  const total = Number(response.headers.get('content-length') ?? 0);
  const filename = url.split('/').pop() ?? 'download.bin';
  const archivePath = join(targetDir, filename);
  // Stream to disk directly (the model is ~5 GB; buffering it in memory is not viable).
  const reader = response.body.getReader();
  let received = 0;
  try {
    const file = createWriteStream(archivePath, { flags: 'w' });
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!file.write(Buffer.from(value))) await new Promise<void>((resolve) => file.once('drain', () => resolve()));
      received += value.length;
      onProgress(0, received, total);
    }
    await new Promise<void>((resolve, reject) => { file.end(() => resolve()); file.on('error', reject); });
    onProgress(0, received, total);
    if (kind === 'archive') await extractArchive(archivePath, targetDir, filename);
  } catch (error) {
    rmSync(archivePath, { force: true });
    throw error;
  }
}

async function extractArchive(archivePath: string, targetDir: string, filename: string): Promise<void> {
  if (process.platform !== 'win32') {
    const result = await new Promise<number>((resolve) => {
      const child = spawn('unzip', ['-o', archivePath, '-d', targetDir], { shell: false });
      child.on('close', (code) => resolve(code ?? 1));
      child.on('error', () => resolve(1));
    });
    if (result !== 0) throw new Error(`Extraction failed for ${filename}`);
    rmSync(archivePath, { force: true });
    return;
  }
  // Windows: Expand-Archive reliably handles zip; pass the command via a temp script file.
  const scriptPath = join(targetDir, '.extract.ps1');
  writeFileSync(scriptPath, `Expand-Archive -Force -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${targetDir.replace(/'/g, "''")}'\n`, 'utf8');
  const result = await new Promise<number>((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { shell: false, windowsHide: true });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
  rmSync(scriptPath, { force: true });
  rmSync(archivePath, { force: true });
  if (result !== 0) throw new Error(`Extraction failed for ${filename}`);
}

async function runCommand(command: string, args: string[], cwd: string, signal: AbortSignal, onEvent: InstallerOptions['onEvent'], component: string): Promise<void> {
  const usesShell = /\.(cmd|ps1)$/i.test(command) || /\.(cmd|ps1)$/i.test((process.env.SHELL ?? ''));
  const child = spawn(command, args, { cwd, shell: usesShell, windowsHide: true, env: { ...process.env } });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  const code = await new Promise<number>((resolve) => {
    child.on('close', (exit) => resolve(exit ?? 1));
    child.on('error', (error) => { onEvent?.({ kind: 'execute', component, label: error.message }); resolve(1); });
  });
  if (code !== 0) throw new Error(`${command} failed: ${stderr.slice(0, 200)}`);
}
