import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export class WhisperProcess {
  constructor(private readonly executable: string, private readonly modelPath?: string) {}

  async transcribe(audio: Uint8Array, mimeType = 'audio/wav'): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'tadashi-whisper-'));
    const extension = mimeType.includes('webm') ? 'webm' : mimeType.includes('ogg') ? 'ogg' : 'wav';
    const inputPath = join(directory, `input.${extension}`);
    const outputBasePath = join(directory, 'transcript');
    const outputPath = `${outputBasePath}.txt`;
    await writeFile(inputPath, audio);
    try {
      await new Promise<void>((resolve, reject) => {
        const args = ['-f', inputPath, '-otxt', '-of', outputBasePath];
        if (this.modelPath) args.push('-m', this.modelPath);
        const child = spawn(this.executable, args, { shell: false, windowsHide: true });
        let stderr = '';
        child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
        child.on('error', reject);
        child.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `Whisper exited with code ${code ?? 'unknown'}.`)));
      });
      return (await readFile(outputPath, 'utf8')).trim();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

export async function assertWhisperAvailable(executable: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, ['--help'], { shell: false, windowsHide: true });
    child.on('error', reject);
    child.on('close', (code) => code === 0 || code === 1 ? resolve() : reject(new Error(`Whisper executable exited with code ${code ?? 'unknown'}.`)));
  });
}
