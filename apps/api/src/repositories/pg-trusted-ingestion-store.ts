import pg from 'pg';
import {
  TrustedIngestionRecord,
  TrustedFileManifestEntry,
  TrustedIngestionRecordSchema,
  SessionContext,
  normalizeFilePath,
} from '@pramaan/contracts';
import {
  ITrustedIngestionStore,
  ManifestVerificationResult,
} from '@pramaan/domain';
import { withTenantTransaction, getDbPool } from '../db/pool.js';

export class PgTrustedIngestionStore implements ITrustedIngestionStore {
  constructor(private pool: pg.Pool = getDbPool()) {}

  private isExactDuplicate(
    existing: TrustedIngestionRecord,
    incoming: TrustedIngestionRecord,
    canonicalManifest: TrustedFileManifestEntry[]
  ): boolean {
    if (existing.ingestionId !== incoming.ingestionId) return false;
    if (existing.orgId !== incoming.orgId) return false;
    if (existing.repositoryId !== incoming.repositoryId) return false;
    if (existing.commitSha.toLowerCase() !== incoming.commitSha.toLowerCase()) return false;
    if (existing.treeSha.toLowerCase() !== incoming.treeSha.toLowerCase()) return false;
    if (existing.studentId !== incoming.studentId) return false;
    if (existing.manifest.length !== canonicalManifest.length) return false;

    const existingMap = new Map<string, TrustedFileManifestEntry>();
    for (const e of existing.manifest) {
      existingMap.set(normalizeFilePath(e.filePath), e);
    }

    for (const inc of canonicalManifest) {
      const match = existingMap.get(inc.filePath);
      if (!match) return false;
      if (match.blobSha.toLowerCase() !== inc.blobSha.toLowerCase()) return false;
      if (match.rawFileHash.toLowerCase() !== inc.rawFileHash.toLowerCase()) return false;
      if (match.byteSize !== inc.byteSize) return false;
    }

    return true;
  }

  public async saveRecord(record: TrustedIngestionRecord): Promise<void> {
    const parsed = TrustedIngestionRecordSchema.parse(record);

    // Canonicalize and validate manifest paths and check for duplicates
    const canonicalManifest: TrustedFileManifestEntry[] = [];
    const seenPaths = new Set<string>();
    for (const entry of parsed.manifest) {
      const canonicalPath = normalizeFilePath(entry.filePath);
      if (seenPaths.has(canonicalPath)) {
        throw new Error(
          `DUPLICATE_MANIFEST_PATH: Duplicate canonical file path '${canonicalPath}' in manifest`
        );
      }
      seenPaths.add(canonicalPath);
      canonicalManifest.push({
        filePath: canonicalPath,
        blobSha: entry.blobSha.toLowerCase(),
        rawFileHash: entry.rawFileHash.toLowerCase(),
        byteSize: entry.byteSize,
      });
    }

    const context: SessionContext = {
      orgId: parsed.orgId,
      userId: parsed.studentId,
      role: 'student',
    };

    await withTenantTransaction(context, async (client) => {
      // 0. Atomic Database-Level Consent Gate: check active consent under row lock
      const consentCheck = await client.query(
        `
        SELECT id
        FROM consent_grants
        WHERE student_id = $1
          AND purpose = 'repo_verification'
          AND revoked_at IS NULL
        FOR SHARE;
      `,
        [parsed.studentId]
      );

      if (consentCheck.rows.length === 0) {
        throw new Error(
          `CONSENT_REQUIRED_OR_REVOKED: Active repo_verification consent required to persist trusted ingestion record for student '${parsed.studentId}'`
        );
      }

      // 1. Check for existing record
      const selectQuery = `
        SELECT ingestion_id, org_id, student_id, repository_id, commit_sha, tree_sha, verified_at, provenance, manifest
        FROM trusted_ingestion_records
        WHERE org_id = $1 AND repository_id = $2 AND LOWER(commit_sha) = LOWER($3) AND student_id = $4;
      `;
      const res = await client.query(selectQuery, [
        parsed.orgId,
        parsed.repositoryId,
        parsed.commitSha.toLowerCase(),
        parsed.studentId,
      ]);

      if (res.rows.length > 0) {
        const row = res.rows[0];
        const existingRecord: TrustedIngestionRecord = {
          ingestionId: row.ingestion_id,
          orgId: row.org_id,
          studentId: row.student_id,
          repositoryId: row.repository_id,
          commitSha: row.commit_sha,
          treeSha: row.tree_sha,
          verifiedAt: new Date(row.verified_at).toISOString(),
          provenance: row.provenance,
          manifest: typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest,
        };

        if (this.isExactDuplicate(existingRecord, parsed, canonicalManifest)) {
          return; // Idempotent duplicate
        }

        throw new Error(
          `IMMUTABLE_INGESTION_RECORD_MUTATION_REJECTED: Cannot replace existing trusted ingestion record for org '${parsed.orgId}', repo '${parsed.repositoryId}', commit '${parsed.commitSha}', student '${parsed.studentId}'. Attempted modification of immutable ingestion record.`
        );
      }

      // 2. Insert new record
      const insertQuery = `
        INSERT INTO trusted_ingestion_records (
          ingestion_id,
          org_id,
          student_id,
          repository_id,
          commit_sha,
          tree_sha,
          verified_at,
          provenance,
          manifest,
          status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'persisted');
      `;

      await client.query(insertQuery, [
        parsed.ingestionId,
        parsed.orgId,
        parsed.studentId,
        parsed.repositoryId,
        parsed.commitSha.toLowerCase(),
        parsed.treeSha.toLowerCase(),
        parsed.verifiedAt,
        parsed.provenance,
        JSON.stringify(canonicalManifest),
      ]);
    }, this.pool);
  }

  public async getRecord(
    orgId: string,
    repositoryId: string,
    commitSha: string,
    studentId: string
  ): Promise<TrustedIngestionRecord | undefined> {
    const context: SessionContext = {
      orgId,
      userId: studentId,
      role: 'student',
    };

    return withTenantTransaction(context, async (client) => {
      const query = `
        SELECT ingestion_id, org_id, student_id, repository_id, commit_sha, tree_sha, verified_at, provenance, manifest
        FROM trusted_ingestion_records
        WHERE org_id = $1 AND repository_id = $2 AND LOWER(commit_sha) = LOWER($3) AND student_id = $4
          AND status != 'revoked';
      `;
      const res = await client.query(query, [
        orgId,
        repositoryId,
        commitSha.toLowerCase(),
        studentId,
      ]);

      if (res.rows.length === 0) return undefined;
      const row = res.rows[0];

      return {
        ingestionId: row.ingestion_id,
        orgId: row.org_id,
        studentId: row.student_id,
        repositoryId: row.repository_id,
        commitSha: row.commit_sha,
        treeSha: row.tree_sha,
        verifiedAt: new Date(row.verified_at).toISOString(),
        provenance: row.provenance,
        manifest: typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest,
      };
    }, this.pool);
  }

  public async hasRecord(
    orgId: string,
    repositoryId: string,
    commitSha: string,
    studentId: string
  ): Promise<boolean> {
    const rec = await this.getRecord(orgId, repositoryId, commitSha, studentId);
    return rec !== undefined;
  }

  public async verifyFileManifest(
    orgId: string,
    repositoryId: string,
    commitSha: string,
    studentId: string,
    filePath: string,
    expectedBlobSha?: string,
    expectedRawHash?: string
  ): Promise<ManifestVerificationResult> {
    const record = await this.getRecord(orgId, repositoryId, commitSha, studentId);
    if (!record) {
      return {
        valid: false,
        reason: `NO_INGESTION_RECORD: No trusted ingestion record found for org '${orgId}', repo '${repositoryId}', commit '${commitSha}', student '${studentId}'`,
      };
    }

    let canonicalPath: string;
    try {
      canonicalPath = normalizeFilePath(filePath);
    } catch (err: any) {
      return {
        valid: false,
        reason: `INVALID_FILE_PATH: ${err.message}`,
      };
    }

    const entry = record.manifest.find(
      (m) => normalizeFilePath(m.filePath) === canonicalPath
    );

    if (!entry) {
      return {
        valid: false,
        reason: `PATH_NOT_IN_TRUSTED_MANIFEST: File path '${canonicalPath}' does not exist in verified tree manifest (treeSha: ${record.treeSha})`,
      };
    }

    if (expectedBlobSha !== undefined) {
      if (!/^[0-9a-fA-F]{40}$/.test(expectedBlobSha)) {
        return {
          valid: false,
          reason: `INVALID_EXPECTED_BLOB_SHA: Expected blobSha must be a 40-character hex string`,
          entry,
        };
      }
      if (entry.blobSha.toLowerCase() !== expectedBlobSha.toLowerCase()) {
        return {
          valid: false,
          reason: `BLOB_SHA_MISMATCH: Manifest blobSha '${entry.blobSha}' does not match snapshot blobSha '${expectedBlobSha}'`,
          entry,
        };
      }
    }

    if (expectedRawHash !== undefined) {
      if (!/^[0-9a-fA-F]{64}$/.test(expectedRawHash)) {
        return {
          valid: false,
          reason: `INVALID_EXPECTED_RAW_HASH: Expected rawHash must be a 64-character SHA-256 string`,
          entry,
        };
      }
      if (entry.rawFileHash.toLowerCase() !== expectedRawHash.toLowerCase()) {
        return {
          valid: false,
          reason: `RAW_HASH_MISMATCH: Manifest rawFileHash '${entry.rawFileHash}' does not match snapshot rawFileHash '${expectedRawHash}'`,
          entry,
        };
      }
    }

    return {
      valid: true,
      entry,
    };
  }
}
