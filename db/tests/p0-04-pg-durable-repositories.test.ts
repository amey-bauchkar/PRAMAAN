import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import crypto, { randomUUID } from 'crypto';
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
import { assertSafeTestEnvironment, assertNotInstitutionalTenant } from '../../scripts/supabase-runner.mjs';

try {
  process.loadEnvFile?.();
} catch {}

const adminUrl = process.env.DATABASE_URL_ADMIN;
const isOptedIn = process.env.ALLOW_DESTRUCTIVE_DB_TESTS === 'true';

describe('P0-04: PostgreSQL Durable Repositories & RLS Security Invariants', () => {
  if (!adminUrl || !isOptedIn) {
    it.skip('Skipping PostgreSQL durable repositories test (requires DATABASE_URL_ADMIN and ALLOW_DESTRUCTIVE_DB_TESTS=true)', () => {});
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

  const cleanupFixtures = async () => {
    const client = await pool.connect();
    try {
      await client.query(`
        DELETE FROM source_snapshots WHERE org_id IN ('${COLLEGE_A}', '${COLLEGE_B}');
        DELETE FROM trusted_ingestion_records WHERE org_id IN ('${COLLEGE_A}', '${COLLEGE_B}');
        DELETE FROM ingestion_jobs WHERE org_id IN ('${COLLEGE_A}', '${COLLEGE_B}');
        DELETE FROM github_oauth_states WHERE org_id IN ('${COLLEGE_A}', '${COLLEGE_B}');
        DELETE FROM connected_accounts WHERE student_id IN ('${STUDENT_A}', '${STUDENT_B}');
        DELETE FROM repositories WHERE id IN ('${REPO_A}', '${REPO_B}');
        DELETE FROM consent_grants WHERE id IN ('${CONSENT_A}', '${CONSENT_B}');
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
    it('1.1. Saves single-use OAuth state, consumes it once, and rejects replay', async () => {
      const state = crypto.randomBytes(32).toString('hex');
      const verifier = crypto.randomBytes(32).toString('base64url');

      await credentialRepo.saveOAuthState(
        state,
        verifier,
        STUDENT_A,
        COLLEGE_A,
        'https://app.pramaan.edu/callback',
        600
      );

      // First consumption succeeds
      const consumed = await credentialRepo.consumeOAuthState(state);
      expect(consumed).not.toBeNull();
      expect(consumed?.studentId).toBe(STUDENT_A);
      expect(consumed?.orgId).toBe(COLLEGE_A);
      expect(consumed?.codeVerifier).toBe(verifier);

      // Second consumption fails (already consumed)
      const replayed = await credentialRepo.consumeOAuthState(state);
      expect(replayed).toBeNull();
    });

    it('1.2. Saves encrypted connected account, retrieves it, and revokes it cleanly', async () => {
      const ctx: SessionContext = {
        orgId: COLLEGE_A,
        userId: STUDENT_A,
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

    it('4.1. Creates job, updates status to completed, and retrieves progress', async () => {
      const ctx: SessionContext = {
        orgId: COLLEGE_A,
        userId: STUDENT_A,
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

      // Update to completed
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
  });
});
