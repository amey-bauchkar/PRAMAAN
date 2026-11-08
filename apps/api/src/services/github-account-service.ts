import crypto from 'crypto';
import {
  SessionContext,
  GitHubConnectInitResponse,
  GitHubConnectionStatus,
} from '@pramaan/contracts';
import { IGitHubClient } from './github-client.js';
import { ITokenCipher } from './token-cipher.js';
import { IGitHubCredentialRepository } from '../repositories/github-credential-repository.js';

/**
 * Permitted GitHub OAuth scopes.
 *
 * NOTE: According to GitHub's official documentation, the 'public_repo' scope
 * grants read and write access to public repositories. PRAMAAN application code
 * strictly restricts all operations to read-only access (fetching commits, trees,
 * and blobs) and never issues mutating or write operations against student repositories.
 *
 * Monolithic 'repo' scope (which grants access to private repositories) is
 * strictly rejected under PRAMAAN's public-repository-only architecture.
 * Fine-grained GitHub App permissions and private repository ingestion remain
 * planned for a future milestone; private repositories are currently rejected fail-closed.
 */
export const ALLOWED_GITHUB_OAUTH_SCOPES = [
  'read:user',
  'user:email',
  'public_repo',
] as const;

export const DEFAULT_GITHUB_OAUTH_SCOPES = ['read:user', 'public_repo'];

export interface GitHubAccountServiceOptions {
  githubClient: IGitHubClient;
  tokenCipher: ITokenCipher;
  credentialRepo: IGitHubCredentialRepository;
  clientId?: string;
  oauthBaseUrl?: string;
  defaultScopes?: string[];
}

export class GitHubAccountService {
  private githubClient: IGitHubClient;
  private tokenCipher: ITokenCipher;
  private credentialRepo: IGitHubCredentialRepository;
  private clientId: string;
  private oauthBaseUrl: string;
  private defaultScopes: string[];

  constructor(opts: GitHubAccountServiceOptions) {
    this.githubClient = opts.githubClient;
    this.tokenCipher = opts.tokenCipher;
    this.credentialRepo = opts.credentialRepo;
    this.clientId = opts.clientId ?? process.env.GITHUB_CLIENT_ID ?? '';
    this.oauthBaseUrl = (opts.oauthBaseUrl ?? process.env.GITHUB_OAUTH_BASE_URL ?? 'https://github.com').replace(/\/$/, '');
    this.defaultScopes = opts.defaultScopes ?? DEFAULT_GITHUB_OAUTH_SCOPES;
  }

  /**
   * Generates a single-use OAuth state and S256 PKCE challenge,
   * binding the authorization request to the student and tenant.
   */
  public async initiateConnection(
    context: SessionContext,
    studentId: string,
    redirectUri: string,
    requestedScopes?: string[]
  ): Promise<GitHubConnectInitResponse> {
    if (!context.orgId) {
      throw new Error('TENANT_CONTEXT_REQUIRED: Cannot initiate GitHub connection without active tenant.');
    }

    // Role check: Only students can connect their own GitHub identity
    if (context.role !== 'student') {
      throw new Error(
        'FORBIDDEN_DELEGATED_CONNECTION: Delegated GitHub account connection is not supported. Only students may connect their own GitHub account.'
      );
    }

    const scopesToRequest = requestedScopes ?? this.defaultScopes;
    if (!Array.isArray(scopesToRequest) || scopesToRequest.length === 0) {
      throw new Error('INVALID_GITHUB_SCOPE: At least one OAuth scope must be requested.');
    }

    // Validate requested scopes against allowlist
    for (const scope of scopesToRequest) {
      if (!ALLOWED_GITHUB_OAUTH_SCOPES.includes(scope as any)) {
        throw new Error(
          `INVALID_GITHUB_SCOPE: Scope "${scope}" is invalid or excessive. Permitted scopes are: ${ALLOWED_GITHUB_OAUTH_SCOPES.join(', ')}`
        );
      }
    }

    // Generate cryptographic state (32 bytes hex)
    const state = crypto.randomBytes(32).toString('hex');

    // Generate PKCE code_verifier (32 bytes base64url)
    const codeVerifier = crypto.randomBytes(32).toString('base64url');

    // Compute S256 code_challenge
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier, 'utf8')
      .digest('base64url');

    // Persist single-use state with 10-minute expiry
    await this.credentialRepo.saveOAuthState(
      state,
      codeVerifier,
      studentId,
      context.orgId,
      redirectUri,
      600
    );

    const params = new URLSearchParams({
      client_id: this.clientId || 'pramaan_client_id',
      redirect_uri: redirectUri,
      scope: scopesToRequest.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const url = `${this.oauthBaseUrl}/login/oauth/authorize?${params.toString()}`;

    return {
      url,
      state,
    };
  }

  /**
   * Consumes single-use state under tenant RLS, verifies PKCE code_verifier,
   * exchanges token, verifies authenticated GitHub identity, and securely stores encrypted credentials.
   */
  public async handleOAuthCallback(
    context: SessionContext,
    code: string,
    state: string,
    studentId?: string
  ): Promise<{ success: boolean; githubUsername: string; githubUserId: string }> {
    // Role check: Only students can complete their own GitHub connection
    if (context.role !== 'student') {
      throw new Error(
        'FORBIDDEN_DELEGATED_CONNECTION: Delegated GitHub account connection is not supported. Only students may connect their own GitHub account.'
      );
    }

    // 1. Atomically consume single-use state under tenant RLS context
    const storedState = await this.credentialRepo.consumeOAuthState(context, state);
    if (!storedState) {
      throw new Error('INVALID_OR_EXPIRED_OAUTH_STATE: OAuth state is invalid, expired, or already used.');
    }

    // 2. Prevent account substitution and tenant boundary crossing
    if (storedState.orgId !== context.orgId) {
      throw new Error('CROSS_TENANT_OAUTH_REJECTED: State orgId does not match session tenant.');
    }
    if (studentId) {
      if (storedState.studentId !== studentId) {
        throw new Error('FORBIDDEN_STUDENT_ACCESS: OAuth state belongs to a different student.');
      }
    } else if (storedState.studentId !== context.userId) {
      throw new Error('FORBIDDEN_STUDENT_ACCESS: OAuth state belongs to a different student.');
    }

    // 3. Exchange authorization code with PKCE verifier
    const tokenRes = await this.githubClient.exchangeOAuthCode(
      code,
      storedState.codeVerifier,
      storedState.redirectUri
    );

    // 4. Verify granted permissions satisfy minimum requirements
    const grantedScopes = tokenRes.scope
      ? tokenRes.scope.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
      : [];

    // For standard OAuth: both 'read:user' (identity) and 'public_repo' (repo access) are required.
    // For GitHub App installations: 'contents:read' and 'metadata:read' (or 'read:user') are permitted.
    const hasOAuthScopes = grantedScopes.includes('read:user') && grantedScopes.includes('public_repo');
    const hasAppScopes =
      grantedScopes.includes('contents:read') &&
      (grantedScopes.includes('metadata:read') || grantedScopes.includes('read:user'));

    if (!hasOAuthScopes && !hasAppScopes) {
      throw new Error(
        'INSUFFICIENT_GITHUB_PERMISSIONS: GitHub authorization was granted with insufficient scopes. Both "read:user" and "public_repo" (or GitHub App "contents:read" and "metadata:read") are required.'
      );
    }

    // 5. Verify identity with GitHub user endpoint
    const userRes = await this.githubClient.getAuthenticatedUser(tokenRes.accessToken);

    // 6. Encrypt credentials at rest using versioned key ring
    const encryptedAccess = this.tokenCipher.encrypt(tokenRes.accessToken);
    let encryptedRefresh: string | undefined;
    if (tokenRes.refreshToken) {
      encryptedRefresh = this.tokenCipher.encrypt(tokenRes.refreshToken).serialized;
    }

    const tokenExpiresAt = tokenRes.expiresIn
      ? new Date(Date.now() + tokenRes.expiresIn * 1000)
      : undefined;

    // 7. Save encrypted credentials under tenant boundary
    await this.credentialRepo.saveConnectedAccount(context, storedState.studentId, storedState.orgId, {
      githubUserId: String(userRes.id),
      githubUsername: userRes.login,
      encryptedAccessToken: encryptedAccess.serialized,
      encryptedRefreshToken: encryptedRefresh,
      keyVersion: this.tokenCipher.getKeyVersion(),
      scopes: grantedScopes,
      tokenExpiresAt,
    });

    return {
      success: true,
      githubUsername: userRes.login,
      githubUserId: String(userRes.id),
    };
  }

  /**
   * Retrieves connection status without leaking credentials.
   */
  public async getConnectionStatus(
    context: SessionContext,
    studentId: string
  ): Promise<GitHubConnectionStatus> {
    const acc = await this.credentialRepo.getConnectedAccount(context, studentId, context.orgId);
    if (!acc || acc.status === 'revoked') {
      return { connected: false, scopes: [] };
    }

    return {
      connected: true,
      githubUserId: acc.githubUserId,
      githubUsername: acc.githubUsername,
      scopes: acc.scopes,
      connectedAt: acc.connectedAt,
      tokenExpiresAt: acc.tokenExpiresAt,
    };
  }

  /**
   * Genuine Provider-Side Revocation and Local Credential Purge.
   *
   * 1. Fetches stored encrypted GitHub access token outside of any mutating database lock.
   * 2. Decrypts token securely on the server using versioned token cipher.
   * 3. Invokes GitHub's documented DELETE /applications/{client_id}/grant API.
   * 4. Authenticates with configured GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.
   * 5. Purges local credentials from database regardless of upstream outcome.
   * 6. Strictly prevents plaintext token leakage in logs, diagnostics, or return values.
   */
  public async revokeUpstreamGrantAndUnlink(
    context: SessionContext,
    studentId: string
  ): Promise<{
    localTokenPurged: boolean;
    providerRevocationStatus: 'confirmed' | 'failed' | 'local_only';
    error?: string;
  }> {
    let providerRevocationStatus: 'confirmed' | 'failed' | 'local_only' = 'local_only';
    let upstreamError: string | undefined;

    // 1. Fetch connected account under tenant context (read only, zero DB write locks held)
    const acc = await this.credentialRepo.getConnectedAccount(context, studentId, context.orgId);

    if (acc && acc.encryptedAccessToken && acc.status !== 'revoked') {
      let decryptedToken: string | null = null;
      try {
        decryptedToken = this.tokenCipher.decrypt(acc.encryptedAccessToken);
      } catch {
        providerRevocationStatus = 'failed';
        upstreamError = 'TOKEN_DECRYPTION_FAILED';
      }

      if (decryptedToken) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 8000);
          try {
            const res = await this.githubClient.revokeOAuthGrant(decryptedToken, controller.signal);
            if (res.success && res.statusCode === 204) {
              providerRevocationStatus = 'confirmed';
            } else if (res.error?.startsWith('MISSING_CLIENT_CREDENTIALS')) {
              providerRevocationStatus = 'local_only';
              upstreamError = res.error;
            } else {
              providerRevocationStatus = 'failed';
              upstreamError = res.error || `HTTP_${res.statusCode}`;
            }
          } finally {
            clearTimeout(timeoutId);
          }
        } catch (err: any) {
          providerRevocationStatus = 'failed';
          upstreamError = err.name === 'AbortError' ? 'NETWORK_TIMEOUT' : 'NETWORK_ERROR';
        }
      }
    }

    // 2. Always purge local credentials fail-closed, even if upstream failed or was unreachable
    const localTokenPurged = await this.credentialRepo.revokeConnectedAccount(context, studentId, context.orgId);

    return {
      localTokenPurged,
      providerRevocationStatus,
      error: upstreamError,
    };
  }

  /**
   * Safely revokes and unlinks the connected GitHub account.
   */
  public async unlinkConnection(
    context: SessionContext,
    studentId: string
  ): Promise<boolean> {
    const res = await this.revokeUpstreamGrantAndUnlink(context, studentId);
    return res.localTokenPurged;
  }

  /**
   * Retrieves and decrypts the access token for server-side ingestion worker use only.
   * Never exposed to API responses.
   */
  public async getDecryptedAccessToken(
    context: SessionContext,
    studentId: string
  ): Promise<string> {
    const acc = await this.credentialRepo.getConnectedAccount(context, studentId, context.orgId);
    if (!acc || acc.status === 'revoked' || !acc.encryptedAccessToken) {
      throw new Error('NO_ACTIVE_GITHUB_CONNECTION: Student has no active GitHub connection.');
    }

    // Check token expiration if configured
    if (acc.tokenExpiresAt && new Date(acc.tokenExpiresAt).getTime() < Date.now()) {
      throw new Error('GITHUB_TOKEN_EXPIRED: Stored GitHub access token has expired.');
    }

    return this.tokenCipher.decrypt(acc.encryptedAccessToken);
  }
}

