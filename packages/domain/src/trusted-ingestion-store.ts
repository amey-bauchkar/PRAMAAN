import {
  TrustedIngestionRecord,
  TrustedFileManifestEntry,
  TrustedIngestionRecordSchema,
} from '@pramaan/contracts';
import { normalizeFilePath } from './snapshot-store.js';

export interface ManifestVerificationResult {
  valid: boolean;
  reason?: string;
  entry?: TrustedFileManifestEntry;
}

export interface ITrustedIngestionStore {
  saveRecord(record: TrustedIngestionRecord): Promise<void> | void;
  getRecord(
    orgId: string,
    repositoryId: string,
    commitSha: string,
    studentId: string
  ): Promise<TrustedIngestionRecord | undefined> | TrustedIngestionRecord | undefined;
  hasRecord(
    orgId: string,
    repositoryId: string,
    commitSha: string,
    studentId: string
  ): Promise<boolean> | boolean;
  verifyFileManifest(
    orgId: string,
    repositoryId: string,
    commitSha: string,
    studentId: string,
    filePath: string,
    expectedBlobSha?: string,
    expectedRawHash?: string
  ): Promise<ManifestVerificationResult> | ManifestVerificationResult;
}

export class InMemoryTrustedIngestionStore implements ITrustedIngestionStore {
  private records = new Map<string, TrustedIngestionRecord>();

  private makeKey(orgId: string, repositoryId: string, commitSha: string, studentId: string): string {
    return `${orgId}:${repositoryId}:${commitSha.toLowerCase()}:${studentId}`;
  }

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

  public saveRecord(record: TrustedIngestionRecord): void {
    // 1. Validate incoming record against schema
    const parsed = TrustedIngestionRecordSchema.parse(record);

    // 2. Canonicalize and validate manifest paths and check for duplicates
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

    const key = this.makeKey(parsed.orgId, parsed.repositoryId, parsed.commitSha, parsed.studentId);
    const existing = this.records.get(key);

    if (existing) {
      // Idempotent duplicate check
      if (this.isExactDuplicate(existing, parsed, canonicalManifest)) {
        return;
      }

      // Reject mutation of immutable ingestion record
      throw new Error(
        `IMMUTABLE_INGESTION_RECORD_MUTATION_REJECTED: Cannot replace existing trusted ingestion record for org '${parsed.orgId}', repo '${parsed.repositoryId}', commit '${parsed.commitSha}', student '${parsed.studentId}'. Attempted modification of immutable ingestion record.`
      );
    }

    this.records.set(key, {
      ...parsed,
      commitSha: parsed.commitSha.toLowerCase(),
      treeSha: parsed.treeSha.toLowerCase(),
      manifest: canonicalManifest.map((m) => ({ ...m })),
    });
  }

  public getRecord(
    orgId: string,
    repositoryId: string,
    commitSha: string,
    studentId: string
  ): TrustedIngestionRecord | undefined {
    const key = this.makeKey(orgId, repositoryId, commitSha, studentId);
    const found = this.records.get(key);
    if (!found) return undefined;
    return {
      ...found,
      manifest: found.manifest.map((m) => ({ ...m })),
    };
  }

  public hasRecord(
    orgId: string,
    repositoryId: string,
    commitSha: string,
    studentId: string
  ): boolean {
    return this.getRecord(orgId, repositoryId, commitSha, studentId) !== undefined;
  }

  /**
   * Verifies that a specific file exists within the trusted ingestion manifest
   * and matches the expected Git blob SHA and SHA-256 raw file hash.
   */
  public verifyFileManifest(
    orgId: string,
    repositoryId: string,
    commitSha: string,
    studentId: string,
    filePath: string,
    expectedBlobSha?: string,
    expectedRawHash?: string
  ): ManifestVerificationResult {
    const record = this.getRecord(orgId, repositoryId, commitSha, studentId);
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

  public clear(): void {
    this.records.clear();
  }
}

