import pg from 'pg';
import { SessionContext } from '@pramaan/contracts';
import { withTenantTransaction, getDbPool } from '../db/pool.js';

export interface ConnectedAccountRecord {
  id: string;
  studentId: string;
  provider: string;
  githubUserId?: string;
  githubUsername?: string;
  installationRef: string;
  tokenRef: string;
  encryptedAccessToken?: string;
  encryptedRefreshToken?: string;
  keyVersion?: string;
  scopes: string[];
  status: 'active' | 'revoked';
  connectedAt: string;
  tokenExpiresAt?: string | null;
}

export interface IGitHubCredentialRepository {
  saveOAuthState(
    state: string,
    codeVerifier: string,
    studentId: string,
    orgId: string,
    redirectUri: string,
    expiresInSeconds?: number
  ): Promise<void>;

  consumeOAuthState(
    state: string
  ): Promise<{ codeVerifier: string; studentId: string; orgId: string; redirectUri: string } | null>;

  saveConnectedAccount(
    context: SessionContext,
    studentId: string,
    orgId: string,
    data: {
      githubUserId: string;
      githubUsername: string;
      encryptedAccessToken: string;
      encryptedRefreshToken?: string;
      keyVersion: string;
      scopes: string[];
      installationRef?: string;
      tokenExpiresAt?: Date;
    }
  ): Promise<void>;

  getConnectedAccount(
    context: SessionContext,
    studentId: string,
    orgId: string
  ): Promise<ConnectedAccountRecord | null>;

  revokeConnectedAccount(
    context: SessionContext,
    studentId: string,
    orgId: string
  ): Promise<boolean>;
}

export class InMemoryGitHubCredentialRepository implements IGitHubCredentialRepository {
  private states = new Map<
    string,
    {
      codeVerifier: string;
      studentId: string;
      orgId: string;
      redirectUri: string;
      expiresAt: number;
      used: boolean;
    }
  >();

  private accounts = new Map<string, ConnectedAccountRecord>();

  private makeAccountKey(orgId: string, studentId: string): string {
    return `${orgId}:${studentId}:github`;
  }

  public async saveOAuthState(
    state: string,
    codeVerifier: string,
    studentId: string,
    orgId: string,
    redirectUri: string,
    expiresInSeconds = 600
  ): Promise<void> {
    this.states.set(state, {
      codeVerifier,
      studentId,
      orgId,
      redirectUri,
      expiresAt: Date.now() + expiresInSeconds * 1000,
      used: false,
    });
  }

  public async consumeOAuthState(
    state: string
  ): Promise<{ codeVerifier: string; studentId: string; orgId: string; redirectUri: string } | null> {
    const item = this.states.get(state);
    if (!item) return null;
    if (item.used || Date.now() > item.expiresAt) {
      this.states.delete(state);
      return null;
    }
    // Single-use: delete or mark used immediately
    this.states.delete(state);
    return {
      codeVerifier: item.codeVerifier,
      studentId: item.studentId,
      orgId: item.orgId,
      redirectUri: item.redirectUri,
    };
  }

  public async saveConnectedAccount(
    _context: SessionContext,
    studentId: string,
    orgId: string,
    data: {
      githubUserId: string;
      githubUsername: string;
      encryptedAccessToken: string;
      encryptedRefreshToken?: string;
      keyVersion: string;
      scopes: string[];
      installationRef?: string;
      tokenExpiresAt?: Date;
    }
  ): Promise<void> {
    const key = this.makeAccountKey(orgId, studentId);
    this.accounts.set(key, {
      id: `acc_${studentId}`,
      studentId,
      provider: 'github',
      githubUserId: data.githubUserId,
      githubUsername: data.githubUsername,
      installationRef: data.installationRef || `inst_${data.githubUserId}`,
      tokenRef: `vault_${studentId}`,
      encryptedAccessToken: data.encryptedAccessToken,
      encryptedRefreshToken: data.encryptedRefreshToken,
      keyVersion: data.keyVersion,
      scopes: data.scopes,
      status: 'active',
      connectedAt: new Date().toISOString(),
      tokenExpiresAt: data.tokenExpiresAt ? data.tokenExpiresAt.toISOString() : null,
    });
  }

  public async getConnectedAccount(
    _context: SessionContext,
    studentId: string,
    orgId: string
  ): Promise<ConnectedAccountRecord | null> {
    const key = this.makeAccountKey(orgId, studentId);
    const acc = this.accounts.get(key);
    if (!acc) return null;
    return acc;
  }

  public async revokeConnectedAccount(
    _context: SessionContext,
    studentId: string,
    orgId: string
  ): Promise<boolean> {
    const key = this.makeAccountKey(orgId, studentId);
    const acc = this.accounts.get(key);
    if (!acc) return false;
    acc.status = 'revoked';
    delete acc.encryptedAccessToken;
    delete acc.encryptedRefreshToken;
    return true;
  }
}

export class PgGitHubCredentialRepository implements IGitHubCredentialRepository {
  constructor(private pool: pg.Pool = getDbPool()) {}

  public async saveOAuthState(
    state: string,
    codeVerifier: string,
    studentId: string,
    orgId: string,
    redirectUri: string,
    expiresInSeconds = 600
  ): Promise<void> {
    const context: SessionContext = { orgId, userId: studentId, role: 'student' };
    await withTenantTransaction(context, async (client) => {
      const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
      const query = `
        INSERT INTO github_oauth_states (
          state, code_verifier, student_id, org_id, redirect_uri, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6);
      `;
      await client.query(query, [
        state,
        codeVerifier,
        studentId,
        orgId,
        redirectUri,
        expiresAt,
      ]);
    }, this.pool);
  }

  public async consumeOAuthState(
    state: string
  ): Promise<{ codeVerifier: string; studentId: string; orgId: string; redirectUri: string } | null> {
    // In order to look up by state without pre-knowing orgId, we use the pool directly with an atomic DELETE
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN;');
      const selectQuery = `
        SELECT state, code_verifier, student_id, org_id, redirect_uri, expires_at, used_at
        FROM github_oauth_states
        WHERE state = $1
        FOR UPDATE;
      `;
      const res = await client.query(selectQuery, [state]);
      if (res.rows.length === 0) {
        await client.query('ROLLBACK;');
        return null;
      }
      const row = res.rows[0];

      // Check if expired or already used
      if (row.used_at || new Date(row.expires_at).getTime() < Date.now()) {
        await client.query('DELETE FROM github_oauth_states WHERE state = $1;', [state]);
        await client.query('COMMIT;');
        return null;
      }

      // Mark used / delete to prevent replay
      await client.query('DELETE FROM github_oauth_states WHERE state = $1;', [state]);
      await client.query('COMMIT;');

      return {
        codeVerifier: row.code_verifier,
        studentId: row.student_id,
        orgId: row.org_id,
        redirectUri: row.redirect_uri,
      };
    } catch (err) {
      await client.query('ROLLBACK;').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  public async saveConnectedAccount(
    context: SessionContext,
    studentId: string,
    _orgId: string,
    data: {
      githubUserId: string;
      githubUsername: string;
      encryptedAccessToken: string;
      encryptedRefreshToken?: string;
      keyVersion: string;
      scopes: string[];
      installationRef?: string;
      tokenExpiresAt?: Date;
    }
  ): Promise<void> {
    await withTenantTransaction(context, async (client) => {
      const query = `
        INSERT INTO connected_accounts (
          student_id,
          provider,
          installation_ref,
          token_ref,
          scope,
          status,
          github_user_id,
          github_username,
          encrypted_access_token,
          encrypted_refresh_token,
          key_version,
          token_expires_at,
          updated_at
        ) VALUES ($1, 'github', $2, $3, $4, 'active', $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
        ON CONFLICT (student_id, provider) DO UPDATE SET
          installation_ref = EXCLUDED.installation_ref,
          token_ref = EXCLUDED.token_ref,
          scope = EXCLUDED.scope,
          status = 'active',
          github_user_id = EXCLUDED.github_user_id,
          github_username = EXCLUDED.github_username,
          encrypted_access_token = EXCLUDED.encrypted_access_token,
          encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
          key_version = EXCLUDED.key_version,
          token_expires_at = EXCLUDED.token_expires_at,
          updated_at = CURRENT_TIMESTAMP;
      `;

      await client.query(query, [
        studentId,
        data.installationRef || `github_inst_${data.githubUserId}`,
        `vault_${studentId}`,
        JSON.stringify(data.scopes),
        data.githubUserId,
        data.githubUsername,
        data.encryptedAccessToken,
        data.encryptedRefreshToken || null,
        data.keyVersion,
        data.tokenExpiresAt || null,
      ]);
    }, this.pool);
  }

  public async getConnectedAccount(
    context: SessionContext,
    studentId: string,
    _orgId: string
  ): Promise<ConnectedAccountRecord | null> {
    return withTenantTransaction(context, async (client) => {
      const query = `
        SELECT
          id,
          student_id,
          provider,
          installation_ref,
          token_ref,
          scope,
          status,
          github_user_id,
          github_username,
          encrypted_access_token,
          encrypted_refresh_token,
          key_version,
          connected_at,
          token_expires_at
        FROM connected_accounts
        WHERE student_id = $1 AND provider = 'github';
      `;
      const res = await client.query(query, [studentId]);
      if (res.rows.length === 0) return null;
      const row = res.rows[0];

      return {
        id: row.id,
        studentId: row.student_id,
        provider: row.provider,
        installationRef: row.installation_ref,
        tokenRef: row.token_ref,
        scopes: typeof row.scope === 'string' ? JSON.parse(row.scope) : row.scope,
        status: row.status,
        githubUserId: row.github_user_id || undefined,
        githubUsername: row.github_username || undefined,
        encryptedAccessToken: row.encrypted_access_token || undefined,
        encryptedRefreshToken: row.encrypted_refresh_token || undefined,
        keyVersion: row.key_version || undefined,
        connectedAt: new Date(row.connected_at).toISOString(),
        tokenExpiresAt: row.token_expires_at ? new Date(row.token_expires_at).toISOString() : null,
      };
    }, this.pool);
  }

  public async revokeConnectedAccount(
    context: SessionContext,
    studentId: string,
    _orgId: string
  ): Promise<boolean> {
    return withTenantTransaction(context, async (client) => {
      const query = `
        UPDATE connected_accounts
        SET status = 'revoked',
            encrypted_access_token = NULL,
            encrypted_refresh_token = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE student_id = $1 AND provider = 'github';
      `;
      const res = await client.query(query, [studentId]);
      return (res.rowCount ?? 0) > 0;
    }, this.pool);
  }
}
