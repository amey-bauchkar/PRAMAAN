import { SourceSnapshot } from '@pramaan/contracts';
import { createHash } from 'crypto';

export interface ISourceSnapshotStore {
  saveSnapshot(snapshot: SourceSnapshot): Promise<void> | void;
  getSnapshot(
    repositoryId: string,
    commitSha: string,
    filePath: string
  ): Promise<SourceSnapshot | undefined> | SourceSnapshot | undefined;
  getSnapshotByHash(rawFileHash: string): Promise<SourceSnapshot | undefined> | SourceSnapshot | undefined;
  hasSnapshot(
    repositoryId: string,
    commitSha: string,
    filePath: string
  ): Promise<boolean> | boolean;
}

export function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

export class InMemorySourceSnapshotStore implements ISourceSnapshotStore {
  private snapshotsByKey = new Map<string, SourceSnapshot>();
  private snapshotsByHash = new Map<string, SourceSnapshot>();

  private makeKey(repositoryId: string, commitSha: string, filePath: string): string {
    return `${repositoryId}:${commitSha.toLowerCase()}:${normalizeFilePath(filePath)}`;
  }

  public saveSnapshot(snapshot: SourceSnapshot): void {
    const key = this.makeKey(snapshot.repositoryId, snapshot.commitSha, snapshot.filePath);
    
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

    this.snapshotsByKey.set(key, snapshot);
    if (!this.snapshotsByHash.has(snapshot.rawFileHash)) {
      this.snapshotsByHash.set(snapshot.rawFileHash, snapshot);
    }
  }

  public getSnapshot(
    repositoryId: string,
    commitSha: string,
    filePath: string
  ): SourceSnapshot | undefined {
    const key = this.makeKey(repositoryId, commitSha, filePath);
    return this.snapshotsByKey.get(key);
  }

  public getSnapshotByHash(rawFileHash: string): SourceSnapshot | undefined {
    return this.snapshotsByHash.get(rawFileHash);
  }

  public hasSnapshot(
    repositoryId: string,
    commitSha: string,
    filePath: string
  ): boolean {
    const key = this.makeKey(repositoryId, commitSha, filePath);
    return this.snapshotsByKey.has(key);
  }

  public clear(): void {
    this.snapshotsByKey.clear();
    this.snapshotsByHash.clear();
  }

  public get size(): number {
    return this.snapshotsByKey.size;
  }
}

