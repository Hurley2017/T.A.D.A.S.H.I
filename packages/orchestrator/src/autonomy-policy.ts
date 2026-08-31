export type AutonomyKind = 'force_operation' | 'network_mutation' | 'git_push' | 'project_delete' | 'project_create';

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

export interface AutonomyDecision {
  allowed: boolean;
  reason: string;
  requiresVoiceConfirmation: boolean;
}

export function evaluateAutonomyRequest(policy: AutonomyPolicy, request: { kind: AutonomyKind; description: string }): AutonomyDecision {
  switch (request.kind) {
    case 'force_operation':
      return policy.voiceConfirmedForceOperation
        ? { allowed: false, reason: 'Force operations always require explicit human approval.', requiresVoiceConfirmation: true }
        : { allowed: true, reason: '', requiresVoiceConfirmation: false };
    case 'network_mutation':
      return policy.voiceConfirmedNetwork
        ? { allowed: false, reason: 'Network mutations require an explicit confirmation.', requiresVoiceConfirmation: true }
        : { allowed: true, reason: '', requiresVoiceConfirmation: false };
    case 'git_push':
      return policy.voiceConfirmedGitPush
        ? { allowed: false, reason: 'Pushing to Git requires an explicit confirmation.', requiresVoiceConfirmation: true }
        : { allowed: true, reason: '', requiresVoiceConfirmation: false };
    case 'project_delete':
      return policy.voiceConfirmedProjectDelete
        ? { allowed: false, reason: 'Deleting a project requires an explicit confirmation.', requiresVoiceConfirmation: true }
        : { allowed: true, reason: '', requiresVoiceConfirmation: false };
    case 'project_create':
      return { allowed: true, reason: '', requiresVoiceConfirmation: false };
  }
}
