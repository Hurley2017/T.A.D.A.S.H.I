import { spawn } from 'node:child_process';

export interface TextToSpeech {
  speak(text: string): Promise<void>;
}

export class NativeTextToSpeech implements TextToSpeech {
  async speak(text: string): Promise<void> {
    if (process.platform === 'win32') {
      await new Promise<void>((resolve, reject) => {
        const escaped = text.replace(/'/g, "''");
        const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', `(New-Object -ComObject SAPI.SpVoice).Speak('${escaped}')`], { windowsHide: true });
        child.on('error', reject);
        child.on('close', () => resolve());
      });
      return;
    }
    await Promise.resolve();
  }
}
