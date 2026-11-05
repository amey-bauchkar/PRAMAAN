import { createHash } from 'crypto';
import { AuditEvent } from '@pramaan/contracts';

export class AuditChain {
  public static readonly GENESIS_HASH = '0'.repeat(64);

  /**
   * Generates a SHA-256 hash for an audit event linked to a previous event hash.
   */
  public static calculateHash(event: Omit<AuditEvent, 'hash'>): string {
    const serializedPayload = [
      event.seq.toString(),
      event.orgId,
      event.actorType,
      event.actorId ?? 'anonymous',
      event.action,
      event.objectType,
      event.objectId ?? 'none',
      JSON.stringify(event.metadata),
      event.prevHash,
      event.occurredAt
    ].join('|');

    return createHash('sha256').update(serializedPayload, 'utf8').digest('hex');
  }

  /**
   * Validates that an array of audit events forms an unbroken cryptographic hash chain.
   */
  public static verifyChain(events: AuditEvent[]): { valid: boolean; brokenAtSeq?: number; error?: string } {
    if (events.length === 0) {
      return { valid: true };
    }

    for (let i = 0; i < events.length; i++) {
      const current = events[i];

      // Check sequence monotonicity
      if (i === 0) {
        if (current.prevHash !== this.GENESIS_HASH && current.seq !== 1) {
          // If not starting from 1, ensure prevHash is non-empty
          if (!current.prevHash) {
            return { valid: false, brokenAtSeq: current.seq, error: 'Genesis or previous hash missing' };
          }
        }
      } else {
        const previous = events[i - 1];
        if (current.seq !== previous.seq + 1) {
          return {
            valid: false,
            brokenAtSeq: current.seq,
            error: `Sequence discontinuity between seq ${previous.seq} and ${current.seq}`
          };
        }
        if (current.prevHash !== previous.hash) {
          return {
            valid: false,
            brokenAtSeq: current.seq,
            error: `Broken hash link at seq ${current.seq}: expected prevHash ${previous.hash}, found ${current.prevHash}`
          };
        }
      }

      // Check current hash integrity
      const { hash: reportedHash, ...rest } = current;
      const computedHash = this.calculateHash(rest);
      if (computedHash !== reportedHash) {
        return {
          valid: false,
          brokenAtSeq: current.seq,
          error: `Tampered event payload at seq ${current.seq}: hash mismatch`
        };
      }
    }

    return { valid: true };
  }
}

