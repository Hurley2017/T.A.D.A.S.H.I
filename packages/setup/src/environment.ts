import { existsSync, statfsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface DriveInfo {
  mount: string;
  freeBytes: number;
  preferred: boolean;
}

export interface SystemProbe {
  gpu: { vendor: 'nvidia' | 'amd' | 'intel' | 'unknown'; name: string; vramGb: number | null };
  cpuCount: number;
  ramGb: number;
  drives: DriveInfo[];
}

/** Detects available drives and picks the best target for TADASHI's runtime (D: preferred, C: fallback). */
export function detectTargetDrive(requiredBytes: number): DriveInfo | undefined {
  const sorted = listDrives();
  return sorted.find((drive) => drive.freeBytes >= requiredBytes);
}

export function listDrives(): DriveInfo[] {
  const candidates: DriveInfo[] = [];
  for (const letter of 'CDEFGHIJKL') {
    const mount = `${letter}:\\`;
    if (existsSync(mount)) candidates.push({ mount, freeBytes: freeSpace(mount), preferred: letter === 'D' });
  }
  return candidates.sort((a, b) => (b.preferred ? 1 : 0) - (a.preferred ? 1 : 0) || b.freeBytes - a.freeBytes);
}

function freeSpace(mount: string): number {
  try { return Number(statfsSync(mount).bavail) * Number(statfsSync(mount).bsize); } catch { return 0; }
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

/** Model options ranked by VRAM fit, with download URLs and sizes. */
export interface ModelOption {
  id: string;
  label: string;
  description: string;
  minVramGb: number;
  sizeGb: number;
  url: string;
  file: string;
  filename: string;
}

export const MODEL_OPTIONS: ModelOption[] = [
  { id: 'qwen3-8b-q4', label: 'Qwen3 8B · Q4_K_M (balanced)', description: 'Best balance of speed and capability for 8 GB GPUs. Recommended.', minVramGb: 6, sizeGb: 4.7, url: 'https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf', file: 'Qwen3-8B-Q4_K_M.gguf', filename: 'Qwen3-8B-Q4_K_M.gguf' },
  { id: 'qwen3-4b-q8', label: 'Qwen3 4B · Q8_0 (lightweight)', description: 'Faster and lighter — suits 4-6 GB GPUs or CPU-only systems. Still capable for routine orchestration.', minVramGb: 4, sizeGb: 4.4, url: 'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q8_0.gguf', file: 'Qwen3-4B-Q8_0.gguf', filename: 'Qwen3-4B-Q8_0.gguf' },
];

export function recommendModel(vramGb: number | null, ramGb: number): ModelOption {
  if (vramGb === null || vramGb < 5) return MODEL_OPTIONS[1];
  return MODEL_OPTIONS[0];
}

export interface SetupChoices {
  root: string;
  modelId: string;
  delegateTier: 'free-only' | 'auto';
  wakePhrase: string;
  voiceOutput: boolean;
  alwaysListening: boolean;
  whisperModel: 'base.en' | 'small.en';
}

export const DEFAULT_CHOICES: SetupChoices = {
  root: LOCAL_INSTALL_ROOT,
  modelId: 'qwen3-8b-q4',
  delegateTier: 'free-only',
  wakePhrase: 'tadashi',
  voiceOutput: true,
  alwaysListening: true,
  whisperModel: 'base.en',
};
