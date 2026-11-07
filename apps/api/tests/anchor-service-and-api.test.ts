import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { randomUUID, createHash } from 'crypto';
import { buildApp } from '../src/app.js';
import { AuthService } from '../src/services/auth-service.js';
import { JwtVerifier } from '../src/services/jwt-verifier.js';
import { InMemoryUserRepository } from '../src/repositories/user-repository.js';
import { TenantStore } from '../src/services/tenant-store.js';
import { AuditService } from '../src/services/audit-service.js';
import { ConsentService } from '../src/services/consent-service.js';
import { InMemoryAuditRepository } from '../src/repositories/audit-repository.js';
import { InMemoryConsentRepository } from '../src/repositories/consent-repository.js';
import { createTestToken, TEST_JWT_SECRET } from '../src/testing/test-jwt-utils.js';
import {
  ExactCodeAnchor,
  SourceSnapshot,
  TypeScriptAstParser,
  InMemorySourceSnapshotStore,
  InMemoryTrustedIngestionStore,
  TrustedIngestionRecord,
} from '@pramaan/domain';

describe('Anchor Service & Evidence Endpoints (M2 — P0-05)', () => {
  let app: FastifyInstance;
  let jwtVerifier: JwtVerifier;
  let authService: AuthService;
  let userRepo: InMemoryUserRepository;
  let tenantStore: TenantStore;
  let auditService: AuditService;
  let consentService: ConsentService;

  const currentParserVersion = new TypeScriptAstParser().parserVersion;
  const collegeAOrgId = '00000000-0000-0000-0000-000000000001';
  const collegeBOrgId = '00000000-0000-0000-0000-000000000002';

  const studentUser1 = {
    id: '20000000-0000-0000-0000-000000000003',
    authSubject: 'sub-student-1',
    email: 'student1@apex.edu',
    fullName: 'Student One',
    createdAt: new Date().toISOString(),
  };

  const studentUser2 = {
    id: '20000000-0000-0000-0000-000000000004',
    authSubject: 'sub-student-2',
    email: 'student2@apex.edu',
    fullName: 'Student Two',
    createdAt: new Date().toISOString(),
  };

  const officerUser = {
    id: '20000000-0000-0000-0000-000000000001',
    authSubject: 'sub-officer',
    email: 'officer@apex.edu',
    fullName: 'Placement Officer',
    createdAt: new Date().toISOString(),
  };

  const mentorUser = {
    id: '20000000-0000-0000-0000-000000000002',
    authSubject: 'sub-mentor',
    email: 'mentor@apex.edu',
    fullName: 'Faculty Mentor',
    createdAt: new Date().toISOString(),
  };

  const adminUser = {
    id: '20000000-0000-0000-0000-000000000009',
    authSubject: 'sub-admin',
    email: 'admin@apex.edu',
    fullName: 'Platform Admin',
    createdAt: new Date().toISOString(),
  };

  const sampleTypeScriptCode = `export function addNumbers(a: number, b: number): number {
  return a + b;
}

export class MathOperations {
  public multiply(x: number, y: number): number {
    return x * y;
  }
}
`;

  const sampleRepoId = '11111111-1111-1111-1111-111111111111';
  const sampleCommitSha = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
  const sampleFilePath = 'src/math.ts';
  const rawBytes = Buffer.from(sampleTypeScriptCode, 'utf8');
  const rawFileHash = createHash('sha256').update(rawBytes).digest('hex');

  let student1Token: string;
  let student2Token: string;
  let officerToken: string;
  let mentorToken: string;
  let adminToken: string;
  let collegeBSessionToken: string;

  beforeEach(async () => {
    jwtVerifier = new JwtVerifier(TEST_JWT_SECRET);
    userRepo = new InMemoryUserRepository();
    tenantStore = new TenantStore();
    auditService = new AuditService();
    consentService = new ConsentService(auditService);

    for (const { user, role } of [
      { user: studentUser1, role: 'student' as const },
      { user: studentUser2, role: 'student' as const },
      { user: officerUser, role: 'officer' as const },
      { user: mentorUser, role: 'mentor' as const },
      { user: adminUser, role: 'platform_admin' as const },
    ]) {
      await userRepo.registerUser(user);
      await userRepo.addMembership({
        id: `30000000-0000-0000-0000-${user.id.slice(-12)}`,
        userId: user.id,
        orgId: collegeAOrgId,
        role,
        status: 'active',
        createdAt: new Date().toISOString(),
      });
    }

    // Seed student in College B for cross-tenant testing
    const collegeBStudentUser = {
      id: '20000000-0000-0000-0000-000000000099',
      authSubject: 'sub-college-b-student',
      email: 'student@zenith.edu',
      fullName: 'Zenith Student',
      createdAt: new Date().toISOString(),
    };
    await userRepo.registerUser(collegeBStudentUser);
    await userRepo.addMembership({
      id: '30000000-0000-0000-0000-000000000099',
      userId: collegeBStudentUser.id,
      orgId: collegeBOrgId,
      role: 'student',
      status: 'active',
      createdAt: new Date().toISOString(),
    });

    authService = new AuthService({
      jwtVerifier,
      userRepository: userRepo,
    });

    app = buildApp({
      persistenceMode: 'in-memory',
      authService,
      tenantStore,
      auditService,
      consentService,
    });

    student1Token = await createTestToken({
      sub: studentUser1.authSubject,
      email: studentUser1.email,
    });

    student2Token = await createTestToken({
      sub: studentUser2.authSubject,
      email: studentUser2.email,
    });

    officerToken = await createTestToken({
      sub: officerUser.authSubject,
      email: officerUser.email,
    });

    mentorToken = await createTestToken({
      sub: mentorUser.authSubject,
      email: mentorUser.email,
    });

    adminToken = await createTestToken({
      sub: adminUser.authSubject,
      email: adminUser.email,
    });

    // Token for College B student
    collegeBSessionToken = await createTestToken({
      sub: 'sub-college-b-student',
      email: 'student@zenith.edu',
    });
  });

  // --------------------------------------------------------------------------
  // 1. Snapshot Registration API
  // --------------------------------------------------------------------------

  it('1. POST /api/evidence/snapshots registers immutable snapshot and logs audit event', async () => {
    // Student 1 grants purpose consent
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      capturedAt: new Date().toISOString(),
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/evidence/snapshots',
      headers: {
        authorization: `Bearer ${officerToken}`,
        'x-org-id': collegeAOrgId,
      },
      payload: { snapshot },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().success).toBe(true);
    expect(res.json().snapshotId).toBe(snapshot.snapshotId);

    // Verify audit log contains SNAPSHOT_REGISTERED event
    const auditRes = await app.inject({
      method: 'GET',
      url: '/api/audit',
      headers: {
        authorization: `Bearer ${officerToken}`,
        'x-org-id': collegeAOrgId,
      },
    });
    expect(auditRes.statusCode).toBe(200);
    const events = auditRes.json();
    const snapEvent = events.find((e: any) => e.action === 'SNAPSHOT_REGISTERED');
    expect(snapEvent).toBeDefined();
    expect(snapEvent.metadata.commitSha).toBe(sampleCommitSha);
    expect(snapEvent.metadata.rawFileHash).toBe(rawFileHash);
  });

  it('2. POST /api/evidence/snapshots rejects snapshot with corrupted hash', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const corruptedSnapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash: '0'.repeat(64), // Deliberate mismatch
      capturedAt: new Date().toISOString(),
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/evidence/snapshots',
      headers: {
        authorization: `Bearer ${officerToken}`,
        'x-org-id': collegeAOrgId,
      },
      payload: { snapshot: corruptedSnapshot },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('rawFileHash mismatch');
  });

  // --------------------------------------------------------------------------
  // 2. Anchor Resolution API & Tenant Isolation
  // --------------------------------------------------------------------------

  it('3. POST /api/evidence/anchors/resolve resolves valid anchor against snapshot', async () => {
    // 1. Student 1 grants purpose consent
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    // 2. Register snapshot with trusted student owner
    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      capturedAt: new Date().toISOString(),
    };

    const snapRes = await app.inject({
      method: 'POST',
      url: '/api/evidence/snapshots',
      headers: {
        authorization: `Bearer ${officerToken}`,
        'x-org-id': collegeAOrgId,
      },
      payload: { snapshot },
    });
    expect(snapRes.statusCode).toBe(201);

    // 3. Create anchor for lines 1 to 3 (addNumbers)
    const lines = sampleTypeScriptCode.split('\n');
    const funcSpan = lines.slice(0, 3).join('\n');
    const contentHash = createHash('sha256').update(Buffer.from(funcSpan, 'utf8')).digest('hex');

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: collegeAOrgId,
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 1,
      lineEnd: 3,
      contentHash,
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/evidence/anchors/resolve',
      headers: {
        authorization: `Bearer ${officerToken}`,
        'x-org-id': collegeAOrgId,
      },
      payload: { anchor },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('RESOLVED');
    expect(body.valid).toBe(true);
    expect(body.codeSpan).toContain('function addNumbers');
    expect(body.computedHash).toBe(contentHash);
  });

  it('4. POST /api/evidence/anchors/resolve strictly rejects cross-tenant anchor access (403)', async () => {
    // Anchor belongs to College B, but caller is logged into College A
    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: collegeBOrgId, // Tenant College B!
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 1,
      lineEnd: 3,
      contentHash: 'a'.repeat(64),
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/evidence/anchors/resolve',
      headers: {
        authorization: `Bearer ${officerToken}`, // Belongs to College A
        'x-org-id': collegeAOrgId,
      },
      payload: { anchor },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('CROSS_TENANT_ACCESS_REJECTED');
    expect(res.json().valid).toBe(false);
  });

  it('5. POST /api/evidence/anchors/resolve rejects Student A accessing Student B anchor (403)', async () => {
    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: collegeAOrgId,
      studentId: studentUser2.id, // Student 2's evidence
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 1,
      lineEnd: 3,
      contentHash: 'a'.repeat(64),
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    // Caller is Student 1 trying to resolve Student 2's anchor
    const res = await app.inject({
      method: 'POST',
      url: '/api/evidence/anchors/resolve',
      headers: {
        authorization: `Bearer ${student1Token}`,
        'x-org-id': collegeAOrgId,
      },
      payload: { anchor },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('FORBIDDEN_STUDENT_ACCESS');

    // College B student trying to access College A endpoint
    const crossTenantRes = await app.inject({
      method: 'POST',
      url: '/api/evidence/anchors/resolve',
      headers: {
        authorization: `Bearer ${collegeBSessionToken}`,
        'x-org-id': collegeAOrgId,
      },
      payload: { anchor },
    });
    expect(crossTenantRes.statusCode).toBe(403);

    // Student 2 can resolve their own anchor once consent is active (fails with 404 SNAPSHOT_NOT_FOUND rather than 403 FORBIDDEN)
    const grantRes = await app.inject({
      method: 'POST',
      url: '/api/consent/grant',
      headers: {
        authorization: `Bearer ${student2Token}`,
        'x-org-id': collegeAOrgId,
      },
      payload: {
        studentId: studentUser2.id,
        purpose: 'repo_verification',
        noticeVersion: 1,
      },
    });
    expect(grantRes.statusCode).toBe(201);

    const student2SelfRes = await app.inject({
      method: 'POST',
      url: '/api/evidence/anchors/resolve',
      headers: {
        authorization: `Bearer ${student2Token}`,
        'x-org-id': collegeAOrgId,
      },
      payload: { anchor },
    });
    expect(student2SelfRes.statusCode).toBe(404);
    expect(student2SelfRes.json().error).toBe('SNAPSHOT_NOT_FOUND');
  });

  it('6. POST /api/evidence/anchors/resolve enforces purpose-specific consent requirement', async () => {
    // Snapshot
    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      capturedAt: new Date().toISOString(),
    };

    // Student 1 has NOT granted repo_verification consent
    const lines = sampleTypeScriptCode.split('\n');
    const funcSpan = lines.slice(0, 3).join('\n');
    const contentHash = createHash('sha256').update(Buffer.from(funcSpan, 'utf8')).digest('hex');

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: collegeAOrgId,
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 1,
      lineEnd: 3,
      contentHash,
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    // Attempt without consent
    const resWithoutConsent = await app.inject({
      method: 'POST',
      url: '/api/evidence/anchors/resolve',
      headers: {
        authorization: `Bearer ${student1Token}`,
        'x-org-id': collegeAOrgId,
      },
      payload: { anchor, snapshot },
    });

    expect(resWithoutConsent.statusCode).toBe(422);
    expect(resWithoutConsent.json().error).toBe('CONSENT_REQUIRED_OR_REVOKED');

    // Now Student 1 grants purpose consent for repo_verification
    const grantRes = await app.inject({
      method: 'POST',
      url: '/api/consent/grant',
      headers: {
        authorization: `Bearer ${student1Token}`,
        'x-org-id': collegeAOrgId,
      },
      payload: {
        studentId: studentUser1.id,
        purpose: 'repo_verification',
        noticeVersion: 1,
      },
    });
    expect(grantRes.statusCode).toBe(201);

    // Attempt WITH consent -> RESOLVED
    const resWithConsent = await app.inject({
      method: 'POST',
      url: '/api/evidence/anchors/resolve',
      headers: {
        authorization: `Bearer ${student1Token}`,
        'x-org-id': collegeAOrgId,
      },
      payload: { anchor, snapshot },
    });

    expect(resWithConsent.statusCode).toBe(200);
    expect(resWithConsent.json().status).toBe('RESOLVED');
    expect(resWithConsent.json().valid).toBe(true);
  });

  it('7. POST /api/evidence/anchors/resolve returns 404 on missing snapshot', async () => {
    // Ensure student has active consent so resolution proceeds to snapshot check
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: collegeAOrgId,
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/missing-file.ts',
      lineStart: 1,
      lineEnd: 5,
      contentHash: 'a'.repeat(64),
      rawFileHash: 'b'.repeat(64),
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/evidence/anchors/resolve',
      headers: {
        authorization: `Bearer ${officerToken}`,
        'x-org-id': collegeAOrgId,
      },
      payload: { anchor },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().status).toBe('SNAPSHOT_NOT_FOUND');
  });

  // --------------------------------------------------------------------------
  // 3. Static AST Parsing API (Zero Untrusted Execution)
  // --------------------------------------------------------------------------

  it('8. POST /api/evidence/parse extracts code symbols without executing untrusted code', async () => {
    // Student 1 grants purpose consent
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/evidence/parse',
      headers: {
        authorization: `Bearer ${officerToken}`,
        'x-org-id': collegeAOrgId,
      },
      payload: {
        studentId: studentUser1.id,
        filePath: 'src/math.ts',
        source: sampleTypeScriptCode,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.parserName).toBe('typescript-ast');
    expect(body.diagnosticOnly).toBe(true);
    expect(body.authoritative).toBe(false);
    expect(body.symbols.length).toBeGreaterThanOrEqual(3);

    const funcSymbol = body.symbols.find((s: any) => s.name === 'addNumbers');
    expect(funcSymbol).toBeDefined();
    expect(funcSymbol.kind).toBe('function');
    expect(funcSymbol.lineStart).toBe(1);
    expect(funcSymbol.lineEnd).toBe(3);

    const classSymbol = body.symbols.find((s: any) => s.name === 'MathOperations');
    expect(classSymbol).toBeDefined();
    expect(classSymbol.kind).toBe('class');

    const methodSymbol = body.symbols.find((s: any) => s.name === 'multiply');
    expect(methodSymbol).toBeDefined();
    expect(methodSymbol.kind).toBe('method');
    expect(methodSymbol.containerName).toBe('MathOperations');
  });

  // --------------------------------------------------------------------------
  // 4. Audit Chain Cryptographic Integrity
  // --------------------------------------------------------------------------

  it('9. Cryptographic Audit Chain confirms SHA-256 integrity of all anchor transactions', async () => {
    // Ensure Student 1 has active consent
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    // Execute a series of snapshot registrations and anchor resolutions
    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      capturedAt: new Date().toISOString(),
    };

    await app.inject({
      method: 'POST',
      url: '/api/evidence/snapshots',
      headers: {
        authorization: `Bearer ${officerToken}`,
        'x-org-id': collegeAOrgId,
      },
      payload: { snapshot },
    });

    // Verify audit chain
    const verifyRes = await app.inject({
      method: 'GET',
      url: '/api/audit/verify',
      headers: {
        authorization: `Bearer ${officerToken}`,
        'x-org-id': collegeAOrgId,
      },
    });

    expect(verifyRes.statusCode).toBe(200);
    const verifyBody = verifyRes.json();
    expect(verifyBody.valid).toBe(true);
    expect(verifyBody.status).toBe('COMPLETE_AND_VALID');
  });

  // --------------------------------------------------------------------------
  // 5. Hardened Security & Adversarial Regressions (Sections 4, 5, 6, 8, 10)
  // --------------------------------------------------------------------------

  it('10. POST /api/evidence/anchors/resolve fails closed when studentId is omitted (STUDENT_OWNERSHIP_REQUIRED)', async () => {
    const anchorWithoutStudent: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: collegeAOrgId,
      // studentId omitted!
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 1,
      lineEnd: 3,
      contentHash: 'a'.repeat(64),
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/evidence/anchors/resolve',
      headers: {
        authorization: `Bearer ${officerToken}`,
        'x-org-id': collegeAOrgId,
      },
      payload: { anchor: anchorWithoutStudent },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('STUDENT_OWNERSHIP_REQUIRED');
  });

  it('11. POST /api/evidence/anchors/resolve fails closed when student attempts to forge studentId', async () => {
    // Caller is Student 1, but requests anchor with studentId = Student 2
    const forgedAnchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: collegeAOrgId,
      studentId: studentUser2.id, // Forged!
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 1,
      lineEnd: 3,
      contentHash: 'a'.repeat(64),
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/evidence/anchors/resolve',
      headers: {
        authorization: `Bearer ${student1Token}`,
        'x-org-id': collegeAOrgId,
      },
      payload: { anchor: forgedAnchor },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('FORBIDDEN_STUDENT_ACCESS');
  });

  it('12. POST /api/evidence/anchors/resolve fails closed after consent is revoked', async () => {
    // 1. Student grants consent
    const grant = await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    // 2. Student revokes consent
    await consentService.revokeConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      grant.id,
      'Student requested revocation'
    );

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: collegeAOrgId,
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 1,
      lineEnd: 3,
      contentHash: 'a'.repeat(64),
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/evidence/anchors/resolve',
      headers: {
        authorization: `Bearer ${student1Token}`,
        'x-org-id': collegeAOrgId,
      },
      payload: { anchor },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('CONSENT_REQUIRED_OR_REVOKED');
  });

  it('13. POST /api/evidence/anchors/resolve prevents officer from bypassing student consent requirement', async () => {
    // Student 2 has NOT granted consent
    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: collegeAOrgId,
      studentId: studentUser2.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 1,
      lineEnd: 3,
      contentHash: 'a'.repeat(64),
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    // Placement Officer calls resolve on Student 2's unconsented repository evidence
    const res = await app.inject({
      method: 'POST',
      url: '/api/evidence/anchors/resolve',
      headers: {
        authorization: `Bearer ${officerToken}`,
        'x-org-id': collegeAOrgId,
      },
      payload: { anchor },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('CONSENT_REQUIRED_OR_REVOKED');
  });

  it('14. POST /api/evidence/anchors/resolve prevents mentor from bypassing student consent requirement', async () => {
    // Student 2 has NOT granted consent
    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: collegeAOrgId,
      studentId: studentUser2.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 1,
      lineEnd: 3,
      contentHash: 'a'.repeat(64),
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    // Mentor calls resolve on Student 2's unconsented repository evidence
    const res = await app.inject({
      method: 'POST',
      url: '/api/evidence/anchors/resolve',
      headers: {
        authorization: `Bearer ${mentorToken}`,
        'x-org-id': collegeAOrgId,
      },
      payload: { anchor },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('CONSENT_REQUIRED_OR_REVOKED');
  });

  it('15. POST /api/evidence/anchors/resolve fails closed when consent infrastructure is unavailable (503)', async () => {
    const { AnchorService } = await import('../src/services/anchor-service.js');
    const serviceWithoutConsent = new AnchorService({
      auditRepo: new InMemoryAuditRepository(auditService),
      consentRepo: undefined, // Unavailable!
    });

    const appWithoutConsent = buildApp({
      persistenceMode: 'in-memory',
      authService,
      anchorService: serviceWithoutConsent,
    });

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: collegeAOrgId,
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 1,
      lineEnd: 3,
      contentHash: 'a'.repeat(64),
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const res = await appWithoutConsent.inject({
      method: 'POST',
      url: '/api/evidence/anchors/resolve',
      headers: {
        authorization: `Bearer ${student1Token}`,
        'x-org-id': collegeAOrgId,
      },
      payload: { anchor },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('CONSENT_SERVICE_UNAVAILABLE');
  });

  it('16. POST /api/evidence/anchors/resolve rejects client-supplied snapshot claiming authoritative status', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      capturedAt: new Date().toISOString(),
    };

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: collegeAOrgId,
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 1,
      lineEnd: 3,
      contentHash: createHash('sha256').update(rawBytes).digest('hex'),
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    // In unit testing AnchorService with authoritative: true, client snapshots are rejected
    const anchorSvc = (app as any).anchorService;
    const authResult = await anchorSvc.resolveAnchor(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      anchor,
      snapshot,
      { authoritative: true }
    );

    expect(authResult.valid).toBe(false);
    expect(authResult.error).toBe('UNTRUSTED_CLIENT_SNAPSHOT');
    expect(authResult.authoritative).toBe(false);
  });

  it('17. POST /api/evidence/snapshots fails closed in production mode with in-memory store (503)', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const { AnchorService } = await import('../src/services/anchor-service.js');
    const prodService = new AnchorService({
      auditRepo: new InMemoryAuditRepository(auditService),
      consentRepo: new InMemoryConsentRepository(consentService),
      isProduction: true, // Marked production!
    });

    const prodApp = buildApp({
      persistenceMode: 'in-memory',
      authService,
      anchorService: prodService,
    });

    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      capturedAt: new Date().toISOString(),
    };

    const res = await prodApp.inject({
      method: 'POST',
      url: '/api/evidence/snapshots',
      headers: {
        authorization: `Bearer ${officerToken}`,
        'x-org-id': collegeAOrgId,
      },
      payload: { snapshot },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().error).toContain('DURABLE_STORAGE_REQUIRED');
  });

  it('18. POST /api/evidence/snapshots strictly rejects path traversal and null bytes (400)', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const maliciousSnapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: '../../etc/passwd', // Path traversal!
      rawBytes: 'root:x:0:0:...',
      rawFileHash: createHash('sha256').update('root:x:0:0:...').digest('hex'),
      capturedAt: new Date().toISOString(),
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/evidence/snapshots',
      headers: {
        authorization: `Bearer ${officerToken}`,
        'x-org-id': collegeAOrgId,
      },
      payload: { snapshot: maliciousSnapshot },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('INVALID_SNAPSHOT_PATH');
  });

  it('19. POST /api/evidence/parse strictly rejects path traversal and null bytes (400)', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/evidence/parse',
      headers: {
        authorization: `Bearer ${officerToken}`,
        'x-org-id': collegeAOrgId,
      },
      payload: {
        studentId: studentUser1.id,
        filePath: 'src/../../../windows/system32/cmd.exe',
        source: 'binary',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0]).toContain('INVALID_FILE_PATH');
  });

  // --------------------------------------------------------------------------
  // 6. Adversarial Student Ownership & Purpose Consent Tests (Issue 2)
  // --------------------------------------------------------------------------

  it('20. Officer attempts to register a student snapshot without consent (422)', async () => {
    // Student 2 has NOT granted consent
    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser2.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      capturedAt: new Date().toISOString(),
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/evidence/snapshots',
      headers: {
        authorization: `Bearer ${officerToken}`,
        'x-org-id': collegeAOrgId,
      },
      payload: { snapshot },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toContain('CONSENT_REQUIRED_OR_REVOKED');
  });

  it('21. Platform administrator attempts registration without consent (422)', async () => {
    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser2.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      capturedAt: new Date().toISOString(),
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/evidence/snapshots',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'x-org-id': collegeAOrgId,
      },
      payload: { snapshot },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toContain('CONSENT_REQUIRED_OR_REVOKED');
  });

  it('22. Student registration without consent (422)', async () => {
    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser2.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      capturedAt: new Date().toISOString(),
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/evidence/snapshots',
      headers: {
        authorization: `Bearer ${student2Token}`,
        'x-org-id': collegeAOrgId,
      },
      payload: { snapshot },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toContain('CONSENT_REQUIRED_OR_REVOKED');
  });

  it('23. Student registration after consent revocation (422)', async () => {
    // 1. Grant consent
    const grant = await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    // 2. Revoke consent
    await consentService.revokeConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      grant.id,
      'Revocation test'
    );

    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      capturedAt: new Date().toISOString(),
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/evidence/snapshots',
      headers: {
        authorization: `Bearer ${student1Token}`,
        'x-org-id': collegeAOrgId,
      },
      payload: { snapshot },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toContain('CONSENT_REQUIRED_OR_REVOKED');
  });

  it('24. Snapshot registration fails closed when consent repository is missing (503)', async () => {
    const { AnchorService } = await import('../src/services/anchor-service.js');
    const serviceWithoutConsent = new AnchorService({
      auditRepo: new InMemoryAuditRepository(auditService),
      consentRepo: undefined,
    });

    const testApp = buildApp({
      persistenceMode: 'in-memory',
      authService,
      anchorService: serviceWithoutConsent,
    });

    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      capturedAt: new Date().toISOString(),
    };

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/evidence/snapshots',
      headers: {
        authorization: `Bearer ${student1Token}`,
        'x-org-id': collegeAOrgId,
      },
      payload: { snapshot },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().error).toContain('CONSENT_SERVICE_UNAVAILABLE');
  });

  it('25. Officer tries to parse student repository data without consent (422)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/evidence/parse',
      headers: {
        authorization: `Bearer ${officerToken}`,
        'x-org-id': collegeAOrgId,
      },
      payload: {
        studentId: studentUser2.id, // Unconsented Student 2
        filePath: 'src/math.ts',
        source: sampleTypeScriptCode,
      },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toContain('CONSENT_REQUIRED_OR_REVOKED');
  });

  it('26. Mentor tries to parse student repository data without consent (422)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/evidence/parse',
      headers: {
        authorization: `Bearer ${mentorToken}`,
        'x-org-id': collegeAOrgId,
      },
      payload: {
        studentId: studentUser2.id,
        filePath: 'src/math.ts',
        source: sampleTypeScriptCode,
      },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toContain('CONSENT_REQUIRED_OR_REVOKED');
  });

  it('27. Parsing fails closed when student ownership is missing (422 STUDENT_OWNERSHIP_REQUIRED)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/evidence/parse',
      headers: {
        authorization: `Bearer ${officerToken}`,
        'x-org-id': collegeAOrgId,
      },
      payload: {
        // Missing studentId!
        filePath: 'src/math.ts',
        source: sampleTypeScriptCode,
      },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toContain('STUDENT_OWNERSHIP_REQUIRED');
  });

  it('28. Client-supplied ownership forgery on parse is blocked (403 FORBIDDEN_STUDENT_ACCESS)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/evidence/parse',
      headers: {
        authorization: `Bearer ${student1Token}`, // Student 1
        'x-org-id': collegeAOrgId,
      },
      payload: {
        studentId: studentUser2.id, // Trying to parse as Student 2
        filePath: 'src/math.ts',
        source: sampleTypeScriptCode,
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('FORBIDDEN_STUDENT_ACCESS');
  });

  it('29. Valid consented operation through explicitly permitted path succeeds with diagnosticOnly flag', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/evidence/parse',
      headers: {
        authorization: `Bearer ${student1Token}`,
        'x-org-id': collegeAOrgId,
      },
      payload: {
        filePath: 'src/math.ts',
        source: sampleTypeScriptCode,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.diagnosticOnly).toBe(true);
    expect(body.authoritative).toBe(false);
    expect(body.provenance).toBe('diagnostic_parser');
  });

  // --------------------------------------------------------------------------
  // 7. Server-Controlled Ingestion Provenance Tests (Issue 3)
  // --------------------------------------------------------------------------

  it('30. Client snapshot remains permanently non-authoritative even if authoritative requested', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: collegeAOrgId,
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 1,
      lineEnd: 3,
      contentHash: createHash('sha256').update(rawBytes).digest('hex'),
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const clientSnapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      capturedAt: new Date().toISOString(),
    };

    const anchorSvc = (app as any).anchorService;
    const authResult = await anchorSvc.resolveAnchor(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      anchor,
      clientSnapshot,
      { authoritative: true }
    );

    expect(authResult.valid).toBe(false);
    expect(authResult.authoritative).toBe(false);
    expect(authResult.provenance).toBe('unverified_client_input');
    expect(authResult.error).toBe('UNTRUSTED_CLIENT_SNAPSHOT');
  });

  it('31. Previously submitted snapshot remains non-authoritative after trusted ingestion introduced for another repo', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const trustedStore = new InMemoryTrustedIngestionStore();
    // Record for DIFFERENT repository
    trustedStore.saveRecord({
      ingestionId: randomUUID(),
      orgId: collegeAOrgId,
      repositoryId: '22222222-2222-2222-2222-222222222222', // Other repo
      commitSha: sampleCommitSha,
      treeSha: 'a'.repeat(40),
      studentId: studentUser1.id,
      verifiedAt: new Date().toISOString(),
      provenance: 'trusted_ingestion_pipeline',
      manifest: [{ filePath: sampleFilePath, blobSha: 'b'.repeat(40), rawFileHash, byteSize: 100 }],
    });

    const { AnchorService } = await import('../src/services/anchor-service.js');
    const serviceWithStore = new AnchorService({
      auditRepo: new InMemoryAuditRepository(auditService),
      consentRepo: new InMemoryConsentRepository(consentService),
      trustedIngestionStore: trustedStore,
    });

    // Save snapshot in service store
    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      capturedAt: new Date().toISOString(),
    };
    await serviceWithStore.registerSnapshot(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      snapshot
    );

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: collegeAOrgId,
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 1,
      lineEnd: 3,
      contentHash: createHash('sha256').update(sampleTypeScriptCode.split('\n').slice(0, 3).join('\n')).digest('hex'),
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const res = await serviceWithStore.resolveAnchor(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      anchor
    );

    // Valid because content matches, but NOT authoritative because sampleRepoId is not the trusted repo!
    expect(res.valid).toBe(true);
    expect(res.authoritative).toBe(false);
    expect(res.provenance).toBe('unverified_client_input');
  });

  it('32. Unregistered repository snapshot remains non-authoritative when authoritative requested', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const { AnchorService } = await import('../src/services/anchor-service.js');
    const serviceWithoutTrusted = new AnchorService({
      auditRepo: new InMemoryAuditRepository(auditService),
      consentRepo: new InMemoryConsentRepository(consentService),
      // No trusted ingestion record store!
    });

    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      capturedAt: new Date().toISOString(),
    };
    await serviceWithoutTrusted.registerSnapshot(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      snapshot
    );

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: collegeAOrgId,
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 1,
      lineEnd: 3,
      contentHash: createHash('sha256').update(sampleTypeScriptCode.split('\n').slice(0, 3).join('\n')).digest('hex'),
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const res = await serviceWithoutTrusted.resolveAnchor(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      anchor,
      undefined,
      { authoritative: true }
    );

    expect(res.valid).toBe(false);
    expect(res.authoritative).toBe(false);
    expect(res.error).toBe('UNTRUSTED_CLIENT_SNAPSHOT');
  });

  it('33. Trusted snapshot with matching server-side ingestion record receives authoritative=true', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const trustedStore = new InMemoryTrustedIngestionStore();
    const ingestionRecord: TrustedIngestionRecord = {
      ingestionId: randomUUID(),
      orgId: collegeAOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      treeSha: 'a'.repeat(40),
      studentId: studentUser1.id,
      verifiedAt: new Date().toISOString(),
      provenance: 'trusted_ingestion_pipeline',
      manifest: [{ filePath: sampleFilePath, blobSha: 'b'.repeat(40), rawFileHash, byteSize: 100 }],
    };
    trustedStore.saveRecord(ingestionRecord);

    const { AnchorService } = await import('../src/services/anchor-service.js');
    const serviceWithTrusted = new AnchorService({
      auditRepo: new InMemoryAuditRepository(auditService),
      consentRepo: new InMemoryConsentRepository(consentService),
      trustedIngestionStore: trustedStore,
    });

    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      blobSha: 'b'.repeat(40),
      capturedAt: new Date().toISOString(),
    };
    await serviceWithTrusted.registerTrustedSnapshot(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      ingestionRecord,
      snapshot
    );

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: collegeAOrgId,
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 1,
      lineEnd: 3,
      contentHash: createHash('sha256').update(sampleTypeScriptCode.split('\n').slice(0, 3).join('\n')).digest('hex'),
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const res = await serviceWithTrusted.resolveAnchor(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      anchor,
      undefined,
      { authoritative: true }
    );

    expect(res.valid).toBe(true);
    expect(res.authoritative).toBe(true);
    expect(res.provenance).toBe('trusted_ingestion_pipeline');
  });

  it('34. Another tenant cannot reuse a trusted ingestion record (tenant isolation)', async () => {
    const trustedStore = new InMemoryTrustedIngestionStore();
    // Record strictly stored for College A
    trustedStore.saveRecord({
      ingestionId: randomUUID(),
      orgId: collegeAOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      treeSha: 'a'.repeat(40),
      studentId: studentUser1.id,
      verifiedAt: new Date().toISOString(),
      provenance: 'trusted_ingestion_pipeline',
      manifest: [{ filePath: sampleFilePath, blobSha: 'b'.repeat(40), rawFileHash, byteSize: 100 }],
    });

    // College B lookup must return undefined!
    const collegeBRecord = trustedStore.getRecord(
      collegeBOrgId,
      sampleRepoId,
      sampleCommitSha,
      studentUser1.id
    );
    expect(collegeBRecord).toBeUndefined();
  });

  it('35. Client cannot set provenance to trusted by modifying request fields', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    // Client passes spoofed snapshot with provenance: 'trusted_ingestion_pipeline'
    const spoofedSnapshot: any = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      capturedAt: new Date().toISOString(),
      provenance: 'trusted_ingestion_pipeline',
      authoritative: true,
    };

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: collegeAOrgId,
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 1,
      lineEnd: 3,
      contentHash: createHash('sha256').update(sampleTypeScriptCode.split('\n').slice(0, 3).join('\n')).digest('hex'),
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const anchorSvc = (app as any).anchorService;
    const res = await anchorSvc.resolveAnchor(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      anchor,
      spoofedSnapshot
    );

    // Server completely ignores client spoofing!
    expect(res.authoritative).toBe(false);
    expect(res.provenance).toBe('unverified_client_input');
  });

  // --------------------------------------------------------------------------
  // 8. Failure-Safe Snapshot Registration & Compensating Rollback (Issue 4)
  // --------------------------------------------------------------------------

  it('36. Snapshot storage succeeds but audit logging fails -> throws SNAPSHOT_REGISTRATION_FAILED', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const failingAuditRepo: any = {
      log: () => {
        throw new Error('SIMULATED_AUDIT_LOG_IO_FAILURE');
      },
      verifyIntegrity: () => ({ valid: true }),
    };

    const { AnchorService } = await import('../src/services/anchor-service.js');
    const failingService = new AnchorService({
      auditRepo: failingAuditRepo,
      consentRepo: new InMemoryConsentRepository(consentService),
    });

    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/rollback-test.ts',
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      capturedAt: new Date().toISOString(),
    };

    await expect(
      failingService.registerSnapshot(
        { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
        snapshot
      )
    ).rejects.toThrow(/SNAPSHOT_REGISTRATION_FAILED/);
  });

  it('37. Failed registration does not leave untracked snapshot in store (rollback verified)', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const failingAuditRepo: any = {
      log: () => {
        throw new Error('SIMULATED_AUDIT_LOG_IO_FAILURE');
      },
      verifyIntegrity: () => ({ valid: true }),
    };

    const { AnchorService } = await import('../src/services/anchor-service.js');
    const failingService = new AnchorService({
      auditRepo: failingAuditRepo,
      consentRepo: new InMemoryConsentRepository(consentService),
    });

    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/rollback-verify.ts',
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      capturedAt: new Date().toISOString(),
    };

    // Before registration
    const store = failingService.getSnapshotStore();
    expect(await store.hasSnapshot(sampleRepoId, sampleCommitSha, 'src/rollback-verify.ts', collegeAOrgId, studentUser1.id)).toBe(false);

    // Attempt registration which fails on audit
    await expect(
      failingService.registerSnapshot(
        { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
        snapshot
      )
    ).rejects.toThrow();

    // After failure: Compensating rollback ensured store remains clean!
    expect(await store.hasSnapshot(sampleRepoId, sampleCommitSha, 'src/rollback-verify.ts', collegeAOrgId, studentUser1.id)).toBe(false);
    expect(await store.getSnapshot(sampleRepoId, sampleCommitSha, 'src/rollback-verify.ts', collegeAOrgId, studentUser1.id)).toBeUndefined();
  });

  it('38. Pre-existing identical snapshot is NOT deleted during rollback of subsequent failed attempt', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    let failAudit = false;
    const conditionalAuditRepo: any = {
      log: () => {
        if (failAudit) {
          throw new Error('SIMULATED_LATER_AUDIT_FAILURE');
        }
        return Promise.resolve();
      },
      verifyIntegrity: () => ({ valid: true }),
    };

    const { AnchorService } = await import('../src/services/anchor-service.js');
    const service = new AnchorService({
      auditRepo: conditionalAuditRepo,
      consentRepo: new InMemoryConsentRepository(consentService),
    });

    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/preexisting.ts',
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      capturedAt: new Date().toISOString(),
    };

    // 1. Initial registration succeeds
    await service.registerSnapshot(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      snapshot
    );
    const store = service.getSnapshotStore();
    expect(await store.hasSnapshot(sampleRepoId, sampleCommitSha, 'src/preexisting.ts', collegeAOrgId, studentUser1.id)).toBe(true);

    // 2. Subsequent idempotent call encounters audit failure
    failAudit = true;
    await expect(
      service.registerSnapshot(
        { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
        snapshot
      )
    ).rejects.toThrow(/SNAPSHOT_REGISTRATION_FAILED/);

    // 3. Pre-existing snapshot must STILL exist (was not deleted)!
    expect(await store.hasSnapshot(sampleRepoId, sampleCommitSha, 'src/preexisting.ts', collegeAOrgId, studentUser1.id)).toBe(true);
    expect(await store.getSnapshot(sampleRepoId, sampleCommitSha, 'src/preexisting.ts', collegeAOrgId, studentUser1.id)).toBeDefined();
  });

  it('39. Concurrent duplicate registrations execute idempotently without corruption', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/concurrent.ts',
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      capturedAt: new Date().toISOString(),
    };

    // Run 5 simultaneous registrations
    const promises = Array.from({ length: 5 }).map(() =>
      app.inject({
        method: 'POST',
        url: '/api/evidence/snapshots',
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
        payload: { snapshot },
      })
    );

    const responses = await Promise.all(promises);
    for (const res of responses) {
      expect(res.statusCode).toBe(201);
      expect(res.json().success).toBe(true);
    }
  });

  it('40. Successful registration produces exactly the expected audit record', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/audit-expect.ts',
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      capturedAt: new Date().toISOString(),
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/evidence/snapshots',
      headers: {
        authorization: `Bearer ${student1Token}`,
        'x-org-id': collegeAOrgId,
      },
      payload: { snapshot },
    });
    expect(res.statusCode).toBe(201);

    const auditRes = await app.inject({
      method: 'GET',
      url: '/api/audit',
      headers: {
        authorization: `Bearer ${officerToken}`,
        'x-org-id': collegeAOrgId,
      },
    });
    const events = auditRes.json();
    const event = events.find((e: any) => e.objectId === snapshot.snapshotId);
    expect(event).toBeDefined();
    expect(event.action).toBe('SNAPSHOT_REGISTERED');
    expect(event.metadata.studentId).toBe(studentUser1.id);
    expect(event.metadata.commitSha).toBe(sampleCommitSha);
    expect(event.metadata.rawFileHash).toBe(rawFileHash);
  });

  it('41. Failed registration does not report success or return 201', async () => {
    const corruptedSnapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/fail-test.ts',
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash: 'c'.repeat(64), // Invalid hash
      capturedAt: new Date().toISOString(),
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/evidence/snapshots',
      headers: {
        authorization: `Bearer ${student1Token}`,
        'x-org-id': collegeAOrgId,
      },
      payload: { snapshot: corruptedSnapshot },
    });

    expect(res.statusCode).not.toBe(201);
    expect(res.json().success).toBeUndefined();
  });

  // ============================================================================
  // P0-05 Final Sign-Off: Student Isolation, Concurrent Registration & Provenance
  // ============================================================================

  // ----------------------------------------------------------------------------
  // Area 1: Student-Level Snapshot Isolation Tests
  // ----------------------------------------------------------------------------

  it('42. Student A resolves an anchor referencing their own registered snapshot successfully', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/student-a-own.ts',
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      capturedAt: new Date().toISOString(),
    };

    const regRes = await app.inject({
      method: 'POST',
      url: '/api/evidence/snapshots',
      headers: {
        authorization: `Bearer ${student1Token}`,
        'x-org-id': collegeAOrgId,
      },
      payload: { snapshot },
    });
    expect(regRes.statusCode).toBe(201);

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: collegeAOrgId,
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/student-a-own.ts',
      lineStart: 1,
      lineEnd: 3,
      contentHash: createHash('sha256').update(sampleTypeScriptCode.split('\n').slice(0, 3).join('\n')).digest('hex'),
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/evidence/anchors/resolve',
      headers: {
        authorization: `Bearer ${student1Token}`,
        'x-org-id': collegeAOrgId,
      },
      payload: { anchor },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('RESOLVED');
    expect(res.json().valid).toBe(true);
  });

  it('43. Student B cannot resolve an anchor referencing Student A\'s snapshot in same tenant', async () => {
    // Both students grant consent
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser2.id, role: 'student' },
      studentUser2.id,
      'repo_verification',
      1
    );

    // Student A registers their snapshot
    const snapshotA: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/student-a-private.ts',
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      capturedAt: new Date().toISOString(),
    };
    await app.inject({
      method: 'POST',
      url: '/api/evidence/snapshots',
      headers: {
        authorization: `Bearer ${student1Token}`,
        'x-org-id': collegeAOrgId,
      },
      payload: { snapshot: snapshotA },
    });

    // Student B attempts to resolve Student A's anchor directly
    const anchorA: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: collegeAOrgId,
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/student-a-private.ts',
      lineStart: 1,
      lineEnd: 3,
      contentHash: createHash('sha256').update(sampleTypeScriptCode.split('\n').slice(0, 3).join('\n')).digest('hex'),
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const resB = await app.inject({
      method: 'POST',
      url: '/api/evidence/anchors/resolve',
      headers: {
        authorization: `Bearer ${student2Token}`,
        'x-org-id': collegeAOrgId,
      },
      payload: { anchor: anchorA },
    });

    expect(resB.statusCode).toBe(403);
    expect(resB.json().error).toBe('FORBIDDEN_STUDENT_ACCESS');
  });

  it('44. Student B cannot resolve an anchor for a file where only Student A registered a snapshot (returns 404)', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser2.id, role: 'student' },
      studentUser2.id,
      'repo_verification',
      1
    );

    // Student A registers snapshot
    const snapshotA: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/student-a-only.ts',
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      capturedAt: new Date().toISOString(),
    };
    await app.inject({
      method: 'POST',
      url: '/api/evidence/snapshots',
      headers: {
        authorization: `Bearer ${student1Token}`,
        'x-org-id': collegeAOrgId,
      },
      payload: { snapshot: snapshotA },
    });

    // Student B creates an anchor claiming studentUser2 ownership, pointing at Student A's file
    const anchorB: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: collegeAOrgId,
      studentId: studentUser2.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/student-a-only.ts',
      lineStart: 1,
      lineEnd: 3,
      contentHash: createHash('sha256').update(sampleTypeScriptCode.split('\n').slice(0, 3).join('\n')).digest('hex'),
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const resB = await app.inject({
      method: 'POST',
      url: '/api/evidence/anchors/resolve',
      headers: {
        authorization: `Bearer ${student2Token}`,
        'x-org-id': collegeAOrgId,
      },
      payload: { anchor: anchorB },
    });

    // Store is partitioned by studentId, so Student B sees SNAPSHOT_NOT_FOUND
    expect(resB.statusCode).toBe(404);
    expect(resB.json().error).toBe('SNAPSHOT_NOT_FOUND');
  });

  it('45. Student B passing an inline snapshot owned by Student A is rejected with 403', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser2.id, role: 'student' },
      studentUser2.id,
      'repo_verification',
      1
    );

    const snapshotA: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id, // Student A owner
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/inline-mismatch.ts',
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      capturedAt: new Date().toISOString(),
    };

    const anchorB: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: collegeAOrgId,
      studentId: studentUser2.id, // Student B anchor
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/inline-mismatch.ts',
      lineStart: 1,
      lineEnd: 3,
      contentHash: createHash('sha256').update(sampleTypeScriptCode.split('\n').slice(0, 3).join('\n')).digest('hex'),
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/evidence/anchors/resolve',
      headers: {
        authorization: `Bearer ${student2Token}`,
        'x-org-id': collegeAOrgId,
      },
      payload: { anchor: anchorB, snapshot: snapshotA },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('STUDENT_OWNERSHIP_MISMATCH');
  });

  it('46. Staff resolving Student A\'s anchor requires active Student A consent', async () => {
    // Student 1 has NOT granted consent
    const snapshotA: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/staff-check.ts',
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      capturedAt: new Date().toISOString(),
    };

    const anchorA: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: collegeAOrgId,
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/staff-check.ts',
      lineStart: 1,
      lineEnd: 3,
      contentHash: createHash('sha256').update(sampleTypeScriptCode.split('\n').slice(0, 3).join('\n')).digest('hex'),
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    // Placement officer attempts resolve without student consent -> 422
    const resNoConsent = await app.inject({
      method: 'POST',
      url: '/api/evidence/anchors/resolve',
      headers: {
        authorization: `Bearer ${officerToken}`,
        'x-org-id': collegeAOrgId,
      },
      payload: { anchor: anchorA, snapshot: snapshotA },
    });
    expect(resNoConsent.statusCode).toBe(422);
    expect(resNoConsent.json().error).toBe('CONSENT_REQUIRED_OR_REVOKED');

    // Grant consent for Student 1
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    // Placement officer resolve now succeeds
    const resWithConsent = await app.inject({
      method: 'POST',
      url: '/api/evidence/anchors/resolve',
      headers: {
        authorization: `Bearer ${officerToken}`,
        'x-org-id': collegeAOrgId,
      },
      payload: { anchor: anchorA, snapshot: snapshotA },
    });
    expect(resWithConsent.statusCode).toBe(200);
    expect(resWithConsent.json().valid).toBe(true);
  });

  // ----------------------------------------------------------------------------
  // Area 2: Concurrent Registration & Safe Audit Rollback Tests
  // ----------------------------------------------------------------------------

  it('47. Two concurrent identical registrations via Promise.all both succeed without corruption', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/concurrent-pair.ts',
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      capturedAt: new Date().toISOString(),
    };

    // Execute 2 concurrent requests via Promise.all
    const [res1, res2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/evidence/snapshots',
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
        payload: { snapshot },
      }),
      app.inject({
        method: 'POST',
        url: '/api/evidence/snapshots',
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
        payload: { snapshot },
      }),
    ]);

    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(201);
  });

  it('48. Concurrent registrations where one audit succeeds and other fails preserves the successful snapshot', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    let callCount = 0;
    const conditionalAuditRepo: any = {
      log: () => {
        callCount++;
        // Second call fails!
        if (callCount === 2) {
          throw new Error('CONCURRENT_SIMULATED_AUDIT_FAILURE');
        }
        return Promise.resolve();
      },
      verifyIntegrity: () => ({ valid: true }),
    };

    const { AnchorService } = await import('../src/services/anchor-service.js');
    const service = new AnchorService({
      auditRepo: conditionalAuditRepo,
      consentRepo: new InMemoryConsentRepository(consentService),
    });

    const snapshot1: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/concurrent-audit-race.ts',
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      capturedAt: new Date().toISOString(),
    };

    const snapshot2: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/concurrent-audit-race.ts',
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      capturedAt: new Date().toISOString(),
    };

    // Launch both registrations concurrently
    const results = await Promise.allSettled([
      service.registerSnapshot(
        { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
        snapshot1
      ),
      service.registerSnapshot(
        { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
        snapshot2
      ),
    ]);

    // One succeeds, one fails
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // CRUCIAL: The snapshot MUST STILL EXIST in the store for the successful registration!
    const store = service.getSnapshotStore();
    expect(
      await store.hasSnapshot(
        sampleRepoId,
        sampleCommitSha,
        'src/concurrent-audit-race.ts',
        collegeAOrgId,
        studentUser1.id
      )
    ).toBe(true);
  });

  it('49. Rollback failure is surfaced as SNAPSHOT_REGISTRATION_FAILED_WITH_ROLLBACK_ERROR and not swallowed', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    // Failing audit repo
    const failingAuditRepo: any = {
      log: () => {
        throw new Error('PRIMARY_AUDIT_LOG_ERROR');
      },
      verifyIntegrity: () => ({ valid: true }),
    };

    // Store whose deleteSnapshot throws!
    const store = new InMemorySourceSnapshotStore();
    store.deleteSnapshot = () => {
      throw new Error('COMPENSATING_ROLLBACK_IO_ERROR');
    };

    const { AnchorService } = await import('../src/services/anchor-service.js');
    const service = new AnchorService({
      auditRepo: failingAuditRepo,
      consentRepo: new InMemoryConsentRepository(consentService),
      snapshotStore: store,
    });

    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/rollback-err.ts',
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      capturedAt: new Date().toISOString(),
    };

    await expect(
      service.registerSnapshot(
        { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
        snapshot
      )
    ).rejects.toThrow(/SNAPSHOT_REGISTRATION_FAILED_WITH_ROLLBACK_ERROR/);
  });

  it('50. Concurrent registrations with divergent content reject second write with 400', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const content1 = 'export const version = 1;\n';
    const hash1 = createHash('sha256').update(content1).digest('hex');
    const content2 = 'export const version = 2;\n';
    const hash2 = createHash('sha256').update(content2).digest('hex');

    const snap1: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/divergent.ts',
      rawBytes: content1,
      rawFileHash: hash1,
      capturedAt: new Date().toISOString(),
    };

    const snap2: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/divergent.ts',
      rawBytes: content2,
      rawFileHash: hash2,
      capturedAt: new Date().toISOString(),
    };

    const [res1, res2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/evidence/snapshots',
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
        payload: { snapshot: snap1 },
      }),
      app.inject({
        method: 'POST',
        url: '/api/evidence/snapshots',
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
        payload: { snapshot: snap2 },
      }),
    ]);

    const statuses = [res1.statusCode, res2.statusCode].sort();
    // One succeeds (201), the other fails with immutable mutation rejection (400)
    expect(statuses).toEqual([201, 400]);
  });

  // ----------------------------------------------------------------------------
  // Area 3: File-Level Trusted Ingestion Binding Tests
  // ----------------------------------------------------------------------------

  it('51. Snapshot file path exists in trusted tree manifest and blob SHA matches -> authoritative=true', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const trustedStore = new InMemoryTrustedIngestionStore();
    const treeSha = 'c'.repeat(40);
    const blobSha = 'b'.repeat(40);

    const record: TrustedIngestionRecord = {
      ingestionId: randomUUID(),
      orgId: collegeAOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      treeSha,
      studentId: studentUser1.id,
      verifiedAt: new Date().toISOString(),
      provenance: 'trusted_ingestion_pipeline',
      manifest: [
        {
          filePath: sampleFilePath,
          blobSha,
          rawFileHash,
          byteSize: 100,
        },
      ],
    };
    trustedStore.saveRecord(record);

    const { AnchorService } = await import('../src/services/anchor-service.js');
    const service = new AnchorService({
      auditRepo: new InMemoryAuditRepository(auditService),
      consentRepo: new InMemoryConsentRepository(consentService),
      trustedIngestionStore: trustedStore,
    });

    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      blobSha,
      capturedAt: new Date().toISOString(),
    };

    await service.registerTrustedSnapshot(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      record,
      snapshot
    );

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: collegeAOrgId,
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      blobSha,
      lineStart: 1,
      lineEnd: 3,
      contentHash: createHash('sha256').update(sampleTypeScriptCode.split('\n').slice(0, 3).join('\n')).digest('hex'),
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const res = await service.resolveAnchor(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      anchor,
      undefined,
      { authoritative: true }
    );

    expect(res.valid).toBe(true);
    expect(res.authoritative).toBe(true);
    expect(res.provenance).toBe('trusted_ingestion_pipeline');
  });

  it('52. Snapshot path absent from trusted tree manifest fails closed when authoritative=true demanded', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const trustedStore = new InMemoryTrustedIngestionStore();
    const record: TrustedIngestionRecord = {
      ingestionId: randomUUID(),
      orgId: collegeAOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      treeSha: 'c'.repeat(40),
      studentId: studentUser1.id,
      verifiedAt: new Date().toISOString(),
      provenance: 'trusted_ingestion_pipeline',
      manifest: [
        {
          filePath: 'src/other-file.ts', // Different path in manifest
          blobSha: 'b'.repeat(40),
          rawFileHash,
          byteSize: 100,
        },
      ],
    };
    trustedStore.saveRecord(record);

    const { AnchorService } = await import('../src/services/anchor-service.js');
    const service = new AnchorService({
      auditRepo: new InMemoryAuditRepository(auditService),
      consentRepo: new InMemoryConsentRepository(consentService),
      trustedIngestionStore: trustedStore,
    });

    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      orgId: collegeAOrgId,
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      blobSha: 'b'.repeat(40),
      provenance: 'trusted_ingestion_pipeline',
      ingestionId: record.ingestionId,
      capturedAt: new Date().toISOString(),
    };
    await service.getSnapshotStore().saveSnapshot(snapshot);

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: collegeAOrgId,
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 1,
      lineEnd: 3,
      contentHash: createHash('sha256').update(sampleTypeScriptCode.split('\n').slice(0, 3).join('\n')).digest('hex'),
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const res = await service.resolveAnchor(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      anchor,
      undefined,
      { authoritative: true }
    );

    expect(res.valid).toBe(false);
    expect(res.authoritative).toBe(false);
    expect(res.error).toBe('PATH_NOT_IN_TRUSTED_MANIFEST');
  });

  it('53. Snapshot blob SHA mismatch against manifest fails closed when authoritative=true demanded', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const trustedStore = new InMemoryTrustedIngestionStore();
    const record: TrustedIngestionRecord = {
      ingestionId: randomUUID(),
      orgId: collegeAOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      treeSha: 'c'.repeat(40),
      studentId: studentUser1.id,
      verifiedAt: new Date().toISOString(),
      provenance: 'trusted_ingestion_pipeline',
      manifest: [
        {
          filePath: sampleFilePath,
          blobSha: 'b'.repeat(40),
          rawFileHash,
          byteSize: 100,
        },
      ],
    };
    trustedStore.saveRecord(record);

    const { AnchorService } = await import('../src/services/anchor-service.js');
    const service = new AnchorService({
      auditRepo: new InMemoryAuditRepository(auditService),
      consentRepo: new InMemoryConsentRepository(consentService),
      trustedIngestionStore: trustedStore,
    });

    // Snapshot has divergent blobSha
    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      orgId: collegeAOrgId,
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      blobSha: 'd'.repeat(40), // Divergent blob SHA
      provenance: 'trusted_ingestion_pipeline',
      ingestionId: record.ingestionId,
      capturedAt: new Date().toISOString(),
    };
    await service.getSnapshotStore().saveSnapshot(snapshot);

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: collegeAOrgId,
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 1,
      lineEnd: 3,
      contentHash: createHash('sha256').update(sampleTypeScriptCode.split('\n').slice(0, 3).join('\n')).digest('hex'),
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const res = await service.resolveAnchor(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      anchor,
      undefined,
      { authoritative: true }
    );

    expect(res.valid).toBe(false);
    expect(res.authoritative).toBe(false);
    expect(res.error).toBe('BLOB_SHA_MISMATCH');
  });

  it('54. Client submitting a different file under otherwise trusted repo/commit remains unverified client input', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const trustedStore = new InMemoryTrustedIngestionStore();
    const record: TrustedIngestionRecord = {
      ingestionId: randomUUID(),
      orgId: collegeAOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      treeSha: 'c'.repeat(40),
      studentId: studentUser1.id,
      verifiedAt: new Date().toISOString(),
      provenance: 'trusted_ingestion_pipeline',
      manifest: [
        {
          filePath: 'src/genuine.ts',
          blobSha: 'b'.repeat(40),
          rawFileHash,
          byteSize: 100,
        },
      ],
    };
    trustedStore.saveRecord(record);

    const { AnchorService } = await import('../src/services/anchor-service.js');
    const service = new AnchorService({
      auditRepo: new InMemoryAuditRepository(auditService),
      consentRepo: new InMemoryConsentRepository(consentService),
      trustedIngestionStore: trustedStore,
    });

    // Client registers arbitrary file via public API
    const arbitrarySnapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/arbitrary.ts',
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      capturedAt: new Date().toISOString(),
    };
    await service.registerSnapshot(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      arbitrarySnapshot
    );

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: collegeAOrgId,
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/arbitrary.ts',
      lineStart: 1,
      lineEnd: 3,
      contentHash: createHash('sha256').update(sampleTypeScriptCode.split('\n').slice(0, 3).join('\n')).digest('hex'),
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const res = await service.resolveAnchor(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      anchor
    );

    // Resolved content-wise, but NOT authoritative!
    expect(res.valid).toBe(true);
    expect(res.authoritative).toBe(false);
    expect(res.provenance).toBe('unverified_client_input');
  });

  it('55. Client attempts to reuse another student\'s ingestion record is rejected', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser2.id, role: 'student' },
      studentUser2.id,
      'repo_verification',
      1
    );

    // Record belongs strictly to Student 1
    const trustedStore = new InMemoryTrustedIngestionStore();
    const record: TrustedIngestionRecord = {
      ingestionId: randomUUID(),
      orgId: collegeAOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      treeSha: 'c'.repeat(40),
      studentId: studentUser1.id,
      verifiedAt: new Date().toISOString(),
      provenance: 'trusted_ingestion_pipeline',
      manifest: [
        {
          filePath: sampleFilePath,
          blobSha: 'b'.repeat(40),
          rawFileHash,
          byteSize: 100,
        },
      ],
    };
    trustedStore.saveRecord(record);

    const { AnchorService } = await import('../src/services/anchor-service.js');
    const service = new AnchorService({
      auditRepo: new InMemoryAuditRepository(auditService),
      consentRepo: new InMemoryConsentRepository(consentService),
      trustedIngestionStore: trustedStore,
    });

    // Student 2 attempts to register snapshot claiming trusted_ingestion_pipeline
    const snapshotB: SourceSnapshot = {
      snapshotId: randomUUID(),
      orgId: collegeAOrgId,
      studentId: studentUser2.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      blobSha: 'b'.repeat(40),
      provenance: 'trusted_ingestion_pipeline',
      ingestionId: record.ingestionId,
      capturedAt: new Date().toISOString(),
    };
    await service.getSnapshotStore().saveSnapshot(snapshotB);

    const anchorB: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: collegeAOrgId,
      studentId: studentUser2.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 1,
      lineEnd: 3,
      contentHash: createHash('sha256').update(sampleTypeScriptCode.split('\n').slice(0, 3).join('\n')).digest('hex'),
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    // When authoritative is demanded, fails because no trusted record exists for Student 2!
    const res = await service.resolveAnchor(
      { orgId: collegeAOrgId, userId: studentUser2.id, role: 'student' },
      anchorB,
      undefined,
      { authoritative: true }
    );

    expect(res.valid).toBe(false);
    expect(res.authoritative).toBe(false);
    expect(res.error).toBe('INGESTION_RECORD_MISMATCH');
  });

  it('56. Previously untrusted snapshot remains untrusted even after ingestion record is created', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const trustedStore = new InMemoryTrustedIngestionStore();
    const { AnchorService } = await import('../src/services/anchor-service.js');
    const service = new AnchorService({
      auditRepo: new InMemoryAuditRepository(auditService),
      consentRepo: new InMemoryConsentRepository(consentService),
      trustedIngestionStore: trustedStore,
    });

    // 1. Snapshot registered via client route
    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      capturedAt: new Date().toISOString(),
    };
    await service.registerSnapshot(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      snapshot
    );

    // 2. Later, an ingestion record is added for this repo/commit
    const record: TrustedIngestionRecord = {
      ingestionId: randomUUID(),
      orgId: collegeAOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      treeSha: 'c'.repeat(40),
      studentId: studentUser1.id,
      verifiedAt: new Date().toISOString(),
      provenance: 'trusted_ingestion_pipeline',
      manifest: [
        {
          filePath: sampleFilePath,
          blobSha: 'b'.repeat(40),
          rawFileHash,
          byteSize: 100,
        },
      ],
    };
    trustedStore.saveRecord(record);

    // 3. Resolving the previously registered snapshot must STILL remain non-authoritative
    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: collegeAOrgId,
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 1,
      lineEnd: 3,
      contentHash: createHash('sha256').update(sampleTypeScriptCode.split('\n').slice(0, 3).join('\n')).digest('hex'),
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const res = await service.resolveAnchor(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      anchor
    );
    expect(res.valid).toBe(true);
    expect(res.authoritative).toBe(false);
    expect(res.provenance).toBe('unverified_client_input');
  });

  it('57. Completed unique registration locks are cleaned up instead of accumulating indefinitely (Memory Leak Prevention)', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const { AnchorService } = await import('../src/services/anchor-service.js');
    const service = new AnchorService({
      auditRepo: new InMemoryAuditRepository(auditService),
      consentRepo: new InMemoryConsentRepository(consentService),
    });

    expect(service.getRegistrationQueuesSize()).toBe(0);

    // Register 5 distinct snapshots sequentially
    for (let i = 0; i < 5; i++) {
      const snap: SourceSnapshot = {
        snapshotId: randomUUID(),
        studentId: studentUser1.id,
        repositoryId: sampleRepoId,
        commitSha: sampleCommitSha,
        filePath: `src/file_${i}.ts`,
        rawBytes: rawBytes.toString('utf8'),
        rawFileHash,
        capturedAt: new Date().toISOString(),
      };
      await service.registerSnapshot(
        { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
        snap
      );
    }

    // After completion, the map must be completely drained
    expect(service.getRegistrationQueuesSize()).toBe(0);
  });

  it('58. Concurrent registrations for the same identity serialize and clean up queue map when finished', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const { AnchorService } = await import('../src/services/anchor-service.js');
    const service = new AnchorService({
      auditRepo: new InMemoryAuditRepository(auditService),
      consentRepo: new InMemoryConsentRepository(consentService),
    });

    const snap1: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/concurrent.ts',
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      capturedAt: new Date().toISOString(),
    };

    const snap2: SourceSnapshot = {
      ...snap1,
      snapshotId: randomUUID(),
    };

    // Fire 3 simultaneous registrations for the exact same identity
    const p1 = service.registerSnapshot(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      snap1
    );
    const p2 = service.registerSnapshot(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      snap2
    );
    const p3 = service.registerSnapshot(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      snap1
    );

    const results = await Promise.all([p1, p2, p3]);
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.success).toBe(true);
    }

    // After all 3 completed, registrationQueues map must be completely cleaned up
    expect(service.getRegistrationQueuesSize()).toBe(0);
  });

  it('59. registerTrustedSnapshot rejects snapshot missing blobSha (TRUSTED_SNAPSHOT_BLOB_SHA_REQUIRED)', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const trustedStore = new InMemoryTrustedIngestionStore();
    const { AnchorService } = await import('../src/services/anchor-service.js');
    const service = new AnchorService({
      auditRepo: new InMemoryAuditRepository(auditService),
      consentRepo: new InMemoryConsentRepository(consentService),
      trustedIngestionStore: trustedStore,
    });

    const record: TrustedIngestionRecord = {
      ingestionId: randomUUID(),
      orgId: collegeAOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      treeSha: 'c'.repeat(40),
      studentId: studentUser1.id,
      verifiedAt: new Date().toISOString(),
      provenance: 'trusted_ingestion_pipeline',
      manifest: [
        {
          filePath: sampleFilePath,
          blobSha: 'b'.repeat(40),
          rawFileHash,
          byteSize: 100,
        },
      ],
    };
    trustedStore.saveRecord(record);

    const snapshotNoBlob: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      capturedAt: new Date().toISOString(),
      // blobSha omitted!
    };

    await expect(
      service.registerTrustedSnapshot(
        { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
        record,
        snapshotNoBlob
      )
    ).rejects.toThrow(/TRUSTED_SNAPSHOT_BLOB_SHA_REQUIRED/);
  });

  it('60. registerTrustedSnapshot rejects snapshot with malformed blobSha', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const trustedStore = new InMemoryTrustedIngestionStore();
    const { AnchorService } = await import('../src/services/anchor-service.js');
    const service = new AnchorService({
      auditRepo: new InMemoryAuditRepository(auditService),
      consentRepo: new InMemoryConsentRepository(consentService),
      trustedIngestionStore: trustedStore,
    });

    const record: TrustedIngestionRecord = {
      ingestionId: randomUUID(),
      orgId: collegeAOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      treeSha: 'c'.repeat(40),
      studentId: studentUser1.id,
      verifiedAt: new Date().toISOString(),
      provenance: 'trusted_ingestion_pipeline',
      manifest: [
        {
          filePath: sampleFilePath,
          blobSha: 'b'.repeat(40),
          rawFileHash,
          byteSize: 100,
        },
      ],
    };
    trustedStore.saveRecord(record);

    const snapshotBadBlob: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      blobSha: 'bad-blob-sha',
      capturedAt: new Date().toISOString(),
    };

    await expect(
      service.registerTrustedSnapshot(
        { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
        record,
        snapshotBadBlob
      )
    ).rejects.toThrow(/TRUSTED_SNAPSHOT_BLOB_SHA_REQUIRED/);
  });

  it('61. registerTrustedSnapshot rejects snapshot where repositoryId or commitSha mismatches ingestion record', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const trustedStore = new InMemoryTrustedIngestionStore();
    const { AnchorService } = await import('../src/services/anchor-service.js');
    const service = new AnchorService({
      auditRepo: new InMemoryAuditRepository(auditService),
      consentRepo: new InMemoryConsentRepository(consentService),
      trustedIngestionStore: trustedStore,
    });

    const record: TrustedIngestionRecord = {
      ingestionId: randomUUID(),
      orgId: collegeAOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      treeSha: 'c'.repeat(40),
      studentId: studentUser1.id,
      verifiedAt: new Date().toISOString(),
      provenance: 'trusted_ingestion_pipeline',
      manifest: [
        {
          filePath: sampleFilePath,
          blobSha: 'b'.repeat(40),
          rawFileHash,
          byteSize: 100,
        },
      ],
    };
    trustedStore.saveRecord(record);

    // Mismatched repositoryId
    const snapshotBadRepo: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: randomUUID(), // Mismatch!
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      blobSha: 'b'.repeat(40),
      capturedAt: new Date().toISOString(),
    };

    await expect(
      service.registerTrustedSnapshot(
        { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
        record,
        snapshotBadRepo
      )
    ).rejects.toThrow(/SNAPSHOT_RECORD_MISMATCH/);

    // Mismatched commitSha
    const snapshotBadCommit: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: '9'.repeat(40), // Mismatch!
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      blobSha: 'b'.repeat(40),
      capturedAt: new Date().toISOString(),
    };

    await expect(
      service.registerTrustedSnapshot(
        { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
        record,
        snapshotBadCommit
      )
    ).rejects.toThrow(/SNAPSHOT_RECORD_MISMATCH/);
  });

  it('62. registerTrustedSnapshot rejects when supplied record differs from persisted record (INGESTION_RECORD_MISMATCH)', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const trustedStore = new InMemoryTrustedIngestionStore();
    const { AnchorService } = await import('../src/services/anchor-service.js');
    const service = new AnchorService({
      auditRepo: new InMemoryAuditRepository(auditService),
      consentRepo: new InMemoryConsentRepository(consentService),
      trustedIngestionStore: trustedStore,
    });

    const recordA: TrustedIngestionRecord = {
      ingestionId: randomUUID(),
      orgId: collegeAOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      treeSha: 'c'.repeat(40),
      studentId: studentUser1.id,
      verifiedAt: new Date().toISOString(),
      provenance: 'trusted_ingestion_pipeline',
      manifest: [
        {
          filePath: sampleFilePath,
          blobSha: 'b'.repeat(40),
          rawFileHash,
          byteSize: 100,
        },
      ],
    };
    trustedStore.saveRecord(recordA);

    // Attempt to register snapshot using different ingestionId for same repo/commit/student
    const recordDivergent: TrustedIngestionRecord = {
      ...recordA,
      ingestionId: randomUUID(), // Different ID
    };

    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      blobSha: 'b'.repeat(40),
      capturedAt: new Date().toISOString(),
    };

    await expect(
      service.registerTrustedSnapshot(
        { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
        recordDivergent,
        snapshot
      )
    ).rejects.toThrow(/INGESTION_RECORD_MISMATCH/);
  });

  it('63. Authoritative resolution fails closed when trusted snapshot lacks blobSha', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const trustedStore = new InMemoryTrustedIngestionStore();
    const { AnchorService } = await import('../src/services/anchor-service.js');
    const service = new AnchorService({
      auditRepo: new InMemoryAuditRepository(auditService),
      consentRepo: new InMemoryConsentRepository(consentService),
      trustedIngestionStore: trustedStore,
    });

    const record: TrustedIngestionRecord = {
      ingestionId: randomUUID(),
      orgId: collegeAOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      treeSha: 'c'.repeat(40),
      studentId: studentUser1.id,
      verifiedAt: new Date().toISOString(),
      provenance: 'trusted_ingestion_pipeline',
      manifest: [
        {
          filePath: sampleFilePath,
          blobSha: 'b'.repeat(40),
          rawFileHash,
          byteSize: 100,
        },
      ],
    };
    trustedStore.saveRecord(record);

    // Save snapshot directly without blobSha claiming trusted_ingestion_pipeline
    const snapshotNoBlob: SourceSnapshot = {
      snapshotId: randomUUID(),
      orgId: collegeAOrgId,
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      provenance: 'trusted_ingestion_pipeline',
      ingestionId: record.ingestionId,
      capturedAt: new Date().toISOString(),
    };
    await service.getSnapshotStore().saveSnapshot(snapshotNoBlob);

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: collegeAOrgId,
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 1,
      lineEnd: 3,
      contentHash: createHash('sha256').update(sampleTypeScriptCode.split('\n').slice(0, 3).join('\n')).digest('hex'),
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const res = await service.resolveAnchor(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      anchor,
      undefined,
      { authoritative: true }
    );

    expect(res.valid).toBe(false);
    expect(res.authoritative).toBe(false);
    expect(res.error).toBe('UNTRUSTED_CLIENT_SNAPSHOT');
  });

  it('64. Authoritative resolution succeeds when both blob SHA and raw SHA match verified ingestion manifest', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const trustedStore = new InMemoryTrustedIngestionStore();
    const record: TrustedIngestionRecord = {
      ingestionId: randomUUID(),
      orgId: collegeAOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      treeSha: 'c'.repeat(40),
      studentId: studentUser1.id,
      verifiedAt: new Date().toISOString(),
      provenance: 'trusted_ingestion_pipeline',
      manifest: [
        {
          filePath: sampleFilePath,
          blobSha: 'b'.repeat(40),
          rawFileHash,
          byteSize: 100,
        },
      ],
    };
    trustedStore.saveRecord(record);

    const { AnchorService } = await import('../src/services/anchor-service.js');
    const service = new AnchorService({
      auditRepo: new InMemoryAuditRepository(auditService),
      consentRepo: new InMemoryConsentRepository(consentService),
      trustedIngestionStore: trustedStore,
    });

    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      blobSha: 'b'.repeat(40),
      capturedAt: new Date().toISOString(),
    };
    await service.registerTrustedSnapshot(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      record,
      snapshot
    );

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: collegeAOrgId,
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 1,
      lineEnd: 3,
      contentHash: createHash('sha256').update(sampleTypeScriptCode.split('\n').slice(0, 3).join('\n')).digest('hex'),
      rawFileHash,
      blobSha: 'b'.repeat(40),
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const res = await service.resolveAnchor(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      anchor,
      undefined,
      { authoritative: true }
    );

    expect(res.valid).toBe(true);
    expect(res.authoritative).toBe(true);
    expect(res.provenance).toBe('trusted_ingestion_pipeline');
  });

  it('65. Authoritative resolution fails closed when blob SHA in manifest does not match snapshot blob SHA', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const trustedStore = new InMemoryTrustedIngestionStore();
    const record: TrustedIngestionRecord = {
      ingestionId: randomUUID(),
      orgId: collegeAOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      treeSha: 'c'.repeat(40),
      studentId: studentUser1.id,
      verifiedAt: new Date().toISOString(),
      provenance: 'trusted_ingestion_pipeline',
      manifest: [
        {
          filePath: sampleFilePath,
          blobSha: 'b'.repeat(40), // In manifest: 'bbbb...'
          rawFileHash,
          byteSize: 100,
        },
      ],
    };
    trustedStore.saveRecord(record);

    const { AnchorService } = await import('../src/services/anchor-service.js');
    const service = new AnchorService({
      auditRepo: new InMemoryAuditRepository(auditService),
      consentRepo: new InMemoryConsentRepository(consentService),
      trustedIngestionStore: trustedStore,
    });

    // Stored snapshot has divergent blobSha
    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      orgId: collegeAOrgId,
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      blobSha: 'e'.repeat(40), // Snapshot has 'eeee...'
      provenance: 'trusted_ingestion_pipeline',
      ingestionId: record.ingestionId,
      capturedAt: new Date().toISOString(),
    };
    await service.getSnapshotStore().saveSnapshot(snapshot);

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: collegeAOrgId,
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 1,
      lineEnd: 3,
      contentHash: createHash('sha256').update(sampleTypeScriptCode.split('\n').slice(0, 3).join('\n')).digest('hex'),
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const res = await service.resolveAnchor(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      anchor,
      undefined,
      { authoritative: true }
    );

    expect(res.valid).toBe(false);
    expect(res.authoritative).toBe(false);
    expect(res.error).toBe('BLOB_SHA_MISMATCH');
    expect(res.diagnostics?.reason).toContain('BLOB_SHA_MISMATCH');
  });

  // ============================================================================
  // P0-05 Final Trusted Ingestion Boundary Correction Tests (Tests 66–73)
  // ============================================================================

  it('66. registerTrustedSnapshot rejects a record that has not already been persisted by trusted ingestion process', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const trustedStore = new InMemoryTrustedIngestionStore();
    const { AnchorService } = await import('../src/services/anchor-service.js');
    const service = new AnchorService({
      auditRepo: new InMemoryAuditRepository(auditService),
      consentRepo: new InMemoryConsentRepository(consentService),
      trustedIngestionStore: trustedStore,
    });

    const unpersistedRecord: TrustedIngestionRecord = {
      ingestionId: randomUUID(),
      orgId: collegeAOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      treeSha: 'c'.repeat(40),
      studentId: studentUser1.id,
      verifiedAt: new Date().toISOString(),
      provenance: 'trusted_ingestion_pipeline',
      manifest: [
        {
          filePath: sampleFilePath,
          blobSha: 'b'.repeat(40),
          rawFileHash,
          byteSize: 100,
        },
      ],
    };

    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      blobSha: 'b'.repeat(40),
      capturedAt: new Date().toISOString(),
    };

    // Store does NOT have the record yet!
    await expect(
      service.registerTrustedSnapshot(
        { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
        unpersistedRecord,
        snapshot
      )
    ).rejects.toThrow(/TRUSTED_INGESTION_RECORD_NOT_FOUND/);

    // Verify snapshot was NOT persisted
    const stored = await service.getSnapshotStore().hasSnapshot(
      sampleRepoId,
      sampleCommitSha,
      sampleFilePath,
      collegeAOrgId,
      studentUser1.id
    );
    expect(stored).toBe(false);
  });

  it('67. A mismatch in any persisted record identity or manifest field fails closed', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const trustedStore = new InMemoryTrustedIngestionStore();
    const { AnchorService } = await import('../src/services/anchor-service.js');
    const service = new AnchorService({
      auditRepo: new InMemoryAuditRepository(auditService),
      consentRepo: new InMemoryConsentRepository(consentService),
      trustedIngestionStore: trustedStore,
    });

    const persistedRecord: TrustedIngestionRecord = {
      ingestionId: randomUUID(),
      orgId: collegeAOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      treeSha: 'c'.repeat(40),
      studentId: studentUser1.id,
      verifiedAt: '2026-11-07T12:00:00.000Z',
      provenance: 'trusted_ingestion_pipeline',
      manifest: [
        {
          filePath: sampleFilePath,
          blobSha: 'b'.repeat(40),
          rawFileHash,
          byteSize: 100,
        },
      ],
    };
    trustedStore.saveRecord(persistedRecord);

    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      blobSha: 'b'.repeat(40),
      capturedAt: new Date().toISOString(),
    };

    const context = { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' as const };

    // 1. Ingestion ID mismatch
    await expect(
      service.registerTrustedSnapshot(context, { ...persistedRecord, ingestionId: randomUUID() }, snapshot)
    ).rejects.toThrow(/INGESTION_RECORD_MISMATCH/);

    // 2. Tree SHA mismatch
    await expect(
      service.registerTrustedSnapshot(context, { ...persistedRecord, treeSha: 'd'.repeat(40) }, snapshot)
    ).rejects.toThrow(/INGESTION_RECORD_MISMATCH/);

    // 3. VerifiedAt mismatch
    await expect(
      service.registerTrustedSnapshot(context, { ...persistedRecord, verifiedAt: '2026-11-07T12:05:00.000Z' }, snapshot)
    ).rejects.toThrow(/INGESTION_RECORD_MISMATCH/);

    // 4. Manifest count mismatch
    await expect(
      service.registerTrustedSnapshot(context, { ...persistedRecord, manifest: [] }, snapshot)
    ).rejects.toThrow(/INGESTION_RECORD_MISMATCH/);

    // 5. Manifest entry filePath mismatch
    await expect(
      service.registerTrustedSnapshot(
        context,
        {
          ...persistedRecord,
          manifest: [{ filePath: 'src/other.ts', blobSha: 'b'.repeat(40), rawFileHash, byteSize: 100 }],
        },
        snapshot
      )
    ).rejects.toThrow(/INGESTION_RECORD_MISMATCH/);

    // 6. Manifest entry blobSha mismatch
    await expect(
      service.registerTrustedSnapshot(
        context,
        {
          ...persistedRecord,
          manifest: [{ filePath: sampleFilePath, blobSha: 'f'.repeat(40), rawFileHash, byteSize: 100 }],
        },
        snapshot
      )
    ).rejects.toThrow(/INGESTION_RECORD_MISMATCH/);

    // 7. Manifest entry rawFileHash mismatch
    await expect(
      service.registerTrustedSnapshot(
        context,
        {
          ...persistedRecord,
          manifest: [{ filePath: sampleFilePath, blobSha: 'b'.repeat(40), rawFileHash: '0'.repeat(64), byteSize: 100 }],
        },
        snapshot
      )
    ).rejects.toThrow(/INGESTION_RECORD_MISMATCH/);

    // 8. Manifest entry byteSize mismatch
    await expect(
      service.registerTrustedSnapshot(
        context,
        {
          ...persistedRecord,
          manifest: [{ filePath: sampleFilePath, blobSha: 'b'.repeat(40), rawFileHash, byteSize: 999 }],
        },
        snapshot
      )
    ).rejects.toThrow(/INGESTION_RECORD_MISMATCH/);

    // Confirm no snapshot was stored
    expect(
      await service.getSnapshotStore().hasSnapshot(sampleRepoId, sampleCommitSha, sampleFilePath, collegeAOrgId, studentUser1.id)
    ).toBe(false);
  });

  it('68. No trusted record or snapshot is written when consent is missing', async () => {
    // studentUser2 has never been granted repo_verification consent
    const trustedStore = new InMemoryTrustedIngestionStore();
    const { AnchorService } = await import('../src/services/anchor-service.js');
    const service = new AnchorService({
      auditRepo: new InMemoryAuditRepository(auditService),
      consentRepo: new InMemoryConsentRepository(consentService),
      trustedIngestionStore: trustedStore,
    });

    const record: TrustedIngestionRecord = {
      ingestionId: randomUUID(),
      orgId: collegeAOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      treeSha: 'c'.repeat(40),
      studentId: studentUser2.id,
      verifiedAt: new Date().toISOString(),
      provenance: 'trusted_ingestion_pipeline',
      manifest: [
        {
          filePath: sampleFilePath,
          blobSha: 'b'.repeat(40),
          rawFileHash,
          byteSize: 100,
        },
      ],
    };
    trustedStore.saveRecord(record);

    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser2.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      blobSha: 'b'.repeat(40),
      capturedAt: new Date().toISOString(),
    };

    await expect(
      service.registerTrustedSnapshot(
        { orgId: collegeAOrgId, userId: studentUser2.id, role: 'student' },
        record,
        snapshot
      )
    ).rejects.toThrow(/CONSENT_REQUIRED_OR_REVOKED/);

    expect(
      await service.getSnapshotStore().hasSnapshot(sampleRepoId, sampleCommitSha, sampleFilePath, collegeAOrgId, studentUser2.id)
    ).toBe(false);
  });

  it('69. Revoked consent prevents trusted ingestion', async () => {
    // Revoke studentUser1 consent
    await consentService.revokeConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification'
    );

    const trustedStore = new InMemoryTrustedIngestionStore();
    const { AnchorService } = await import('../src/services/anchor-service.js');
    const service = new AnchorService({
      auditRepo: new InMemoryAuditRepository(auditService),
      consentRepo: new InMemoryConsentRepository(consentService),
      trustedIngestionStore: trustedStore,
    });

    const record: TrustedIngestionRecord = {
      ingestionId: randomUUID(),
      orgId: collegeAOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      treeSha: 'c'.repeat(40),
      studentId: studentUser1.id,
      verifiedAt: new Date().toISOString(),
      provenance: 'trusted_ingestion_pipeline',
      manifest: [
        {
          filePath: sampleFilePath,
          blobSha: 'b'.repeat(40),
          rawFileHash,
          byteSize: 100,
        },
      ],
    };
    trustedStore.saveRecord(record);

    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      blobSha: 'b'.repeat(40),
      capturedAt: new Date().toISOString(),
    };

    await expect(
      service.registerTrustedSnapshot(
        { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
        record,
        snapshot
      )
    ).rejects.toThrow(/CONSENT_REQUIRED_OR_REVOKED/);

    expect(
      await service.getSnapshotStore().hasSnapshot(sampleRepoId, sampleCommitSha, sampleFilePath, collegeAOrgId, studentUser1.id)
    ).toBe(false);

    // Restore consent for following tests
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );
  });

  it('70. Consent infrastructure failure prevents trusted ingestion', async () => {
    const trustedStore = new InMemoryTrustedIngestionStore();
    const { AnchorService } = await import('../src/services/anchor-service.js');

    const record: TrustedIngestionRecord = {
      ingestionId: randomUUID(),
      orgId: collegeAOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      treeSha: 'c'.repeat(40),
      studentId: studentUser1.id,
      verifiedAt: new Date().toISOString(),
      provenance: 'trusted_ingestion_pipeline',
      manifest: [
        {
          filePath: sampleFilePath,
          blobSha: 'b'.repeat(40),
          rawFileHash,
          byteSize: 100,
        },
      ],
    };
    trustedStore.saveRecord(record);

    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      blobSha: 'b'.repeat(40),
      capturedAt: new Date().toISOString(),
    };

    // 1. Missing consent repository (unavailable)
    const serviceNoConsent = new AnchorService({
      auditRepo: new InMemoryAuditRepository(auditService),
      trustedIngestionStore: trustedStore,
      // consentRepo omitted
    });

    await expect(
      serviceNoConsent.registerTrustedSnapshot(
        { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
        record,
        snapshot
      )
    ).rejects.toThrow(/CONSENT_SERVICE_UNAVAILABLE/);

    // 2. Failing consent repository (infrastructure crash)
    const failingConsentRepo: any = {
      hasActiveConsent: vi.fn().mockRejectedValue(new Error('DATABASE_CONNECTION_TERMINATED')),
      grantConsent: vi.fn(),
      revokeConsent: vi.fn(),
      getConsentHistory: vi.fn(),
    };

    const serviceFailingConsent = new AnchorService({
      auditRepo: new InMemoryAuditRepository(auditService),
      consentRepo: failingConsentRepo,
      trustedIngestionStore: trustedStore,
    });

    await expect(
      serviceFailingConsent.registerTrustedSnapshot(
        { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
        record,
        snapshot
      )
    ).rejects.toThrow(/CONSENT_SERVICE_ERROR.*DATABASE_CONNECTION_TERMINATED/);

    expect(
      await serviceNoConsent.getSnapshotStore().hasSnapshot(sampleRepoId, sampleCommitSha, sampleFilePath, collegeAOrgId, studentUser1.id)
    ).toBe(false);
  });

  it('71. Audit failure cannot leave a newly registered trusted snapshot available as authoritative', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const trustedStore = new InMemoryTrustedIngestionStore();
    const record: TrustedIngestionRecord = {
      ingestionId: randomUUID(),
      orgId: collegeAOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      treeSha: 'c'.repeat(40),
      studentId: studentUser1.id,
      verifiedAt: new Date().toISOString(),
      provenance: 'trusted_ingestion_pipeline',
      manifest: [
        {
          filePath: sampleFilePath,
          blobSha: 'b'.repeat(40),
          rawFileHash,
          byteSize: 100,
        },
      ],
    };
    trustedStore.saveRecord(record);

    // Failing audit repository
    const failingAuditRepo: any = {
      log: vi.fn().mockRejectedValue(new Error('AUDIT_IMMUTABILITY_FAIL')),
      query: vi.fn(),
      verifyIntegrity: vi.fn(),
    };

    const { AnchorService } = await import('../src/services/anchor-service.js');
    const service = new AnchorService({
      auditRepo: failingAuditRepo,
      consentRepo: new InMemoryConsentRepository(consentService),
      trustedIngestionStore: trustedStore,
    });

    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      blobSha: 'b'.repeat(40),
      capturedAt: new Date().toISOString(),
    };

    // Attempt registration: must fail with compensating rollback
    await expect(
      service.registerTrustedSnapshot(
        { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
        record,
        snapshot
      )
    ).rejects.toThrow(/TRUSTED_SNAPSHOT_REGISTRATION_FAILED/);

    // Verify snapshot was rolled back from store
    expect(
      await service.getSnapshotStore().hasSnapshot(sampleRepoId, sampleCommitSha, sampleFilePath, collegeAOrgId, studentUser1.id)
    ).toBe(false);

    // Verify authoritative resolution fails closed
    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: collegeAOrgId,
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 1,
      lineEnd: 3,
      contentHash: createHash('sha256').update(sampleTypeScriptCode.split('\n').slice(0, 3).join('\n')).digest('hex'),
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const res = await service.resolveAnchor(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      anchor,
      undefined,
      { authoritative: true }
    );

    expect(res.status).toBe('SNAPSHOT_NOT_FOUND');
    expect(res.authoritative).toBe(false);
  });

  it('72. A pre-existing snapshot is preserved during failed registration', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const trustedStore = new InMemoryTrustedIngestionStore();
    const record: TrustedIngestionRecord = {
      ingestionId: randomUUID(),
      orgId: collegeAOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      treeSha: 'c'.repeat(40),
      studentId: studentUser1.id,
      verifiedAt: new Date().toISOString(),
      provenance: 'trusted_ingestion_pipeline',
      manifest: [
        {
          filePath: sampleFilePath,
          blobSha: 'b'.repeat(40),
          rawFileHash,
          byteSize: 100,
        },
      ],
    };
    trustedStore.saveRecord(record);

    const { AnchorService } = await import('../src/services/anchor-service.js');
    const existingSnapshotId = randomUUID();

    let shouldAuditFail = false;
    const conditionalAuditRepo: any = {
      log: vi.fn().mockImplementation(async () => {
        if (shouldAuditFail) {
          throw new Error('AUDIT_LOG_TIMEOUT');
        }
      }),
      query: vi.fn(),
      verifyIntegrity: vi.fn(),
    };

    const service = new AnchorService({
      auditRepo: conditionalAuditRepo,
      consentRepo: new InMemoryConsentRepository(consentService),
      trustedIngestionStore: trustedStore,
    });

    // 1. Initial successful registration
    const initialSnapshot: SourceSnapshot = {
      snapshotId: existingSnapshotId,
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      blobSha: 'b'.repeat(40),
      capturedAt: new Date().toISOString(),
    };
    const regResult = await service.registerTrustedSnapshot(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      record,
      initialSnapshot
    );
    expect(regResult.success).toBe(true);
    expect(regResult.snapshotId).toBe(existingSnapshotId);

    // 2. Second registration attempt with audit failure
    shouldAuditFail = true;
    const secondSnapshot: SourceSnapshot = {
      snapshotId: randomUUID(), // Different ID
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      blobSha: 'b'.repeat(40),
      capturedAt: new Date().toISOString(),
    };

    await expect(
      service.registerTrustedSnapshot(
        { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
        record,
        secondSnapshot
      )
    ).rejects.toThrow(/Pre-existing snapshot was preserved/);

    // 3. Pre-existing snapshot is preserved intact with original snapshotId!
    const retrieved = await service.getSnapshotStore().getSnapshot(
      sampleRepoId,
      sampleCommitSha,
      sampleFilePath,
      collegeAOrgId,
      studentUser1.id
    );
    expect(retrieved).toBeDefined();
    expect(retrieved?.snapshotId).toBe(existingSnapshotId);
  });

  it('73. A valid persisted record and matching file manifest still permit successful trusted snapshot registration', async () => {
    await consentService.grantConsent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      studentUser1.id,
      'repo_verification',
      1
    );

    const trustedStore = new InMemoryTrustedIngestionStore();
    const record: TrustedIngestionRecord = {
      ingestionId: randomUUID(),
      orgId: collegeAOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      treeSha: 'c'.repeat(40),
      studentId: studentUser1.id,
      verifiedAt: new Date().toISOString(),
      provenance: 'trusted_ingestion_pipeline',
      manifest: [
        {
          filePath: sampleFilePath,
          blobSha: 'b'.repeat(40),
          rawFileHash,
          byteSize: 100,
        },
      ],
    };
    trustedStore.saveRecord(record);

    const { AnchorService } = await import('../src/services/anchor-service.js');
    const service = new AnchorService({
      auditRepo: new InMemoryAuditRepository(auditService),
      consentRepo: new InMemoryConsentRepository(consentService),
      trustedIngestionStore: trustedStore,
    });

    const snapshotId = randomUUID();
    const snapshot: SourceSnapshot = {
      snapshotId,
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawBytes.toString('utf8'),
      rawFileHash,
      blobSha: 'b'.repeat(40),
      capturedAt: new Date().toISOString(),
    };

    const reg = await service.registerTrustedSnapshot(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      record,
      snapshot
    );

    expect(reg.success).toBe(true);
    expect(reg.snapshotId).toBe(snapshotId);

    // Verify authoritative anchor resolution
    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: collegeAOrgId,
      studentId: studentUser1.id,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 1,
      lineEnd: 3,
      contentHash: createHash('sha256').update(sampleTypeScriptCode.split('\n').slice(0, 3).join('\n')).digest('hex'),
      rawFileHash,
      blobSha: 'b'.repeat(40),
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const res = await service.resolveAnchor(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      anchor,
      undefined,
      { authoritative: true }
    );

    expect(res.valid).toBe(true);
    expect(res.authoritative).toBe(true);
    expect(res.provenance).toBe('trusted_ingestion_pipeline');
  });
});
