import pg from 'pg';
import { randomUUID } from 'crypto';
import { SessionContext } from '@pramaan/contracts';
import { withTenantTransaction, getDbPool } from '../db/pool.js';

export interface RepositoryRecord {
  id: string; // UUID
  studentId: string; // UUID (references students.id)
  provider: 'github';
  providerRepoId: string; // Verified GitHub repository ID (e.g. "1234567")
  url: string; // e.g. "https://github.com/owner/repo"
  defaultBranch: string; // e.g. "main"
  consentGrantId: string; // UUID (references consent_grants.id)
  importedAt: string; // ISO date string
}

export interface GetOrCreateRepositoryParams {
  studentId: string; // Must be verified students.id
  providerRepoId: string; // Verified provider repo ID from GitHub API
  url: string;
  defaultBranch?: string;
  consentGrantId: string; // Must be verified active consent grant ID
  requestedRepositoryId?: string;
}

export interface IRepositoryRepository {
  getOrCreateRepository(
    context: SessionContext,
    params: GetOrCreateRepositoryParams
  ): Promise<RepositoryRecord>;

  getRepositoryById(
    context: SessionContext,
    repositoryId: string
  ): Promise<RepositoryRecord | null>;

  findRepositoryByProviderId(
    context: SessionContext,
    studentId: string,
    provider: string,
    providerRepoId: string
  ): Promise<RepositoryRecord | null>;
}

export class InMemoryRepositoryRepository implements IRepositoryRepository {
  // Key: repositoryId -> RepositoryRecord
  private repositories = new Map<string, RepositoryRecord>();
  // Key: `${studentId}:${provider}:${providerRepoId}` -> repositoryId
  private providerIndex = new Map<string, string>();

  public async getRepositoryById(
    _context: SessionContext,
    repositoryId: string
  ): Promise<RepositoryRecord | null> {
    return this.repositories.get(repositoryId) ?? null;
  }

  public async findRepositoryByProviderId(
    _context: SessionContext,
    studentId: string,
    provider: string,
    providerRepoId: string
  ): Promise<RepositoryRecord | null> {
    const key = `${studentId}:${provider}:${providerRepoId}`;
    const id = this.providerIndex.get(key);
    if (!id) return null;
    return this.repositories.get(id) ?? null;
  }

  public async getOrCreateRepository(
    context: SessionContext,
    params: GetOrCreateRepositoryParams
  ): Promise<RepositoryRecord> {
    // 1. If caller supplied an explicit repositoryId, verify ownership and validity
    if (params.requestedRepositoryId) {
      const existing = await this.getRepositoryById(context, params.requestedRepositoryId);
      if (!existing) {
        throw new Error(
          `REPOSITORY_NOT_FOUND: The specified repositoryId '${params.requestedRepositoryId}' does not exist.`
        );
      }
      if (existing.studentId !== params.studentId) {
        throw new Error(
          `CROSS_STUDENT_REPOSITORY_FORBIDDEN: Repository '${params.requestedRepositoryId}' does not belong to student '${params.studentId}'.`
        );
      }
      if (existing.providerRepoId !== params.providerRepoId) {
        throw new Error(
          `REPOSITORY_PROVIDER_MISMATCH: Repository '${params.requestedRepositoryId}' providerRepoId '${existing.providerRepoId}' does not match verified GitHub repo '${params.providerRepoId}'.`
        );
      }
      return existing;
    }

    // 2. Check if a repository already exists for this student and providerRepoId
    const existing = await this.findRepositoryByProviderId(
      context,
      params.studentId,
      'github',
      params.providerRepoId
    );
    if (existing) {
      return existing;
    }

    // 3. Create new canonical repository record
    const id = randomUUID();
    const record: RepositoryRecord = {
      id,
      studentId: params.studentId,
      provider: 'github',
      providerRepoId: params.providerRepoId,
      url: params.url,
      defaultBranch: params.defaultBranch || 'main',
      consentGrantId: params.consentGrantId,
      importedAt: new Date().toISOString(),
    };

    this.repositories.set(id, record);
    this.providerIndex.set(`${params.studentId}:github:${params.providerRepoId}`, id);
    return record;
  }
}

export class PgRepositoryRepository implements IRepositoryRepository {
  constructor(private pool: pg.Pool = getDbPool()) {}

  public async getRepositoryById(
    context: SessionContext,
    repositoryId: string
  ): Promise<RepositoryRecord | null> {
    return withTenantTransaction(context, async (client) => {
      const query = `
        SELECT id, student_id, provider, provider_repo_id, url, default_branch, consent_grant_id, imported_at
        FROM repositories
        WHERE id = $1;
      `;
      const res = await client.query(query, [repositoryId]);
      if (res.rows.length === 0) return null;
      const row = res.rows[0];
      return {
        id: row.id,
        studentId: row.student_id,
        provider: row.provider,
        providerRepoId: row.provider_repo_id,
        url: row.url,
        defaultBranch: row.default_branch,
        consentGrantId: row.consent_grant_id,
        importedAt: new Date(row.imported_at).toISOString(),
      };
    }, this.pool);
  }

  public async findRepositoryByProviderId(
    context: SessionContext,
    studentId: string,
    provider: string,
    providerRepoId: string
  ): Promise<RepositoryRecord | null> {
    return withTenantTransaction(context, async (client) => {
      const query = `
        SELECT id, student_id, provider, provider_repo_id, url, default_branch, consent_grant_id, imported_at
        FROM repositories
        WHERE student_id = $1 AND provider = $2 AND provider_repo_id = $3
        LIMIT 1;
      `;
      const res = await client.query(query, [studentId, provider, providerRepoId]);
      if (res.rows.length === 0) return null;
      const row = res.rows[0];
      return {
        id: row.id,
        studentId: row.student_id,
        provider: row.provider,
        providerRepoId: row.provider_repo_id,
        url: row.url,
        defaultBranch: row.default_branch,
        consentGrantId: row.consent_grant_id,
        importedAt: new Date(row.imported_at).toISOString(),
      };
    }, this.pool);
  }

  public async getOrCreateRepository(
    context: SessionContext,
    params: GetOrCreateRepositoryParams
  ): Promise<RepositoryRecord> {
    // 1. If caller supplied an explicit repositoryId, verify ownership and validity
    if (params.requestedRepositoryId) {
      const existing = await this.getRepositoryById(context, params.requestedRepositoryId);
      if (!existing) {
        throw new Error(
          `REPOSITORY_NOT_FOUND: The specified repositoryId '${params.requestedRepositoryId}' does not exist.`
        );
      }
      if (existing.studentId !== params.studentId) {
        throw new Error(
          `CROSS_STUDENT_REPOSITORY_FORBIDDEN: Repository '${params.requestedRepositoryId}' does not belong to student '${params.studentId}'.`
        );
      }
      if (existing.providerRepoId !== params.providerRepoId) {
        throw new Error(
          `REPOSITORY_PROVIDER_MISMATCH: Repository '${params.requestedRepositoryId}' providerRepoId '${existing.providerRepoId}' does not match verified GitHub repo '${params.providerRepoId}'.`
        );
      }
      return existing;
    }

    // 2. Check if repository already exists in database
    const existing = await this.findRepositoryByProviderId(
      context,
      params.studentId,
      'github',
      params.providerRepoId
    );
    if (existing) {
      return existing;
    }

    // 3. Insert new canonical repository row under tenant transaction
    return withTenantTransaction(context, async (client) => {
      const insertQuery = `
        INSERT INTO repositories (
          student_id, provider, provider_repo_id, url, default_branch, consent_grant_id
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, student_id, provider, provider_repo_id, url, default_branch, consent_grant_id, imported_at;
      `;
      const res = await client.query(insertQuery, [
        params.studentId,
        'github',
        params.providerRepoId,
        params.url,
        params.defaultBranch || 'main',
        params.consentGrantId,
      ]);
      const row = res.rows[0];
      return {
        id: row.id,
        studentId: row.student_id,
        provider: row.provider,
        providerRepoId: row.provider_repo_id,
        url: row.url,
        defaultBranch: row.default_branch,
        consentGrantId: row.consent_grant_id,
        importedAt: new Date(row.imported_at).toISOString(),
      };
    }, this.pool);
  }
}

