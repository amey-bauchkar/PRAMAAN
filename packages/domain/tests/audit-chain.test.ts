import { describe, it, expect } from 'vitest';
import { AuditChain } from '../src/audit-chain.js';
import { AuditEvent } from '@pramaan/contracts';

describe('AuditChain Cryptographic Integrity & 5 Tamper Scenarios', () => {
  const orgId = '11111111-1111-1111-1111-111111111111';

  // Helper to construct a valid 3-event chain
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

  it('validates an intact, un-tampered cryptographic hash chain', () => {
    const chain = buildValidChain();
    const verification = AuditChain.verifyChain(chain);
    expect(verification.valid).toBe(true);
  });

  it('Scenario 1: Detects modified event metadata', () => {
    const chain = buildValidChain();
    // Tamper with event 2 metadata without updating hash
    chain[1] = {
      ...chain[1],
      metadata: { repoUrl: 'https://github.com/malicious/spoofed-repo' }
    };

    const res = AuditChain.verifyChain(chain);
    expect(res.valid).toBe(false);
    expect(res.brokenAtSeq).toBe(2);
    expect(res.error).toMatch(/Tampered event payload/);
  });

  it('Scenario 2: Detects deleted event (sequence discontinuity)', () => {
    const chain = buildValidChain();
    // Drop event 2 from the middle
    const brokenChain = [chain[0], chain[2]];

    const res = AuditChain.verifyChain(brokenChain);
    expect(res.valid).toBe(false);
    expect(res.brokenAtSeq).toBe(3);
    expect(res.error).toMatch(/Sequence discontinuity between seq 1 and 3/);
  });

  it('Scenario 3: Detects missing sequence even if hash matched', () => {
    const chain = buildValidChain();
    // Artificially change seq of event 2 to 5
    chain[1] = { ...chain[1], seq: 5 };

    const res = AuditChain.verifyChain(chain);
    expect(res.valid).toBe(false);
    expect(res.brokenAtSeq).toBe(5);
    expect(res.error).toMatch(/Sequence discontinuity/);
  });

  it('Scenario 4: Detects incorrect previous hash (broken chain link)', () => {
    const chain = buildValidChain();
    // Corrupt prevHash of event 3
    const corruptedRaw: Omit<AuditEvent, 'hash'> = {
      ...chain[2],
      prevHash: 'f'.repeat(64) // Wrong prevHash!
    };
    chain[2] = {
      ...corruptedRaw,
      hash: AuditChain.calculateHash(corruptedRaw) // Re-hashed with corrupted prevHash
    };

    const res = AuditChain.verifyChain(chain);
    expect(res.valid).toBe(false);
    expect(res.brokenAtSeq).toBe(3);
    expect(res.error).toMatch(/Broken hash link at seq 3/);
  });

  it('Scenario 5: Detects reordered events', () => {
    const chain = buildValidChain();
    // Swap event 2 and event 3
    const reorderedChain = [chain[0], chain[2], chain[1]];

    const res = AuditChain.verifyChain(reorderedChain);
    expect(res.valid).toBe(false);
    // Should fail immediately at the swapped index
    expect(res.brokenAtSeq).toBe(3);
    expect(res.error).toMatch(/Sequence discontinuity|Broken hash link/);
  });

  it('Scenario 6: Detects invalid genesis block hash', () => {
    const chain = buildValidChain();
    // Corrupt genesis prevHash on seq 1
    const corruptedGenesisRaw: Omit<AuditEvent, 'hash'> = {
      ...chain[0],
      prevHash: '1'.repeat(64) // Non-genesis hash!
    };
    chain[0] = {
      ...corruptedGenesisRaw,
      hash: AuditChain.calculateHash(corruptedGenesisRaw)
    };

    const res = AuditChain.verifyChain(chain);
    expect(res.valid).toBe(false);
    expect(res.brokenAtSeq).toBe(1);
    expect(res.error).toMatch(/Invalid genesis block hash at seq 1/);
  });
});
