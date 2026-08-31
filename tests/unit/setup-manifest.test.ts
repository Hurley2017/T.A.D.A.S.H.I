import { describe, it, expect } from 'vitest';
import { buildManifest, resolveModelOption } from '../../packages/setup/src/manifest';
import { MODEL_OPTIONS, recommendModel } from '../../packages/setup/src/environment';

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

  it('uses chosen model option when a custom model is selected', () => {
    const manifest = buildManifest('D:\\TadashiAI', { modelId: 'qwen3-4b-q8' });
    const model = manifest.find((component) => component.id === 'model');
    expect(model?.label).toContain('Qwen3 4B');
  });
});

describe('model recommendation', () => {
  it('recommends the 8B model for 8 GB GPUs', () => {
    expect(recommendModel(8, 16).id).toBe('qwen3-8b-q4');
  });

  it('recommends the lightweight model for small or no GPU', () => {
    expect(recommendModel(null, 16).id).toBe('qwen3-4b-q8');
    expect(recommendModel(4, 16).id).toBe('qwen3-4b-q8');
  });

  it('resolves model options by id', () => {
    expect(resolveModelOption('qwen3-8b-q4').filename).toBe('Qwen3-8B-Q4_K_M.gguf');
    expect(MODEL_OPTIONS.length).toBeGreaterThanOrEqual(2);
  });
});
