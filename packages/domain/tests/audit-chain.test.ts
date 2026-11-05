import { describe, it, expect } from 'vitest';
import { AuditChain } from '../src/audit-chain.js';
import { AuditEvent } from '@pramaan/contracts';

describe('AuditChain Cryptographic Integrity', () => {
  const orgId = '11111111-1111-1111-1111-111111111111';

  it('generates a valid hash chain across sequential events', () => {
    const rawEvents: Array<Omit<AuditEvent, 'hash'>> = [
      {
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
      }
    ];

    const event1Hash = AuditChain.calculateHash(rawEvents[0]);
    const event1: AuditEvent = { ...rawEvents[0], hash: event1Hash };

    const rawEvent2: Omit<AuditEvent, 'hash'> = {
      id: '22222222-2222-2222-2222-222222222222',
      seq: 2,
      orgId,
      actorType: 'service',
      actorId: null,
      action: 'REPO_IMPORTED',
      objectType: 'repository',
      objectId: '55555555-5555-5555-5555-555555555555',
      metadata: { repoUrl: 'https://github.com/student/algo-lab' },
      prevHash: event1.hash,
      occurredAt: '2026-11-06T00:01:00.000Z'
    };
    const event2Hash = AuditChain.calculateHash(rawEvent2);
    const event2: AuditEvent = { ...rawEvent2, hash: event2Hash };

    const rawEvent3: Omit<AuditEvent, 'hash'> = {
      id: '22222222-2222-2222-2222-222222222223',
      seq: 3,
      orgId,
      actorType: 'user',
      actorId: '66666666-6666-6666-6666-666666666666',
      action: 'ELIGIBILITY_OVERRIDE',
      objectType: 'eligibility_decision',
      objectId: '77777777-7777-7777-7777-777777777777',
      metadata: { reason: 'Academic council concession' },
      prevHash: event2.hash,
      occurredAt: '2026-11-06T00:02:00.000Z'
    };
    const event3Hash = AuditChain.calculateHash(rawEvent3);
    const event3: AuditEvent = { ...rawEvent3, hash: event3Hash };

    const chain = [event1, event2, event3];
    const verification = AuditChain.verifyChain(chain);
    expect(verification.valid).toBe(true);
  });

  it('detects tampering in metadata of an existing event', () => {
    const rawEvent1: Omit<AuditEvent, 'hash'> = {
      id: '22222222-2222-2222-2222-222222222221',
      seq: 1,
      orgId,
      actorType: 'user',
      actorId: null,
      action: 'INIT',
      objectType: 'org',
      objectId: null,
      metadata: { init: true },
      prevHash: AuditChain.GENESIS_HASH,
      occurredAt: '2026-11-06T00:00:00.000Z'
    };
    const event1: AuditEvent = { ...rawEvent1, hash: AuditChain.calculateHash(rawEvent1) };

    const rawEvent2: Omit<AuditEvent, 'hash'> = {
      id: '22222222-2222-2222-2222-222222222222',
      seq: 2,
      orgId,
      actorType: 'user',
      actorId: null,
      action: 'OVERRIDE',
      objectType: 'decision',
      objectId: null,
      metadata: { approved: false },
      prevHash: event1.hash,
      occurredAt: '2026-11-06T00:01:00.000Z'
    };
    const event2: AuditEvent = { ...rawEvent2, hash: AuditChain.calculateHash(rawEvent2) };

    // Tamper with event2 metadata without updating hash
    const tamperedEvent2: AuditEvent = {
      ...event2,
      metadata: { approved: true } // Tampered!
    };

    const chain = [event1, tamperedEvent2];
    const verification = AuditChain.verifyChain(chain);
    expect(verification.valid).toBe(false);
    expect(verification.brokenAtSeq).toBe(2);
    expect(verification.error).toMatch(/Tampered event payload/);
  });

  it('detects deleted or dropped event in sequence', () => {
    const rawEvent1: Omit<AuditEvent, 'hash'> = {
      id: 'e1',
      seq: 1,
      orgId,
      actorType: 'user',
      action: 'A',
      objectType: 'O',
      metadata: {},
      prevHash: AuditChain.GENESIS_HASH,
      occurredAt: '2026-11-06T00:00:00.000Z'
    };
    const event1 = { ...rawEvent1, hash: AuditChain.calculateHash(rawEvent1) };

    const rawEvent2: Omit<AuditEvent, 'hash'> = {
      id: 'e2',
      seq: 2,
      orgId,
      actorType: 'user',
      action: 'B',
      objectType: 'O',
      metadata: {},
      prevHash: event1.hash,
      occurredAt: '2026-11-06T00:01:00.000Z'
    };
    const event2 = { ...rawEvent2, hash: AuditChain.calculateHash(rawEvent2) };

    const rawEvent3: Omit<AuditEvent, 'hash'> = {
      id: 'e3',
      seq: 3,
      orgId,
      actorType: 'user',
      action: 'C',
      objectType: 'O',
      metadata: {},
      prevHash: event2.hash,
      occurredAt: '2026-11-06T00:02:00.000Z'
    };
    const event3 = { ...rawEvent3, hash: AuditChain.calculateHash(rawEvent3) };

    // Delete event2 from chain
    const brokenChain = [event1, event3];
    const verification = AuditChain.verifyChain(brokenChain);
    expect(verification.valid).toBe(false);
    expect(verification.brokenAtSeq).toBe(3);
    expect(verification.error).toMatch(/Sequence discontinuity/);
  });
});

