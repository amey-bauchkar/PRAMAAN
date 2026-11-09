import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import crypto, { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  PgSourceSnapshotStore,
} from '../../apps/api/src/repositories/pg-source-snapshot-store.js';
import {
  PgTrustedIngestionStore,
} from '../../apps/api/src/repositories/pg-trusted-ingestion-store.js';
import {
  PgGitHubCredentialRepository,
} from '../../apps/api/src/repositories/github-credential-repository.js';
import {
  PgIngestionJobRepository,
} from '../../apps/api/src/repositories/ingestion-job-repository.js';
import {
  PgRepositoryRepository,
} from '../../apps/api/src/repositories/repository-repository.js';
import {
  PgTenantRepository,
} from '../../apps/api/src/repositories/tenant-repository.js';
import {
  PgConsentRepository,
} from '../../apps/api/src/repositories/consent-repository.js';
import {
  SourceSnapshot,
  TrustedIngestionRecord,
  SessionContext,
} from '@pramaan/contracts';
import {
  computeGitBlobSha,
  computeRawFileHash,
} from '@pramaan/domain';
// @ts-ignore
import { resolveAdminSslConfig } from '../../scripts/admin-db-ssl.mjs';
// @ts-ignore
import { runMigrations, HISTORICAL_MIGRATION_CHECKSUMS, computeChecksum } from '../../scripts/migrate-supabase.mjs';
// @ts-ignore
import { assertSafeTestEnvironment, assertNotInstitutionalTenant } from '../../scripts/supabase-runner.mjs';

try {
  process.loadEnvFile?.();
} catch { }

function createLatch() {
  let resolve!: () => void;
  let reject!: (err: any) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const adminUrl = process.env.DATABASE_URL_ADMIN;
const isOptedIn = process.env.ALLOW_DESTRUCTIVE_DB_TESTS === 'true';

describe('P0-04: PostgreSQL Durable Repositories & RLS Security Invariants', () => {
  if (!adminUrl || !isOptedIn) {
    it.skip('Skipping PostgreSQL durable repositories test (requires DATABASE_URL_ADMIN and ALLOW_DESTRUCTIVE_DB_TESTS=true)', () => { });
    return;
  }

  const ssl = resolveAdminSslConfig(adminUrl);
  let pool: pg.Pool;

  // Dedicated deterministic non-institutional test fixture UUIDs
  const COLLEGE_A = 'd1000000-0000-0000-0000-000000000001';
  const COLLEGE_B = 'd1000000-0000-0000-0000-000000000002';
  const USER_A = 'd2000000-0000-0000-0000-000000000001';
  const USER_B = 'd2000000-0000-0000-0000-000000000002';
  const DEPT_A = 'd3000000-0000-0000-0000-000000000001';
  const DEPT_B = 'd3000000-0000-0000-0000-000000000002';
  const STUDENT_A = 'd4000000-0000-0000-0000-000000000001';
  const STUDENT_B = 'd4000000-0000-0000-0000-000000000002';
  const CONSENT_A = 'd5000000-0000-0000-0000-000000000001';
  const CONSENT_B = 'd5000000-0000-0000-0000-000000000002';
  const REPO_A = 'd6000000-0000-0000-0000-000000000001';
  const REPO_B = 'd6000000-0000-0000-0000-000000000002';

  let snapshotStore: PgSourceSnapshotStore;
  let trustedIngestionStore: PgTrustedIngestionStore;
  let credentialRepo: PgGitHubCredentialRepository;
  let jobRepo: PgIngestionJobRepository;
  let repoRepository: PgRepositoryRepository;
  let tenantRepo: PgTenantRepository;
  let consentRepo: PgConsentRepository;

  const cleanupFixtures = async () => {
    const client = await pool.connect();
    try {
      await client.query(`
        DELETE FROM skill_evidence WHERE student_skill_id IN (SELECT id FROM student_skills WHERE student_id IN ('${STUDENT_A}', '${STUDENT_B}'));
        DELETE FROM student_skills WHERE student_id IN ('${STUDENT_A}', '${STUDENT_B}');
        DELETE FROM evidence_items WHERE student_id IN ('${STUDENT_A}', '${STUDENT_B}');
        DELETE FROM repo_snapshots WHERE repository_id IN (SELECT id FROM repositories WHERE student_id IN ('${STUDENT_A}', '${STUDENT_B}') OR id IN ('${REPO_A}', '${REPO_B}'));
        DELETE FROM source_snapshots WHERE org_id IN ('${COLLEGE_A}', '${COLLEGE_B}');
        DELETE FROM trusted_ingestion_records WHERE org_id IN ('${COLLEGE_A}', '${COLLEGE_B}');
        DELETE FROM ingestion_jobs WHERE org_id IN ('${COLLEGE_A}', '${COLLEGE_B}');
        DELETE FROM github_oauth_states WHERE org_id IN ('${COLLEGE_A}', '${COLLEGE_B}');
        DELETE FROM connected_accounts WHERE student_id IN ('${STUDENT_A}', '${STUDENT_B}');
        DELETE FROM repositories WHERE student_id IN ('${STUDENT_A}', '${STUDENT_B}') OR id IN ('${REPO_A}', '${REPO_B}');
        DELETE FROM consent_grants WHERE student_id IN ('${STUDENT_A}', '${STUDENT_B}') OR id IN ('${CONSENT_A}', '${CONSENT_B}');
        DELETE FROM students WHERE id IN ('${STUDENT_A}', '${STUDENT_B}');
        DELETE FROM departments WHERE id IN ('${DEPT_A}', '${DEPT_B}');
        DELETE FROM users WHERE id IN ('${USER_A}', '${USER_B}');
        DELETE FROM organizations WHERE id IN ('${COLLEGE_A}', '${COLLEGE_B}');
      `);
    } finally {
      client.release();
    }
  };

  beforeAll(async () => {
    assertSafeTestEnvironment('P0-04 Durable Repositories Test');
    assertNotInstitutionalTenant(COLLEGE_A, 'P0-04 Fixture Setup');
    assertNotInstitutionalTenant(COLLEGE_B, 'P0-04 Fixture Setup');

    pool = new pg.Pool({ connectionString: adminUrl, ssl, max: 3 });
    snapshotStore = new PgSourceSnapshotStore(pool);
    trustedIngestionStore = new PgTrustedIngestionStore(pool);
    credentialRepo = new PgGitHubCredentialRepository(pool);
    jobRepo = new PgIngestionJobRepository(pool);
    repoRepository = new PgRepositoryRepository(pool);
    tenantRepo = new PgTenantRepository(pool);
    consentRepo = new PgConsentRepository(pool);

    // Apply migrations 011a, 012, 013, 014 if not already present
    const migrationClient = await pool.connect();
    try {
      for (const mig of [
        '011a_safe_repository_preflight.sql',
        '012_canonical_repository_unique_constraint.sql',
        '013_active_consent_uniqueness.sql',
        '014_safe_repository_reconciliation.sql',
      ]) {
        const migrationPath = path.resolve(process.cwd(), 'db/migrations', mig);
        if (fs.existsSync(migrationPath)) {
          const migrationSql = fs.readFileSync(migrationPath, 'utf8');
          await migrationClient.query(migrationSql);
        }
      }
    } finally {
      migrationClient.release();
    }

    // Initial cleanup
    await cleanupFixtures();

    // Deterministic seeding
    const client = await pool.connect();
    try {
      await client.query(`
        INSERT INTO organizations (id, name, kind) VALUES
          ('${COLLEGE_A}', 'P04 Test College A', 'college'),
          ('${COLLEGE_B}', 'P04 Test College B', 'college');

        INSERT INTO users (id, auth_subject, email, full_name) VALUES
          ('${USER_A}', 'auth_p04_student_a', 'student.a@p04-test.edu', 'P04 Student A'),
          ('${USER_B}', 'auth_p04_student_b', 'student.b@p04-test.edu', 'P04 Student B');

        INSERT INTO departments (id, org_id, name, code) VALUES
          ('${DEPT_A}', '${COLLEGE_A}', 'P04 Dept A', 'P04_A'),
          ('${DEPT_B}', '${COLLEGE_B}', 'P04 Dept B', 'P04_B');

        INSERT INTO students (id, org_id, user_id, department_id, enrollment_no, graduating_year) VALUES
          ('${STUDENT_A}', '${COLLEGE_A}', '${USER_A}', '${DEPT_A}', 'P04-A-001', 2026),
          ('${STUDENT_B}', '${COLLEGE_B}', '${USER_B}', '${DEPT_B}', 'P04-B-001', 2026);

        INSERT INTO consent_grants (id, student_id, purpose, notice_version) VALUES
          ('${CONSENT_A}', '${STUDENT_A}', 'repo_verification', 1),
          ('${CONSENT_B}', '${STUDENT_B}', 'repo_verification', 1);

        INSERT INTO repositories (id, student_id, provider, provider_repo_id, url, default_branch, consent_grant_id) VALUES
          ('${REPO_A}', '${STUDENT_A}', 'github', 'gh_repo_a', 'https://github.com/org/repo-a', 'main', '${CONSENT_A}'),
          ('${REPO_B}', '${STUDENT_B}', 'github', 'gh_repo_b', 'https://github.com/org/repo-b', 'main', '${CONSENT_B}');
      `);
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    if (pool) {
      await cleanupFixtures();
      await pool.end();
    }
  });

  // =========================================================================
  // 1. PgGitHubCredentialRepository Tests
  // =========================================================================

  describe('1. PgGitHubCredentialRepository (OAuth states and credentials)', () => {
    it('1.1. Saves single-use OAuth state, consumes it once under tenant context, and rejects replay', async () => {
      const state = crypto.randomBytes(32).toString('hex');
      const verifier = crypto.randomBytes(32).toString('base64url');
      const ctxA: SessionContext = {
        orgId: COLLEGE_A,
        userId: USER_A,
        role: 'student',
      };

      await credentialRepo.saveOAuthState(
        state,
        verifier,
        STUDENT_A,
        COLLEGE_A,
        'https://app.pramaan.edu/callback',
        600
      );

      // First consumption succeeds for correct tenant
      const consumed = await credentialRepo.consumeOAuthState(ctxA, state);
      expect(consumed).not.toBeNull();
      expect(consumed?.studentId).toBe(STUDENT_A);
      expect(consumed?.orgId).toBe(COLLEGE_A);
      expect(consumed?.codeVerifier).toBe(verifier);

      // Second consumption fails (already consumed - single use)
      const replayed = await credentialRepo.consumeOAuthState(ctxA, state);
      expect(replayed).toBeNull();
    });

    it('1.2. Cross-tenant state consumption is strictly rejected via PostgreSQL RLS', async () => {
      const state = crypto.randomBytes(32).toString('hex');
      const verifier = crypto.randomBytes(32).toString('base64url');
      const ctxB: SessionContext = {
        orgId: COLLEGE_B,
        userId: USER_B,
        role: 'student',
      };

      // State created for COLLEGE_A
      await credentialRepo.saveOAuthState(
        state,
        verifier,
        STUDENT_A,
        COLLEGE_A,
        'https://app.pramaan.edu/callback',
        600
      );

      // COLLEGE_B attempts to consume COLLEGE_A state -> RLS renders it completely invisible (null)
      const crossConsumed = await credentialRepo.consumeOAuthState(ctxB, state);
      expect(crossConsumed).toBeNull();

      // State remains unconsumed for COLLEGE_A
      const ctxA: SessionContext = {
        orgId: COLLEGE_A,
        userId: USER_A,
        role: 'student',
      };
      const validConsumed = await credentialRepo.consumeOAuthState(ctxA, state);
      expect(validConsumed).not.toBeNull();
      expect(validConsumed?.studentId).toBe(STUDENT_A);
    });

    it('1.3. Expired OAuth state is rejected fail-closed', async () => {
      const state = crypto.randomBytes(32).toString('hex');
      const verifier = crypto.randomBytes(32).toString('base64url');
      const ctxA: SessionContext = {
        orgId: COLLEGE_A,
        userId: USER_A,
        role: 'student',
      };

      // Save state with -10 second expiry (already expired)
      await credentialRepo.saveOAuthState(
        state,
        verifier,
        STUDENT_A,
        COLLEGE_A,
        'https://app.pramaan.edu/callback',
        -10
      );

      const expiredConsumed = await credentialRepo.consumeOAuthState(ctxA, state);
      expect(expiredConsumed).toBeNull();
    });

    it('1.4. Saves encrypted connected account, retrieves it, and revokes it cleanly', async () => {
      const ctx: SessionContext = {
        orgId: COLLEGE_A,
        userId: USER_A,
        role: 'student',
      };

      await credentialRepo.saveConnectedAccount(ctx, STUDENT_A, COLLEGE_A, {
        githubUserId: 'gh-user-999',
        githubUsername: 'aarav-github',
        encryptedAccessToken: 'v1:mock-iv:mock-tag:mock-ciphertext',
        keyVersion: 'v1',
        scopes: ['repo:read'],
      });

      const acc = await credentialRepo.getConnectedAccount(ctx, STUDENT_A, COLLEGE_A);
      expect(acc).not.toBeNull();
      expect(acc?.githubUsername).toBe('aarav-github');
      expect(acc?.status).toBe('active');
      expect(acc?.encryptedAccessToken).toBe('v1:mock-iv:mock-tag:mock-ciphertext');

      // Revoke
      const revoked = await credentialRepo.revokeConnectedAccount(ctx, STUDENT_A, COLLEGE_A);
      expect(revoked).toBe(true);

      const postRevoke = await credentialRepo.getConnectedAccount(ctx, STUDENT_A, COLLEGE_A);
      expect(postRevoke?.status).toBe('revoked');
      expect(postRevoke?.encryptedAccessToken).toBeUndefined();
    });
  });

  // =========================================================================
  // 2. PgTrustedIngestionStore Tests
  // =========================================================================

  describe('2. PgTrustedIngestionStore (Write-once trusted manifests)', () => {
    const commitSha = 'fa7a000000000000000000000000000000000001';
    const treeSha = 'bee7000000000000000000000000000000000002';
    const ingestionId = randomUUID();

    const sampleContent = 'export const testPg = () => 42;\n';
    const sampleBytes = Buffer.from(sampleContent, 'utf8');
    const blobSha = computeGitBlobSha(sampleBytes);
    const rawHash = computeRawFileHash(sampleBytes);

    it('2.1. Saves and retrieves trusted ingestion record with manifest binding', async () => {
      const record: TrustedIngestionRecord = {
        ingestionId,
        orgId: COLLEGE_A,
        studentId: STUDENT_A,
        repositoryId: REPO_A,
        commitSha,
        treeSha,
        verifiedAt: new Date().toISOString(),
        provenance: 'trusted_ingestion_pipeline',
        manifest: [
          {
            filePath: 'src/index.ts',
            blobSha,
            rawFileHash: rawHash,
            byteSize: sampleBytes.length,
          },
        ],
      };

      await trustedIngestionStore.saveRecord(record);

      const retrieved = await trustedIngestionStore.getRecord(
        COLLEGE_A,
        REPO_A,
        commitSha,
        STUDENT_A
      );
      expect(retrieved).toBeDefined();
      expect(retrieved?.ingestionId).toBe(ingestionId);
      expect(retrieved?.manifest.length).toBe(1);
      expect(retrieved?.manifest[0].filePath).toBe('src/index.ts');
      expect(retrieved?.manifest[0].blobSha).toBe(blobSha);

      // Cross-tenant query returns undefined
      const crossTenant = await trustedIngestionStore.getRecord(
        COLLEGE_B,
        REPO_A,
        commitSha,
        STUDENT_B
      );
      expect(crossTenant).toBeUndefined();

      // Verify manifest binding helper
      const bindingRes = await trustedIngestionStore.verifyFileManifest(
        COLLEGE_A,
        REPO_A,
        commitSha,
        STUDENT_A,
        'src/index.ts',
        blobSha,
        rawHash
      );
      expect(bindingRes.valid).toBe(true);
      expect(bindingRes.entry?.blobSha).toBe(blobSha);
    });

    it('2.2. Re-saving exact same record is idempotent', async () => {
      const record: TrustedIngestionRecord = {
        ingestionId,
        orgId: COLLEGE_A,
        studentId: STUDENT_A,
        repositoryId: REPO_A,
        commitSha,
        treeSha,
        verifiedAt: new Date().toISOString(),
        provenance: 'trusted_ingestion_pipeline',
        manifest: [
          {
            filePath: 'src/index.ts',
            blobSha,
            rawFileHash: rawHash,
            byteSize: sampleBytes.length,
          },
        ],
      };

      // Does not throw duplicate key error
      await expect(trustedIngestionStore.saveRecord(record)).resolves.not.toThrow();
    });

    it('2.3. Divergent record for same commit/student/repo is rejected as immutable', async () => {
      const divergentRecord: TrustedIngestionRecord = {
        ingestionId: randomUUID(), // Different ingestionId
        orgId: COLLEGE_A,
        studentId: STUDENT_A,
        repositoryId: REPO_A,
        commitSha,
        treeSha: '9999000000000000000000000000000000000000', // Divergent treeSha!
        verifiedAt: new Date().toISOString(),
        provenance: 'trusted_ingestion_pipeline',
        manifest: [],
      };

      await expect(trustedIngestionStore.saveRecord(divergentRecord)).rejects.toThrow(
        /IMMUTABLE_INGESTION_RECORD_MUTATION_REJECTED/
      );
    });
  });

  // =========================================================================
  // 3. PgSourceSnapshotStore Tests
  // =========================================================================

  describe('3. PgSourceSnapshotStore (Durable snapshots & immutability)', () => {
    const commitSha = 'fa7a000000000000000000000000000000000001';
    const filePath = 'src/index.ts';
    const snapshotId = randomUUID();

    const sampleContent = 'export const testPg = () => 42;\n';
    const sampleBytes = Buffer.from(sampleContent, 'utf8');
    const blobSha = computeGitBlobSha(sampleBytes);
    const rawFileHash = computeRawFileHash(sampleBytes);

    it('3.1. Saves snapshot with hash check, retrieves it scoped to student, and updates state', async () => {
      const snapshot: SourceSnapshot = {
        snapshotId,
        orgId: COLLEGE_A,
        studentId: STUDENT_A,
        repositoryId: REPO_A,
        commitSha,
        filePath,
        blobSha,
        rawBytes: sampleBytes,
        rawFileHash,
        capturedAt: new Date().toISOString(),
        provenance: 'trusted_ingestion_pipeline',
        ingestionId: randomUUID(),
        registrationState: 'pending_audit',
      };

      await snapshotStore.saveSnapshot(snapshot);

      // Retrieve snapshot
      const retrieved = await snapshotStore.getSnapshot(
        REPO_A,
        commitSha,
        filePath,
        COLLEGE_A,
        STUDENT_A
      );
      expect(retrieved).toBeDefined();
      expect(retrieved?.snapshotId).toBe(snapshotId);
      expect(retrieved?.rawFileHash).toBe(rawFileHash);
      expect(retrieved?.registrationState).toBe('pending_audit');

      // Promote registration state to audit_committed
      const updated = await snapshotStore.updateRegistrationState(
        REPO_A,
        commitSha,
        filePath,
        COLLEGE_A,
        STUDENT_A,
        snapshotId,
        'audit_committed'
      );
      expect(updated).toBe(true);

      const afterUpdate = await snapshotStore.getSnapshot(
        REPO_A,
        commitSha,
        filePath,
        COLLEGE_A,
        STUDENT_A
      );
      expect(afterUpdate?.registrationState).toBe('audit_committed');
    });

    it('3.2. Cross-tenant and cross-student lookup returns undefined', async () => {
      // Query for Student B in College B
      const cross = await snapshotStore.getSnapshot(
        REPO_A,
        commitSha,
        filePath,
        COLLEGE_B,
        STUDENT_B
      );
      expect(cross).toBeUndefined();
    });

    it('3.3. Snapshot save with corrupted rawFileHash is rejected before storage', async () => {
      const corruptedSnapshot: SourceSnapshot = {
        snapshotId: randomUUID(),
        orgId: COLLEGE_A,
        studentId: STUDENT_A,
        repositoryId: REPO_A,
        commitSha: '9999999999999999999999999999999999999999',
        filePath: 'src/bad.ts',
        rawBytes: Buffer.from('console.log(1)', 'utf8'),
        rawFileHash: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', // Corrupted!
        capturedAt: new Date().toISOString(),
      };

      await expect(snapshotStore.saveSnapshot(corruptedSnapshot)).rejects.toThrow(
        /Snapshot rawFileHash mismatch/
      );
    });
  });

  // =========================================================================
  // 4. PgIngestionJobRepository Tests
  // =========================================================================

  describe('4. PgIngestionJobRepository (Ingestion jobs & outbox tracking)', () => {
    const ingestionId = randomUUID();

    it('4.1. Creates job in queued state, advances through exact lifecycle graph, and completes', async () => {
      const ctx: SessionContext = {
        orgId: COLLEGE_A,
        userId: USER_A,
        role: 'student',
      };

      await jobRepo.createJob({
        ingestionId,
        orgId: COLLEGE_A,
        studentId: STUDENT_A,
        repositoryId: REPO_A,
        owner: 'test-org',
        repo: 'test-repo',
        ref: 'main',
        status: 'queued',
        fileCount: 0,
        retainedBytes: 0,
        registeredSnapshotsCount: 0,
        createdAt: new Date().toISOString(),
      });

      const initial = await jobRepo.getJob(ctx, ingestionId);
      expect(initial).not.toBeNull();
      expect(initial?.status).toBe('queued');

      // Exact step-by-step transition progression: queued -> resolving -> fetching -> verifying -> persisted -> completed
      await jobRepo.updateJob(ctx, ingestionId, 'resolving');
      expect((await jobRepo.getJob(ctx, ingestionId))?.status).toBe('resolving');

      await jobRepo.updateJob(ctx, ingestionId, 'fetching');
      expect((await jobRepo.getJob(ctx, ingestionId))?.status).toBe('fetching');

      await jobRepo.updateJob(ctx, ingestionId, 'verifying');
      expect((await jobRepo.getJob(ctx, ingestionId))?.status).toBe('verifying');

      await jobRepo.updateJob(ctx, ingestionId, 'persisted');
      expect((await jobRepo.getJob(ctx, ingestionId))?.status).toBe('persisted');

      await jobRepo.updateJob(ctx, ingestionId, 'completed', {
        commitSha: 'fa7a000000000000000000000000000000000001',
        treeSha: 'bee7000000000000000000000000000000000002',
        fileCount: 5,
        registeredSnapshotsCount: 5,
        completedAt: new Date().toISOString(),
      });

      const completed = await jobRepo.getJob(ctx, ingestionId);
      expect(completed?.status).toBe('completed');
      expect(completed?.fileCount).toBe(5);
      expect(completed?.registeredSnapshotsCount).toBe(5);
    });

    it('4.2. Rejects invalid initial job state and skipped transitions in lifecycle graph', async () => {
      const ctx: SessionContext = {
        orgId: COLLEGE_A,
        userId: USER_A,
        role: 'student',
      };

      const invalidInitId = randomUUID();
      await expect(
        jobRepo.createJob({
          ingestionId: invalidInitId,
          orgId: COLLEGE_A,
          studentId: STUDENT_A,
          repositoryId: REPO_A,
          owner: 'test-org',
          repo: 'test-repo',
          ref: 'main',
          status: 'resolving',
          fileCount: 0,
          retainedBytes: 0,
          registeredSnapshotsCount: 0,
          createdAt: new Date().toISOString(),
        })
      ).rejects.toThrow(/INVALID_INITIAL_JOB_STATE/);

      const skipId = randomUUID();
      await jobRepo.createJob({
        ingestionId: skipId,
        orgId: COLLEGE_A,
        studentId: STUDENT_A,
        repositoryId: REPO_A,
        owner: 'test-org',
        repo: 'test-repo',
        ref: 'main',
        status: 'queued',
        fileCount: 0,
        retainedBytes: 0,
        registeredSnapshotsCount: 0,
        createdAt: new Date().toISOString(),
      });

      // Skipping resolving and jumping directly to fetching or completed is forbidden
      await expect(jobRepo.updateJob(ctx, skipId, 'fetching')).rejects.toThrow(/INVALID_JOB_TRANSITION/);
      await expect(jobRepo.updateJob(ctx, skipId, 'completed')).rejects.toThrow(/INVALID_JOB_TRANSITION/);
      await expect(jobRepo.updateJob(ctx, skipId, 'persisted')).rejects.toThrow(/INVALID_JOB_TRANSITION/);
    });
  });

  // =========================================================================
  // 5. PgRepositoryRepository (Canonical Repository Database Records)
  // =========================================================================

  describe('5. PgRepositoryRepository (Canonical Repository Database Records)', () => {
    const ctxA: SessionContext = {
      orgId: COLLEGE_A,
      userId: USER_A,
      role: 'student',
    };

    const ctxB: SessionContext = {
      orgId: COLLEGE_B,
      userId: USER_B,
      role: 'student',
    };

    it('5.1. First-time repository registration via getOrCreateRepository creates canonical row', async () => {
      const repo = await repoRepository.getOrCreateRepository(ctxA, {
        studentId: STUDENT_A,
        providerRepoId: '123456789',
        url: 'https://github.com/alice/test-repo',
        defaultBranch: 'main',
        consentGrantId: CONSENT_A,
      });

      expect(repo).toBeDefined();
      expect(repo.id).toBeDefined();
      expect(repo.studentId).toBe(STUDENT_A);
      expect(repo.provider).toBe('github');
      expect(repo.providerRepoId).toBe('123456789');
      expect(repo.url).toBe('https://github.com/alice/test-repo');
      expect(repo.defaultBranch).toBe('main');
      expect(repo.consentGrantId).toBe(CONSENT_A);

      const fetched = await repoRepository.getRepositoryById(ctxA, repo.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.id).toBe(repo.id);
    });

    it('5.2. Re-ingestion of an already registered repository returns the same ID (idempotency)', async () => {
      const repoFirst = await repoRepository.getOrCreateRepository(ctxA, {
        studentId: STUDENT_A,
        providerRepoId: '987654321',
        url: 'https://github.com/alice/idempotent-repo',
        defaultBranch: 'main',
        consentGrantId: CONSENT_A,
      });

      const repoSecond = await repoRepository.getOrCreateRepository(ctxA, {
        studentId: STUDENT_A,
        providerRepoId: '987654321',
        url: 'https://github.com/alice/idempotent-repo',
        defaultBranch: 'main',
        consentGrantId: CONSENT_A,
      });

      expect(repoSecond.id).toBe(repoFirst.id);
    });

    it('5.3. Cross-student repository ID substitution throws CROSS_STUDENT_REPOSITORY_FORBIDDEN', async () => {
      // Create repository belonging to Student A
      const repoA = await repoRepository.getOrCreateRepository(ctxA, {
        studentId: STUDENT_A,
        providerRepoId: '555555555',
        url: 'https://github.com/alice/student-a-repo',
        defaultBranch: 'main',
        consentGrantId: CONSENT_A,
      });

      // Student B attempts to reuse Student A's repository ID
      await expect(
        repoRepository.getOrCreateRepository(ctxA, {
          studentId: STUDENT_B,
          providerRepoId: '555555555',
          url: 'https://github.com/alice/student-a-repo',
          defaultBranch: 'main',
          consentGrantId: CONSENT_A,
          requestedRepositoryId: repoA.id,
        })
      ).rejects.toThrow(/CROSS_STUDENT_REPOSITORY_FORBIDDEN/);
    });

    it('5.4. Cross-tenant repository ID query fails under RLS (REPOSITORY_NOT_FOUND)', async () => {
      // Repository created in College A
      const repoA = await repoRepository.getOrCreateRepository(ctxA, {
        studentId: STUDENT_A,
        providerRepoId: '777777777',
        url: 'https://github.com/alice/college-a-repo',
        defaultBranch: 'main',
        consentGrantId: CONSENT_A,
      });

      // College B attempts to access it via getRepositoryById under College B context
      const crossTenantFetch = await repoRepository.getRepositoryById(ctxB, repoA.id);
      expect(crossTenantFetch).toBeNull();

      // College B attempts to pass it as requestedRepositoryId
      await expect(
        repoRepository.getOrCreateRepository(ctxB, {
          studentId: STUDENT_B,
          providerRepoId: '777777777',
          url: 'https://github.com/alice/college-a-repo',
          defaultBranch: 'main',
          consentGrantId: CONSENT_B,
          requestedRepositoryId: repoA.id,
        })
      ).rejects.toThrow(/REPOSITORY_NOT_FOUND/);
    });

    it('5.5. Missing or invalid consent grant throws foreign key error', async () => {
      const fakeConsentId = randomUUID();
      await expect(
        repoRepository.getOrCreateRepository(ctxA, {
          studentId: STUDENT_A,
          providerRepoId: '444444444',
          url: 'https://github.com/alice/no-consent-repo',
          defaultBranch: 'main',
          consentGrantId: fakeConsentId,
        })
      ).rejects.toThrow();
    });

    it('5.6. Correct foreign-key relationships for ingestion_jobs, trusted_ingestion_records, and source_snapshots referencing created repository', async () => {
      const canonicalRepo = await repoRepository.getOrCreateRepository(ctxA, {
        studentId: STUDENT_A,
        providerRepoId: '333333333',
        url: 'https://github.com/alice/relational-repo',
        defaultBranch: 'main',
        consentGrantId: CONSENT_A,
      });

      const ingestionId = randomUUID();
      const commitSha = 'ca70000000000000000000000000000000000001';
      const treeSha = 'bee0000000000000000000000000000000000002';
      const fileBytes = Buffer.from('export const test = 1;\n', 'utf8');
      const blobSha = computeGitBlobSha(fileBytes);
      const rawFileHash = computeRawFileHash(fileBytes);

      // Ingestion job referencing canonical repository
      await jobRepo.createJob({
        ingestionId,
        orgId: COLLEGE_A,
        studentId: STUDENT_A,
        repositoryId: canonicalRepo.id,
        owner: 'alice',
        repo: 'relational-repo',
        ref: 'main',
        status: 'queued',
        fileCount: 1,
        retainedBytes: fileBytes.length,
        registeredSnapshotsCount: 0,
        createdAt: new Date().toISOString(),
      });
      await jobRepo.updateJob(ctxA, ingestionId, 'resolving');
      await jobRepo.updateJob(ctxA, ingestionId, 'fetching');
      await jobRepo.updateJob(ctxA, ingestionId, 'verifying');
      await jobRepo.updateJob(ctxA, ingestionId, 'persisted');

      // Trusted ingestion record referencing canonical repository
      const record: TrustedIngestionRecord = {
        ingestionId,
        orgId: COLLEGE_A,
        studentId: STUDENT_A,
        repositoryId: canonicalRepo.id,
        commitSha,
        treeSha,
        verifiedAt: new Date().toISOString(),
        provenance: 'trusted_ingestion_pipeline',
        manifest: [
          {
            filePath: 'src/test.ts',
            blobSha,
            rawFileHash,
            byteSize: fileBytes.length,
          },
        ],
      };
      await trustedIngestionStore.saveRecord(record);

      // Source snapshot referencing canonical repository
      const snapshot: SourceSnapshot = {
        snapshotId: randomUUID(),
        orgId: COLLEGE_A,
        studentId: STUDENT_A,
        repositoryId: canonicalRepo.id,
        commitSha,
        filePath: 'src/test.ts',
        rawBytes: fileBytes,
        rawFileHash,
        blobSha,
        capturedAt: new Date().toISOString(),
        provenance: 'trusted_ingestion_pipeline',
        ingestionId,
        registrationState: 'pending_audit',
      };
      await snapshotStore.saveSnapshot(snapshot);
      await snapshotStore.updateRegistrationState(
        canonicalRepo.id,
        commitSha,
        'src/test.ts',
        COLLEGE_A,
        STUDENT_A,
        snapshot.snapshotId,
        'audit_committed'
      );

      // Verify all 3 persisted and retrievable
      const fetchedJob = await jobRepo.getJob(ctxA, ingestionId);
      expect(fetchedJob?.repositoryId).toBe(canonicalRepo.id);

      const fetchedRecord = await trustedIngestionStore.getRecord(
        COLLEGE_A,
        canonicalRepo.id,
        commitSha,
        STUDENT_A
      );
      expect(fetchedRecord?.repositoryId).toBe(canonicalRepo.id);

      const fetchedSnapshot = await snapshotStore.getSnapshot(
        canonicalRepo.id,
        commitSha,
        'src/test.ts',
        COLLEGE_A,
        STUDENT_A
      );
      expect(fetchedSnapshot?.repositoryId).toBe(canonicalRepo.id);
    });

    it('5.7. Distinct users.id and students.id verified via PgTenantRepository', async () => {
      const student = await tenantRepo.getStudentByUserId(ctxA, USER_A);
      expect(student).not.toBeNull();
      expect(student?.id).toBe(STUDENT_A);
      expect(student?.userId).toBe(USER_A);
      expect(student?.id).not.toBe(student?.userId);

      const studentB = await tenantRepo.getStudentByUserId(ctxB, USER_B);
      expect(studentB).not.toBeNull();
      expect(studentB?.id).toBe(STUDENT_B);
      expect(studentB?.userId).toBe(USER_B);
      expect(studentB?.id).not.toBe(studentB?.userId);
    });

    it('5.8. Concurrency-safe canonical repository registration: parallel requests return identical ID', async () => {
      const parallelCalls = Array.from({ length: 5 }, () =>
        repoRepository.getOrCreateRepository(ctxA, {
          studentId: STUDENT_A,
          providerRepoId: 'concurrent-repo-999',
          url: 'https://github.com/alice/concurrent-repo',
          defaultBranch: 'main',
          consentGrantId: CONSENT_A,
        })
      );

      const results = await Promise.all(parallelCalls);
      const firstId = results[0].id;
      for (const res of results) {
        expect(res.id).toBe(firstId);
        expect(res.studentId).toBe(STUDENT_A);
        expect(res.providerRepoId).toBe('concurrent-repo-999');
      }

      // Verify in DB that only one canonical row exists
      const client = await pool.connect();
      try {
        const countRes = await client.query(
          `SELECT COUNT(*)::int as count FROM repositories WHERE student_id = $1 AND provider_repo_id = $2;`,
          [STUDENT_A, 'concurrent-repo-999']
        );
        expect(countRes.rows[0].count).toBe(1);
      } finally {
        client.release();
      }
    });

    it('5.9. Consent revocation quarantines source snapshots and marks trusted records revoked', async () => {
      // Create dedicated consent grant, repository, trusted record, and snapshot for revocation testing
      const revConsent = await consentRepo.grantConsent(ctxA, STUDENT_A, 'repo_verification', 1);
      const revRepo = await repoRepository.getOrCreateRepository(ctxA, {
        studentId: STUDENT_A,
        providerRepoId: 'revocation-test-repo',
        url: 'https://github.com/alice/revocation-test-repo',
        defaultBranch: 'main',
        consentGrantId: revConsent.id,
      });

      const revIngestionId = randomUUID();
      const revCommitSha = 'ca80000000000000000000000000000000000001';
      const revTreeSha = 'bee8000000000000000000000000000000000002';
      const fileBytes = Buffer.from('console.log("revoked");\n', 'utf8');
      const blobSha = computeGitBlobSha(fileBytes);
      const rawFileHash = computeRawFileHash(fileBytes);

      await trustedIngestionStore.saveRecord({
        ingestionId: revIngestionId,
        orgId: COLLEGE_A,
        studentId: STUDENT_A,
        repositoryId: revRepo.id,
        commitSha: revCommitSha,
        treeSha: revTreeSha,
        verifiedAt: new Date().toISOString(),
        provenance: 'trusted_ingestion_pipeline',
        manifest: [{ filePath: 'src/rev.ts', blobSha, rawFileHash, byteSize: fileBytes.length }],
      });

      const snapId = randomUUID();
      await snapshotStore.saveSnapshot({
        snapshotId: snapId,
        orgId: COLLEGE_A,
        studentId: STUDENT_A,
        repositoryId: revRepo.id,
        commitSha: revCommitSha,
        filePath: 'src/rev.ts',
        rawBytes: fileBytes,
        rawFileHash,
        blobSha,
        capturedAt: new Date().toISOString(),
        provenance: 'trusted_ingestion_pipeline',
        ingestionId: revIngestionId,
        registrationState: 'pending_audit',
      });
      await snapshotStore.updateRegistrationState(
        revRepo.id,
        revCommitSha,
        'src/rev.ts',
        COLLEGE_A,
        STUDENT_A,
        snapId,
        'audit_committed'
      );

      // Revoke both fixture consent and test consent to test student-level purpose revocation
      await consentRepo.revokeConsent(ctxA, CONSENT_A, 'Initial fixture revocation');
      const revResult = await consentRepo.revokeConsent(ctxA, revConsent.id, 'Student withdrawal');
      expect(revResult.success).toBe(true);

      // Verify active consent is completely revoked for STUDENT_A
      const hasActive = await consentRepo.hasActiveConsent(ctxA, STUDENT_A, 'repo_verification');
      expect(hasActive).toBe(false);

      // Verify snapshot is quarantined
      const client = await pool.connect();
      try {
        const snapRes = await client.query(
          `SELECT registration_state FROM source_snapshots WHERE ingestion_id = $1;`,
          [revIngestionId]
        );
        expect(snapRes.rows.length).toBe(1);
        expect(snapRes.rows[0].registration_state).toBe('quarantined');
      } finally {
        client.release();
      }
    });

    it('5.10. Subsequent re-consent and re-ingestion links canonical repository to new grant while quarantined snapshots stay quarantined', async () => {
      // Student grants new consent
      const newConsent = await consentRepo.grantConsent(ctxA, STUDENT_A, 'repo_verification', 1);
      expect(newConsent).toBeDefined();

      // Re-register the repository under new consent
      const updatedRepo = await repoRepository.getOrCreateRepository(ctxA, {
        studentId: STUDENT_A,
        providerRepoId: 'revocation-test-repo',
        url: 'https://github.com/alice/revocation-test-repo',
        defaultBranch: 'main',
        consentGrantId: newConsent.id,
      });

      expect(updatedRepo.consentGrantId).toBe(newConsent.id);

      // Verify old quarantined snapshots remain quarantined (not resurrected)
      const client = await pool.connect();
      try {
        const snapRes = await client.query(
          `SELECT registration_state FROM source_snapshots WHERE repository_id = $1 AND file_path = 'src/rev.ts';`,
          [updatedRepo.id]
        );
        expect(snapRes.rows.length).toBe(1);
        expect(snapRes.rows[0].registration_state).toBe('quarantined');
      } finally {
        client.release();
      }
    });
  });

  // =========================================================================
  // 6. Active Consent Semantics & Partial Unique Index Invariants (Migration 013)
  // =========================================================================

  describe('6. Active Consent Semantics & Partial Unique Index Invariants', () => {
    const ctxA: SessionContext = {
      orgId: COLLEGE_A,
      userId: USER_A,
      role: 'student',
    };

    it('6.1. Partial unique index uq_consent_grants_active_student_purpose strictly prevents duplicate active grants via direct SQL', async () => {
      const client = await pool.connect();
      const testStudent = STUDENT_B;
      const testPurpose = 'repo_verification';
      const id1 = randomUUID();
      const id2 = randomUUID();

      try {
        // Ensure no active grant exists for STUDENT_B for this purpose first
        await client.query(
          `UPDATE consent_grants SET revoked_at = CURRENT_TIMESTAMP WHERE student_id = $1 AND purpose = $2 AND revoked_at IS NULL;`,
          [testStudent, testPurpose]
        );

        // First active grant succeeds
        await client.query(`
          INSERT INTO consent_grants (id, student_id, purpose, notice_version, granted_at)
          VALUES ($1, $2, $3, 1, CURRENT_TIMESTAMP);
        `, [id1, testStudent, testPurpose]);

        // Second active grant for same (student_id, purpose) with revoked_at IS NULL must fail
        let errorThrown = false;
        try {
          await client.query(`
            INSERT INTO consent_grants (id, student_id, purpose, notice_version, granted_at)
            VALUES ($1, $2, $3, 1, CURRENT_TIMESTAMP);
          `, [id2, testStudent, testPurpose]);
        } catch (err: any) {
          errorThrown = true;
          expect(err.code).toBe('23505'); // unique_violation
          expect(err.constraint).toBe('uq_consent_grants_active_student_purpose');
        }
        expect(errorThrown).toBe(true);
      } finally {
        await client.query(`DELETE FROM consent_grants WHERE id IN ($1, $2);`, [id1, id2]);
        client.release();
      }
    });

    it('6.2. Multiple revoked grants for same (student_id, purpose) are allowed for historical audit trail', async () => {
      const client = await pool.connect();
      const testStudent = STUDENT_B;
      const testPurpose = 'repo_verification';
      const id1 = randomUUID();
      const id2 = randomUUID();

      try {
        // Two grants, both with revoked_at NOT NULL
        await client.query(`
          INSERT INTO consent_grants (id, student_id, purpose, notice_version, granted_at, revoked_at)
          VALUES ($1, $2, $3, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
        `, [id1, testStudent, testPurpose]);

        await client.query(`
          INSERT INTO consent_grants (id, student_id, purpose, notice_version, granted_at, revoked_at)
          VALUES ($1, $2, $3, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
        `, [id2, testStudent, testPurpose]);

        // Both rows must exist cleanly without unique violation
        const res = await client.query(`SELECT COUNT(*)::int as cnt FROM consent_grants WHERE id IN ($1, $2);`, [id1, id2]);
        expect(res.rows[0].cnt).toBe(2);
      } finally {
        await client.query(`DELETE FROM consent_grants WHERE id IN ($1, $2);`, [id1, id2]);
        client.release();
      }
    });

    it('6.3. consentRepo.grantConsent() automatically transitions previous active grant to revoked before inserting new active grant', async () => {
      // 1. Grant consent
      const grant1 = await consentRepo.grantConsent(ctxA, STUDENT_A, 'repo_verification', 1);
      expect(grant1.revokedAt).toBeNull();

      // Verify grant1 is active in DB
      let active = await consentRepo.getActiveGrant(ctxA, STUDENT_A, 'repo_verification');
      expect(active?.id).toBe(grant1.id);

      // 2. Grant new consent for same student and purpose
      const grant2 = await consentRepo.grantConsent(ctxA, STUDENT_A, 'repo_verification', 2);
      expect(grant2.revokedAt).toBeNull();
      expect(grant2.id).not.toBe(grant1.id);

      // 3. Verify grant1 is now revoked in DB
      const client = await pool.connect();
      try {
        const oldGrantRes = await client.query(`SELECT revoked_at FROM consent_grants WHERE id = $1;`, [grant1.id]);
        expect(oldGrantRes.rows[0].revoked_at).not.toBeNull();

        // Verify only ONE active grant exists for STUDENT_A and repo_verification
        const activeCountRes = await client.query(
          `SELECT COUNT(*)::int as cnt FROM consent_grants WHERE student_id = $1 AND purpose = $2 AND revoked_at IS NULL;`,
          [STUDENT_A, 'repo_verification']
        );
        expect(activeCountRes.rows[0].cnt).toBe(1);
      } finally {
        client.release();
      }

      // 4. Verify getActiveGrant returns grant2
      active = await consentRepo.getActiveGrant(ctxA, STUDENT_A, 'repo_verification');
      expect(active?.id).toBe(grant2.id);
    });

    it('6.4. consentRepo.revokeConsent() revokes all active grants, leaving strictly zero active grants', async () => {
      const active = await consentRepo.getActiveGrant(ctxA, STUDENT_A, 'repo_verification');
      expect(active).not.toBeNull();

      const revRes = await consentRepo.revokeConsent(ctxA, active!.id, 'Testing full revocation');
      expect(revRes.success).toBe(true);

      const hasActive = await consentRepo.hasActiveConsent(ctxA, STUDENT_A, 'repo_verification');
      expect(hasActive).toBe(false);

      const client = await pool.connect();
      try {
        const countRes = await client.query(
          `SELECT COUNT(*)::int as cnt FROM consent_grants WHERE student_id = $1 AND purpose = $2 AND revoked_at IS NULL;`,
          [STUDENT_A, 'repo_verification']
        );
        expect(countRes.rows[0].cnt).toBe(0);
      } finally {
        client.release();
      }
    });

    it('6.5. Concurrent grantConsent() calls under app_api preserve the invariant of at most 1 active grant', async () => {
      // Execute 5 concurrent grantConsent calls for STUDENT_A
      const promises = Array.from({ length: 5 }, (_, i) =>
        consentRepo.grantConsent(ctxA, STUDENT_A, 'repo_verification', i + 1)
      );

      const results = await Promise.all(promises);
      expect(results.length).toBe(5);

      // Check DB directly: exactly 1 active grant must exist
      const client = await pool.connect();
      try {
        const countRes = await client.query(
          `SELECT COUNT(*)::int as cnt FROM consent_grants WHERE student_id = $1 AND purpose = $2 AND revoked_at IS NULL;`,
          [STUDENT_A, 'repo_verification']
        );
        expect(countRes.rows[0].cnt).toBe(1);
      } finally {
        client.release();
      }
    });
  });

  // =========================================================================
  // 7. Safe Canonical Repository Reconciliation (Migration 014)
  // =========================================================================

  describe('7. Safe Canonical Repository Reconciliation (Migration 014)', () => {
    it('7.1. Safely re-parents child records without data loss when reconciling duplicate repositories', async () => {
      const client = await pool.connect();
      const canonRepoId = randomUUID();
      const dupRepoId = randomUUID();
      const testProviderRepoId = `test-reconciliation-${Date.now()}`;
      const snapId = randomUUID();
      const tirId = randomUUID();
      const jobId = randomUUID();
      const rSnapId = randomUUID();
      const evidenceId = randomUUID();
      const commitSha = '1111222233334444555566667777888899990000';
      const treeSha = '2222333344445555666677778888999900001111';
      const fileBytes = Buffer.from('console.log("migration-014-reconcile");\n');
      const blobSha = computeGitBlobSha(fileBytes);
      const rawHash = computeRawFileHash(fileBytes);

      try {
        // Temporarily drop the constraint to simulate existing duplicates prior to reconciliation
        await client.query(`ALTER TABLE repositories DROP CONSTRAINT IF EXISTS uq_repositories_student_provider_repo;`);

        // Insert canonical repository (earlier imported_at)
        await client.query(`
          INSERT INTO repositories (id, student_id, provider, provider_repo_id, url, default_branch, consent_grant_id, imported_at)
          VALUES ($1, $2, 'github', $3, 'https://github.com/alice/test-repo', 'main', '${CONSENT_B}', '2026-01-01 10:00:00+00');
        `, [canonRepoId, STUDENT_B, testProviderRepoId]);

        // Insert duplicate repository (later imported_at)
        await client.query(`
          INSERT INTO repositories (id, student_id, provider, provider_repo_id, url, default_branch, consent_grant_id, imported_at)
          VALUES ($1, $2, 'github', $3, 'https://github.com/alice/test-repo', 'main', '${CONSENT_B}', '2026-01-02 10:00:00+00');
        `, [dupRepoId, STUDENT_B, testProviderRepoId]);

        // Attach child records to the duplicate repository:
        // 1. repo_snapshots
        await client.query(`
          INSERT INTO repo_snapshots (id, repository_id, commit_sha, parser_version, tree_summary)
          VALUES ($1, $2, $3, '1.0.0', '{}'::jsonb);
        `, [rSnapId, dupRepoId, commitSha]);

        // 2. evidence_items pointing to that repo_snapshot
        await client.query(`
          INSERT INTO evidence_items (id, student_id, kind, repo_snapshot_id, content_hash, status)
          VALUES ($1, $2, 'code_span', $3, 'hash_evidence_1', 'accepted');
        `, [evidenceId, STUDENT_B, rSnapId]);

        // 3. source_snapshots pointing to dupRepoId
        await client.query(`
          INSERT INTO source_snapshots (id, snapshot_id, org_id, student_id, repository_id, commit_sha, file_path, raw_bytes, raw_file_hash, blob_sha, captured_at, provenance, ingestion_id, registration_state)
          VALUES ($1, $1, '${COLLEGE_B}', $2, $3, $4, 'src/test.ts', $5, $6, $7, CURRENT_TIMESTAMP, 'trusted_ingestion_pipeline', $8, 'audit_committed');
        `, [snapId, STUDENT_B, dupRepoId, commitSha, fileBytes, rawHash, blobSha, tirId]);

        // 4. trusted_ingestion_records pointing to dupRepoId
        await client.query(`
          INSERT INTO trusted_ingestion_records (id, ingestion_id, org_id, student_id, repository_id, commit_sha, tree_sha, verified_at, provenance, manifest)
          VALUES ($1, $1, '${COLLEGE_B}', $2, $3, $4, $5, CURRENT_TIMESTAMP, 'trusted_ingestion_pipeline', $6::jsonb);
        `, [tirId, STUDENT_B, dupRepoId, commitSha, treeSha, JSON.stringify([{ filePath: 'src/test.ts', blobSha, rawFileHash: rawHash, byteSize: fileBytes.length }])]);

        // 5. ingestion_jobs pointing to dupRepoId
        await client.query(`
          INSERT INTO ingestion_jobs (ingestion_id, org_id, student_id, repository_id, owner, repo, ref, status, file_count, retained_bytes, registered_snapshots_count)
          VALUES ($1, '${COLLEGE_B}', $2, $3, 'alice', 'test-repo', 'main', 'completed', 1, 100, 1);
        `, [jobId, STUDENT_B, dupRepoId]);

        // Run the Migration 014 reconciliation logic
        const migrationPath = path.resolve(process.cwd(), 'db/migrations/014_safe_repository_reconciliation.sql');
        const migrationSql = fs.readFileSync(migrationPath, 'utf8');
        await client.query(migrationSql);

        // Verification assertions:
        // A. Duplicate repository was safely deleted
        const dupCheck = await client.query(`SELECT id FROM repositories WHERE id = $1;`, [dupRepoId]);
        expect(dupCheck.rows.length).toBe(0);

        // B. Canonical repository remains
        const canonCheck = await client.query(`SELECT id FROM repositories WHERE id = $1;`, [canonRepoId]);
        expect(canonCheck.rows.length).toBe(1);

        // C. All child records are re-parented to canonRepoId
        const snapCheck = await client.query(`SELECT repository_id FROM source_snapshots WHERE id = $1;`, [snapId]);
        expect(snapCheck.rows[0].repository_id).toBe(canonRepoId);

        const tirCheck = await client.query(`SELECT repository_id FROM trusted_ingestion_records WHERE id = $1;`, [tirId]);
        expect(tirCheck.rows[0].repository_id).toBe(canonRepoId);

        const jobCheck = await client.query(`SELECT repository_id FROM ingestion_jobs WHERE ingestion_id = $1;`, [jobId]);
        expect(jobCheck.rows[0].repository_id).toBe(canonRepoId);

        const rSnapCheck = await client.query(`SELECT repository_id FROM repo_snapshots WHERE id = $1;`, [rSnapId]);
        expect(rSnapCheck.rows[0].repository_id).toBe(canonRepoId);

        // D. Evidence item is intact
        const evidenceCheck = await client.query(`SELECT repo_snapshot_id FROM evidence_items WHERE id = $1;`, [evidenceId]);
        expect(evidenceCheck.rows[0].repo_snapshot_id).toBe(rSnapId);
      } finally {
        // Cleanup test-created records
        await client.query(`DELETE FROM evidence_items WHERE id = $1;`, [evidenceId]);
        await client.query(`DELETE FROM repo_snapshots WHERE id = $1;`, [rSnapId]);
        await client.query(`DELETE FROM source_snapshots WHERE id = $1;`, [snapId]);
        await client.query(`DELETE FROM trusted_ingestion_records WHERE id = $1;`, [tirId]);
        await client.query(`DELETE FROM ingestion_jobs WHERE ingestion_id = $1;`, [jobId]);
        await client.query(`DELETE FROM repositories WHERE id IN ($1, $2);`, [canonRepoId, dupRepoId]);

        // Restore unique constraint
        await client.query(`
          DO $$
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_constraint WHERE conname = 'uq_repositories_student_provider_repo'
            ) THEN
              ALTER TABLE repositories ADD CONSTRAINT uq_repositories_student_provider_repo UNIQUE (student_id, provider, provider_repo_id);
            END IF;
          END $$;
        `);
        client.release();
      }
    });
  });

  // =========================================================================
  // 8. Ingestion Job Status Transitions & Consent Invariant Guarantees
  // =========================================================================

  describe('8. Ingestion Job Status Transitions & Consent Invariant Guarantees', () => {
    const ctxA: SessionContext = {
      orgId: COLLEGE_A,
      userId: USER_A,
      role: 'student',
    };
    const ctxB: SessionContext = {
      orgId: COLLEGE_B,
      userId: USER_B,
      role: 'student',
    };

    it('8.1. cancelJobsForStudentOnRevocation() transitions all in-progress jobs to failed with CONSENT_REVOKED and preserves completed/failed jobs', async () => {
      // Clean up previous test jobs for STUDENT_A to ensure exact isolated count
      const cleanClient = await pool.connect();
      try {
        await cleanClient.query(`DELETE FROM ingestion_jobs WHERE student_id = $1;`, [STUDENT_A]);
      } finally {
        cleanClient.release();
      }

      const inProgressStates = ['queued', 'resolving', 'fetching', 'verifying', 'persisted'] as const;
      const createdJobIds: string[] = [];

      for (const st of inProgressStates) {
        const jId = randomUUID();
        createdJobIds.push(jId);
        await jobRepo.createJob({
          ingestionId: jId,
          orgId: COLLEGE_A,
          studentId: STUDENT_A,
          repositoryId: REPO_A,
          owner: 'test-owner',
          repo: `test-repo-${st}`,
          ref: 'main',
          status: 'queued',
          fileCount: 0,
          retainedBytes: 0,
          registeredSnapshotsCount: 0,
          createdAt: new Date().toISOString(),
        });
        if (st === 'resolving') {
          await jobRepo.updateJob(ctxA, jId, 'resolving');
        } else if (st === 'fetching') {
          await jobRepo.updateJob(ctxA, jId, 'resolving');
          await jobRepo.updateJob(ctxA, jId, 'fetching');
        } else if (st === 'verifying') {
          await jobRepo.updateJob(ctxA, jId, 'resolving');
          await jobRepo.updateJob(ctxA, jId, 'fetching');
          await jobRepo.updateJob(ctxA, jId, 'verifying');
        } else if (st === 'persisted') {
          await jobRepo.updateJob(ctxA, jId, 'resolving');
          await jobRepo.updateJob(ctxA, jId, 'fetching');
          await jobRepo.updateJob(ctxA, jId, 'verifying');
          await jobRepo.updateJob(ctxA, jId, 'persisted');
        }
      }

      // Create a completed job and an unrelated failed job
      const completedJobId = randomUUID();
      await jobRepo.createJob({
        ingestionId: completedJobId,
        orgId: COLLEGE_A,
        studentId: STUDENT_A,
        repositoryId: REPO_A,
        owner: 'test-owner',
        repo: 'test-repo-completed',
        ref: 'main',
        status: 'queued',
        fileCount: 0,
        retainedBytes: 0,
        registeredSnapshotsCount: 0,
        createdAt: new Date().toISOString(),
      });
      await jobRepo.updateJob(ctxA, completedJobId, 'resolving');
      await jobRepo.updateJob(ctxA, completedJobId, 'fetching');
      await jobRepo.updateJob(ctxA, completedJobId, 'verifying');
      await jobRepo.updateJob(ctxA, completedJobId, 'persisted');
      await jobRepo.updateJob(ctxA, completedJobId, 'completed', {
        fileCount: 5,
        retainedBytes: 1000,
        registeredSnapshotsCount: 5,
        completedAt: new Date().toISOString(),
      });

      const failedJobId = randomUUID();
      await jobRepo.createJob({
        ingestionId: failedJobId,
        orgId: COLLEGE_A,
        studentId: STUDENT_A,
        repositoryId: REPO_A,
        owner: 'test-owner',
        repo: 'test-repo-other-failed',
        ref: 'main',
        status: 'queued',
        fileCount: 0,
        retainedBytes: 0,
        registeredSnapshotsCount: 0,
        createdAt: new Date().toISOString(),
      });
      await jobRepo.updateJob(ctxA, failedJobId, 'failed', {
        error: 'PARSER_SYNTAX_ERROR',
        completedAt: new Date().toISOString(),
      });

      // Create an in-progress job for STUDENT_B (must NOT be touched)
      const studentBJobId = randomUUID();
      await jobRepo.createJob({
        ingestionId: studentBJobId,
        orgId: COLLEGE_B,
        studentId: STUDENT_B,
        repositoryId: REPO_B,
        owner: 'test-owner',
        repo: 'test-repo-student-b',
        ref: 'main',
        status: 'queued',
        fileCount: 0,
        retainedBytes: 0,
        registeredSnapshotsCount: 0,
        createdAt: new Date().toISOString(),
      });
      await jobRepo.updateJob(ctxB, studentBJobId, 'resolving');
      await jobRepo.updateJob(ctxB, studentBJobId, 'fetching', { fileCount: 2, retainedBytes: 200 });

      // Execute revocation cancellation for STUDENT_A
      const cancelledCount = await jobRepo.cancelJobsForStudentOnRevocation(ctxA, STUDENT_A);
      expect(cancelledCount).toBe(inProgressStates.length);

      // Verify each in-progress job is now failed with CONSENT_REVOKED and completedAt is set
      for (const jId of createdJobIds) {
        const job = await jobRepo.getJob(ctxA, jId);
        expect(job?.status).toBe('failed');
        expect(job?.error).toBe('CONSENT_REVOKED');
        expect(job?.diagnostics?.revocation_reason).toBe('CONSENT_REVOKED');
        expect(job?.completedAt).not.toBeNull();
      }

      // Verify completed job was NOT modified
      const compJob = await jobRepo.getJob(ctxA, completedJobId);
      expect(compJob?.status).toBe('completed');
      expect(compJob?.error).toBeUndefined();

      // Verify other failed job was NOT rewritten
      const fJob = await jobRepo.getJob(ctxA, failedJobId);
      expect(fJob?.status).toBe('failed');
      expect(fJob?.error).toBe('PARSER_SYNTAX_ERROR');

      // Verify STUDENT_B's job was NOT affected
      const bJob = await jobRepo.getJob(ctxB, studentBJobId);
      expect(bJob?.status).toBe('fetching');
    });

    it('8.2. In-flight request cannot transition a revoked/failed job back to persisted or completed', async () => {
      const jId = randomUUID();
      await jobRepo.createJob({
        ingestionId: jId,
        orgId: COLLEGE_A,
        studentId: STUDENT_A,
        repositoryId: REPO_A,
        owner: 'test-owner',
        repo: 'test-repo-term',
        ref: 'main',
        status: 'queued',
        fileCount: 0,
        retainedBytes: 0,
        registeredSnapshotsCount: 0,
        createdAt: new Date().toISOString(),
      });
      await jobRepo.updateJob(ctxA, jId, 'resolving');
      await jobRepo.updateJob(ctxA, jId, 'fetching');

      // Revocation cancels in-progress job
      await jobRepo.cancelJobsForStudentOnRevocation(ctxA, STUDENT_A);

      const jobAfterCancel = await jobRepo.getJob(ctxA, jId);
      expect(jobAfterCancel?.status).toBe('failed');
      expect(jobAfterCancel?.error).toBe('CONSENT_REVOKED');

      // Attempt in-flight transition to persisted
      await expect(
        jobRepo.updateJob(ctxA, jId, 'persisted', { fileCount: 1 })
      ).rejects.toThrow(/JOB_ALREADY_FAILED/);

      // Attempt in-flight transition to completed
      await expect(
        jobRepo.updateJob(ctxA, jId, 'completed', { completedAt: new Date().toISOString() })
      ).rejects.toThrow(/JOB_ALREADY_FAILED/);

      // Confirm job status was not overwritten
      const finalJob = await jobRepo.getJob(ctxA, jId);
      expect(finalJob?.status).toBe('failed');
      expect(finalJob?.error).toBe('CONSENT_REVOKED');
    });

    it('8.3. Failed jobs are terminal and cannot be reopened', async () => {
      const jId = randomUUID();
      await jobRepo.createJob({
        ingestionId: jId,
        orgId: COLLEGE_A,
        studentId: STUDENT_A,
        repositoryId: REPO_A,
        owner: 'test-owner',
        repo: 'test-repo-failed',
        ref: 'main',
        status: 'queued',
        fileCount: 0,
        retainedBytes: 0,
        registeredSnapshotsCount: 0,
        createdAt: new Date().toISOString(),
      });

      await jobRepo.updateJob(ctxA, jId, 'failed', { error: 'NETWORK_TIMEOUT' });

      // Attempt to reopen to queued or resolving
      await expect(jobRepo.updateJob(ctxA, jId, 'resolving')).rejects.toThrow(/JOB_ALREADY_FAILED/);
      await expect(jobRepo.updateJob(ctxA, jId, 'queued')).rejects.toThrow(/JOB_ALREADY_FAILED/);
    });

    it('8.4. Completed jobs are terminal and cannot be transitioned to anything else', async () => {
      const jId = randomUUID();
      await jobRepo.createJob({
        ingestionId: jId,
        orgId: COLLEGE_A,
        studentId: STUDENT_A,
        repositoryId: REPO_A,
        owner: 'test-owner',
        repo: 'test-repo-comp',
        ref: 'main',
        status: 'queued',
        fileCount: 0,
        retainedBytes: 0,
        registeredSnapshotsCount: 0,
        createdAt: new Date().toISOString(),
      });

      await jobRepo.updateJob(ctxA, jId, 'resolving');
      await jobRepo.updateJob(ctxA, jId, 'fetching');
      await jobRepo.updateJob(ctxA, jId, 'verifying');
      await jobRepo.updateJob(ctxA, jId, 'persisted');
      await jobRepo.updateJob(ctxA, jId, 'completed');

      await expect(jobRepo.updateJob(ctxA, jId, 'resolving')).rejects.toThrow(/JOB_ALREADY_COMPLETED/);
      await expect(jobRepo.updateJob(ctxA, jId, 'failed')).rejects.toThrow(/JOB_ALREADY_COMPLETED/);
    });

    it('8.5. Invalid state transitions (e.g. resolving directly to persisted) are rejected', async () => {
      const jId = randomUUID();
      await jobRepo.createJob({
        ingestionId: jId,
        orgId: COLLEGE_A,
        studentId: STUDENT_A,
        repositoryId: REPO_A,
        owner: 'test-owner',
        repo: 'test-repo-invalid',
        ref: 'main',
        status: 'queued',
        fileCount: 0,
        retainedBytes: 0,
        registeredSnapshotsCount: 0,
        createdAt: new Date().toISOString(),
      });
      await jobRepo.updateJob(ctxA, jId, 'resolving');

      // Cannot skip fetching and jump to persisted
      await expect(jobRepo.updateJob(ctxA, jId, 'persisted')).rejects.toThrow(/INVALID_JOB_TRANSITION/);
    });

    it('8.6. Retrying as a new ingestion attempt with a new ingestion ID succeeds', async () => {
      const originalId = randomUUID();
      await jobRepo.createJob({
        ingestionId: originalId,
        orgId: COLLEGE_A,
        studentId: STUDENT_A,
        repositoryId: REPO_A,
        owner: 'test-owner',
        repo: 'test-repo-retry',
        ref: 'main',
        status: 'queued',
        fileCount: 0,
        retainedBytes: 0,
        registeredSnapshotsCount: 0,
        createdAt: new Date().toISOString(),
      });
      await jobRepo.updateJob(ctxA, originalId, 'resolving');

      // Mark original failed
      await jobRepo.updateJob(ctxA, originalId, 'failed', { error: 'GITHUB_RATE_LIMIT_EXCEEDED' });

      // Retry with new ingestionId
      const retryId = randomUUID();
      await jobRepo.createJob({
        ingestionId: retryId,
        orgId: COLLEGE_A,
        studentId: STUDENT_A,
        repositoryId: REPO_A,
        owner: 'test-owner',
        repo: 'test-repo-retry',
        ref: 'main',
        status: 'queued',
        fileCount: 0,
        retainedBytes: 0,
        registeredSnapshotsCount: 0,
        createdAt: new Date().toISOString(),
      });

      await jobRepo.updateJob(ctxA, retryId, 'resolving');
      await jobRepo.updateJob(ctxA, retryId, 'fetching');
      await jobRepo.updateJob(ctxA, retryId, 'verifying');
      await jobRepo.updateJob(ctxA, retryId, 'persisted');
      await jobRepo.updateJob(ctxA, retryId, 'completed');

      const retryJob = await jobRepo.getJob(ctxA, retryId);
      expect(retryJob?.status).toBe('completed');
    });

    it('8.7. P0: Eliminates quarantined snapshot write bypass — new snapshot write with quarantined state without active consent is strictly rejected', async () => {
      // Ensure student A has no active consent
      const active = await consentRepo.getActiveGrant(ctxA, STUDENT_A, 'repo_verification');
      if (active) {
        await consentRepo.revokeConsent(ctxA, active.id);
      }

      const rawBytes = Buffer.from('const forbidden = "quarantined_write_bypass";\n', 'utf8');
      const snap: SourceSnapshot = {
        snapshotId: randomUUID(),
        orgId: COLLEGE_A,
        studentId: STUDENT_A,
        repositoryId: REPO_A,
        commitSha: '8877000000000000000000000000000000000001',
        filePath: 'src/quarantine-bypass.ts',
        rawBytes,
        rawFileHash: computeRawFileHash(rawBytes),
        blobSha: computeGitBlobSha(rawBytes),
        capturedAt: new Date().toISOString(),
        provenance: 'trusted_ingestion_pipeline',
        ingestionId: randomUUID(),
        registrationState: 'quarantined', // Explicitly trying to bypass consent check
      };

      // Writing newly persisted snapshot marked 'quarantined' must fail closed
      await expect(snapshotStore.saveSnapshot(snap)).rejects.toThrow(/CONSENT_REQUIRED_OR_REVOKED/);
    });

    it('8.8. Dedicated state-transition method updateRegistrationState() allows quarantining existing snapshots even without active consent', async () => {
      // 1. Grant consent to create initial pending snapshot
      const grant = await consentRepo.grantConsent(ctxA, STUDENT_A, 'repo_verification', 1);
      const commitSha = '8888000000000000000000000000000000000002';
      const snapId = randomUUID();
      const rawBytes = Buffer.from('const valid = "initial_snapshot";\n', 'utf8');
      const snap: SourceSnapshot = {
        snapshotId: snapId,
        orgId: COLLEGE_A,
        studentId: STUDENT_A,
        repositoryId: REPO_A,
        commitSha,
        filePath: 'src/valid-quarantine.ts',
        rawBytes,
        rawFileHash: computeRawFileHash(rawBytes),
        blobSha: computeGitBlobSha(rawBytes),
        capturedAt: new Date().toISOString(),
        provenance: 'trusted_ingestion_pipeline',
        ingestionId: randomUUID(),
        registrationState: 'pending_audit',
      };
      await snapshotStore.saveSnapshot(snap);

      // 2. Revoke consent grant directly so no active grant exists
      const revokeClient = await pool.connect();
      try {
        await revokeClient.query(`UPDATE consent_grants SET revoked_at = CURRENT_TIMESTAMP WHERE id = $1;`, [grant.id]);
      } finally {
        revokeClient.release();
      }

      // Verify no active consent exists
      const hasActive = await consentRepo.hasActiveConsent(ctxA, STUDENT_A, 'repo_verification');
      expect(hasActive).toBe(false);

      // 3. Quarantining the existing snapshot must succeed without active consent
      const quarantined = await snapshotStore.updateRegistrationState(
        REPO_A,
        commitSha,
        'src/valid-quarantine.ts',
        COLLEGE_A,
        STUDENT_A,
        snapId,
        'quarantined'
      );
      expect(quarantined).toBe(true);

      const client = await pool.connect();
      try {
        const res = await client.query(`SELECT registration_state FROM source_snapshots WHERE snapshot_id = $1;`, [snapId]);
        expect(res.rows[0].registration_state).toBe('quarantined');
      } finally {
        client.release();
      }
    });

    it('8.9. Quarantined snapshots can never be promoted directly to audit_committed', async () => {
      const commitSha = '8899000000000000000000000000000000000003';
      const snapId = randomUUID();

      // Ensure active consent exists
      const active = await consentRepo.getActiveGrant(ctxA, STUDENT_A, 'repo_verification');
      if (!active) {
        await consentRepo.grantConsent(ctxA, STUDENT_A, 'repo_verification', 1);
      }

      const rawBytes = Buffer.from('const quarantined = "cannot_promote";\n', 'utf8');
      const snap: SourceSnapshot = {
        snapshotId: snapId,
        orgId: COLLEGE_A,
        studentId: STUDENT_A,
        repositoryId: REPO_A,
        commitSha,
        filePath: 'src/quarantine-promote.ts',
        rawBytes,
        rawFileHash: computeRawFileHash(rawBytes),
        blobSha: computeGitBlobSha(rawBytes),
        capturedAt: new Date().toISOString(),
        provenance: 'trusted_ingestion_pipeline',
        ingestionId: randomUUID(),
        registrationState: 'pending_audit',
      };
      await snapshotStore.saveSnapshot(snap);

      // Transition to quarantined
      await snapshotStore.updateRegistrationState(
        REPO_A,
        commitSha,
        'src/quarantine-promote.ts',
        COLLEGE_A,
        STUDENT_A,
        snapId,
        'quarantined'
      );

      // Attempt to promote from quarantined to audit_committed
      const promoted = await snapshotStore.updateRegistrationState(
        REPO_A,
        commitSha,
        'src/quarantine-promote.ts',
        COLLEGE_A,
        STUDENT_A,
        snapId,
        'audit_committed'
      );
      expect(promoted).toBe(false);

      const client = await pool.connect();
      try {
        const res = await client.query(`SELECT registration_state FROM source_snapshots WHERE snapshot_id = $1;`, [snapId]);
        expect(res.rows[0].registration_state).toBe('quarantined');
      } finally {
        client.release();
      }
    });

    it('8.10. Re-saving an existing quarantined snapshot via saveSnapshot() is rejected with IMMUTABLE_SNAPSHOT_MUTATION_REJECTED', async () => {
      const commitSha = '8899000000000000000000000000000000000010';
      const snapId = randomUUID();
      const ingestionId = randomUUID();

      const active = await consentRepo.getActiveGrant(ctxA, STUDENT_A, 'repo_verification');
      if (!active) {
        await consentRepo.grantConsent(ctxA, STUDENT_A, 'repo_verification', 1);
      }

      const rawBytes = Buffer.from('const quarantined = "sealed_forever";\n', 'utf8');
      const snap: SourceSnapshot = {
        snapshotId: snapId,
        orgId: COLLEGE_A,
        studentId: STUDENT_A,
        repositoryId: REPO_A,
        commitSha,
        filePath: 'src/resave-quarantined.ts',
        rawBytes,
        rawFileHash: computeRawFileHash(rawBytes),
        blobSha: computeGitBlobSha(rawBytes),
        capturedAt: new Date().toISOString(),
        provenance: 'trusted_ingestion_pipeline',
        ingestionId,
        registrationState: 'pending_audit',
      };
      await snapshotStore.saveSnapshot(snap);

      // Transition to quarantined
      await snapshotStore.updateRegistrationState(
        REPO_A,
        commitSha,
        'src/resave-quarantined.ts',
        COLLEGE_A,
        STUDENT_A,
        snapId,
        'quarantined'
      );

      // Attempt to re-save the same snapshot
      await expect(snapshotStore.saveSnapshot({
        ...snap,
        registrationState: 'pending_audit',
      })).rejects.toThrow(/IMMUTABLE_SNAPSHOT_MUTATION_REJECTED.*Quarantined snapshot/);

      // Verify registration_state is still quarantined
      const client = await pool.connect();
      try {
        const res = await client.query(`SELECT registration_state FROM source_snapshots WHERE snapshot_id = $1;`, [snapId]);
        expect(res.rows[0].registration_state).toBe('quarantined');
      } finally {
        client.release();
      }
    });

    it('8.11. Directly persisting a snapshot as quarantined via saveSnapshot() is rejected with INVALID_REGISTRATION_STATE', async () => {
      const commitSha = '8899000000000000000000000000000000000011';
      const snapId = randomUUID();

      const active = await consentRepo.getActiveGrant(ctxA, STUDENT_A, 'repo_verification');
      if (!active) {
        await consentRepo.grantConsent(ctxA, STUDENT_A, 'repo_verification', 1);
      }

      const rawBytes = Buffer.from('const direct = "quarantine_invalid";\n', 'utf8');
      const snap: SourceSnapshot = {
        snapshotId: snapId,
        orgId: COLLEGE_A,
        studentId: STUDENT_A,
        repositoryId: REPO_A,
        commitSha,
        filePath: 'src/direct-quarantine.ts',
        rawBytes,
        rawFileHash: computeRawFileHash(rawBytes),
        blobSha: computeGitBlobSha(rawBytes),
        capturedAt: new Date().toISOString(),
        provenance: 'trusted_ingestion_pipeline',
        ingestionId: randomUUID(),
        registrationState: 'quarantined',
      };

      await expect(snapshotStore.saveSnapshot(snap)).rejects.toThrow(/INVALID_REGISTRATION_STATE.*cannot be saved directly as quarantined/);
    });

    it('8.12. Directly persisting a snapshot as audit_committed via saveSnapshot() is rejected with INVALID_REGISTRATION_STATE', async () => {
      const commitSha = '8899000000000000000000000000000000000012';
      const snapId = randomUUID();

      const active = await consentRepo.getActiveGrant(ctxA, STUDENT_A, 'repo_verification');
      if (!active) {
        await consentRepo.grantConsent(ctxA, STUDENT_A, 'repo_verification', 1);
      }

      const rawBytes = Buffer.from('const direct = "audit_committed_invalid";\n', 'utf8');
      const snap: SourceSnapshot = {
        snapshotId: snapId,
        orgId: COLLEGE_A,
        studentId: STUDENT_A,
        repositoryId: REPO_A,
        commitSha,
        filePath: 'src/direct-audit.ts',
        rawBytes,
        rawFileHash: computeRawFileHash(rawBytes),
        blobSha: computeGitBlobSha(rawBytes),
        capturedAt: new Date().toISOString(),
        provenance: 'trusted_ingestion_pipeline',
        ingestionId: randomUUID(),
        registrationState: 'audit_committed',
      };

      await expect(snapshotStore.saveSnapshot(snap)).rejects.toThrow(/INVALID_REGISTRATION_STATE.*cannot be saved directly as audit_committed/);
    });

    it('8.13. Quarantined snapshot preserves historical ID, state, and bytes immutably even during re-ingestion under fresh consent', async () => {
      const commitSha = '8899000000000000000000000000000000000013';
      const snapId1 = randomUUID();
      const ingestionId1 = randomUUID();

      const active = await consentRepo.getActiveGrant(ctxA, STUDENT_A, 'repo_verification');
      if (!active) {
        await consentRepo.grantConsent(ctxA, STUDENT_A, 'repo_verification', 1);
      }

      const rawBytes1 = Buffer.from('const historical = "quarantined_v1";\n', 'utf8');
      const snap1: SourceSnapshot = {
        snapshotId: snapId1,
        orgId: COLLEGE_A,
        studentId: STUDENT_A,
        repositoryId: REPO_A,
        commitSha,
        filePath: 'src/preserve-quarantined.ts',
        rawBytes: rawBytes1,
        rawFileHash: computeRawFileHash(rawBytes1),
        blobSha: computeGitBlobSha(rawBytes1),
        capturedAt: new Date().toISOString(),
        provenance: 'trusted_ingestion_pipeline',
        ingestionId: ingestionId1,
        registrationState: 'pending_audit',
      };
      await snapshotStore.saveSnapshot(snap1);

      // Quarantined via dedicated method
      await snapshotStore.updateRegistrationState(
        REPO_A,
        commitSha,
        'src/preserve-quarantined.ts',
        COLLEGE_A,
        STUDENT_A,
        snapId1,
        'quarantined'
      );

      // Fresh generation under new ingestionId
      const snapId2 = randomUUID();
      const ingestionId2 = randomUUID();
      const rawBytes2 = Buffer.from('const historical = "fresh_generation_v2";\n', 'utf8');
      const snap2: SourceSnapshot = {
        snapshotId: snapId2,
        orgId: COLLEGE_A,
        studentId: STUDENT_A,
        repositoryId: REPO_A,
        commitSha,
        filePath: 'src/preserve-quarantined.ts',
        rawBytes: rawBytes2,
        rawFileHash: computeRawFileHash(rawBytes2),
        blobSha: computeGitBlobSha(rawBytes2),
        capturedAt: new Date().toISOString(),
        provenance: 'trusted_ingestion_pipeline',
        ingestionId: ingestionId2,
        registrationState: 'pending_audit',
      };
      await snapshotStore.saveSnapshot(snap2);

      // Promote fresh generation
      const promoted = await snapshotStore.updateRegistrationState(
        REPO_A,
        commitSha,
        'src/preserve-quarantined.ts',
        COLLEGE_A,
        STUDENT_A,
        snapId2,
        'audit_committed'
      );
      expect(promoted).toBe(true);

      // Verify both records exist and historical quarantined record is completely unmodified
      const client = await pool.connect();
      try {
        const res = await client.query(
          `SELECT snapshot_id, ingestion_id, registration_state, raw_bytes FROM source_snapshots WHERE repository_id = $1 AND commit_sha = $2 AND file_path = $3 ORDER BY captured_at ASC;`,
          [REPO_A, commitSha, 'src/preserve-quarantined.ts']
        );
        expect(res.rows.length).toBe(2);
        expect(res.rows[0].snapshot_id).toBe(snapId1);
        expect(res.rows[0].ingestion_id).toBe(ingestionId1);
        expect(res.rows[0].registration_state).toBe('quarantined');
        expect(res.rows[0].raw_bytes.toString('utf8')).toBe('const historical = "quarantined_v1";\n');

        expect(res.rows[1].snapshot_id).toBe(snapId2);
        expect(res.rows[1].ingestion_id).toBe(ingestionId2);
        expect(res.rows[1].registration_state).toBe('audit_committed');
        expect(res.rows[1].raw_bytes.toString('utf8')).toBe('const historical = "fresh_generation_v2";\n');
      } finally {
        client.release();
      }
    });
  });

  // =========================================================================
  // 9. Atomic Database-Level Consent Gate & Concurrency Race Verification
  // =========================================================================

  describe('9. Atomic Database-Level Consent Gate & Concurrency Race Verification', () => {
    const ctxA: SessionContext = {
      orgId: COLLEGE_A,
      userId: USER_A,
      role: 'student',
    };
    const ctxB: SessionContext = {
      orgId: COLLEGE_B,
      userId: USER_B,
      role: 'student',
    };

    it('9.1. Ordering A: Ingestion obtains consent lock first -> Snapshot registration occurs -> Revocation commits -> Final snapshot state is quarantined', async () => {
      // 1. Ensure student A has an active consent grant
      let activeGrant = await consentRepo.getActiveGrant(ctxA, STUDENT_A, 'repo_verification');
      if (!activeGrant) {
        activeGrant = await consentRepo.grantConsent(ctxA, STUDENT_A, 'repo_verification', 1);
      }
      expect(activeGrant).toBeDefined();

      const latchIngestionLocked = createLatch();

      const commitSha = 'aa11000000000000000000000000000000000001';
      const snapId = randomUUID();
      const rawBytes = Buffer.from('console.log("ordering A")', 'utf8');
      const rawFileHash = computeRawFileHash(rawBytes);
      const blobSha = computeGitBlobSha(rawBytes);

      // Ingestion worker transaction
      const ingestionPromise = (async () => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN;');
          await client.query('SET LOCAL ROLE app_api;');
          await client.query(`SELECT set_config('app.current_org_id', '${COLLEGE_A}', true);`);
          await client.query(`SELECT set_config('app.current_user_id', '${STUDENT_A}', true);`);
          await client.query(`SELECT set_config('app.current_user_role', 'student', true);`);

          // Acquire FOR SHARE on consent grant
          const lockRes = await client.query(`
            SELECT id FROM consent_grants
            WHERE student_id = $1 AND purpose = 'repo_verification' AND revoked_at IS NULL
            FOR SHARE;
          `, [STUDENT_A]);
          expect(lockRes.rows.length).toBe(1);

          // Signal that ingestion holds the consent lock
          latchIngestionLocked.resolve();

          // Wait deterministically until revocation's query is actively waiting for the row lock
          for (let i = 0; i < 50; i++) {
            const waitRes = await client.query(`
              SELECT count(*)::int as cnt FROM pg_stat_activity
              WHERE pid <> pg_backend_pid()
                AND wait_event_type = 'Lock'
                AND query ILIKE '%consent_grants%FOR UPDATE%';
            `);
            if (waitRes.rows[0].cnt > 0) {
              break;
            }
            await new Promise((resolve) => setImmediate(resolve));
          }

          // Insert source snapshot
          await client.query(`
            INSERT INTO source_snapshots (
              snapshot_id, org_id, student_id, repository_id, commit_sha, file_path,
              raw_bytes, raw_file_hash, blob_sha, captured_at, provenance, ingestion_id, registration_state
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, 'trusted_ingestion_pipeline', $10, 'pending_audit');
          `, [snapId, COLLEGE_A, STUDENT_A, REPO_A, commitSha, 'src/ordering-a.ts', rawBytes, rawFileHash, blobSha, randomUUID()]);

          await client.query('COMMIT;');
        } catch (err) {
          await client.query('ROLLBACK;').catch(() => { });
          throw err;
        } finally {
          client.release();
        }
      })();

      // Revocation worker transaction
      const revocationPromise = (async () => {
        // Wait until ingestion holds the lock
        await latchIngestionLocked.promise;

        // Perform revocation through consentRepo.revokeConsent
        const revResult = await consentRepo.revokeConsent(ctxA, activeGrant!.id);
        expect(revResult.success).toBe(true);
      })();

      await Promise.all([ingestionPromise, revocationPromise]);

      // Verify that after both complete, final snapshot state is quarantined
      const client = await pool.connect();
      try {
        const snapRes = await client.query(`
          SELECT registration_state FROM source_snapshots WHERE snapshot_id = $1;
        `, [snapId]);
        expect(snapRes.rows.length).toBe(1);
        expect(snapRes.rows[0].registration_state).toBe('quarantined');

        // Verify active consent is revoked
        const activePost = await consentRepo.getActiveGrant(ctxA, STUDENT_A, 'repo_verification');
        expect(activePost).toBeNull();
      } finally {
        client.release();
      }
    });

    it('9.2. Ordering B: Revocation commits first -> In-flight ingestion attempts persistence -> Rejected fail-closed with CONSENT_REQUIRED_OR_REVOKED', async () => {
      // Re-grant consent for STUDENT_A first
      const newGrant = await consentRepo.grantConsent(ctxA, STUDENT_A, 'repo_verification', 1);

      // Revoke consent first
      await consentRepo.revokeConsent(ctxA, newGrant.id);

      // Attempt to save snapshot
      const rawBytes = Buffer.from('console.log("ordering B")', 'utf8');
      const snap: SourceSnapshot = {
        snapshotId: randomUUID(),
        orgId: COLLEGE_A,
        studentId: STUDENT_A,
        repositoryId: REPO_A,
        commitSha: 'bb22000000000000000000000000000000000002',
        filePath: 'src/ordering-b.ts',
        rawBytes,
        rawFileHash: computeRawFileHash(rawBytes),
        blobSha: computeGitBlobSha(rawBytes),
        capturedAt: new Date().toISOString(),
        provenance: 'trusted_ingestion_pipeline',
        ingestionId: randomUUID(),
        registrationState: 'pending_audit',
      };

      await expect(snapshotStore.saveSnapshot(snap)).rejects.toThrow(/CONSENT_REQUIRED_OR_REVOKED/);

      // Attempt to save trusted ingestion record
      const tir: TrustedIngestionRecord = {
        ingestionId: randomUUID(),
        orgId: COLLEGE_A,
        repositoryId: REPO_A,
        commitSha: 'bb22000000000000000000000000000000000002',
        treeSha: 'cc33000000000000000000000000000000000003',
        studentId: STUDENT_A,
        verifiedAt: new Date().toISOString(),
        provenance: 'trusted_ingestion_pipeline',
        manifest: [
          {
            filePath: 'src/ordering-b.ts',
            blobSha: snap.blobSha!,
            rawFileHash: snap.rawFileHash,
            byteSize: rawBytes.length,
          },
        ],
      };

      await expect(trustedIngestionStore.saveRecord(tir)).rejects.toThrow(/CONSENT_REQUIRED_OR_REVOKED/);

      // Verify zero snapshots or records were persisted
      const client = await pool.connect();
      try {
        const snapCount = await client.query(`
          SELECT count(*) FROM source_snapshots WHERE commit_sha = $1;
        `, ['bb22000000000000000000000000000000000002']);
        expect(Number(snapCount.rows[0].count)).toBe(0);

        const tirCount = await client.query(`
          SELECT count(*) FROM trusted_ingestion_records WHERE commit_sha = $1;
        `, ['bb22000000000000000000000000000000000002']);
        expect(Number(tirCount.rows[0].count)).toBe(0);
      } finally {
        client.release();
      }
    });

    it('9.3. Audit promotion racing with revocation: quarantined snapshot cannot be promoted back to audit_committed', async () => {
      // Re-grant consent
      const grant = await consentRepo.grantConsent(ctxA, STUDENT_A, 'repo_verification', 1);

      const commitSha = 'cc44000000000000000000000000000000000004';
      const snapId = randomUUID();
      const rawBytes = Buffer.from('console.log("audit promotion race")', 'utf8');
      const snap: SourceSnapshot = {
        snapshotId: snapId,
        orgId: COLLEGE_A,
        studentId: STUDENT_A,
        repositoryId: REPO_A,
        commitSha,
        filePath: 'src/race.ts',
        rawBytes,
        rawFileHash: computeRawFileHash(rawBytes),
        blobSha: computeGitBlobSha(rawBytes),
        capturedAt: new Date().toISOString(),
        provenance: 'trusted_ingestion_pipeline',
        ingestionId: randomUUID(),
        registrationState: 'pending_audit',
      };

      // 1. Save in pending_audit state
      await snapshotStore.saveSnapshot(snap);

      // 2. Revocation runs and quarantines all snapshots
      await consentRepo.revokeConsent(ctxA, grant.id);

      // Verify snapshot is now quarantined
      const client = await pool.connect();
      try {
        const qRes = await client.query(`SELECT registration_state FROM source_snapshots WHERE snapshot_id = $1;`, [snapId]);
        expect(qRes.rows[0].registration_state).toBe('quarantined');
      } finally {
        client.release();
      }

      // 3. Stale in-flight worker attempts to promote to audit_committed
      const promoted = await snapshotStore.updateRegistrationState(
        REPO_A,
        commitSha,
        'src/race.ts',
        COLLEGE_A,
        STUDENT_A,
        snapId,
        'audit_committed'
      );

      // Promotion must be rejected
      expect(promoted).toBe(false);

      // Verify snapshot REMAINS quarantined and was NOT resurrected
      const client2 = await pool.connect();
      try {
        const checkRes = await client2.query(`SELECT registration_state FROM source_snapshots WHERE snapshot_id = $1;`, [snapId]);
        expect(checkRes.rows[0].registration_state).toBe('quarantined');
      } finally {
        client2.release();
      }
    });

    it("9.4. Job cancellation racing with updateJob('completed'): cancelled job fails closed and cannot be completed", async () => {
      const jId = randomUUID();
      await jobRepo.createJob({
        ingestionId: jId,
        orgId: COLLEGE_A,
        studentId: STUDENT_A,
        repositoryId: REPO_A,
        owner: 'test-owner',
        repo: 'test-race-job',
        ref: 'main',
        status: 'queued',
        fileCount: 0,
        retainedBytes: 0,
        registeredSnapshotsCount: 0,
        createdAt: new Date().toISOString(),
      });
      await jobRepo.updateJob(ctxA, jId, 'resolving');
      await jobRepo.updateJob(ctxA, jId, 'fetching');
      await jobRepo.updateJob(ctxA, jId, 'verifying');
      await jobRepo.updateJob(ctxA, jId, 'persisted', {
        fileCount: 3,
        retainedBytes: 500,
        registeredSnapshotsCount: 3,
      });

      // Cancellation occurs
      await jobRepo.cancelJobsForStudentOnRevocation(ctxA, STUDENT_A);

      // Concurrent attempt to complete fails
      await expect(
        jobRepo.updateJob(ctxA, jId, 'completed', { completedAt: new Date().toISOString() })
      ).rejects.toThrow(/JOB_ALREADY_FAILED/);

      const job = await jobRepo.getJob(ctxA, jId);
      expect(job?.status).toBe('failed');
      expect(job?.error).toBe('CONSENT_REVOKED');
    });

    it('9.5. All behavior works under restricted app_api transactions and tenant RLS', async () => {
      const jId = randomUUID();
      await jobRepo.createJob({
        ingestionId: jId,
        orgId: COLLEGE_A,
        studentId: STUDENT_A,
        repositoryId: REPO_A,
        owner: 'test-owner',
        repo: 'test-rls-job',
        ref: 'main',
        status: 'queued',
        fileCount: 0,
        retainedBytes: 0,
        registeredSnapshotsCount: 0,
        createdAt: new Date().toISOString(),
      });

      // COLLEGE_B cannot see or update COLLEGE_A's job
      const foreignJob = await jobRepo.getJob(ctxB, jId);
      expect(foreignJob).toBeNull();

      await expect(
        jobRepo.updateJob(ctxB, jId, 'resolving')
      ).rejects.toThrow(/JOB_NOT_FOUND/);
    });
  });

  // =========================================================================
  // 10. Migration Sequence Safety & Adversarial Conflict Verification (11 Fixtures)
  // =========================================================================

  describe('10. Migration Sequence Safety & Adversarial Conflict Verification (11 Fixtures)', () => {
    const migration011aPath = path.resolve(process.cwd(), 'db/migrations/011a_safe_repository_preflight.sql');
    const migration011aSql = fs.readFileSync(migration011aPath, 'utf8');
    const migration016Path = path.resolve(process.cwd(), 'db/migrations/016_safe_generation_reconciliation.sql');
    const migration016Sql = fs.readFileSync(migration016Path, 'utf8');

    it('10.1. Duplicate repositories without child records: safely reconciled to canonical repository', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN;');
        await client.query('ALTER TABLE repositories DROP CONSTRAINT IF EXISTS uq_repositories_student_provider_repo;');

        const repo1 = randomUUID();
        const repo2 = randomUUID();
        const providerRepoId = 'mig_dup_test_1';

        await client.query(`
          INSERT INTO repositories (id, student_id, provider, provider_repo_id, url, default_branch, consent_grant_id, imported_at) VALUES
            ('${repo1}', '${STUDENT_A}', 'github', '${providerRepoId}', 'https://github.com/test/repo1', 'main', '${CONSENT_A}', CURRENT_TIMESTAMP - INTERVAL '10 seconds'),
            ('${repo2}', '${STUDENT_A}', 'github', '${providerRepoId}', 'https://github.com/test/repo2', 'main', '${CONSENT_A}', CURRENT_TIMESTAMP);
        `);

        await client.query(migration011aSql);

        const res = await client.query(`
          SELECT id FROM repositories WHERE student_id = $1 AND provider_repo_id = $2;
        `, [STUDENT_A, providerRepoId]);
        expect(res.rows.length).toBe(1);
        expect(res.rows[0].id).toBe(repo1);

        await client.query('ROLLBACK;');
      } catch (err) {
        await client.query('ROLLBACK;').catch(() => { });
        throw err;
      } finally {
        await client.query('ROLLBACK;').catch(() => { });
        client.release();
      }
    });

    it('10.2. Duplicate repositories with non-colliding snapshots and evidence: safely re-parented to canonical repository', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN;');
        await client.query('ALTER TABLE repositories DROP CONSTRAINT IF EXISTS uq_repositories_student_provider_repo;');

        const repo1 = randomUUID();
        const repo2 = randomUUID();
        const providerRepoId = 'mig_dup_test_2';

        await client.query(`
          INSERT INTO repositories (id, student_id, provider, provider_repo_id, url, default_branch, consent_grant_id, imported_at) VALUES
            ('${repo1}', '${STUDENT_A}', 'github', '${providerRepoId}', 'https://github.com/test/repo1', 'main', '${CONSENT_A}', CURRENT_TIMESTAMP - INTERVAL '10 seconds'),
            ('${repo2}', '${STUDENT_A}', 'github', '${providerRepoId}', 'https://github.com/test/repo2', 'main', '${CONSENT_A}', CURRENT_TIMESTAMP);
        `);

        const snap1 = randomUUID();
        const snap2 = randomUUID();
        await client.query(`
          INSERT INTO repo_snapshots (id, repository_id, commit_sha, parser_version, tree_summary, imported_at) VALUES
            ('${snap1}', '${repo1}', '1111111111111111111111111111111111111111', 1, '{"files":1}'::jsonb, CURRENT_TIMESTAMP),
            ('${snap2}', '${repo2}', '2222222222222222222222222222222222222222', 1, '{"files":2}'::jsonb, CURRENT_TIMESTAMP);
        `);

        const evId = randomUUID();
        await client.query(`
          INSERT INTO evidence_items (id, student_id, repo_snapshot_id, kind, content_hash, status) VALUES
            ('${evId}', '${STUDENT_A}', '${snap2}', 'code_span', 'hash123', 'accepted');
        `);

        await client.query(migration011aSql);

        const repoRes = await client.query(`SELECT id FROM repositories WHERE id = $1;`, [repo2]);
        expect(repoRes.rows.length).toBe(0);

        const snapRes = await client.query(`SELECT repository_id FROM repo_snapshots WHERE id = $1;`, [snap2]);
        expect(snapRes.rows.length).toBe(1);
        expect(snapRes.rows[0].repository_id).toBe(repo1);

        const evRes = await client.query(`SELECT repo_snapshot_id FROM evidence_items WHERE id = $1;`, [evId]);
        expect(evRes.rows.length).toBe(1);
        expect(evRes.rows[0].repo_snapshot_id).toBe(snap2);

        await client.query('ROLLBACK;');
      } catch (err) {
        await client.query('ROLLBACK;').catch(() => { });
        throw err;
      } finally {
        await client.query('ROLLBACK;').catch(() => { });
        client.release();
      }
    });

    it('10.3. Duplicate repository snapshots with matching commit but divergent tree summaries: aborts with exception and preserves data', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN;');
        await client.query('ALTER TABLE repositories DROP CONSTRAINT IF EXISTS uq_repositories_student_provider_repo;');

        const repo1 = randomUUID();
        const repo2 = randomUUID();
        const providerRepoId = 'mig_dup_test_3';
        const commitSha = '3333333333333333333333333333333333333333';

        await client.query(`
          INSERT INTO repositories (id, student_id, provider, provider_repo_id, url, default_branch, consent_grant_id, imported_at) VALUES
            ('${repo1}', '${STUDENT_A}', 'github', '${providerRepoId}', 'https://github.com/test/repo1', 'main', '${CONSENT_A}', CURRENT_TIMESTAMP - INTERVAL '10 seconds'),
            ('${repo2}', '${STUDENT_A}', 'github', '${providerRepoId}', 'https://github.com/test/repo2', 'main', '${CONSENT_A}', CURRENT_TIMESTAMP);
        `);

        await client.query(`
          INSERT INTO repo_snapshots (id, repository_id, commit_sha, parser_version, tree_summary, imported_at) VALUES
            ('${randomUUID()}', '${repo1}', '${commitSha}', 1, '{"files":1}'::jsonb, CURRENT_TIMESTAMP),
            ('${randomUUID()}', '${repo2}', '${commitSha}', 1, '{"files":999}'::jsonb, CURRENT_TIMESTAMP);
        `);

        await expect(client.query(migration011aSql)).rejects.toThrow(/Divergent repo_snapshots detected/);

        await client.query('ROLLBACK;');
      } catch (err) {
        await client.query('ROLLBACK;').catch(() => { });
        throw err;
      } finally {
        await client.query('ROLLBACK;').catch(() => { });
        client.release();
      }
    });

    it('10.4. Duplicate source snapshots with identical bytes: safely deduplicated', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN;');
        await client.query('ALTER TABLE repositories DROP CONSTRAINT IF EXISTS uq_repositories_student_provider_repo;');

        const repo1 = randomUUID();
        const repo2 = randomUUID();
        const providerRepoId = 'mig_dup_test_4';
        const commitSha = '4444444444444444444444444444444444444444';

        await client.query(`
          INSERT INTO repositories (id, student_id, provider, provider_repo_id, url, default_branch, consent_grant_id, imported_at) VALUES
            ('${repo1}', '${STUDENT_A}', 'github', '${providerRepoId}', 'https://github.com/test/repo1', 'main', '${CONSENT_A}', CURRENT_TIMESTAMP - INTERVAL '10 seconds'),
            ('${repo2}', '${STUDENT_A}', 'github', '${providerRepoId}', 'https://github.com/test/repo2', 'main', '${CONSENT_A}', CURRENT_TIMESTAMP);
        `);

        const rawBytes = Buffer.from('console.log("identical")', 'utf8');
        const rawHash = computeRawFileHash(rawBytes);
        const blobSha = computeGitBlobSha(rawBytes);
        const snap1 = randomUUID();
        const snap2 = randomUUID();

        await client.query(`
          INSERT INTO source_snapshots (id, snapshot_id, org_id, student_id, repository_id, commit_sha, file_path, raw_bytes, raw_file_hash, blob_sha, captured_at, provenance, ingestion_id, registration_state) VALUES
            ('${randomUUID()}', '${snap1}', '${COLLEGE_A}', '${STUDENT_A}', '${repo1}', '${commitSha}', 'src/same.ts', $1, '${rawHash}', '${blobSha}', CURRENT_TIMESTAMP, 'trusted_ingestion_pipeline', '${randomUUID()}', 'audit_committed'),
            ('${randomUUID()}', '${snap2}', '${COLLEGE_A}', '${STUDENT_A}', '${repo2}', '${commitSha}', 'src/same.ts', $1, '${rawHash}', '${blobSha}', CURRENT_TIMESTAMP, 'trusted_ingestion_pipeline', '${randomUUID()}', 'audit_committed');
        `, [rawBytes]);

        await client.query(migration011aSql);

        const res = await client.query(`SELECT snapshot_id, repository_id FROM source_snapshots WHERE commit_sha = $1;`, [commitSha]);
        expect(res.rows.length).toBe(1);
        expect(res.rows[0].snapshot_id).toBe(snap1);
        expect(res.rows[0].repository_id).toBe(repo1);

        await client.query('ROLLBACK;');
      } catch (err) {
        await client.query('ROLLBACK;').catch(() => { });
        throw err;
      } finally {
        await client.query('ROLLBACK;').catch(() => { });
        client.release();
      }
    });

    it('10.5. Duplicate source snapshots with divergent raw hashes or bytes: aborts with exception and preserves data', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN;');
        await client.query('ALTER TABLE repositories DROP CONSTRAINT IF EXISTS uq_repositories_student_provider_repo;');

        const repo1 = randomUUID();
        const repo2 = randomUUID();
        const providerRepoId = 'mig_dup_test_5';
        const commitSha = '5555555555555555555555555555555555555555';

        await client.query(`
          INSERT INTO repositories (id, student_id, provider, provider_repo_id, url, default_branch, consent_grant_id, imported_at) VALUES
            ('${repo1}', '${STUDENT_A}', 'github', '${providerRepoId}', 'https://github.com/test/repo1', 'main', '${CONSENT_A}', CURRENT_TIMESTAMP - INTERVAL '10 seconds'),
            ('${repo2}', '${STUDENT_A}', 'github', '${providerRepoId}', 'https://github.com/test/repo2', 'main', '${CONSENT_A}', CURRENT_TIMESTAMP);
        `);

        const bytes1 = Buffer.from('console.log("file A")', 'utf8');
        const bytes2 = Buffer.from('console.log("file B divergent")', 'utf8');

        await client.query(`
          INSERT INTO source_snapshots (id, snapshot_id, org_id, student_id, repository_id, commit_sha, file_path, raw_bytes, raw_file_hash, blob_sha, captured_at, provenance, ingestion_id, registration_state) VALUES
            ('${randomUUID()}', '${randomUUID()}', '${COLLEGE_A}', '${STUDENT_A}', '${repo1}', '${commitSha}', 'src/div.ts', $1, '${computeRawFileHash(bytes1)}', '${computeGitBlobSha(bytes1)}', CURRENT_TIMESTAMP, 'trusted_ingestion_pipeline', '${randomUUID()}', 'audit_committed'),
            ('${randomUUID()}', '${randomUUID()}', '${COLLEGE_A}', '${STUDENT_A}', '${repo2}', '${commitSha}', 'src/div.ts', $2, '${computeRawFileHash(bytes2)}', '${computeGitBlobSha(bytes2)}', CURRENT_TIMESTAMP, 'trusted_ingestion_pipeline', '${randomUUID()}', 'audit_committed');
        `, [bytes1, bytes2]);

        await expect(client.query(migration011aSql)).rejects.toThrow(/Divergent source_snapshots detected/);

        await client.query('ROLLBACK;');
      } catch (err) {
        await client.query('ROLLBACK;').catch(() => { });
        throw err;
      } finally {
        await client.query('ROLLBACK;').catch(() => { });
        client.release();
      }
    });

    it('10.6. Duplicate trusted ingestion records with identical manifests: safely deduplicated', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN;');
        await client.query('ALTER TABLE repositories DROP CONSTRAINT IF EXISTS uq_repositories_student_provider_repo;');

        const repo1 = randomUUID();
        const repo2 = randomUUID();
        const providerRepoId = 'mig_dup_test_6';
        const commitSha = '6666666666666666666666666666666666666666';
        const treeSha = '7777777777777777777777777777777777777777';

        await client.query(`
          INSERT INTO repositories (id, student_id, provider, provider_repo_id, url, default_branch, consent_grant_id, imported_at) VALUES
            ('${repo1}', '${STUDENT_A}', 'github', '${providerRepoId}', 'https://github.com/test/repo1', 'main', '${CONSENT_A}', CURRENT_TIMESTAMP - INTERVAL '10 seconds'),
            ('${repo2}', '${STUDENT_A}', 'github', '${providerRepoId}', 'https://github.com/test/repo2', 'main', '${CONSENT_A}', CURRENT_TIMESTAMP);
        `);

        const manifest = JSON.stringify([{ filePath: 'src/main.ts', blobSha: 'abc', rawFileHash: 'def', byteSize: 10 }]);
        const ing1 = randomUUID();
        const ing2 = randomUUID();

        await client.query(`
          INSERT INTO trusted_ingestion_records (id, ingestion_id, org_id, student_id, repository_id, commit_sha, tree_sha, manifest, provenance, status, consent_grant_id) VALUES
            ('${randomUUID()}', '${ing1}', '${COLLEGE_A}', '${STUDENT_A}', '${repo1}', '${commitSha}', '${treeSha}', $1::jsonb, 'trusted_ingestion_pipeline', 'persisted', '${CONSENT_A}'),
            ('${randomUUID()}', '${ing2}', '${COLLEGE_A}', '${STUDENT_A}', '${repo2}', '${commitSha}', '${treeSha}', $1::jsonb, 'trusted_ingestion_pipeline', 'persisted', '${CONSENT_A}');
        `, [manifest]);

        await client.query(migration011aSql);

        const res = await client.query(`SELECT ingestion_id, repository_id FROM trusted_ingestion_records WHERE commit_sha = $1;`, [commitSha]);
        expect(res.rows.length).toBe(1);
        expect(res.rows[0].ingestion_id).toBe(ing1);
        expect(res.rows[0].repository_id).toBe(repo1);

        await client.query('ROLLBACK;');
      } catch (err) {
        await client.query('ROLLBACK;').catch(() => { });
        throw err;
      } finally {
        await client.query('ROLLBACK;').catch(() => { });
        client.release();
      }
    });

    it('10.7. Duplicate trusted ingestion records with divergent manifests: aborts with exception and preserves data', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN;');
        await client.query('ALTER TABLE repositories DROP CONSTRAINT IF EXISTS uq_repositories_student_provider_repo;');

        const repo1 = randomUUID();
        const repo2 = randomUUID();
        const providerRepoId = 'mig_dup_test_7';
        const commitSha = '7777777777777777777777777777777777777777';

        await client.query(`
          INSERT INTO repositories (id, student_id, provider, provider_repo_id, url, default_branch, consent_grant_id, imported_at) VALUES
            ('${repo1}', '${STUDENT_A}', 'github', '${providerRepoId}', 'https://github.com/test/repo1', 'main', '${CONSENT_A}', CURRENT_TIMESTAMP - INTERVAL '10 seconds'),
            ('${repo2}', '${STUDENT_A}', 'github', '${providerRepoId}', 'https://github.com/test/repo2', 'main', '${CONSENT_A}', CURRENT_TIMESTAMP);
        `);

        const manifest1 = JSON.stringify([{ filePath: 'src/file1.ts', blobSha: 'a', rawFileHash: 'b', byteSize: 5 }]);
        const manifest2 = JSON.stringify([{ filePath: 'src/file2.ts', blobSha: 'c', rawFileHash: 'd', byteSize: 8 }]);

        await client.query(`
          INSERT INTO trusted_ingestion_records (id, ingestion_id, org_id, student_id, repository_id, commit_sha, tree_sha, manifest, provenance, status, consent_grant_id) VALUES
            ('${randomUUID()}', '${randomUUID()}', '${COLLEGE_A}', '${STUDENT_A}', '${repo1}', '${commitSha}', 'tree1', $1::jsonb, 'trusted_ingestion_pipeline', 'persisted', '${CONSENT_A}'),
            ('${randomUUID()}', '${randomUUID()}', '${COLLEGE_A}', '${STUDENT_A}', '${repo2}', '${commitSha}', 'tree1', $2::jsonb, 'trusted_ingestion_pipeline', 'persisted', '${CONSENT_A}');
        `, [manifest1, manifest2]);

        await expect(client.query(migration011aSql)).rejects.toThrow(/Divergent trusted_ingestion_records detected/);

        await client.query('ROLLBACK;');
      } catch (err) {
        await client.query('ROLLBACK;').catch(() => { });
        throw err;
      } finally {
        await client.query('ROLLBACK;').catch(() => { });
        client.release();
      }
    });

    it('10.8. Correct reconciliation of source snapshot ingestion IDs: surviving canonical ID assigned, zero orphaned IDs', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN;');
        await client.query('ALTER TABLE repositories DROP CONSTRAINT IF EXISTS uq_repositories_student_provider_repo;');

        const repo1 = randomUUID();
        const repo2 = randomUUID();
        const providerRepoId = 'mig_dup_test_8';
        const commitSha = '8888888888888888888888888888888888888888';
        const treeSha = '8888888888888888888888888888888888888888';

        await client.query(`
          INSERT INTO repositories (id, student_id, provider, provider_repo_id, url, default_branch, consent_grant_id, imported_at) VALUES
            ('${repo1}', '${STUDENT_A}', 'github', '${providerRepoId}', 'https://github.com/test/repo1', 'main', '${CONSENT_A}', CURRENT_TIMESTAMP - INTERVAL '10 seconds'),
            ('${repo2}', '${STUDENT_A}', 'github', '${providerRepoId}', 'https://github.com/test/repo2', 'main', '${CONSENT_A}', CURRENT_TIMESTAMP);
        `);

        const canonIngestionId = randomUUID();
        const dupIngestionId = randomUUID();
        const manifest = JSON.stringify([{ filePath: 'src/main.ts', blobSha: 'a', rawFileHash: 'b', byteSize: 5 }]);

        await client.query(`
          INSERT INTO trusted_ingestion_records (id, ingestion_id, org_id, student_id, repository_id, commit_sha, tree_sha, manifest, provenance, status, consent_grant_id) VALUES
            ('${randomUUID()}', '${canonIngestionId}', '${COLLEGE_A}', '${STUDENT_A}', '${repo1}', '${commitSha}', '${treeSha}', $1::jsonb, 'trusted_ingestion_pipeline', 'persisted', '${CONSENT_A}'),
            ('${randomUUID()}', '${dupIngestionId}', '${COLLEGE_A}', '${STUDENT_A}', '${repo2}', '${commitSha}', '${treeSha}', $1::jsonb, 'trusted_ingestion_pipeline', 'persisted', '${CONSENT_A}');
        `, [manifest]);

        const snap2 = randomUUID();
        const rawBytes = Buffer.from('main', 'utf8');
        await client.query(`
          INSERT INTO source_snapshots (id, snapshot_id, org_id, student_id, repository_id, commit_sha, file_path, raw_bytes, raw_file_hash, blob_sha, captured_at, provenance, ingestion_id, registration_state) VALUES
            ('${randomUUID()}', '${snap2}', '${COLLEGE_A}', '${STUDENT_A}', '${repo2}', '${commitSha}', 'src/main.ts', $1, '${computeRawFileHash(rawBytes)}', '${computeGitBlobSha(rawBytes)}', CURRENT_TIMESTAMP, 'trusted_ingestion_pipeline', '${dupIngestionId}', 'audit_committed');
        `, [rawBytes]);

        await client.query(migration011aSql);

        const snapRes = await client.query(`SELECT ingestion_id, repository_id FROM source_snapshots WHERE snapshot_id = $1;`, [snap2]);
        expect(snapRes.rows.length).toBe(1);
        expect(snapRes.rows[0].ingestion_id).toBe(canonIngestionId);
        expect(snapRes.rows[0].repository_id).toBe(repo1);

        const orphanRes = await client.query(`SELECT count(*) FROM source_snapshots WHERE ingestion_id = $1;`, [dupIngestionId]);
        expect(Number(orphanRes.rows[0].count)).toBe(0);

        await client.query('ROLLBACK;');
      } catch (err) {
        await client.query('ROLLBACK;').catch(() => { });
        throw err;
      } finally {
        await client.query('ROLLBACK;').catch(() => { });
        client.release();
      }
    });

    it('10.9. Full fresh-database migration ordering: 011a sorts strictly between 011 and 012 in lexical sequence', () => {
      const migrationsDir = path.resolve(process.cwd(), 'db/migrations');
      const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort((a, b) => a.localeCompare(b));

      const idx011 = files.findIndex((f) => f.startsWith('011_'));
      const idx011a = files.findIndex((f) => f.startsWith('011a_'));
      const idx012 = files.findIndex((f) => f.startsWith('012_'));
      const idx013 = files.findIndex((f) => f.startsWith('013_'));
      const idx014 = files.findIndex((f) => f.startsWith('014_'));

      expect(idx011).toBeGreaterThanOrEqual(0);
      expect(idx011a).toBeGreaterThan(idx011);
      expect(idx012).toBeGreaterThan(idx011a);
      expect(idx013).toBeGreaterThan(idx012);
      expect(idx014).toBeGreaterThan(idx013);
    });

    it('10.10. Upgrade behavior when migration 012 is already recorded: 011a applies idempotently without failure', async () => {
      const client = await pool.connect();
      try {
        await expect(client.query(migration011aSql)).resolves.toBeDefined();
      } finally {
        client.release();
      }
    });

    it('10.11. Rollback and data preservation when reconciliation detects ambiguity: transaction aborts, data untouched', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN;');
        await client.query('ALTER TABLE repositories DROP CONSTRAINT IF EXISTS uq_repositories_student_provider_repo;');

        const repo1 = randomUUID();
        const repo2 = randomUUID();
        const providerRepoId = 'mig_dup_test_11';
        const commitSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

        await client.query(`
          INSERT INTO repositories (id, student_id, provider, provider_repo_id, url, default_branch, consent_grant_id, imported_at) VALUES
            ('${repo1}', '${STUDENT_A}', 'github', '${providerRepoId}', 'https://github.com/test/repo1', 'main', '${CONSENT_A}', CURRENT_TIMESTAMP - INTERVAL '10 seconds'),
            ('${repo2}', '${STUDENT_A}', 'github', '${providerRepoId}', 'https://github.com/test/repo2', 'main', '${CONSENT_A}', CURRENT_TIMESTAMP);
        `);

        await client.query('SAVEPOINT sp_ambiguity;');
        const b1 = Buffer.from('file 1', 'utf8');
        const b2 = Buffer.from('file 2 divergent', 'utf8');
        const ingId1 = randomUUID();
        const ingId2 = randomUUID();

        // Put both in same ingestion generation to test divergent detection
        await client.query(`
          INSERT INTO trusted_ingestion_records (id, ingestion_id, org_id, student_id, repository_id, commit_sha, tree_sha, manifest, provenance, status, consent_grant_id) VALUES
            ('${randomUUID()}', '${ingId1}', '${COLLEGE_A}', '${STUDENT_A}', '${repo1}', '${commitSha}', '1111000000000000000000000000000000000001', '[]'::jsonb, 'trusted_ingestion_pipeline', 'persisted', '${CONSENT_A}'),
            ('${randomUUID()}', '${ingId2}', '${COLLEGE_A}', '${STUDENT_A}', '${repo2}', '${commitSha}', '1111000000000000000000000000000000000001', '[]'::jsonb, 'trusted_ingestion_pipeline', 'persisted', '${CONSENT_A}');
        `);

        await client.query(`
          INSERT INTO source_snapshots (id, snapshot_id, org_id, student_id, repository_id, commit_sha, file_path, raw_bytes, raw_file_hash, blob_sha, captured_at, provenance, ingestion_id, registration_state) VALUES
            ('${randomUUID()}', '${randomUUID()}', '${COLLEGE_A}', '${STUDENT_A}', '${repo1}', '${commitSha}', 'src/ambig.ts', $1, '${computeRawFileHash(b1)}', '${computeGitBlobSha(b1)}', CURRENT_TIMESTAMP, 'trusted_ingestion_pipeline', '${ingId1}', 'audit_committed'),
            ('${randomUUID()}', '${randomUUID()}', '${COLLEGE_A}', '${STUDENT_A}', '${repo2}', '${commitSha}', 'src/ambig.ts', $2, '${computeRawFileHash(b2)}', '${computeGitBlobSha(b2)}', CURRENT_TIMESTAMP, 'trusted_ingestion_pipeline', '${ingId2}', 'audit_committed');
        `, [b1, b2]);

        await expect(client.query(migration016Sql)).rejects.toThrow(/Divergent source_snapshots detected/);

        await client.query('ROLLBACK TO SAVEPOINT sp_ambiguity;');

        const checkRepos = await client.query(`SELECT id FROM repositories WHERE id IN ($1, $2);`, [repo1, repo2]);
        expect(checkRepos.rows.length).toBe(2);

        await client.query('ROLLBACK;');
      } catch (err) {
        await client.query('ROLLBACK;').catch(() => { });
        throw err;
      } finally {
        await client.query('ROLLBACK;').catch(() => { });
        client.release();
      }
    });

    it('10.12. Conflicting source_snapshots provenance on duplicate repositories: aborts with exception and preserves data', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN;');
        await client.query('ALTER TABLE repositories DROP CONSTRAINT IF EXISTS uq_repositories_student_provider_repo;');

        const repo1 = randomUUID();
        const repo2 = randomUUID();
        const providerRepoId = 'mig_dup_test_12';
        const commitSha = 'cccccccccccccccccccccccccccccccccccccccc';
        const ingId1 = randomUUID();
        const ingId2 = randomUUID();

        await client.query(`
          INSERT INTO repositories (id, student_id, provider, provider_repo_id, url, default_branch, consent_grant_id, imported_at) VALUES
            ('${repo1}', '${STUDENT_A}', 'github', '${providerRepoId}', 'https://github.com/test/repo1', 'main', '${CONSENT_A}', CURRENT_TIMESTAMP - INTERVAL '10 seconds'),
            ('${repo2}', '${STUDENT_A}', 'github', '${providerRepoId}', 'https://github.com/test/repo2', 'main', '${CONSENT_A}', CURRENT_TIMESTAMP);
        `);

        await client.query(`
          INSERT INTO trusted_ingestion_records (id, ingestion_id, org_id, student_id, repository_id, commit_sha, tree_sha, manifest, provenance, status, consent_grant_id) VALUES
            ('${randomUUID()}', '${ingId1}', '${COLLEGE_A}', '${STUDENT_A}', '${repo1}', '${commitSha}', '1111000000000000000000000000000000000001', '[]'::jsonb, 'trusted_ingestion_pipeline', 'persisted', '${CONSENT_A}'),
            ('${randomUUID()}', '${ingId2}', '${COLLEGE_A}', '${STUDENT_A}', '${repo2}', '${commitSha}', '1111000000000000000000000000000000000001', '[]'::jsonb, 'trusted_ingestion_pipeline', 'persisted', '${CONSENT_A}');
        `);

        const b = Buffer.from('file identical bytes', 'utf8');
        await client.query(`
          INSERT INTO source_snapshots (id, snapshot_id, org_id, student_id, repository_id, commit_sha, file_path, raw_bytes, raw_file_hash, blob_sha, captured_at, provenance, ingestion_id, registration_state) VALUES
            ('${randomUUID()}', '${randomUUID()}', '${COLLEGE_A}', '${STUDENT_A}', '${repo1}', '${commitSha}', 'src/prov.ts', $1, '${computeRawFileHash(b)}', '${computeGitBlobSha(b)}', CURRENT_TIMESTAMP, 'trusted_ingestion_pipeline', '${ingId1}', 'audit_committed'),
            ('${randomUUID()}', '${randomUUID()}', '${COLLEGE_A}', '${STUDENT_A}', '${repo2}', '${commitSha}', 'src/prov.ts', $1, '${computeRawFileHash(b)}', '${computeGitBlobSha(b)}', CURRENT_TIMESTAMP, 'unverified_client_input', '${ingId2}', 'audit_committed');
        `, [b]);

        await expect(client.query(migration016Sql)).rejects.toThrow(/Divergent source_snapshots provenance detected/);

        await client.query('ROLLBACK;');
      } catch (err) {
        await client.query('ROLLBACK;').catch(() => { });
        throw err;
      } finally {
        await client.query('ROLLBACK;').catch(() => { });
        client.release();
      }
    });

    it('10.13. Conflicting registration_state on duplicate source_snapshots (quarantined vs audit_committed): conservatively updates canonical to quarantined', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN;');
        await client.query('ALTER TABLE repositories DROP CONSTRAINT IF EXISTS uq_repositories_student_provider_repo;');

        const repo1 = randomUUID();
        const repo2 = randomUUID();
        const providerRepoId = 'mig_dup_test_13';
        const commitSha = 'dddddddddddddddddddddddddddddddddddddddd';
        const ingId1 = randomUUID();
        const ingId2 = randomUUID();

        await client.query(`
          INSERT INTO repositories (id, student_id, provider, provider_repo_id, url, default_branch, consent_grant_id, imported_at) VALUES
            ('${repo1}', '${STUDENT_A}', 'github', '${providerRepoId}', 'https://github.com/test/repo1', 'main', '${CONSENT_A}', CURRENT_TIMESTAMP - INTERVAL '10 seconds'),
            ('${repo2}', '${STUDENT_A}', 'github', '${providerRepoId}', 'https://github.com/test/repo2', 'main', '${CONSENT_A}', CURRENT_TIMESTAMP);
        `);

        await client.query(`
          INSERT INTO trusted_ingestion_records (id, ingestion_id, org_id, student_id, repository_id, commit_sha, tree_sha, manifest, provenance, status, consent_grant_id) VALUES
            ('${randomUUID()}', '${ingId1}', '${COLLEGE_A}', '${STUDENT_A}', '${repo1}', '${commitSha}', '1111000000000000000000000000000000000001', '[]'::jsonb, 'trusted_ingestion_pipeline', 'persisted', '${CONSENT_A}'),
            ('${randomUUID()}', '${ingId2}', '${COLLEGE_A}', '${STUDENT_A}', '${repo2}', '${commitSha}', '1111000000000000000000000000000000000001', '[]'::jsonb, 'trusted_ingestion_pipeline', 'persisted', '${CONSENT_A}');
        `);

        const b = Buffer.from('file state check', 'utf8');
        const snap1 = randomUUID();
        const snap2 = randomUUID();
        await client.query(`
          INSERT INTO source_snapshots (id, snapshot_id, org_id, student_id, repository_id, commit_sha, file_path, raw_bytes, raw_file_hash, blob_sha, captured_at, provenance, ingestion_id, registration_state) VALUES
            ('${randomUUID()}', '${snap1}', '${COLLEGE_A}', '${STUDENT_A}', '${repo1}', '${commitSha}', 'src/state.ts', $1, '${computeRawFileHash(b)}', '${computeGitBlobSha(b)}', CURRENT_TIMESTAMP, 'trusted_ingestion_pipeline', '${ingId1}', 'audit_committed'),
            ('${randomUUID()}', '${snap2}', '${COLLEGE_A}', '${STUDENT_A}', '${repo2}', '${commitSha}', 'src/state.ts', $1, '${computeRawFileHash(b)}', '${computeGitBlobSha(b)}', CURRENT_TIMESTAMP, 'trusted_ingestion_pipeline', '${ingId2}', 'quarantined');
        `, [b]);

        await client.query(migration016Sql);

        const res = await client.query(`SELECT snapshot_id, registration_state FROM source_snapshots WHERE repository_id = $1 AND commit_sha = $2;`, [repo1, commitSha]);
        expect(res.rows.length).toBe(1);
        expect(res.rows[0].snapshot_id).toBe(snap1);
        expect(res.rows[0].registration_state).toBe('quarantined');

        await client.query('ROLLBACK;');
      } catch (err) {
        await client.query('ROLLBACK;').catch(() => { });
        throw err;
      } finally {
        await client.query('ROLLBACK;').catch(() => { });
        client.release();
      }
    });

    it('10.14. Conflicting trusted_ingestion_records status within same generation (revoked vs persisted): aborts fail-closed and preserves data', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN;');
        await client.query('ALTER TABLE repositories DROP CONSTRAINT IF EXISTS uq_repositories_student_provider_repo;');

        const repo1 = randomUUID();
        const repo2 = randomUUID();
        const providerRepoId = 'mig_dup_test_14';
        const commitSha = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
        const treeSha = '1111000000000000000000000000000000000001';

        await client.query(`
          INSERT INTO repositories (id, student_id, provider, provider_repo_id, url, default_branch, consent_grant_id, imported_at) VALUES
            ('${repo1}', '${STUDENT_A}', 'github', '${providerRepoId}', 'https://github.com/test/repo1', 'main', '${CONSENT_A}', CURRENT_TIMESTAMP - INTERVAL '10 seconds'),
            ('${repo2}', '${STUDENT_A}', 'github', '${providerRepoId}', 'https://github.com/test/repo2', 'main', '${CONSENT_A}', CURRENT_TIMESTAMP);
        `);

        const manifest = JSON.stringify([{ filePath: 'src/file.ts', blobSha: 'a', rawFileHash: 'b', byteSize: 5 }]);

        await client.query(`
          INSERT INTO trusted_ingestion_records (id, ingestion_id, org_id, student_id, repository_id, commit_sha, tree_sha, manifest, provenance, status, consent_grant_id) VALUES
            ('${randomUUID()}', '${randomUUID()}', '${COLLEGE_A}', '${STUDENT_A}', '${repo1}', '${commitSha}', '${treeSha}', $1::jsonb, 'trusted_ingestion_pipeline', 'persisted', '${CONSENT_A}'),
            ('${randomUUID()}', '${randomUUID()}', '${COLLEGE_A}', '${STUDENT_A}', '${repo2}', '${commitSha}', '${treeSha}', $1::jsonb, 'trusted_ingestion_pipeline', 'revoked', '${CONSENT_A}');
        `, [manifest]);

        await expect(client.query(migration016Sql)).rejects.toThrow(/Conflicting trusted_ingestion_records status detected/);

        await client.query('ROLLBACK;');
      } catch (err) {
        await client.query('ROLLBACK;').catch(() => { });
        throw err;
      } finally {
        await client.query('ROLLBACK;').catch(() => { });
        client.release();
      }
    });

    it('10.15. Distinct consent generations across duplicate repositories: both generations survive under canonical repository without deletion', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN;');
        await client.query('ALTER TABLE repositories DROP CONSTRAINT IF EXISTS uq_repositories_student_provider_repo;');

        const repo1 = randomUUID();
        const repo2 = randomUUID();
        const providerRepoId = 'mig_dup_test_15';
        const commitSha1 = 'ffffffffffffffffffffffffffffffffffffffff';
        const commitSha2 = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
        const treeSha = '2222000000000000000000000000000000000002';

        await client.query(`
          INSERT INTO repositories (id, student_id, provider, provider_repo_id, url, default_branch, consent_grant_id, imported_at) VALUES
            ('${repo1}', '${STUDENT_A}', 'github', '${providerRepoId}', 'https://github.com/test/repo1', 'main', '${CONSENT_A}', CURRENT_TIMESTAMP - INTERVAL '10 seconds'),
            ('${repo2}', '${STUDENT_A}', 'github', '${providerRepoId}', 'https://github.com/test/repo2', 'main', '${CONSENT_B}', CURRENT_TIMESTAMP);
        `);

        const manifest = JSON.stringify([{ filePath: 'src/file.ts', blobSha: 'a', rawFileHash: 'b', byteSize: 5 }]);
        const ing1 = randomUUID();
        const ing2 = randomUUID();

        await client.query(`
          INSERT INTO trusted_ingestion_records (id, ingestion_id, org_id, student_id, repository_id, commit_sha, tree_sha, manifest, provenance, status, consent_grant_id) VALUES
            ('${randomUUID()}', '${ing1}', '${COLLEGE_A}', '${STUDENT_A}', '${repo1}', '${commitSha1}', '${treeSha}', $1::jsonb, 'trusted_ingestion_pipeline', 'persisted', '${CONSENT_A}'),
            ('${randomUUID()}', '${ing2}', '${COLLEGE_A}', '${STUDENT_A}', '${repo2}', '${commitSha2}', '${treeSha}', $1::jsonb, 'trusted_ingestion_pipeline', 'persisted', '${CONSENT_B}');
        `, [manifest]);

        await client.query(migration016Sql);

        // BOTH generations must survive under canonical repo1!
        const res = await client.query(
          `SELECT ingestion_id, repository_id, consent_grant_id FROM trusted_ingestion_records WHERE repository_id = $1 ORDER BY consent_grant_id ASC;`,
          [repo1]
        );
        expect(res.rows.length).toBe(2);
        expect(res.rows[0].repository_id).toBe(repo1);
        expect(res.rows[1].repository_id).toBe(repo1);

        await client.query('ROLLBACK;');
      } catch (err) {
        await client.query('ROLLBACK;').catch(() => { });
        throw err;
      } finally {
        await client.query('ROLLBACK;').catch(() => { });
        client.release();
      }
    });

    it('10.16. Revoked historical generation alongside persisted newer generation: both generations preserved', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN;');
        await client.query('ALTER TABLE repositories DROP CONSTRAINT IF EXISTS uq_repositories_student_provider_repo;');

        const repo1 = randomUUID();
        const repo2 = randomUUID();
        const providerRepoId = 'mig_dup_test_16';
        const commitSha = '1616161616161616161616161616161616161616';
        const treeSha = '3333000000000000000000000000000000000003';

        await client.query(`
          INSERT INTO repositories (id, student_id, provider, provider_repo_id, url, default_branch, consent_grant_id, imported_at) VALUES
            ('${repo1}', '${STUDENT_A}', 'github', '${providerRepoId}', 'https://github.com/test/repo1', 'main', '${CONSENT_A}', CURRENT_TIMESTAMP - INTERVAL '10 seconds'),
            ('${repo2}', '${STUDENT_A}', 'github', '${providerRepoId}', 'https://github.com/test/repo2', 'main', '${CONSENT_B}', CURRENT_TIMESTAMP);
        `);

        const manifest = JSON.stringify([{ filePath: 'src/gen.ts', blobSha: 'a', rawFileHash: 'b', byteSize: 5 }]);
        const ingHistorical = randomUUID();
        const ingCurrent = randomUUID();

        await client.query(`
          INSERT INTO trusted_ingestion_records (id, ingestion_id, org_id, student_id, repository_id, commit_sha, tree_sha, manifest, provenance, status, consent_grant_id) VALUES
            ('${randomUUID()}', '${ingHistorical}', '${COLLEGE_A}', '${STUDENT_A}', '${repo1}', '${commitSha}', '${treeSha}', $1::jsonb, 'trusted_ingestion_pipeline', 'revoked', '${CONSENT_A}'),
            ('${randomUUID()}', '${ingCurrent}', '${COLLEGE_A}', '${STUDENT_A}', '${repo2}', '${commitSha}', '${treeSha}', $1::jsonb, 'trusted_ingestion_pipeline', 'persisted', '${CONSENT_B}');
        `, [manifest]);

        await client.query(migration016Sql);

        const res = await client.query(
          `SELECT ingestion_id, repository_id, status FROM trusted_ingestion_records WHERE commit_sha = $1 ORDER BY status ASC;`,
          [commitSha]
        );
        expect(res.rows.length).toBe(2);
        expect(res.rows[0].status).toBe('persisted');
        expect(res.rows[0].repository_id).toBe(repo1);
        expect(res.rows[1].status).toBe('revoked');
        expect(res.rows[1].repository_id).toBe(repo1);

        await client.query('ROLLBACK;');
      } catch (err) {
        await client.query('ROLLBACK;').catch(() => { });
        throw err;
      } finally {
        await client.query('ROLLBACK;').catch(() => { });
        client.release();
      }
    });

    it('10.17. Source snapshots belonging to distinct ingestion generations: both sets preserved without deletion', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN;');
        await client.query('ALTER TABLE repositories DROP CONSTRAINT IF EXISTS uq_repositories_student_provider_repo;');

        const repo1 = randomUUID();
        const repo2 = randomUUID();
        const providerRepoId = 'mig_dup_test_17';
        const commitSha = '1717171717171717171717171717171717171717';

        await client.query(`
          INSERT INTO repositories (id, student_id, provider, provider_repo_id, url, default_branch, consent_grant_id, imported_at) VALUES
            ('${repo1}', '${STUDENT_A}', 'github', '${providerRepoId}', 'https://github.com/test/repo1', 'main', '${CONSENT_A}', CURRENT_TIMESTAMP - INTERVAL '10 seconds'),
            ('${repo2}', '${STUDENT_A}', 'github', '${providerRepoId}', 'https://github.com/test/repo2', 'main', '${CONSENT_B}', CURRENT_TIMESTAMP);
        `);

        const ing1 = randomUUID();
        const ing2 = randomUUID();

        await client.query(`
          INSERT INTO trusted_ingestion_records (id, ingestion_id, org_id, student_id, repository_id, commit_sha, tree_sha, manifest, provenance, status, consent_grant_id) VALUES
            ('${randomUUID()}', '${ing1}', '${COLLEGE_A}', '${STUDENT_A}', '${repo1}', '${commitSha}', '4444000000000000000000000000000000000004', '[]'::jsonb, 'trusted_ingestion_pipeline', 'revoked', '${CONSENT_A}'),
            ('${randomUUID()}', '${ing2}', '${COLLEGE_A}', '${STUDENT_A}', '${repo2}', '${commitSha}', '4444000000000000000000000000000000000004', '[]'::jsonb, 'trusted_ingestion_pipeline', 'persisted', '${CONSENT_B}');
        `);

        const bytes = Buffer.from('console.log("snapshots in generations");\n', 'utf8');
        const snap1 = randomUUID();
        const snap2 = randomUUID();

        await client.query(`
          INSERT INTO source_snapshots (id, snapshot_id, org_id, student_id, repository_id, commit_sha, file_path, raw_bytes, raw_file_hash, blob_sha, captured_at, provenance, ingestion_id, registration_state) VALUES
            ('${randomUUID()}', '${snap1}', '${COLLEGE_A}', '${STUDENT_A}', '${repo1}', '${commitSha}', 'src/snap.ts', $1, '${computeRawFileHash(bytes)}', '${computeGitBlobSha(bytes)}', CURRENT_TIMESTAMP, 'trusted_ingestion_pipeline', '${ing1}', 'quarantined'),
            ('${randomUUID()}', '${snap2}', '${COLLEGE_A}', '${STUDENT_A}', '${repo2}', '${commitSha}', 'src/snap.ts', $1, '${computeRawFileHash(bytes)}', '${computeGitBlobSha(bytes)}', CURRENT_TIMESTAMP, 'trusted_ingestion_pipeline', '${ing2}', 'audit_committed');
        `, [bytes]);

        await client.query(migration016Sql);

        const snapCheck = await client.query(
          `SELECT snapshot_id, repository_id, ingestion_id, registration_state FROM source_snapshots WHERE commit_sha = $1 ORDER BY registration_state ASC;`,
          [commitSha]
        );
        expect(snapCheck.rows.length).toBe(2);
        expect(snapCheck.rows[0].snapshot_id).toBe(snap2);
        expect(snapCheck.rows[0].repository_id).toBe(repo1);
        expect(snapCheck.rows[0].registration_state).toBe('audit_committed');

        expect(snapCheck.rows[1].snapshot_id).toBe(snap1);
        expect(snapCheck.rows[1].repository_id).toBe(repo1);
        expect(snapCheck.rows[1].registration_state).toBe('quarantined');

        await client.query('ROLLBACK;');
      } catch (err) {
        await client.query('ROLLBACK;').catch(() => { });
        throw err;
      } finally {
        await client.query('ROLLBACK;').catch(() => { });
        client.release();
      }
    });

    it('10.18. Ambiguous historical generation ownership (NULL consent grant with multiple candidate grants): aborts fail-closed', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN;');

        const repo = randomUUID();
        const unlinkedIng = randomUUID();

        // Repo has valid consent_grant_id
        await client.query(`
          INSERT INTO repositories (id, student_id, provider, provider_repo_id, url, default_branch, consent_grant_id, imported_at) VALUES
            ('${repo}', '${STUDENT_A}', 'github', 'mig_dup_test_18', 'https://github.com/test/repo18', 'main', '${CONSENT_A}', CURRENT_TIMESTAMP);
        `);

        // Record has NULL consent_grant_id and student has at least 2 grants (CONSENT_A and active)
        await client.query(`
          INSERT INTO trusted_ingestion_records (id, ingestion_id, org_id, student_id, repository_id, commit_sha, tree_sha, manifest, provenance, status, consent_grant_id) VALUES
            ('${randomUUID()}', '${unlinkedIng}', '${COLLEGE_A}', '${STUDENT_A}', '${repo}', '1818181818181818181818181818181818181818', '5555000000000000000000000000000000000005', '[]'::jsonb, 'trusted_ingestion_pipeline', 'persisted', NULL);
        `);

        await expect(client.query(migration016Sql)).rejects.toThrow(/Ambiguous consent generation/);

        await client.query('ROLLBACK;');
      } catch (err) {
        await client.query('ROLLBACK;').catch(() => { });
        throw err;
      } finally {
        await client.query('ROLLBACK;').catch(() => { });
        client.release();
      }
    });

    it('10.19. Upgrade database whose migration ledger contains previous 011a checksum succeeds without rewriting ledger', async () => {
      const client = await pool.connect();
      try {
        const res = await client.query(`SELECT version, checksum FROM schema_migrations WHERE version = '011a';`);
        expect(res.rows.length).toBe(1);

        const fileContent = fs.readFileSync(
          path.resolve(__dirname, '..', 'migrations', '011a_safe_repository_preflight.sql'),
          'utf8'
        );
        const currentChecksum = computeChecksum(fileContent);
        const validChecksums = [currentChecksum, ...(HISTORICAL_MIGRATION_CHECKSUMS['011a'] || [])];
        expect(validChecksums).toContain(res.rows[0].checksum);

        const migResult = await runMigrations();
        expect(migResult.total).toBeGreaterThanOrEqual(18);
        expect(migResult.newlyApplied).toBe(0);
        expect(migResult.skipped).toBe(migResult.total);
      } finally {
        client.release();
      }
    });
  });

  // =========================================================================
  // 11. End-to-End Fresh Re-ingestion After Re-Consent (Migration 015)
  // =========================================================================

  describe('11. End-to-End Fresh Re-ingestion After Re-Consent (Migration 015)', () => {
    const ctxA: SessionContext = {
      orgId: COLLEGE_A,
      userId: USER_A,
      role: 'student',
    };

    it('11.1. Same-commit re-ingestion after revocation and re-consent creates distinct generation, preserves revoked history, and resolves active generation', async () => {
      // 1. Initial consent grant
      const grant1 = await consentRepo.grantConsent(ctxA, STUDENT_A, 'repo_verification', 1);
      expect(grant1.id).toBeDefined();

      const commitSha = 'c001000000000000000000000000000000000001';
      const treeSha = '1001000000000000000000000000000000000001';
      const filePath = 'src/reingest.ts';
      const rawBytes1 = Buffer.from('console.log("generation 1");\n', 'utf8');
      const rawFileHash1 = computeRawFileHash(rawBytes1);
      const blobSha1 = computeGitBlobSha(rawBytes1);

      const ingestionId1 = randomUUID();
      const snapId1 = randomUUID();

      // Save initial snapshot and trusted record under grant1
      const snap1: SourceSnapshot = {
        snapshotId: snapId1,
        orgId: COLLEGE_A,
        studentId: STUDENT_A,
        repositoryId: REPO_A,
        commitSha,
        filePath,
        rawBytes: rawBytes1,
        rawFileHash: rawFileHash1,
        blobSha: blobSha1,
        capturedAt: new Date().toISOString(),
        provenance: 'trusted_ingestion_pipeline',
        ingestionId: ingestionId1,
        registrationState: 'pending_audit',
      };
      await snapshotStore.saveSnapshot(snap1);

      // Promote to audit_committed
      await snapshotStore.updateRegistrationState(
        REPO_A,
        commitSha,
        filePath,
        COLLEGE_A,
        STUDENT_A,
        snapId1,
        'audit_committed'
      );

      const record1: TrustedIngestionRecord = {
        ingestionId: ingestionId1,
        orgId: COLLEGE_A,
        repositoryId: REPO_A,
        commitSha,
        treeSha,
        studentId: STUDENT_A,
        verifiedAt: new Date().toISOString(),
        provenance: 'trusted_ingestion_pipeline',
        manifest: [{ filePath, blobSha: blobSha1, rawFileHash: rawFileHash1, byteSize: rawBytes1.length }],
        consentGrantId: grant1.id,
        status: 'persisted',
      };
      await trustedIngestionStore.saveRecord(record1);

      // Verify generation 1 resolves as active
      const fetchedRecord1 = await trustedIngestionStore.getRecord(COLLEGE_A, REPO_A, commitSha, STUDENT_A);
      expect(fetchedRecord1).not.toBeNull();
      expect(fetchedRecord1?.ingestionId).toBe(ingestionId1);
      expect(fetchedRecord1?.status).toBe('persisted');

      const fetchedSnap1 = await snapshotStore.getSnapshot(REPO_A, commitSha, filePath, COLLEGE_A, STUDENT_A);
      expect(fetchedSnap1?.registrationState).toBe('audit_committed');

      // 2. Revoke consent
      const revRes = await consentRepo.revokeConsent(ctxA, grant1.id, 'Testing re-ingestion');
      expect(revRes.success).toBe(true);

      // Verify generation 1 is now revoked and quarantined
      const client = await pool.connect();
      try {
        const tirCheck = await client.query(`SELECT status FROM trusted_ingestion_records WHERE ingestion_id = $1;`, [ingestionId1]);
        expect(tirCheck.rows[0].status).toBe('revoked');

        const snapCheck = await client.query(`SELECT registration_state FROM source_snapshots WHERE snapshot_id = $1;`, [snapId1]);
        expect(snapCheck.rows[0].registration_state).toBe('quarantined');
      } finally {
        client.release();
      }

      // 3. Student grants new consent (Generation 2)
      const grant2 = await consentRepo.grantConsent(ctxA, STUDENT_A, 'repo_verification', 2);
      expect(grant2.id).not.toBe(grant1.id);

      // 4. Ingest the SAME Git commit under Generation 2
      const ingestionId2 = randomUUID();
      const snapId2 = randomUUID();

      const snap2: SourceSnapshot = {
        snapshotId: snapId2,
        orgId: COLLEGE_A,
        studentId: STUDENT_A,
        repositoryId: REPO_A,
        commitSha, // SAME commit SHA!
        filePath,
        rawBytes: rawBytes1,
        rawFileHash: rawFileHash1,
        blobSha: blobSha1,
        capturedAt: new Date().toISOString(),
        provenance: 'trusted_ingestion_pipeline',
        ingestionId: ingestionId2, // Fresh generation ingestionId
        registrationState: 'pending_audit',
      };
      await snapshotStore.saveSnapshot(snap2);

      const record2: TrustedIngestionRecord = {
        ingestionId: ingestionId2,
        orgId: COLLEGE_A,
        repositoryId: REPO_A,
        commitSha, // SAME commit SHA!
        treeSha,
        studentId: STUDENT_A,
        verifiedAt: new Date().toISOString(),
        provenance: 'trusted_ingestion_pipeline',
        manifest: [{ filePath, blobSha: blobSha1, rawFileHash: rawFileHash1, byteSize: rawBytes1.length }],
        consentGrantId: grant2.id,
        status: 'persisted',
      };
      await trustedIngestionStore.saveRecord(record2);

      // Promote new snapshot to audit_committed
      await snapshotStore.updateRegistrationState(
        REPO_A,
        commitSha,
        filePath,
        COLLEGE_A,
        STUDENT_A,
        snapId2,
        'audit_committed'
      );

      // 5. Verify database state: both historical and active rows are preserved
      const client2 = await pool.connect();
      try {
        // Exactly 2 trusted ingestion records for this commit
        const tirAll = await client2.query(
          `SELECT ingestion_id, consent_grant_id, status FROM trusted_ingestion_records WHERE repository_id = $1 AND commit_sha = $2 ORDER BY verified_at ASC;`,
          [REPO_A, commitSha]
        );
        expect(tirAll.rows.length).toBe(2);
        expect(tirAll.rows[0].ingestion_id).toBe(ingestionId1);
        expect(tirAll.rows[0].status).toBe('revoked');
        expect(tirAll.rows[0].consent_grant_id).toBe(grant1.id);
        expect(tirAll.rows[1].ingestion_id).toBe(ingestionId2);
        expect(tirAll.rows[1].status).toBe('persisted');
        expect(tirAll.rows[1].consent_grant_id).toBe(grant2.id);

        // Exactly 2 source snapshots for this commit & path
        const snapAll = await client2.query(
          `SELECT snapshot_id, ingestion_id, registration_state FROM source_snapshots WHERE repository_id = $1 AND commit_sha = $2 AND file_path = $3 ORDER BY captured_at ASC;`,
          [REPO_A, commitSha, filePath]
        );
        expect(snapAll.rows.length).toBe(2);
        expect(snapAll.rows[0].snapshot_id).toBe(snapId1);
        expect(snapAll.rows[0].registration_state).toBe('quarantined');
        expect(snapAll.rows[1].snapshot_id).toBe(snapId2);
        expect(snapAll.rows[1].registration_state).toBe('audit_committed');
      } finally {
        client2.release();
      }

      // 6. Verify store lookups return active generation 2
      const activeRecord = await trustedIngestionStore.getRecord(COLLEGE_A, REPO_A, commitSha, STUDENT_A);
      expect(activeRecord).not.toBeNull();
      expect(activeRecord?.ingestionId).toBe(ingestionId2);
      expect(activeRecord?.status).toBe('persisted');

      const activeSnapshot = await snapshotStore.getSnapshot(REPO_A, commitSha, filePath, COLLEGE_A, STUDENT_A);
      expect(activeSnapshot).not.toBeNull();
      expect(activeSnapshot?.snapshotId).toBe(snapId2);
      expect(activeSnapshot?.registrationState).toBe('audit_committed');
    });

    it('11.2. Different-commit re-ingestion under active re-consent succeeds cleanly alongside previous generations', async () => {
      const activeGrant = await consentRepo.getActiveGrant(ctxA, STUDENT_A, 'repo_verification');
      expect(activeGrant).not.toBeNull();

      const commitSha2 = 'c002000000000000000000000000000000000002';
      const treeSha2 = '2002000000000000000000000000000000000002';
      const filePath2 = 'src/diff_commit.ts';
      const rawBytes2 = Buffer.from('console.log("diff commit");\n', 'utf8');
      const rawFileHash2 = computeRawFileHash(rawBytes2);
      const blobSha2 = computeGitBlobSha(rawBytes2);

      const ingestionId3 = randomUUID();
      const snapId3 = randomUUID();

      const snap3: SourceSnapshot = {
        snapshotId: snapId3,
        orgId: COLLEGE_A,
        studentId: STUDENT_A,
        repositoryId: REPO_A,
        commitSha: commitSha2,
        filePath: filePath2,
        rawBytes: rawBytes2,
        rawFileHash: rawFileHash2,
        blobSha: blobSha2,
        capturedAt: new Date().toISOString(),
        provenance: 'trusted_ingestion_pipeline',
        ingestionId: ingestionId3,
        registrationState: 'pending_audit',
      };
      await snapshotStore.saveSnapshot(snap3);

      const record3: TrustedIngestionRecord = {
        ingestionId: ingestionId3,
        orgId: COLLEGE_A,
        repositoryId: REPO_A,
        commitSha: commitSha2,
        treeSha: treeSha2,
        studentId: STUDENT_A,
        verifiedAt: new Date().toISOString(),
        provenance: 'trusted_ingestion_pipeline',
        manifest: [{ filePath: filePath2, blobSha: blobSha2, rawFileHash: rawFileHash2, byteSize: rawBytes2.length }],
        consentGrantId: activeGrant!.id,
        status: 'persisted',
      };
      await trustedIngestionStore.saveRecord(record3);

      const activeRecord2 = await trustedIngestionStore.getRecord(COLLEGE_A, REPO_A, commitSha2, STUDENT_A);
      expect(activeRecord2?.ingestionId).toBe(ingestionId3);
      expect(activeRecord2?.status).toBe('persisted');
    });
  });

  // =========================================================================
  // 12. Full-Sequence End-to-End Migration Upgrade Invariants (Fixtures A–E)
  // =========================================================================
  describe('12. Full-Sequence End-to-End Migration Upgrade Invariants (Fixtures A–E)', () => {
    const migrationFiles = [
      '011a_safe_repository_preflight.sql',
      '012_canonical_repository_unique_constraint.sql',
      '013_active_consent_uniqueness.sql',
      '014_safe_repository_reconciliation.sql',
      '015_consent_generation_and_fresh_reingestion.sql',
      '016_safe_generation_reconciliation.sql',
    ];
    const migrationSqls = migrationFiles.map(file =>
      fs.readFileSync(path.resolve(process.cwd(), 'db/migrations', file), 'utf8')
    );

    async function applyFullMigrationSequence(client: pg.PoolClient) {
      for (const sql of migrationSqls) {
        await client.query(sql);
      }
    }

    it('12.1. Fixture A — Distinct generations, identical contents: both generations and snapshots survive with zero data loss', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN;');
        // Drop unique constraint to simulate schema state before reconciliation
        await client.query('ALTER TABLE repositories DROP CONSTRAINT IF EXISTS uq_repositories_student_provider_repo;');

        const userA = randomUUID();
        const studentA = randomUUID();
        const grantA = randomUUID();
        const grantB = randomUUID();
        const repoA1 = randomUUID();
        const repoA2 = randomUUID();
        const providerRepoId = 'fixture_a_repo_' + randomUUID();
        const commitSha = 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1';
        const treeSha = '7777000000000000000000000000000000000007';
        const ingA = randomUUID();
        const ingB = randomUUID();
        const snapA = randomUUID();
        const snapB = randomUUID();
        const filePath = 'src/fixture_a.ts';
        const contentBytes = Buffer.from('export function fixtureA() { return "Invariant A"; }\n', 'utf8');
        const rawFileHash = computeRawFileHash(contentBytes);
        const blobSha = computeGitBlobSha(contentBytes);

        // Seed dedicated user and student
        await client.query(`
          INSERT INTO users (id, auth_subject, email, full_name) VALUES
            ('${userA}', 'auth_fix_a_${randomUUID()}', 'student.a.${randomUUID()}@p04-test.edu', 'Fixture Student A');
          INSERT INTO students (id, org_id, user_id, department_id, enrollment_no, graduating_year) VALUES
            ('${studentA}', '${COLLEGE_A}', '${userA}', '${DEPT_A}', 'FIX-A-${randomUUID().slice(0, 8)}', 2026);
        `);

        // Seed 2 distinct consent grants for studentA: grantA is historical/revoked, grantB is active
        await client.query(`
          INSERT INTO consent_grants (id, student_id, purpose, notice_version, scope, granted_at, revoked_at) VALUES
            ('${grantA}', '${studentA}', 'repo_verification', 1, '{}'::jsonb, CURRENT_TIMESTAMP - INTERVAL '2 days', CURRENT_TIMESTAMP - INTERVAL '1 day'),
            ('${grantB}', '${studentA}', 'repo_verification', 1, '{}'::jsonb, CURRENT_TIMESTAMP - INTERVAL '1 day', NULL);
        `);

        // Seed duplicate repositories: repoA1 (earlier -> canonical), repoA2 (later -> duplicate)
        await client.query(`
          INSERT INTO repositories (id, student_id, provider, provider_repo_id, url, default_branch, consent_grant_id, imported_at) VALUES
            ('${repoA1}', '${studentA}', 'github', '${providerRepoId}', 'https://github.com/fixture/a', 'main', '${grantA}', CURRENT_TIMESTAMP - INTERVAL '1 hour'),
            ('${repoA2}', '${studentA}', 'github', '${providerRepoId}', 'https://github.com/fixture/a', 'main', '${grantB}', CURRENT_TIMESTAMP - INTERVAL '30 minutes');
        `);

        // Manifest for ingestion
        const manifest = JSON.stringify([{ filePath, blobSha, rawFileHash, byteSize: contentBytes.length }]);

        // Seed Ingestion A (revoked, grantA) on repoA1 and Ingestion B (persisted, grantB) on repoA2
        await client.query(`
          INSERT INTO trusted_ingestion_records (id, ingestion_id, org_id, student_id, repository_id, commit_sha, tree_sha, manifest, provenance, status, consent_grant_id) VALUES
            ('${randomUUID()}', '${ingA}', '${COLLEGE_A}', '${studentA}', '${repoA1}', '${commitSha}', '${treeSha}', $1::jsonb, 'trusted_ingestion_pipeline', 'revoked', '${grantA}'),
            ('${randomUUID()}', '${ingB}', '${COLLEGE_A}', '${studentA}', '${repoA2}', '${commitSha}', '${treeSha}', $1::jsonb, 'trusted_ingestion_pipeline', 'persisted', '${grantB}');
        `, [manifest]);

        // Seed Snapshot A (quarantined, ingA) on repoA1 and Snapshot B (audit_committed, ingB) on repoA2
        await client.query(`
          INSERT INTO source_snapshots (id, snapshot_id, org_id, student_id, repository_id, commit_sha, file_path, raw_bytes, raw_file_hash, blob_sha, captured_at, provenance, ingestion_id, registration_state) VALUES
            ('${randomUUID()}', '${snapA}', '${COLLEGE_A}', '${studentA}', '${repoA1}', '${commitSha}', '${filePath}', $1, '${rawFileHash}', '${blobSha}', CURRENT_TIMESTAMP - INTERVAL '1 hour', 'trusted_ingestion_pipeline', '${ingA}', 'quarantined'),
            ('${randomUUID()}', '${snapB}', '${COLLEGE_A}', '${studentA}', '${repoA2}', '${commitSha}', '${filePath}', $1, '${rawFileHash}', '${blobSha}', CURRENT_TIMESTAMP - INTERVAL '30 minutes', 'trusted_ingestion_pipeline', '${ingB}', 'audit_committed');
        `, [contentBytes]);

        // RUN COMPLETE MIGRATION SEQUENCE IN ACTUAL ORDER: 011a -> 012 -> 013 -> 014 -> 015 -> 016
        await applyFullMigrationSequence(client);

        // 1. Verify repositories: exactly 1 canonical repository row remains (repoA1)
        const repoRes = await client.query(`
          SELECT id, consent_grant_id FROM repositories WHERE student_id = $1 AND provider_repo_id = $2;
        `, [studentA, providerRepoId]);
        expect(repoRes.rows.length).toBe(1);
        expect(repoRes.rows[0].id).toBe(repoA1);

        // 2. Verify trusted_ingestion_records: both survive under canonical repoA1 with correct states & grants
        const ingRes = await client.query(`
          SELECT ingestion_id, repository_id, status, consent_grant_id
          FROM trusted_ingestion_records
          WHERE commit_sha = $1 AND student_id = $2
          ORDER BY status ASC;
        `, [commitSha, studentA]);
        expect(ingRes.rows.length).toBe(2);

        // Active generation: ingB, persisted, grantB, re-parented to canonical repoA1
        expect(ingRes.rows[0].ingestion_id).toBe(ingB);
        expect(ingRes.rows[0].repository_id).toBe(repoA1);
        expect(ingRes.rows[0].status).toBe('persisted');
        expect(ingRes.rows[0].consent_grant_id).toBe(grantB);

        // Revoked historical generation: ingA, revoked, grantA, canonical repoA1
        expect(ingRes.rows[1].ingestion_id).toBe(ingA);
        expect(ingRes.rows[1].repository_id).toBe(repoA1);
        expect(ingRes.rows[1].status).toBe('revoked');
        expect(ingRes.rows[1].consent_grant_id).toBe(grantA);

        // 3. Verify source_snapshots: both survive under canonical repoA1 with raw bytes intact
        const snapRes = await client.query(`
          SELECT snapshot_id, repository_id, ingestion_id, registration_state, raw_bytes, raw_file_hash, blob_sha
          FROM source_snapshots
          WHERE commit_sha = $1 AND student_id = $2
          ORDER BY registration_state ASC;
        `, [commitSha, studentA]);
        expect(snapRes.rows.length).toBe(2);

        // Audit committed snapshot: snapB, under repoA1 and ingB
        expect(snapRes.rows[0].snapshot_id).toBe(snapB);
        expect(snapRes.rows[0].repository_id).toBe(repoA1);
        expect(snapRes.rows[0].ingestion_id).toBe(ingB);
        expect(snapRes.rows[0].registration_state).toBe('audit_committed');
        expect(snapRes.rows[0].raw_bytes.equals(contentBytes)).toBe(true);
        expect(snapRes.rows[0].raw_file_hash).toBe(rawFileHash);
        expect(snapRes.rows[0].blob_sha).toBe(blobSha);

        // Quarantined historical snapshot: snapA, under repoA1 and ingA
        expect(snapRes.rows[1].snapshot_id).toBe(snapA);
        expect(snapRes.rows[1].repository_id).toBe(repoA1);
        expect(snapRes.rows[1].ingestion_id).toBe(ingA);
        expect(snapRes.rows[1].registration_state).toBe('quarantined');
        expect(snapRes.rows[1].raw_bytes.equals(contentBytes)).toBe(true);
        expect(snapRes.rows[1].raw_file_hash).toBe(rawFileHash);
        expect(snapRes.rows[1].blob_sha).toBe(blobSha);

        // 4. Verify unique constraint is active on repositories
        const constraintRes = await client.query(`
          SELECT 1 FROM pg_constraint WHERE conname = 'uq_repositories_student_provider_repo';
        `);
        expect(constraintRes.rows.length).toBe(1);

        await client.query('ROLLBACK;');
      } catch (err) {
        await client.query('ROLLBACK;').catch(() => {});
        throw err;
      } finally {
        await client.query('ROLLBACK;').catch(() => {});
        client.release();
      }
    });

    it('12.2. Fixture B — Same generation, identical records: safe reconciliation with deduplication and re-parenting', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN;');
        await client.query('ALTER TABLE repositories DROP CONSTRAINT IF EXISTS uq_repositories_student_provider_repo;');

        const userB = randomUUID();
        const studentB = randomUUID();
        const grantB = randomUUID();
        const repoB1 = randomUUID();
        const repoB2 = randomUUID();
        const providerRepoId = 'fixture_b_repo_' + randomUUID();
        const commitSha = 'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2';
        const treeSha = '8888000000000000000000000000000000000008';
        const ingB1 = randomUUID();
        const ingB2 = randomUUID();
        const snapB1 = randomUUID();
        const snapB2 = randomUUID();
        const filePath = 'src/fixture_b.ts';
        const contentBytes = Buffer.from('export function fixtureB() { return "Identical"; }\n', 'utf8');
        const rawFileHash = computeRawFileHash(contentBytes);
        const blobSha = computeGitBlobSha(contentBytes);

        await client.query(`
          INSERT INTO users (id, auth_subject, email, full_name) VALUES
            ('${userB}', 'auth_fix_b_${randomUUID()}', 'student.b.${randomUUID()}@p04-test.edu', 'Fixture Student B');
          INSERT INTO students (id, org_id, user_id, department_id, enrollment_no, graduating_year) VALUES
            ('${studentB}', '${COLLEGE_A}', '${userB}', '${DEPT_A}', 'FIX-B-${randomUUID().slice(0, 8)}', 2026);
        `);

        await client.query(`
          INSERT INTO consent_grants (id, student_id, purpose, notice_version, scope, granted_at, revoked_at) VALUES
            ('${grantB}', '${studentB}', 'repo_verification', 1, '{}'::jsonb, CURRENT_TIMESTAMP - INTERVAL '1 day', NULL);
        `);

        // Both duplicate repositories belong to the SAME consent grant (grantB)
        await client.query(`
          INSERT INTO repositories (id, student_id, provider, provider_repo_id, url, default_branch, consent_grant_id, imported_at) VALUES
            ('${repoB1}', '${studentB}', 'github', '${providerRepoId}', 'https://github.com/fixture/b', 'main', '${grantB}', CURRENT_TIMESTAMP - INTERVAL '1 hour'),
            ('${repoB2}', '${studentB}', 'github', '${providerRepoId}', 'https://github.com/fixture/b', 'main', '${grantB}', CURRENT_TIMESTAMP - INTERVAL '30 minutes');
        `);

        const manifest = JSON.stringify([{ filePath, blobSha, rawFileHash, byteSize: contentBytes.length }]);

        // Seed two identical ingestion records in the same generation
        await client.query(`
          INSERT INTO trusted_ingestion_records (id, ingestion_id, org_id, student_id, repository_id, commit_sha, tree_sha, manifest, provenance, status, consent_grant_id) VALUES
            ('${randomUUID()}', '${ingB1}', '${COLLEGE_A}', '${studentB}', '${repoB1}', '${commitSha}', '${treeSha}', $1::jsonb, 'trusted_ingestion_pipeline', 'persisted', '${grantB}'),
            ('${randomUUID()}', '${ingB2}', '${COLLEGE_A}', '${studentB}', '${repoB2}', '${commitSha}', '${treeSha}', $1::jsonb, 'trusted_ingestion_pipeline', 'persisted', '${grantB}');
        `, [manifest]);

        // Seed two identical snapshots
        await client.query(`
          INSERT INTO source_snapshots (id, snapshot_id, org_id, student_id, repository_id, commit_sha, file_path, raw_bytes, raw_file_hash, blob_sha, captured_at, provenance, ingestion_id, registration_state) VALUES
            ('${randomUUID()}', '${snapB1}', '${COLLEGE_A}', '${studentB}', '${repoB1}', '${commitSha}', '${filePath}', $1, '${rawFileHash}', '${blobSha}', CURRENT_TIMESTAMP - INTERVAL '1 hour', 'trusted_ingestion_pipeline', '${ingB1}', 'audit_committed'),
            ('${randomUUID()}', '${snapB2}', '${COLLEGE_A}', '${studentB}', '${repoB2}', '${commitSha}', '${filePath}', $1, '${rawFileHash}', '${blobSha}', CURRENT_TIMESTAMP - INTERVAL '30 minutes', 'trusted_ingestion_pipeline', '${ingB2}', 'audit_committed');
        `, [contentBytes]);

        // RUN COMPLETE MIGRATION SEQUENCE IN ACTUAL ORDER
        await applyFullMigrationSequence(client);

        // Exactly 1 repository remains (repoB1)
        const repoRes = await client.query(`
          SELECT id FROM repositories WHERE student_id = $1 AND provider_repo_id = $2;
        `, [studentB, providerRepoId]);
        expect(repoRes.rows.length).toBe(1);
        expect(repoRes.rows[0].id).toBe(repoB1);

        // Exactly 1 trusted ingestion record remains (ingB1)
        const ingRes = await client.query(`
          SELECT ingestion_id, repository_id, status FROM trusted_ingestion_records WHERE commit_sha = $1 AND student_id = $2;
        `, [commitSha, studentB]);
        expect(ingRes.rows.length).toBe(1);
        expect(ingRes.rows[0].ingestion_id).toBe(ingB1);
        expect(ingRes.rows[0].repository_id).toBe(repoB1);

        // Exactly 1 snapshot remains (snapB1)
        const snapRes = await client.query(`
          SELECT snapshot_id, repository_id, ingestion_id, registration_state FROM source_snapshots WHERE commit_sha = $1 AND student_id = $2;
        `, [commitSha, studentB]);
        expect(snapRes.rows.length).toBe(1);
        expect(snapRes.rows[0].snapshot_id).toBe(snapB1);
        expect(snapRes.rows[0].repository_id).toBe(repoB1);

        await client.query('ROLLBACK;');
      } catch (err) {
        await client.query('ROLLBACK;').catch(() => {});
        throw err;
      } finally {
        await client.query('ROLLBACK;').catch(() => {});
        client.release();
      }
    });

    it('12.3. Fixture C — Different generations, divergent content: aborts transactionally without partial deletion', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN;');
        await client.query('ALTER TABLE repositories DROP CONSTRAINT IF EXISTS uq_repositories_student_provider_repo;');

        const userC = randomUUID();
        const studentC = randomUUID();
        const grantA = randomUUID();
        const grantB = randomUUID();
        const repoC1 = randomUUID();
        const repoC2 = randomUUID();
        const providerRepoId = 'fixture_c_repo_' + randomUUID();
        const commitSha = 'c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3';
        const treeSha = '9999000000000000000000000000000000000009';
        const ingC1 = randomUUID();
        const ingC2 = randomUUID();
        const filePath = 'src/fixture_c.ts';

        const bytes1 = Buffer.from('export function fixtureC() { return "Original Version 1"; }\n', 'utf8');
        const bytes2 = Buffer.from('export function fixtureC() { return "TAMPERED DIVERGENT BYTES"; }\n', 'utf8');

        await client.query(`
          INSERT INTO users (id, auth_subject, email, full_name) VALUES
            ('${userC}', 'auth_fix_c_${randomUUID()}', 'student.c.${randomUUID()}@p04-test.edu', 'Fixture Student C');
          INSERT INTO students (id, org_id, user_id, department_id, enrollment_no, graduating_year) VALUES
            ('${studentC}', '${COLLEGE_A}', '${userC}', '${DEPT_A}', 'FIX-C-${randomUUID().slice(0, 8)}', 2026);
        `);

        await client.query(`
          INSERT INTO consent_grants (id, student_id, purpose, notice_version, scope, granted_at, revoked_at) VALUES
            ('${grantA}', '${studentC}', 'repo_verification', 1, '{}'::jsonb, CURRENT_TIMESTAMP - INTERVAL '2 days', CURRENT_TIMESTAMP - INTERVAL '1 day'),
            ('${grantB}', '${studentC}', 'repo_verification', 1, '{}'::jsonb, CURRENT_TIMESTAMP - INTERVAL '1 day', NULL);
        `);

        await client.query(`
          INSERT INTO repositories (id, student_id, provider, provider_repo_id, url, default_branch, consent_grant_id, imported_at) VALUES
            ('${repoC1}', '${studentC}', 'github', '${providerRepoId}', 'https://github.com/fixture/c', 'main', '${grantA}', CURRENT_TIMESTAMP - INTERVAL '1 hour'),
            ('${repoC2}', '${studentC}', 'github', '${providerRepoId}', 'https://github.com/fixture/c', 'main', '${grantB}', CURRENT_TIMESTAMP - INTERVAL '30 minutes');
        `);

        await client.query(`
          INSERT INTO trusted_ingestion_records (id, ingestion_id, org_id, student_id, repository_id, commit_sha, tree_sha, manifest, provenance, status, consent_grant_id) VALUES
            ('${randomUUID()}', '${ingC1}', '${COLLEGE_A}', '${studentC}', '${repoC1}', '${commitSha}', '${treeSha}', '[]'::jsonb, 'trusted_ingestion_pipeline', 'revoked', '${grantA}'),
            ('${randomUUID()}', '${ingC2}', '${COLLEGE_A}', '${studentC}', '${repoC2}', '${commitSha}', '${treeSha}', '[]'::jsonb, 'trusted_ingestion_pipeline', 'persisted', '${grantB}');
        `);

        // Insert divergent source_snapshots for the same commit
        await client.query(`
          INSERT INTO source_snapshots (id, snapshot_id, org_id, student_id, repository_id, commit_sha, file_path, raw_bytes, raw_file_hash, blob_sha, captured_at, provenance, ingestion_id, registration_state) VALUES
            ('${randomUUID()}', '${randomUUID()}', '${COLLEGE_A}', '${studentC}', '${repoC1}', '${commitSha}', '${filePath}', $1, '${computeRawFileHash(bytes1)}', '${computeGitBlobSha(bytes1)}', CURRENT_TIMESTAMP, 'trusted_ingestion_pipeline', '${ingC1}', 'quarantined'),
            ('${randomUUID()}', '${randomUUID()}', '${COLLEGE_A}', '${studentC}', '${repoC2}', '${commitSha}', '${filePath}', $2, '${computeRawFileHash(bytes2)}', '${computeGitBlobSha(bytes2)}', CURRENT_TIMESTAMP, 'trusted_ingestion_pipeline', '${ingC2}', 'audit_committed');
        `, [bytes1, bytes2]);

        // Attempt migration: MUST throw data loss prevention error
        await expect(applyFullMigrationSequence(client)).rejects.toThrow(/\[DATA_LOSS_PREVENTION\].*Divergent source_snapshots/);

        // Transaction is rolled back safely
        await client.query('ROLLBACK;');
      } catch (err) {
        await client.query('ROLLBACK;').catch(() => {});
        throw err;
      } finally {
        await client.query('ROLLBACK;').catch(() => {});
        client.release();
      }
    });

    it('12.4. Fixture D — Historical ambiguous consent: NULL consent_grant_id with multiple candidates fails closed and preserves all rows', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN;');

        const userD = randomUUID();
        const studentD = randomUUID();
        const grant1 = randomUUID();
        const grant2 = randomUUID();
        const repoD = randomUUID();
        const ingD = randomUUID();

        await client.query(`
          INSERT INTO users (id, auth_subject, email, full_name) VALUES
            ('${userD}', 'auth_fix_d_${randomUUID()}', 'student.d.${randomUUID()}@p04-test.edu', 'Fixture Student D');
          INSERT INTO students (id, org_id, user_id, department_id, enrollment_no, graduating_year) VALUES
            ('${studentD}', '${COLLEGE_A}', '${userD}', '${DEPT_A}', 'FIX-D-${randomUUID().slice(0, 8)}', 2026);
        `);

        // Seed 2 distinct historical revoked consent grants for studentD with purpose 'repo_verification'
        await client.query(`
          INSERT INTO consent_grants (id, student_id, purpose, notice_version, scope, granted_at, revoked_at) VALUES
            ('${grant1}', '${studentD}', 'repo_verification', 1, '{}'::jsonb, CURRENT_TIMESTAMP - INTERVAL '3 days', CURRENT_TIMESTAMP - INTERVAL '2 days'),
            ('${grant2}', '${studentD}', 'repo_verification', 1, '{}'::jsonb, CURRENT_TIMESTAMP - INTERVAL '2 days', CURRENT_TIMESTAMP - INTERVAL '1 day');
        `);

        // Repo has valid consent_grant_id (grant1) to satisfy NOT NULL constraint
        await client.query(`
          INSERT INTO repositories (id, student_id, provider, provider_repo_id, url, default_branch, consent_grant_id, imported_at) VALUES
            ('${repoD}', '${studentD}', 'github', 'fixture_d_repo', 'https://github.com/fixture/d', 'main', '${grant1}', CURRENT_TIMESTAMP);
        `);

        // Seed trusted_ingestion_record with NULL consent_grant_id when student has 2 candidate grants
        await client.query(`
          INSERT INTO trusted_ingestion_records (id, ingestion_id, org_id, student_id, repository_id, commit_sha, tree_sha, manifest, provenance, status, consent_grant_id) VALUES
            ('${randomUUID()}', '${ingD}', '${COLLEGE_A}', '${studentD}', '${repoD}', 'd4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4', 'aaaa00000000000000000000000000000000000a', '[]'::jsonb, 'trusted_ingestion_pipeline', 'persisted', NULL);
        `);

        // Migration must fail closed with Ambiguous consent generation
        await expect(applyFullMigrationSequence(client)).rejects.toThrow(/\[DATA_LOSS_PREVENTION\].*Ambiguous consent generation/);

        await client.query('ROLLBACK;');
      } catch (err) {
        await client.query('ROLLBACK;').catch(() => {});
        throw err;
      } finally {
        await client.query('ROLLBACK;').catch(() => {});
        client.release();
      }
    });

    it('12.5. Fixture E — Previous 011a checksum upgrade: runner recognizes historical checksum without rewriting ledger', async () => {
      const client = await pool.connect();
      try {
        // Verify current 011a ledger entry
        const res = await client.query(`SELECT version, checksum FROM schema_migrations WHERE version = '011a';`);
        expect(res.rows.length).toBe(1);
        const recordedChecksum = res.rows[0].checksum;

        // Verify that the recorded checksum is either the current file's checksum or a verified historical checksum
        const fileContent = fs.readFileSync(
          path.resolve(__dirname, '..', 'migrations', '011a_safe_repository_preflight.sql'),
          'utf8'
        );
        const currentChecksum = computeChecksum(fileContent);
        const validChecksums = [currentChecksum, ...(HISTORICAL_MIGRATION_CHECKSUMS['011a'] || [])];
        expect(validChecksums).toContain(recordedChecksum);

        // Also test upgrade simulation with each historical checksum: update, runMigrations, and restore
        for (const historicalHash of HISTORICAL_MIGRATION_CHECKSUMS['011a']) {
          await client.query(
            `UPDATE schema_migrations SET checksum = $1 WHERE version = '011a';`,
            [historicalHash]
          );

          try {
            // Verify that running migrations recognizes historical checksum and skips cleanly without error
            const simMigResult = await runMigrations();
            expect(simMigResult.total).toBeGreaterThanOrEqual(18);
            expect(simMigResult.newlyApplied).toBe(0);
            expect(simMigResult.skipped).toBe(simMigResult.total);
          } finally {
            // Restore recorded checksum
            await client.query(
              `UPDATE schema_migrations SET checksum = $1 WHERE version = '011a';`,
              [recordedChecksum]
            );
          }
        }

        // Run migrations and verify it skips 011a cleanly without error or ledger corruption
        const migResult = await runMigrations();
        expect(migResult.total).toBeGreaterThanOrEqual(18);
        expect(migResult.newlyApplied).toBe(0);
        expect(migResult.skipped).toBe(migResult.total);

        // Confirm ledger was NOT rewritten
        const finalRes = await client.query(`SELECT checksum FROM schema_migrations WHERE version = '011a';`);
        expect(finalRes.rows[0].checksum).toBe(recordedChecksum);
      } finally {
        client.release();
      }
    });
  });
});
