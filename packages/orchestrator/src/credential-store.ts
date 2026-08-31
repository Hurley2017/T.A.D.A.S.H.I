import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface CredentialStore {
  get(name: string): string | undefined;
  set(name: string, value: string): void;
  delete(name: string): void;
}

export class EncryptedCredentialStore implements CredentialStore {
  constructor(private readonly encrypt: (value: string) => string | undefined, private readonly decrypt: (value: string) => string | undefined, private readonly filePath: string) {}

  get(name: string): string | undefined {
    try {
      const state = JSON.parse(readFileSync(this.filePath, 'utf8')) as Record<string, string>;
      return state[name] ? this.decrypt(state[name]) : undefined;
    } catch {
      return undefined;
    }
  }

  set(name: string, value: string): void {
    const encrypted = this.encrypt(value);
    if (!encrypted) throw new Error('OS credential encryption is unavailable.');
    mkdirSync(dirname(this.filePath), { recursive: true });
    let state: Record<string, string> = {};
    try { state = JSON.parse(readFileSync(this.filePath, 'utf8')) as Record<string, string>; } catch { state = {}; }
    state[name] = encrypted;
    writeFileSync(this.filePath, JSON.stringify(state), 'utf8');
  }

  delete(name: string): void {
    try {
      const state = JSON.parse(readFileSync(this.filePath, 'utf8')) as Record<string, string>;
      delete state[name];
      writeFileSync(this.filePath, JSON.stringify(state), 'utf8');
    } catch {}
  }
}

export function redactSecret(text: string, secret?: string): string {
  return secret ? text.split(secret).join('[redacted]') : text;
}
