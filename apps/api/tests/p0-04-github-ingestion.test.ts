import { describe, it, expect, beforeEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import crypto, { createHash } from 'crypto';
import { buildApp } from '../src/app.js';
import { AuthService } from '../src/services/auth-service.js';
import { JwtVerifier } from '../src/services/jwt-verifier.js';
import { InMemoryUserRepository } from '../src/repositories/user-repository.js';
import { TenantStore } from '../src/services/tenant-store.js';
import { InMemoryTenantRepository } from '../src/repositories/tenant-repository.js';
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
import { MockGitHubClient, DefaultGitHubClient } from '../src/services/github-client.js';
import { AesGcmTokenCipher } from '../src/services/token-cipher.js';
import { InMemoryGitHubCredentialRepository } from '../src/repositories/github-credential-repository.js';
import { InMemoryIngestionJobRepository } from '../src/repositories/ingestion-job-repository.js';
import { InMemoryRepositoryRepository } from '../src/repositories/repository-repository.js';
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
  let repositoryRepo: InMemoryRepositoryRepository;
  let mockGitHubClient: MockGitHubClient;
  let tokenCipher: AesGcmTokenCipher;
  let githubAccountService: GitHubAccountService;
  let staticRepoIngestionService: StaticRepoIngestionService;
  let anchorService: AnchorService;
  let authService: AuthService;

  const testKeyHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  const collegeAOrgId = '00000000-0000-0000-0000-000000000001';
  const collegeBOrgId = '00000000-0000-0000-0000-000000000002';

  // Explicitly distinct users.id and students.id
  const studentUser1 = {
    id: '20000000-0000-0000-0000-000000000003',
    authSubject: 'sub-student-1',
    email: 'student1@college-a.edu',
    fullName: 'Alice Student',
    createdAt: new Date().toISOString(),
  };
  const student1RecordId = '10000000-0000-0000-0000-000000000003';

  const studentUser2 = {
    id: '20000000-0000-0000-0000-000000000004',
    authSubject: 'sub-student-2',
    email: 'student2@college-a.edu',
    fullName: 'Bob Student',
    createdAt: new Date().toISOString(),
  };
  const student2RecordId = '10000000-0000-0000-0000-000000000004';

  const officerUser = {
    id: '20000000-0000-0000-0000-000000000001',
    authSubject: 'sub-officer',
    email: 'officer@college-a.edu',
    fullName: 'Placement Officer',
    createdAt: new Date().toISOString(),
  };

  const collegeBStudentUser = {
    id: '20000000-0000-0000-0000-000000000099',
    authSubject: 'sub-student-b',
    email: 'student@college-b.edu',
    fullName: 'College B Student',
    createdAt: new Date().toISOString(),
  };
  const collegeBStudentRecordId = '10000000-0000-0000-0000-000000000099';

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
    repositoryRepo = new InMemoryRepositoryRepository();
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
      repositoryRepo,
      tenantRepo: new InMemoryTenantRepository(tenantStore),
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

    // Seed distinct student records in tenantStore
    tenantStore.addStudent(
      { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
      {
        id: student1RecordId,
        orgId: collegeAOrgId,
        userId: studentUser1.id,
        departmentId: '10000000-0000-0000-0000-000000000001',
        enrollment_no: 'ENR-STUDENT-1',
        graduating_year: 2026,
        program_level: 'undergraduate',
        is_minor: false,
        createdAt: new Date().toISOString(),
      }
    );

    tenantStore.addStudent(
      { orgId: collegeAOrgId, userId: studentUser2.id, role: 'student' },
      {
        id: student2RecordId,
        orgId: collegeAOrgId,
        userId: studentUser2.id,
        departmentId: '10000000-0000-0000-0000-000000000001',
        enrollment_no: 'ENR-STUDENT-2',
        graduating_year: 2026,
        program_level: 'undergraduate',
        is_minor: false,
        createdAt: new Date().toISOString(),
      }
    );

    await userRepo.registerUser(collegeBStudentUser);
    await userRepo.addMembership({
      id: '30000000-0000-0000-0000-000000000099',
      userId: collegeBStudentUser.id,
      orgId: collegeBOrgId,
      role: 'student',
      status: 'active',
      createdAt: new Date().toISOString(),
    });

    tenantStore.addStudent(
      { orgId: collegeBOrgId, userId: collegeBStudentUser.id, role: 'student' },
      {
        id: collegeBStudentRecordId,
        orgId: collegeBOrgId,
        userId: collegeBStudentUser.id,
        departmentId: '10000000-0000-0000-0000-000000000002',
        enrollment_no: 'ENR-STUDENT-B',
        graduating_year: 2026,
        program_level: 'undergraduate',
        is_minor: false,
        createdAt: new Date().toISOString(),
      }
    );

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
      repositoryRepository: repositoryRepo,
      tokenCipher,
      githubClient: mockGitHubClient,
      githubAccountService,
      staticRepoIngestionService,
      anchorService,
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
        url: `/api/integrations/github/connect?studentId=${student2RecordId}`,
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain('FORBIDDEN_STUDENT_ACCESS');
    });

    it('1.3. Officer cannot connect GitHub account (delegated connection prohibited)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/integrations/github/connect',
        headers: {
          authorization: `Bearer ${officerToken}`,
          'x-org-id': collegeAOrgId,
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain('FORBIDDEN_DELEGATED_CONNECTION');
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

      // 4. Verify token in repository is encrypted and stored under verified student1RecordId
      const connected = await githubCredentialRepo.getConnectedAccount(
        { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
        student1RecordId,
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

      // Attempt to redeem from College B -> Tenant isolation renders state invisible/null
      const crossRes = await app.inject({
        method: 'GET',
        url: `/api/integrations/github/callback?code=mock-code-123&state=${state}`,
        headers: {
          authorization: `Bearer ${collegeBSessionToken}`,
          'x-org-id': collegeBOrgId,
        },
      });
      expect(crossRes.statusCode).toBe(400);
      expect(crossRes.json().error).toContain('INVALID_OR_EXPIRED_OAUTH_STATE');
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
      expect(() => tokenCipher.decrypt(tamperedCiphertext)).toThrow(/AUTHENTICATED_DECRYPTION_FAILED/);

      // Tamper auth tag
      const tamperedTag = `${parts[0]}:${parts[1]}:00000000000000000000000000000000:${parts[3]}`;
      expect(() => tokenCipher.decrypt(tamperedTag)).toThrow(/AUTHENTICATED_DECRYPTION_FAILED/);
    });

    it('1.10. Authorization URL generation uses default public repository scope "read:user public_repo" space-separated', async () => {
      const initRes = await app.inject({
        method: 'GET',
        url: '/api/integrations/github/connect',
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
      });

      expect(initRes.statusCode).toBe(200);
      const url = new URL(initRes.json().url);
      expect(url.searchParams.get('scope')).toBe('read:user public_repo');
      expect(url.searchParams.get('scope')).not.toContain('repo:read');
    });

    it('1.11. Service allows configured allowed scopes and rejects invalid/excessive scopes', async () => {
      const sessionCtx = { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' as const };

      // Valid custom scopes (space-separated per RFC 6749)
      const customRes = await githubAccountService.initiateConnection(
        sessionCtx,
        student1RecordId,
        'http://localhost:3000/api/integrations/github/callback',
        ['read:user', 'public_repo']
      );
      const customUrl = new URL(customRes.url);
      expect(customUrl.searchParams.get('scope')).toBe('read:user public_repo');

      // Invalid scope 'repo:read' rejected
      await expect(
        githubAccountService.initiateConnection(
          sessionCtx,
          student1RecordId,
          'http://localhost:3000/api/integrations/github/callback',
          ['repo:read']
        )
      ).rejects.toThrow(/INVALID_GITHUB_SCOPE/);

      // Excessive broad 'repo' scope rejected under public-only architecture
      await expect(
        githubAccountService.initiateConnection(
          sessionCtx,
          student1RecordId,
          'http://localhost:3000/api/integrations/github/callback',
          ['read:user', 'repo']
        )
      ).rejects.toThrow(/INVALID_GITHUB_SCOPE/);
    });

    it('1.12. Callback fails closed with 403 when granted permissions are insufficient', async () => {
      const initRes = await app.inject({
        method: 'GET',
        url: '/api/integrations/github/connect',
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
      });
      const { state } = initRes.json();

      // Configure mock client to return only 'gist' scope (missing read:user / repo)
      mockGitHubClient.mockScopeOverride = 'gist';

      const cbRes = await app.inject({
        method: 'GET',
        url: `/api/integrations/github/callback?code=mock-code-insufficient&state=${state}`,
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
      });

      expect(cbRes.statusCode).toBe(403);
      expect(cbRes.json().error).toContain('INSUFFICIENT_GITHUB_PERMISSIONS');

      // Reset mock client
      mockGitHubClient.mockScopeOverride = undefined;
    });

    it('1.12a. Callback rejects token with only "read:user" (missing "public_repo") with 403 INSUFFICIENT_GITHUB_PERMISSIONS', async () => {
      const initRes = await app.inject({
        method: 'GET',
        url: '/api/integrations/github/connect',
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
      });
      const { state } = initRes.json();

      // Only read:user granted
      mockGitHubClient.mockScopeOverride = 'read:user';

      const cbRes = await app.inject({
        method: 'GET',
        url: `/api/integrations/github/callback?code=mock-code-readuser-only&state=${state}`,
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
      });

      expect(cbRes.statusCode).toBe(403);
      expect(cbRes.json().error).toContain('INSUFFICIENT_GITHUB_PERMISSIONS');

      mockGitHubClient.mockScopeOverride = undefined;
    });

    it('1.12b. Callback rejects token with only "public_repo" (missing "read:user") with 403 INSUFFICIENT_GITHUB_PERMISSIONS', async () => {
      const initRes = await app.inject({
        method: 'GET',
        url: '/api/integrations/github/connect',
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
      });
      const { state } = initRes.json();

      // Only public_repo granted
      mockGitHubClient.mockScopeOverride = 'public_repo';

      const cbRes = await app.inject({
        method: 'GET',
        url: `/api/integrations/github/callback?code=mock-code-publicrepo-only&state=${state}`,
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
      });

      expect(cbRes.statusCode).toBe(403);
      expect(cbRes.json().error).toContain('INSUFFICIENT_GITHUB_PERMISSIONS');

      mockGitHubClient.mockScopeOverride = undefined;
    });

    it('1.12c. Callback accepts GitHub App fine-grained permissions ("contents:read metadata:read")', async () => {
      const initRes = await app.inject({
        method: 'GET',
        url: '/api/integrations/github/connect',
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
      });
      const { state } = initRes.json();

      // GitHub App permissions
      mockGitHubClient.mockScopeOverride = 'contents:read metadata:read';

      const cbRes = await app.inject({
        method: 'GET',
        url: `/api/integrations/github/callback?code=mock-code-github-app&state=${state}`,
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
      });

      expect(cbRes.statusCode).toBe(200);
      expect(cbRes.json().success).toBe(true);

      mockGitHubClient.mockScopeOverride = undefined;
    });

    it('1.13. Hostile client redirect_uri is rejected with 400 Bad Request', async () => {
      const hostileRes = await app.inject({
        method: 'GET',
        url: '/api/integrations/github/connect?redirect_uri=https://attacker.com/steal-code',
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
      });

      expect(hostileRes.statusCode).toBe(400);
      expect(hostileRes.json().error).toContain('INVALID_REDIRECT_URI');
    });

    it('1.14. Spoofed Host header has no effect; canonical configured URI is used', async () => {
      const spoofedRes = await app.inject({
        method: 'GET',
        url: '/api/integrations/github/connect',
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
          host: 'evil-attacker.example.com',
          'x-forwarded-host': 'evil-attacker.example.com',
        },
      });

      expect(spoofedRes.statusCode).toBe(200);
      const url = new URL(spoofedRes.json().url);
      const redirectUri = url.searchParams.get('redirect_uri');
      expect(redirectUri).toBe('http://localhost:3000/api/integrations/github/callback');
      expect(redirectUri).not.toContain('evil-attacker');
    });

    it('1.15. Production mode fails closed when GitHub OAuth credentials or redirect URI are missing or placeholder', () => {
      const originalEnv = { ...process.env };
      try {
        (process.env as any).NODE_ENV = 'production';
        process.env.DATABASE_URL = 'postgresql://fake:fake@localhost:5432/fake';
        process.env.SUPABASE_JWT_SECRET = 'super-secret-jwt-secret-at-least-32-chars-long';

        // Placeholder client ID
        process.env.GITHUB_CLIENT_ID = 'pramaan_client_id';
        process.env.GITHUB_CLIENT_SECRET = 'some-real-secret';
        process.env.GITHUB_OAUTH_REDIRECT_URI = 'https://pramaan.ac.in/callback';
        expect(() => buildApp()).toThrow(/FATAL: Production mode requires a valid GITHUB_CLIENT_ID/);

        // Placeholder client secret
        process.env.GITHUB_CLIENT_ID = 'valid-client-id';
        process.env.GITHUB_CLIENT_SECRET = 'pramaan_client_secret';
        expect(() => buildApp()).toThrow(/FATAL: Production mode requires a valid GITHUB_CLIENT_SECRET/);

        // Missing redirect URI
        process.env.GITHUB_CLIENT_SECRET = 'valid-client-secret';
        delete process.env.GITHUB_OAUTH_REDIRECT_URI;
        expect(() => buildApp()).toThrow(/FATAL: Production mode requires a valid GITHUB_OAUTH_REDIRECT_URI/);
      } finally {
        process.env = originalEnv;
      }
    });

    it('1.16. Token cipher supports zero-downtime key rotation with versioned keyring', () => {
      const keyV1 = '1111111111111111111111111111111111111111111111111111111111111111';
      const keyV2 = '2222222222222222222222222222222222222222222222222222222222222222';

      // Phase 1: v1 is active key
      const cipherV1 = new AesGcmTokenCipher({
        encryptionKey: keyV1,
        keyVersion: 'v1',
      });
      const token = 'gho_alice_token_12345';
      const encV1 = cipherV1.encrypt(token);
      expect(encV1.serialized.startsWith('v1:')).toBe(true);

      // Phase 2: Key rotation to v2, v1 retained in keyring
      const cipherV2 = new AesGcmTokenCipher({
        keyRing: {
          v1: keyV1,
          v2: keyV2,
        },
        activeKeyVersion: 'v2',
      });

      // Existing token encrypted with v1 decrypts cleanly under rotated cipher
      expect(cipherV2.decrypt(encV1.serialized)).toBe(token);

      // New token encrypts with v2
      const encV2 = cipherV2.encrypt('gho_bob_token_67890');
      expect(encV2.serialized.startsWith('v2:')).toBe(true);
      expect(cipherV2.decrypt(encV2.serialized)).toBe('gho_bob_token_67890');
    });

    it('1.17. Token cipher fails closed when encountering unknown key version', () => {
      const key = '1111111111111111111111111111111111111111111111111111111111111111';
      const cipher = new AesGcmTokenCipher({ encryptionKey: key, keyVersion: 'v1' });
      const enc = cipher.encrypt('some-token');

      // Tamper key version to v99
      const tamperedVersion = enc.serialized.replace(/^v1:/, 'v99:');
      expect(() => cipher.decrypt(tamperedVersion)).toThrow(/UNKNOWN_KEY_VERSION/);
    });

    it('1.18. Token cipher enforces strict 64-hex key validation in production mode', () => {
      const originalEnv = process.env.NODE_ENV;
      try {
        (process.env as any).NODE_ENV = 'production';

        // Non-hex string fails
        expect(() => new AesGcmTokenCipher({ encryptionKey: 'short-key' })).toThrow(/64-character hexadecimal string/);
        // 63 chars fails
        expect(() => new AesGcmTokenCipher({ encryptionKey: 'a'.repeat(63) })).toThrow(/64-character hexadecimal string/);
        // Valid 64 hex succeeds
        expect(() => new AesGcmTokenCipher({ encryptionKey: 'a'.repeat(64) })).not.toThrow();
      } finally {
        (process.env as any).NODE_ENV = originalEnv;
      }
    });

    it('1.19. Browser redirect arriving without Authorization header returns 302 redirecting to frontend callback page', async () => {
      const initRes = await app.inject({
        method: 'GET',
        url: '/api/integrations/github/connect',
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
      });
      const { state } = initRes.json();

      // Browser GET redirect from GitHub without auth header
      const redirectRes = await app.inject({
        method: 'GET',
        url: `/api/integrations/github/callback?code=mock-code-browser&state=${state}`,
      });

      expect(redirectRes.statusCode).toBe(302);
      expect(redirectRes.headers.location).toContain('/integrations/github/callback?code=mock-code-browser&state=');
      expect(redirectRes.headers.location).toContain(state);
    });

    it('1.20. Frontend submits authenticated POST /api/integrations/github/callback, completing handshake and rejecting replay', async () => {
      const initRes = await app.inject({
        method: 'GET',
        url: '/api/integrations/github/connect',
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
      });
      const { state } = initRes.json();

      // Authenticated POST request from frontend SPA
      const postRes = await app.inject({
        method: 'POST',
        url: '/api/integrations/github/callback',
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
        payload: {
          code: 'mock-code-spa',
          state,
        },
      });

      expect(postRes.statusCode).toBe(200);
      const postData = postRes.json();
      expect(postData.success).toBe(true);
      expect(postData.githubUsername).toBe('mock-student-gh');
      expect(postData.githubUserId).toBe('999999');

      // Replay rejection on POST endpoint
      const replayPostRes = await app.inject({
        method: 'POST',
        url: '/api/integrations/github/callback',
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
        payload: {
          code: 'mock-code-spa',
          state,
        },
      });
      expect(replayPostRes.statusCode).toBe(400);
      expect(replayPostRes.json().error).toContain('INVALID_OR_EXPIRED_OAUTH_STATE');
    });

    it('1.21. Officer or platform admin attempting POST /api/integrations/github/callback is rejected with 403 FORBIDDEN_DELEGATED_CONNECTION', async () => {
      const postRes = await app.inject({
        method: 'POST',
        url: '/api/integrations/github/callback',
        headers: {
          authorization: `Bearer ${officerToken}`,
          'x-org-id': collegeAOrgId,
        },
        payload: {
          code: 'mock-code-officer',
          state: 'some-state',
        },
      });

      expect(postRes.statusCode).toBe(403);
      expect(postRes.json().error).toContain('FORBIDDEN_DELEGATED_CONNECTION');
    });

    it('1.22. User without student profile in tenant receives 404 STUDENT_RECORD_NOT_FOUND', async () => {
      // Create user with student role in membership, but no students table record
      const noStudentRecordUser = {
        id: '20000000-0000-0000-0000-000000000088',
        authSubject: 'sub-student-no-record',
        email: 'ghost@college-a.edu',
        fullName: 'Ghost Student',
        createdAt: new Date().toISOString(),
      };
      await userRepo.registerUser(noStudentRecordUser);
      await userRepo.addMembership({
        id: '30000000-0000-0000-0000-000000000088',
        userId: noStudentRecordUser.id,
        orgId: collegeAOrgId,
        role: 'student',
        status: 'active',
        createdAt: new Date().toISOString(),
      });

      const ghostToken = await createTestToken({
        sub: noStudentRecordUser.authSubject,
        email: noStudentRecordUser.email,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/integrations/github/connect',
        headers: {
          authorization: `Bearer ${ghostToken}`,
          'x-org-id': collegeAOrgId,
        },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toContain('STUDENT_RECORD_NOT_FOUND');
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
      expect(snapshotStore.hasSnapshot('repo', 'sha', 'src/math.ts', collegeAOrgId, student1RecordId)).toBe(false);
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

      // Grant then immediately revoke consent for verified student1RecordId
      const ctx = { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' as const };
      const grant = await consentRepo.grantConsent(ctx, student1RecordId, 'repo_verification');
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
      await consentRepo.grantConsent(ctx, student1RecordId, 'repo_verification');

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
        student1RecordId
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
        student1RecordId
      );
      expect(record).toBeDefined();
      expect(record?.manifest.length).toBe(2);
      expect(record?.manifest[0].filePath).toBe('src/math.ts');
      expect(record?.manifest[0].blobSha).toBe(file1BlobSha);

      // Verify Audit Actor Identity: actor_id is the authenticated user (studentUser1.id), NOT student1RecordId
      const events = await auditRepo.getEventsForTenant({
        orgId: collegeAOrgId,
        userId: studentUser1.id,
        role: 'student',
      });
      const snapshotEvents = events.filter((e) => e.action === 'TRUSTED_SNAPSHOT_INGESTED');
      expect(snapshotEvents.length).toBe(2);
      for (const ev of snapshotEvents) {
        expect(ev.actorId).toBe(studentUser1.id);
        expect(ev.actorId).not.toBe(student1RecordId);
        expect((ev.metadata as any)?.studentId).toBe(student1RecordId);
      }
    });

    it('3.1b. Officer-initiated ingestion preserves officer actor identity while snapshot belongs to student', async () => {
      // Officer ingests repository for student1
      const ingestRes = await app.inject({
        method: 'POST',
        url: '/api/evidence/repositories/ingest',
        headers: {
          authorization: `Bearer ${officerToken}`,
          'x-org-id': collegeAOrgId,
        },
        payload: {
          owner: 'alice',
          repo: 'my-project',
          ref: 'main',
          studentId: student1RecordId,
        },
      });

      expect(ingestRes.statusCode).toBe(201);
      const resData = ingestRes.json();
      expect(resData.success).toBe(true);

      // Verify Audit Actor: actor_id is officerUser.id, NOT student1RecordId or studentUser1.id
      const events = await auditRepo.getEventsForTenant({
        orgId: collegeAOrgId,
        userId: officerUser.id,
        role: 'officer',
      });
      const officerEvents = events.filter((e) => e.action === 'TRUSTED_SNAPSHOT_INGESTED');
      expect(officerEvents.length).toBeGreaterThanOrEqual(2);
      const latestOfficerEvents = officerEvents.slice(-2);
      for (const ev of latestOfficerEvents) {
        expect(ev.actorId).toBe(officerUser.id);
        expect(ev.actorId).not.toBe(student1RecordId);
        expect((ev.metadata as any)?.studentId).toBe(student1RecordId);
      }
    });

    it('3.1c. StaticRepoIngestionService fails closed when repositoryRepo is not configured', async () => {
      const unbackedService = new StaticRepoIngestionService({
        githubClient: mockGitHubClient,
        githubAccountService,
        consentRepo,
        trustedIngestionStore,
        snapshotStore,
        anchorService,
        // repositoryRepo intentionally omitted
      });

      await expect(
        unbackedService.ingestRepository(
          { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
          { owner: 'alice', repo: 'my-project', ref: 'main', studentId: student1RecordId }
        )
      ).rejects.toThrow('REPOSITORY_REPOSITORY_REQUIRED: Cannot ingest repository without configured IRepositoryRepository.');
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
        snapshotStore.hasSnapshot('any', commitSha, 'src/math.ts', collegeAOrgId, student1RecordId)
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
        student1RecordId
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
        repositoryRepo,
        tenantRepo: new InMemoryTenantRepository(tenantStore),
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

    it('3.6. Private repository ingestion is rejected fail-closed with 400 PRIVATE_REPOSITORY_NOT_SUPPORTED', async () => {
      mockGitHubClient.seedRepoAccess('alice', 'my-private-repo', {
        accessible: true,
        repoId: 888888,
        isPrivate: true,
      });

      const privRes = await app.inject({
        method: 'POST',
        url: '/api/evidence/repositories/ingest',
        headers: {
          authorization: `Bearer ${student1Token}`,
          'x-org-id': collegeAOrgId,
        },
        payload: {
          owner: 'alice',
          repo: 'my-private-repo',
          ref: 'main',
        },
      });

      expect(privRes.statusCode).toBe(400);
      expect(privRes.json().error).toContain('PRIVATE_REPOSITORY_NOT_SUPPORTED');
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
      await consentRepo.grantConsent(ctx, student1RecordId, 'repo_verification');

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
        studentId: student1RecordId,
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
          studentId: student1RecordId,
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

    it('4.2. Exact duplicate re-ingestion is idempotent and returns same repositoryId', async () => {
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
      const firstRepoId = first.json().repositoryId;

      const second = await runIngest();
      expect(second.statusCode).toBe(201);
      expect(second.json().fileCount).toBe(1);
      expect(second.json().repositoryId).toBe(firstRepoId);
    });

    it('4.3. Cross-student repository ID substitution is rejected with 403 CROSS_STUDENT_REPOSITORY_FORBIDDEN', async () => {
      // Create repository belonging to student 2
      const ctxStudent2 = { orgId: collegeAOrgId, userId: studentUser2.id, role: 'student' as const };
      const student2Grant = await consentRepo.grantConsent(ctxStudent2, student2RecordId, 'repo_verification');
      const student2Repo = await repositoryRepo.getOrCreateRepository(ctxStudent2, {
        studentId: student2RecordId,
        providerRepoId: '999999999',
        url: 'https://github.com/bob/bob-repo',
        consentGrantId: student2Grant.id,
      });

      // Student 1 attempts to ingest using student 2's repository ID
      const crossRes = await app.inject({
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
          repositoryId: student2Repo.id,
        },
      });

      expect(crossRes.statusCode).toBe(403);
      expect(crossRes.json().error).toContain('CROSS_STUDENT_REPOSITORY_FORBIDDEN');
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
      await consentRepo.grantConsent(ctx, student1RecordId, 'repo_verification');

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

  // =========================================================================
  // 6. INGESTION LIMITS & RESOURCE BOUNDARIES
  // =========================================================================

  describe('6. Ingestion Limits & Resource Boundaries', () => {
    beforeEach(async () => {
      // Connect GitHub & grant consent for student1
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
      await consentRepo.grantConsent(ctx, student1RecordId, 'repo_verification');
    });

    it('6.1. Repository with 200 eligible files succeeds within the 200-file limit', async () => {
      const commitSha = '3333333333333333333333333333333333333333';
      const treeSha = '4444444444444444444444444444444444444444';
      mockGitHubClient.seedCommit('alice', 'repo-200-files', 'main', { sha: commitSha, treeSha });

      const entries: any[] = [];
      for (let i = 0; i < 200; i++) {
        const content = `// file ${i}\nexport const x${i} = ${i};`;
        const blobSha = computeGitBlobSha(Buffer.from(content, 'utf8'));
        mockGitHubClient.seedBlob(blobSha, content);
        entries.push({
          path: `src/file_${i}.ts`,
          mode: '100644',
          type: 'blob',
          sha: blobSha,
          size: Buffer.byteLength(content),
        });
      }
      mockGitHubClient.seedTree('alice', 'repo-200-files', treeSha, entries);

      const res = await app.inject({
        method: 'POST',
        url: '/api/evidence/repositories/ingest',
        headers: { authorization: `Bearer ${student1Token}`, 'x-org-id': collegeAOrgId },
        payload: { owner: 'alice', repo: 'repo-200-files', ref: 'main' },
      });

      expect(res.statusCode).toBe(201);
      const data = res.json();
      expect(data.fileCount).toBe(200);
      expect(data.registeredSnapshotsCount).toBe(200);

      // Verify job record
      const job = await ingestionJobRepo.getJob(
        { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
        data.ingestionId
      );
      expect(job?.status).toBe('completed');
      expect(job?.fileCount).toBe(200);
      expect(job?.studentId).toBe(student1RecordId);
    });

    it('6.2. Repository with 201 eligible files fails closed with FILE_COUNT_LIMIT_EXCEEDED', async () => {
      const commitSha = '5555555555555555555555555555555555555555';
      const treeSha = '6666666666666666666666666666666666666666';
      mockGitHubClient.seedCommit('alice', 'repo-201-files', 'main', { sha: commitSha, treeSha });

      const entries: any[] = [];
      for (let i = 0; i < 201; i++) {
        entries.push({
          path: `src/file_${i}.ts`,
          mode: '100644',
          type: 'blob',
          sha: `sha_${i}`,
          size: 100,
        });
      }
      mockGitHubClient.seedTree('alice', 'repo-201-files', treeSha, entries);

      const res = await app.inject({
        method: 'POST',
        url: '/api/evidence/repositories/ingest',
        headers: { authorization: `Bearer ${student1Token}`, 'x-org-id': collegeAOrgId },
        payload: { owner: 'alice', repo: 'repo-201-files', ref: 'main' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('FILE_COUNT_LIMIT_EXCEEDED');
      expect(res.json().error).toContain('exceeding limit of 200');
    });

    it('6.3. Oversized entry with declared size > 512 KB is rejected BEFORE blob download', async () => {
      const commitSha = '7777777777777777777777777777777777777777';
      const treeSha = '8888888888888888888888888888888888888888';
      mockGitHubClient.seedCommit('alice', 'repo-oversized-declared', 'main', { sha: commitSha, treeSha });

      const normalContent = 'export const valid = true;';
      const normalSha = computeGitBlobSha(Buffer.from(normalContent, 'utf8'));
      mockGitHubClient.seedBlob(normalSha, normalContent);

      const oversizedSha = '0123456789abcdef0123456789abcdef01234567';
      // DO NOT seed oversized blob into mock client: if getBlob is called, it would throw!

      mockGitHubClient.seedTree('alice', 'repo-oversized-declared', treeSha, [
        {
          path: 'src/valid.ts',
          mode: '100644',
          type: 'blob',
          sha: normalSha,
          size: 30,
        },
        {
          path: 'src/huge-bundle.js',
          mode: '100644',
          type: 'blob',
          sha: oversizedSha,
          size: 512 * 1024 + 1, // Exceeds 512 KB limit!
        },
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/api/evidence/repositories/ingest',
        headers: { authorization: `Bearer ${student1Token}`, 'x-org-id': collegeAOrgId },
        payload: { owner: 'alice', repo: 'repo-oversized-declared', ref: 'main' },
      });

      // Ingestion succeeds for valid file, oversized file was safely skipped before download
      expect(res.statusCode).toBe(201);
      const data = res.json();
      expect(data.fileCount).toBe(1);
      expect(data.diagnostics.excludedCount).toBe(1);
    });

    it('6.4. Oversized entry without declared size is rejected AFTER download and not persisted', async () => {
      const commitSha = '9999999999999999999999999999999999999999';
      const treeSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      mockGitHubClient.seedCommit('alice', 'repo-oversized-undeclared', 'main', { sha: commitSha, treeSha });

      // Create 513 KB content
      const bigContent = 'x'.repeat(512 * 1024 + 10);
      const bigSha = computeGitBlobSha(Buffer.from(bigContent, 'utf8'));
      mockGitHubClient.seedBlob(bigSha, bigContent);

      mockGitHubClient.seedTree('alice', 'repo-oversized-undeclared', treeSha, [
        {
          path: 'src/big.ts',
          mode: '100644',
          type: 'blob',
          sha: bigSha,
          // size omitted to test post-download check
        },
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/api/evidence/repositories/ingest',
        headers: { authorization: `Bearer ${student1Token}`, 'x-org-id': collegeAOrgId },
        payload: { owner: 'alice', repo: 'repo-oversized-undeclared', ref: 'main' },
      });

      expect(res.statusCode).toBe(201);
      const data = res.json();
      expect(data.fileCount).toBe(0);
      expect(data.diagnostics.excludedCount).toBe(1);
    });

    it('6.5. Aggregate repository size exceeding 10 MB fails with TOTAL_SIZE_LIMIT_EXCEEDED and marks job failed', async () => {
      // Create custom service with low aggregate limit for testing
      const customService = new StaticRepoIngestionService({
        githubClient: mockGitHubClient,
        githubAccountService,
        consentRepo,
        trustedIngestionStore,
        snapshotStore,
        anchorService,
        ingestionJobRepo,
        repositoryRepo,
        tenantRepo: new InMemoryTenantRepository(tenantStore),
        limits: {
          maxFiles: 200,
          maxFileSizeBytes: 512 * 1024,
          maxTotalBytes: 1024, // 1 KB limit to test boundary easily
        },
      });

      const customApp = buildApp({
        persistenceMode: 'in-memory',
        authService,
        userRepository: userRepo,
        tenantStore,
        consentRepository: consentRepo,
        auditRepository: auditRepo,
        snapshotStore,
        trustedIngestionStore,
        githubCredentialRepository: githubCredentialRepo,
        ingestionJobRepository: ingestionJobRepo,
        repositoryRepository: repositoryRepo,
        tokenCipher,
        githubClient: mockGitHubClient,
        githubAccountService,
        staticRepoIngestionService: customService,
        anchorService,
      });

      const commitSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
      const treeSha = 'cccccccccccccccccccccccccccccccccccccccc';
      mockGitHubClient.seedCommit('alice', 'repo-over-aggregate', 'main', { sha: commitSha, treeSha });

      // 2 files of 600 bytes = 1200 bytes > 1024 limit
      const content1 = 'a'.repeat(600);
      const sha1 = computeGitBlobSha(Buffer.from(content1, 'utf8'));
      mockGitHubClient.seedBlob(sha1, content1);

      const content2 = 'b'.repeat(600);
      const sha2 = computeGitBlobSha(Buffer.from(content2, 'utf8'));
      mockGitHubClient.seedBlob(sha2, content2);

      mockGitHubClient.seedTree('alice', 'repo-over-aggregate', treeSha, [
        { path: 'src/f1.ts', mode: '100644', type: 'blob', sha: sha1, size: 600 },
        { path: 'src/f2.ts', mode: '100644', type: 'blob', sha: sha2, size: 600 },
      ]);

      const res = await customApp.inject({
        method: 'POST',
        url: '/api/evidence/repositories/ingest',
        headers: { authorization: `Bearer ${student1Token}`, 'x-org-id': collegeAOrgId },
        payload: { owner: 'alice', repo: 'repo-over-aggregate', ref: 'main' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('TOTAL_SIZE_LIMIT_EXCEEDED');

      // Verify zero snapshots persisted
      const hasSnap1 = await snapshotStore.hasSnapshot(
        'alice/repo-over-aggregate',
        commitSha,
        'src/f1.ts',
        collegeAOrgId,
        student1RecordId
      );
      const hasSnap2 = await snapshotStore.hasSnapshot(
        'alice/repo-over-aggregate',
        commitSha,
        'src/f2.ts',
        collegeAOrgId,
        student1RecordId
      );
      expect(hasSnap1).toBe(false);
      expect(hasSnap2).toBe(false);
    });
  });

  // =========================================================================
  // 7. Upstream Provider Revocation & Resilient Credential Purge
  // =========================================================================
  describe('7. Upstream Provider Revocation & Resilient Credential Purge', () => {
    it('7.1. DefaultGitHubClient sends Basic auth with client credentials and returns success on 204 No Content', async () => {
      let capturedUrl = '';
      let capturedAuth = '';
      let capturedBody = '';

      const mockFetch: typeof fetch = async (input, init) => {
        capturedUrl = input.toString();
        capturedAuth = (init?.headers as any)?.['Authorization'] || '';
        capturedBody = init?.body?.toString() || '';
        return new Response(null, { status: 204 });
      };

      const client = new DefaultGitHubClient({
        fetchFn: mockFetch,
        apiBaseUrl: 'https://api.github.test',
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
      });

      const result = await client.revokeOAuthGrant('gho_secret_access_token_123');
      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(204);
      expect(capturedUrl).toBe('https://api.github.test/applications/test-client-id/grant');
      const expectedBasic = 'Basic ' + Buffer.from('test-client-id:test-client-secret').toString('base64');
      expect(capturedAuth).toBe(expectedBasic);
      expect(JSON.parse(capturedBody)).toEqual({ access_token: 'gho_secret_access_token_123' });
    });

    it('7.2. DefaultGitHubClient handles 404 or 422 provider errors safely without throwing', async () => {
      const mockFetch: typeof fetch = async () => {
        return new Response(JSON.stringify({ message: 'Token not found or already revoked' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const client = new DefaultGitHubClient({
        fetchFn: mockFetch,
        apiBaseUrl: 'https://api.github.test',
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
      });

      const result = await client.revokeOAuthGrant('gho_invalid_token');
      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(404);
      expect(result.error).toContain('Token not found');
    });

    it('7.3. DefaultGitHubClient handles network timeout / AbortError fail-closed', async () => {
      const mockFetch: typeof fetch = async () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      };

      const client = new DefaultGitHubClient({
        fetchFn: mockFetch,
        apiBaseUrl: 'https://api.github.test',
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
      });

      const result = await client.revokeOAuthGrant('gho_timeout_token');
      expect(result.success).toBe(false);
      expect(result.error).toBe('NETWORK_TIMEOUT');
    });

    it('7.4. DefaultGitHubClient returns failure when client credentials are missing', async () => {
      const client = new DefaultGitHubClient({ fetchFn: fetch, apiBaseUrl: 'https://api.github.test' });
      const result = await client.revokeOAuthGrant('gho_token');
      expect(result.success).toBe(false);
      expect(result.error).toContain('MISSING_CLIENT_CREDENTIALS');
    });

    it('7.5. DefaultGitHubClient zero plaintext token leakage in results', async () => {
      const secretToken = 'gho_very_confidential_token_99999';
      const mockFetch: typeof fetch = async () => {
        return new Response(JSON.stringify({ message: 'Revocation failed' }), { status: 500 });
      };

      const client = new DefaultGitHubClient({
        fetchFn: mockFetch,
        apiBaseUrl: 'https://api.github.test',
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
      });

      const result = await client.revokeOAuthGrant(secretToken);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(secretToken);
    });

    it('7.6. GitHubAccountService.revokeUpstreamGrantAndUnlink purges local credentials even when upstream revocation fails', async () => {
      const sessionCtx1 = { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' as const };
      // Connect account first
      const encrypted = await tokenCipher.encrypt('gho_failing_upstream_token');
      await githubCredentialRepo.saveConnectedAccount(
        sessionCtx1,
        student1RecordId,
        collegeAOrgId,
        {
          githubUserId: '12345',
          githubUsername: 'alice-github',
          encryptedAccessToken: encrypted.serialized,
          keyVersion: tokenCipher.getKeyVersion(),
          scopes: ['read:user', 'public_repo'],
        }
      );

      // Verify connected
      const existing = await githubCredentialRepo.getConnectedAccount(
        sessionCtx1,
        student1RecordId,
        collegeAOrgId
      );
      expect(existing).not.toBeNull();

      // Configure mock client to simulate upstream failure
      mockGitHubClient.mockRevokeBehavior = async () => ({
        success: false,
        statusCode: 502,
        error: 'HTTP_502: Bad Gateway',
      });

      const res = await githubAccountService.revokeUpstreamGrantAndUnlink(
        sessionCtx1,
        student1RecordId
      );

      // Local token must be purged fail-closed
      expect(res.localTokenPurged).toBe(true);
      expect(res.providerRevocationStatus).toBe('failed');

      // Verify credential repo has revoked status and purged encrypted token
      const postAccount = await githubCredentialRepo.getConnectedAccount(
        sessionCtx1,
        student1RecordId,
        collegeAOrgId
      );
      expect(postAccount?.status).toBe('revoked');
      expect(postAccount?.encryptedAccessToken).toBeUndefined();
    });

    it('7.7. /api/consent/revoke route triggers upstream provider revocation, local token purge, and job cancellation', async () => {
      // 1. Grant consent
      const consentRes = await app.inject({
        method: 'POST',
        url: '/api/consent/grant',
        headers: { authorization: `Bearer ${student1Token}`, 'x-org-id': collegeAOrgId },
        payload: { studentId: student1RecordId, purpose: 'repo_verification', noticeVersion: 1 },
      });
      expect(consentRes.statusCode).toBe(201);
      const grantId = consentRes.json().id;

      // 2. Connect account
      const enc = await tokenCipher.encrypt('gho_student1_token');
      await githubCredentialRepo.saveConnectedAccount(
        { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
        student1RecordId,
        collegeAOrgId,
        {
          githubUserId: '54321',
          githubUsername: 'alice-student1',
          encryptedAccessToken: enc.serialized,
          keyVersion: tokenCipher.getKeyVersion(),
          scopes: ['read:user', 'public_repo'],
        }
      );

      // 3. Create an in-flight job for student1
      const inFlightJobId = 'aaaaaaaa-0000-0000-0000-000000000001';
      await ingestionJobRepo.createJob({
        ingestionId: inFlightJobId,
        orgId: collegeAOrgId,
        studentId: student1RecordId,
        repositoryId: '90000000-0000-0000-0000-000000000001',
        owner: 'alice',
        repo: 'test-in-flight',
        ref: 'main',
        status: 'queued',
        fileCount: 3,
        retainedBytes: 500,
        registeredSnapshotsCount: 0,
        createdAt: new Date().toISOString(),
      });
      await ingestionJobRepo.updateJob({ orgId: collegeAOrgId, userId: 'u1', role: 'student' }, inFlightJobId, 'resolving');
      await ingestionJobRepo.updateJob({ orgId: collegeAOrgId, userId: 'u1', role: 'student' }, inFlightJobId, 'fetching');

      // 4. Revoke consent
      mockGitHubClient.mockRevokeBehavior = async () => ({
        success: true,
        statusCode: 204,
      });

      const revokeRes = await app.inject({
        method: 'POST',
        url: '/api/consent/revoke',
        headers: { authorization: `Bearer ${student1Token}`, 'x-org-id': collegeAOrgId },
        payload: { grantId, reason: 'Revoking for test' },
      });

      expect(revokeRes.statusCode).toBe(200);
      const revData = revokeRes.json();
      expect(revData.success).toBe(true);
      expect(revData.localTokenPurged).toBe(true);
      expect(revData.providerRevocationStatus).toBe('confirmed');

      // 5. In-flight job must be failed with CONSENT_REVOKED
      const updatedJob = await ingestionJobRepo.getJob(
        { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
        inFlightJobId
      );
      expect(updatedJob?.status).toBe('failed');
      expect(updatedJob?.error).toBe('CONSENT_REVOKED');
      expect(updatedJob?.diagnostics?.revocation_reason).toBe('CONSENT_REVOKED');

      // 6. Connected account tokens must be purged and marked revoked
      const acc = await githubCredentialRepo.getConnectedAccount(
        { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' },
        student1RecordId,
        collegeAOrgId
      );
      expect(acc?.status).toBe('revoked');
      expect(acc?.encryptedAccessToken).toBeUndefined();
    });
  });

  // =========================================================================
  // 8. Bounded Tree Traversal & Rate-Limit Handling
  // =========================================================================
  describe('8. Bounded Tree Traversal & Rate-Limit Handling', () => {
    beforeEach(async () => {
      mockGitHubClient.seedRepoAccess('alice', 'huge-tree-repo', { accessible: true, isPrivate: false });
      mockGitHubClient.seedRepoAccess('alice', 'deep-tree-repo', { accessible: true, isPrivate: false });
      mockGitHubClient.seedRepoAccess('alice', 'many-files-repo', { accessible: true, isPrivate: false });
      const enc = await tokenCipher.encrypt('gho_student1_token');
      const ctx = { orgId: collegeAOrgId, userId: studentUser1.id, role: 'student' as const };
      await githubCredentialRepo.saveConnectedAccount(ctx, student1RecordId, collegeAOrgId, {
        githubUserId: '1001',
        githubUsername: 'alice',
        encryptedAccessToken: enc.serialized,
        keyVersion: tokenCipher.getKeyVersion(),
        scopes: ['read:user', 'public_repo'],
      });
      await consentRepo.grantConsent(ctx, student1RecordId, 'repo_verification');
    });

    it('8.1. Huge tree exceeding maxTreeEntries terminates with TREE_ENTRY_BUDGET_EXCEEDED and fails job', async () => {
      // Create service with low maxTreeEntries limit
      const customService = new StaticRepoIngestionService({
        githubClient: mockGitHubClient,
        githubAccountService,
        consentRepo,
        trustedIngestionStore,
        snapshotStore,
        anchorService,
        ingestionJobRepo,
        repositoryRepo,
        tenantRepo: new InMemoryTenantRepository(tenantStore),
        limits: {
          maxFiles: 200,
          maxFileSizeBytes: 512 * 1024,
          maxTotalBytes: 10 * 1024 * 1024,
          maxTreeEntries: 5, // Budget of 5 entries
        },
      });

      const customApp = buildApp({
        persistenceMode: 'in-memory',
        authService,
        userRepository: userRepo,
        tenantStore,
        consentRepository: consentRepo,
        auditRepository: auditRepo,
        snapshotStore,
        trustedIngestionStore,
        githubCredentialRepository: githubCredentialRepo,
        ingestionJobRepository: ingestionJobRepo,
        repositoryRepository: repositoryRepo,
        tokenCipher,
        githubClient: mockGitHubClient,
        githubAccountService,
        staticRepoIngestionService: customService,
        anchorService,
      });

      const commitSha = '3333333333333333333333333333333333333333';
      const treeSha = '4444444444444444444444444444444444444444';
      mockGitHubClient.seedCommit('alice', 'huge-tree-repo', 'main', { sha: commitSha, treeSha });

      // Seed 6 entries (> 5 budget)
      const treeEntries = Array.from({ length: 6 }, (_, i) => ({
        path: `src/file_${i}.ts`,
        mode: '100644',
        type: 'blob' as const,
        sha: `sha_${i}`,
        size: 50,
      }));
      mockGitHubClient.seedTree('alice', 'huge-tree-repo', treeSha, treeEntries);

      const res = await customApp.inject({
        method: 'POST',
        url: '/api/evidence/repositories/ingest',
        headers: { authorization: `Bearer ${student1Token}`, 'x-org-id': collegeAOrgId },
        payload: { owner: 'alice', repo: 'huge-tree-repo', ref: 'main' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('TREE_ENTRY_BUDGET_EXCEEDED');

      // Verify no snapshots persisted
      const hasSnap = await snapshotStore.hasSnapshot('alice/huge-tree-repo', commitSha, 'src/file_0.ts', collegeAOrgId, student1RecordId);
      expect(hasSnap).toBe(false);
    });

    it('8.2. Excessive sub-tree API requests terminates with TREE_API_BUDGET_EXCEEDED', async () => {
      const customService = new StaticRepoIngestionService({
        githubClient: mockGitHubClient,
        githubAccountService,
        consentRepo,
        trustedIngestionStore,
        snapshotStore,
        anchorService,
        ingestionJobRepo,
        repositoryRepo,
        tenantRepo: new InMemoryTenantRepository(tenantStore),
        limits: {
          maxFiles: 200,
          maxFileSizeBytes: 512 * 1024,
          maxTotalBytes: 10 * 1024 * 1024,
          maxTreeEntries: 5000,
          maxTreeApiRequests: 1, // Only 1 sub-tree request allowed
        },
      });

      const customApp = buildApp({
        persistenceMode: 'in-memory',
        authService,
        userRepository: userRepo,
        tenantStore,
        consentRepository: consentRepo,
        auditRepository: auditRepo,
        snapshotStore,
        trustedIngestionStore,
        githubCredentialRepository: githubCredentialRepo,
        ingestionJobRepository: ingestionJobRepo,
        repositoryRepository: repositoryRepo,
        tokenCipher,
        githubClient: mockGitHubClient,
        githubAccountService,
        staticRepoIngestionService: customService,
        anchorService,
      });

      const commitSha = '5555555555555555555555555555555555555555';
      const rootTreeSha = '6666666666666666666666666666666666666666';
      const subTreeSha1 = '7777777777777777777777777777777777777771';
      const subTreeSha2 = '7777777777777777777777777777777777777772';

      mockGitHubClient.seedCommit('alice', 'deep-tree-repo', 'main', { sha: commitSha, treeSha: rootTreeSha });

      // Root tree contains 2 tree subdirectories and is truncated to force iterative directory traversal
      mockGitHubClient.seedTree('alice', 'deep-tree-repo', rootTreeSha, [
        { path: 'dir1', mode: '040000', type: 'tree', sha: subTreeSha1 },
        { path: 'dir2', mode: '040000', type: 'tree', sha: subTreeSha2 },
      ], true);
      mockGitHubClient.seedTree('alice', 'deep-tree-repo', subTreeSha1, [
        { path: 'f1.ts', mode: '100644', type: 'blob', sha: 'sha1', size: 50 },
      ]);
      mockGitHubClient.seedTree('alice', 'deep-tree-repo', subTreeSha2, [
        { path: 'f2.ts', mode: '100644', type: 'blob', sha: 'sha2', size: 50 },
      ]);

      const res = await customApp.inject({
        method: 'POST',
        url: '/api/evidence/repositories/ingest',
        headers: { authorization: `Bearer ${student1Token}`, 'x-org-id': collegeAOrgId },
        payload: { owner: 'alice', repo: 'deep-tree-repo', ref: 'main' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('TREE_API_BUDGET_EXCEEDED');
    });

    it('8.3. Exceeding eligible file count stops traversal early with FILE_COUNT_LIMIT_EXCEEDED', async () => {
      const customService = new StaticRepoIngestionService({
        githubClient: mockGitHubClient,
        githubAccountService,
        consentRepo,
        trustedIngestionStore,
        snapshotStore,
        anchorService,
        ingestionJobRepo,
        repositoryRepo,
        tenantRepo: new InMemoryTenantRepository(tenantStore),
        limits: {
          maxFiles: 2, // Limit to 2 eligible files
          maxFileSizeBytes: 512 * 1024,
          maxTotalBytes: 10 * 1024 * 1024,
        },
      });

      const customApp = buildApp({
        persistenceMode: 'in-memory',
        authService,
        userRepository: userRepo,
        tenantStore,
        consentRepository: consentRepo,
        auditRepository: auditRepo,
        snapshotStore,
        trustedIngestionStore,
        githubCredentialRepository: githubCredentialRepo,
        ingestionJobRepository: ingestionJobRepo,
        repositoryRepository: repositoryRepo,
        tokenCipher,
        githubClient: mockGitHubClient,
        githubAccountService,
        staticRepoIngestionService: customService,
        anchorService,
      });

      const commitSha = '8888888888888888888888888888888888888888';
      const treeSha = '9999999999999999999999999999999999999999';
      mockGitHubClient.seedCommit('alice', 'many-files-repo', 'main', { sha: commitSha, treeSha });

      // Seed 3 eligible TypeScript files (> maxFiles of 2)
      mockGitHubClient.seedTree('alice', 'many-files-repo', treeSha, [
        { path: 'src/a.ts', mode: '100644', type: 'blob', sha: 'sha_a', size: 10 },
        { path: 'src/b.ts', mode: '100644', type: 'blob', sha: 'sha_b', size: 10 },
        { path: 'src/c.ts', mode: '100644', type: 'blob', sha: 'sha_c', size: 10 },
      ]);

      const res = await customApp.inject({
        method: 'POST',
        url: '/api/evidence/repositories/ingest',
        headers: { authorization: `Bearer ${student1Token}`, 'x-org-id': collegeAOrgId },
        payload: { owner: 'alice', repo: 'many-files-repo', ref: 'main' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('FILE_COUNT_LIMIT_EXCEEDED');
    });

    it('8.4. Rate-limit detection fail-closed throws GITHUB_RATE_LIMIT_EXCEEDED', async () => {
      const rateLimitedFetch: typeof fetch = async (url) => {
        // First call is repo lookup, let it succeed
        if (url.toString().includes('/repos/bob/rate-limited-repo') && !url.toString().includes('/commits/')) {
          return new Response(JSON.stringify({ id: 99999, default_branch: 'main', private: false }), { status: 200 });
        }
        // Commit lookup hits rate limit
        return new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
          status: 403,
          headers: {
            'x-ratelimit-remaining': '0',
            'retry-after': '60',
          },
        });
      };

      const realClient = new DefaultGitHubClient({
        fetchFn: rateLimitedFetch,
        apiBaseUrl: 'https://api.github.test',
      });
      let thrown = false;
      try {
        await realClient.resolveCommit('tok', 'bob', 'rate-limited-repo', 'main');
      } catch (err: any) {
        thrown = true;
        expect(err.message).toContain('GITHUB_RATE_LIMIT_EXCEEDED');
      }
      expect(thrown).toBe(true);
    });
  });
});
