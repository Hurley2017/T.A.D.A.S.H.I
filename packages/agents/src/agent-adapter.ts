import { isAbsolute, relative, resolve } from 'node:path';
import type { AgentConfig } from '../../contracts/src';

export interface AgentRunRequest {
  runId: string;
  taskId: string;
  workspace: string;
  projectPath: string;
  prompt: string;
  timeoutMs?: number;
  model?: string;
  sessionId?: string;
  allowWrites?: boolean;
}

export type AgentOutputEvent =
  | { type: 'started'; runId: string }
  | { type: 'output'; runId: string; stream: 'stdout' | 'stderr'; content: string }
  | { type: 'completed'; runId: string; exitCode: number }
  | { type: 'failed'; runId: string; error: string }
  | { type: 'cancelled'; runId: string };

export interface AgentAdapter {
  readonly config: AgentConfig;
  capabilities(): Promise<{ streaming: boolean; toolUse: boolean; network: boolean }>;
  run(request: AgentRunRequest): AsyncIterable<AgentOutputEvent>;
  cancel(runId: string): Promise<void>;
}

export function assertAgentWorkspace(workspace: string, projectPath: string): void {
  const difference = relative(resolve(projectPath), resolve(workspace));
  if (difference.startsWith('..') || isAbsolute(difference)) throw new Error('Agent workspace must remain inside the selected project.');
}

