import { z } from 'zod';

export const LlamaConfigSchema = z.object({
  runtime: z.literal('llama.cpp').default('llama.cpp'),
  serverPath: z.string().optional(),
  modelPath: z.string().min(1),
  endpoint: z.string().url().default('http://127.0.0.1:8080/v1/chat/completions'),
  modelName: z.string().min(1),
  gpuLayers: z.number().int().nonnegative().default(999),
  contextSize: z.number().int().positive().max(16384).default(8192),
  flashAttention: z.boolean().default(true),
  timeoutMs: z.number().int().positive().default(60000),
});
export type LlamaConfig = z.infer<typeof LlamaConfigSchema>;

export type BrainHealth = {
  configured: boolean;
  reachable: boolean;
  provider: 'llama.cpp' | 'fallback';
  model: string;
  endpoint: string;
  message: string;
};

export async function checkLlamaHealth(config?: Partial<LlamaConfig>): Promise<BrainHealth> {
  if (!config?.modelPath || !config.modelName) {
    return { configured: false, reachable: false, provider: 'fallback', model: '', endpoint: config?.endpoint ?? '', message: 'Configure a GGUF model and llama.cpp endpoint.' };
  }
  const endpoint = config.endpoint ?? 'http://127.0.0.1:8080/v1/chat/completions';
  try {
    const response = await fetch(endpoint.replace(/\/v1\/chat\/completions$/, '/health'), { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`health endpoint returned ${response.status}`);
    return { configured: true, reachable: true, provider: 'llama.cpp', model: config.modelName, endpoint, message: 'Local llama.cpp brain is online.' };
  } catch {
    return { configured: true, reachable: false, provider: 'fallback', model: config.modelName, endpoint, message: 'Model is configured, but llama.cpp is not reachable.' };
  }
}

export const RTX_5060_BRAIN_PROFILE = {
  modelFamily: 'Qwen3 8B Instruct',
  quantization: 'Q4_K_M',
  recommendedContext: 8192,
  rationale: 'Keeps an 8 GB GPU responsive while reserving VRAM for context and the desktop runtime.',
};
