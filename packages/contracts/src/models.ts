import { z } from 'zod';

export const IdSchema = z.string().min(1);
export const IsoDateSchema = z.string().datetime({ offset: true });

export const ProjectSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  path: z.string().min(1),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type Project = z.infer<typeof ProjectSchema>;

export const ConversationMessageSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  createdAt: IsoDateSchema,
});
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;

export const IntentSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  sourceMessageId: IdSchema,
  objective: z.string().min(1),
  constraints: z.array(z.string()),
  requestedAutonomy: z.enum(['observe', 'propose', 'execute']),
  ambiguities: z.array(z.string()),
  createdAt: IsoDateSchema,
});
export type Intent = z.infer<typeof IntentSchema>;

export const TaskStatusSchema = z.enum(['queued', 'awaiting-approval', 'running', 'blocked', 'completed', 'failed', 'cancelled']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskActionSchema = z.object({
  type: z.enum(['agent', 'observe', 'write', 'delete', 'command', 'network', 'git']),
  summary: z.string().min(1),
  executable: z.string().optional(),
  args: z.array(z.string()).default([]),
  paths: z.array(z.string()).default([]),
  networkDestination: z.string().optional(),
  estimatedCostUsd: z.number().nonnegative().optional(),
});
export type TaskAction = z.infer<typeof TaskActionSchema>;

export const TaskSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  intentId: IdSchema,
  title: z.string().min(1),
  description: z.string().min(1),
  status: TaskStatusSchema,
  agentId: z.string().min(1),
  dependsOn: z.array(IdSchema).default([]),
  action: TaskActionSchema.optional(),
  expectedEvidence: z.array(z.string()).default([]),
  retryCount: z.number().int().nonnegative().default(0),
  modelId: z.string().optional(),
  modelRationale: z.string().optional(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  completedAt: IsoDateSchema.optional(),
});
export type Task = z.infer<typeof TaskSchema>;

export const AgentConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['cli', 'api']),
  delegate: z.literal('command-code').optional(),
  executable: z.string().optional(),
  args: z.array(z.string()).default([]),
  baseUrl: z.string().url().optional(),
  model: z.string().optional(),
  protocol: z.enum(['openai-compatible', 'anthropic']).default('openai-compatible'),
  enabled: z.boolean().default(true),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const AgentRunStatusSchema = z.enum(['starting', 'running', 'completed', 'failed', 'cancelled', 'timed-out']);
export const AgentRunSchema = z.object({
  id: IdSchema,
  taskId: IdSchema,
  agentId: z.string().min(1),
  status: AgentRunStatusSchema,
  startedAt: IsoDateSchema,
  endedAt: IsoDateSchema.optional(),
  exitCode: z.number().int().optional(),
});
export type AgentRun = z.infer<typeof AgentRunSchema>;

export const ApprovalScopeSchema = z.enum(['once', 'task', 'project']);
export const ApprovalRequestSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  taskId: IdSchema,
  action: z.enum(['agent', 'observe', 'write', 'delete', 'command', 'network', 'git']),
  summary: z.string().min(1),
  command: z.string().optional(),
  executable: z.string().optional(),
  args: z.array(z.string()).default([]),
  agentId: z.string().optional(),
  networkDestination: z.string().optional(),
  estimatedCostUsd: z.number().nonnegative().optional(),
  workingDirectory: z.string().min(1),
  paths: z.array(z.string()),
  status: z.enum(['pending', 'approved', 'denied']),
  scope: ApprovalScopeSchema.optional(),
  createdAt: IsoDateSchema,
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

export const EventTypeSchema = z.enum([
  'conversation.transcript',
  'intent.extracted',
  'brain.assessing',
  'brain.assessed',
  'brain.fallback',
  'assistant.responded',
  'clarification.requested',
  'task.created',
  'task.updated',
  'agent.started',
  'agent.output',
  'agent.completed',
  'file.changed',
  'git.changed',
  'test.completed',
  'blocker.detected',
  'approval.requested',
  'approval.resolved',
  'delegate.model-selected',
  'delegate.tool',
  'delegate.session',
  'delegate.setup-required',
  'progress.reported',
]);
export type EventType = z.infer<typeof EventTypeSchema>;

export const ProjectEventSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  type: EventTypeSchema,
  timestamp: IsoDateSchema,
  payload: z.record(z.unknown()),
});
export type ProjectEvent = z.infer<typeof ProjectEventSchema>;

export const BrainDecisionRecordSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  input: z.string().min(1),
  kind: z.string().min(1),
  response: z.string().min(1),
  valid: z.boolean(),
  createdAt: IsoDateSchema,
});
export type BrainDecisionRecord = z.infer<typeof BrainDecisionRecordSchema>;

export const CreateProjectInputSchema = z.object({ path: z.string().min(1) });
export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;

export const SubmitMessageInputSchema = z.object({
  projectId: IdSchema,
  content: z.string().trim().min(1),
});
export type SubmitMessageInput = z.infer<typeof SubmitMessageInputSchema>;

export const ResolveApprovalInputSchema = z.object({
  approvalId: IdSchema,
  decision: z.enum(['approved', 'denied']),
  scope: ApprovalScopeSchema.optional(),
});
export type ResolveApprovalInput = z.infer<typeof ResolveApprovalInputSchema>;

export const TranscribeAudioInputSchema = z.object({
  audio: z.instanceof(Uint8Array).refine((value) => value.byteLength > 0 && value.byteLength <= 25_000_000, 'Audio input is invalid or too large.'),
  mimeType: z.string().regex(/^audio\/wav$/, 'Audio format is not supported.'),
});
export type TranscribeAudioInput = z.infer<typeof TranscribeAudioInputSchema>;

export type TadashiEvent = ProjectEvent;
