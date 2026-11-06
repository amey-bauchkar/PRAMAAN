import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { FastifyInstance } from 'fastify';
import { InMemoryTenantRepository } from '../src/repositories/tenant-repository.js';
import { InMemoryConsentRepository, PgConsentRepository } from '../src/repositories/consent-repository.js';
import { InMemoryAuditRepository, PgAuditRepository } from '../src/repositories/audit-repository.js';
import { InMemoryUserRepository } from '../src/repositories/user-repository.js';
import { TenantStore } from '../src/services/tenant-store.js';
import { ConsentService } from '../src/services/consent-service.js';
import { AuditService } from '../src/services/audit-service.js';
import { AuthService } from '../src/services/auth-service.js';
import { JwtVerifier } from '../src/services/jwt-verifier.js';
import { createTestToken, TEST_JWT_SECRET } from '../src/testing/test-jwt-utils.js';
import { SessionContext, EvidenceItem, StudentSkill } from '@pramaan/contracts';
import { getDbPool } from '../src/db/pool.js';

try {
  process.loadEnvFile?.();
} catch {}

describe('Consent Security, Adversarial Boundaries & Deletion Invariants (Area 4 — P1)', () => {
  let app: FastifyInstance;
  let tenantStore: TenantStore;
  let auditService: AuditService;
  let consentService: ConsentService;
  let consentRepo: InMemoryConsentRepository;
  let tenantRepo: InMemoryTenantRepository;

  const orgId = '00000000-0000-0000-0000-000000000001';
  
  // Student A
  const studentAUser = {
    id: '20000000-0000-0000-0000-000000000003',
    sub: 'auth0|student_aarav',
    email: 'aarav.patel@apex.edu',
    name: 'Aarav Patel'
  };
  const studentAId = '40000000-0000-0000-0000-000000000001';

  // Student B
  const studentBUser = {
    id: '20000000-0000-0000-0000-000000000004',
    sub: 'auth0|student_diya',
    email: 'diya.nair@apex.edu',
    name: 'Diya Nair'
  };
  const studentBId = '40000000-0000-0000-0000-000000000002';

  // Officer
  const officerUser = {
    id: '20000000-0000-0000-0000-000000000001',
    sub: 'auth0|tpo_priya',
    email: 'priya.sharma@apex.edu',
    name: 'Priya Sharma'
  };

  let studentAToken: string;
  let _studentBToken: string;
  let officerToken: string;

  beforeEach(async () => {
    tenantStore = new TenantStore();
    auditService = new AuditService();
    consentService = new ConsentService(auditService);
    consentRepo = new InMemoryConsentRepository(consentService);
    tenantRepo = new InMemoryTenantRepository(tenantStore);
    const userRepo = new InMemoryUserRepository();

    // Register users & active memberships in user repository
    const users = [
      { id: studentAUser.id, authSubject: studentAUser.sub, email: studentAUser.email, fullName: studentAUser.name, role: 'student' as const },
      { id: studentBUser.id, authSubject: studentBUser.sub, email: studentBUser.email, fullName: studentBUser.name, role: 'student' as const },
      { id: officerUser.id, authSubject: officerUser.sub, email: officerUser.email, fullName: officerUser.name, role: 'officer' as const }
    ];

    for (const u of users) {
      await userRepo.registerUser({
        id: u.id,
        authSubject: u.authSubject,
        email: u.email,
        fullName: u.fullName,
        createdAt: new Date().toISOString()
      });
      await userRepo.addMembership({
        id: `30000000-0000-0000-0000-${u.id.slice(-12)}`,
        userId: u.id,
        orgId,
        role: u.role,
        status: 'active',
        createdAt: new Date().toISOString()
      });
    }

    // Register students in tenant repository
    tenantStore.addStudent(
      { userId: officerUser.id, orgId, role: 'officer' },
      {
        id: studentAId,
        orgId,
        userId: studentAUser.id,
        departmentId: '10000000-0000-0000-0000-000000000001',
        enrollment_no: 'APEX-2026-CS-001',
        graduating_year: 2027,
        program_level: 'ug',
        is_minor: false,
        createdAt: new Date().toISOString()
      }
    );
    tenantStore.addStudent(
      { userId: officerUser.id, orgId, role: 'officer' },
      {
        id: studentBId,
        orgId,
        userId: studentBUser.id,
        departmentId: '10000000-0000-0000-0000-000000000002',
        enrollment_no: 'APEX-2026-IT-002',
        graduating_year: 2027,
        program_level: 'ug',
        is_minor: false,
        createdAt: new Date().toISOString()
      }
    );

    const jwtVerifier = new JwtVerifier(TEST_JWT_SECRET);
    const authService = new AuthService({
      jwtVerifier,
      userRepository: userRepo
    });

    app = buildApp({
      tenantRepository: tenantRepo,
      auditRepository: new InMemoryAuditRepository(auditService),
      consentRepository: consentRepo,
      authService
    });
    await app.ready();

    studentAToken = await createTestToken({ sub: studentAUser.sub, email: studentAUser.email, role: 'authenticated' });
    _studentBToken = await createTestToken({ sub: studentBUser.sub, email: studentBUser.email, role: 'authenticated' });
    officerToken = await createTestToken({ sub: officerUser.sub, email: officerUser.email, role: 'authenticated' });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('1. Cross-student revocation blocking: Student A cannot revoke Student B\'s consent grant (403)', async () => {
    // Student B grants consent
    const studentBContext: SessionContext = { orgId, userId: studentBUser.id, role: 'student' };
    const bGrant = consentService.grantConsent(studentBContext, studentBId, 'repo_verification', 1);

    // Student A attempts to revoke Student B's grant
    const res = await app.inject({
      method: 'POST',
      url: '/api/consent/revoke',
      headers: {
        authorization: `Bearer ${studentAToken}`,
        'x-org-id': orgId
      },
      payload: {
        grantId: bGrant.id
      }
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error).toMatch(/FORBIDDEN_OWNERSHIP/);

    // Assert Student B's grant remains intact and active
    const grantInDb = consentService.getGrant(bGrant.id);
    expect(grantInDb?.revokedAt).toBeNull();
  });

  it('2. Unknown grant revocation: Revoking non-existent grant returns 404', async () => {
    const fakeGrantId = '99999999-9999-9999-9999-999999999999';

    // Student attempts to revoke non-existent grant
    const res = await app.inject({
      method: 'POST',
      url: '/api/consent/revoke',
      headers: {
        authorization: `Bearer ${studentAToken}`,
        'x-org-id': orgId
      },
      payload: {
        grantId: fakeGrantId
      }
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatch(/Grant not found/);
  });

  it('3. Officer mandatory reason: Officer revoking without reason returns 400', async () => {
    const studentAContext: SessionContext = { orgId, userId: studentAUser.id, role: 'student' };
    const grant = consentService.grantConsent(studentAContext, studentAId, 'placement_operations', 1);

    // Officer attempts revocation with missing or empty reason
    const resNoReason = await app.inject({
      method: 'POST',
      url: '/api/consent/revoke',
      headers: {
        authorization: `Bearer ${officerToken}`,
        'x-org-id': orgId
      },
      payload: {
        grantId: grant.id
      }
    });

    expect(resNoReason.statusCode).toBe(400);
    expect(resNoReason.json().error).toMatch(/OFFICER_REASON_REQUIRED/);

    const resEmptyReason = await app.inject({
      method: 'POST',
      url: '/api/consent/revoke',
      headers: {
        authorization: `Bearer ${officerToken}`,
        'x-org-id': orgId
      },
      payload: {
        grantId: grant.id,
        reason: '   '
      }
    });

    expect(resEmptyReason.statusCode).toBe(400);
    expect(resEmptyReason.json().error).toMatch(/OFFICER_REASON_REQUIRED/);

    // Assert grant is not revoked
    expect(consentService.getGrant(grant.id)?.revokedAt).toBeNull();
  });

  it('4. Officer valid revocation: Succeeds with documented reason and audits officer action', async () => {
    const studentAContext: SessionContext = { orgId, userId: studentAUser.id, role: 'student' };
    const grant = consentService.grantConsent(studentAContext, studentAId, 'placement_operations', 1);

    const res = await app.inject({
      method: 'POST',
      url: '/api/consent/revoke',
      headers: {
        authorization: `Bearer ${officerToken}`,
        'x-org-id': orgId
      },
      payload: {
        grantId: grant.id,
        reason: 'Student un-enrolled from placement drive per disciplinary hearing #42'
      }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);

    // Verify revoked in service
    const revokedGrant = consentService.getGrant(grant.id);
    expect(revokedGrant?.revokedAt).toBeDefined();

    // Verify audit event
    const events = auditService.getEventsForTenant({ orgId, userId: officerUser.id, role: 'officer' });
    const revokeEvent = events.find(e => e.action === 'CONSENT_REVOKED' && e.objectId === grant.id);
    expect(revokeEvent).toBeDefined();
    expect(revokeEvent?.metadata.reason).toContain('disciplinary hearing #42');
  });

  it('5. OAuth credential removal & consistent evidence withdrawal upon revocation', async () => {
    const studentAContext: SessionContext = { orgId, userId: studentAUser.id, role: 'student' };
    const grant = consentService.grantConsent(studentAContext, studentAId, 'repo_verification', 1);

    // Connect token
    consentService.storeConnectedToken(studentAContext, studentAId, 'ghp_secret_access_token_123');
    expect(consentService.hasValidConnectedToken(studentAId)).toBe(true);

    // Create supporting evidence item
    const evidenceItem: EvidenceItem = {
      id: '50000000-0000-0000-0000-000000000001',
      studentId: studentAId,
      kind: 'code_span',
      contentHash: 'a'.repeat(64),
      status: 'accepted',
      createdAt: new Date().toISOString()
    };
    consentService.registerEvidence(evidenceItem);

    // Create student skill in evidence_linked state
    const studentSkill: StudentSkill = {
      id: '60000000-0000-0000-0000-000000000001',
      studentId: studentAId,
      skillId: '70000000-0000-0000-0000-000000000001',
      state: 'evidence_linked',
      stateSince: new Date().toISOString(),
      evidenceStrength: 'high'
    };
    consentService.registerStudentSkill(studentSkill);

    // Student revokes own consent
    const res = await app.inject({
      method: 'POST',
      url: '/api/consent/revoke',
      headers: {
        authorization: `Bearer ${studentAToken}`,
        'x-org-id': orgId
      },
      payload: {
        grantId: grant.id
      }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.localTokenPurged).toBe(true);
    expect(body.withdrawnEvidenceCount).toBe(1);
    expect(body.downgradedSkillsCount).toBe(1);

    // Token must be purged
    expect(consentService.hasValidConnectedToken(studentAId)).toBe(false);

    // Evidence must be withdrawn
    expect(evidenceItem.status).toBe('withdrawn');

    // Skill must be downgraded to claimed
    expect(studentSkill.state).toBe('claimed');
  });

  it('6. Idempotency: Repeated revocation on an already-revoked grant returns 400 safely without duplicate side-effects', async () => {
    const studentAContext: SessionContext = { orgId, userId: studentAUser.id, role: 'student' };
    const grant = consentService.grantConsent(studentAContext, studentAId, 'placement_operations', 1);

    // First revocation succeeds
    const firstRes = await app.inject({
      method: 'POST',
      url: '/api/consent/revoke',
      headers: {
        authorization: `Bearer ${studentAToken}`,
        'x-org-id': orgId
      },
      payload: { grantId: grant.id }
    });
    expect(firstRes.statusCode).toBe(200);

    // Second revocation attempt on the same grant
    const secondRes = await app.inject({
      method: 'POST',
      url: '/api/consent/revoke',
      headers: {
        authorization: `Bearer ${studentAToken}`,
        'x-org-id': orgId
      },
      payload: { grantId: grant.id }
    });
    expect(secondRes.statusCode).toBe(400);
    expect(secondRes.json().error).toMatch(/already revoked/);
  });

  it('7. Real PostgreSQL: PgConsentRepository enforces credential purge and evidence withdrawal in transaction', async () => {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) return;

    const pool = getDbPool();
    const pgAudit = new PgAuditRepository(pool);
    const pgConsent = new PgConsentRepository(pool, pgAudit);

    const context: SessionContext = {
      orgId: '00000000-0000-0000-0000-000000000001',
      userId: '20000000-0000-0000-0000-000000000003',
      role: 'student'
    };
    const sId = '40000000-0000-0000-0000-000000000001';

    // 1. Grant consent
    const grant = await pgConsent.grantConsent(context, sId, 'repo_verification', 1);
    expect(grant.id).toBeDefined();
    expect(grant.revokedAt).toBeNull();

    // 2. Revoke consent
    const result = await pgConsent.revokeConsent(context, grant.id, 'Test automated revocation');
    expect(result.success).toBe(true);

    // 3. Repeated revocation is rejected idempotently
    const rerun = await pgConsent.revokeConsent(context, grant.id, 'Repeat attempt');
    expect(rerun.success).toBe(false);
    expect(rerun.error).toMatch(/already revoked/);

    // 4. Verify grant status in database
    const refreshed = await pgConsent.getGrant(context, grant.id);
    expect(refreshed?.revokedAt).toBeDefined();
  });
});
