import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuditChain } from '../src/audit-chain.js';
import { AuditEvent, TrustedCheckpoint } from '@pramaan/contracts';

describe('AuditChain Cryptographic Integrity & Authenticated Checkpoint Scenarios', () => {
  const orgId = '11111111-1111-1111-1111-111111111111';
  const testSigningKey = 'secure_audit_checkpoint_key_9876543210';
  const originalSigningKey = process.env.CHECKPOINT_SIGNING_KEY;

  beforeEach(() => {
    process.env.CHECKPOINT_SIGNING_KEY = testSigningKey;
  });

  afterEach(() => {
    if (originalSigningKey !== undefined) {
      process.env.CHECKPOINT_SIGNING_KEY = originalSigningKey;
    } else {
      delete process.env.CHECKPOINT_SIGNING_KEY;
    }
  });

  // Helper to construct a valid 3-event chain starting from genesis (seq 1)
  function buildValidChain(): AuditEvent[] {
    const raw1: Omit<AuditEvent, 'hash'> = {
      id: '22222222-2222-2222-2222-222222222221',
      seq: 1,
      orgId,
      actorType: 'user',
      actorId: '33333333-3333-3333-3333-333333333333',
      action: 'CONSENT_GRANTED',
      objectType: 'consent_grant',
      objectId: '44444444-4444-4444-4444-444444444444',
      metadata: { purpose: 'repo_verification' },
      prevHash: AuditChain.GENESIS_HASH,
      occurredAt: '2026-11-06T00:00:00.000Z'
    };
    const e1: AuditEvent = { ...raw1, hash: AuditChain.calculateHash(raw1) };

    const raw2: Omit<AuditEvent, 'hash'> = {
      id: '22222222-2222-2222-2222-222222222222',
      seq: 2,
      orgId,
      actorType: 'service',
      actorId: null,
      action: 'REPO_IMPORTED',
      objectType: 'repository',
      objectId: '55555555-5555-5555-5555-555555555555',
      metadata: { repoUrl: 'https://github.com/student/algo-lab' },
      prevHash: e1.hash,
      occurredAt: '2026-11-06T00:01:00.000Z'
    };
    const e2: AuditEvent = { ...raw2, hash: AuditChain.calculateHash(raw2) };

    const raw3: Omit<AuditEvent, 'hash'> = {
      id: '22222222-2222-2222-2222-222222222223',
      seq: 3,
      orgId,
      actorType: 'user',
      actorId: '66666666-6666-6666-6666-666666666666',
      action: 'ELIGIBILITY_OVERRIDE',
      objectType: 'eligibility_decision',
      objectId: '77777777-7777-7777-7777-777777777777',
      metadata: { reason: 'Academic council concession' },
      prevHash: e2.hash,
      occurredAt: '2026-11-06T00:02:00.000Z'
    };
    const e3: AuditEvent = { ...raw3, hash: AuditChain.calculateHash(raw3) };

    return [e1, e2, e3];
  }

  // Helper to construct a valid chain suffix (e.g. starting at seq 100000 like College A)
  function buildSuffixChain(startSeq: number = 100000, initialPrevHash: string = 'a'.repeat(64)): AuditEvent[] {
    const raw1: Omit<AuditEvent, 'hash'> = {
      id: '22222222-2222-2222-2222-222222222221',
      seq: startSeq,
      orgId,
      actorType: 'user',
      actorId: '33333333-3333-3333-3333-333333333333',
      action: 'CONSENT_GRANTED',
      objectType: 'consent_grant',
      objectId: '44444444-4444-4444-4444-444444444444',
      metadata: { purpose: 'repo_verification' },
      prevHash: initialPrevHash,
      occurredAt: '2026-11-06T00:00:00.000Z'
    };
    const e1: AuditEvent = { ...raw1, hash: AuditChain.calculateHash(raw1) };

    const raw2: Omit<AuditEvent, 'hash'> = {
      id: '22222222-2222-2222-2222-222222222222',
      seq: startSeq + 1,
      orgId,
      actorType: 'service',
      actorId: null,
      action: 'CONSENT_REVOKED',
      objectType: 'consent_grant',
      objectId: '44444444-4444-4444-4444-444444444444',
      metadata: { reason: 'User requested revocation' },
      prevHash: e1.hash,
      occurredAt: '2026-11-06T00:01:00.000Z'
    };
    const e2: AuditEvent = { ...raw2, hash: AuditChain.calculateHash(raw2) };

    const raw3: Omit<AuditEvent, 'hash'> = {
      id: '22222222-2222-2222-2222-222222222223',
      seq: startSeq + 2,
      orgId,
      actorType: 'user',
      actorId: '66666666-6666-6666-6666-666666666666',
      action: 'CONSENT_GRANTED',
      objectType: 'consent_grant',
      objectId: '55555555-5555-5555-5555-555555555555',
      metadata: { purpose: 'repo_verification' },
      prevHash: e2.hash,
      occurredAt: '2026-11-06T00:02:00.000Z'
    };
    const e3: AuditEvent = { ...raw3, hash: AuditChain.calculateHash(raw3) };

    return [e1, e2, e3];
  }

  // 1. Valid genesis-to-end chain
  it('1. Valid genesis-to-end chain returns COMPLETE_AND_VALID with valid: true and isComplete: true', () => {
    const chain = buildValidChain();
    const res = AuditChain.verifyChain(chain);
    expect(res.valid).toBe(true);
    expect(res.status).toBe('COMPLETE_AND_VALID');
    expect(res.isComplete).toBe(true);
    expect(res.brokenAtSeq).toBeUndefined();
    expect(res.error).toBeUndefined();
  });

  // 2. Valid suffix with an authenticated checkpoint
  it('2. Valid suffix with an authenticated checkpoint returns PARTIAL_BUT_LINKS_VALID with isComplete: false', () => {
    const anchorHash = 'a'.repeat(64);
    const suffix = buildSuffixChain(100000, anchorHash);

    const checkpoint = AuditChain.signCheckpoint({
      orgId,
      seq: 99999,
      hash: anchorHash,
      signedAt: '2026-11-06T00:00:00.000Z'
    }, testSigningKey);

    const res = AuditChain.verifyChain(suffix, {
      trustedCheckpoint: checkpoint
    });
    expect(res.valid).toBe(true);
    expect(res.status).toBe('PARTIAL_BUT_LINKS_VALID');
    expect(res.isComplete).toBe(false); // Explicitly NOT complete genesis chain
    expect(res.brokenAtSeq).toBeUndefined();
    expect(res.error).toBeUndefined();
  });

  // 3. Rejection of unauthenticated plain { seq, hash } object
  it('3. Rejects plain unauthenticated { seq, hash } object without signature as INVALID', () => {
    const suffix = buildSuffixChain(100000, 'a'.repeat(64));
    const unauthenticatedCp = {
      seq: 99999,
      hash: 'a'.repeat(64)
    } as any;

    const res = AuditChain.verifyChain(suffix, {
      trustedCheckpoint: unauthenticatedCp
    });
    expect(res.valid).toBe(false);
    expect(res.status).toBe('INVALID');
    expect(res.isComplete).toBe(false);
    expect(res.error).toMatch(/Unauthenticated checkpoint/);
  });

  // 4. Rejection of historical dummy a*64 hash without authentic cryptographic signature
  it('4. Rejects historical dummy a*64 hash with forged or invalid signature as INVALID', () => {
    const suffix = buildSuffixChain(100000, 'a'.repeat(64));
    const forgedCp: TrustedCheckpoint = {
      orgId,
      seq: 99999,
      hash: 'a'.repeat(64),
      signature: 'deadbeef'.repeat(8), // Forged signature
      signedAt: new Date().toISOString()
    };

    const res = AuditChain.verifyChain(suffix, {
      trustedCheckpoint: forgedCp
    });
    expect(res.valid).toBe(false);
    expect(res.status).toBe('INVALID');
    expect(res.isComplete).toBe(false);
    expect(res.error).toMatch(/Checkpoint signature verification failed/);
  });

  // 5. Unanchored suffix beginning at seq 100000 evaluates to UNANCHORED by default
  it('5. Unanchored suffix beginning at seq 100000 returns UNANCHORED with valid: false and isComplete: false', () => {
    const suffix = buildSuffixChain(100000, 'a'.repeat(64));
    const res = AuditChain.verifyChain(suffix);
    expect(res.valid).toBe(false);
    expect(res.status).toBe('UNANCHORED');
    expect(res.isComplete).toBe(false);
    expect(res.brokenAtSeq).toBe(100000);
    expect(res.error).toMatch(/unanchored: missing genesis block \(seq 1\) and no authenticated checkpoint supplied/);
  });

  // 6. verifySuffixLinks validates internal links without asserting anchor authenticity
  it('6. verifySuffixLinks confirms internal cryptographic links without claiming whole-chain validity', () => {
    const suffix = buildSuffixChain(100000, 'a'.repeat(64));
    const res = AuditChain.verifySuffixLinks(suffix);
    expect(res.valid).toBe(true);
    expect(res.status).toBe('INTERNAL_LINKS_VALID');
    expect(res.brokenAtSeq).toBeUndefined();
  });

  // 7. Checkpoint organization ID binding mismatch
  it('7. Rejects checkpoint when orgId does not match the audit chain orgId', () => {
    const suffix = buildSuffixChain(100000, 'a'.repeat(64));
    const foreignOrgId = '99999999-9999-9999-9999-999999999999';

    const checkpoint = AuditChain.signCheckpoint({
      orgId: foreignOrgId, // Mismatched tenant
      seq: 99999,
      hash: 'a'.repeat(64),
      signedAt: new Date().toISOString()
    }, testSigningKey);

    const res = AuditChain.verifyChain(suffix, {
      trustedCheckpoint: checkpoint
    });
    expect(res.valid).toBe(false);
    expect(res.status).toBe('INVALID');
    expect(res.isComplete).toBe(false);
    expect(res.error).toMatch(/Checkpoint organization mismatch/);
  });

  // 8. Rejects non-finite or negative sequence numbers in checkpoint
  it('8. Rejects non-finite or negative sequence numbers in checkpoint as INVALID', () => {
    const suffix = buildSuffixChain(100000, 'a'.repeat(64));

    const invalidSeqCp = {
      orgId,
      seq: NaN,
      hash: 'a'.repeat(64),
      signature: 'somesig',
      signedAt: new Date().toISOString()
    } as any;

    const res = AuditChain.verifyChain(suffix, {
      trustedCheckpoint: invalidSeqCp
    });
    expect(res.valid).toBe(false);
    expect(res.status).toBe('INVALID');
    expect(res.error).toMatch(/Invalid checkpoint sequence number: seq must be a finite non-negative integer/);
  });

  // 9. Missing first records without checkpoint
  it('9. Missing first records (chain truncated at seq 2) returns UNANCHORED with valid: false', () => {
    const chain = buildValidChain();
    const truncatedChain = [chain[1], chain[2]]; // starts at seq 2
    const res = AuditChain.verifyChain(truncatedChain);
    expect(res.valid).toBe(false);
    expect(res.status).toBe('UNANCHORED');
    expect(res.isComplete).toBe(false);
    expect(res.brokenAtSeq).toBe(2);
    expect(res.error).toMatch(/unanchored: missing genesis block/);
  });

  // 10. Tampered first remaining event
  it('10. Tampered first remaining event in a suffix returns INVALID with valid: false', () => {
    const anchorHash = 'a'.repeat(64);
    const suffix = buildSuffixChain(100000, anchorHash);
    suffix[0] = {
      ...suffix[0],
      action: 'TAMPERED_ACTION'
    };

    const checkpoint = AuditChain.signCheckpoint({
      orgId,
      seq: 99999,
      hash: anchorHash,
      signedAt: new Date().toISOString()
    }, testSigningKey);

    const res = AuditChain.verifyChain(suffix, {
      trustedCheckpoint: checkpoint
    });
    expect(res.valid).toBe(false);
    expect(res.status).toBe('INVALID');
    expect(res.brokenAtSeq).toBe(100000);
    expect(res.error).toMatch(/Tampered event payload at seq 100000/);
  });

  // 11. Broken link between subsequent events
  it('11. Broken link between subsequent events returns INVALID with valid: false', () => {
    const anchorHash = 'a'.repeat(64);
    const suffix = buildSuffixChain(100000, anchorHash);
    const corruptedRaw: Omit<AuditEvent, 'hash'> = {
      ...suffix[1],
      prevHash: 'f'.repeat(64)
    };
    suffix[1] = {
      ...corruptedRaw,
      hash: AuditChain.calculateHash(corruptedRaw)
    };

    const checkpoint = AuditChain.signCheckpoint({
      orgId,
      seq: 99999,
      hash: anchorHash,
      signedAt: new Date().toISOString()
    }, testSigningKey);

    const res = AuditChain.verifyChain(suffix, {
      trustedCheckpoint: checkpoint
    });
    expect(res.valid).toBe(false);
    expect(res.status).toBe('INVALID');
    expect(res.brokenAtSeq).toBe(100001);
    expect(res.error).toMatch(/Broken hash link at seq 100001/);
  });

  // 12. Sequence discontinuity
  it('12. Sequence discontinuity returns INVALID with valid: false', () => {
    const anchorHash = 'a'.repeat(64);
    const suffix = buildSuffixChain(100000, anchorHash);
    suffix[1] = { ...suffix[1], seq: 100005 };

    const checkpoint = AuditChain.signCheckpoint({
      orgId,
      seq: 99999,
      hash: anchorHash,
      signedAt: new Date().toISOString()
    }, testSigningKey);

    const res = AuditChain.verifyChain(suffix, {
      trustedCheckpoint: checkpoint
    });
    expect(res.valid).toBe(false);
    expect(res.status).toBe('INVALID');
    expect(res.brokenAtSeq).toBe(100005);
    expect(res.error).toMatch(/Sequence discontinuity between seq 100000 and 100005/);
  });

  // 13. Invalid genesis hash
  it('13. Invalid genesis hash at seq 1 returns INVALID with valid: false', () => {
    const chain = buildValidChain();
    const corruptedGenesisRaw: Omit<AuditEvent, 'hash'> = {
      ...chain[0],
      prevHash: '1'.repeat(64)
    };
    chain[0] = {
      ...corruptedGenesisRaw,
      hash: AuditChain.calculateHash(corruptedGenesisRaw)
    };
    const res = AuditChain.verifyChain(chain);
    expect(res.valid).toBe(false);
    expect(res.status).toBe('INVALID');
    expect(res.brokenAtSeq).toBe(1);
    expect(res.error).toMatch(/Invalid genesis block hash at seq 1/);
  });

  // 14. Tampered event metadata in intact chain
  it('14. Tampered event metadata in intact chain returns INVALID with valid: false', () => {
    const chain = buildValidChain();
    chain[1] = {
      ...chain[1],
      metadata: { repoUrl: 'https://github.com/malicious/spoofed-repo' }
    };
    const res = AuditChain.verifyChain(chain);
    expect(res.valid).toBe(false);
    expect(res.status).toBe('INVALID');
    expect(res.brokenAtSeq).toBe(2);
    expect(res.error).toMatch(/Tampered event payload at seq 2/);
  });

  // 15. Reordered events
  it('15. Reordered events in chain returns INVALID with valid: false', () => {
    const chain = buildValidChain();
    const reorderedChain = [chain[0], chain[2], chain[1]];
    const res = AuditChain.verifyChain(reorderedChain);
    expect(res.valid).toBe(false);
    expect(res.status).toBe('INVALID');
    expect(res.brokenAtSeq).toBe(3);
    expect(res.error).toMatch(/Sequence discontinuity|Broken hash link/);
  });

  // 16. Trusted checkpoint hash/sequence mismatch
  it('16. Trusted checkpoint hash mismatch returns UNANCHORED with valid: false', () => {
    const suffix = buildSuffixChain(100000, 'a'.repeat(64));

    const checkpoint = AuditChain.signCheckpoint({
      orgId,
      seq: 99999,
      hash: 'b'.repeat(64), // Mismatched hash
      signedAt: new Date().toISOString()
    }, testSigningKey);

    const res = AuditChain.verifyChain(suffix, {
      trustedCheckpoint: checkpoint
    });
    expect(res.valid).toBe(false);
    expect(res.status).toBe('UNANCHORED');
    expect(res.brokenAtSeq).toBe(100000);
    expect(res.error).toMatch(/does not match supplied trusted checkpoint/);
  });

  // 17. Empty event array returns COMPLETE_AND_VALID
  it('17. Empty event array returns COMPLETE_AND_VALID with valid: true and isComplete: true', () => {
    const res = AuditChain.verifyChain([]);
    expect(res.valid).toBe(true);
    expect(res.status).toBe('COMPLETE_AND_VALID');
    expect(res.isComplete).toBe(true);
  });

  // 18. Caller cannot override trusted verification key (Regression test P1-2)
  it('18. Caller cannot override trusted verification key: ignores caller key and rejects mismatched checkpoint as INVALID', () => {
    process.env.CHECKPOINT_SIGNING_KEY = testSigningKey;
    const suffix = buildSuffixChain(100000, 'a'.repeat(64));

    const rogueKey = 'attacker_controlled_rogue_secret_key_99999';
    const rogueCheckpoint = AuditChain.signCheckpoint({
      orgId,
      seq: 99999,
      hash: 'a'.repeat(64),
      signedAt: '2026-11-06T00:00:00.000Z'
    }, rogueKey);

    // Attacker passes their rogueKey in caller options
    const res = AuditChain.verifyChain(suffix, {
      trustedCheckpoint: rogueCheckpoint,
      checkpointSigningKey: rogueKey
    } as any);

    expect(res.valid).toBe(false);
    expect(res.status).toBe('INVALID');
    expect(res.isComplete).toBe(false);
    expect(res.error).toMatch(/Checkpoint signature verification failed/);
  });

  // 19. Missing backend CHECKPOINT_SIGNING_KEY fails closed
  it('19. Fails closed as INVALID when backend CHECKPOINT_SIGNING_KEY is not configured', () => {
    delete process.env.CHECKPOINT_SIGNING_KEY;
    const suffix = buildSuffixChain(100000, 'a'.repeat(64));
    const checkpoint = AuditChain.signCheckpoint({
      orgId,
      seq: 99999,
      hash: 'a'.repeat(64),
      signedAt: '2026-11-06T00:00:00.000Z'
    }, testSigningKey);

    const res = AuditChain.verifyChain(suffix, { trustedCheckpoint: checkpoint });
    expect(res.valid).toBe(false);
    expect(res.status).toBe('INVALID');
    expect(res.error).toMatch(/Checkpoint verification failed: signing key is required/);
  });
});
