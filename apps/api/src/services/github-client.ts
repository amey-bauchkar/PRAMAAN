import { computeGitBlobSha, computeRawFileHash } from '@pramaan/domain';

export interface GitHubOAuthTokenResponse {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  scope: string;
  expiresIn?: number;
}

export interface GitHubUserResponse {
  id: number;
  login: string;
  type: string;
  name?: string;
  email?: string;
}

export interface GitHubRepoAccessResponse {
  accessible: boolean;
  repoId: number;
  owner: string;
  name: string;
  defaultBranch: string;
  isPrivate: boolean;
  permissions: {
    admin?: boolean;
    push?: boolean;
    pull?: boolean;
  };
}

export interface GitHubCommitResponse {
  commitSha: string;
  treeSha: string;
  message: string;
  author?: {
    name?: string;
    email?: string;
    date?: string;
  };
}

export interface GitHubTreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
  url?: string;
}

export interface GitHubTreeResponse {
  sha: string;
  truncated: boolean;
  tree: GitHubTreeEntry[];
}

export interface GitHubBlobResponse {
  sha: string;
  size: number;
  content: string;
  encoding: 'base64' | 'utf-8';
}

export interface IGitHubClient {
  exchangeOAuthCode(
    code: string,
    codeVerifier: string,
    redirectUri: string
  ): Promise<GitHubOAuthTokenResponse>;

  getAuthenticatedUser(accessToken: string): Promise<GitHubUserResponse>;

  verifyRepositoryAccess(
    accessToken: string,
    owner: string,
    repo: string
  ): Promise<GitHubRepoAccessResponse>;

  resolveCommit(
    accessToken: string,
    owner: string,
    repo: string,
    ref: string
  ): Promise<GitHubCommitResponse>;

  getTree(
    accessToken: string,
    owner: string,
    repo: string,
    treeSha: string,
    recursive?: boolean
  ): Promise<GitHubTreeResponse>;

  getBlob(
    accessToken: string,
    owner: string,
    repo: string,
    blobSha: string
  ): Promise<GitHubBlobResponse>;
}

export interface GitHubClientOptions {
  clientId?: string;
  clientSecret?: string;
  apiBaseUrl?: string;
  oauthBaseUrl?: string;
  fetchFn?: typeof fetch;
}

export class DefaultGitHubClient implements IGitHubClient {
  private clientId: string;
  private clientSecret: string;
  private apiBaseUrl: string;
  private oauthBaseUrl: string;
  private fetchFn: typeof fetch;

  constructor(opts: GitHubClientOptions = {}) {
    this.clientId = opts.clientId ?? process.env.GITHUB_CLIENT_ID ?? '';
    this.clientSecret = opts.clientSecret ?? process.env.GITHUB_CLIENT_SECRET ?? '';
    this.apiBaseUrl = (opts.apiBaseUrl ?? process.env.GITHUB_API_BASE_URL ?? 'https://api.github.com').replace(/\/$/, '');
    this.oauthBaseUrl = (opts.oauthBaseUrl ?? process.env.GITHUB_OAUTH_BASE_URL ?? 'https://github.com').replace(/\/$/, '');
    this.fetchFn = opts.fetchFn ?? globalThis.fetch;
  }

  private validateOwnerAndRepo(owner: string, repo: string): void {
    if (!/^[a-zA-Z0-9_.-]+$/.test(owner)) {
      throw new Error(`INVALID_REPOSITORY_OWNER: '${owner}' contains illegal characters`);
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(repo)) {
      throw new Error(`INVALID_REPOSITORY_NAME: '${repo}' contains illegal characters`);
    }
  }

  public async exchangeOAuthCode(
    code: string,
    codeVerifier: string,
    redirectUri: string
  ): Promise<GitHubOAuthTokenResponse> {
    if (!this.clientId) {
      throw new Error('GITHUB_CONFIG_ERROR: GITHUB_CLIENT_ID is not configured');
    }

    const body: Record<string, string> = {
      client_id: this.clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    };
    if (this.clientSecret) {
      body.client_secret = this.clientSecret;
    }

    const res = await this.fetchFn(`${this.oauthBaseUrl}/login/oauth/access_token`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'PRAMAAN-Ingestion-Service',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`GITHUB_OAUTH_EXCHANGE_FAILED: HTTP ${res.status}`);
    }

    const data = await res.json() as any;
    if (data.error) {
      throw new Error(`GITHUB_OAUTH_ERROR: ${data.error_description || data.error}`);
    }

    if (!data.access_token) {
      throw new Error('GITHUB_OAUTH_RESPONSE_MISSING_TOKEN');
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenType: data.token_type || 'bearer',
      scope: data.scope || '',
      expiresIn: data.expires_in,
    };
  }

  public async getAuthenticatedUser(accessToken: string): Promise<GitHubUserResponse> {
    const res = await this.fetchFn(`${this.apiBaseUrl}/user`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'PRAMAAN-Ingestion-Service',
      },
    });

    if (!res.ok) {
      throw new Error(`GITHUB_USER_LOOKUP_FAILED: HTTP ${res.status}`);
    }

    const data = await res.json() as any;
    return {
      id: data.id,
      login: data.login,
      type: data.type || 'User',
      name: data.name,
      email: data.email,
    };
  }

  public async verifyRepositoryAccess(
    accessToken: string,
    owner: string,
    repo: string
  ): Promise<GitHubRepoAccessResponse> {
    this.validateOwnerAndRepo(owner, repo);

    const res = await this.fetchFn(`${this.apiBaseUrl}/repos/${owner}/${repo}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'PRAMAAN-Ingestion-Service',
      },
    });

    if (res.status === 404 || res.status === 403) {
      return {
        accessible: false,
        repoId: 0,
        owner,
        name: repo,
        defaultBranch: 'main',
        isPrivate: true,
        permissions: {},
      };
    }

    if (!res.ok) {
      throw new Error(`GITHUB_REPO_LOOKUP_FAILED: HTTP ${res.status}`);
    }

    const data = await res.json() as any;
    return {
      accessible: true,
      repoId: data.id,
      owner: data.owner?.login || owner,
      name: data.name,
      defaultBranch: data.default_branch || 'main',
      isPrivate: Boolean(data.private),
      permissions: data.permissions || { pull: true },
    };
  }

  public async resolveCommit(
    accessToken: string,
    owner: string,
    repo: string,
    ref: string
  ): Promise<GitHubCommitResponse> {
    this.validateOwnerAndRepo(owner, repo);

    const cleanRef = encodeURIComponent(ref.trim());
    const res = await this.fetchFn(`${this.apiBaseUrl}/repos/${owner}/${repo}/commits/${cleanRef}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'PRAMAAN-Ingestion-Service',
      },
    });

    if (!res.ok) {
      throw new Error(`GITHUB_COMMIT_NOT_FOUND: Ref '${ref}' on ${owner}/${repo} returned HTTP ${res.status}`);
    }

    const data = await res.json() as any;
    const commitSha = data.sha;
    const treeSha = data.commit?.tree?.sha;

    if (!commitSha || !treeSha) {
      throw new Error('GITHUB_MALFORMED_COMMIT_OBJECT: Missing commitSha or treeSha');
    }

    return {
      commitSha: commitSha.toLowerCase(),
      treeSha: treeSha.toLowerCase(),
      message: data.commit?.message || '',
      author: data.commit?.author,
    };
  }

  public async getTree(
    accessToken: string,
    owner: string,
    repo: string,
    treeSha: string,
    recursive = false
  ): Promise<GitHubTreeResponse> {
    this.validateOwnerAndRepo(owner, repo);

    const query = recursive ? '?recursive=1' : '';
    const res = await this.fetchFn(
      `${this.apiBaseUrl}/repos/${owner}/${repo}/git/trees/${treeSha}${query}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'PRAMAAN-Ingestion-Service',
        },
      }
    );

    if (!res.ok) {
      throw new Error(`GITHUB_TREE_LOOKUP_FAILED: HTTP ${res.status} for tree '${treeSha}'`);
    }

    const data = await res.json() as any;
    return {
      sha: (data.sha || treeSha).toLowerCase(),
      truncated: Boolean(data.truncated),
      tree: (data.tree || []).map((t: any) => ({
        path: t.path,
        mode: t.mode,
        type: t.type,
        sha: t.sha.toLowerCase(),
        size: t.size,
        url: t.url,
      })),
    };
  }

  public async getBlob(
    accessToken: string,
    owner: string,
    repo: string,
    blobSha: string
  ): Promise<GitHubBlobResponse> {
    this.validateOwnerAndRepo(owner, repo);

    const res = await this.fetchFn(
      `${this.apiBaseUrl}/repos/${owner}/${repo}/git/blobs/${blobSha}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'PRAMAAN-Ingestion-Service',
        },
      }
    );

    if (!res.ok) {
      throw new Error(`GITHUB_BLOB_LOOKUP_FAILED: HTTP ${res.status} for blob '${blobSha}'`);
    }

    const data = await res.json() as any;
    return {
      sha: (data.sha || blobSha).toLowerCase(),
      size: data.size,
      content: data.content || '',
      encoding: data.encoding || 'base64',
    };
  }
}

/**
 * Deterministic Mock GitHub Client for offline testing, CI, and adversarial suites.
 * Exposes call counters for Phase 4 consent-before-fetch verification.
 */
export class MockGitHubClient implements IGitHubClient {
  public totalCallCount = 0;
  public metadataCallCount = 0;
  public contentCallCount = 0;
  public mockScopeOverride?: string;

  public mockUsers = new Map<string, GitHubUserResponse>();
  public mockRepos = new Map<string, GitHubRepoAccessResponse>();
  public mockCommits = new Map<string, GitHubCommitResponse>();
  public mockTrees = new Map<string, GitHubTreeResponse>();
  public mockBlobs = new Map<string, GitHubBlobResponse>();

  public resetCounters(): void {
    this.totalCallCount = 0;
    this.metadataCallCount = 0;
    this.contentCallCount = 0;
  }

  public async exchangeOAuthCode(
    code: string,
    _codeVerifier: string,
    _redirectUri: string
  ): Promise<GitHubOAuthTokenResponse> {
    this.totalCallCount++;
    return {
      accessToken: `gho_mock_token_for_${code}`,
      tokenType: 'bearer',
      scope: this.mockScopeOverride ?? 'read:user public_repo',
      expiresIn: 28800,
    };
  }

  public async getAuthenticatedUser(accessToken: string): Promise<GitHubUserResponse> {
    this.totalCallCount++;
    const user = this.mockUsers.get(accessToken);
    if (user) return user;
    return {
      id: 999999,
      login: 'mock-student-gh',
      type: 'User',
      email: 'student@example.edu',
    };
  }

  public async verifyRepositoryAccess(
    _accessToken: string,
    owner: string,
    repo: string
  ): Promise<GitHubRepoAccessResponse> {
    this.totalCallCount++;
    this.metadataCallCount++;
    const key = `${owner}/${repo}`.toLowerCase();
    const mock = this.mockRepos.get(key);
    if (mock) return mock;
    return {
      accessible: true,
      repoId: 1234567,
      owner,
      name: repo,
      defaultBranch: 'main',
      isPrivate: false,
      permissions: { pull: true },
    };
  }

  public async resolveCommit(
    _accessToken: string,
    owner: string,
    repo: string,
    ref: string
  ): Promise<GitHubCommitResponse> {
    this.totalCallCount++;
    this.contentCallCount++;
    const key = `${owner}/${repo}:${ref}`.toLowerCase();
    const mock = this.mockCommits.get(key);
    if (mock) return mock;
    return {
      commitSha: 'c000000000000000000000000000000000000001',
      treeSha: 't000000000000000000000000000000000000001',
      message: 'Initial commit for mock repo',
    };
  }

  public async getTree(
    _accessToken: string,
    owner: string,
    repo: string,
    treeSha: string,
    recursive = false
  ): Promise<GitHubTreeResponse> {
    this.totalCallCount++;
    this.contentCallCount++;
    const key = `${owner}/${repo}:${treeSha.toLowerCase()}:${recursive ? 'rec' : 'flat'}`;
    const mock = this.mockTrees.get(key) || this.mockTrees.get(`${owner}/${repo}:${treeSha.toLowerCase()}`);
    if (mock) return mock;
    return {
      sha: treeSha.toLowerCase(),
      truncated: false,
      tree: [],
    };
  }

  public async getBlob(
    _accessToken: string,
    _owner: string,
    _repo: string,
    blobSha: string
  ): Promise<GitHubBlobResponse> {
    this.totalCallCount++;
    this.contentCallCount++;
    const mock = this.mockBlobs.get(blobSha.toLowerCase());
    if (mock) return mock;
    throw new Error(`MOCK_BLOB_NOT_FOUND: No mock blob configured for ${blobSha}`);
  }

  /**
   * Helper to seed a commit into the mock client.
   */
  public seedCommit(
    owner: string,
    repo: string,
    ref: string,
    commit: { sha: string; treeSha: string; message?: string }
  ): void {
    const key = `${owner}/${repo}:${ref}`.toLowerCase();
    this.mockCommits.set(key, {
      commitSha: commit.sha.toLowerCase(),
      treeSha: commit.treeSha.toLowerCase(),
      message: commit.message || 'commit',
    });
  }

  /**
   * Helper to seed a tree into the mock client.
   */
  public seedTree(
    owner: string,
    repo: string,
    treeSha: string,
    tree: GitHubTreeEntry[],
    truncated = false,
    recursive?: boolean
  ): void {
    const res: GitHubTreeResponse = {
      sha: treeSha.toLowerCase(),
      truncated,
      tree,
    };
    if (recursive !== undefined) {
      const key = `${owner}/${repo}:${treeSha.toLowerCase()}:${recursive ? 'rec' : 'flat'}`;
      this.mockTrees.set(key, res);
    } else {
      this.mockTrees.set(`${owner}/${repo}:${treeSha.toLowerCase()}`, res);
    }
  }

  /**
   * Helper to seed a blob into the mock client.
   */
  public seedBlob(
    arg1: string,
    arg2: string,
    arg3?: string | Buffer,
    arg4?: string | Buffer
  ): void {
    let blobSha: string;
    let content: Buffer | string;
    if (arg3 === undefined && arg4 === undefined) {
      blobSha = arg1;
      content = arg2;
    } else {
      blobSha = arg3 as string;
      content = arg4!;
    }
    const rawBytes = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    this.mockBlobs.set(blobSha.toLowerCase(), {
      sha: blobSha.toLowerCase(),
      size: rawBytes.length,
      content: rawBytes.toString('base64'),
      encoding: 'base64',
    });
  }

  /**
   * Helper to seed a complete mock file into the mock client.
   * Computes authentic Git blob SHA and registers the blob.
   */
  public seedFile(
    content: string | Buffer,
    expectedBlobSha?: string
  ): { blobSha: string; rawHash: string; byteSize: number } {
    const rawBytes = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const computedBlobSha = computeGitBlobSha(rawBytes);
    const rawHash = computeRawFileHash(rawBytes);
    const blobShaToUse = expectedBlobSha ? expectedBlobSha.toLowerCase() : computedBlobSha;

    this.mockBlobs.set(blobShaToUse, {
      sha: blobShaToUse,
      size: rawBytes.length,
      content: rawBytes.toString('base64'),
      encoding: 'base64',
    });

    return {
      blobSha: blobShaToUse,
      rawHash,
      byteSize: rawBytes.length,
    };
  }

  /**
   * Helper to seed repository access metadata into the mock client.
   */
  public seedRepoAccess(
    owner: string,
    repo: string,
    access: Partial<GitHubRepoAccessResponse>
  ): void {
    const key = `${owner}/${repo}`.toLowerCase();
    this.mockRepos.set(key, {
      accessible: access.accessible ?? true,
      repoId: access.repoId ?? 1234567,
      owner,
      name: repo,
      defaultBranch: access.defaultBranch ?? 'main',
      isPrivate: access.isPrivate ?? false,
      permissions: access.permissions ?? { pull: true },
    });
  }
}
