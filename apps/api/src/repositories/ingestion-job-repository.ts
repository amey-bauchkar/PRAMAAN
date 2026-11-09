import pg from 'pg';
import {
  IngestionJobProgress,
  IngestionJobStatus,
  SessionContext,
} from '@pramaan/contracts';
import { withTenantTransaction, getDbPool } from '../db/pool.js';

export interface IIngestionJobRepository {
  createJob(job: IngestionJobProgress): Promise<void>;
  updateJob(
    context: SessionContext,
    ingestionId: string,
    status: IngestionJobStatus,
    updates?: Partial<IngestionJobProgress>
  ): Promise<void>;
  getJob(context: SessionContext, ingestionId: string): Promise<IngestionJobProgress | null>;
  listJobsForStudent(context: SessionContext, studentId: string): Promise<IngestionJobProgress[]>;
  cancelJobsForStudentOnRevocation(context: SessionContext, studentId: string): Promise<number>;
}

export class InMemoryIngestionJobRepository implements IIngestionJobRepository {
  private jobs = new Map<string, IngestionJobProgress>();

  public async createJob(job: IngestionJobProgress): Promise<void> {
    this.jobs.set(job.ingestionId, { ...job });
  }

  public async updateJob(
    _context: SessionContext,
    ingestionId: string,
    status: IngestionJobStatus,
    updates?: Partial<IngestionJobProgress>
  ): Promise<void> {
    const existing = this.jobs.get(ingestionId);
    if (!existing) {
      throw new Error(`JOB_NOT_FOUND: Ingestion job '${ingestionId}' not found.`);
    }

    if (existing.status === 'failed') {
      throw new Error(
        `JOB_ALREADY_FAILED: Cannot transition job '${ingestionId}' to '${status}'. Job has already failed (error: ${existing.error || 'unknown'}).`
      );
    }
    if (existing.status === 'completed') {
      throw new Error(
        `JOB_ALREADY_COMPLETED: Cannot transition job '${ingestionId}' to '${status}'. Job has already completed.`
      );
    }

    const validTransitions: Record<IngestionJobStatus, IngestionJobStatus[]> = {
      queued: ['queued', 'resolving', 'failed', 'completed'],
      resolving: ['resolving', 'fetching', 'failed'],
      fetching: ['fetching', 'verifying', 'failed'],
      verifying: ['verifying', 'persisted', 'failed'],
      persisted: ['persisted', 'completed', 'failed'],
      completed: [],
      failed: [],
    };

    if (!validTransitions[existing.status]?.includes(status)) {
      throw new Error(
        `INVALID_JOB_TRANSITION: Cannot transition job '${ingestionId}' from '${existing.status}' to '${status}'.`
      );
    }

    this.jobs.set(ingestionId, {
      ...existing,
      ...updates,
      status,
      completedAt:
        status === 'completed' || status === 'failed'
          ? updates?.completedAt || new Date().toISOString()
          : existing.completedAt,
    });
  }

  public async cancelJobsForStudentOnRevocation(
    _context: SessionContext,
    studentId: string
  ): Promise<number> {
    const inProgressStatuses: IngestionJobStatus[] = ['queued', 'resolving', 'fetching', 'verifying', 'persisted'];
    let count = 0;
    for (const job of this.jobs.values()) {
      if (job.studentId === studentId && inProgressStatuses.includes(job.status)) {
        job.status = 'failed';
        job.error = 'CONSENT_REVOKED';
        job.diagnostics = {
          ...job.diagnostics,
          revocation_reason: 'CONSENT_REVOKED',
        };
        job.completedAt = new Date().toISOString();
        count++;
      }
    }
    return count;
  }

  public async getJob(
    _context: SessionContext,
    ingestionId: string
  ): Promise<IngestionJobProgress | null> {
    return this.jobs.get(ingestionId) ?? null;
  }

  public async listJobsForStudent(
    _context: SessionContext,
    studentId: string
  ): Promise<IngestionJobProgress[]> {
    return Array.from(this.jobs.values()).filter((j) => j.studentId === studentId);
  }
}

export class PgIngestionJobRepository implements IIngestionJobRepository {
  constructor(private pool: pg.Pool = getDbPool()) {}

  public async createJob(job: IngestionJobProgress): Promise<void> {
    const context: SessionContext = {
      orgId: job.orgId,
      userId: job.studentId,
      role: 'student',
    };

    await withTenantTransaction(context, async (client) => {
      const query = `
        INSERT INTO ingestion_jobs (
          ingestion_id,
          org_id,
          student_id,
          repository_id,
          owner,
          repo,
          ref,
          commit_sha,
          tree_sha,
          status,
          file_count,
          retained_bytes,
          registered_snapshots_count,
          error,
          diagnostics,
          started_at,
          completed_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, CURRENT_TIMESTAMP)
        ON CONFLICT (ingestion_id) DO NOTHING;
      `;

      await client.query(query, [
        job.ingestionId,
        job.orgId,
        job.studentId,
        job.repositoryId,
        job.owner,
        job.repo,
        job.ref,
        job.commitSha || null,
        job.treeSha || null,
        job.status,
        job.fileCount || 0,
        job.retainedBytes || 0,
        job.registeredSnapshotsCount || 0,
        job.error || null,
        JSON.stringify(job.diagnostics || {}),
        job.createdAt,
        job.completedAt || null,
      ]);
    }, this.pool);
  }

  public async updateJob(
    context: SessionContext,
    ingestionId: string,
    status: IngestionJobStatus,
    updates?: Partial<IngestionJobProgress>
  ): Promise<void> {
    await withTenantTransaction(context, async (client) => {
      // 1. Fetch current status with row lock
      const checkRes = await client.query(
        `SELECT status, error FROM ingestion_jobs WHERE ingestion_id = $1 AND org_id = $2 FOR UPDATE;`,
        [ingestionId, context.orgId]
      );
      if (checkRes.rows.length === 0) {
        throw new Error(`JOB_NOT_FOUND: Ingestion job '${ingestionId}' not found.`);
      }

      const currentStatus: IngestionJobStatus = checkRes.rows[0].status;
      const currentError: string | null = checkRes.rows[0].error;

      // 2. Terminal state check
      if (currentStatus === 'failed') {
        throw new Error(
          `JOB_ALREADY_FAILED: Cannot transition job '${ingestionId}' to '${status}'. Job has already failed (error: ${currentError || 'unknown'}).`
        );
      }
      if (currentStatus === 'completed') {
        throw new Error(
          `JOB_ALREADY_COMPLETED: Cannot transition job '${ingestionId}' to '${status}'. Job has already completed.`
        );
      }

      // 3. Valid transition check
      const validTransitions: Record<IngestionJobStatus, IngestionJobStatus[]> = {
        queued: ['queued', 'resolving', 'failed', 'completed'],
        resolving: ['resolving', 'fetching', 'failed'],
        fetching: ['fetching', 'verifying', 'failed'],
        verifying: ['verifying', 'persisted', 'failed'],
        persisted: ['persisted', 'completed', 'failed'],
        completed: [],
        failed: [],
      };

      if (!validTransitions[currentStatus]?.includes(status)) {
        throw new Error(
          `INVALID_JOB_TRANSITION: Cannot transition job '${ingestionId}' from '${currentStatus}' to '${status}'.`
        );
      }

      const isTerminal = status === 'completed' || status === 'failed';
      const completedAt = isTerminal ? updates?.completedAt || new Date().toISOString() : null;

      const query = `
        UPDATE ingestion_jobs
        SET status = $1,
            commit_sha = COALESCE($2, commit_sha),
            tree_sha = COALESCE($3, tree_sha),
            file_count = COALESCE($4, file_count),
            retained_bytes = COALESCE($5, retained_bytes),
            registered_snapshots_count = COALESCE($6, registered_snapshots_count),
            error = COALESCE($7, error),
            diagnostics = CASE WHEN $8::jsonb IS NOT NULL THEN $8::jsonb ELSE diagnostics END,
            completed_at = COALESCE($9, completed_at),
            updated_at = CURRENT_TIMESTAMP
        WHERE ingestion_id = $10 AND org_id = $11;
      `;

      await client.query(query, [
        status,
        updates?.commitSha || null,
        updates?.treeSha || null,
        updates?.fileCount ?? null,
        updates?.retainedBytes ?? null,
        updates?.registeredSnapshotsCount ?? null,
        updates?.error || null,
        updates?.diagnostics ? JSON.stringify(updates.diagnostics) : null,
        completedAt,
        ingestionId,
        context.orgId,
      ]);
    }, this.pool);
  }

  public async getJob(
    context: SessionContext,
    ingestionId: string
  ): Promise<IngestionJobProgress | null> {
    return withTenantTransaction(context, async (client) => {
      const query = `
        SELECT
          ingestion_id,
          org_id,
          student_id,
          repository_id,
          owner,
          repo,
          ref,
          commit_sha,
          tree_sha,
          status,
          file_count,
          retained_bytes,
          registered_snapshots_count,
          error,
          diagnostics,
          started_at,
          completed_at
        FROM ingestion_jobs
        WHERE ingestion_id = $1 AND org_id = $2;
      `;
      const res = await client.query(query, [ingestionId, context.orgId]);
      if (res.rows.length === 0) return null;
      const row = res.rows[0];

      return {
        ingestionId: row.ingestion_id,
        orgId: row.org_id,
        studentId: row.student_id,
        repositoryId: row.repository_id,
        owner: row.owner,
        repo: row.repo,
        ref: row.ref,
        commitSha: row.commit_sha || undefined,
        treeSha: row.tree_sha || undefined,
        status: row.status,
        fileCount: Number(row.file_count),
        retainedBytes: Number(row.retained_bytes),
        registeredSnapshotsCount: Number(row.registered_snapshots_count),
        error: row.error || undefined,
        diagnostics: typeof row.diagnostics === 'string' ? JSON.parse(row.diagnostics) : row.diagnostics,
        createdAt: new Date(row.started_at).toISOString(),
        completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
      };
    }, this.pool);
  }

  public async listJobsForStudent(
    context: SessionContext,
    studentId: string
  ): Promise<IngestionJobProgress[]> {
    return withTenantTransaction(context, async (client) => {
      const query = `
        SELECT
          ingestion_id,
          org_id,
          student_id,
          repository_id,
          owner,
          repo,
          ref,
          commit_sha,
          tree_sha,
          status,
          file_count,
          retained_bytes,
          registered_snapshots_count,
          error,
          diagnostics,
          started_at,
          completed_at
        FROM ingestion_jobs
        WHERE student_id = $1 AND org_id = $2
        ORDER BY started_at DESC;
      `;
      const res = await client.query(query, [studentId, context.orgId]);
      return res.rows.map((row) => ({
        ingestionId: row.ingestion_id,
        orgId: row.org_id,
        studentId: row.student_id,
        repositoryId: row.repository_id,
        owner: row.owner,
        repo: row.repo,
        ref: row.ref,
        commitSha: row.commit_sha || undefined,
        treeSha: row.tree_sha || undefined,
        status: row.status,
        fileCount: Number(row.file_count),
        retainedBytes: Number(row.retained_bytes),
        registeredSnapshotsCount: Number(row.registered_snapshots_count),
        error: row.error || undefined,
        diagnostics: typeof row.diagnostics === 'string' ? JSON.parse(row.diagnostics) : row.diagnostics,
        createdAt: new Date(row.started_at).toISOString(),
        completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
      }));
    }, this.pool);
  }

  public async cancelJobsForStudentOnRevocation(
    context: SessionContext,
    studentId: string
  ): Promise<number> {
    return withTenantTransaction(context, async (client) => {
      const res = await client.query(`
        UPDATE ingestion_jobs
        SET status = 'failed',
            error = 'CONSENT_REVOKED',
            diagnostics = jsonb_set(
              COALESCE(diagnostics, '{}'::jsonb),
              '{revocation_reason}',
              '"CONSENT_REVOKED"'
            ),
            completed_at = CURRENT_TIMESTAMP
        WHERE student_id = $1
          AND status IN ('queued', 'resolving', 'fetching', 'verifying', 'persisted');
      `, [studentId]);
      return res.rowCount ?? 0;
    }, this.pool);
  }
}
