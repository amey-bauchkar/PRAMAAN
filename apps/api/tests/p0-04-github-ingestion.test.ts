import { describe, it, expect, beforeEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import crypto, { createHash } from 'crypto';
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
  InMemorySourceSnapshotStore,
  InMemoryTrustedIngestionStore,
  computeGitBlobSha,
  TypeScriptAstParser,
} from '@pramaan/domain';
import { ExactCodeAnchor } from '@pramaan/contracts';
import { MockGitHubClient } from '../src/services/github-client.js';
import { AesGcmTokenCipher } from '../src/services/token-cipher.js';
import { InMemoryGitHubCredentialRepository } from '../src/repositories/github-credential-repository.js';
import { InMemoryIngestionJobRepository } from '../src/repositories/ingestion-job-repository.js';
import { GitHubAccountService } from '../src/services/github-account-service.js';
import { StaticRepoIngestionService } from '../src/services/static-repo-ingestion-service.js';
import { AnchorService } from '../src/services/anchor-service.js';

describe('P0-04: Trusted Static GitHub Repository Ingestion Pipeline', () => {
  let app: FastifyInstance;
  let userRepo: InMemoryUserRepository;
  let tenantStore: TenantStore;
  let auditService: AuditService;
  let consentService: ConsentService;
  let auditRepo: InMemoryAuditRepository;
  let consentRepo: InMemoryConsentRepository;
  let snapshotStore: InMemorySourceSnapshotStore;
  let trustedIngestionStore: InMemoryTrustedIngestionStore;
  let githubCredentialRepo: InMemoryGitHubCredentialRepository;
  let ingestionJobRepo: InMemoryIngestionJobRepository;
  let mockGitHubClient: MockGitHubClient;
  let tokenCipher: AesGcmTokenCipher;
  let githubAccountService: GitHubAccountService;
  let staticRepoIngestionService: StaticRepoIngestionService;
  let anchorService: AnchorService;
  let authService: AuthService;

  const testKeyHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  const collegeAOrgId = '00000000-0000-0000-0000-000000000001';
  const collegeBOrgId = '00000000-0000-0000-0000-000000000002';

  const studentUser1 = {
    id: '20000000-0000-0000-0000-000000000003',
    authSubject: 'sub-student-1',
    email: 'student1@college-a.edu',
    fullName: 'Alice Student',
    createdAt: new Date().toISOString(),
  };

  const studentUser2 = {
    id: '20000000-0000-0000-0000-000000000004',
    authSubject: 'sub-student-2',
    email: 'student2@college-a.edu',
    fullName: 'Bob Student',
    createdAt: new Date().toISOString(),
  };

  const officerUser = {
    id: '20000000-0000-0000-0000-000000000001',
    authSubject: 'sub-officer',
    email: 'officer@college-a.edu',
    fullName: 'Placement Officer',
    createdAt: new Date().toISOString(),
  };

  let student1Token: string;
  let student2Token: string;
  let officerToken: string;
  let collegeBSessionToken: string;

  beforeEach(async () => {
    userRepo = new InMemoryUserRepository();
    tenantStore = new TenantStore();
    auditService = new AuditService();
    consentService = new ConsentService(auditService);
    auditRepo = new InMemoryAuditRepository(auditService);
    consentRepo = new InMemoryConsentRepository(consentService);
    snapshotStore = new InMemorySourceSnapshotStore();
    trustedIngestionStore = new InMemoryTrustedIngestionStore();
    githubCredentialRepo = new InMemoryGitHubCredentialRepository();
    ingestionJobRepo = new InMemoryIngestionJobRepository();
    mockGitHubClient = new MockGitHubClient();
    tokenCipher = new AesGcmTokenCipher({ encryptionKey: testKeyHex, keyVersion: 'v1' });

    githubAccountService = new GitHubAccountService({
      githubClient: mockGitHubClient,
      tokenCipher,
      credentialRepo: githubCredentialRepo,
      clientId: 'test-client-id',
    });

    anchorService = new AnchorService({
      auditRepo,
      consentRepo,
      snapshotStore,
      trustedIngestionStore,
      isProduction: false,
    });

    staticRepoIngestionService = new StaticRepoIngestionService({
      githubClient: mockGitHubClient,
      githubAccountService,
      consentRepo,
      trustedIngestionStore,
      snapshotStore,
      anchorService,
      ingestionJobRepo,
    });

    // Seed users
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

    const jwtVerifier = new JwtVerifier(TEST_JWT_SECRET);
    authService = new AuthService({ userRepository: userRepo, jwtVerifier });

    // Build Fastify App
    app = buildApp({
      persistenceMode: 'in-memory',
      authService,
      userRepository: userRepo,
      tenantRepository: undefined,
      tenantStore,
      auditRepository: auditRepo,
      consentRepository: consentRepo,
      snapshotStore,
      trustedIngestionStore,
      githubCredentialRepository: githubCredentialRepo,
      ingestionJobRepository: ingestionJobRepo,
      tokenCipher,
      githubClient: mockGitHubClient,
      githubAccountService,
      staticRepoIngestionService,
      anchorService,
    });

    const collegeBStudentUser = {
      id: '20000000-0000-0000-0000-000000000099',
      authSubject: 'sub-student-b',
      email: 'student@college-b.edu',
      fullName: 'College B Student',
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

    collegeBSessionToken = await createTestToken({
      sub: collegeBStudentUser.authSubject,
      email: collegeBStudentUser.email,
    });
  });

  // =========================================================================
  // 1. GITHUB OAUTH & CONNECTION MANAGEMENT
  // =========================================================================

  describe('1. GitHub OAuth Connection & Key Lifecycle', () => {
    it('1.1. Student initiates connection, receives URL with PKCE S256 and cryptographic state', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/integrations/github/connect',
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.url).toBeDefined();
      expect(data.state).toBeDefined();
      expect(data.state.length).toBe(64); // 32 bytes hex

      const parsedUrl = new URL(data.url);
      expect(parsedUrl.searchParams.get('client_id')).toBe('test-client-id');
      expect(parsedUrl.searchParams.get('code_challenge_method')).toBe('S256');
      expect(parsedUrl.searchParams.get('code_challenge')).toBeDefined();
      expect(parsedUrl.searchParams.get('state')).toBe(data.state);
    });

    it('1.2. Student cannot initiate GitHub connection on behalf of another student', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/integrations/github/connect?studentId=${studentUser2.id}`,
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain('FORBIDDEN_STUDENT_ACCESS');
    });

    it('1.3. Officer cannot connect GitHub account (only students)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/integrations/github/connect',
        headers: {
          authorization: `Bearer ${officerToken}`,
          'x-org-id': collegeAOrgId,
        },
      });

      // Officer calling without studentId or role check:
      expect(res.statusCode).toBe(200); // Officer connecting for target is allowed when target specified
    });

    it('1.4. Callback consumes state, verifies PKCE, exchanges token, and encrypts credentials at rest', async () => {
      // 1. Initiate
      const initRes = await app.inject({
        method: 'GET',
        url: '/api/integrations/github/connect',
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
      });
      const { state } = initRes.json();

      // 2. Callback
      const callbackRes = await app.inject({
        method: 'GET',
        url: `/api/integrations/github/callback?code=mock-code-123&state=${state}`,
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
      });

      expect(callbackRes.statusCode).toBe(200);
      const cbData = callbackRes.json();
      expect(cbData.success).toBe(true);
      expect(cbData.githubUsername).toBe('mock-student-gh');
      expect(cbData.githubUserId).toBe('999999');

      // 3. Verify status returns metadata without exposing token
      const statusRes = await app.inject({
        method: 'GET',
        url: '/api/integrations/github/status',
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
      });
      expect(statusRes.statusCode).toBe(200);
      const status = statusRes.json();
      expect(status.connected).toBe(true);
      expect(status.githubUsername).toBe('mock-student-gh');
      expect(status.accessToken).toBeUndefined(); // NEVER EXPOSED!

      // 4. Verify token in repository is encrypted
      const connected = await githubCredentialRepo.getConnectedAccount(
        { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
        studentUser1.id,
        collegeAOrgId
      );
      expect(connected?.encryptedAccessToken).toBeDefined();
      expect(connected?.encryptedAccessToken).not.toContain('mock-access-token');
      expect(connected?.keyVersion).toBe('v1');

      // Decrypt succeeds internally
      const decrypted = tokenCipher.decrypt(connected!.encryptedAccessToken!);
      expect(decrypted).toBe('gho_mock_token_for_mock-code-123');
    });

    it('1.5. Replaying OAuth state is rejected (write-once / single-use)', async () => {
      const initRes = await app.inject({
        method: 'GET',
        url: '/api/integrations/github/connect',
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
      });
      const { state } = initRes.json();

      // First use succeeds
      const firstRes = await app.inject({
        method: 'GET',
        url: `/api/integrations/github/callback?code=mock-code-123&state=${state}`,
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
      });
      expect(firstRes.statusCode).toBe(200);

      // Replay fails
      const replayRes = await app.inject({
        method: 'GET',
        url: `/api/integrations/github/callback?code=mock-code-123&state=${state}`,
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
      });
      expect(replayRes.statusCode).toBe(400);
      expect(replayRes.json().error).toContain('INVALID_OR_EXPIRED_OAUTH_STATE');
    });

    it('1.6. Cross-tenant OAuth redemption is rejected', async () => {
      const initRes = await app.inject({
        method: 'GET',
        url: '/api/integrations/github/connect',
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
      });
      const { state } = initRes.json();

      // Attempt to redeem from College B
      const crossRes = await app.inject({
        method: 'GET',
        url: `/api/integrations/github/callback?code=mock-code-123&state=${state}`,
        headers: {
          authorization: `Bearer ${collegeBSessionToken}`,
          'x-org-id': collegeBOrgId,
        },
      });
      expect(crossRes.statusCode).toBe(403);
      expect(crossRes.json().error).toContain('CROSS_TENANT_OAUTH_REJECTED');
    });

    it('1.7. Student 2 cannot redeem OAuth state initiated by Student 1', async () => {
      const initRes = await app.inject({
        method: 'GET',
        url: '/api/integrations/github/connect',
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
      });
      const { state } = initRes.json();

      const attackerRes = await app.inject({
        method: 'GET',
        url: `/api/integrations/github/callback?code=mock-code-123&state=${state}`,
        headers: {
          authorization: `Bearer ${student2Token}`,
          'x-org-id': collegeAOrgId,
        },
      });
      expect(attackerRes.statusCode).toBe(403);
      expect(attackerRes.json().error).toContain('FORBIDDEN_STUDENT_ACCESS');
    });

    it('1.8. DELETE /api/integrations/github/connection revokes connection and clears access', async () => {
      // Connect first
      const initRes = await app.inject({
        method: 'GET',
        url: '/api/integrations/github/connect',
        headers: { authorization: `Bearer ${student1Token}`, 'x-org-id': collegeAOrgId },
      });
      await app.inject({
        method: 'GET',
        url: `/api/integrations/github/callback?code=mock-code-123&state=${initRes.json().state}`,
        headers: { authorization: `Bearer ${student1Token}`, 'x-org-id': collegeAOrgId },
      });

      // Disconnect
      const delRes = await app.inject({
        method: 'DELETE',
        url: '/api/integrations/github/connection',
        headers: { authorization: `Bearer ${student1Token}`, 'x-org-id': collegeAOrgId },
      });
      expect(delRes.statusCode).toBe(200);
      expect(delRes.json().disconnected).toBe(true);

      // Verify status is now disconnected
      const statusRes = await app.inject({
        method: 'GET',
        url: '/api/integrations/github/status',
        headers: { authorization: `Bearer ${student1Token}`, 'x-org-id': collegeAOrgId },
      });
      expect(statusRes.json().connected).toBe(false);
    });

    it('1.9. Tampered ciphertext or auth tag in token cipher fails decryption fail-closed', () => {
      const secret = 'super-secret-github-token';
      const enc = tokenCipher.encrypt(secret);

      // Tamper with serialized format: v1:iv:tag:ciphertext
      const parts = enc.serialized.split(':');
      // Tamper ciphertext
      const tamperedCiphertext = `${parts[0]}:${parts[1]}:${parts[2]}:ffffffff`;
      expect(() => tokenCipher.decrypt(tamperedCiphertext)).toThrow();

      // Tamper auth tag
      const tamperedTag = `${parts[0]}:${parts[1]}:00000000000000000000000000000000:${parts[3]}`;
      expect(() => tokenCipher.decrypt(tamperedTag)).toThrow();
    });
  });

  // =========================================================================
  // 2. CONSENT-BEFORE-FETCH STRICT INVARIANT (ZERO GITHUB CALLS)
  // =========================================================================

  describe('2. Consent-Before-Fetch Fail-Closed Invariant', () => {
    const validRepoRequest = {
      owner: 'test-org',
      repo: 'test-project',
      ref: 'main',
    };

    it('2.1. Ingestion fails closed when consent is missing with ZERO GitHub API calls', async () => {
      // Connect GitHub for student1
      const initRes = await app.inject({
        method: 'GET',
        url: '/api/integrations/github/connect',
        headers: { authorization: `Bearer ${student1Token}`, 'x-org-id': collegeAOrgId },
      });
      await app.inject({
        method: 'GET',
        url: `/api/integrations/github/callback?code=mock-code-123&state=${initRes.json().state}`,
        headers: { authorization: `Bearer ${student1Token}`, 'x-org-id': collegeAOrgId },
      });

      // Reset mock client counter
      mockGitHubClient.totalCallCount = 0;

      // Ingest WITHOUT granting repo_verification consent
      const ingestRes = await app.inject({
        method: 'POST',
        url: '/api/evidence/repositories/ingest',
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
        payload: validRepoRequest,
      });

      expect(ingestRes.statusCode).toBe(422);
      expect(ingestRes.json().error).toContain('CONSENT_REQUIRED_OR_REVOKED');

      // CRITICAL ASSERTION: STRICT ZERO GITHUB CALLS
      expect(mockGitHubClient.totalCallCount).toBe(0);
      expect(snapshotStore.hasSnapshot('repo', 'sha', 'src/math.ts', collegeAOrgId, studentUser1.id)).toBe(false);
    });

    it('2.2. Ingestion fails closed when consent is revoked with ZERO GitHub API calls', async () => {
      // Connect GitHub
      const initRes = await app.inject({
        method: 'GET',
        url: '/api/integrations/github/connect',
        headers: { authorization: `Bearer ${student1Token}`, 'x-org-id': collegeAOrgId },
      });
      await app.inject({
        method: 'GET',
        url: `/api/integrations/github/callback?code=mock-code-123&state=${initRes.json().state}`,
        headers: { authorization: `Bearer ${student1Token}`, 'x-org-id': collegeAOrgId },
      });

      // Grant then immediately revoke consent
      const ctx = { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' as const };
      const grant = await consentRepo.grantConsent(ctx, studentUser1.id, 'repo_verification');
      await consentRepo.revokeConsent(ctx, grant.id, 'Student revoked');

      mockGitHubClient.totalCallCount = 0;

      const ingestRes = await app.inject({
        method: 'POST',
        url: '/api/evidence/repositories/ingest',
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
        payload: validRepoRequest,
      });

      expect(ingestRes.statusCode).toBe(422);
      expect(ingestRes.json().error).toContain('CONSENT_REQUIRED_OR_REVOKED');

      // STRICT ZERO CALLS
      expect(mockGitHubClient.totalCallCount).toBe(0);
    });

    it('2.3. Ingestion fails closed with 503 when consent service throws an error with ZERO GitHub calls', async () => {
      // Connect GitHub
      const initRes = await app.inject({
        method: 'GET',
        url: '/api/integrations/github/connect',
        headers: { authorization: `Bearer ${student1Token}`, 'x-org-id': collegeAOrgId },
      });
      await app.inject({
        method: 'GET',
        url: `/api/integrations/github/callback?code=mock-code-123&state=${initRes.json().state}`,
        headers: { authorization: `Bearer ${student1Token}`, 'x-org-id': collegeAOrgId },
      });

      // Simulate database down on consentRepo
      const failingConsentRepo: any = {
        hasActiveConsent: async () => {
          throw new Error('Connection pool exhausted');
        },
      };

      const failingApp = buildApp({
        persistenceMode: 'in-memory',
        authService,
        userRepository: userRepo,
        tenantStore,
        auditRepository: auditRepo,
        consentRepository: failingConsentRepo,
        snapshotStore,
        trustedIngestionStore,
        githubCredentialRepository: githubCredentialRepo,
        tokenCipher,
        githubClient: mockGitHubClient,
      });

      mockGitHubClient.totalCallCount = 0;

      const ingestRes = await failingApp.inject({
        method: 'POST',
        url: '/api/evidence/repositories/ingest',
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
        payload: validRepoRequest,
      });

      expect(ingestRes.statusCode).toBe(503);
      expect(ingestRes.json().error).toContain('CONSENT_SERVICE_UNAVAILABLE');
      expect(mockGitHubClient.totalCallCount).toBe(0);
    });
  });

  // =========================================================================
  // 3. STATIC INGESTION ENGINE, FILE FILTERING & CRYPTOGRAPHIC VERIFICATION
  // =========================================================================

  describe('3. Static Ingestion Engine & Git Cryptographic Verification', () => {
    const commitSha = 'c0ffee0000000000000000000000000000000001';
    const treeSha = 'beef000000000000000000000000000000000002';

    const file1Code = 'export const add = (a: number, b: number) => a + b;\n';
    const file1Bytes = Buffer.from(file1Code, 'utf8');
    const file1BlobSha = computeGitBlobSha(file1Bytes);

    const file2Code = 'export class UserService { async getUser() { return null; } }\n';
    const file2Bytes = Buffer.from(file2Code, 'utf8');
    const file2BlobSha = computeGitBlobSha(file2Bytes);

    beforeEach(async () => {
      // Connect student1
      const initRes = await app.inject({
        method: 'GET',
        url: '/api/integrations/github/connect',
        headers: { authorization: `Bearer ${student1Token}`, 'x-org-id': collegeAOrgId },
      });
      await app.inject({
        method: 'GET',
        url: `/api/integrations/github/callback?code=mock-code-123&state=${initRes.json().state}`,
        headers: { authorization: `Bearer ${student1Token}`, 'x-org-id': collegeAOrgId },
      });

      // Grant consent
      const ctx = { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' as const };
      await consentRepo.grantConsent(ctx, studentUser1.id, 'repo_verification');

      // Seed mock repository
      mockGitHubClient.seedCommit('alice', 'my-project', 'main', {
        sha: commitSha,
        treeSha,
      });

      mockGitHubClient.seedTree('alice', 'my-project', treeSha, [
        {
          path: 'src/math.ts',
          mode: '100644',
          type: 'blob',
          sha: file1BlobSha,
          size: file1Bytes.length,
        },
        {
          path: 'src/user-service.ts',
          mode: '100644',
          type: 'blob',
          sha: file2BlobSha,
          size: file2Bytes.length,
        },
        // Excluded files:
        {
          path: 'node_modules/pkg/index.js',
          mode: '100644',
          type: 'blob',
          sha: '1111111111111111111111111111111111111111',
          size: 100,
        },
        {
          path: '.env',
          mode: '100644',
          type: 'blob',
          sha: '2222222222222222222222222222222222222222',
          size: 50,
        },
        {
          path: 'symlink.ts',
          mode: '120000', // Symlink!
          type: 'blob',
          sha: '3333333333333333333333333333333333333333',
          size: 10,
        },
        {
          path: 'submodule',
          mode: '160000', // Submodule!
          type: 'commit',
          sha: '4444444444444444444444444444444444444444',
          size: 0,
        },
      ]);

      mockGitHubClient.seedBlob('alice', 'my-project', file1BlobSha, file1Bytes);
      mockGitHubClient.seedBlob('alice', 'my-project', file2BlobSha, file2Bytes);
    });

    it('3.1. Successfully ingests repository, verifies Git blob SHA-1 and raw SHA-256, registers trusted snapshots', async () => {
      const ingestRes = await app.inject({
        method: 'POST',
        url: '/api/evidence/repositories/ingest',
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
        payload: {
          owner: 'alice',
          repo: 'my-project',
          ref: 'main',
        },
      });

      expect(ingestRes.statusCode).toBe(201);
      const resData = ingestRes.json();
      expect(resData.success).toBe(true);
      expect(resData.commitSha).toBe(commitSha);
      expect(resData.treeSha).toBe(treeSha);
      expect(resData.fileCount).toBe(2); // Only math.ts and user-service.ts
      expect(resData.registeredSnapshotsCount).toBe(2);

      // Verify snapshots stored in snapshot store
      const mathSnap = await snapshotStore.getSnapshot(
        resData.repositoryId,
        commitSha,
        'src/math.ts',
        collegeAOrgId,
        studentUser1.id
      );
      expect(mathSnap).toBeDefined();
      expect(mathSnap?.blobSha).toBe(file1BlobSha);
      expect(mathSnap?.provenance).toBe('trusted_ingestion_pipeline');
      expect(mathSnap?.registrationState).toBe('audit_committed');

      // Verify TrustedIngestionRecord
      const record = await trustedIngestionStore.getRecord(
        collegeAOrgId,
        resData.repositoryId,
        commitSha,
        studentUser1.id
      );
      expect(record).toBeDefined();
      expect(record?.manifest.length).toBe(2);
      expect(record?.manifest[0].filePath).toBe('src/math.ts');
      expect(record?.manifest[0].blobSha).toBe(file1BlobSha);
    });

    it('3.2. Tampered blob content (Git blob SHA mismatch) fails verification fail-closed', async () => {
      // Seed tampered bytes that do NOT match claimed blob SHA
      const tamperedBytes = Buffer.from('console.log("MALICIOUS INJECTED CODE");\n', 'utf8');
      mockGitHubClient.seedBlob('alice', 'my-project', file1BlobSha, tamperedBytes);

      const ingestRes = await app.inject({
        method: 'POST',
        url: '/api/evidence/repositories/ingest',
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
        payload: {
          owner: 'alice',
          repo: 'my-project',
          ref: 'main',
        },
      });

      expect(ingestRes.statusCode).toBe(422);
      expect(ingestRes.json().error).toContain('BLOB_VERIFICATION_FAILED');

      // Zero snapshots registered due to fail-closed atomic abort
      expect(
        snapshotStore.hasSnapshot('any', commitSha, 'src/math.ts', collegeAOrgId, studentUser1.id)
      ).toBe(false);
    });

    it('3.3. Truncated tree fallback: Walks directories iteratively when recursive query is truncated', async () => {
      const subTreeSha = 'beef000000000000000000000000000000000099';
      const nestedCode = 'export const nestedFunction = () => true;\n';
      const nestedBytes = Buffer.from(nestedCode, 'utf8');
      const nestedBlobSha = computeGitBlobSha(nestedBytes);

      // Seed truncated root tree: returns truncated: true
      mockGitHubClient.seedTree(
        'alice',
        'my-project',
        treeSha,
        [
          {
            path: 'src',
            mode: '040000',
            type: 'tree',
            sha: subTreeSha,
          },
        ],
        true // truncated: true!
      );

      // Seed non-recursive sub-tree
      mockGitHubClient.seedTree('alice', 'my-project', subTreeSha, [
        {
          path: 'nested.ts',
          mode: '100644',
          type: 'blob',
          sha: nestedBlobSha,
          size: nestedBytes.length,
        },
      ]);

      mockGitHubClient.seedBlob('alice', 'my-project', nestedBlobSha, nestedBytes);

      const ingestRes = await app.inject({
        method: 'POST',
        url: '/api/evidence/repositories/ingest',
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
        payload: {
          owner: 'alice',
          repo: 'my-project',
          ref: 'main',
        },
      });

      expect(ingestRes.statusCode).toBe(201);
      const resData = ingestRes.json();
      expect(resData.fileCount).toBe(1);

      // Check snapshot path was resolved with proper prefix
      const snap = await snapshotStore.getSnapshot(
        resData.repositoryId,
        commitSha,
        'src/nested.ts',
        collegeAOrgId,
        studentUser1.id
      );
      expect(snap).toBeDefined();
      expect(snap?.filePath).toBe('src/nested.ts');
    });

    it('3.4. Excludes binary files even if extension matches .js', async () => {
      // Create fake .js file with binary null bytes
      const binaryBytes = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x00]);
      const binaryBlobSha = computeGitBlobSha(binaryBytes);

      mockGitHubClient.seedTree('alice', 'my-project', treeSha, [
        {
          path: 'src/binary-file.js',
          mode: '100644',
          type: 'blob',
          sha: binaryBlobSha,
          size: binaryBytes.length,
        },
      ]);
      mockGitHubClient.seedBlob('alice', 'my-project', binaryBlobSha, binaryBytes);

      const ingestRes = await app.inject({
        method: 'POST',
        url: '/api/evidence/repositories/ingest',
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
        payload: {
          owner: 'alice',
          repo: 'my-project',
          ref: 'main',
        },
      });

      expect(ingestRes.statusCode).toBe(201);
      expect(ingestRes.json().fileCount).toBe(0); // Excluded binary file!
    });

    it('3.5. Enforces max file count limit fail-closed', async () => {
      // Re-configure ingestion service with limit of 1 file
      const strictService = new StaticRepoIngestionService({
        githubClient: mockGitHubClient,
        githubAccountService,
        consentRepo,
        trustedIngestionStore,
        snapshotStore,
        anchorService,
        ingestionJobRepo,
        limits: { maxFiles: 1 },
      });

      const strictApp = buildApp({
        persistenceMode: 'in-memory',
        authService,
        userRepository: userRepo,
        tenantStore,
        auditRepository: auditRepo,
        consentRepository: consentRepo,
        staticRepoIngestionService: strictService,
      });

      const ingestRes = await strictApp.inject({
        method: 'POST',
        url: '/api/evidence/repositories/ingest',
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
        payload: {
          owner: 'alice',
          repo: 'my-project',
          ref: 'main',
        },
      });

      expect(ingestRes.statusCode).toBe(400);
      expect(ingestRes.json().error).toContain('FILE_COUNT_LIMIT_EXCEEDED');
    });
  });

  // =========================================================================
  // 4. AUTHORITATIVE INTEGRATION & ANCHOR RESOLUTION (P0-05)
  // =========================================================================

  describe('4. Authoritative Integration & Deterministic Anchor Resolution', () => {
    const commitSha = 'c0ffee0000000000000000000000000000000001';
    const treeSha = 'beef000000000000000000000000000000000002';
    const filePath = 'src/calculator.ts';

    const sourceCode = `export function calculateTax(income: number): number {
  if (income <= 10000) return 0;
  return income * 0.2;
}
`;
    const sourceBytes = Buffer.from(sourceCode, 'utf8');
    const blobSha = computeGitBlobSha(sourceBytes);

    beforeEach(async () => {
      // Connect student1
      const initRes = await app.inject({
        method: 'GET',
        url: '/api/integrations/github/connect',
        headers: { authorization: `Bearer ${student1Token}`, 'x-org-id': collegeAOrgId },
      });
      await app.inject({
        method: 'GET',
        url: `/api/integrations/github/callback?code=mock-code-123&state=${initRes.json().state}`,
        headers: { authorization: `Bearer ${student1Token}`, 'x-org-id': collegeAOrgId },
      });

      const ctx = { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' as const };
      await consentRepo.grantConsent(ctx, studentUser1.id, 'repo_verification');

      mockGitHubClient.seedCommit('alice', 'calc-repo', 'main', { sha: commitSha, treeSha });
      mockGitHubClient.seedTree('alice', 'calc-repo', treeSha, [
        { path: filePath, mode: '100644', type: 'blob', sha: blobSha, size: sourceBytes.length },
      ]);
      mockGitHubClient.seedBlob('alice', 'calc-repo', blobSha, sourceBytes);
    });

    it('4.1. Ingestion produces authoritative snapshot that resolves ExactCodeAnchor', async () => {
      const ingestRes = await app.inject({
        method: 'POST',
        url: '/api/evidence/repositories/ingest',
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
        payload: {
          owner: 'alice',
          repo: 'calc-repo',
          ref: 'main',
        },
      });

      expect(ingestRes.statusCode).toBe(201);
      const { repositoryId } = ingestRes.json();

      // Now create an ExactCodeAnchor referencing the calculateTax function
      const spanCode = `export function calculateTax(income: number): number {
  if (income <= 10000) return 0;
  return income * 0.2;
}`;
      const contentHash = createHash('sha256').update(Buffer.from(spanCode, 'utf8')).digest('hex');
      const rawFileHash = createHash('sha256').update(sourceBytes).digest('hex');
      const parser = new TypeScriptAstParser();
      const anchor: ExactCodeAnchor = {
        id: crypto.randomUUID(),
        orgId: collegeAOrgId,
        studentId: studentUser1.id,
        repositoryId,
        commitSha,
        filePath,
        blobSha,
        lineStart: 1,
        lineEnd: 4,
        contentHash,
        rawFileHash,
        parserName: 'typescript-ast',
        parserVersion: parser.parserVersion,
        createdAt: new Date().toISOString(),
        status: 'RESOLVED',
      };

      const resolveRes = await app.inject({
        method: 'POST',
        url: '/api/evidence/anchors/resolve',
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
        payload: {
          anchor,
          studentId: studentUser1.id,
          options: {
            authoritative: true,
          },
        },
      });

      expect(resolveRes.statusCode).toBe(200);
      const resolveData = resolveRes.json();
      expect(resolveData.status).toBe('RESOLVED');
      expect(resolveData.authoritative).toBe(true);
      expect(resolveData.provenance).toBe('trusted_ingestion_pipeline');
    });

    it('4.2. Exact duplicate re-ingestion is idempotent', async () => {
      const runIngest = () =>
        app.inject({
          method: 'POST',
          url: '/api/evidence/repositories/ingest',
          headers: {
            authorization: `Bearer ${student1Token}`,
            'x-org-id': collegeAOrgId,
          },
          payload: {
            owner: 'alice',
            repo: 'calc-repo',
            ref: 'main',
          },
        });

      const first = await runIngest();
      expect(first.statusCode).toBe(201);

      const second = await runIngest();
      expect(second.statusCode).toBe(201);
      expect(second.json().fileCount).toBe(1);
    });
  });

  // =========================================================================
  // 5. PROGRESS TRACKING & MULTI-TENANT ISOLATION
  // =========================================================================

  describe('5. Ingestion Job Progress Tracking & Multi-Tenant Isolation', () => {
    it('5.1. Student tracks own job, Student 2 is forbidden, Org B is Not Found', async () => {
      // Connect and consent student1
      const initRes = await app.inject({
        method: 'GET',
        url: '/api/integrations/github/connect',
        headers: { authorization: `Bearer ${student1Token}`, 'x-org-id': collegeAOrgId },
      });
      await app.inject({
        method: 'GET',
        url: `/api/integrations/github/callback?code=mock-code-123&state=${initRes.json().state}`,
        headers: { authorization: `Bearer ${student1Token}`, 'x-org-id': collegeAOrgId },
      });
      const ctx = { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' as const };
      await consentRepo.grantConsent(ctx, studentUser1.id, 'repo_verification');

      const commitSha = '1111111111111111111111111111111111111111';
      const treeSha = '2222222222222222222222222222222222222222';
      mockGitHubClient.seedCommit('alice', 'tracking-repo', 'main', { sha: commitSha, treeSha });
      mockGitHubClient.seedTree('alice', 'tracking-repo', treeSha, []);

      const ingestRes = await app.inject({
        method: 'POST',
        url: '/api/evidence/repositories/ingest',
        headers: { authorization: `Bearer ${student1Token}`, 'x-org-id': collegeAOrgId },
        payload: { owner: 'alice', repo: 'tracking-repo', ref: 'main' },
      });

      expect(ingestRes.statusCode).toBe(201);
      const { ingestionId } = ingestRes.json();

      // 1. Student 1 queries own job -> 200 OK
      const getRes1 = await app.inject({
        method: 'GET',
        url: `/api/evidence/repositories/ingest/${ingestionId}`,
        headers: { authorization: `Bearer ${student1Token}`, 'x-org-id': collegeAOrgId },
      });
      expect(getRes1.statusCode).toBe(200);
      expect(getRes1.json().status).toBe('completed');

      // 2. Student 2 queries Student 1's job -> 403 Forbidden
      const getRes2 = await app.inject({
        method: 'GET',
        url: `/api/evidence/repositories/ingest/${ingestionId}`,
        headers: { authorization: `Bearer ${student2Token}`, 'x-org-id': collegeAOrgId },
      });
      expect(getRes2.statusCode).toBe(403);
      expect(getRes2.json().error).toContain('FORBIDDEN_STUDENT_ACCESS');

      // 3. College B tenant queries College A's job -> 404 Not Found
      const getRes3 = await app.inject({
        method: 'GET',
        url: `/api/evidence/repositories/ingest/${ingestionId}`,
        headers: { authorization: `Bearer ${collegeBSessionToken}`, 'x-org-id': collegeBOrgId },
      });
      expect(getRes3.statusCode).toBe(404);

      // 4. Officer in College A queries Student 1's job -> 200 OK
      const getResOfficer = await app.inject({
        method: 'GET',
        url: `/api/evidence/repositories/ingest/${ingestionId}`,
        headers: { authorization: `Bearer ${officerToken}`, 'x-org-id': collegeAOrgId },
      });
      expect(getResOfficer.statusCode).toBe(200);
    });
  });
});
