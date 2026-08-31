export type ModelTier = 'free-only' | 'auto';
export type TaskComplexity = 'low' | 'medium' | 'high';

export interface CatalogModel {
  id: string;
  name: string;
  context: number;
  intelligence: number; // 0-100 curated coding-capability index
  costPer1mIn: number;
  costPer1mOut: number;
  free: boolean;
  bestFor: string;
  minPlan: 'Go' | 'GOAT' | 'Pro' | 'Max';
}

/** GOAT-plan-accessible models with a curated capability index and pricing from models.md. */
export const MODEL_CATALOG: CatalogModel[] = [
  // Free models (GOAT plan)
  { id: 'minimax/minimax-m3-free', name: 'MiniMax M3 (free)', context: 1_000_000, intelligence: 85, costPer1mIn: 0, costPer1mOut: 0, free: true, bestFor: 'frontier coding, agents & native multimodality — zero cost', minPlan: 'Go' },
  { id: 'minimax/minimax-m2.7-free', name: 'MiniMax M2.7 (free)', context: 197_000, intelligence: 66, costPer1mIn: 0, costPer1mOut: 0, free: true, bestFor: 'end-to-end software engineering agent — zero cost', minPlan: 'Go' },
  { id: 'poolside/laguna-s-2.1-free', name: 'Laguna S 2.1 (free)', context: 256_000, intelligence: 69, costPer1mIn: 0, costPer1mOut: 0, free: true, bestFor: 'open-weight agentic coding and long-horizon work', minPlan: 'Go' },
  // Cheap paid escalation (all GOAT-accessible)
  { id: 'Qwen/Qwen3.7-Flash', name: 'Qwen 3.7 Flash', context: 1_000_000, intelligence: 74, costPer1mIn: 0.03, costPer1mOut: 0.13, free: false, bestFor: 'fast low-cost agentic coding & reasoning', minPlan: 'Go' },
  { id: 'stepfun/Step-3.5-Flash', name: 'Step 3.5 Flash', context: 1_000_000, intelligence: 72, costPer1mIn: 0.1, costPer1mOut: 0.3, free: false, bestFor: 'fast sparse-MoE agentic reasoning', minPlan: 'Go' },
  { id: 'xiaomi/mimo-v2.5', name: 'MiMo V2.5', context: 1_000_000, intelligence: 76, costPer1mIn: 0.14, costPer1mOut: 0.28, free: false, bestFor: 'efficient long-context agentic coding', minPlan: 'Go' },
  { id: 'z-ai/glm-5.3-flash', name: 'GLM-5.3 Flash', context: 1_050_000, intelligence: 78, costPer1mIn: 0.15, costPer1mOut: 0.5, free: false, bestFor: 'fast, affordable GLM coding with 1M context', minPlan: 'Go' },
  { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', context: 1_050_000, intelligence: 82, costPer1mIn: 0.2, costPer1mOut: 1.2, free: false, bestFor: 'optimized for cost-sensitive workloads', minPlan: 'Go' },
  { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash', context: 1_000_000, intelligence: 79, costPer1mIn: 0.22, costPer1mOut: 0.66, free: false, bestFor: 'fast hybrid-attention reasoning', minPlan: 'Go' },
  { id: 'google/gemini-3.7-flash', name: 'Gemini 3.7 Flash', context: 1_050_000, intelligence: 92, costPer1mIn: 0.75, costPer1mOut: 3.75, free: false, bestFor: 'higher-quality coding & agentic workflows', minPlan: 'GOAT' },
  { id: 'deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro', context: 1_000_000, intelligence: 88, costPer1mIn: 0.66, costPer1mOut: 1.98, free: false, bestFor: 'hybrid-attention long-context reasoning', minPlan: 'Go' },
  { id: 'zai-org/GLM-5.3', name: 'GLM-5.3', context: 1_000_000, intelligence: 90, costPer1mIn: 1.4, costPer1mOut: 4.4, free: false, bestFor: 'frontier coding with emergent cyber capabilities', minPlan: 'Go' },
];

export function requiredIntelligence(complexity: TaskComplexity): number {
  switch (complexity) {
    case 'low': return 60;
    case 'medium': return 75;
    case 'high': return 85;
  }
}

export interface DelegateModelSelection {
  modelId: string;
  modelName: string;
  intelligence: number;
  costPer1mIn: number;
  costPer1mOut: number;
  free: boolean;
  rationale: string;
  escalationNeeded: boolean;
}

export function selectDelegateModel(complexity: TaskComplexity, tier: ModelTier): DelegateModelSelection {
  const needed = requiredIntelligence(complexity);
  const freePool = MODEL_CATALOG.filter((model) => model.free);

  if (tier === 'free-only') {
    const best = [...freePool].sort((a, b) => b.intelligence - a.intelligence)[0];
    const escalationNeeded = best.intelligence < needed;
    return {
      modelId: best.id, modelName: best.name, intelligence: best.intelligence,
      costPer1mIn: 0, costPer1mOut: 0, free: true,
      rationale: escalationNeeded
        ? `Free models max out at intelligence ${best.intelligence}/100; this task needs ~${needed}/100. Using ${best.name} now — premium tier will unlock better models.`
        : `Free model with the highest capability (${best.intelligence}/100) covers a ${complexity}-complexity task at $0.`,
      escalationNeeded,
    };
  }

  const capable = MODEL_CATALOG.filter((model) => model.intelligence >= needed);
  const cheapest = [...capable].sort((a, b) => (a.costPer1mIn + a.costPer1mOut) - (b.costPer1mIn + b.costPer1mOut))[0];
  if (!cheapest) throw new Error('No model in the catalog meets the task complexity.');
  return {
    modelId: cheapest.id, modelName: cheapest.name, intelligence: cheapest.intelligence,
    costPer1mIn: cheapest.costPer1mIn, costPer1mOut: cheapest.costPer1mOut, free: cheapest.free,
    rationale: `Cheapest capable model (${cheapest.intelligence}/100 ≥ ${needed}) for ${complexity} task.`,
    escalationNeeded: false,
  };
}
