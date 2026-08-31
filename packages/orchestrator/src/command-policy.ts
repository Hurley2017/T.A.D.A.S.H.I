export type AutonomyLevel = 'observe' | 'propose' | 'execute';

export interface AutonomyPolicy {
  voiceConfirmedDestructive: boolean;
  voiceConfirmedNetwork: boolean;
  voiceConfirmedGitPush: boolean;
  voiceConfirmedProjectDelete: boolean;
  voiceConfirmedForceOperation: boolean;
  allowedProjects: 'all' | 'selected' | 'explicit';
}

export const defaultAutonomyPolicy: AutonomyPolicy = {
  voiceConfirmedDestructive: true,
  voiceConfirmedNetwork: true,
  voiceConfirmedGitPush: true,
  voiceConfirmedProjectDelete: true,
  voiceConfirmedForceOperation: true,
  allowedProjects: 'selected',
};

export function requiresVoiceConfirmation(policy: AutonomyPolicy, action: RuntimeAction): boolean {
  if (!policy.voiceConfirmedDestructive && action.destructive) return false;
  if (!policy.voiceConfirmedNetwork && action.network) return false;
  if (!policy.voiceConfirmedGitPush && action.gitPush) return false;
  if (!policy.voiceConfirmedProjectDelete && action.projectDelete) return false;
  if (!policy.voiceConfirmedForceOperation && action.force) return false;
  return action.destructive || action.network || action.gitPush || action.projectDelete || action.force;
}

export interface RuntimeAction {
  destructive: boolean;
  network: boolean;
  gitPush: boolean;
  projectDelete: boolean;
  force: boolean;
}
