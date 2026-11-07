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
 * For GitHub Apps (production standard): fine-grained read-only permissions
 * ('contents:read', 'metadata:read') are configured on the App itself.
 *
 * For OAuth Apps (developer / legacy fallback):
 * - 'read:user': standard minimal read-only scope for student identity verification.
 * - 'user:email': read-only email access.
 * - 'public_repo': access to public repositories only.
 * - 'repo': grants broad read/write/admin access to private repositories.
 *   Emits an explicit warning when requested.
 */
export const ALLOWED_GITHUB_OAUTH_SCOPES = [
  'read:user',
  'user:email',
  'public_repo',
  'repo',
] as const;

export const DEFAULT_GITHUB_OAUTH_SCOPES = ['read:user'];

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
    if (context.role === 'student' && context.userId !== studentId) {
      throw new Error('FORBIDDEN_STUDENT_ACCESS: Students can only connect their own GitHub account.');
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

    if (scopesToRequest.includes('repo')) {
      console.warn(
        'WARNING: Broad "repo" scope requested for GitHub OAuth. This grants broad read/write/admin repository access under legacy OAuth Apps. Prefer fine-grained GitHub App permissions (contents:read, metadata:read) whenever possible.'
      );
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
      scope: scopesToRequest.join(','),
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
    state: string
  ): Promise<{ success: boolean; githubUsername: string; githubUserId: string }> {
    // 1. Atomically consume single-use state under tenant RLS context
    const storedState = await this.credentialRepo.consumeOAuthState(context, state);
    if (!storedState) {
      throw new Error('INVALID_OR_EXPIRED_OAUTH_STATE: OAuth state is invalid, expired, or already used.');
    }

    // 2. Prevent account substitution and tenant boundary crossing
    if (storedState.orgId !== context.orgId) {
      throw new Error('CROSS_TENANT_OAUTH_REJECTED: State orgId does not match session tenant.');
    }
    if (context.role === 'student' && storedState.studentId !== context.userId) {
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

    const hasRequiredScope = grantedScopes.some((s) =>
      ['read:user', 'public_repo', 'repo'].includes(s)
    );
    if (!hasRequiredScope) {
      throw new Error(
        'INSUFFICIENT_GITHUB_PERMISSIONS: GitHub OAuth token was granted with insufficient permissions or scopes.'
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
   * Safely revokes and unlinks the connected GitHub account.
   */
  public async unlinkConnection(
    context: SessionContext,
    studentId: string
  ): Promise<boolean> {
    return this.credentialRepo.revokeConnectedAccount(context, studentId, context.orgId);
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

