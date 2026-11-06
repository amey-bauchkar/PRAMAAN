import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDbPool, withTenantTransaction } from '../src/db/pool.js';
import { PgTenantRepository } from '../src/repositories/tenant-repository.js';
import { runQuery, assertSafeTestEnvironment, assertNotInstitutionalTenant } from '../../../scripts/supabase-runner.mjs';
import pg from 'pg';

describe('Production Security: Restricted Runtime Database Login Verification (P0-2, P0-3)', () => {
  let pool: pg.Pool;

  const TENANT_A_ID = '90000000-0000-0000-0000-000000000001';
  const TENANT_B_ID = '90000000-0000-0000-0000-000000000002';
  const PARENT_UNI_ID = '90000000-0000-0000-0000-000000000003';
  const UNRELATED_UNI_ID = '90000000-0000-0000-0000-000000000004';
  const STANDALONE_COLLEGE_ID = '90000000-0000-0000-0000-000000000005';

  beforeAll(async () => {
    try {
      process.loadEnvFile?.();
    } catch {}

    // Security environment safety guard: prevent running against production
    assertSafeTestEnvironment('Restricted runtime user integration tests');

    // Tenant protection check: ensure fixtures do not collide with institutional records
    const fixtureIds = [TENANT_A_ID, TENANT_B_ID, PARENT_UNI_ID, UNRELATED_UNI_ID, STANDALONE_COLLEGE_ID];
    for (const id of fixtureIds) {
      assertNotInstitutionalTenant(id, 'Fixture seeding');
    }

    pool = getDbPool();

    // Seed test organizations via administrative runner
    await runQuery(`
      DELETE FROM organizations WHERE id IN (
        '${TENANT_A_ID}', '${TENANT_B_ID}', '${PARENT_UNI_ID}', '${UNRELATED_UNI_ID}', '${STANDALONE_COLLEGE_ID}'
      );

      -- 1. Seed Parent and Unrelated Universities
      INSERT INTO organizations (id, name, kind)
      VALUES 
        ('${PARENT_UNI_ID}', 'Affiliated State University', 'university'),
        ('${UNRELATED_UNI_ID}', 'Unrelated Foreign University', 'university');

      -- 2. Seed Colleges with explicit parent relationships
      INSERT INTO organizations (id, name, kind, parent_id)
      VALUES 
        ('${TENANT_A_ID}', 'Isolated College Alpha', 'college', '${PARENT_UNI_ID}'),
        ('${TENANT_B_ID}', 'Isolated College Beta', 'college', '${UNRELATED_UNI_ID}'),
        ('${STANDALONE_COLLEGE_ID}', 'Autonomous Standalone College', 'college', NULL);
    `);
  });

  afterAll(async () => {
    await runQuery(`
      DELETE FROM organizations WHERE id IN (
        '${TENANT_A_ID}', '${TENANT_B_ID}', '${PARENT_UNI_ID}', '${UNRELATED_UNI_ID}', '${STANDALONE_COLLEGE_ID}'
      );
    `);
  });

  it('1. Application pool connects strictly as pramaan_app_user (never postgres, superuser or service_role)', async () => {
    const client = await pool.connect();
    try {
      const res = await client.query('SELECT current_user, session_user;');
      const row = res.rows[0];

      expect(row.session_user).toBe('pramaan_app_user');
      expect(row.current_user).toBe('pramaan_app_user');

      // Assert strictly NOT administrative principals
      expect(row.session_user).not.toBe('postgres');
      expect(row.session_user).not.toBe('supabase_admin');
      expect(row.session_user).not.toBe('service_role');
      expect(row.session_user).not.toBe('authenticated');
      expect(row.session_user).not.toBe('anon');
    } finally {
      client.release();
    }
  });

  it('2. Verifies pramaan_app_user is NOT a superuser', async () => {
    const client = await pool.connect();
    try {
      const res = await client.query(`
        SELECT rolname, rolsuper 
        FROM pg_roles 
        WHERE rolname = current_user;
      `);
      expect(res.rows.length).toBe(1);
      expect(res.rows[0].rolsuper).toBe(false);
    } finally {
      client.release();
    }
  });

  it('3. Verifies pramaan_app_user has NOBYPASSRLS (Kernel RLS enforced)', async () => {
    const client = await pool.connect();
    try {
      const res = await client.query(`
        SELECT rolname, rolbypassrls 
        FROM pg_roles 
        WHERE rolname = current_user;
      `);
      expect(res.rows.length).toBe(1);
      expect(res.rows[0].rolbypassrls).toBe(false);
    } finally {
      client.release();
    }
  });

  it('4. Verifies pramaan_app_user cannot create roles or databases', async () => {
    const client = await pool.connect();
    try {
      const res = await client.query(`
        SELECT rolcreaterole, rolcreatedb 
        FROM pg_roles 
        WHERE rolname = current_user;
      `);
      expect(res.rows.length).toBe(1);
      expect(res.rows[0].rolcreaterole).toBe(false);
      expect(res.rows[0].rolcreatedb).toBe(false);
    } finally {
      client.release();
    }
  });

  it('5. Verifies pramaan_app_user is prohibited from executing DDL statements', async () => {
    const client = await pool.connect();
    try {
      // Attempting DDL must fail immediately with permission denied
      await expect(
        client.query('CREATE TABLE ddl_exploit_table (id int);')
      ).rejects.toThrow(/permission denied/i);
    } finally {
      client.release();
    }
  });

  it('6. Verifies transaction role assumption switches to app_api within tenant transaction', async () => {
    const testContext = {
      userId: '00000000-0000-0000-0000-000000000001',
      orgId: '00000000-0000-0000-0000-000000000001',
      role: 'officer' as const
    };

    await withTenantTransaction(testContext, async (client) => {
      const res = await client.query('SELECT current_user, session_user;');
      expect(res.rows[0].session_user).toBe('pramaan_app_user');
      expect(res.rows[0].current_user).toBe('app_api');

      // Verify transaction-scoped context settings
      const settingRes = await client.query(`
        SELECT current_setting('app.current_org_id', true) as org_id,
               current_setting('app.current_user_id', true) as user_id,
               current_setting('app.current_user_role', true) as role;
      `);
      expect(settingRes.rows[0].org_id).toBe(testContext.orgId);
      expect(settingRes.rows[0].user_id).toBe(testContext.userId);
      expect(settingRes.rows[0].role).toBe('officer');
    }, pool);
  });

  it('7. Verifies scoped identity resolution function callable by pramaan_app_user', async () => {
    const client = await pool.connect();
    try {
      // Calling resolve_user_identity succeeds without permission error
      const res = await client.query('SELECT * FROM resolve_user_identity($1);', ['nonexistent-uuid']);
      expect(Array.isArray(res.rows)).toBe(true);
      expect(res.rows.length).toBe(0);
    } finally {
      client.release();
    }
  });

  it('8. Verifies PgTenantRepository enforces tenant isolation under app_api RLS (P0-3)', async () => {
    const tenantRepo = new PgTenantRepository(pool);

    const contextA = {
      userId: '91000000-0000-0000-0000-000000000001',
      orgId: TENANT_A_ID,
      role: 'officer' as const
    };

    const contextB = {
      userId: '91000000-0000-0000-0000-000000000002',
      orgId: TENANT_B_ID,
      role: 'officer' as const
    };

    // 1. College A querying listOrganizations discovers itself but NEVER discovers College B
    const listA = await tenantRepo.listOrganizations(contextA);
    expect(listA.some(org => org.id === TENANT_A_ID)).toBe(true);
    expect(listA.some(org => org.id === TENANT_B_ID)).toBe(false);

    // 2. College A querying getOrganization for College B returns null (kernel RLS blocks row)
    const crossTenantGet = await tenantRepo.getOrganization(contextA, TENANT_B_ID);
    expect(crossTenantGet).toBeNull();

    // 3. College A querying getOrganization for itself returns sanitized metadata
    const ownTenantGet = await tenantRepo.getOrganization(contextA, TENANT_A_ID);
    expect(ownTenantGet).not.toBeNull();
    expect(ownTenantGet?.id).toBe(TENANT_A_ID);
    expect(ownTenantGet?.name).toBe('Isolated College Alpha');
    // Ensure sensitive config fields are NOT in the returned DTO
    expect((ownTenantGet as any).config).toBeUndefined();
    expect((ownTenantGet as any).key_ref).toBeUndefined();
    expect((ownTenantGet as any).rate_limit_config).toBeUndefined();

    // 4. College B querying listOrganizations discovers itself but NEVER discovers College A
    const listB = await tenantRepo.listOrganizations(contextB);
    expect(listB.some(org => org.id === TENANT_B_ID)).toBe(true);
    expect(listB.some(org => org.id === TENANT_A_ID)).toBe(false);

    // 5. College B querying getOrganization for College A returns null
    const crossTenantGetB = await tenantRepo.getOrganization(contextB, TENANT_A_ID);
    expect(crossTenantGetB).toBeNull();
  });

  it('9. Enforces parent university discovery relationship (College discovers parent university, NEVER unrelated university)', async () => {
    const tenantRepo = new PgTenantRepository(pool);

    const contextA = {
      userId: '91000000-0000-0000-0000-000000000001',
      orgId: TENANT_A_ID, // College Alpha whose parent_id is PARENT_UNI_ID
      role: 'officer' as const
    };

    const contextStandalone = {
      userId: '91000000-0000-0000-0000-000000000005',
      orgId: STANDALONE_COLLEGE_ID, // Autonomous college with parent_id = NULL
      role: 'officer' as const
    };

    // 1. College A listOrganizations discovers itself AND its direct parent university
    const listA = await tenantRepo.listOrganizations(contextA);
    expect(listA.some(org => org.id === TENANT_A_ID)).toBe(true);
    expect(listA.some(org => org.id === PARENT_UNI_ID)).toBe(true);

    // 2. College A NEVER discovers an unrelated university or another college
    expect(listA.some(org => org.id === UNRELATED_UNI_ID)).toBe(false);
    expect(listA.some(org => org.id === TENANT_B_ID)).toBe(false);

    // 3. College A can getOrganization for its parent university
    const parentUni = await tenantRepo.getOrganization(contextA, PARENT_UNI_ID);
    expect(parentUni).not.toBeNull();
    expect(parentUni?.id).toBe(PARENT_UNI_ID);
    expect(parentUni?.name).toBe('Affiliated State University');

    // 4. College A querying getOrganization for the unrelated university returns null (kernel RLS drops row)
    const unrelatedUni = await tenantRepo.getOrganization(contextA, UNRELATED_UNI_ID);
    expect(unrelatedUni).toBeNull();

    // 5. Standalone autonomous college with no parent discovers ONLY itself
    const listStandalone = await tenantRepo.listOrganizations(contextStandalone);
    expect(listStandalone.some(org => org.id === STANDALONE_COLLEGE_ID)).toBe(true);
    expect(listStandalone.some(org => org.id === PARENT_UNI_ID)).toBe(false);
    expect(listStandalone.some(org => org.id === UNRELATED_UNI_ID)).toBe(false);

    // 6. Standalone college querying getOrganization for any university returns null
    const standaloneParentAttempt = await tenantRepo.getOrganization(contextStandalone, PARENT_UNI_ID);
    expect(standaloneParentAttempt).toBeNull();
  });
});
