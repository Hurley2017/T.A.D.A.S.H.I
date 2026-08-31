import { describe, it, expect } from 'vitest';
import { buildManifest } from '../../packages/setup/src/manifest';
import { requiredIntelligence, selectDelegateModel } from '../../packages/brain/src/model-catalog';

describe('setup manifest', () => {
  it('includes all required components', () => {
    const manifest = buildManifest('D:\\TadashiAI');
    const ids = manifest.map((component) => component.id);
    expect(ids).toEqual(expect.arrayContaining(['node', 'llama', 'model', 'whisper', 'cli']));
  });

  it('points model and runtime at the configured install root', () => {
    const manifest = buildManifest('E:\\TadashiAI');
    const model = manifest.find((component) => component.id === 'model');
    expect(model?.steps[0].targetDir).toBe('E:\\TadashiAI\\models');
    const llama = manifest.find((component) => component.id === 'llama');
    expect(llama?.steps[0].targetDir).toBe('E:\\TadashiAI\\llama');
  });

  it('uses portable npm for post-install steps', () => {
    const manifest = buildManifest('D:\\TadashiAI');
    const cli = manifest.find((component) => component.id === 'cli');
    expect(cli?.postInstall?.[0].command).toBe('D:\\TadashiAI\\node\\npm.cmd');
  });
});

describe('delegation selects matching models', () => {
  it('matches free-only tier against required intelligence', () => {
    const result = selectDelegateModel('medium', 'free-only');
    expect(result.free).toBe(true);
  });
});
