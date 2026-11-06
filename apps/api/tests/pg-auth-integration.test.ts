import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDbPool } from '../src/db/pool.js';
import { PgUserRepository } from '../src/repositories/user-repository.js';
import { AuthService } from '../src/services/auth-service.js';
import { JwtVerifier } from '../src/services/jwt-verifier.js';
import { createTestToken } from '../src/testing/test-jwt-utils.js';
import { runQuery } from '../../../scripts/supabase-runner.mjs';
import pg from 'pg';

describe('Real PostgreSQL Supabase Integration: Authenticated Identity & Membership Mapping', () => {
  let pool: pg.Pool;
  let pgUserRepo: PgUserRepository;
  let authService: AuthService;
  let jwtVerifier: JwtVerifier;

  const testSecret = 'pramaan-live-supabase-jwt-secret-32-chars!';
  const TEST_COLLEGE = 'f0000000-0000-0000-0000-000000000001';
  const TEST_USER = 'f1000000-0000-0000-0000-000000000001';
  const TEST_MEMBERSHIP = 'f2000000-0000-0000-0000-000000000001';
  const TEST_AUTH_SUB = 'supabase-auth|live-user-f1000000';
  const TEST_EMAIL = 'officer.live@f-college.edu';

  beforeAll(async () => {
    try {
      process.loadEnvFile?.();
    } catch {}

    pool = getDbPool();
    pgUserRepo = new PgUserRepository(pool);
    jwtVerifier = new JwtVerifier(testSecret);
    authService = new AuthService({ jwtVerifier, userRepository: pgUserRepo });

    // Seed test identity directly in PostgreSQL via admin runner
    await runQuery(`
      DELETE FROM memberships WHERE id = '${TEST_MEMBERSHIP}';
      DELETE FROM users WHERE id = '${TEST_USER}';
      DELETE FROM organizations WHERE id = '${TEST_COLLEGE}';

      INSERT INTO organizations (id, name, kind)
      VALUES ('${TEST_COLLEGE}', 'Live Integration College', 'college');

      INSERT INTO users (id, auth_subject, email, full_name)
      VALUES ('${TEST_USER}', '${TEST_AUTH_SUB}', '${TEST_EMAIL}', 'Live Test Officer');

      INSERT INTO memberships (id, user_id, org_id, role, status)
      VALUES ('${TEST_MEMBERSHIP}', '${TEST_USER}', '${TEST_COLLEGE}', 'officer', 'active');
    `);
  }, 20000);

  afterAll(async () => {
    await runQuery(`
      DELETE FROM memberships WHERE id = '${TEST_MEMBERSHIP}';
      DELETE FROM users WHERE id = '${TEST_USER}';
      DELETE FROM organizations WHERE id = '${TEST_COLLEGE}';
    `);
  }, 20000);

  it('Verifies authenticated JWT identity against live PostgreSQL users and memberships tables', async () => {
    // 1. Issue a cryptographically signed JWT with sub = TEST_AUTH_SUB
    const token = await createTestToken({
      sub: TEST_AUTH_SUB,
      email: TEST_EMAIL
    }, { customSecret: testSecret });

    // 2. Resolve session context via AuthService (which queries PostgreSQL via PgUserRepository)
    const result = await authService.resolveContext(`Bearer ${token}`);

    expect(result.authenticated).toBe(true);
    expect(result.context).toBeDefined();
    expect(result.context?.userId).toBe(TEST_USER);
    expect(result.context?.orgId).toBe(TEST_COLLEGE);
    expect(result.context?.role).toBe('officer');
  });

  it('Rejects request when user attempts to access foreign organization in live PostgreSQL', async () => {
    const foreignOrgId = 'f0000000-0000-0000-0000-000000000099';
    const token = await createTestToken({
      sub: TEST_AUTH_SUB,
      email: TEST_EMAIL
    }, { customSecret: testSecret });

    const result = await authService.resolveContext(`Bearer ${token}`, foreignOrgId);
    expect(result.authenticated).toBe(false);
    expect(result.statusCode).toBe(403);
    expect(result.error).toMatch(/FORBIDDEN_TENANT_ACCESS/);
  });
});

