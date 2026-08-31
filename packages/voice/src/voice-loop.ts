export type VoiceState = 'idle' | 'listening' | 'wake-detected' | 'recording' | 'transcribing' | 'thinking' | 'speaking' | 'muted' | 'error';

export interface VoiceLoopConfig {
  enabled: boolean;
  wakePhrase: string;
  rmsThreshold: number;
  silenceMs: number;
  maxCaptureMs: number;
}

export const defaultVoiceLoopConfig: VoiceLoopConfig = {
  enabled: false,
  wakePhrase: 'tadashi',
  rmsThreshold: 0.02,
  silenceMs: 1500,
  maxCaptureMs: 15_000,
};

export function computeRms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(samples.length, 1));
}

export function removeWakePhrase(transcript: string, wakePhrase: string): string {
  const normalized = transcript.toLowerCase();
  const target = wakePhrase.toLowerCase();
  const index = normalized.indexOf(target);
  if (index < 0) return transcript.trim();
  return transcript.slice(index + target.length).trim();
}

export class VoiceLoop {
  private state: VoiceState = 'idle';
  private captureStartedAt = 0;
  private lastSpeechAt = 0;

  constructor(private readonly config: VoiceLoopConfig) {}

  current(): VoiceState { return this.state; }

  enable(): void { if (this.state === 'idle' || this.state === 'error') this.state = 'listening'; }
  disable(): void { this.state = 'idle'; }
  mute(): void { this.state = 'muted'; }
  unmute(): void { if (this.state === 'muted') this.state = 'listening'; }

  detectWake(transcript: string): boolean {
    if (!this.config.enabled || this.state !== 'listening') return false;
    if (transcript.toLowerCase().includes(this.config.wakePhrase.toLowerCase())) { this.state = 'wake-detected'; return true; }
    return false;
  }

  startCapture(): void { if (this.state === 'wake-detected' || this.state === 'listening') { this.state = 'recording'; this.captureStartedAt = Date.now(); this.lastSpeechAt = this.captureStartedAt; } }

  sample(samples: Float32Array, now: number): 'continue' | 'silence' | 'timeout' {
    if (this.state !== 'recording') return 'continue';
    const rms = computeRms(samples);
    if (rms >= this.config.rmsThreshold) this.lastSpeechAt = now;
    if (now - this.lastSpeechAt >= this.config.silenceMs) return 'silence';
    if (now - this.captureStartedAt >= this.config.maxCaptureMs) return 'timeout';
    return 'continue';
  }

  transcribe(): void { if (this.state === 'recording') this.state = 'transcribing'; }

  think(): void { if (this.state === 'transcribing') this.state = 'thinking'; }

  speak(): void { if (this.state !== 'muted' && this.state !== 'error') this.state = 'speaking'; }

  finishSpeak(): void { if (this.state === 'speaking') this.state = this.config.enabled ? 'listening' : 'idle'; }

  fail(message: string): void { this.state = 'error'; void message; }
}
