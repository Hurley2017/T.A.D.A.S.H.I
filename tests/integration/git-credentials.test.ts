import { describe, it, expect } from 'vitest';
import { GitService } from '../../packages/orchestrator/src/git-service';
import { EncryptedCredentialStore } from '../../packages/orchestrator/src/credential-store';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('encrypted credentials', () => {
  it('round-trips a token when encryption is available', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tadashi-creds-'));
    const path = join(dir, 'credentials.json');
    const encryption = (value: string) => Buffer.from(value, 'utf8').toString('base64');
    const decryption = (value: string) => Buffer.from(value, 'base64').toString('utf8');
    const store = new EncryptedCredentialStore(encryption, decryption, path);
    store.set('github.com', 'token-1');
    expect(store.get('github.com')).toBe('token-1');
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports whether credentials are configured', () => {
    const git = new GitService({ get: () => undefined, set: () => undefined, delete: () => undefined });
    expect(git.credentialStatus().configured).toBe(false);
    const configured = new GitService({ get: () => 'token', set: () => undefined, delete: () => undefined });
    expect(configured.credentialStatus().configured).toBe(true);
  });
});
