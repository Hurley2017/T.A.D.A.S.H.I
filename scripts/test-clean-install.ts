import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildManifest, installComponent, DEFAULT_CHOICES } from '../packages/setup/src';

const root = 'D:\\TadashiAI-test-clean';
const choices = { ...DEFAULT_CHOICES, root };

function installed(componentId: string): boolean {
  switch (componentId) {
    case 'node': return existsSync(join(root, 'node', 'node.exe'));
    case 'llama': return existsSync(join(root, 'llama', 'runtime', 'llama-server.exe'));
    case 'model': return existsSync(join(root, 'models', 'Qwen3-8B-Q4_K_M.gguf'));
    case 'whisper': return existsSync(join(root, 'whisper', 'runtime', 'Release', 'whisper-cli.exe'));
    default: return false;
  }
}

async function main(): Promise<void> {
  console.log(`Clean install test into ${root}`);
  try { rmSync(root, { recursive: true, force: true }); } catch {}
  const manifest = buildManifest(root, choices);
  // The real Command Code CLI is already installed globally on this machine, so only test
  // the components the wizard provisions into the fresh root (node, llama, model, whisper).
  const pending = manifest.filter((component) => !installed(component.id) && component.id !== 'cli');
  console.log(`Pending components: ${pending.map((component) => component.id).join(', ') || 'none'}`);
  for (const component of pending) {
    console.log(`\nInstalling ${component.label}...`);
    await installComponent(component, {
      root,
      onEvent: (event) => {
        if (event.kind === 'verify') console.log(`  verify: ${event.component} ${event.ok ? 'OK' : 'FAIL'}`);
        if (event.kind === 'done') console.log(`  done: ${event.component} ${event.ok ? 'OK' : 'FAIL'}`);
        if (event.kind === 'download-progress' && event.total && event.received === event.total) console.log(`  downloaded step ${event.step + 1}`);
      },
    });
  }
  console.log(`\nClean install test finished. Root: ${root}`);
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
