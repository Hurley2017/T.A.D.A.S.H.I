import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { AgentAdapter, AgentOutputEvent } from '../../agents/src';
import { assertAgentWorkspace } from '../../agents/src';
import type { BrainContext, BrainDecision, BrainService } from '../../brain/src';
import { selectDelegateModel } from '../../brain/src';
import type { TadashiStore } from '../../persistence/src';
import type { AgentRun, Intent, Project, ProjectEvent, Task } from '../../contracts/src';
import { EventBus } from '../../monitoring/src';
import type { TextToSpeech } from '../../voice/src';

const isoNow = () => new Date().toISOString();

export interface OrchestratorDeps {
  store: TadashiStore;
  bus: EventBus;
  agents: Map<string, AgentAdapter>;
  defaultAgentId?: string;
  brain?: BrainService;
  speaker?: TextToSpeech;
  delegateModelTier?: 'free-only' | 'auto';
}

export interface SubmitResult {
  messageId: string;
  task?: Task;
  tasks?: Task[];
  question?: string;
  response: string;
  brainMode: 'llm' | 'fallback';
  decisionKind: BrainDecision['kind'];
}

export class Orchestrator {
  private readonly delegateSessions = new Map<string, string>();

  constructor(private readonly deps: OrchestratorDeps) {}

  async submit(project: Project, content: string): Promise<SubmitResult> {
    const createdAt = isoNow();
    const messageId = randomUUID();
    this.deps.store.messages.add({ id: messageId, projectId: project.id, role: 'user', content, createdAt });
    this.emit(project.id, 'conversation.transcript', { messageId, content });

    const context = await this.buildContext(project);
    let decision: BrainDecision;
    let brainMode: SubmitResult['brainMode'] = 'llm';
    try {
      decision = this.deps.brain ? await this.deps.brain.decide(content, context) : this.fallbackDecision(project, content);
      if (!this.deps.brain) brainMode = 'fallback';
    } catch (error) {
      brainMode = 'fallback';
      decision = this.fallbackDecision(project, content);
      this.emit(project.id, 'brain.fallback', { reason: error instanceof Error ? error.message : 'Brain request failed.' });
    }

    this.deps.store.brainDecisions.add({ id: randomUUID(), projectId: project.id, input: content, kind: decision.kind, response: decision.response, valid: brainMode === 'llm', createdAt: isoNow() });
    this.emit(project.id, brainMode === 'llm' ? 'brain.assessed' : 'brain.fallback', { kind: decision.kind, response: decision.response });
    const intent: Intent = { id: randomUUID(), projectId: project.id, sourceMessageId: messageId, objective: content.trim(), constraints: [], requestedAutonomy: decision.kind === 'plan' ? 'propose' : 'observe', ambiguities: decision.kind === 'clarify' ? decision.questions : [], createdAt };
    this.deps.store.intents.upsert(intent);
    this.respond(project.id, decision.response);

    if (decision.kind === 'clarify') {
      const question = decision.questions[0];
      this.emit(project.id, 'clarification.requested', { question });
      return { messageId, question, response: decision.response, brainMode, decisionKind: decision.kind };
    }
    if (decision.kind !== 'plan') {
      return { messageId, response: decision.response, brainMode, decisionKind: decision.kind };
    }

    if (brainMode === 'llm') this.validatePlan(decision, project);
    const tier = this.deps.delegateModelTier ?? 'free-only';
    const complexity = decision.tasks.length > 3 ? 'high' : decision.tasks.length > 1 ? 'medium' : 'low';
    const tasks = decision.tasks.map((plannedTask) => {
      const selection = selectDelegateModel(plannedTask.complexity ?? complexity, tier);
      const task: Task = {
        id: plannedTask.id,
        projectId: project.id,
        intentId: intent.id,
        title: plannedTask.title,
        description: plannedTask.description,
        status: 'awaiting-approval',
        agentId: plannedTask.agentId,
        dependsOn: plannedTask.dependsOn,
        action: plannedTask.action,
        expectedEvidence: plannedTask.expectedEvidence,
        retryCount: 0,
        modelId: selection.modelId,
        modelRationale: selection.rationale,
        createdAt,
        updatedAt: createdAt,
      };
      this.deps.store.tasks.upsert(task);
      this.emit(project.id, 'task.created', { taskId: task.id, title: task.title, dependsOn: task.dependsOn, agentId: task.agentId });
      this.emit(project.id, 'delegate.model-selected', { taskId: task.id, modelId: selection.modelId, modelName: selection.modelName, intelligence: selection.intelligence, costPer1mIn: selection.costPer1mIn, costPer1mOut: selection.costPer1mOut, free: selection.free, reason: selection.rationale, escalationNeeded: selection.escalationNeeded });
      return task;
    });
    return { messageId, task: tasks[0], tasks, response: decision.response, brainMode, decisionKind: decision.kind };
  }

  async execute(project: Project, task: Task, onEvent?: (event: AgentOutputEvent) => void): Promise<void> {
    const adapter = this.deps.agents.get(task.agentId);
    if (!adapter) {
      this.updateTask(task, 'blocked');
      this.emit(project.id, 'blocker.detected', { taskId: task.id, message: `No enabled agent is configured for ${task.agentId}.` });
      throw new Error(`No enabled agent is configured for ${task.agentId}.`);
    }
    const dependencies = (task.dependsOn ?? []).map((dependencyId) => this.deps.store.tasks.list(project.id).find((candidate) => candidate.id === dependencyId));
    if (dependencies.some((dependency) => dependency?.status !== 'completed')) {
      this.updateTask(task, 'blocked');
      this.emit(project.id, 'blocker.detected', { taskId: task.id, message: 'This task is waiting for its dependencies to complete.' });
      throw new Error('Task dependencies are not complete.');
    }
    assertAgentWorkspace(project.path, project.path);
    const run: AgentRun = { id: randomUUID(), taskId: task.id, agentId: task.agentId, status: 'starting', startedAt: isoNow() };
    this.deps.store.runs.upsert(run);
    this.deps.store.runs.upsert({ ...run, status: 'running' });
    this.updateTask(task, 'running');
    this.emit(project.id, 'agent.started', { runId: run.id, taskId: task.id, agentId: task.agentId });

    const sessionKey = `${project.id}:${task.agentId}`;
    const sessionId = this.delegateSessions.get(sessionKey);
    let finalStatus: AgentRun['status'] = 'completed';
    let finalEvent: AgentOutputEvent | undefined;
    try {
      for await (const event of adapter.run({
        runId: run.id, taskId: task.id, workspace: project.path, projectPath: project.path,
        prompt: task.description, model: task.modelId, sessionId, allowWrites: true,
      })) {
        onEvent?.(event);
        if (event.type === 'output') {
          const sessionMatch = /^session:(.+)$/.exec(event.content);
          if (sessionMatch) {
            this.delegateSessions.set(sessionKey, sessionMatch[1]);
            this.emit(project.id, 'delegate.session', { projectId: project.id, agentId: task.agentId, sessionId: sessionMatch[1] });
          } else {
            this.emit(project.id, 'agent.output', { runId: run.id, stream: event.stream, content: event.content });
          }
        }
        if (event.type === 'failed') finalStatus = event.error === 'Agent timed out.' ? 'timed-out' : 'failed';
        if (event.type === 'cancelled') finalStatus = 'cancelled';
        if (event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled') finalEvent = event;
      }
    } catch (error) {
      finalStatus = 'failed';
      const errorMessage = error instanceof Error ? error.message : 'Agent execution failed.';
      finalEvent = { type: 'failed', runId: run.id, error: errorMessage };
      this.emit(project.id, 'blocker.detected', { taskId: task.id, runId: run.id, message: errorMessage });
    }

    const endedAt = isoNow();
    this.deps.store.runs.upsert({ ...run, status: finalStatus, endedAt, exitCode: finalEvent?.type === 'completed' ? finalEvent.exitCode : undefined });
    const taskStatus: Task['status'] = finalStatus === 'completed' ? 'completed' : finalStatus === 'cancelled' ? 'cancelled' : 'failed';
    this.updateTask(task, taskStatus);
    this.emit(project.id, 'agent.completed', { runId: run.id, status: finalStatus });

    if (this.deps.brain && finalStatus === 'completed') {
      try {
        const evaluation = await this.deps.brain.evaluate(`Evaluate task ${task.title}. The worker completed successfully.`, await this.buildContext(project));
        this.emit(project.id, 'brain.assessed', { kind: 'evaluate', outcome: evaluation.outcome, evidence: evaluation.evidence });
        if (evaluation.outcome === 'blocked' || evaluation.outcome === 'needs-user') {
          this.updateTask(task, 'blocked');
          this.emit(project.id, 'blocker.detected', { taskId: task.id, message: evaluation.response, evidence: evaluation.evidence });
        }
        this.respond(project.id, evaluation.response);
      } catch (error) {
        this.emit(project.id, 'brain.fallback', { reason: error instanceof Error ? error.message : 'Evaluation failed.' });
      }
    }
  }

  private async buildContext(project: Project): Promise<BrainContext> {
    const agentEntries = await Promise.all([...this.deps.agents.entries()].map(async ([id, agent]) => {
      const capabilities = await agent.capabilities();
      return { id, name: agent.config.name, type: agent.config.type, ...capabilities };
    }));
    return {
      project: { id: project.id, name: project.name, path: project.path },
      recentMessages: this.deps.store.messages.list(project.id).slice(-20).map((message) => ({ role: message.role === 'system' ? 'system' : message.role, content: message.content })),
      tasks: this.deps.store.tasks.list(project.id).slice(0, 50).map((task) => ({ id: task.id, title: task.title, status: task.status, agentId: task.agentId })),
      recentEvents: this.deps.store.events.list(project.id).slice(-50).map((event) => ({ type: event.type, timestamp: event.timestamp, summary: summarizeEvent(event) })),
      agents: agentEntries,
    };
  }

  private validatePlan(decision: Extract<BrainDecision, { kind: 'plan' }>, project: Project): void {
    const ids = new Set(decision.tasks.map((task) => task.id));
    for (const task of decision.tasks) {
      if (!this.deps.agents.has(task.agentId)) throw new Error(`Brain selected an unavailable agent: ${task.agentId}.`);
      if (task.dependsOn.some((dependencyId) => dependencyId === task.id || !ids.has(dependencyId))) throw new Error(`Brain returned an invalid dependency for ${task.id}.`);
      if (task.action.type === 'command' && (!task.action.executable || task.action.args.length === 0)) throw new Error(`Command action ${task.id} is missing an executable or arguments.`);
    }
    if (decision.tasks.some((task) => task.action.paths.some((path) => path.includes('..')))) throw new Error(`Brain proposed an unsafe project path for ${project.name}.`);
  }

  private fallbackDecision(project: Project, content: string): BrainDecision {
    if (content.trim().length < 12) return { kind: 'clarify', response: 'I need a little more signal before I move. What would you like me to change or investigate?', questions: ['What would you like me to change or investigate?'] };
    const agentId = this.deps.defaultAgentId ?? this.deps.agents.keys().next().value ?? 'local-cli';
    return {
      kind: 'plan',
      response: `I’ve scoped this as one controlled task for ${project.name}. I’ll pause at the safety gate before routing it.`,
      tasks: [{ id: randomUUID(), title: content.trim().slice(0, 54), description: content.trim(), agentId, dependsOn: [], action: { type: 'agent', summary: `Start ${agentId} for this task.`, paths: [project.path], args: [] }, expectedEvidence: ['Worker output and resulting project signals.'], complexity: 'medium', estimatedTokens: 0 }],
    };
  }

  private respond(projectId: string, response: string): void {
    this.deps.store.messages.add({ id: randomUUID(), projectId, role: 'assistant', content: response, createdAt: isoNow() });
    this.emit(projectId, 'assistant.responded', { response });
    if (this.deps.speaker) void this.deps.speaker.speak(response).catch(() => undefined);
  }

  private updateTask(task: Task, status: Task['status']): void {
    const updatedAt = isoNow();
    this.deps.store.tasks.upsert({ ...task, status, updatedAt, completedAt: status === 'completed' ? updatedAt : undefined });
    this.emit(task.projectId, 'task.updated', { taskId: task.id, status });
  }

  private emit(projectId: string, type: ProjectEvent['type'], payload: Record<string, unknown>): void {
    const event: ProjectEvent = { id: randomUUID(), projectId, type, timestamp: isoNow(), payload };
    this.deps.store.events.add(event);
    this.deps.bus.publish(event);
  }
}

function summarizeEvent(event: ProjectEvent): string {
  const payload = event.payload;
  if (typeof payload.message === 'string') return payload.message.slice(0, 240);
  if (typeof payload.content === 'string') return payload.content.slice(0, 240);
  if (typeof payload.path === 'string') return `${payload.change ?? 'changed'} ${payload.path}`;
  return event.type;
}

export function projectFromPath(path: string): Project {
  const timestamp = isoNow();
  return { id: randomUUID(), name: basename(path), path, createdAt: timestamp, updatedAt: timestamp };
}
