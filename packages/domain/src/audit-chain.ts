import { createHash, createHmac, timingSafeEqual } from 'crypto';
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
  checkpointSigningKey?: string;
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
   * Deterministic canonical payload string for signing an audit checkpoint.
   * Format: ${orgId}:${seq}:${hash.toLowerCase()}:${signedAt}
   */
  public static canonicalCheckpointPayload(
    checkpoint: Omit<TrustedCheckpoint, 'signature'>
  ): string {
    return `${checkpoint.orgId}:${checkpoint.seq}:${checkpoint.hash.toLowerCase()}:${checkpoint.signedAt}`;
  }

  /**
   * Generates a cryptographic HMAC-SHA256 signature for a checkpoint using an out-of-band secret key.
   */
  public static signCheckpoint(
    checkpoint: Omit<TrustedCheckpoint, 'signature'>,
    secretKey: string
  ): TrustedCheckpoint {
    if (!secretKey || secretKey.length < 16) {
      throw new Error('Checkpoint signing requires a secret key of at least 16 bytes');
    }
    const payload = this.canonicalCheckpointPayload(checkpoint);
    const signature = createHmac('sha256', secretKey).update(payload, 'utf8').digest('hex');
    return {
      ...checkpoint,
      signature
    };
  }

  /**
   * Verifies the cryptographic HMAC-SHA256 signature of a checkpoint using constant-time comparison.
   */
  public static verifyCheckpointSignature(
    checkpoint: TrustedCheckpoint,
    secretKey: string
  ): boolean {
    if (!checkpoint?.signature || !secretKey || typeof checkpoint.signature !== 'string') {
      return false;
    }
    try {
      const payload = this.canonicalCheckpointPayload(checkpoint);
      const expectedSig = createHmac('sha256', secretKey).update(payload, 'utf8').digest('hex');
      const sigBuf = Buffer.from(checkpoint.signature, 'hex');
      const expectedBuf = Buffer.from(expectedSig, 'hex');
      if (sigBuf.length !== expectedBuf.length) {
        return false;
      }
      return timingSafeEqual(sigBuf, expectedBuf);
    } catch {
      return false;
    }
  }

  /**
   * Validates internal cryptographic linking and payload hashes between sequential events in a suffix,
   * without asserting or validating any predecessor anchor or genesis origin.
   */
  public static verifySuffixLinks(events: AuditEvent[]): {
    valid: boolean;
    status: 'INTERNAL_LINKS_VALID' | 'INVALID';
    brokenAtSeq?: number;
    error?: string;
  } {
    if (events.length === 0) {
      return { valid: true, status: 'INTERNAL_LINKS_VALID' };
    }

    for (let i = 0; i < events.length; i++) {
      const current = events[i];

      if (typeof current.seq !== 'number' || !Number.isInteger(current.seq) || current.seq < 1) {
        return {
          valid: false,
          status: 'INVALID',
          brokenAtSeq: current.seq,
          error: `Invalid sequence number at index ${i}: seq must be a positive integer, found ${current.seq}`
        };
      }

      if (!current.prevHash || current.prevHash.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(current.prevHash)) {
        return {
          valid: false,
          status: 'INVALID',
          brokenAtSeq: current.seq,
          error: `Invalid previous hash format at seq ${current.seq}`
        };
      }

      if (!current.hash || current.hash.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(current.hash)) {
        return {
          valid: false,
          status: 'INVALID',
          brokenAtSeq: current.seq,
          error: `Invalid hash format at seq ${current.seq}`
        };
      }

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

    return { valid: true, status: 'INTERNAL_LINKS_VALID' };
  }

  /**
   * Validates that an array of audit events forms an unbroken cryptographic hash chain.
   *
   * Invariant rules:
   * 1. A complete chain MUST start at seq 1 and use GENESIS_HASH.
   * 2. An event sequence starting at seq > 1 without an authenticated trusted checkpoint is reported as UNANCHORED (valid: false).
   * 3. An event sequence starting at seq > 1 matching an authenticated trusted checkpoint is reported as PARTIAL_BUT_LINKS_VALID (valid: true, isComplete: false).
   * 4. Any cryptographic tampering, broken hash link, sequence discontinuity, or invalid hash format is reported as INVALID (valid: false).
   */
  public static verifyChain(
    events: AuditEvent[],
    options?: VerifyChainOptions
  ): AuditChainVerificationResult {
    if (events.length === 0) {
      return {
        valid: true,
        status: 'COMPLETE_AND_VALID',
        isComplete: true
      };
    }

    // Authenticate trusted checkpoint if supplied
    if (options?.trustedCheckpoint) {
      const cp = options.trustedCheckpoint as any;

      // 1. Organization binding check
      if (!cp || typeof cp !== 'object' || typeof cp.orgId !== 'string' || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(cp.orgId)) {
        return {
          valid: false,
          status: 'INVALID',
          isComplete: false,
          error: 'Unauthenticated checkpoint: checkpoints require valid UUID orgId organization binding'
        };
      }

      // 2. Finite non-negative integer sequence check
      if (typeof cp.seq !== 'number' || !Number.isInteger(cp.seq) || !Number.isFinite(cp.seq) || cp.seq < 0) {
        return {
          valid: false,
          status: 'INVALID',
          isComplete: false,
          error: 'Invalid checkpoint sequence number: seq must be a finite non-negative integer'
        };
      }

      // 3. Hash format check
      if (!cp.hash || cp.hash.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(cp.hash)) {
        return {
          valid: false,
          status: 'INVALID',
          isComplete: false,
          error: 'Invalid checkpoint hash: hash must be a 64-character hexadecimal string'
        };
      }

      // 4. Cryptographic signature and timestamp presence
      if (!cp.signature || typeof cp.signature !== 'string' || !cp.signedAt || typeof cp.signedAt !== 'string') {
        return {
          valid: false,
          status: 'INVALID',
          isComplete: false,
          error: 'Unauthenticated checkpoint: checkpoints require cryptographic signature and ISO signedAt timestamp'
        };
      }

      // 5. Signature verification using out-of-band key
      const signingKey = options.checkpointSigningKey || process.env.CHECKPOINT_SIGNING_KEY;
      if (!signingKey) {
        return {
          valid: false,
          status: 'INVALID',
          isComplete: false,
          error: 'Checkpoint verification failed: signing key is required to authenticate checkpoints'
        };
      }

      const isSignatureAuthentic = this.verifyCheckpointSignature(cp as TrustedCheckpoint, signingKey);
      if (!isSignatureAuthentic) {
        return {
          valid: false,
          status: 'INVALID',
          isComplete: false,
          error: 'Checkpoint signature verification failed: checkpoint is not authentic or has been tampered with'
        };
      }
    }

    for (let i = 0; i < events.length; i++) {
      const current = events[i];

      // Sequence number validity
      if (typeof current.seq !== 'number' || !Number.isInteger(current.seq) || current.seq < 1) {
        return {
          valid: false,
          status: 'INVALID',
          isComplete: false,
          brokenAtSeq: current.seq,
          error: `Invalid sequence number at index ${i}: seq must be >= 1, found ${current.seq}`
        };
      }

      // Check format of prevHash
      if (!current.prevHash || current.prevHash.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(current.prevHash)) {
        return {
          valid: false,
          status: 'INVALID',
          isComplete: false,
          brokenAtSeq: current.seq,
          error: `Invalid previous hash format at seq ${current.seq}`
        };
      }

      // Check format of hash
      if (!current.hash || current.hash.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(current.hash)) {
        return {
          valid: false,
          status: 'INVALID',
          isComplete: false,
          brokenAtSeq: current.seq,
          error: `Invalid hash format at seq ${current.seq}`
        };
      }

      // If at genesis position (seq 1), immediately verify genesis hash anchor
      if (i === 0 && current.seq === 1 && current.prevHash !== this.GENESIS_HASH) {
        return {
          valid: false,
          status: 'INVALID',
          isComplete: false,
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
            isComplete: false,
            brokenAtSeq: current.seq,
            error: `Sequence discontinuity between seq ${previous.seq} and ${current.seq}`
          };
        }
        if (current.prevHash !== previous.hash) {
          return {
            valid: false,
            status: 'INVALID',
            isComplete: false,
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
          isComplete: false,
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
        status: 'COMPLETE_AND_VALID',
        isComplete: true
      };
    }

    // firstEvent.seq > 1: This is a partial chain / suffix
    if (options?.trustedCheckpoint) {
      const cp = options.trustedCheckpoint;

      // Validate organization ID binding matches the audit chain
      if (cp.orgId !== firstEvent.orgId) {
        return {
          valid: false,
          status: 'INVALID',
          isComplete: false,
          brokenAtSeq: firstEvent.seq,
          error: `Checkpoint organization mismatch: checkpoint orgId ${cp.orgId} does not match audit chain orgId ${firstEvent.orgId}`
        };
      }

      if (firstEvent.seq === cp.seq + 1 && firstEvent.prevHash.toLowerCase() === cp.hash.toLowerCase()) {
        return {
          valid: true,
          status: 'PARTIAL_BUT_LINKS_VALID',
          isComplete: false
        };
      }
      return {
        valid: false,
        status: 'UNANCHORED',
        isComplete: false,
        brokenAtSeq: firstEvent.seq,
        error: `Chain suffix starting at seq ${firstEvent.seq} does not match supplied trusted checkpoint (expected seq ${cp.seq + 1} with prevHash ${cp.hash}, found seq ${firstEvent.seq} with prevHash ${firstEvent.prevHash})`
      };
    }

    // Unanchored suffix starting at seq > 1 without an authenticated trusted checkpoint
    return {
      valid: false,
      status: 'UNANCHORED',
      isComplete: false,
      brokenAtSeq: firstEvent.seq,
      error: `Chain suffix starting at seq ${firstEvent.seq} is unanchored: missing genesis block (seq 1) and no authenticated checkpoint supplied`
    };
  }
}
