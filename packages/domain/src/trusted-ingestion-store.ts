import { TrustedIngestionRecord } from '@pramaan/contracts';

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
}

export class InMemoryTrustedIngestionStore implements ITrustedIngestionStore {
  private records = new Map<string, TrustedIngestionRecord>();

  private makeKey(orgId: string, repositoryId: string, commitSha: string, studentId: string): string {
    return `${orgId}:${repositoryId}:${commitSha.toLowerCase()}:${studentId}`;
  }

  public saveRecord(record: TrustedIngestionRecord): void {
    const key = this.makeKey(record.orgId, record.repositoryId, record.commitSha, record.studentId);
    this.records.set(key, { ...record });
  }

  public getRecord(
    orgId: string,
    repositoryId: string,
    commitSha: string,
    studentId: string
  ): TrustedIngestionRecord | undefined {
    const key = this.makeKey(orgId, repositoryId, commitSha, studentId);
    const found = this.records.get(key);
    return found ? { ...found } : undefined;
  }

  public hasRecord(
    orgId: string,
    repositoryId: string,
    commitSha: string,
    studentId: string
  ): boolean {
    return this.getRecord(orgId, repositoryId, commitSha, studentId) !== undefined;
  }

  public clear(): void {
    this.records.clear();
  }
}
