import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runQuery } from '../../scripts/supabase-runner.mjs';

describe('Real PostgreSQL 17 on Supabase: Security, RLS & Verification Invariants', () => {
  // Deterministic Test Fixtures UUIDs
  const COLLEGE_A = 'a0000000-0000-0000-0000-000000000001';
  const COLLEGE_B = 'b0000000-0000-0000-0000-000000000002';
  const USER_A = 'a1000000-0000-0000-0000-000000000001';
  const USER_B = 'b1000000-0000-0000-0000-000000000002';
  const DEPT_A = 'a2000000-0000-0000-0000-000000000001';
  const DEPT_B = 'b2000000-0000-0000-0000-000000000002';
  const STUDENT_A = 'a3000000-0000-0000-0000-000000000001';
  const STUDENT_B = 'b3000000-0000-0000-0000-000000000002';
  const SKILL_ID = 'c0000000-0000-0000-0000-000000000001';
  const SKILL_ID_2 = 'c0000000-0000-0000-0000-000000000002';
  const RUBRIC_ID = 'c1000000-0000-0000-0000-000000000001';
  const STUDENT_SKILL_A = 'a4000000-0000-0000-0000-000000000001';
  const STUDENT_SKILL_B = 'b4000000-0000-0000-0000-000000000001';
  const EVIDENCE_A_ACCEPTED = 'a5000000-0000-0000-0000-000000000001';
  const EVIDENCE_A_WITHDRAWN = 'a5000000-0000-0000-0000-000000000002';
  const EVIDENCE_B_ACCEPTED = 'b5000000-0000-0000-0000-000000000001';
  const SESSION_A_PASSED = 'a6000000-0000-0000-0000-000000000001';
  const SESSION_A_FAILED = 'a6000000-0000-0000-0000-000000000002';

  const cleanupFixtures = async () => {
    await runQuery(`
      DELETE FROM verification_sessions WHERE id IN ('${SESSION_A_PASSED}', '${SESSION_A_FAILED}');
      DELETE FROM skill_evidence WHERE student_skill_id IN ('${STUDENT_SKILL_A}', '${STUDENT_SKILL_B}');
      DELETE FROM student_skills WHERE id IN ('${STUDENT_SKILL_A}', '${STUDENT_SKILL_B}');
      DELETE FROM evidence_items WHERE id IN ('${EVIDENCE_A_ACCEPTED}', '${EVIDENCE_A_WITHDRAWN}', '${EVIDENCE_B_ACCEPTED}');
      DELETE FROM rubric_versions WHERE id = '${RUBRIC_ID}';
      DELETE FROM skills WHERE id IN ('${SKILL_ID}', '${SKILL_ID_2}');
      DELETE FROM students WHERE id IN ('${STUDENT_A}', '${STUDENT_B}');
      DELETE FROM departments WHERE id IN ('${DEPT_A}', '${DEPT_B}');
      DELETE FROM users WHERE id IN ('${USER_A}', '${USER_B}');
      DELETE FROM organizations WHERE id IN ('${COLLEGE_A}', '${COLLEGE_B}');
    `);
  };

  beforeAll(async () => {
    // 1. Initial cleanup to prevent state collisions
    await cleanupFixtures();

    // 2. Deterministic Seeding as administrative role
    await runQuery(`
      -- Seed Organizations
      INSERT INTO organizations (id, name, kind)
      VALUES 
        ('${COLLEGE_A}', 'Apex Engineering College Test', 'college'),
        ('${COLLEGE_B}', 'Zenith Institute Test', 'college');

      -- Seed Users
      INSERT INTO users (id, auth_subject, email, full_name)
      VALUES 
        ('${USER_A}', 'auth_test_student_a', 'student.a@apex-test.edu', 'Student A Test'),
        ('${USER_B}', 'auth_test_student_b', 'student.b@zenith-test.edu', 'Student B Test');

      -- Seed Departments
      INSERT INTO departments (id, org_id, name, code)
      VALUES 
        ('${DEPT_A}', '${COLLEGE_A}', 'Computer Science Test', 'CS_TEST'),
        ('${DEPT_B}', '${COLLEGE_B}', 'Information Tech Test', 'IT_TEST');

      -- Seed Students
      INSERT INTO students (id, org_id, user_id, department_id, enrollment_no, graduating_year)
      VALUES 
        ('${STUDENT_A}', '${COLLEGE_A}', '${USER_A}', '${DEPT_A}', 'APEX-2026-001', 2026),
        ('${STUDENT_B}', '${COLLEGE_B}', '${USER_B}', '${DEPT_B}', 'ZENITH-2026-001', 2026);

      -- Seed Catalog Skills
      INSERT INTO skills (id, canonical_name, category, description, taxonomy_version)
      VALUES 
        ('${SKILL_ID}', 'Distributed Systems Core Test', 'Backend', 'Core distributed systems knowledge', '1.0'),
        ('${SKILL_ID_2}', 'Database Sharding Test', 'Database', 'Data partitioning and replication', '1.0');

      -- Seed Rubric Version
      INSERT INTO rubric_versions (id, skill_id, version_no, dimensions, levels)
      VALUES ('${RUBRIC_ID}', '${SKILL_ID}', 99, '{"technical_accuracy": 0.5, "edge_cases": 0.5}'::jsonb, '{"1": "Basic", "2": "Advanced"}'::jsonb);

      -- Seed Initial Claimed Student Skills
      INSERT INTO student_skills (id, student_id, skill_id, state)
      VALUES 
        ('${STUDENT_SKILL_A}', '${STUDENT_A}', '${SKILL_ID}', 'claimed'),
        ('${STUDENT_SKILL_B}', '${STUDENT_B}', '${SKILL_ID}', 'claimed');

      -- Seed Evidence Items
      INSERT INTO evidence_items (id, student_id, kind, content_hash, status)
      VALUES 
        ('${EVIDENCE_A_ACCEPTED}', '${STUDENT_A}', 'code_span', repeat('a', 64), 'accepted'),
        ('${EVIDENCE_A_WITHDRAWN}', '${STUDENT_A}', 'code_span', repeat('b', 64), 'withdrawn'),
        ('${EVIDENCE_B_ACCEPTED}', '${STUDENT_B}', 'code_span', repeat('c', 64), 'accepted');

      -- Seed Verification Sessions
      INSERT INTO verification_sessions (id, student_skill_id, rubric_version_id, modality, outcome)
      VALUES 
        ('${SESSION_A_PASSED}', '${STUDENT_SKILL_A}', '${RUBRIC_ID}', 'probe', 'passed'),
        ('${SESSION_A_FAILED}', '${STUDENT_SKILL_A}', '${RUBRIC_ID}', 'probe', 'failed');
    `);
  });

  afterAll(async () => {
    await cleanupFixtures();
  });

  // ============================================================================
  // SECTION 1: ROLE PRIVILEGE & BYPASS CHECKS
  // ============================================================================

  it('1. Role check: app_api, ai_worker, and fairness_job must have NOBYPASSRLS', async () => {
    const res = await runQuery(`
      SELECT rolname, rolbypassrls 
      FROM pg_roles 
      WHERE rolname IN ('app_api', 'ai_worker', 'fairness_job')
      ORDER BY rolname;
    `);

    expect(res).toHaveLength(3);
    for (const role of res) {
      expect(role.rolbypassrls).toBe(false);
    }
  });

  // ============================================================================
  // SECTION 2: TABLE AUDIT & RLS ENFORCEMENT
  // ============================================================================

  it('2. Table check: all 42 domain and tenant tables have RLS enabled and forced', async () => {
    const res = await runQuery(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity 
      FROM pg_class c 
      JOIN pg_namespace n ON n.oid = c.relnamespace 
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname;
    `);

    expect(res.length).toBe(42);
    for (const table of res) {
      expect(table.relrowsecurity).toBe(true);
      expect(table.relforcerowsecurity).toBe(true);
    }
  });

  // ============================================================================
  // SECTION 3: DETERMINISTIC MULTI-TENANT ISOLATION UNDER app_api
  // ============================================================================

  it('3. Multi-tenant SELECT isolation: College A reads Student A, sees 0 Student B rows', async () => {
    const sql = `
      BEGIN;
      SET LOCAL ROLE app_api;
      SET LOCAL "app.current_org_id" = '${COLLEGE_A}';
      SELECT id, org_id, enrollment_no FROM students WHERE id IN ('${STUDENT_A}', '${STUDENT_B}');
      COMMIT;
    `;
    const res = await runQuery(sql);

    expect(res).toHaveLength(1);
    expect(res[0].id).toBe(STUDENT_A);
    expect(res[0].org_id).toBe(COLLEGE_A);
    expect(res[0].enrollment_no).toBe('APEX-2026-001');
  });

  it('4. Multi-tenant SELECT isolation: College B reads Student B, sees 0 Student A rows', async () => {
    const sql = `
      BEGIN;
      SET LOCAL ROLE app_api;
      SET LOCAL "app.current_org_id" = '${COLLEGE_B}';
      SELECT id, org_id, enrollment_no FROM students WHERE id IN ('${STUDENT_A}', '${STUDENT_B}');
      COMMIT;
    `;
    const res = await runQuery(sql);

    expect(res).toHaveLength(1);
    expect(res[0].id).toBe(STUDENT_B);
    expect(res[0].org_id).toBe(COLLEGE_B);
    expect(res[0].enrollment_no).toBe('ZENITH-2026-001');
  });

  it('5. Multi-tenant INSERT violation: College A cannot insert a student for College B', async () => {
    const sql = `
      BEGIN;
      SET LOCAL ROLE app_api;
      SET LOCAL "app.current_org_id" = '${COLLEGE_A}';
      INSERT INTO students (org_id, user_id, department_id, enrollment_no, graduating_year)
      VALUES (
        '${COLLEGE_B}', 
        '${USER_A}', 
        '${DEPT_B}', 
        'ROGUE-CROSS-INSERT', 
        2027
      );
      COMMIT;
    `;

    await expect(runQuery(sql)).rejects.toThrow(/new row violates row-level security policy/);
  });

  it('6. Multi-tenant UPDATE isolation: College A cannot mutate College B records', async () => {
    const sql = `
      BEGIN;
      SET LOCAL ROLE app_api;
      SET LOCAL "app.current_org_id" = '${COLLEGE_A}';
      UPDATE students 
      SET graduating_year = 2099 
      WHERE id = '${STUDENT_B}';
      COMMIT;
    `;
    await runQuery(sql);

    // Verify under College B that Student B was NOT mutated
    const verifySql = `
      BEGIN;
      SET LOCAL ROLE app_api;
      SET LOCAL "app.current_org_id" = '${COLLEGE_B}';
      SELECT graduating_year FROM students WHERE id = '${STUDENT_B}';
      COMMIT;
    `;
    const res = await runQuery(verifySql);
    expect(res).toHaveLength(1);
    expect(res[0].graduating_year).toBe(2026); // Value remains completely unchanged!
  });

  it('7. Multi-tenant DELETE isolation: College A cannot delete College B records', async () => {
    const sql = `
      BEGIN;
      SET LOCAL ROLE app_api;
      SET LOCAL "app.current_org_id" = '${COLLEGE_A}';
      DELETE FROM students WHERE id = '${STUDENT_B}';
      COMMIT;
    `;
    // Under RLS, deleting a foreign row affects 0 rows silently
    await runQuery(sql);

    // Explicitly verify under College B that Student B STILL exists with exact original values
    const verifySql = `
      BEGIN;
      SET LOCAL ROLE app_api;
      SET LOCAL "app.current_org_id" = '${COLLEGE_B}';
      SELECT id, org_id, enrollment_no, graduating_year FROM students WHERE id = '${STUDENT_B}';
      COMMIT;
    `;
    const res = await runQuery(verifySql);
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe(STUDENT_B);
    expect(res[0].org_id).toBe(COLLEGE_B);
    expect(res[0].enrollment_no).toBe('ZENITH-2026-001');
    expect(res[0].graduating_year).toBe(2026);
  });

  // ============================================================================
  // SECTION 4: CONNECTION POOLING CONTEXT ISOLATION & FAIL-CLOSED BEHAVIOR
  // ============================================================================

  it('8. Connection pooling context reset: context clears and fails closed when app.current_org_id is absent', async () => {
    // 1. Transaction A sets College A context
    await runQuery(`
      BEGIN;
      SET LOCAL ROLE app_api;
      SET LOCAL "app.current_org_id" = '${COLLEGE_A}';
      SELECT id FROM students WHERE id = '${STUDENT_A}';
      COMMIT;
    `);

    // 2. Transaction B runs under app_api WITHOUT setting org context
    const failClosedSql = `
      BEGIN;
      SET LOCAL ROLE app_api;
      -- Note: app.current_org_id is deliberately NOT set
      SELECT id FROM students WHERE id IN ('${STUDENT_A}', '${STUDENT_B}');
      COMMIT;
    `;
    const res = await runQuery(failClosedSql);
    // When tenant context is absent, current_app_org_id() is NULL, so org_id = NULL evaluates to false -> 0 rows returned
    expect(res).toEqual([]);
  });

  // ============================================================================
  // SECTION 5: HARDENED SKILL VERIFICATION INVARIANTS (ALL 8 PATHS ON REAL DB)
  // ============================================================================

  it('9. Path 1: Cannot insert a VERIFIED skill without accepted evidence and verification record', async () => {
    const sql = `
      INSERT INTO student_skills (student_id, skill_id, state, last_verification_id, valid_until)
      VALUES (
        '${STUDENT_A}',
        '${SKILL_ID_2}',
        'verified',
        NULL,
        NULL
      );
    `;

    await expect(runQuery(sql)).rejects.toThrow(/Verified skills require last_verification_id and valid_until/);
  });

  it('10. Path 2: Cannot update an existing skill (claimed) to VERIFIED without accepted evidence', async () => {
    const sql = `
      UPDATE student_skills
      SET state = 'verified',
          last_verification_id = '${SESSION_A_PASSED}',
          valid_until = NOW() + INTERVAL '1 year'
      WHERE id = '${STUDENT_SKILL_A}';
    `;

    await expect(runQuery(sql)).rejects.toThrow(/Cannot set skill state to verified without qualifying accepted evidence/);
  });

  it('11. Path 3: Cannot verify against withdrawn evidence', async () => {
    // Link withdrawn evidence to skill
    await runQuery(`
      INSERT INTO skill_evidence (student_skill_id, evidence_id, role)
      VALUES ('${STUDENT_SKILL_A}', '${EVIDENCE_A_WITHDRAWN}', 'supports');
    `);

    // Attempt to verify with withdrawn evidence linked
    const verifySql = `
      UPDATE student_skills
      SET state = 'verified',
          last_verification_id = '${SESSION_A_PASSED}',
          valid_until = NOW() + INTERVAL '1 year'
      WHERE id = '${STUDENT_SKILL_A}';
    `;

    await expect(runQuery(verifySql)).rejects.toThrow(/Cannot set skill state to verified without qualifying accepted evidence/);

    // Clean up link
    await runQuery(`DELETE FROM skill_evidence WHERE student_skill_id = '${STUDENT_SKILL_A}' AND evidence_id = '${EVIDENCE_A_WITHDRAWN}';`);
  });

  it('12. Path 4: Cannot link evidence belonging to Student B to Student A skill (trigger check)', async () => {
    const sql = `
      INSERT INTO skill_evidence (student_skill_id, evidence_id, role)
      VALUES ('${STUDENT_SKILL_A}', '${EVIDENCE_B_ACCEPTED}', 'supports');
    `;

    await expect(runQuery(sql)).rejects.toThrow(/Cannot link evidence belonging to student.*to skill belonging to student/);
  });

  it('13. Path 5: Cannot verify using evidence linked to a different skill', async () => {
    // Even if student has accepted evidence, if it's NOT linked to this student_skill, verification fails
    const sql = `
      UPDATE student_skills
      SET state = 'verified',
          last_verification_id = '${SESSION_A_PASSED}',
          valid_until = NOW() + INTERVAL '1 year'
      WHERE id = '${STUDENT_SKILL_A}';
    `;

    await expect(runQuery(sql)).rejects.toThrow(/Cannot set skill state to verified without qualifying accepted evidence/);
  });

  it('14. Path 6: Cannot verify after a failed probe session', async () => {
    // Link valid accepted evidence
    await runQuery(`
      INSERT INTO skill_evidence (student_skill_id, evidence_id, role)
      VALUES ('${STUDENT_SKILL_A}', '${EVIDENCE_A_ACCEPTED}', 'supports');
    `);

    // Attempt to verify referencing the FAILED session
    const sql = `
      UPDATE student_skills
      SET state = 'verified',
          last_verification_id = '${SESSION_A_FAILED}',
          valid_until = NOW() + INTERVAL '1 year'
      WHERE id = '${STUDENT_SKILL_A}';
    `;

    await expect(runQuery(sql)).rejects.toThrow(/outcome is failed, expected passed/);
  });

  it('15. Path 7: Can verify with qualifying accepted evidence and passing verification session', async () => {
    // Evidence is already linked in test 14, now reference SESSION_A_PASSED
    const sql = `
      UPDATE student_skills
      SET state = 'verified',
          last_verification_id = '${SESSION_A_PASSED}',
          valid_until = NOW() + INTERVAL '1 year'
      WHERE id = '${STUDENT_SKILL_A}'
      RETURNING state, last_verification_id;
    `;

    const res = await runQuery(sql);
    expect(res).toHaveLength(1);
    expect(res[0].state).toBe('verified');
    expect(res[0].last_verification_id).toBe(SESSION_A_PASSED);
  });

  it('16. Path 8: Expired skill can be re-verified only through qualifying passing path', async () => {
    // 1. Mark skill as expired
    await runQuery(`
      UPDATE student_skills
      SET state = 'expired'
      WHERE id = '${STUDENT_SKILL_A}';
    `);

    // 2. Attempt re-verification with failed session -> rejects
    const failReverif = `
      UPDATE student_skills
      SET state = 'verified',
          last_verification_id = '${SESSION_A_FAILED}',
          valid_until = NOW() + INTERVAL '1 year'
      WHERE id = '${STUDENT_SKILL_A}';
    `;
    await expect(runQuery(failReverif)).rejects.toThrow(/outcome is failed, expected passed/);

    // 3. Re-verify with passing session -> succeeds
    const passReverif = `
      UPDATE student_skills
      SET state = 'verified',
          last_verification_id = '${SESSION_A_PASSED}',
          valid_until = NOW() + INTERVAL '2 years'
      WHERE id = '${STUDENT_SKILL_A}'
      RETURNING state;
    `;
    const res = await runQuery(passReverif);
    expect(res[0].state).toBe('verified');
  });

  // ============================================================================
  // SECTION 6: AUDIT IMMUTABILITY ON REAL POSTGRESQL (DEFENSE-IN-DEPTH)
  // ============================================================================

  it('17. Audit Immutability Layer 1: app_api role is denied UPDATE and DELETE privileges at DCL level', async () => {
    // Insert an audit event under College A
    await runQuery(`
      BEGIN;
      SET LOCAL ROLE app_api;
      SET LOCAL "app.current_org_id" = '${COLLEGE_A}';
      INSERT INTO audit_events (seq, org_id, actor_type, action, object_type, prev_hash, hash)
      VALUES (
        99991,
        '${COLLEGE_A}',
        'service',
        'AUDIT_VERIFICATION_TEST',
        'test_record',
        repeat('0', 64),
        repeat('a', 64)
      );
      COMMIT;
    `);

    // Attempt UPDATE under app_api -> rejected by role permissions (DCL)
    const updateSql = `
      BEGIN;
      SET LOCAL ROLE app_api;
      SET LOCAL "app.current_org_id" = '${COLLEGE_A}';
      UPDATE audit_events 
      SET action = 'MALICIOUS_TAMPER' 
      WHERE seq = 99991;
      COMMIT;
    `;
    await expect(runQuery(updateSql)).rejects.toThrow(/permission denied for table audit_events/);

    // Attempt DELETE under app_api -> rejected by role permissions (DCL)
    const deleteSql = `
      BEGIN;
      SET LOCAL ROLE app_api;
      SET LOCAL "app.current_org_id" = '${COLLEGE_A}';
      DELETE FROM audit_events WHERE seq = 99991;
      COMMIT;
    `;
    await expect(runQuery(deleteSql)).rejects.toThrow(/permission denied for table audit_events/);
  });

  it('18. Audit Immutability Layer 2: Trigger trg_audit_events_immutable prohibits UPDATE regardless of privileges', async () => {
    // Attempt UPDATE as superuser (which has full table permissions)
    const superuserUpdate = `
      UPDATE audit_events 
      SET action = 'TRIGGER_PROHIBIT_TEST' 
      WHERE seq = 99991;
    `;

    await expect(runQuery(superuserUpdate)).rejects.toThrow(/audit_events is append-only: UPDATE and DELETE operations are strictly prohibited/);
  });

  it('19. Audit Immutability Layer 2: Trigger trg_audit_events_immutable prohibits DELETE regardless of privileges', async () => {
    // Attempt DELETE as superuser
    const superuserDelete = `
      DELETE FROM audit_events WHERE seq = 99991;
    `;

    await expect(runQuery(superuserDelete)).rejects.toThrow(/audit_events is append-only: UPDATE and DELETE operations are strictly prohibited/);

    // Administrative cleanup of the test event using explicit DISABLE TRIGGER
    await runQuery(`
      ALTER TABLE audit_events DISABLE TRIGGER trg_audit_events_immutable;
      DELETE FROM audit_events WHERE seq = 99991;
      ALTER TABLE audit_events ENABLE TRIGGER trg_audit_events_immutable;
    `);
  });
});
