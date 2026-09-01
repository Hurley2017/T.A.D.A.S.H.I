import { spawn } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export interface TextToSpeech {
  speak(text: string): Promise<void>;
}

export class NativeTextToSpeech implements TextToSpeech {
  async speak(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    
    try {
      const response = await fetch('http://127.0.0.1:8081/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed })
      });
      
      if (!response.ok) throw new Error(`TTS Error: ${response.statusText}`);
      
      const buffer = await response.arrayBuffer();
      const tmpFile = join(tmpdir(), `tts_${Date.now()}.wav`);
      await writeFile(tmpFile, Buffer.from(buffer));
      
      await new Promise<void>((resolve, reject) => {
        let child;
        if (process.platform === 'win32') {
          // Play wav in background without opening media player UI
          child = spawn('powershell.exe', ['-c', `(New-Object System.Media.SoundPlayer '${tmpFile}').PlaySync()`], { windowsHide: true, stdio: 'ignore' });
        } else if (process.platform === 'darwin') {
          child = spawn('afplay', [tmpFile], { windowsHide: true, stdio: 'ignore' });
        } else {
          child = spawn('aplay', [tmpFile], { windowsHide: true, stdio: 'ignore' });
        }
        child.on('error', reject);
        child.on('close', resolve);
      });
      
      await unlink(tmpFile).catch(() => {});
    } catch (e) {
      console.error('Failed to synthesize:', e);
    }
  }
}
