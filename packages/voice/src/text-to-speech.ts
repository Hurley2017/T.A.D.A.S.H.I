import { spawn } from 'node:child_process';

export interface TextToSpeech {
  speak(text: string): Promise<void>;
}

export class NativeTextToSpeech implements TextToSpeech {
  async speak(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (process.platform === 'win32') {
      await new Promise<void>((resolve, reject) => {
        // Escaped by hand: any user text with a quote character is turned into SAPI's escaped quote.
        const escaped = trimmed.replace(/'/g, "''");
        const child = spawn(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', `(New-Object -ComObject SAPI.SpVoice).Speak('${escaped}')`],
          { windowsHide: true, stdio: 'ignore', timeout: 60_000 },
        );
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          if (error) reject(error);
          else resolve();
        };
        child.on('error', (error) => finish(new Error(`Voice output is unavailable: ${error.message}`)));
        child.on('close', (code) => finish(code === 0 ? undefined : new Error(`Voice output failed (exit ${code ?? 'unknown'}).`)));
      });
      return;
    }
    await Promise.resolve();
  }
}
