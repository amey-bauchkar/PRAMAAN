import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  assertSafeTestEnvironment,
  assertNotInstitutionalTenant,
  INSTITUTIONAL_ORG_IDS,
  APPROVED_LOCAL_HOSTS,
  DEFAULT_APPROVED_SUPABASE_PROJECT_REFS,
  isProductionDatabaseTarget,
  isApprovedTestDatabase,
  isApprovedSupabaseProjectRef,
  isDestructiveQuery,
  isMutationQuery,
  cleanSqlForInspection,
  safeCleanupTestAuditEvents,
  runQuery
} from '../../scripts/supabase-runner.mjs';

describe('Database Test Safety Guard & Production Target Protection (Final Hardening)', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalEnvironment = process.env.ENVIRONMENT;
  const originalVercelEnv = process.env.VERCEL_ENV;
  const originalOptIn = process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
  const originalAdminUrl = process.env.DATABASE_URL_ADMIN;
  const originalDbUrl = process.env.DATABASE_URL;
  const originalMgmtToken = process.env.SUPABASE_MANAGEMENT_TOKEN;
  const originalProjectRef = process.env.SUPABASE_PROJECT_REF;

  beforeEach(() => {
    (process.env as any).NODE_ENV = 'test';
    delete process.env.ENVIRONMENT;
    delete process.env.VERCEL_ENV;
    process.env.ALLOW_DESTRUCTIVE_DB_TESTS = 'true';
    process.env.DATABASE_URL_ADMIN = 'postgresql://postgres:ci_password@localhost:5432/pramaan_test';
    delete process.env.DATABASE_URL;
    delete process.env.SUPABASE_MANAGEMENT_TOKEN;
    delete process.env.SUPABASE_PROJECT_REF;
  });

  afterEach(() => {
    (process.env as any).NODE_ENV = originalNodeEnv;
    if (originalEnvironment !== undefined) {
      process.env.ENVIRONMENT = originalEnvironment;
    } else {
      delete process.env.ENVIRONMENT;
    }
    if (originalVercelEnv !== undefined) {
      process.env.VERCEL_ENV = originalVercelEnv;
    } else {
      delete process.env.VERCEL_ENV;
    }
    if (originalOptIn !== undefined) {
      process.env.ALLOW_DESTRUCTIVE_DB_TESTS = originalOptIn;
    } else {
      delete process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
    }
    if (originalAdminUrl !== undefined) {
      process.env.DATABASE_URL_ADMIN = originalAdminUrl;
    } else {
      delete process.env.DATABASE_URL_ADMIN;
    }
    if (originalDbUrl !== undefined) {
      process.env.DATABASE_URL = originalDbUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
    if (originalMgmtToken !== undefined) {
      process.env.SUPABASE_MANAGEMENT_TOKEN = originalMgmtToken;
    } else {
      delete process.env.SUPABASE_MANAGEMENT_TOKEN;
    }
    if (originalProjectRef !== undefined) {
      process.env.SUPABASE_PROJECT_REF = originalProjectRef;
    } else {
      delete process.env.SUPABASE_PROJECT_REF;
    }
  });

  // --- 1. Basic Environment Guards ---
  it('1. Allows execution when NODE_ENV is test or development and opt-in is granted on approved test DB', () => {
    (process.env as any).NODE_ENV = 'test';
    expect(() => assertSafeTestEnvironment('Unit test execution')).not.toThrow();

    (process.env as any).NODE_ENV = 'development';
    expect(() => assertSafeTestEnvironment('Dev test execution')).not.toThrow();
  });

  it('2. Fails closed and blocks execution when NODE_ENV is production', () => {
    (process.env as any).NODE_ENV = 'production';
    expect(() => assertSafeTestEnvironment('Destructive test execution')).toThrow(
      /cannot be executed in a production environment/
    );
  });

  it('3. Fails closed and blocks execution when ENVIRONMENT is production', () => {
    process.env.ENVIRONMENT = 'production';
    expect(() => assertSafeTestEnvironment('Staging migration execution')).toThrow(
      /cannot be executed in a production environment/
    );
  });

  it('4. Fails closed and blocks execution when VERCEL_ENV is production', () => {
    process.env.VERCEL_ENV = 'production';
    expect(() => assertSafeTestEnvironment('Vercel preview test execution')).toThrow(
      /cannot be executed in a production environment/
    );
  });

  it('5. Missing explicit opt-in (ALLOW_DESTRUCTIVE_DB_TESTS) fails closed even when NODE_ENV is test', () => {
    delete process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
    delete process.env.ALLOW_DESTRUCTIVE_TESTS;
    (process.env as any).NODE_ENV = 'test';

    expect(() => assertSafeTestEnvironment('Destructive test execution')).toThrow(
      /requires explicit opt-in via ALLOW_DESTRUCTIVE_DB_TESTS=true/
    );

    process.env.ALLOW_DESTRUCTIVE_DB_TESTS = 'false';
    expect(() => assertSafeTestEnvironment('Destructive test execution')).toThrow(
      /requires explicit opt-in via ALLOW_DESTRUCTIVE_DB_TESTS=true/
    );
  });

  // --- 2. Production Database Target Rejection ---
  it('6. Production database target rejection: identifies and blocks known production database URLs', () => {
    const prodUrls = [
      'postgresql://postgres:pass@db.prod.supabase.co:5432/postgres',
      'postgresql://postgres:pass@aws-0-us-east-1.pooler.supabase.com:6543/pramaan_production',
      'postgresql://postgres:pass@production-db.internal:5432/postgres',
      'postgresql://postgres:pass@aws-0-us-east-1.pooler.supabase.com:6543/prod_edtech'
    ];

    for (const url of prodUrls) {
      expect(isProductionDatabaseTarget(url)).toBe(true);
      expect(() => assertSafeTestEnvironment('Destructive integration test', url)).toThrow(
        /recognized as a production database/
      );
    }
  });

  // --- 3. Replace Substring-Based Allowlisting with Strict URL/Host/DB Parsing ---
  it('7. Rejects substring bypass when unapproved host contains pramaan_test in path (attacker.example/pramaan_test)', () => {
    const spoofedUrl = 'postgresql://postgres:pass@attacker.example:5432/pramaan_test';
    expect(isApprovedTestDatabase(spoofedUrl)).toBe(false);
    expect(() => assertSafeTestEnvironment('Destructive test', spoofedUrl)).toThrow(
      /not on the approved test database allowlist/
    );
  });

  it('8. Rejects subdomain spoofing when unapproved host contains localhost (localhost.attacker.example)', () => {
    const spoofedUrl = 'postgresql://postgres:pass@localhost.attacker.example:5432/pramaan_test';
    expect(isApprovedTestDatabase(spoofedUrl)).toBe(false);
    expect(() => assertSafeTestEnvironment('Destructive test', spoofedUrl)).toThrow(
      /not on the approved test database allowlist/
    );
  });

  it('9. Rejects path/password/query spoofing containing Supabase project ref on unrelated host', () => {
    // Project ref in path
    const pathSpoof = 'postgresql://postgres:pass@attacker.example:5432/qshujrddrzoemlzmleru';
    expect(isApprovedTestDatabase(pathSpoof)).toBe(false);

    // Project ref in password
    const passSpoof = 'postgresql://postgres:qshujrddrzoemlzmleru@attacker.example:5432/postgres';
    expect(isApprovedTestDatabase(passSpoof)).toBe(false);

    // Project ref in query parameter
    const querySpoof = 'postgresql://postgres:pass@attacker.example:5432/postgres?project=qshujrddrzoemlzmleru';
    expect(isApprovedTestDatabase(querySpoof)).toBe(false);
  });

  it('10. Accepts legitimate local PostgreSQL 17 URLs across all approved local host identities', () => {
    expect(APPROVED_LOCAL_HOSTS).toContain('localhost');
    expect(APPROVED_LOCAL_HOSTS).toContain('127.0.0.1');
    expect(APPROVED_LOCAL_HOSTS).toContain('postgres');

    const localUrls = [
      'postgresql://postgres:ci_password@localhost:5432/pramaan_test',
      'postgresql://postgres:ci_password@127.0.0.1:5432/pramaan_test',
      'postgresql://postgres:ci_password@[::1]:5432/pramaan_test',
      'postgresql://postgres:ci_password@host.docker.internal:5432/pramaan_test',
      'postgresql://postgres:ci_password@postgres:5432/pramaan_test'
    ];

    for (const url of localUrls) {
      expect(isApprovedTestDatabase(url)).toBe(true);
      expect(() => assertSafeTestEnvironment('Local test execution', url)).not.toThrow();
    }
  });

  it('11. Accepts explicitly approved development/staging Supabase URLs (direct and pooler formats)', () => {
    expect(DEFAULT_APPROVED_SUPABASE_PROJECT_REFS).toContain('qshujrddrzoemlzmleru');
    expect(isApprovedSupabaseProjectRef('qshujrddrzoemlzmleru')).toBe(true);
    expect(isApprovedSupabaseProjectRef('unapproved_project_ref')).toBe(false);

    const approvedSupabaseUrls = [
      // Direct connection
      'postgresql://postgres:admin_secret@db.qshujrddrzoemlzmleru.supabase.co:5432/postgres',
      // Pooler connection with user.projectRef format
      'postgresql://postgres.qshujrddrzoemlzmleru:pool_secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres'
    ];

    for (const url of approvedSupabaseUrls) {
      expect(isApprovedTestDatabase(url)).toBe(true);
      expect(() => assertSafeTestEnvironment('Supabase staging execution', url)).not.toThrow();
    }
  });

  it('12. Rejects unapproved Supabase project URLs (direct and pooler formats)', () => {
    const unapprovedUrls = [
      'postgresql://postgres:pass@db.unapprovedproject123.supabase.co:5432/postgres',
      'postgresql://postgres.unapprovedproject123:pass@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres'
    ];

    for (const url of unapprovedUrls) {
      expect(isApprovedTestDatabase(url)).toBe(false);
      expect(() => assertSafeTestEnvironment('Destructive test', url)).toThrow(
        /not on the approved test database allowlist/
      );
    }
  });

  it('13. Rejects non-PostgreSQL protocols and invalid URLs', () => {
    expect(isApprovedTestDatabase('http://localhost:5432/pramaan_test')).toBe(false);
    expect(isApprovedTestDatabase('mysql://root:pass@localhost:3306/pramaan_test')).toBe(false);
    expect(isApprovedTestDatabase('not-a-valid-url')).toBe(false);
    expect(isApprovedTestDatabase('')).toBe(false);
    expect(isApprovedTestDatabase(undefined)).toBe(false);
  });

  it('14. Validates database name separately and rejects production database name on local host', () => {
    const prodDbOnLocal = 'postgresql://postgres:pass@localhost:5432/production';
    expect(isProductionDatabaseTarget(prodDbOnLocal)).toBe(true);
    expect(isApprovedTestDatabase(prodDbOnLocal)).toBe(false);

    const emptyDbOnLocal = 'postgresql://postgres:pass@localhost:5432/';
    expect(isApprovedTestDatabase(emptyDbOnLocal)).toBe(false);
  });

  // --- 4. Fail Closed When Database Identity Is Missing ---
  it('15. Fails closed when database target identity is completely missing', () => {
    delete process.env.DATABASE_URL_ADMIN;
    delete process.env.DATABASE_URL;

    expect(() => assertSafeTestEnvironment('Destructive operation')).toThrow(
      /Database target identity is missing/
    );
  });

  it('16. runQuery rejects destructive queries when DATABASE_URL_ADMIN is missing, prohibiting Management API fallback', async () => {
    delete process.env.DATABASE_URL_ADMIN;
    delete process.env.DATABASE_URL;
    process.env.SUPABASE_MANAGEMENT_TOKEN = 'test-token';
    process.env.SUPABASE_PROJECT_REF = 'qshujrddrzoemlzmleru';

    await expect(runQuery('DELETE FROM organizations WHERE id = 1;')).rejects.toThrow(
      /Destructive or mutating database operations require direct DATABASE_URL_ADMIN PostgreSQL connectivity/
    );

    await expect(runQuery('INSERT INTO students (id) VALUES (1);')).rejects.toThrow(
      /Destructive or mutating database operations require direct DATABASE_URL_ADMIN PostgreSQL connectivity/
    );
  });

  it('17. runQuery rejects Management API execution when project ref is unapproved or missing', async () => {
    delete process.env.DATABASE_URL_ADMIN;
    delete process.env.DATABASE_URL;
    process.env.SUPABASE_MANAGEMENT_TOKEN = 'test-token';

    // Missing project ref
    delete process.env.SUPABASE_PROJECT_REF;
    await expect(runQuery('SELECT 1;')).rejects.toThrow(
      /Missing SUPABASE_PROJECT_REF/
    );

    // Unapproved project ref
    process.env.SUPABASE_PROJECT_REF = 'unapproved_tenant_ref';
    await expect(runQuery('SELECT 1;')).rejects.toThrow(
      /Project reference "unapproved_tenant_ref" is not on the approved project allowlist/
    );
  });

  // --- 5. Guard All Database Mutations ---
  it('18. isDestructiveQuery and isMutationQuery detect INSERT, UPDATE, DELETE, TRUNCATE, DROP, and ALTER statements', () => {
    const mutations = [
      'INSERT INTO students (id, name) VALUES (1, "A");',
      'UPDATE users SET status = "active" WHERE id = 1;',
      'DELETE FROM audit_events WHERE org_id = 1;',
      'TRUNCATE TABLE organizations CASCADE;',
      'DROP TABLE student_skills;',
      'ALTER TABLE audit_events DISABLE TRIGGER trg_audit_events_immutable;',
      'CREATE TABLE temp_test (id int);',
      'GRANT SELECT ON students TO app_api;',
      'REVOKE ALL ON users FROM public;'
    ];

    for (const sql of mutations) {
      expect(isMutationQuery(sql)).toBe(true);
      expect(isDestructiveQuery(sql)).toBe(true);
    }
  });

  it('19. Detects mutations hidden inside multi-statement SQL, comments, or leading whitespace', () => {
    expect(cleanSqlForInspection('/* comment */ SELECT 1;')).toBe('SELECT 1;');
    expect(cleanSqlForInspection('-- line comment\nSELECT 1;')).toBe('SELECT 1;');

    const bypassAttempts = [
      '/* harmless comment */ INSERT INTO students VALUES (1);',
      '-- line comment\nDELETE FROM audit_events WHERE org_id = 1;',
      '   \n\t  UPDATE users SET role = "admin";',
      'SELECT 1; DROP TABLE users;',
      'SELECT 1; /* comment */ TRUNCATE organizations;',
      'SELECT 1;\n-- inline comment\nALTER TABLE audit_events DISABLE TRIGGER trg;'
    ];

    for (const sql of bypassAttempts) {
      expect(isMutationQuery(sql)).toBe(true);
      expect(isDestructiveQuery(sql)).toBe(true);
    }
  });

  it('20. Preserves normal read-only SELECT behavior without false positives on string literals or column names', () => {
    const readOnlyQueries = [
      'SELECT 1;',
      'SELECT * FROM students WHERE id = "00000000-0000-0000-0000-000000000001";',
      'SELECT id, deleted_at, update_count FROM students;',
      'SELECT "DELETE FROM users" AS description FROM organizations;',
      '/* query comment */ SELECT count(*) FROM users;',
      '-- query comment\nSELECT id FROM departments;'
    ];

    for (const sql of readOnlyQueries) {
      expect(isMutationQuery(sql)).toBe(false);
      expect(isDestructiveQuery(sql)).toBe(false);
    }
  });

  // --- 6. Institutional Tenant Protection ---
  it('21. Protects institutional tenant records from destructive operations', () => {
    for (const orgId of INSTITUTIONAL_ORG_IDS) {
      expect(() => assertNotInstitutionalTenant(orgId, 'DELETE')).toThrow(
        /Institutional tenant protection/
      );
    }
  });

  it('22. Allows fixture operations on non-institutional test UUIDs', () => {
    const testFixtureId = 'e0000000-0000-0000-0000-000000000099';
    expect(() => assertNotInstitutionalTenant(testFixtureId, 'DELETE')).not.toThrow();
  });

  // --- 7. safeCleanupTestAuditEvents Exact Identifier Requirements ---
  it('23. safeCleanupTestAuditEvents requires all 5 exact identifiers and fails if any are omitted', async () => {
    const validParams = {
      orgId: 'e0000000-0000-0000-0000-000000000099',
      seq: 99991,
      action: 'AUDIT_VERIFICATION_TEST',
      objectType: 'student_skill',
      id: 'e9999999-0000-0000-0000-000000000001'
    };

    // Missing orgId
    await expect(safeCleanupTestAuditEvents({ ...validParams, orgId: '' })).rejects.toThrow(
      /requires an explicit non-institutional orgId/
    );

    // Institutional orgId
    await expect(safeCleanupTestAuditEvents({ ...validParams, orgId: INSTITUTIONAL_ORG_IDS[0] })).rejects.toThrow(
      /Institutional tenant protection/
    );

    // Missing seq (e.g. called with only orgId)
    const { seq: _, ...missingSeq } = validParams;
    await expect(safeCleanupTestAuditEvents(missingSeq as any)).rejects.toThrow(
      /requires an explicit non-negative integer seq/
    );

    // Negative seq
    await expect(safeCleanupTestAuditEvents({ ...validParams, seq: -1 })).rejects.toThrow(
      /requires an explicit non-negative integer seq/
    );

    // Missing action
    const { action: __, ...missingAction } = validParams;
    await expect(safeCleanupTestAuditEvents(missingAction as any)).rejects.toThrow(
      /requires an explicit action string/
    );

    // Missing objectType
    const { objectType: ___, ...missingObjectType } = validParams;
    await expect(safeCleanupTestAuditEvents(missingObjectType as any)).rejects.toThrow(
      /requires an explicit objectType string/
    );

    // Missing id
    const { id: ____, ...missingId } = validParams;
    await expect(safeCleanupTestAuditEvents(missingId as any)).rejects.toThrow(
      /requires an explicit id string/
    );
  });
});
