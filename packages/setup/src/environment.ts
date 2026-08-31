import { existsSync } from 'node:fs';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface DriveInfo {
  mount: string;
  freeBytes: number;
  preferred: boolean;
}

/** Detects available drives and picks the best target for TADASHI's runtime (D: preferred, C: fallback). */
export function detectTargetDrive(requiredBytes: number): DriveInfo | undefined {
  const candidates: DriveInfo[] = [{ mount: 'C:\\', freeBytes: freeSpace('C:\\'), preferred: false }];
  for (const letter of 'DEFGHIJKL') {
    const mount = `${letter}:\\`;
    if (existsSync(mount)) candidates.push({ mount, freeBytes: freeSpace(mount), preferred: letter === 'D' });
  }
  const sorted = candidates.sort((a, b) => (b.preferred ? 1 : 0) - (a.preferred ? 1 : 0) || b.freeBytes - a.freeBytes);
  return sorted.find((drive) => drive.freeBytes >= requiredBytes);
}

function freeSpace(mount: string): number {
  try { return statSync(mount).size; } catch { return 0; }
}

export function defaultInstallRoot(drive: DriveInfo): string {
  return `${drive.mount.replace(/[\\/]$/, '')}\\TadashiAI`;
}

/** Where TADASHI's runtime and model files live on this machine (already provisioned). */
export const LOCAL_INSTALL_ROOT = 'D:\\TadashiAI';

export function requiredSpaceEstimates(): { brain: number; model: number; whisper: number; cli: number; node: number } {
  return { brain: 450_000_000, model: 4_800_000_000, whisper: 120_000_000, cli: 60_000_000, node: 120_000_000 };
}

export function totalRequiredBytes(): number {
  const e = requiredSpaceEstimates();
  return e.brain + e.model + e.whisper + e.cli + e.node;
}

export function isRuntimePresent(): boolean {
  return existsSync(`${LOCAL_INSTALL_ROOT}\\llama\\runtime\\llama-server.exe`);
}

export function isModelPresent(): boolean {
  return existsSync(`${LOCAL_INSTALL_ROOT}\\models\\Qwen3-8B-Q4_K_M.gguf`);
}

export function isWhisperPresent(): boolean {
  return existsSync(`${LOCAL_INSTALL_ROOT}\\whisper\\runtime\\Release\\whisper-cli.exe`);
}

export function isNodePresent(root = LOCAL_INSTALL_ROOT): boolean {
  return existsSync(join(root, 'node', 'node.exe')) || existsSync(process.env.PROGRAMFILES + '\\nodejs\\node.exe') || existsSync(homedir() + '\\AppData\\Local\\Programs\\nodejs\\node.exe');
}

export function isCommandCodeCliPresent(): boolean {
  return existsSync(join(homedir(), 'AppData', 'Roaming', 'npm', 'cmdc.cmd'));
}

export interface SetupStatus {
  complete: boolean;
  drive: string;
  components: {
    node: boolean;
    llama: boolean;
    model: boolean;
    whisper: boolean;
    cli: boolean;
    python: boolean;
  };
  missing: string[];
}

export function detectSetupStatus(): SetupStatus {
  const components = {
    node: isNodePresent(),
    llama: isRuntimePresent(),
    model: isModelPresent(),
    whisper: isWhisperPresent(),
    cli: isCommandCodeCliPresent(),
    python: existsSync('C:\\Windows\\py.exe') || existsSync(process.env.LOCALAPPDATA + '\\Programs\\Python'),
  };
  const missing = Object.entries(components).filter(([, present]) => !present).map(([name]) => name);
  return { complete: missing.length === 0, drive: 'D:\\', components, missing };
}
