import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { SetupStatus } from './environment';

export interface ComponentManifest {
  id: string;
  label: string;
  description: string;
  sizeLabel: string;
  /** Zero or more download steps; each yields progress. */
  steps: { url: string; targetDir: string; kind: 'archive' | 'single'; runAfter?: string }[];
  /** Extra CLI commands to run after download (e.g. npm install, login). */
  postInstall?: { command: string; args: string[]; label: string }[];
  required: boolean;
}

const LLAMA_TAG = 'b10621';
const WHISPER_TAG = 'b4938';

export function buildManifest(root = 'D:\\TadashiAI'): ComponentManifest[] {
  // The portable Node runtime is installed first, so its npm is used for the CLI.
  const nodeDir = join(root, 'node');
  const npmPath = join(nodeDir, 'npm.cmd');
  return [
    {
      id: 'node',
      label: 'Node.js runtime',
      description: 'Runs the local brain server, whisper, and the Command Code CLI.',
      sizeLabel: '~120 MB',
      steps: [
        { url: 'https://nodejs.org/dist/v24.19.0/node-v24.19.0-win-x64.zip', targetDir: join(root, 'node'), kind: 'archive' },
      ],
      postInstall: [{ command: npmPath, args: ['i', '-g', 'command-code'], label: 'Install Command Code CLI via npm' }],
      required: true,
    },
    {
      id: 'llama',
      label: 'llama.cpp runtime (CUDA)',
      description: 'GPU inference engine for the local brain (NVIDIA, Blackwell).',
      sizeLabel: '~450 MB',
      steps: [
        { url: `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_TAG}/llama-${LLAMA_TAG}-bin-win-cuda-13.3-x64.zip`, targetDir: join(root, 'llama'), kind: 'archive' },
        { url: `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_TAG}/cudart-llama-bin-win-cuda-13.3-x64.zip`, targetDir: join(root, 'llama'), kind: 'archive' },
      ],
      required: true,
    },
    {
      id: 'model',
      label: 'Qwen3-8B brain model',
      description: '4.7 GB GGUF model — the actual TADASHI brain.',
      sizeLabel: '~4.7 GB',
      steps: [
        { url: 'https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf', targetDir: join(root, 'models'), kind: 'single' },
      ],
      required: true,
    },
    {
      id: 'whisper',
      label: 'Whisper speech-to-text',
      description: 'Transcribes your voice into instructions.',
      sizeLabel: '~120 MB',
      steps: [
        { url: `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_TAG}/whisper-bin-x64.zip`, targetDir: join(root, 'whisper'), kind: 'archive' },
        { url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin', targetDir: join(root, 'whisper'), kind: 'single' },
      ],
      required: true,
    },
    {
      id: 'cli',
      label: 'Command Code worker',
      description: 'The delegated coding agent (uses the user\'s Command Code login).',
      sizeLabel: '~60 MB',
      steps: [],
      postInstall: [{ command: npmPath, args: ['i', '-g', 'command-code'], label: 'Install Command Code CLI via npm' }],
      required: true,
    },
  ];
}

export function missingComponents(status: SetupStatus): string[] {
  return status.missing;
}

export function isManifestComponentSatisfied(component: ComponentManifest, status: SetupStatus): boolean {
  if (component.id === 'node') return status.components.node;
  if (component.id === 'llama') return status.components.llama;
  if (component.id === 'model') return status.components.model;
  if (component.id === 'whisper') return status.components.whisper;
  if (component.id === 'cli') return status.components.cli;
  return true;
}

export function verifyComponent(component: ComponentManifest, root: string): boolean {
  switch (component.id) {
    case 'node': return existsSync(join(root, 'node', 'node.exe'));
    case 'llama': return existsSync(join(root, 'llama', 'runtime', 'llama-server.exe'));
    case 'model': return existsSync(join(root, 'models', 'Qwen3-8B-Q4_K_M.gguf'));
    case 'whisper': return existsSync(join(root, 'whisper', 'runtime', 'Release', 'whisper-cli.exe'));
    case 'cli': return existsSync(join(process.env.APPDATA ?? '', 'npm', 'cmdc.cmd'));
    default: return true;
  }
}
