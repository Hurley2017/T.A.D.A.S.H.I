import type { TextToSpeech } from './text-to-speech';

export class TtsQueue {
  private current: Promise<void> | undefined;

  constructor(private readonly speaker: TextToSpeech) {}

  enqueue(text: string): Promise<void> {
    const next = (this.current ?? Promise.resolve()).then(() => this.speaker.speak(text));
    this.current = next.catch(() => undefined);
    return next;
  }

  async wait(): Promise<void> {
    await this.current;
  }
}
