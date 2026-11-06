import { createHash } from 'crypto';
import {
  AuditEvent,
  AuditChainVerificationStatus,
  TrustedCheckpoint,
  AuditChainVerificationResult
} from '@pramaan/contracts';

export type {
  AuditChainVerificationStatus,
  TrustedCheckpoint,
  AuditChainVerificationResult
};

export interface VerifyChainOptions {
  trustedCheckpoint?: TrustedCheckpoint;
}

export class AuditChain {
  public static readonly GENESIS_HASH = '0'.repeat(64);

  /**
   * Deterministic canonical JSON serialization (RFC 8785) with recursively sorted object keys.
   * Guarantees identical hashes across in-memory objects and PostgreSQL JSONB normalized columns.
   */
  public static canonicalStringify(obj: unknown): string {
    if (obj === null || typeof obj !== 'object') {
      return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
      return `[${obj.map(item => this.canonicalStringify(item)).join(',')}]`;
    }
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    const entries = keys.map(
      k => `${JSON.stringify(k)}:${this.canonicalStringify((obj as Record<string, unknown>)[k])}`
    );
    return `{${entries.join(',')}}`;
  }

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
      this.canonicalStringify(event.metadata ?? {}),
      event.prevHash,
      event.occurredAt
    ].join('|');

    return createHash('sha256').update(serializedPayload, 'utf8').digest('hex');
  }

  /**
   * Validates that an array of audit events forms an unbroken cryptographic hash chain.
   *
   * Invariant rules:
   * 1. A complete chain MUST start at seq 1 and use GENESIS_HASH.
   * 2. An event sequence starting at seq > 1 without an explicit trusted checkpoint is reported as UNANCHORED (valid: false).
   * 3. An event sequence starting at seq > 1 matching an explicitly provided trusted checkpoint is reported as PARTIAL_BUT_LINKS_VALID (valid: true).
   * 4. Any cryptographic tampering, broken hash link, sequence discontinuity, or invalid hash format is reported as INVALID (valid: false).
   */
  public static verifyChain(
    events: AuditEvent[],
    options?: VerifyChainOptions
  ): AuditChainVerificationResult {
    if (events.length === 0) {
      return {
        valid: true,
        status: 'COMPLETE_AND_VALID'
      };
    }

    // Validate trusted checkpoint format if supplied
    if (options?.trustedCheckpoint) {
      const { seq, hash } = options.trustedCheckpoint;
      if (
        typeof seq !== 'number' ||
        seq < 0 ||
        !hash ||
        hash.length !== 64 ||
        !/^[0-9a-fA-F]{64}$/.test(hash)
      ) {
        return {
          valid: false,
          status: 'INVALID',
          error: 'Invalid trusted checkpoint configuration: seq must be non-negative and hash must be a 64-character hexadecimal string'
        };
      }
    }

    for (let i = 0; i < events.length; i++) {
      const current = events[i];

      // Sequence number validity
      if (typeof current.seq !== 'number' || current.seq < 1) {
        return {
          valid: false,
          status: 'INVALID',
          brokenAtSeq: current.seq,
          error: `Invalid sequence number at index ${i}: seq must be >= 1, found ${current.seq}`
        };
      }

      // Check format of prevHash
      if (!current.prevHash || current.prevHash.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(current.prevHash)) {
        return {
          valid: false,
          status: 'INVALID',
          brokenAtSeq: current.seq,
          error: `Invalid previous hash format at seq ${current.seq}`
        };
      }

      // Check format of hash
      if (!current.hash || current.hash.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(current.hash)) {
        return {
          valid: false,
          status: 'INVALID',
          brokenAtSeq: current.seq,
          error: `Invalid hash format at seq ${current.seq}`
        };
      }

      // If at genesis position (seq 1), immediately verify genesis hash anchor
      if (i === 0 && current.seq === 1 && current.prevHash !== this.GENESIS_HASH) {
        return {
          valid: false,
          status: 'INVALID',
          brokenAtSeq: 1,
          error: `Invalid genesis block hash at seq 1: expected ${this.GENESIS_HASH}, found ${current.prevHash}`
        };
      }

      // Check sequence monotonicity and hash linkage with previous event
      if (i > 0) {
        const previous = events[i - 1];
        if (current.seq !== previous.seq + 1) {
          return {
            valid: false,
            status: 'INVALID',
            brokenAtSeq: current.seq,
            error: `Sequence discontinuity between seq ${previous.seq} and ${current.seq}`
          };
        }
        if (current.prevHash !== previous.hash) {
          return {
            valid: false,
            status: 'INVALID',
            brokenAtSeq: current.seq,
            error: `Broken hash link at seq ${current.seq}: expected prevHash ${previous.hash}, found ${current.prevHash}`
          };
        }
      }

      // Check current event payload integrity (RFC 8785 canonical hash computation)
      const { hash: reportedHash, ...rest } = current;
      const computedHash = this.calculateHash(rest);
      if (computedHash !== reportedHash) {
        return {
          valid: false,
          status: 'INVALID',
          brokenAtSeq: current.seq,
          error: `Tampered event payload at seq ${current.seq}: hash mismatch`
        };
      }
    }

    // All events in the provided array are contiguous, validly hashed, and linked to each other.
    // Now evaluate the anchor/predecessor of the first event (events[0]).
    const firstEvent = events[0];

    if (firstEvent.seq === 1) {
      return {
        valid: true,
        status: 'COMPLETE_AND_VALID'
      };
    }

    // firstEvent.seq > 1: This is a partial chain / suffix
    if (options?.trustedCheckpoint) {
      const cp = options.trustedCheckpoint;
      if (firstEvent.seq === cp.seq + 1 && firstEvent.prevHash.toLowerCase() === cp.hash.toLowerCase()) {
        return {
          valid: true,
          status: 'PARTIAL_BUT_LINKS_VALID'
        };
      }
      return {
        valid: false,
        status: 'UNANCHORED',
        brokenAtSeq: firstEvent.seq,
        error: `Chain suffix starting at seq ${firstEvent.seq} does not match supplied trusted checkpoint (expected seq ${cp.seq + 1} with prevHash ${cp.hash}, found seq ${firstEvent.seq} with prevHash ${firstEvent.prevHash})`
      };
    }

    // Unanchored suffix starting at seq > 1 without an explicit trusted checkpoint
    return {
      valid: false,
      status: 'UNANCHORED',
      brokenAtSeq: firstEvent.seq,
      error: `Chain suffix starting at seq ${firstEvent.seq} is unanchored: missing genesis block (seq 1) and no trusted checkpoint supplied`
    };
  }
}
