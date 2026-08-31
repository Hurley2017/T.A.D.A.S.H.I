import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentRun, ApprovalRequest, BrainDecisionRecord, ConversationMessage, Intent, Project, ProjectEvent, Task } from '../../contracts/src';

export interface TadashiStore {
  close(): void;
  projects: {
    list(): Project[];
    upsert(project: Project): Project;
  };
  messages: {
    list(projectId: string): ConversationMessage[];
    add(message: ConversationMessage): ConversationMessage;
  };
  intents: {
    upsert(intent: Intent): Intent;
  };
  brainDecisions: {
    list(projectId: string): BrainDecisionRecord[];
    add(decision: BrainDecisionRecord): BrainDecisionRecord;
  };
  tasks: {
    list(projectId: string): Task[];
    upsert(task: Task): Task;
  };
  runs: {
    list(projectId: string): AgentRun[];
    upsert(run: AgentRun): AgentRun;
  };
  approvals: {
    list(projectId: string): ApprovalRequest[];
    upsert(approval: ApprovalRequest): ApprovalRequest;
  };
  events: {
    list(projectId: string): ProjectEvent[];
    add(event: ProjectEvent): ProjectEvent;
  };
}

type State = {
  projects: Project[];
  messages: ConversationMessage[];
  intents: Intent[];
  brainDecisions: BrainDecisionRecord[];
  tasks: Task[];
  runs: AgentRun[];
  approvals: ApprovalRequest[];
  events: ProjectEvent[];
};

const emptyState = (): State => ({ projects: [], messages: [], intents: [], brainDecisions: [], tasks: [], runs: [], approvals: [], events: [] });

export function createStore(filePath: string): TadashiStore {
  mkdirSync(dirname(filePath), { recursive: true });
  let state = readState(filePath);
  const persist = () => {
    const temporaryPath = `${filePath}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(state), 'utf8');
    renameSync(temporaryPath, filePath);
  };
  const upsert = <T extends { id: string }>(items: T[], item: T): T => {
    const index = items.findIndex((current) => current.id === item.id);
    if (index === -1) items.push(item);
    else items[index] = item;
    persist();
    return item;
  };

  return {
    close: persist,
    projects: {
      list: () => [...state.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      upsert: (project) => upsert(state.projects, project),
    },
    messages: {
      list: (projectId) => state.messages.filter((message) => message.projectId === projectId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      add: (message) => { state.messages.push(message); persist(); return message; },
    },
    intents: {
      upsert: (intent) => upsert(state.intents, intent),
    },
    brainDecisions: {
      list: (projectId) => state.brainDecisions.filter((decision) => decision.projectId === projectId),
      add: (decision) => { state.brainDecisions.push(decision); persist(); return decision; },
    },
    tasks: {
      list: (projectId) => state.tasks.filter((task) => task.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      upsert: (task) => upsert(state.tasks, task),
    },
    runs: {
      list: (projectId) => state.runs.filter((run) => state.tasks.some((task) => task.id === run.taskId && task.projectId === projectId)).sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
      upsert: (run) => upsert(state.runs, run),
    },
    approvals: {
      list: (projectId) => state.approvals.filter((approval) => approval.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      upsert: (approval) => upsert(state.approvals, approval),
    },
    events: {
      list: (projectId) => state.events.filter((event) => event.projectId === projectId).sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
      add: (event) => { state.events.push(event); persist(); return event; },
    },
  };
}

function readState(filePath: string): State {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return emptyState();
    const candidate = parsed as Partial<State>;
    return {
      projects: candidate.projects ?? [], messages: candidate.messages ?? [], intents: candidate.intents ?? [], brainDecisions: candidate.brainDecisions ?? [],
      tasks: candidate.tasks ?? [], runs: candidate.runs ?? [], approvals: candidate.approvals ?? [], events: candidate.events ?? [],
    };
  } catch {
    return emptyState();
  }
}

export function createMemoryStore(): TadashiStore {
  const state = emptyState();
  const upsert = <T extends { id: string }>(items: T[], item: T): T => {
    const index = items.findIndex((current) => current.id === item.id);
    if (index === -1) items.push(item);
    else items[index] = item;
    return item;
  };
  return {
    close: () => undefined,
    projects: { list: () => [...state.projects], upsert: (project) => upsert(state.projects, project) },
    messages: { list: (projectId) => state.messages.filter((message) => message.projectId === projectId), add: (message) => { state.messages.push(message); return message; } },
    intents: { upsert: (intent) => upsert(state.intents, intent) },
    brainDecisions: { list: (projectId) => state.brainDecisions.filter((decision) => decision.projectId === projectId), add: (decision) => { state.brainDecisions.push(decision); return decision; } },
    tasks: { list: (projectId) => state.tasks.filter((task) => task.projectId === projectId), upsert: (task) => upsert(state.tasks, task) },
    runs: { list: (projectId) => state.runs.filter((run) => state.tasks.some((task) => task.id === run.taskId && task.projectId === projectId)), upsert: (run) => upsert(state.runs, run) },
    approvals: { list: (projectId) => state.approvals.filter((approval) => approval.projectId === projectId), upsert: (approval) => upsert(state.approvals, approval) },
    events: { list: (projectId) => state.events.filter((event) => event.projectId === projectId), add: (event) => { state.events.push(event); return event; } },
  };
}
