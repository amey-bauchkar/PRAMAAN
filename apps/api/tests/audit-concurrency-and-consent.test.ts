import { describe, it, expect } from 'vitest';
import { getDbPool } from '../src/db/pool.js';
import { PgAuditRepository } from '../src/repositories/audit-repository.js';
import { PgConsentRepository } from '../src/repositories/consent-repository.js';
import { SessionContext } from '@pramaan/contracts';
import { AuditChain } from '@pramaan/domain';
import { randomUUID } from 'crypto';

try {
  process.loadEnvFile?.();
} catch {}

describe('PRAMAAN Audit Chain Concurrency (P1-4) & Tenant-Scoped Consent (P1-5)', () => {
  const dbUrl = process.env.DATABASE_URL;
  const isPostgresAvailable = !!dbUrl;

  const orgAId = '00000000-0000-0000-0000-000000000001';
  const orgBId = '00000000-0000-0000-0000-000000000002';
  const studentAId = '40000000-0000-0000-0000-000000000001';
  const userAId = '20000000-0000-0000-0000-000000000003';
  const userBId = '20000000-0000-0000-0000-000000000005';

  const contextA: SessionContext = {
    orgId: orgAId,
    userId: userAId,
    role: 'student'
  };

  const contextB: SessionContext = {
    orgId: orgBId,
    userId: userBId,
    role: 'officer'
  };

  it('1. Audit Chain Concurrency: Multiple simultaneous audit writes serialize without duplicate seq or chain forks (P1-4)', async () => {
    if (!isPostgresAvailable) return;

    const pool = getDbPool();
    const auditRepo = new PgAuditRepository(pool);

    // Concurrently write 8 audit events for tenant Zenith (clean chain starting from genesis)
    const concurrentCount = 8;
    const actions = Array.from({ length: concurrentCount }, (_, i) => `CONCURRENT_ACTION_${i}_${randomUUID().slice(0, 8)}`);

    const promises = actions.map(action =>
      auditRepo.log(contextB, action, 'test_batch_concurrent', randomUUID(), { timestamp: Date.now() })
    );

    const writtenEvents = await Promise.all(promises);
    expect(writtenEvents.length).toBe(concurrentCount);

    // Verify all sequence numbers are distinct and monotonically increasing
    const seqs = writtenEvents.map(e => e.seq).sort((a, b) => a - b);
    expect(seqs.length).toBe(concurrentCount);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBe(seqs[i - 1] + 1);
    }

    // Fetch entire chain for tenant B from database
    const allEvents = await auditRepo.getEventsForTenant(contextB);
    expect(allEvents.length).toBeGreaterThanOrEqual(concurrentCount);

    // Verify cryptographic integrity of the entire chain
    const verification = AuditChain.verifyChain(allEvents);
    expect(verification.valid).toBe(true);
    expect(verification.status).toBe('COMPLETE_AND_VALID');
    expect(verification.brokenAtSeq).toBeUndefined();
    expect(verification.error).toBeUndefined();
  });

  it('2. Audit Transaction Integration: logInTransaction executes on existing client without nested pool checkout (P1-4)', async () => {
    if (!isPostgresAvailable) return;

    const pool = getDbPool();
    const auditRepo = new PgAuditRepository(pool);
    const consentRepo = new PgConsentRepository(pool, auditRepo);

    // grantConsent internally uses client and calls logInTransaction with valid FK purpose
    const grant = await consentRepo.grantConsent(contextA, studentAId, 'repo_verification', 1);
    expect(grant.id).toBeDefined();

    // Verify corresponding audit event was recorded with matching grantId
    const events = await auditRepo.getEventsForTenant(contextA);
    const auditEvent = events.find(e => e.action === 'CONSENT_GRANTED' && e.objectId === grant.id);
    expect(auditEvent).toBeDefined();
    expect(auditEvent?.metadata).toMatchObject({ studentId: studentAId, purpose: 'repo_verification' });

    // Revocation also logs atomically in same transaction
    const revResult = await consentRepo.revokeConsent(contextA, grant.id, 'Concurrency test revocation');
    expect(revResult.success).toBe(true);

    const refreshedEvents = await auditRepo.getEventsForTenant(contextA);
    const revokeAudit = refreshedEvents.find(e => e.action === 'CONSENT_REVOKED' && e.objectId === grant.id);
    expect(revokeAudit).toBeDefined();
  });

  it('3. hasActiveConsent: Returns true for active grant and false once revoked (P1-5)', async () => {
    if (!isPostgresAvailable) return;

    const pool = getDbPool();
    const consentRepo = new PgConsentRepository(pool);

    // 1. Initially check when grant active
    const grant = await consentRepo.grantConsent(contextA, studentAId, 'placement_operations', 1);
    const hasConsentBefore = await consentRepo.hasActiveConsent(contextA, studentAId, 'placement_operations');
    expect(hasConsentBefore).toBe(true);

    // 2. Revoke grant
    await consentRepo.revokeConsent(contextA, grant.id, 'Test revocation');

    // 3. Check again -> false
    const hasConsentAfter = await consentRepo.hasActiveConsent(contextA, studentAId, 'placement_operations');
    expect(hasConsentAfter).toBe(false);
  });

  it('4. hasActiveConsent: Cross-tenant lookup returns false due to strict RLS enforcement (P1-5)', async () => {
    if (!isPostgresAvailable) return;

    const pool = getDbPool();
    const consentRepo = new PgConsentRepository(pool);

    // Create active grant for studentA in College A
    const grant = await consentRepo.grantConsent(contextA, studentAId, 'repo_verification', 1);
    expect(grant.id).toBeDefined();

    // College A queries -> true
    const collegeACheck = await consentRepo.hasActiveConsent(contextA, studentAId, 'repo_verification');
    expect(collegeACheck).toBe(true);

    // College B queries Student A with College B context -> must return false because RLS isolates College B
    const collegeBCheck = await consentRepo.hasActiveConsent(contextB, studentAId, 'repo_verification');
    expect(collegeBCheck).toBe(false);
  });

  it('5. hasActiveConsent: Missing or invalid SessionContext fails closed (P1-5)', async () => {
    if (!isPostgresAvailable) return;

    const pool = getDbPool();
    const consentRepo = new PgConsentRepository(pool);

    const invalidContext: any = {
      orgId: '',
      userId: '',
      role: ''
    };

    await expect(
      consentRepo.hasActiveConsent(invalidContext, studentAId, 'placement_operations')
    ).rejects.toThrow(/TENANT_CONTEXT_REQUIRED/);
  });
});
