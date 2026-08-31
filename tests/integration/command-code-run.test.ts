import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { CommandCodeAdapter } from '../../packages/agents/src';
import { EventBus } from '../../packages/monitoring/src';
import { createMemoryStore } from '../../packages/persistence/src';
import { Orchestrator } from '../../packages/orchestrator/src';
import type { Project, Task } from '../../packages/contracts/src';

const projectBase: Project = { id: 'delegate-project', name: 'delegate-demo', path: 'C:\\projects\\delegate-demo', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };

function makeStubExecutable(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tadashi-cc-'));
  const script = join(dir, 'stub.cmd');
  writeFileSync(script, [
    '@echo off',
    'echo {"type":"event","event":{"type":"tool_running","toolName":"edit_file","description":"src/auth.ts"}}',
    'echo {"type":"result","subtype":"success","sessionId":"session-abc","finalText":"Done."}',
  ].join('\r\n'), 'utf8');
  chmodSync(script, 0o755);
  return script;
}

function taskFor(agentId: string, modelId: string): Task {
  const now = new Date().toISOString();
  return { id: 'task-1', projectId: projectBase.id, intentId: 'intent-1', title: 'Fix auth', description: 'Fix the auth module', status: 'awaiting-approval', agentId, modelId, modelRationale: 'free model', dependsOn: [], action: { type: 'agent', summary: 'Run fix', paths: [], args: [] }, expectedEvidence: [], retryCount: 0, createdAt: now, updatedAt: now };
}

describe('command code delegation', () => {
  it('captures the session id and emits model-selected events', async () => {
    const stub = makeStubExecutable();
    const workspace = dirname(stub);
    const project: Project = { ...projectBase, path: workspace };
    const adapter = new CommandCodeAdapter({ id: 'command-code', name: 'Command Code', type: 'cli', delegate: 'command-code', executable: process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe', args: ['/c', stub], protocol: 'openai-compatible', enabled: true });
    const store = createMemoryStore();
    const bus = new EventBus();
    const orchestrator = new Orchestrator({ store, bus, agents: new Map([['command-code', adapter]]), defaultAgentId: 'command-code', delegateModelTier: 'free-only' });
    const task = taskFor('command-code', 'minimax/minimax-m3-free');
    store.tasks.upsert(task);

    await orchestrator.execute(project, task);

    const events = store.events.list(project.id);
    expect(events.some((event) => event.type === 'delegate.session' && String(event.payload.sessionId) === 'session-abc')).toBe(true);
    expect(events.some((event) => event.type === 'agent.output' && String(event.payload.content).includes('▶ edit_file'))).toBe(true);
    const updated = store.tasks.list(project.id).find((item) => item.id === 'task-1');
    expect(updated?.status).toBe('completed');
  });
});
