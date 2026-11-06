import { SourceSnapshot } from '@pramaan/contracts';
import { createHash } from 'crypto';

export interface ISourceSnapshotStore {
  saveSnapshot(snapshot: SourceSnapshot): Promise<void> | void;
  getSnapshot(
    repositoryId: string,
    commitSha: string,
    filePath: string,
    orgId?: string
  ): Promise<SourceSnapshot | undefined> | SourceSnapshot | undefined;
  getSnapshotByHash(
    rawFileHash: string,
    orgId?: string
  ): Promise<SourceSnapshot | undefined> | SourceSnapshot | undefined;
  hasSnapshot(
    repositoryId: string,
    commitSha: string,
    filePath: string,
    orgId?: string
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

  private makeKey(repositoryId: string, commitSha: string, filePath: string, orgId?: string): string {
    const tenantPrefix = orgId ? `${orgId}:` : '';
    return `${tenantPrefix}${repositoryId}:${commitSha.toLowerCase()}:${normalizeFilePath(filePath)}`;
  }

  private makeHashKey(rawFileHash: string, orgId?: string): string {
    const tenantPrefix = orgId ? `${orgId}:` : '';
    return `${tenantPrefix}${rawFileHash.toLowerCase()}`;
  }

  /**
   * Saves a source snapshot with defensive byte copying and immutability checks.
   */
  public saveSnapshot(snapshot: SourceSnapshot): void {
    const canonicalPath = normalizeFilePath(snapshot.filePath);
    const key = this.makeKey(snapshot.repositoryId, snapshot.commitSha, canonicalPath, snapshot.orgId);
    
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

    const hashKey = this.makeHashKey(snapshot.rawFileHash, snapshot.orgId);
    if (!this.snapshotsByHash.has(hashKey)) {
      this.snapshotsByHash.set(hashKey, immutableSnapshot);
    }
  }

  /**
   * Retrieves a snapshot with defensive byte copying on read.
   */
  public getSnapshot(
    repositoryId: string,
    commitSha: string,
    filePath: string,
    orgId?: string
  ): SourceSnapshot | undefined {
    let canonicalPath: string;
    try {
      canonicalPath = normalizeFilePath(filePath);
    } catch {
      return undefined;
    }

    const key = this.makeKey(repositoryId, commitSha, canonicalPath, orgId);
    let stored = this.snapshotsByKey.get(key);

    // Fallback lookup without tenant prefix if orgId was not specified at storage time
    if (!stored && orgId) {
      stored = this.snapshotsByKey.get(this.makeKey(repositoryId, commitSha, canonicalPath));
    }

    if (!stored) return undefined;

    // Defensive byte copying on read
    return {
      ...stored,
      rawBytes: Buffer.from(stored.rawBytes),
    };
  }

  /**
   * Retrieves a snapshot by hash with defensive byte copying on read.
   */
  public getSnapshotByHash(rawFileHash: string, orgId?: string): SourceSnapshot | undefined {
    const hashKey = this.makeHashKey(rawFileHash, orgId);
    let stored = this.snapshotsByHash.get(hashKey);

    if (!stored && orgId) {
      stored = this.snapshotsByHash.get(this.makeHashKey(rawFileHash));
    }

    if (!stored) return undefined;

    return {
      ...stored,
      rawBytes: Buffer.from(stored.rawBytes),
    };
  }

  public hasSnapshot(
    repositoryId: string,
    commitSha: string,
    filePath: string,
    orgId?: string
  ): boolean {
    return this.getSnapshot(repositoryId, commitSha, filePath, orgId) !== undefined;
  }

  public clear(): void {
    this.snapshotsByKey.clear();
    this.snapshotsByHash.clear();
  }

  public get size(): number {
    return this.snapshotsByKey.size;
  }
}


