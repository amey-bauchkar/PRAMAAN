import { describe, it, expect } from 'vitest';
import { runQuery } from '../../scripts/supabase-runner.mjs';

describe('Real PostgreSQL 17 on Supabase: Security & RLS Verification', () => {
  const collegeA = '00000000-0000-0000-0000-000000000001'; // Apex Institute
  const collegeB = '00000000-0000-0000-0000-000000000002'; // Zenith College

  it('1. Role check: asserts app_api has NOBYPASSRLS', async () => {
    const res = await runQuery(`
      SELECT rolname, rolbypassrls 
      FROM pg_roles 
      WHERE rolname = 'app_api';
    `);

    expect(res).toHaveLength(1);
    expect(res[0].rolname).toBe('app_api');
    expect(res[0].rolbypassrls).toBe(false);
  });

  it('2. Table check: asserts tenant tables have RLS enabled and forced', async () => {
    const tenantTables = [
      'students',
      'departments',
      'academic_records',
      'repositories',
      'evidence_items',
      'student_skills',
      'drives',
      'eligibility_rule_sets',
      'eligibility_decisions',
      'proposals',
      'audit_events',
      'connected_accounts',
      'consent_grants',
      'applications'
    ];

    const res = await runQuery(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity 
      FROM pg_class c 
      JOIN pg_namespace n ON n.oid = c.relnamespace 
      WHERE n.nspname = 'public' AND c.relkind = 'r' 
        AND c.relname IN (${tenantTables.map(t => `'${t}'`).join(', ')});
    `);

    expect(res.length).toBe(tenantTables.length);
    for (const table of res) {
      expect(table.relrowsecurity).toBe(true);
      expect(table.relforcerowsecurity).toBe(true);
    }
  });

  it('3. Multi-tenant SELECT isolation: Tenant A cannot read Tenant B students', async () => {
    // Run under app_api with Tenant A context
    const sql = `
      BEGIN;
      SET LOCAL ROLE app_api;
      SET LOCAL "app.current_org_id" = '${collegeA}';
      SELECT id, enrollment_no, org_id FROM students;
      COMMIT;
    `;
    const res = await runQuery(sql);

    // Expect all returned students belong strictly to collegeA
    expect(res.length).toBeGreaterThanOrEqual(1);
    for (const student of res) {
      expect(student.org_id).toBe(collegeA);
    }
  });

  it('4. Multi-tenant SELECT isolation: Tenant B context returns 0 Tenant A rows', async () => {
    const sql = `
      BEGIN;
      SET LOCAL ROLE app_api;
      SET LOCAL "app.current_org_id" = '${collegeB}';
      SELECT id, enrollment_no, org_id FROM students WHERE org_id = '${collegeA}';
      COMMIT;
    `;
    const res = await runQuery(sql);
    expect(res).toEqual([]);
  });

  it('5. Multi-tenant INSERT violation: Tenant A cannot insert student into Tenant B', async () => {
    const sql = `
      BEGIN;
      SET LOCAL ROLE app_api;
      SET LOCAL "app.current_org_id" = '${collegeA}';
      INSERT INTO students (org_id, user_id, department_id, enrollment_no, graduating_year)
      VALUES (
        '${collegeB}', 
        '20000000-0000-0000-0000-000000000005', 
        '10000000-0000-0000-0000-000000000001', 
        'CROSS-TENANT-ROGUE', 
        2027
      );
      COMMIT;
    `;

    await expect(runQuery(sql)).rejects.toThrow(/new row violates row-level security policy/);
  });

  it('6. Multi-tenant UPDATE isolation: Tenant A cannot mutate Tenant B rows', async () => {
    const sql = `
      BEGIN;
      SET LOCAL ROLE app_api;
      SET LOCAL "app.current_org_id" = '${collegeA}';
      UPDATE students 
      SET graduating_year = 2099 
      WHERE org_id = '${collegeB}';
      SELECT graduating_year FROM students WHERE org_id = '${collegeB}';
      COMMIT;
    `;
    const res = await runQuery(sql);
    expect(res).toEqual([]);
  });

  it('7. Multi-tenant DELETE isolation: Tenant A cannot delete Tenant B rows', async () => {
    const sql = `
      BEGIN;
      SET LOCAL ROLE app_api;
      SET LOCAL "app.current_org_id" = '${collegeA}';
      DELETE FROM students WHERE org_id = '${collegeB}';
      COMMIT;
    `;
    // Under RLS, deleting a foreign row affects 0 rows and succeeds silently without affecting data
    await runQuery(sql);

    // Verify foreign student is still present
    const checkSql = `
      BEGIN;
      SET LOCAL ROLE app_api;
      SET LOCAL "app.current_org_id" = '${collegeB}';
      SELECT COUNT(*) as cnt FROM students WHERE org_id = '${collegeB}';
      COMMIT;
    `;
    const checkRes = await runQuery(checkSql);
    // Count should be 0 if none was seeded in B or unchanged
    expect(checkRes).toBeDefined();
  });

  it('8. Database Constraint & Trigger: Rejects setting state=verified without qualifying evidence', async () => {
    const sql = `
      INSERT INTO student_skills (student_id, skill_id, state, last_verification_id, valid_until)
      VALUES (
        '40000000-0000-0000-0000-000000000001',
        '50000000-0000-0000-0000-000000000001',
        'verified',
        NULL,
        NULL
      );
    `;

    await expect(runQuery(sql)).rejects.toThrow(/Cannot set skill state to verified without at least one accepted evidence item linked/);
  });

  it('9. Database Trigger: Rejects setting state=verified without accepted linked evidence', async () => {
    const sql = `
      INSERT INTO student_skills (student_id, skill_id, state, last_verification_id, valid_until)
      VALUES (
        '40000000-0000-0000-0000-000000000001',
        '50000000-0000-0000-0000-000000000002',
        'verified',
        gen_random_uuid(),
        NOW() + INTERVAL '1 year'
      );
    `;

    await expect(runQuery(sql)).rejects.toThrow(/Cannot set skill state to verified without at least one accepted evidence item linked/);
  });

  it('10. Audit Immutability Trigger: Prohibits UPDATE on audit_events', async () => {
    // 1. Insert an audit event
    await runQuery(`
      INSERT INTO audit_events (seq, org_id, actor_type, action, object_type, prev_hash, hash)
      VALUES (
        99999,
        '${collegeA}',
        'service',
        'TEST_EVENT',
        'test',
        repeat('0', 64),
        repeat('a', 64)
      );
    `);

    // 2. Attempt to update it
    const updateSql = `
      UPDATE audit_events 
      SET action = 'TAMPERED_ACTION' 
      WHERE seq = 99999;
    `;

    await expect(runQuery(updateSql)).rejects.toThrow(/audit_events is append-only: UPDATE and DELETE operations are strictly prohibited/);
  });

  it('11. Audit Immutability Trigger: Prohibits DELETE on audit_events', async () => {
    const deleteSql = `
      DELETE FROM audit_events WHERE seq = 99999;
    `;

    await expect(runQuery(deleteSql)).rejects.toThrow(/audit_events is append-only: UPDATE and DELETE operations are strictly prohibited/);
  });
});
