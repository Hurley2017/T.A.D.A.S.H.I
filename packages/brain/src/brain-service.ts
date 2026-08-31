import { randomUUID } from 'node:crypto';
import type { ModelClient } from './model-client';
import { BrainContextSchema, BrainDecisionSchema, type BrainContext, type BrainDecision } from './schemas';
import { TADASHI_PERSONA } from './persona';

export interface BrainServiceOptions {
  timeoutMs?: number;
  maxTokens?: number;
}

export class BrainService {
  private readonly options: Required<BrainServiceOptions>;

  constructor(private readonly client: ModelClient, options: BrainServiceOptions = {}) {
    this.options = { timeoutMs: options.timeoutMs ?? 60_000, maxTokens: options.maxTokens ?? 2_048 };
  }

  async decide(input: string, context: BrainContext): Promise<BrainDecision> {
    return this.requestDecision('assess', input, context);
  }

  async evaluate(input: string, context: BrainContext): Promise<Extract<BrainDecision, { kind: 'evaluate' }>> {
    const decision = await this.requestDecision('evaluate', input, context);
    if (decision.kind !== 'evaluate') throw new Error('Brain returned a non-evaluation decision.');
    return decision;
  }

  private async requestDecision(mode: 'assess' | 'evaluate', input: string, context: BrainContext): Promise<BrainDecision> {
    const safeContext = BrainContextSchema.parse(context);
    const completion = await this.client.complete({
      requestId: randomUUID(),
      timeoutMs: this.options.timeoutMs,
      maxTokens: this.options.maxTokens,
      messages: [
        { role: 'system', content: `${TADASHI_PERSONA}\n\nYou are in ${mode} mode. Return only valid JSON. In assess mode use clarify, status, plan, or report. In evaluate mode use evaluate.` },
        { role: 'user', content: JSON.stringify({ request: input, context: safeContext }) },
      ],
    });
    return parseDecision(completion.text);
  }
}

function parseDecision(text: string): BrainDecision {
  const candidate = JSON.parse(extractJson(text)) as unknown;
  return BrainDecisionSchema.parse(candidate);
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  if (fenced) return fenced;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Brain returned no JSON decision.');
  return text.slice(start, end + 1);
}
