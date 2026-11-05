import { describe, it, expect, beforeEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { AuthService } from '../src/services/auth-service.js';
import { JwtVerifier } from '../src/services/jwt-verifier.js';
import { InMemoryUserRepository } from '../src/repositories/user-repository.js';
import { TenantStore } from '../src/services/tenant-store.js';
import { AuditService } from '../src/services/audit-service.js';
import { ConsentService } from '../src/services/consent-service.js';
import { createTestToken, TEST_JWT_SECRET } from '../src/testing/test-jwt-utils.js';

describe('API Route Positive RBAC Matrix & Tenant Sanitization (P0-4, P0-6)', () => {
  let app: FastifyInstance;
  let jwtVerifier: JwtVerifier;
  let authService: AuthService;
  let userRepo: InMemoryUserRepository;
  let tenantStore: TenantStore;
  let auditService: AuditService;
  let consentService: ConsentService;

  const apexOrgId = '00000000-0000-0000-0000-000000000001';

  // Users for RBAC testing
  const studentUser1 = {
    id: '20000000-0000-0000-0000-000000000003',
    authSubject: 'sub-student-1',
    email: 'student1@apex.edu',
    fullName: 'Student One',
    createdAt: new Date().toISOString()
  };
  const studentUser2 = {
    id: '20000000-0000-0000-0000-000000000004',
    authSubject: 'sub-student-2',
    email: 'student2@apex.edu',
    fullName: 'Student Two',
    createdAt: new Date().toISOString()
  };
  const officerUser = {
    id: '20000000-0000-0000-0000-000000000001',
    authSubject: 'sub-officer',
    email: 'officer@apex.edu',
    fullName: 'Placement Officer',
    createdAt: new Date().toISOString()
  };
  const mentorUser = {
    id: '20000000-0000-0000-0000-000000000005',
    authSubject: 'sub-mentor',
    email: 'mentor@apex.edu',
    fullName: 'Cohort Mentor',
    createdAt: new Date().toISOString()
  };
  const recruiterUser = {
    id: '20000000-0000-0000-0000-000000000006',
    authSubject: 'sub-recruiter',
    email: 'recruiter@techcorp.com',
    fullName: 'Tech Recruiter',
    createdAt: new Date().toISOString()
  };
  const universityAdminUser = {
    id: '20000000-0000-0000-0000-000000000007',
    authSubject: 'sub-uni-admin',
    email: 'chancellor@state-university.edu',
    fullName: 'University Chancellor',
    createdAt: new Date().toISOString()
  };
  const platformAdminUser = {
    id: '20000000-0000-0000-0000-000000000008',
    authSubject: 'sub-plat-admin',
    email: 'ops@pramaan.internal',
    fullName: 'Platform Operator',
    createdAt: new Date().toISOString()
  };

  let student1Token: string;
  let student2Token: string;
  let officerToken: string;
  let mentorToken: string;
  let recruiterToken: string;
  let universityAdminToken: string;
  let platformAdminToken: string;

  beforeEach(async () => {
    jwtVerifier = new JwtVerifier(TEST_JWT_SECRET);
    userRepo = new InMemoryUserRepository();
    authService = new AuthService({ jwtVerifier, userRepository: userRepo });
    tenantStore = new TenantStore();
    auditService = new AuditService();
    consentService = new ConsentService(auditService);

    const users = [
      { user: studentUser1, role: 'student' as const },
      { user: studentUser2, role: 'student' as const },
      { user: officerUser, role: 'officer' as const },
      { user: mentorUser, role: 'mentor' as const },
      { user: recruiterUser, role: 'recruiter' as const },
      { user: universityAdminUser, role: 'university_admin' as const },
      { user: platformAdminUser, role: 'platform_admin' as const },
    ];

    for (const { user, role } of users) {
      await userRepo.registerUser(user);
      await userRepo.addMembership({
        id: `30000000-0000-0000-0000-${user.id.slice(-12)}`,
        userId: user.id,
        orgId: apexOrgId,
        role,
        status: 'active',
        createdAt: new Date().toISOString()
      });
    }

    // Seed student records in tenant store
    tenantStore.addStudent(
      { userId: officerUser.id, orgId: apexOrgId, role: 'officer' },
      {
        id: '40000000-0000-0000-0000-000000000001',
        orgId: apexOrgId,
        userId: studentUser1.id,
        departmentId: '10000000-0000-0000-0000-000000000001',
        enrollment_no: 'APEX-2026-CS-001',
        graduating_year: 2026,
        program_level: 'undergraduate',
        is_minor: false,
        createdAt: new Date().toISOString()
      }
    );
    tenantStore.addStudent(
      { userId: officerUser.id, orgId: apexOrgId, role: 'officer' },
      {
        id: '40000000-0000-0000-0000-000000000002',
        orgId: apexOrgId,
        userId: studentUser2.id,
        departmentId: '10000000-0000-0000-0000-000000000001',
        enrollment_no: 'APEX-2026-CS-002',
        graduating_year: 2026,
        program_level: 'undergraduate',
        is_minor: false,
        createdAt: new Date().toISOString()
      }
    );

    student1Token = await createTestToken({ sub: studentUser1.authSubject, email: studentUser1.email });
    student2Token = await createTestToken({ sub: studentUser2.authSubject, email: studentUser2.email });
    officerToken = await createTestToken({ sub: officerUser.authSubject, email: officerUser.email });
    mentorToken = await createTestToken({ sub: mentorUser.authSubject, email: mentorUser.email });
    recruiterToken = await createTestToken({ sub: recruiterUser.authSubject, email: recruiterUser.email });
    universityAdminToken = await createTestToken({ sub: universityAdminUser.authSubject, email: universityAdminUser.email });
    platformAdminToken = await createTestToken({ sub: platformAdminUser.authSubject, email: platformAdminUser.email });

    app = buildApp({
      authService,
      tenantStore,
      auditService,
      consentService
    });
  });

  // --- GET /api/tenants ---
  describe('GET /api/tenants (Tenant discovery sanitization)', () => {
    it('returns sanitized organization metadata without leaking config, keyRef, or rateLimitConfig', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/tenants',
        headers: { authorization: `Bearer ${officerToken}` }
      });

      expect(res.statusCode).toBe(200);
      const orgs = JSON.parse(res.body);
      expect(Array.isArray(orgs)).toBe(true);
      expect(orgs.length).toBeGreaterThan(0);

      for (const org of orgs) {
        expect(org.id).toBeDefined();
        expect(org.name).toBeDefined();
        expect(org.kind).toBeDefined();
        // Secrets, internal keys, and internal configs must NEVER be present
        expect(org.config).toBeUndefined();
        expect(org.keyRef).toBeUndefined();
        expect(org.rateLimitConfig).toBeUndefined();
      }
    });
  });

  // --- GET /api/students ---
  describe('GET /api/students (RBAC & Tenant Isolation)', () => {
    it('officer can list cohort students', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/students',
        headers: { authorization: `Bearer ${officerToken}` }
      });
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.length).toBe(2);
    });

    it('mentor can list cohort students', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/students',
        headers: { authorization: `Bearer ${mentorToken}` }
      });
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.length).toBe(2);
    });

    it('student can only see their own student record', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/students',
        headers: { authorization: `Bearer ${student1Token}` }
      });
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.length).toBe(1);
      expect(data[0].userId).toBe(studentUser1.id);
    });

    it('recruiter is rejected with 403 FORBIDDEN_ROLE', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/students',
        headers: { authorization: `Bearer ${recruiterToken}` }
      });
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error).toMatch(/FORBIDDEN_ROLE/);
    });

    it('university_admin is rejected with 403 FORBIDDEN_ROLE', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/students',
        headers: { authorization: `Bearer ${universityAdminToken}` }
      });
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error).toMatch(/FORBIDDEN_ROLE/);
    });
  });

  // --- POST /api/consent/grant ---
  describe('POST /api/consent/grant (Student Only & Ownership Guard)', () => {
    it('student can grant consent for their own account', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/consent/grant',
        headers: { authorization: `Bearer ${student1Token}` },
        payload: {
          studentId: studentUser1.id,
          purpose: 'repo_verification',
          noticeVersion: 1
        }
      });
      expect(res.statusCode).toBe(201);
      const grant = JSON.parse(res.body);
      expect(grant.studentId).toBe(studentUser1.id);
      expect(grant.purpose).toBe('repo_verification');
    });

    it('student cannot grant consent for another student (FORBIDDEN_OWNERSHIP)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/consent/grant',
        headers: { authorization: `Bearer ${student1Token}` },
        payload: {
          studentId: studentUser2.id, // Student 2's ID!
          purpose: 'repo_verification',
          noticeVersion: 1
        }
      });
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error).toMatch(/FORBIDDEN_OWNERSHIP/);
    });

    it('officer cannot grant consent on behalf of a student (FORBIDDEN_ROLE)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/consent/grant',
        headers: { authorization: `Bearer ${officerToken}` },
        payload: {
          studentId: studentUser1.id,
          purpose: 'repo_verification'
        }
      });
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error).toMatch(/FORBIDDEN_ROLE/);
    });

    it('recruiter cannot grant consent (FORBIDDEN_ROLE)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/consent/grant',
        headers: { authorization: `Bearer ${recruiterToken}` },
        payload: {
          studentId: studentUser1.id,
          purpose: 'repo_verification'
        }
      });
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error).toMatch(/FORBIDDEN_ROLE/);
    });
  });

  // --- POST /api/consent/revoke ---
  describe('POST /api/consent/revoke (Ownership and Officer Reason)', () => {
    let student1GrantId: string;

    beforeEach(async () => {
      // Create active grant for student 1
      const grantRes = await app.inject({
        method: 'POST',
        url: '/api/consent/grant',
        headers: { authorization: `Bearer ${student1Token}` },
        payload: {
          studentId: studentUser1.id,
          purpose: 'repo_verification'
        }
      });
      student1GrantId = JSON.parse(grantRes.body).id;
    });

    it('student can revoke their own consent grant', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/consent/revoke',
        headers: { authorization: `Bearer ${student1Token}` },
        payload: { grantId: student1GrantId }
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).success).toBe(true);
    });

    it('officer can revoke consent when documented reason is provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/consent/revoke',
        headers: { authorization: `Bearer ${officerToken}` },
        payload: {
          grantId: student1GrantId,
          reason: 'Student graduated and left college cohort'
        }
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).success).toBe(true);
    });

    it('officer revocation fails if documented reason is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/consent/revoke',
        headers: { authorization: `Bearer ${officerToken}` },
        payload: { grantId: student1GrantId } // No reason!
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toMatch(/OFFICER_REASON_REQUIRED/);
    });

    it('mentor cannot revoke consent (FORBIDDEN_ROLE)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/consent/revoke',
        headers: { authorization: `Bearer ${mentorToken}` },
        payload: { grantId: student1GrantId, reason: 'test' }
      });
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error).toMatch(/FORBIDDEN_ROLE/);
    });
  });

  // --- GET /api/audit & GET /api/audit/verify ---
  describe('GET /api/audit & /api/audit/verify (Compliance Ledger RBAC)', () => {
    it('officer and university admin can view audit ledger', async () => {
      const officerRes = await app.inject({
        method: 'GET',
        url: '/api/audit',
        headers: { authorization: `Bearer ${officerToken}` }
      });
      expect(officerRes.statusCode).toBe(200);

      const uniAdminRes = await app.inject({
        method: 'GET',
        url: '/api/audit',
        headers: { authorization: `Bearer ${universityAdminToken}` }
      });
      expect(uniAdminRes.statusCode).toBe(200);
    });

    it('student and mentor are forbidden from viewing audit ledger', async () => {
      const studentRes = await app.inject({
        method: 'GET',
        url: '/api/audit',
        headers: { authorization: `Bearer ${student1Token}` }
      });
      expect(studentRes.statusCode).toBe(403);

      const mentorRes = await app.inject({
        method: 'GET',
        url: '/api/audit',
        headers: { authorization: `Bearer ${mentorToken}` }
      });
      expect(mentorRes.statusCode).toBe(403);
    });

    it('officer can verify audit chain integrity', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/audit/verify',
        headers: { authorization: `Bearer ${officerToken}` }
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).valid).toBe(true);
    });

    it('university admin is forbidden from audit chain verification', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/audit/verify',
        headers: { authorization: `Bearer ${universityAdminToken}` }
      });
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error).toMatch(/FORBIDDEN_ROLE/);
    });
  });
});
