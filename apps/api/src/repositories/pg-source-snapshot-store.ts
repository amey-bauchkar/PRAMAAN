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
      // 0. Atomic Database-Level Consent Gate: check active consent under row lock
      // Unconditionally enforced for all new snapshot writes (including quarantined)
      const consentCheck = await client.query(
        `
        SELECT id
        FROM consent_grants
        WHERE student_id = $1
          AND purpose = 'repo_verification'
          AND revoked_at IS NULL
        FOR SHARE;
      `,
        [studentId]
      );

      if (consentCheck.rows.length === 0) {
        throw new Error(
          `CONSENT_REQUIRED_OR_REVOKED: Active repo_verification consent required to persist source snapshot for student '${studentId}'`
        );
      }

      // Snapshots cannot be directly persisted into terminal/transition lifecycle states;
      // initial save is always pending_audit, and transitions must use updateRegistrationState()
      if (snapshot.registrationState === 'quarantined') {
        throw new Error(
          'INVALID_REGISTRATION_STATE: Snapshots cannot be saved directly as quarantined; use updateRegistrationState() for quarantine transitions'
        );
      }
      if (snapshot.registrationState === 'audit_committed') {
        throw new Error(
          'INVALID_REGISTRATION_STATE: Snapshots cannot be saved directly as audit_committed; use updateRegistrationState() for audit promotion'
        );
      }

      // 1. Check for existing snapshot within this ingestion generation
      const selectQuery = `
        SELECT snapshot_id, raw_file_hash, registration_state
        FROM source_snapshots
        WHERE org_id = $1 AND student_id = $2 AND repository_id = $3 AND LOWER(commit_sha) = LOWER($4) AND file_path = $5
          AND (ingestion_id = $6 OR ingestion_id IS NULL);
      `;
      const res = await client.query(selectQuery, [
        orgId,
        studentId,
        snapshot.repositoryId,
        snapshot.commitSha.toLowerCase(),
        canonicalPath,
        snapshot.ingestionId || null,
      ]);

      if (res.rows.length > 0) {
        const existing = res.rows[0];

        // Lifecycle immutability: quarantined snapshots are sealed and cannot be modified, un-quarantined, or re-saved
        if (existing.registration_state === 'quarantined') {
          throw new Error(
            `IMMUTABLE_SNAPSHOT_MUTATION_REJECTED: Quarantined snapshot ${existing.snapshot_id} is immutable and cannot be re-saved, modified, or un-quarantined`
          );
        }

        // Immutability check: cannot overwrite with divergent hash
        if (existing.raw_file_hash.toLowerCase() !== snapshot.rawFileHash.toLowerCase()) {
          throw new Error(
            `IMMUTABLE_SNAPSHOT_MUTATION_REJECTED: Snapshot for ${orgId}:${studentId}:${snapshot.repositoryId}:${snapshot.commitSha}:${canonicalPath} already exists with different hash (${existing.raw_file_hash} vs ${snapshot.rawFileHash})`
          );
        }

        // If existing is already audit_committed, write is an idempotent no-op
        if (existing.registration_state === 'audit_committed') {
          return;
        }

        // Idempotent re-save of pending_audit snapshot (strictly maintains pending_audit state)
        const updateQuery = `
          UPDATE source_snapshots
          SET snapshot_id = $1,
              ingestion_id = $2,
              captured_at = $3
          WHERE org_id = $4 AND student_id = $5 AND repository_id = $6 AND LOWER(commit_sha) = LOWER($7) AND file_path = $8
            AND (ingestion_id = $2 OR ingestion_id IS NULL)
            AND registration_state = 'pending_audit';
        `;
        await client.query(updateQuery, [
          snapshot.snapshotId,
          snapshot.ingestionId || null,
          snapshot.capturedAt,
          orgId,
          studentId,
          snapshot.repositoryId,
          snapshot.commitSha.toLowerCase(),
          canonicalPath,
        ]);
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
        WHERE org_id = $1 AND student_id = $2 AND repository_id = $3 AND LOWER(commit_sha) = LOWER($4) AND file_path = $5
        ORDER BY CASE 
          WHEN registration_state = 'audit_committed' THEN 1 
          WHEN registration_state = 'pending_audit' THEN 2 
          ELSE 3 
        END, captured_at DESC, id DESC
        LIMIT 1;
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
        ORDER BY CASE 
          WHEN registration_state = 'audit_committed' THEN 1 
          WHEN registration_state = 'pending_audit' THEN 2 
          ELSE 3 
        END, captured_at DESC, id DESC
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
      // If promoting to audit_committed, enforce active consent under row lock
      if (newState === 'audit_committed') {
        const consentCheck = await client.query(
          `
          SELECT id
          FROM consent_grants
          WHERE student_id = $1
            AND purpose = 'repo_verification'
            AND revoked_at IS NULL
          FOR SHARE;
        `,
          [studentId]
        );

        if (consentCheck.rows.length === 0) {
          return false;
        }
      }

      const updateQuery = `
        UPDATE source_snapshots
        SET registration_state = $1
        WHERE org_id = $2
          AND student_id = $3
          AND repository_id = $4
          AND LOWER(commit_sha) = LOWER($5)
          AND file_path = $6
          AND snapshot_id = $7
          AND registration_state != 'quarantined'
          AND (registration_state = 'pending_audit' OR $1 = 'quarantined');
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
