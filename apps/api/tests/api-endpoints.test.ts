import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { FastifyInstance } from 'fastify';
import { AuthService } from '../src/services/auth-service.js';
import { JwtVerifier } from '../src/services/jwt-verifier.js';
import { createTestToken } from '../src/testing/test-jwt-utils.js';
import { InMemoryUserRepository } from '../src/repositories/user-repository.js';
import { TenantStore } from '../src/services/tenant-store.js';
import { AuditService } from '../src/services/audit-service.js';
import { ConsentService } from '../src/services/consent-service.js';

describe('PRAMAAN Fastify HTTP Endpoints: Authentication & RBAC Authorization', () => {
  let app: FastifyInstance;
  let jwtVerifier: JwtVerifier;
  let authService: AuthService;
  let userRepo: InMemoryUserRepository;
  let tenantStore: TenantStore;
  let auditService: AuditService;
  let consentService: ConsentService;

  const testSecret = 'pramaan-endpoint-test-secret-32-chars-long!';
  const apexOrgId = '00000000-0000-0000-0000-000000000001';
  const zenithOrgId = '00000000-0000-0000-0000-000000000002';

  const tpoUserId = '20000000-0000-0000-0000-000000000001';
  const tpoAuthSubject = 'supabase-tpo-priya-sub';

  const studentUserId = '20000000-0000-0000-0000-000000000003';
  const studentAuthSubject = 'supabase-student-aarav-sub';
  const studentRecordId = '40000000-0000-0000-0000-000000000001';

  let tpoToken: string;
  let studentToken: string;

  beforeEach(async () => {
    jwtVerifier = new JwtVerifier(testSecret);
    userRepo = new InMemoryUserRepository();
    authService = new AuthService({ jwtVerifier, userRepository: userRepo });
    tenantStore = new TenantStore();
    auditService = new AuditService();
    consentService = new ConsentService(auditService);

    await userRepo.registerUser({
      id: tpoUserId,
      authSubject: tpoAuthSubject,
      email: 'priya.sharma@apex.edu',
      fullName: 'Priya Sharma',
      createdAt: new Date().toISOString()
    });
    await userRepo.addMembership({
      id: '30000000-0000-0000-0000-000000000001',
      userId: tpoUserId,
      orgId: apexOrgId,
      role: 'officer',
      status: 'active',
      createdAt: new Date().toISOString()
    });

    await userRepo.registerUser({
      id: studentUserId,
      authSubject: studentAuthSubject,
      email: 'aarav.patel@apex.edu',
      fullName: 'Aarav Patel',
      createdAt: new Date().toISOString()
    });
    await userRepo.addMembership({
      id: '30000000-0000-0000-0000-000000000003',
      userId: studentUserId,
      orgId: apexOrgId,
      departmentId: '10000000-0000-0000-0000-000000000001',
      role: 'student',
      status: 'active',
      createdAt: new Date().toISOString()
    });

    // Seed student record in tenant store
    tenantStore.addStudent(
      { userId: tpoUserId, orgId: apexOrgId, role: 'officer' },
      {
        id: studentRecordId,
        orgId: apexOrgId,
        userId: studentUserId,
        departmentId: '10000000-0000-0000-0000-000000000001',
        enrollment_no: 'APEX-2026-CS-001',
        graduating_year: 2026,
        program_level: 'undergraduate',
        is_minor: false,
        createdAt: new Date().toISOString()
      }
    );

    tpoToken = await createTestToken({
      sub: tpoAuthSubject,
      email: 'priya.sharma@apex.edu'
    }, { customSecret: testSecret });

    studentToken = await createTestToken({
      sub: studentAuthSubject,
      email: 'aarav.patel@apex.edu'
    }, { customSecret: testSecret });

    app = buildApp({
      authService,
      tenantStore,
      auditService,
      consentService
    });
  });

  it('1. GET /health is public and returns healthy status without credentials', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health'
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);
    expect(json.status).toBe('healthy');
    expect(json.service).toBe('pramaan-api');
  });

  it('2. GET /api/tenants requires authentication (fails 401 without Bearer token)', async () => {
    const unauthRes = await app.inject({
      method: 'GET',
      url: '/api/tenants'
    });
    expect(unauthRes.statusCode).toBe(401);
    expect(JSON.parse(unauthRes.payload).error).toMatch(/AUTHENTICATION_REQUIRED/);

    const authRes = await app.inject({
      method: 'GET',
      url: '/api/tenants',
      headers: {
        authorization: `Bearer ${tpoToken}`
      }
    });
    expect(authRes.statusCode).toBe(200);
    const json = JSON.parse(authRes.payload);
    expect(Array.isArray(json)).toBe(true);
    // Under tenant isolation (P0-3), an Apex officer only discovers Apex, never foreign college Zenith
    expect(json.length).toBe(1);
    expect(json[0].id).toBe(apexOrgId);
    expect(json[0].name).toBe('Apex Institute of Technology');
    expect(json.some((t: any) => t.id === zenithOrgId)).toBe(false);
  });

  it('3. GET /api/students enforces role isolation (Student sees only self, Officer sees cohort)', async () => {
    // 1. As Student
    const studentRes = await app.inject({
      method: 'GET',
      url: '/api/students',
      headers: {
        authorization: `Bearer ${studentToken}`
      }
    });
    expect(studentRes.statusCode).toBe(200);
    const studentList = JSON.parse(studentRes.payload);
    expect(studentList).toHaveLength(1);
    expect(studentList[0].userId).toBe(studentUserId);

    // 2. As Officer
    const officerRes = await app.inject({
      method: 'GET',
      url: '/api/students',
      headers: {
        authorization: `Bearer ${tpoToken}`
      }
    });
    expect(officerRes.statusCode).toBe(200);
    const officerList = JSON.parse(officerRes.payload);
    expect(officerList.length).toBeGreaterThanOrEqual(1);
  });

  it('4. POST /api/consent/grant prohibits officers from granting consent on behalf of students', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/consent/grant',
      headers: {
        authorization: `Bearer ${tpoToken}`
      },
      payload: {
        studentId: studentRecordId,
        purpose: 'repo_verification',
        noticeVersion: 1
      }
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload).error).toMatch(/Placement officers and mentors cannot grant consent/);
  });

  it('5. POST /api/consent/grant allows students to grant consent for their own identity', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/consent/grant',
      headers: {
        authorization: `Bearer ${studentToken}`
      },
      payload: {
        studentId: studentRecordId,
        purpose: 'repo_verification',
        noticeVersion: 1
      }
    });

    expect(res.statusCode).toBe(201);
    const grant = JSON.parse(res.payload);
    expect(grant.id).toBeDefined();
    expect(grant.studentId).toBe(studentRecordId);
    expect(grant.purpose).toBe('repo_verification');
  });

  it('6. GET /api/audit prohibits student role access and permits officer role', async () => {
    // 1. Student attempted access -> 403 Forbidden
    const studentAuditRes = await app.inject({
      method: 'GET',
      url: '/api/audit',
      headers: {
        authorization: `Bearer ${studentToken}`
      }
    });
    expect(studentAuditRes.statusCode).toBe(403);
    expect(JSON.parse(studentAuditRes.payload).error).toMatch(/Audit ledger access is restricted/);

    // 2. Officer access -> 200 OK
    const officerAuditRes = await app.inject({
      method: 'GET',
      url: '/api/audit',
      headers: {
        authorization: `Bearer ${tpoToken}`
      }
    });
    expect(officerAuditRes.statusCode).toBe(200);
    const events = JSON.parse(officerAuditRes.payload);
    expect(Array.isArray(events)).toBe(true);
  });

  it('7. GET /api/audit/verify verifies cryptographic chain and enforces officer role guard', async () => {
    // 1. Student attempted access -> 403 Forbidden
    const studentVerify = await app.inject({
      method: 'GET',
      url: '/api/audit/verify',
      headers: {
        authorization: `Bearer ${studentToken}`
      }
    });
    expect(studentVerify.statusCode).toBe(403);

    // 2. Officer access -> 200 OK with valid: true
    const officerVerify = await app.inject({
      method: 'GET',
      url: '/api/audit/verify',
      headers: {
        authorization: `Bearer ${tpoToken}`
      }
    });
    expect(officerVerify.statusCode).toBe(200);
    const verifyResult = JSON.parse(officerVerify.payload);
    expect(verifyResult.valid).toBe(true);
  });
});
