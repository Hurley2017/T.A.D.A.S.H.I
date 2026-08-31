import { mkdirSync, createWriteStream, rmSync } from 'node:fs';
import { Readable, Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
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
      await downloadAndExtract(step.url, join(root, step.targetDir), step.kind, (stepIndex, received, total) => onEvent?.({ kind: 'download-progress', component: component.id, step: index, received, total }), signal);
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
  const stream = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
  let received = 0;
  await pipeline(
    stream,
    new TransformProgress((chunk) => {
      received += chunk.length;
      onProgress(0, received, total);
    }),
    createWriteStream(archivePath),
  );
  if (kind === 'archive') {
    onProgress(0, received, total);
    const extract = { command: process.platform === 'win32' ? 'powershell.exe' : 'unzip', args: process.platform === 'win32' ? ['-NoProfile', '-Command', `Expand-Archive -Force -LiteralPath '${archivePath}' -DestinationPath '${targetDir}'`] : ['-o', archivePath, '-d', targetDir] };
    const result = await new Promise<number>((resolve) => {
      const child = spawn(extract.command, extract.args, { shell: false, windowsHide: true });
      child.on('close', (code) => resolve(code ?? 1));
      child.on('error', () => resolve(1));
    });
    if (result !== 0) throw new Error(`Extraction failed for ${filename}`);
    if (filename.endsWith('.zip')) rmSync(archivePath, { force: true });
  }
}

class TransformProgress extends Transform {
  constructor(private readonly onChunk: (chunk: Buffer) => void) { super(); }
  _transform(chunk: Buffer, _encoding: string, callback: TransformCallback): void {
    this.onChunk(chunk);
    callback(null, chunk);
  }
}

async function runCommand(command: string, args: string[], cwd: string, signal: AbortSignal, onEvent: InstallerOptions['onEvent'], component: string): Promise<void> {
  const child = spawn(command, args, { cwd, shell: false, windowsHide: true, env: { ...process.env } });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  const code = await new Promise<number>((resolve) => {
    child.on('close', (exit) => resolve(exit ?? 1));
    child.on('error', (error) => { onEvent?.({ kind: 'execute', component, label: error.message }); resolve(1); });
  });
  if (code !== 0) throw new Error(`${command} failed: ${stderr.slice(0, 200)}`);
}
