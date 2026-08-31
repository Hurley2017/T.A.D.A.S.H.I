import type { Project } from '../../contracts/src';
import type { CredentialStore } from './credential-store';

export interface HostRepository {
  owner: string;
  name: string;
  description: string;
  defaultBranch: string;
  isPrivate: boolean;
  url: string;
}

export interface RemoteRepositoryRequest {
  repo: string;
  description: string;
  isPrivate: boolean;
  source: Project;
}

export interface PullRequestRequest {
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
}

export interface PullRequest {
  number: number;
  url: string;
  title: string;
}

export interface GitHostProvider {
  readonly name: string;
  validateCredentials(): Promise<{ ok: boolean; user?: string }>;
  createRepository(request: RemoteRepositoryRequest): Promise<HostRepository>;
  openPullRequest(request: PullRequestRequest): Promise<PullRequest>;
}

export class GitHubProvider implements GitHostProvider {
  readonly name = 'github';

  constructor(private readonly credentials: CredentialStore, private readonly endpoint = 'https://api.github.com') {}

  async validateCredentials(): Promise<{ ok: boolean; user?: string }> {
    const token = this.credentials.get('git-token');
    if (!token) return { ok: false };
    const response = await fetch(`${this.endpoint}/user`, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' } });
    if (!response.ok) return { ok: false };
    const user = await response.json().catch(() => undefined) as { login?: string } | undefined;
    return { ok: true, user: user?.login };
  }

  async createRepository(request: RemoteRepositoryRequest): Promise<HostRepository> {
    const token = this.credentials.get('git-token');
    if (!token) throw new Error('GitHub credentials are not configured.');
    const response = await fetch(`${this.endpoint}/user/repos`, { method: 'POST', headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' }, body: JSON.stringify({ name: request.repo, description: request.description, private: request.isPrivate, auto_init: true }) });
    if (!response.ok) throw new Error(`GitHub create repository failed (${response.status}).`);
    const repo = await response.json() as { name: string; full_name: string; html_url: string; description?: string; default_branch?: string; private?: boolean };
    return { owner: repo.full_name.split('/')[0], name: repo.name, description: repo.description ?? '', defaultBranch: repo.default_branch ?? 'main', isPrivate: Boolean(repo.private), url: repo.html_url };
  }

  async openPullRequest(request: PullRequestRequest): Promise<PullRequest> {
    const token = this.credentials.get('git-token');
    if (!token) throw new Error('GitHub credentials are not configured.');
    const response = await fetch(`${this.endpoint}/repos/${request.owner}/${request.repo}/pulls`, { method: 'POST', headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' }, body: JSON.stringify({ title: request.title, body: request.body, head: request.head, base: request.base }) });
    if (!response.ok) throw new Error(`GitHub open pull request failed (${response.status}).`);
    const pull = await response.json() as { number: number; html_url: string; title: string };
    return { number: pull.number, url: pull.html_url, title: pull.title };
  }
}

export class GitLabProvider implements GitHostProvider {
  readonly name = 'gitlab';

  constructor(private readonly credentials: CredentialStore, private readonly endpoint = 'https://gitlab.com/api/v4') {}

  async validateCredentials(): Promise<{ ok: boolean; user?: string }> {
    const token = this.credentials.get('git-token');
    if (!token) return { ok: false };
    const response = await fetch(`${this.endpoint}/user`, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) return { ok: false };
    const user = await response.json().catch(() => undefined) as { username?: string } | undefined;
    return { ok: true, user: user?.username };
  }

  async createRepository(request: RemoteRepositoryRequest): Promise<HostRepository> {
    const token = this.credentials.get('git-token');
    if (!token) throw new Error('GitLab credentials are not configured.');
    const response = await fetch(`${this.endpoint}/projects`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: request.repo, description: request.description, visibility: request.isPrivate ? 'private' : 'public', initialize_with_readme: true }) });
    if (!response.ok) throw new Error(`GitLab create project failed (${response.status}).`);
    const repo = await response.json() as { path_with_namespace: string; name: string; description?: string; default_branch?: string; visibility: string; web_url: string };
    const [owner, name] = repo.path_with_namespace.split('/');
    return { owner, name, description: repo.description ?? '', defaultBranch: repo.default_branch ?? 'main', isPrivate: repo.visibility === 'private', url: repo.web_url };
  }

  async openPullRequest(request: PullRequestRequest): Promise<PullRequest> {
    const token = this.credentials.get('git-token');
    if (!token) throw new Error('GitLab credentials are not configured.');
    const url = `${this.endpoint}/projects/${encodeURIComponent(`${request.owner}/${request.repo}`)}/merge_requests`;
    const response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ title: request.title, description: request.body, source_branch: request.head, target_branch: request.base }) });
    if (!response.ok) throw new Error(`GitLab open merge request failed (${response.status}).`);
    const merge = await response.json() as { iid: number; web_url: string; title: string };
    return { number: merge.iid, url: merge.web_url, title: merge.title };
  }
}

export function selectGitHostProvider(provider: string, credentials: CredentialStore): GitHostProvider {
  if (provider === 'gitlab') return new GitLabProvider(credentials);
  return new GitHubProvider(credentials);
}
