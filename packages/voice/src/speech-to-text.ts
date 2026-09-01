export interface SpeechToText {
  transcribe(audio: Uint8Array, mimeType?: string): Promise<string>;
}

export class WhisperSpeechToText implements SpeechToText {
  constructor(whisperExecutable: string, modelPath?: string) {}

  async transcribe(audio: Uint8Array, mimeType?: string): Promise<string> {
    const blob = new Blob([audio], { type: mimeType || 'audio/wav' });
    
    const response = await fetch('http://127.0.0.1:8081/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': mimeType || 'audio/wav' },
      body: blob
    });
    
    if (!response.ok) {
      throw new Error(`STT Error: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.text;
  }
}
