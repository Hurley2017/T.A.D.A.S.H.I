import { z } from 'zod';

export const ModelRoleSchema = z.enum(['system', 'user', 'assistant']);
export type ModelRole = z.infer<typeof ModelRoleSchema>;

export const ModelMessageSchema = z.object({ role: ModelRoleSchema, content: z.string() });
export type ModelMessage = z.infer<typeof ModelMessageSchema>;

export const ModelUsageSchema = z.object({ inputTokens: z.number().int().nonnegative().optional(), outputTokens: z.number().int().nonnegative().optional() });
export type ModelUsage = z.infer<typeof ModelUsageSchema>;

export const ModelEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text.delta'), requestId: z.string(), text: z.string() }),
  z.object({ type: z.literal('tool.call'), requestId: z.string(), name: z.string(), arguments: z.string() }),
  z.object({ type: z.literal('completed'), requestId: z.string(), finishReason: z.string().optional(), usage: ModelUsageSchema.optional() }),
]);
export type ModelEvent = z.infer<typeof ModelEventSchema>;

export const ModelCompletionSchema = z.object({
  requestId: z.string(),
  text: z.string(),
  finishReason: z.string().optional(),
  usage: ModelUsageSchema.optional(),
});
export type ModelCompletion = z.infer<typeof ModelCompletionSchema>;

export const ModelRequestSchema = z.object({
  requestId: z.string(),
  messages: z.array(ModelMessageSchema).min(1),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().default(60_000),
});
export type ModelRequest = z.infer<typeof ModelRequestSchema>;

export const BrainTaskActionSchema = z.object({
  type: z.enum(['agent', 'observe', 'write', 'delete', 'command', 'network', 'git']),
  summary: z.string().min(1),
  executable: z.string().optional(),
  args: z.array(z.string()).default([]),
  paths: z.array(z.string()).default([]),
  networkDestination: z.string().optional(),
  estimatedCostUsd: z.number().nonnegative().optional(),
});
export type BrainTaskAction = z.infer<typeof BrainTaskActionSchema>;

export const BrainTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  agentId: z.string().min(1),
  dependsOn: z.array(z.string()).default([]),
  action: BrainTaskActionSchema,
  expectedEvidence: z.array(z.string()).default([]),
  complexity: z.enum(['low', 'medium', 'high']).default('medium'),
  estimatedTokens: z.number().int().nonnegative().default(0),
});
export type BrainTask = z.infer<typeof BrainTaskSchema>;

export const BrainDecisionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('clarify'), response: z.string().min(1), questions: z.array(z.string().min(1)).min(1).max(3) }),
  z.object({ kind: z.literal('status'), response: z.string().min(1) }),
  z.object({ kind: z.literal('plan'), response: z.string().min(1), tasks: z.array(BrainTaskSchema).min(1).max(20) }),
  z.object({ kind: z.literal('report'), response: z.string().min(1), severity: z.enum(['info', 'warning', 'error', 'success']) }),
  z.object({ kind: z.literal('evaluate'), response: z.string().min(1), outcome: z.enum(['success', 'needs-retry', 'blocked', 'needs-user']), evidence: z.array(z.string()).default([]), nextAction: z.string().optional() }),
]);
export type BrainDecision = z.infer<typeof BrainDecisionSchema>;

export const BrainContextSchema = z.object({
  project: z.object({ id: z.string(), name: z.string(), path: z.string() }),
  recentMessages: z.array(ModelMessageSchema).max(20),
  tasks: z.array(z.object({ id: z.string(), title: z.string(), status: z.string(), agentId: z.string() })).max(50),
  recentEvents: z.array(z.object({ type: z.string(), timestamp: z.string(), summary: z.string() })).max(50),
  agents: z.array(z.object({ id: z.string(), name: z.string(), type: z.string(), streaming: z.boolean(), toolUse: z.boolean(), network: z.boolean() })).max(20),
});
export type BrainContext = z.infer<typeof BrainContextSchema>;
