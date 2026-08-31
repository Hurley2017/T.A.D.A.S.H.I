import { useState } from 'react';

type OnboardingProps = {
  hasProject: boolean;
  hasVoice: boolean;
  hasDelegate: boolean;
  brainOnline: boolean;
  onOpenProject: () => void;
  onOpenSettings: () => void;
  onDismiss: () => void;
};

export function Onboarding({ hasProject, hasVoice, hasDelegate, brainOnline, onOpenProject, onOpenSettings, onDismiss }: OnboardingProps) {
  const [step, setStep] = useState(0);

  const steps = [
    {
      icon: '◎',
      title: 'Welcome to T.A.D.A.S.H.I.',
      body: "I'm your voice-first project orchestrator. I listen, plan the work, delegate to a coding agent, and report back — so you don't have to type.",
      action: () => setStep(1),
      label: 'Continue',
    },
    {
      icon: '⌂',
      title: 'Point me at a project',
      body: 'I work inside one project folder at a time. Open the folder and I will start watching its files and git signals automatically.',
      action: () => { setStep(2); onOpenProject(); },
      label: hasProject ? 'Got it' : 'Choose project folder',
    },
    {
      icon: '🎙',
      title: 'How to talk to me',
      body: 'Click the mic button (or press the Voice button) and hold it while you speak. Release — I transcribe your words and fill the box, then you press "Route instruction". I will also speak my replies aloud.',
      action: () => setStep(3),
      label: hasVoice ? 'Got it' : 'Set up voice',
    },
    {
      icon: '◇',
      title: 'Connect your worker',
      body: hasDelegate
        ? 'Your worker is connected. I delegate coding tasks to it and stream live progress here.'
        : 'I delegate coding tasks to the Command Code worker. Connect it now — install first, then sign in once. After that it runs hidden.',
      action: () => { setStep(4); onOpenSettings(); },
      label: hasDelegate ? 'Got it' : 'Connect worker',
    },
    {
      icon: '✓',
      title: 'You are ready',
      body: `Brain ${brainOnline ? 'online' : 'loading'}. ${hasProject ? 'Project selected.' : 'Pick a project when you are ready.'} Try saying: "Find why the latest build fails."`,
      action: onDismiss,
      label: 'Start using T.A.D.A.S.H.I.',
    },
  ];

  const current = steps[step];
  return (
    <div className="onboarding" role="dialog" aria-label="TADASHI onboarding">
      <div className="onboarding-card">
        <div className="onboarding-progress" aria-hidden="true">{steps.map((_, index) => <span key={index} className={index <= step ? 'is-active' : ''} />)}</div>
        <div className="onboarding-icon" aria-hidden="true">{current.icon}</div>
        <h2>{current.title}</h2>
        <p>{current.body}</p>
        <div className="onboarding-actions">
          <button className="ghost-button" type="button" onClick={onDismiss}>Skip</button>
          <button className="primary-button" type="button" onClick={current.action}>{current.label}</button>
        </div>
      </div>
    </div>
  );
}
