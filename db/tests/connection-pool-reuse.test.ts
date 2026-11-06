import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { runQuery } from '../../scripts/supabase-runner.mjs';
import { resolveAdminSslConfig } from '../../scripts/admin-db-ssl.mjs';

describe('Real PostgreSQL Connection Pooling: Physical Connection Reuse & Context Isolation', () => {
  let pool: pg.Pool;

  // Dedicated test fixtures starting with 'e' to guarantee zero collision with other test suites
  const POOL_COLLEGE_A = 'e0000000-0000-0000-0000-000000000001';
  const POOL_COLLEGE_B = 'e0000000-0000-0000-0000-000000000002';
  const POOL_USER_A = 'e1000000-0000-0000-0000-000000000001';
  const POOL_USER_B = 'e1000000-0000-0000-0000-000000000002';
  const POOL_DEPT_A = 'e2000000-0000-0000-0000-000000000001';
  const POOL_DEPT_B = 'e2000000-0000-0000-0000-000000000002';
  const POOL_STUDENT_A = 'e3000000-0000-0000-0000-000000000001';
  const POOL_STUDENT_B = 'e3000000-0000-0000-0000-000000000002';

  beforeAll(async () => {
    try {
      process.loadEnvFile?.();
    } catch {}

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is required to run genuine connection pooling reuse tests.');
    }

    // Configure a dedicated pool with max: 1 to guarantee physical socket/connection reuse
    const ssl = resolveAdminSslConfig(connectionString);
    pool = new pg.Pool({
      connectionString,
      ssl,
      max: 1, // Single connection enforces exact socket reuse
      connectionTimeoutMillis: 10000
    });

    // Seed test fixtures using administrative query runner
    await runQuery(`
      DELETE FROM students WHERE id IN ('${POOL_STUDENT_A}', '${POOL_STUDENT_B}');
      DELETE FROM departments WHERE id IN ('${POOL_DEPT_A}', '${POOL_DEPT_B}');
      DELETE FROM users WHERE id IN ('${POOL_USER_A}', '${POOL_USER_B}');
      DELETE FROM organizations WHERE id IN ('${POOL_COLLEGE_A}', '${POOL_COLLEGE_B}');

      INSERT INTO organizations (id, name, kind)
      VALUES 
        ('${POOL_COLLEGE_A}', 'College A Pool Test', 'college'),
        ('${POOL_COLLEGE_B}', 'College B Pool Test', 'college');

      INSERT INTO users (id, auth_subject, email, full_name)
      VALUES 
        ('${POOL_USER_A}', 'pool_test_student_a', 'student.a@pool-test.edu', 'Student A Pool Test'),
        ('${POOL_USER_B}', 'pool_test_student_b', 'student.b@pool-test.edu', 'Student B Pool Test');

      INSERT INTO departments (id, org_id, name, code)
      VALUES 
        ('${POOL_DEPT_A}', '${POOL_COLLEGE_A}', 'Computer Science', 'CS_POOL'),
        ('${POOL_DEPT_B}', '${POOL_COLLEGE_B}', 'Information Tech', 'IT_POOL');

      INSERT INTO students (id, org_id, user_id, department_id, enrollment_no, graduating_year)
      VALUES 
        ('${POOL_STUDENT_A}', '${POOL_COLLEGE_A}', '${POOL_USER_A}', '${POOL_DEPT_A}', 'POOL-ENROLL-A', 2026),
        ('${POOL_STUDENT_B}', '${POOL_COLLEGE_B}', '${POOL_USER_B}', '${POOL_DEPT_B}', 'POOL-ENROLL-B', 2026);
    `);
  }, 20000);

  afterAll(async () => {
    await runQuery(`
      DELETE FROM students WHERE id IN ('${POOL_STUDENT_A}', '${POOL_STUDENT_B}');
      DELETE FROM departments WHERE id IN ('${POOL_DEPT_A}', '${POOL_DEPT_B}');
      DELETE FROM users WHERE id IN ('${POOL_USER_A}', '${POOL_USER_B}');
      DELETE FROM organizations WHERE id IN ('${POOL_COLLEGE_A}', '${POOL_COLLEGE_B}');
    `);
    if (pool) {
      await pool.end();
    }
  }, 20000);

  it('Verifies genuine physical connection reuse and strict fail-closed context reset', async () => {
    // ------------------------------------------------------------------------
    // Step 1: Acquire client 1, run College A query with SET LOCAL
    // ------------------------------------------------------------------------
    const client1 = await pool.connect();
    let client2: any;
    let client3: any;
    let client4: any;

    try {
      const pid1Res = await client1.query('SELECT pg_backend_pid();');
      const pid1 = pid1Res.rows[0].pg_backend_pid;
      expect(pid1).toBeDefined();

      await client1.query('BEGIN;');
      await client1.query('SET LOCAL ROLE app_api;');
      await client1.query(`SET LOCAL "app.current_org_id" = '${POOL_COLLEGE_A}';`);

      const res1 = await client1.query(
        `SELECT id, org_id FROM students WHERE id IN ('${POOL_STUDENT_A}', '${POOL_STUDENT_B}');`
      );
      expect(res1.rows).toHaveLength(1);
      expect(res1.rows[0].id).toBe(POOL_STUDENT_A);
      expect(res1.rows[0].org_id).toBe(POOL_COLLEGE_A);

      await client1.query('COMMIT;');
      // Release client 1 back to the pool
      client1.release();

      // ------------------------------------------------------------------------
      // Step 2: Acquire client 2 from the pool (Guaranteed same physical client connection in node-pg)
      // ------------------------------------------------------------------------
      client2 = await pool.connect();
      expect(client2).toBe(client1);

      const pid2Res = await client2.query('SELECT pg_backend_pid();');
      const pid2 = pid2Res.rows[0].pg_backend_pid;
      expect(pid2).toBeDefined();

      // Run a new transaction WITHOUT setting app.current_org_id
      await client2.query('BEGIN;');
      await client2.query('SET LOCAL ROLE app_api;');
      // Intentionally NOT setting app.current_org_id

      const res2 = await client2.query(
        `SELECT id FROM students WHERE id IN ('${POOL_STUDENT_A}', '${POOL_STUDENT_B}');`
      );
      // Verifies that College A context did NOT leak across connection reuse -> fails closed (0 rows)
      expect(res2.rows).toHaveLength(0);

      await client2.query('COMMIT;');
      client2.release();
      client2 = null;

      // ------------------------------------------------------------------------
      // Step 3: Acquire client 3, set College B context on same physical connection
      // ------------------------------------------------------------------------
      client3 = await pool.connect();
      expect(client3).toBe(client1);

      const pid3Res = await client3.query('SELECT pg_backend_pid();');
      const pid3 = pid3Res.rows[0].pg_backend_pid;
      expect(pid3).toBeDefined();

      await client3.query('BEGIN;');
      await client3.query('SET LOCAL ROLE app_api;');
      await client3.query(`SET LOCAL "app.current_org_id" = '${POOL_COLLEGE_B}';`);

      const res3 = await client3.query(
        `SELECT id, org_id FROM students WHERE id IN ('${POOL_STUDENT_A}', '${POOL_STUDENT_B}');`
      );
      expect(res3.rows).toHaveLength(1);
      expect(res3.rows[0].id).toBe(POOL_STUDENT_B);
      expect(res3.rows[0].org_id).toBe(POOL_COLLEGE_B);

      await client3.query('COMMIT;');
      client3.release();
      client3 = null;

      // ------------------------------------------------------------------------
      // Step 4: Acquire client 4, verify College B context also does not bleed
      // ------------------------------------------------------------------------
      client4 = await pool.connect();
      expect(client4).toBe(client1);

      const pid4Res = await client4.query('SELECT pg_backend_pid();');
      const pid4 = pid4Res.rows[0].pg_backend_pid;
      expect(pid4).toBeDefined();

      await client4.query('BEGIN;');
      await client4.query('SET LOCAL ROLE app_api;');
      // Intentionally NOT setting app.current_org_id

      const res4 = await client4.query(
        `SELECT id FROM students WHERE id IN ('${POOL_STUDENT_A}', '${POOL_STUDENT_B}');`
      );
      expect(res4.rows).toHaveLength(0);

      await client4.query('COMMIT;');
      client4.release();
      client4 = null;
    } finally {
      if (client2) client2.release();
      if (client3) client3.release();
      if (client4) client4.release();
    }
  });
});
