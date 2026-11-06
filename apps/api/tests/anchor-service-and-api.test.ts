import { describe, it, expect, beforeEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { randomUUID, createHash } from 'crypto';
import { buildApp } from '../src/app.js';
import { AuthService } from '../src/services/auth-service.js';
import { JwtVerifier } from '../src/services/jwt-verifier.js';
import { InMemoryUserRepository } from '../src/repositories/user-repository.js';
import { TenantStore } from '../src/services/tenant-store.js';
import { AuditService } from '../src/services/audit-service.js';
import { ConsentService } from '../src/services/consent-service.js';
import { createTestToken, TEST_JWT_SECRET } from '../src/testing/test-jwt-utils.js';
import {
  ExactCodeAnchor,
  SourceSnapshot,
  TypeScriptAstParser,
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
    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
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
    const corruptedSnapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
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
    // 1. Register snapshot
    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
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

    // 2. Create anchor for lines 1 to 3 (addNumbers)
    const lines = sampleTypeScriptCode.split('\n');
    const funcSpan = lines.slice(0, 3).join('\n');
    const contentHash = createHash('sha256').update(Buffer.from(funcSpan, 'utf8')).digest('hex');

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: collegeAOrgId,
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
    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: collegeAOrgId,
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
    const res = await app.inject({
      method: 'POST',
      url: '/api/evidence/parse',
      headers: {
        authorization: `Bearer ${officerToken}`,
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
    expect(body.parserName).toBe('typescript-ast');
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
    // Execute a series of snapshot registrations and anchor resolutions
    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
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
});
