import { TrustedIngestionRecord, TrustedFileManifestEntry } from '@pramaan/contracts';
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

  public saveRecord(record: TrustedIngestionRecord): void {
    const key = this.makeKey(record.orgId, record.repositoryId, record.commitSha, record.studentId);
    this.records.set(key, {
      ...record,
      manifest: record.manifest ? record.manifest.map((m) => ({ ...m })) : [],
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

    if (expectedBlobSha && entry.blobSha.toLowerCase() !== expectedBlobSha.toLowerCase()) {
      return {
        valid: false,
        reason: `BLOB_SHA_MISMATCH: Manifest blobSha '${entry.blobSha}' does not match snapshot blobSha '${expectedBlobSha}'`,
        entry,
      };
    }

    if (expectedRawHash && entry.rawFileHash.toLowerCase() !== expectedRawHash.toLowerCase()) {
      return {
        valid: false,
        reason: `RAW_HASH_MISMATCH: Manifest rawFileHash '${entry.rawFileHash}' does not match snapshot rawFileHash '${expectedRawHash}'`,
        entry,
      };
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

