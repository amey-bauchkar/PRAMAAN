import { SourceSnapshot } from '@pramaan/contracts';
import { createHash } from 'crypto';

export interface ISourceSnapshotStore {
  saveSnapshot(snapshot: SourceSnapshot): Promise<void> | void;
  getSnapshot(
    repositoryId: string,
    commitSha: string,
    filePath: string,
    orgId?: string,
    studentId?: string
  ): Promise<SourceSnapshot | undefined> | SourceSnapshot | undefined;
  getSnapshotByHash(
    rawFileHash: string,
    orgId?: string,
    studentId?: string
  ): Promise<SourceSnapshot | undefined> | SourceSnapshot | undefined;
  hasSnapshot(
    repositoryId: string,
    commitSha: string,
    filePath: string,
    orgId?: string,
    studentId?: string
  ): Promise<boolean> | boolean;
  deleteSnapshot?(
    repositoryId: string,
    commitSha: string,
    filePath: string,
    orgId?: string,
    studentId?: string,
    expectedSnapshotId?: string
  ): Promise<boolean> | boolean;
}

/**
 * Validates and normalizes repository-relative source file paths.
 * Enforces canonical representation and rejects traversal, absolute paths, null bytes, and empty paths.
 */
export function normalizeFilePath(filePath: string): string {
  if (typeof filePath !== 'string' || filePath.trim().length === 0) {
    throw new Error('INVALID_FILE_PATH: File path cannot be empty or whitespace');
  }

  // Reject null bytes
  if (filePath.includes('\0')) {
    throw new Error('INVALID_FILE_PATH: File path contains null bytes');
  }

  // Reject Windows drive paths (e.g. C:, D:)
  if (/^[a-zA-Z]:/.test(filePath)) {
    throw new Error('INVALID_FILE_PATH: Absolute Windows drive paths are prohibited');
  }

  // Reject absolute paths starting with / or \
  if (filePath.startsWith('/') || filePath.startsWith('\\')) {
    throw new Error('INVALID_FILE_PATH: Absolute paths are prohibited');
  }

  // Convert backslashes to forward slashes
  const unified = filePath.replace(/\\/g, '/');

  // Check for duplicate separators
  if (unified.includes('//')) {
    throw new Error('INVALID_FILE_PATH: Duplicate path separators are prohibited');
  }

  // Check for path traversal components
  const segments = unified.split('/');
  for (const seg of segments) {
    if (seg === '..' || seg === '.') {
      throw new Error(`INVALID_FILE_PATH: Path traversal segment '${seg}' is prohibited`);
    }
    if (seg.trim().length === 0) {
      throw new Error('INVALID_FILE_PATH: Empty path segments are prohibited');
    }
  }

  return unified;
}

export class InMemorySourceSnapshotStore implements ISourceSnapshotStore {
  private snapshotsByKey = new Map<string, SourceSnapshot>();
  private snapshotsByHash = new Map<string, SourceSnapshot>();

  private makeKey(
    repositoryId: string,
    commitSha: string,
    filePath: string,
    orgId?: string,
    studentId?: string
  ): string {
    const tenantPrefix = orgId ? `${orgId}:` : '';
    const studentPrefix = studentId ? `${studentId}:` : '';
    return `${tenantPrefix}${studentPrefix}${repositoryId}:${commitSha.toLowerCase()}:${normalizeFilePath(filePath)}`;
  }

  private makeHashKey(rawFileHash: string, orgId?: string, studentId?: string): string {
    const tenantPrefix = orgId ? `${orgId}:` : '';
    const studentPrefix = studentId ? `${studentId}:` : '';
    return `${tenantPrefix}${studentPrefix}${rawFileHash.toLowerCase()}`;
  }

  /**
   * Saves a source snapshot with defensive byte copying and immutability checks.
   */
  public saveSnapshot(snapshot: SourceSnapshot): void {
    const canonicalPath = normalizeFilePath(snapshot.filePath);
    const key = this.makeKey(
      snapshot.repositoryId,
      snapshot.commitSha,
      canonicalPath,
      snapshot.orgId,
      snapshot.studentId
    );
    
    // Verify raw file hash integrity before storage
    const rawBytes =
      snapshot.rawBytes instanceof Uint8Array
        ? snapshot.rawBytes
        : Buffer.from(snapshot.rawBytes, 'utf8');
    const computedHash = createHash('sha256').update(rawBytes).digest('hex');

    if (computedHash !== snapshot.rawFileHash) {
      throw new Error(
        `Snapshot rawFileHash mismatch: computed ${computedHash} vs claimed ${snapshot.rawFileHash}`
      );
    }

    // Check immutability: Cannot overwrite an existing snapshot with divergent bytes
    const existing = this.snapshotsByKey.get(key);
    if (existing) {
      if (existing.rawFileHash !== snapshot.rawFileHash) {
        throw new Error(
          `IMMUTABLE_SNAPSHOT_MUTATION_REJECTED: Snapshot for ${key} already exists with different hash (${existing.rawFileHash} vs ${snapshot.rawFileHash})`
        );
      }
      return; // Idempotent write of identical snapshot
    }

    // Defensive byte copying on write to prevent external buffer mutation
    const clonedBytes = Buffer.from(rawBytes);
    const immutableSnapshot: SourceSnapshot = {
      ...snapshot,
      filePath: canonicalPath,
      rawBytes: clonedBytes,
    };

    this.snapshotsByKey.set(key, immutableSnapshot);

    const hashKey = this.makeHashKey(snapshot.rawFileHash, snapshot.orgId, snapshot.studentId);
    if (!this.snapshotsByHash.has(hashKey)) {
      this.snapshotsByHash.set(hashKey, immutableSnapshot);
    }
  }

  /**
   * Retrieves a snapshot with defensive byte copying on read.
   * If orgId/studentId is supplied, retrieves only a snapshot explicitly stored under that exact tenant and student.
   * Never falls back to an unscoped snapshot.
   */
  public getSnapshot(
    repositoryId: string,
    commitSha: string,
    filePath: string,
    orgId?: string,
    studentId?: string
  ): SourceSnapshot | undefined {
    let canonicalPath: string;
    try {
      canonicalPath = normalizeFilePath(filePath);
    } catch {
      return undefined;
    }

    const key = this.makeKey(repositoryId, commitSha, canonicalPath, orgId, studentId);
    const stored = this.snapshotsByKey.get(key);

    if (!stored) return undefined;

    // Defensive byte copying on read
    return {
      ...stored,
      rawBytes: Buffer.from(stored.rawBytes),
    };
  }

  /**
   * Retrieves a snapshot by hash with defensive byte copying on read.
   * If orgId/studentId is supplied, retrieves only a snapshot explicitly stored under that exact tenant and student.
   * Never falls back to an unscoped snapshot.
   */
  public getSnapshotByHash(
    rawFileHash: string,
    orgId?: string,
    studentId?: string
  ): SourceSnapshot | undefined {
    const hashKey = this.makeHashKey(rawFileHash, orgId, studentId);
    const stored = this.snapshotsByHash.get(hashKey);

    if (!stored) return undefined;

    return {
      ...stored,
      rawBytes: Buffer.from(stored.rawBytes),
    };
  }

  /**
   * Deletes a snapshot from storage (used for compensating rollback on failure).
   * If expectedSnapshotId is provided, deletion is conditional on matching that exact snapshotId.
   * Returns true if the snapshot existed and was removed, false otherwise.
   */
  public deleteSnapshot(
    repositoryId: string,
    commitSha: string,
    filePath: string,
    orgId?: string,
    studentId?: string,
    expectedSnapshotId?: string
  ): boolean {
    let canonicalPath: string;
    try {
      canonicalPath = normalizeFilePath(filePath);
    } catch {
      return false;
    }

    const key = this.makeKey(repositoryId, commitSha, canonicalPath, orgId, studentId);
    const existing = this.snapshotsByKey.get(key);
    if (!existing) return false;

    // Conditional rollback: only delete if the snapshot ID matches the expected version
    if (expectedSnapshotId && existing.snapshotId !== expectedSnapshotId) {
      return false;
    }

    this.snapshotsByKey.delete(key);

    const hashKey = this.makeHashKey(existing.rawFileHash, orgId, studentId);
    if (this.snapshotsByHash.get(hashKey)?.snapshotId === existing.snapshotId) {
      this.snapshotsByHash.delete(hashKey);
    }

    return true;
  }

  public hasSnapshot(
    repositoryId: string,
    commitSha: string,
    filePath: string,
    orgId?: string,
    studentId?: string
  ): boolean {
    return this.getSnapshot(repositoryId, commitSha, filePath, orgId, studentId) !== undefined;
  }

  public clear(): void {
    this.snapshotsByKey.clear();
    this.snapshotsByHash.clear();
  }

  public get size(): number {
    return this.snapshotsByKey.size;
  }
}


