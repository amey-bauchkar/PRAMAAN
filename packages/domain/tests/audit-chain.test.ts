import { describe, it, expect } from 'vitest';
import { AuditChain } from '../src/audit-chain.js';
import { AuditEvent } from '@pramaan/contracts';

describe('AuditChain Cryptographic Integrity & Tamper / Verification Scenarios', () => {
  const orgId = '11111111-1111-1111-1111-111111111111';

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
  it('1. Valid genesis-to-end chain returns COMPLETE_AND_VALID with valid: true', () => {
    const chain = buildValidChain();
    const res = AuditChain.verifyChain(chain);
    expect(res.valid).toBe(true);
    expect(res.status).toBe('COMPLETE_AND_VALID');
    expect(res.brokenAtSeq).toBeUndefined();
    expect(res.error).toBeUndefined();
  });

  // 2. Valid suffix with explicitly supplied trusted checkpoint
  it('2. Valid suffix with an explicitly supplied trusted checkpoint returns PARTIAL_BUT_LINKS_VALID with valid: true', () => {
    const anchorHash = 'a'.repeat(64);
    const suffix = buildSuffixChain(100000, anchorHash);
    const res = AuditChain.verifyChain(suffix, {
      trustedCheckpoint: { seq: 99999, hash: anchorHash }
    });
    expect(res.valid).toBe(true);
    expect(res.status).toBe('PARTIAL_BUT_LINKS_VALID');
    expect(res.brokenAtSeq).toBeUndefined();
    expect(res.error).toBeUndefined();
  });

  // 3. Unanchored suffix beginning at seq 100000
  it('3. Unanchored suffix beginning at seq 100000 returns UNANCHORED with valid: false', () => {
    const suffix = buildSuffixChain(100000, 'a'.repeat(64));
    const res = AuditChain.verifyChain(suffix);
    expect(res.valid).toBe(false);
    expect(res.status).toBe('UNANCHORED');
    expect(res.brokenAtSeq).toBe(100000);
    expect(res.error).toMatch(/unanchored: missing genesis block \(seq 1\) and no trusted checkpoint supplied/);
  });

  // 4. Missing first records
  it('4. Missing first records (chain truncated at seq 2) returns UNANCHORED with valid: false', () => {
    const chain = buildValidChain();
    const truncatedChain = [chain[1], chain[2]]; // starts at seq 2
    const res = AuditChain.verifyChain(truncatedChain);
    expect(res.valid).toBe(false);
    expect(res.status).toBe('UNANCHORED');
    expect(res.brokenAtSeq).toBe(2);
    expect(res.error).toMatch(/unanchored: missing genesis block \(seq 1\) and no trusted checkpoint supplied/);
  });

  // 5. Tampered first remaining event
  it('5. Tampered first remaining event in a suffix returns INVALID with valid: false', () => {
    const suffix = buildSuffixChain(100000, 'a'.repeat(64));
    // Tamper with first remaining event payload
    suffix[0] = {
      ...suffix[0],
      action: 'TAMPERED_ACTION'
    };
    const res = AuditChain.verifyChain(suffix, {
      trustedCheckpoint: { seq: 99999, hash: 'a'.repeat(64) }
    });
    expect(res.valid).toBe(false);
    expect(res.status).toBe('INVALID');
    expect(res.brokenAtSeq).toBe(100000);
    expect(res.error).toMatch(/Tampered event payload at seq 100000/);
  });

  // 6. Broken link between subsequent events
  it('6. Broken link between subsequent events returns INVALID with valid: false', () => {
    const suffix = buildSuffixChain(100000, 'a'.repeat(64));
    const corruptedRaw: Omit<AuditEvent, 'hash'> = {
      ...suffix[1],
      prevHash: 'f'.repeat(64)
    };
    suffix[1] = {
      ...corruptedRaw,
      hash: AuditChain.calculateHash(corruptedRaw)
    };
    const res = AuditChain.verifyChain(suffix, {
      trustedCheckpoint: { seq: 99999, hash: 'a'.repeat(64) }
    });
    expect(res.valid).toBe(false);
    expect(res.status).toBe('INVALID');
    expect(res.brokenAtSeq).toBe(100001);
    expect(res.error).toMatch(/Broken hash link at seq 100001/);
  });

  // 7. Sequence discontinuity
  it('7. Sequence discontinuity returns INVALID with valid: false', () => {
    const suffix = buildSuffixChain(100000, 'a'.repeat(64));
    suffix[1] = { ...suffix[1], seq: 100005 };
    const res = AuditChain.verifyChain(suffix, {
      trustedCheckpoint: { seq: 99999, hash: 'a'.repeat(64) }
    });
    expect(res.valid).toBe(false);
    expect(res.status).toBe('INVALID');
    expect(res.brokenAtSeq).toBe(100005);
    expect(res.error).toMatch(/Sequence discontinuity between seq 100000 and 100005/);
  });

  // 8. Invalid genesis hash
  it('8. Invalid genesis hash at seq 1 returns INVALID with valid: false', () => {
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

  // 9. Tampered event metadata in intact chain
  it('9. Tampered event metadata in intact chain returns INVALID with valid: false', () => {
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

  // 10. Reordered events
  it('10. Reordered events in chain returns INVALID with valid: false', () => {
    const chain = buildValidChain();
    const reorderedChain = [chain[0], chain[2], chain[1]];
    const res = AuditChain.verifyChain(reorderedChain);
    expect(res.valid).toBe(false);
    expect(res.status).toBe('INVALID');
    expect(res.brokenAtSeq).toBe(3);
    expect(res.error).toMatch(/Sequence discontinuity|Broken hash link/);
  });

  // 11. Trusted checkpoint mismatch
  it('11. Trusted checkpoint mismatch returns UNANCHORED with valid: false', () => {
    const suffix = buildSuffixChain(100000, 'a'.repeat(64));
    const res = AuditChain.verifyChain(suffix, {
      trustedCheckpoint: { seq: 99999, hash: 'b'.repeat(64) }
    });
    expect(res.valid).toBe(false);
    expect(res.status).toBe('UNANCHORED');
    expect(res.brokenAtSeq).toBe(100000);
    expect(res.error).toMatch(/does not match supplied trusted checkpoint/);
  });

  // 12. Invalid trusted checkpoint configuration format
  it('12. Malformed trusted checkpoint configuration returns INVALID with valid: false', () => {
    const suffix = buildSuffixChain(100000, 'a'.repeat(64));
    const res = AuditChain.verifyChain(suffix, {
      trustedCheckpoint: { seq: 99999, hash: 'short-invalid-hash' }
    });
    expect(res.valid).toBe(false);
    expect(res.status).toBe('INVALID');
    expect(res.error).toMatch(/Invalid trusted checkpoint configuration/);
  });

  // 13. Empty event array returns COMPLETE_AND_VALID
  it('13. Empty event array returns COMPLETE_AND_VALID with valid: true', () => {
    const res = AuditChain.verifyChain([]);
    expect(res.valid).toBe(true);
    expect(res.status).toBe('COMPLETE_AND_VALID');
  });
});
