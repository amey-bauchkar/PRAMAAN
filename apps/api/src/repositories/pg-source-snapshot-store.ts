import pg from 'pg';
import {
  SourceSnapshot,
  SnapshotRegistrationState,
  SessionContext,
  normalizeFilePath,
} from '@pramaan/contracts';
import { ISourceSnapshotStore, computeRawFileHash } from '@pramaan/domain';
import { withTenantTransaction, getDbPool } from '../db/pool.js';

export class PgSourceSnapshotStore implements ISourceSnapshotStore {
  constructor(private pool: pg.Pool = getDbPool()) {}

  public async saveSnapshot(snapshot: SourceSnapshot): Promise<void> {
    const canonicalPath = normalizeFilePath(snapshot.filePath);
    const rawBytes = Buffer.isBuffer(snapshot.rawBytes)
      ? snapshot.rawBytes
      : Buffer.from(snapshot.rawBytes);

    // Verify raw file hash integrity
    const computedHash = computeRawFileHash(rawBytes);
    if (computedHash.toLowerCase() !== snapshot.rawFileHash.toLowerCase()) {
      throw new Error(
        `Snapshot rawFileHash mismatch: computed ${computedHash} vs claimed ${snapshot.rawFileHash}`
      );
    }

    const orgId = snapshot.orgId;
    const studentId = snapshot.studentId;
    if (!orgId || !studentId) {
      throw new Error(
        'TENANT_AND_STUDENT_REQUIRED: PgSourceSnapshotStore requires orgId and studentId for all snapshots.'
      );
    }

    const context: SessionContext = {
      orgId,
      userId: studentId,
      role: 'student',
    };

    await withTenantTransaction(context, async (client) => {
      // 1. Check for existing snapshot
      const selectQuery = `
        SELECT snapshot_id, raw_file_hash, registration_state
        FROM source_snapshots
        WHERE org_id = $1 AND student_id = $2 AND repository_id = $3 AND LOWER(commit_sha) = LOWER($4) AND file_path = $5;
      `;
      const res = await client.query(selectQuery, [
        orgId,
        studentId,
        snapshot.repositoryId,
        snapshot.commitSha.toLowerCase(),
        canonicalPath,
      ]);

      if (res.rows.length > 0) {
        const existing = res.rows[0];

        // Immutability check: cannot overwrite with divergent hash
        if (existing.raw_file_hash.toLowerCase() !== snapshot.rawFileHash.toLowerCase()) {
          throw new Error(
            `IMMUTABLE_SNAPSHOT_MUTATION_REJECTED: Snapshot for ${orgId}:${studentId}:${snapshot.repositoryId}:${snapshot.commitSha}:${canonicalPath} already exists with different hash (${existing.raw_file_hash} vs ${snapshot.rawFileHash})`
          );
        }

        // State update if existing was not audit_committed or matching snapshotId
        if (existing.registration_state !== 'audit_committed') {
          const updateQuery = `
            UPDATE source_snapshots
            SET snapshot_id = $1,
                registration_state = $2,
                ingestion_id = $3,
                captured_at = $4
            WHERE org_id = $5 AND student_id = $6 AND repository_id = $7 AND LOWER(commit_sha) = LOWER($8) AND file_path = $9;
          `;
          await client.query(updateQuery, [
            snapshot.snapshotId,
            snapshot.registrationState || 'pending_audit',
            snapshot.ingestionId || null,
            snapshot.capturedAt,
            orgId,
            studentId,
            snapshot.repositoryId,
            snapshot.commitSha.toLowerCase(),
            canonicalPath,
          ]);
        } else if (existing.snapshot_id === snapshot.snapshotId && snapshot.registrationState) {
          await client.query(
            `UPDATE source_snapshots SET registration_state = $1 WHERE org_id = $2 AND student_id = $3 AND repository_id = $4 AND LOWER(commit_sha) = LOWER($5) AND file_path = $6 AND snapshot_id = $7;`,
            [
              snapshot.registrationState,
              orgId,
              studentId,
              snapshot.repositoryId,
              snapshot.commitSha.toLowerCase(),
              canonicalPath,
              snapshot.snapshotId,
            ]
          );
        }
        return; // Idempotent write
      }

      // 2. Insert new immutable snapshot
      const insertQuery = `
        INSERT INTO source_snapshots (
          snapshot_id,
          org_id,
          student_id,
          repository_id,
          commit_sha,
          file_path,
          raw_bytes,
          raw_file_hash,
          blob_sha,
          captured_at,
          provenance,
          ingestion_id,
          registration_state
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13);
      `;

      await client.query(insertQuery, [
        snapshot.snapshotId,
        orgId,
        studentId,
        snapshot.repositoryId,
        snapshot.commitSha.toLowerCase(),
        canonicalPath,
        rawBytes,
        snapshot.rawFileHash.toLowerCase(),
        snapshot.blobSha ? snapshot.blobSha.toLowerCase() : null,
        snapshot.capturedAt,
        snapshot.provenance || 'trusted_ingestion_pipeline',
        snapshot.ingestionId || null,
        snapshot.registrationState || 'pending_audit',
      ]);
    }, this.pool);
  }

  public async getSnapshot(
    repositoryId: string,
    commitSha: string,
    filePath: string,
    orgId?: string,
    studentId?: string
  ): Promise<SourceSnapshot | undefined> {
    if (!orgId || !studentId) {
      return undefined; // Strict partitioning, never unscoped fallback
    }

    let canonicalPath: string;
    try {
      canonicalPath = normalizeFilePath(filePath);
    } catch {
      return undefined;
    }

    const context: SessionContext = {
      orgId,
      userId: studentId,
      role: 'student',
    };

    return withTenantTransaction(context, async (client) => {
      const query = `
        SELECT
          snapshot_id,
          org_id,
          student_id,
          repository_id,
          commit_sha,
          file_path,
          raw_bytes,
          raw_file_hash,
          blob_sha,
          captured_at,
          provenance,
          ingestion_id,
          registration_state
        FROM source_snapshots
        WHERE org_id = $1 AND student_id = $2 AND repository_id = $3 AND LOWER(commit_sha) = LOWER($4) AND file_path = $5;
      `;
      const res = await client.query(query, [
        orgId,
        studentId,
        repositoryId,
        commitSha.toLowerCase(),
        canonicalPath,
      ]);

      if (res.rows.length === 0) return undefined;
      const row = res.rows[0];

      return {
        snapshotId: row.snapshot_id,
        orgId: row.org_id,
        studentId: row.student_id,
        repositoryId: row.repository_id,
        commitSha: row.commit_sha,
        filePath: row.file_path,
        rawBytes: Buffer.from(row.raw_bytes),
        rawFileHash: row.raw_file_hash,
        blobSha: row.blob_sha || undefined,
        capturedAt: new Date(row.captured_at).toISOString(),
        provenance: row.provenance,
        ingestionId: row.ingestion_id || undefined,
        registrationState: row.registration_state,
      };
    }, this.pool);
  }

  public async getSnapshotByHash(
    rawFileHash: string,
    orgId?: string,
    studentId?: string
  ): Promise<SourceSnapshot | undefined> {
    if (!orgId || !studentId) {
      return undefined;
    }

    const context: SessionContext = {
      orgId,
      userId: studentId,
      role: 'student',
    };

    return withTenantTransaction(context, async (client) => {
      const query = `
        SELECT
          snapshot_id,
          org_id,
          student_id,
          repository_id,
          commit_sha,
          file_path,
          raw_bytes,
          raw_file_hash,
          blob_sha,
          captured_at,
          provenance,
          ingestion_id,
          registration_state
        FROM source_snapshots
        WHERE org_id = $1 AND student_id = $2 AND LOWER(raw_file_hash) = LOWER($3)
        LIMIT 1;
      `;
      const res = await client.query(query, [
        orgId,
        studentId,
        rawFileHash.toLowerCase(),
      ]);

      if (res.rows.length === 0) return undefined;
      const row = res.rows[0];

      return {
        snapshotId: row.snapshot_id,
        orgId: row.org_id,
        studentId: row.student_id,
        repositoryId: row.repository_id,
        commitSha: row.commit_sha,
        filePath: row.file_path,
        rawBytes: Buffer.from(row.raw_bytes),
        rawFileHash: row.raw_file_hash,
        blobSha: row.blob_sha || undefined,
        capturedAt: new Date(row.captured_at).toISOString(),
        provenance: row.provenance,
        ingestionId: row.ingestion_id || undefined,
        registrationState: row.registration_state,
      };
    }, this.pool);
  }

  public async hasSnapshot(
    repositoryId: string,
    commitSha: string,
    filePath: string,
    orgId?: string,
    studentId?: string
  ): Promise<boolean> {
    const snap = await this.getSnapshot(repositoryId, commitSha, filePath, orgId, studentId);
    return snap !== undefined;
  }

  public async deleteSnapshot(
    repositoryId: string,
    commitSha: string,
    filePath: string,
    orgId?: string,
    studentId?: string,
    expectedSnapshotId?: string
  ): Promise<boolean> {
    if (!orgId || !studentId) return false;

    let canonicalPath: string;
    try {
      canonicalPath = normalizeFilePath(filePath);
    } catch {
      return false;
    }

    const context: SessionContext = {
      orgId,
      userId: studentId,
      role: 'student',
    };

    return withTenantTransaction(context, async (client) => {
      let deleteQuery = `
        DELETE FROM source_snapshots
        WHERE org_id = $1 AND student_id = $2 AND repository_id = $3 AND LOWER(commit_sha) = LOWER($4) AND file_path = $5
      `;
      const params: any[] = [
        orgId,
        studentId,
        repositoryId,
        commitSha.toLowerCase(),
        canonicalPath,
      ];

      if (expectedSnapshotId) {
        deleteQuery += ` AND snapshot_id = $6`;
        params.push(expectedSnapshotId);
      }

      const res = await client.query(deleteQuery, params);
      return (res.rowCount ?? 0) > 0;
    }, this.pool);
  }

  public async updateRegistrationState(
    repositoryId: string,
    commitSha: string,
    filePath: string,
    orgId: string | undefined,
    studentId: string | undefined,
    expectedSnapshotId: string,
    newState: SnapshotRegistrationState
  ): Promise<boolean> {
    if (!orgId || !studentId) return false;

    let canonicalPath: string;
    try {
      canonicalPath = normalizeFilePath(filePath);
    } catch {
      return false;
    }

    const context: SessionContext = {
      orgId,
      userId: studentId,
      role: 'student',
    };

    return withTenantTransaction(context, async (client) => {
      const updateQuery = `
        UPDATE source_snapshots
        SET registration_state = $1
        WHERE org_id = $2 AND student_id = $3 AND repository_id = $4 AND LOWER(commit_sha) = LOWER($5) AND file_path = $6 AND snapshot_id = $7;
      `;
      const res = await client.query(updateQuery, [
        newState,
        orgId,
        studentId,
        repositoryId,
        commitSha.toLowerCase(),
        canonicalPath,
        expectedSnapshotId,
      ]);
      return (res.rowCount ?? 0) > 0;
    }, this.pool);
  }
}
