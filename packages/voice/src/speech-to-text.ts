import { WhisperProcess } from './whisper-process';

export interface SpeechToText {
  transcribe(audio: Uint8Array, mimeType?: string): Promise<string>;
}

export class WhisperSpeechToText implements SpeechToText {
  private readonly process: WhisperProcess;

  constructor(whisperExecutable: string) {
    this.process = new WhisperProcess(whisperExecutable);
  }

  transcribe(audio: Uint8Array, mimeType?: string): Promise<string> {
    return this.process.transcribe(audio, mimeType);
  }
}
