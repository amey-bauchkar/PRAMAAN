import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import pg from 'pg';
import { resolveAdminSslConfig } from '../../scripts/admin-db-ssl.mjs';
import {
  assertSafeTestEnvironment,
  assertApprovedDatabaseTarget,
  assertNotInstitutionalTenant,
  INSTITUTIONAL_ORG_IDS,
  APPROVED_LOCAL_HOSTS,
  DEFAULT_APPROVED_SUPABASE_PROJECT_REFS,
  isProductionDatabaseTarget,
  isApprovedTestDatabase,
  isApprovedSupabaseProjectRef,
  isDestructiveQuery,
  isMutationQuery,
  hasSideEffectingFunction,
  hasTransactionControl,
  isSafeReadOnlyQuery,
  cleanSqlForInspection,
  safeCleanupTestAuditEvents,
  runQuery,
  runTestTransaction
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

    await expect(runQuery('MERGE INTO students s USING n ON s.id = n.id WHEN MATCHED THEN UPDATE SET name = n.name;')).rejects.toThrow(
      /Destructive or mutating database operations require direct DATABASE_URL_ADMIN PostgreSQL connectivity/
    );

    await expect(runQuery('SELECT * INTO student_backup FROM students;')).rejects.toThrow(
      /Destructive or mutating database operations require direct DATABASE_URL_ADMIN PostgreSQL connectivity/
    );

    await expect(runQuery("SELECT nextval('student_id_seq');")).rejects.toThrow(
      /Destructive or mutating database operations require direct DATABASE_URL_ADMIN PostgreSQL connectivity/
    );

    await expect(runQuery("SELECT setval('student_id_seq', 5000);")).rejects.toThrow(
      /Destructive or mutating database operations require direct DATABASE_URL_ADMIN PostgreSQL connectivity/
    );

    await expect(runQuery('BEGIN; SELECT 1; COMMIT;')).rejects.toThrow(
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

  // --- 6. PostgreSQL MERGE and SELECT INTO Detection ---
  it('21. isDestructiveQuery and isMutationQuery detect PostgreSQL MERGE and SELECT INTO statements', () => {
    const mergeAndSelectInto = [
      'MERGE INTO students s USING new_data n ON s.id = n.id WHEN MATCHED THEN UPDATE SET name = n.name;',
      'MERGE INTO target_table USING source_table ON 1=1;',
      'SELECT * INTO student_backup FROM students;',
      'SELECT id, name INTO TEMP temp_table FROM students;',
      'SELECT a, b INTO TEMPORARY TABLE my_temp FROM t;',
      'SELECT 1 INTO new_table;'
    ];

    for (const sql of mergeAndSelectInto) {
      expect(isMutationQuery(sql)).toBe(true);
      expect(isDestructiveQuery(sql)).toBe(true);
    }
  });

  it('22. Comments and whitespace cannot hide MERGE or SELECT INTO statements', () => {
    const hiddenQueries = [
      '/* comment */ MERGE INTO students USING source ON 1=1;',
      '-- line comment\nSELECT * INTO student_backup FROM students;',
      'SELECT 1; MERGE INTO students USING source ON 1=1;',
      'SELECT 1; SELECT * INTO backup FROM users;',
      'SELECT 1;\n-- inline comment\nSELECT * INTO backup FROM users;'
    ];

    for (const sql of hiddenQueries) {
      expect(isMutationQuery(sql)).toBe(true);
      expect(isDestructiveQuery(sql)).toBe(true);
    }
  });

  it('23. Preserves normal read-only SELECT queries when string literals or comments contain MERGE or INTO', () => {
    const safeSelects = [
      "SELECT 'MERGE' AS action, 'INTO' AS preposition FROM students;",
      "SELECT 'SELECT * INTO backup FROM students' AS template;",
      '/* comment mentioning MERGE and SELECT INTO */ SELECT 1;',
      '-- comment about MERGE INTO\nSELECT 1;',
      'SELECT "MERGE", "INTO" FROM test_table;',
      "SELECT * FROM students WHERE notes LIKE '%into%';"
    ];

    for (const sql of safeSelects) {
      expect(isMutationQuery(sql)).toBe(false);
      expect(isDestructiveQuery(sql)).toBe(false);
    }
  });

  // --- 7. Institutional Tenant Protection ---
  it('24. Protects institutional tenant records from destructive operations', () => {
    for (const orgId of INSTITUTIONAL_ORG_IDS) {
      expect(() => assertNotInstitutionalTenant(orgId, 'DELETE')).toThrow(
        /Institutional tenant protection/
      );
    }
  });

  it('25. Allows fixture operations on non-institutional test UUIDs', () => {
    const testFixtureId = 'e0000000-0000-0000-0000-000000000099';
    expect(() => assertNotInstitutionalTenant(testFixtureId, 'DELETE')).not.toThrow();
  });

  // --- 8. safeCleanupTestAuditEvents Exact Identifier Requirements ---
  it('26. safeCleanupTestAuditEvents requires all 5 exact identifiers and fails if any are omitted', async () => {
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

  // --- 9. PostgreSQL Side-Effecting Functions & Read-Only Execution Safety ---
  it('27. isMutationQuery, isDestructiveQuery, and hasSideEffectingFunction detect nextval and setval as mutations', () => {
    const sequenceMutations = [
      "SELECT nextval('student_id_seq');",
      "SELECT nextval('my_seq'::regclass);",
      "SELECT * FROM nextval('student_id_seq');",
      "SELECT pg_catalog.nextval('seq');",
      "SELECT setval('student_id_seq', 5000);",
      "SELECT public.setval('student_id_seq', 1, false);",
      "SELECT 1 WHERE 1 = nextval('seq');"
    ];

    for (const sql of sequenceMutations) {
      expect(hasSideEffectingFunction(sql)).toBe(true);
      expect(isMutationQuery(sql)).toBe(true);
      expect(isDestructiveQuery(sql)).toBe(true);
      expect(isSafeReadOnlyQuery(sql)).toBe(false);
    }
  });

  it('28. Detects other PostgreSQL side-effecting administrative, large object, and session functions', () => {
    const sideEffectQueries = [
      'SELECT pg_terminate_backend(1234);',
      'SELECT pg_cancel_backend(1234);',
      'SELECT pg_reload_conf();',
      'SELECT pg_rotate_logfile();',
      "SELECT pg_create_restore_point('rp1');",
      'SELECT pg_switch_wal();',
      'SELECT pg_promote();',
      "SELECT pg_create_logical_replication_slot('slot1', 'test_decoding');",
      "SELECT pg_drop_replication_slot('slot1');",
      "SELECT pg_notify('chan', 'payload');",
      "SELECT pg_write_file('test.txt', 'data');",
      "SELECT pg_file_unlink('test.txt');",
      'SELECT lo_create(0);',
      'SELECT lo_unlink(123);',
      "SELECT dblink_exec('conn', 'DELETE FROM users');",
      'SELECT pg_advisory_lock(12345);',
      'SELECT pg_advisory_unlock(12345);',
      'SELECT pg_advisory_xact_lock(12345);'
    ];

    for (const sql of sideEffectQueries) {
      expect(hasSideEffectingFunction(sql)).toBe(true);
      expect(isMutationQuery(sql)).toBe(true);
      expect(isDestructiveQuery(sql)).toBe(true);
      expect(isSafeReadOnlyQuery(sql)).toBe(false);
    }
  });

  it('29. Comments and whitespace cannot hide nextval or setval mutations', () => {
    const hiddenQueries = [
      "/* comment */ SELECT nextval('seq');",
      "-- line comment\nSELECT setval('seq', 10);",
      "SELECT 1; SELECT nextval('seq');",
      "SELECT 1;\n-- inline comment\nSELECT setval('seq', 100);",
      "/* multiline\ncomment */\nSELECT nextval('seq');"
    ];

    for (const sql of hiddenQueries) {
      expect(hasSideEffectingFunction(sql)).toBe(true);
      expect(isMutationQuery(sql)).toBe(true);
      expect(isDestructiveQuery(sql)).toBe(true);
      expect(isSafeReadOnlyQuery(sql)).toBe(false);
    }
  });

  it('30. Preserves normal read-only SELECT queries when string literals, comments, or column names contain nextval or setval', () => {
    const safeSelects = [
      "SELECT 'nextval' AS fn, 'setval' AS fn2 FROM students;",
      "SELECT 'SELECT nextval(seq)' AS sql_template;",
      "SELECT * FROM students WHERE notes LIKE '%nextval%';",
      'SELECT "nextval", "setval" FROM sequence_metadata;',
      '/* comment mentioning nextval and setval */ SELECT 1;',
      '-- line comment about nextval\nSELECT id, name FROM students;'
    ];

    for (const sql of safeSelects) {
      expect(hasSideEffectingFunction(sql)).toBe(false);
      expect(isMutationQuery(sql)).toBe(false);
      expect(isDestructiveQuery(sql)).toBe(false);
      expect(isSafeReadOnlyQuery(sql)).toBe(true);
    }
  });

  it('31. Management API fallback cannot execute side-effecting SELECT statements or non-guaranteed queries', async () => {
    delete process.env.DATABASE_URL_ADMIN;
    delete process.env.DATABASE_URL;
    process.env.SUPABASE_MANAGEMENT_TOKEN = 'test-token';
    process.env.SUPABASE_PROJECT_REF = 'qshujrddrzoemlzmleru';

    await expect(runQuery("SELECT nextval('student_id_seq');")).rejects.toThrow(
      /Destructive or mutating database operations require direct DATABASE_URL_ADMIN PostgreSQL connectivity/
    );

    await expect(runQuery("SELECT setval('student_id_seq', 5000);")).rejects.toThrow(
      /Destructive or mutating database operations require direct DATABASE_URL_ADMIN PostgreSQL connectivity/
    );

    await expect(runQuery("SELECT pg_terminate_backend(1234);")).rejects.toThrow(
      /Destructive or mutating database operations require direct DATABASE_URL_ADMIN PostgreSQL connectivity/
    );

    await expect(runQuery("SELECT lo_unlink(100);")).rejects.toThrow(
      /Destructive or mutating database operations require direct DATABASE_URL_ADMIN PostgreSQL connectivity/
    );

    await expect(runQuery("LISTEN my_channel;")).rejects.toThrow(
      /Read-only execution cannot be safely guaranteed for this query/
    );
  });

  it('32. Direct admin execution validates its database target even for ordinary read-only queries', async () => {
    // Direct assertApprovedDatabaseTarget invocation
    expect(() => assertApprovedDatabaseTarget('postgresql://attacker:pass@attacker.example:5432/pramaan_test')).toThrow(
      /Database target is not on the approved test database allowlist/
    );

    // Unapproved host
    process.env.DATABASE_URL_ADMIN = 'postgresql://attacker:pass@attacker.example:5432/pramaan_test';
    await expect(runQuery('SELECT 1;')).rejects.toThrow(
      /Database target is not on the approved test database allowlist/
    );

    // Production database name
    process.env.DATABASE_URL_ADMIN = 'postgresql://postgres:pass@localhost:5432/production';
    await expect(runQuery('SELECT 1;')).rejects.toThrow(
      /Database target is recognized as a production database/
    );

    // Production environment
    process.env.DATABASE_URL_ADMIN = 'postgresql://postgres:pass@localhost:5432/pramaan_test';
    (process.env as any).NODE_ENV = 'production';
    await expect(runQuery('SELECT 1;')).rejects.toThrow(
      /cannot be executed in a production environment/
    );
  });

  it('33. Normal read-only SELECT queries execute successfully via direct admin connection', async () => {
    process.env.DATABASE_URL_ADMIN = originalAdminUrl;
    if (process.env.DATABASE_URL_ADMIN && isApprovedTestDatabase(process.env.DATABASE_URL_ADMIN)) {
      const res = await runQuery('SELECT 1 AS num;');
      expect(res).toBeDefined();
      expect(Array.isArray(res)).toBe(true);
      expect(res[0]?.num).toBe(1);
    }
  });

  it('34. PostgreSQL engine strictly rejects nextval and setval inside a READ ONLY transaction', async () => {
    process.env.DATABASE_URL_ADMIN = originalAdminUrl;
    if (process.env.DATABASE_URL_ADMIN && isApprovedTestDatabase(process.env.DATABASE_URL_ADMIN)) {
      const ssl = resolveAdminSslConfig(process.env.DATABASE_URL_ADMIN);
      const client = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN, ssl });
      await client.connect();

      const testSeqName = 'pramaan_test_seq_readonly_guard';
      try {
        await client.query(`DROP SEQUENCE IF EXISTS ${testSeqName};`);
        await client.query(`CREATE SEQUENCE ${testSeqName};`);

        // Attempting nextval inside a READ ONLY transaction fails at the PostgreSQL storage engine level
        await client.query('BEGIN READ ONLY;');
        await expect(client.query(`SELECT nextval('${testSeqName}');`)).rejects.toThrow(
          /cannot execute nextval\(\) in a read-only transaction/
        );
        await client.query('ROLLBACK;').catch(() => {});

        // Attempting setval inside a READ ONLY transaction fails at the PostgreSQL storage engine level
        await client.query('BEGIN READ ONLY;');
        await expect(client.query(`SELECT setval('${testSeqName}', 5000);`)).rejects.toThrow(
          /cannot execute setval\(\) in a read-only transaction/
        );
        await client.query('ROLLBACK;').catch(() => {});
      } finally {
        await client.query(`DROP SEQUENCE IF EXISTS ${testSeqName};`).catch(() => {});
        await client.end();
      }
    }
  });

  // --- 9. Transaction Boundary Security & Privileged Transaction Isolation ---
  it('35. Explicit BEGIN and START TRANSACTION cannot bypass the read-only safety boundary', async () => {
    const txControlStatements = [
      'BEGIN; SELECT 1; COMMIT;',
      'START TRANSACTION; SELECT 1; COMMIT;',
      'BEGIN TRANSACTION READ WRITE; SELECT 1;',
      'BEGIN;'
    ];

    for (const sql of txControlStatements) {
      expect(hasTransactionControl(sql)).toBe(true);
      expect(isDestructiveQuery(sql)).toBe(true);
      expect(isSafeReadOnlyQuery(sql)).toBe(false);
    }

    // Must be rejected when ALLOW_DESTRUCTIVE_DB_TESTS is not set
    delete process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
    await expect(runQuery('BEGIN; SELECT 1; COMMIT;')).rejects.toThrow(
      /requires explicit opt-in via ALLOW_DESTRUCTIVE_DB_TESTS=true/
    );

    // Must be rejected when target is unapproved
    process.env.ALLOW_DESTRUCTIVE_DB_TESTS = 'true';
    process.env.DATABASE_URL_ADMIN = 'postgresql://attacker:pass@attacker.example:5432/pramaan_test';
    await expect(runQuery('BEGIN; SELECT 1; COMMIT;')).rejects.toThrow(
      /Database target is not on the approved test database allowlist/
    );

    // Must be rejected when running in production environment
    process.env.DATABASE_URL_ADMIN = 'postgresql://postgres:pass@localhost:5432/pramaan_test';
    (process.env as any).NODE_ENV = 'production';
    await expect(runQuery('BEGIN; SELECT 1; COMMIT;')).rejects.toThrow(
      /cannot be executed in a production environment/
    );
  });

  it('36. COMMIT, ROLLBACK, and SAVEPOINT statements cannot escape an automatic READ ONLY transaction', async () => {
    const escapeStatements = [
      'COMMIT;',
      'ROLLBACK;',
      'SAVEPOINT my_savepoint;',
      'RELEASE SAVEPOINT my_savepoint;',
      'SELECT 1; COMMIT; INSERT INTO users VALUES (1);',
      'SELECT 1; ROLLBACK; DELETE FROM users;'
    ];

    for (const sql of escapeStatements) {
      expect(hasTransactionControl(sql)).toBe(true);
      expect(isDestructiveQuery(sql)).toBe(true);
      expect(isSafeReadOnlyQuery(sql)).toBe(false);
    }

    // Destructive opt-in is required because transaction control is detected
    delete process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
    await expect(runQuery('COMMIT;')).rejects.toThrow(
      /requires explicit opt-in via ALLOW_DESTRUCTIVE_DB_TESTS=true/
    );
    await expect(runQuery('ROLLBACK;')).rejects.toThrow(
      /requires explicit opt-in via ALLOW_DESTRUCTIVE_DB_TESTS=true/
    );
  });

  it('37. Unrecognized user-defined mutating function is strictly blocked at the PostgreSQL engine level in the read-only path', async () => {
    process.env.DATABASE_URL_ADMIN = originalAdminUrl;
    if (process.env.DATABASE_URL_ADMIN && isApprovedTestDatabase(process.env.DATABASE_URL_ADMIN)) {
      const ssl = resolveAdminSslConfig(process.env.DATABASE_URL_ADMIN);
      const adminClient = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN, ssl });
      await adminClient.connect();

      const funcName = 'pramaan_test_unrecognized_mutator';
      const testOrgName = 'Mutator Test Organization ' + Date.now();

      try {
        await adminClient.query(`
          CREATE OR REPLACE FUNCTION ${funcName}() RETURNS void AS $$
          BEGIN
            INSERT INTO organizations (name, kind) VALUES ('${testOrgName}', 'college');
          END;
          $$ LANGUAGE plpgsql;
        `);

        // Query does not contain nextval, setval, or direct DDL/DML keywords
        const unrecognizedQuery = `SELECT ${funcName}();`;

        // It is not flagged as a mutation by regex keywords alone
        expect(isMutationQuery(unrecognizedQuery)).toBe(false);

        // runQuery automatically wraps in "BEGIN READ ONLY;"
        // PostgreSQL engine strictly rejects any INSERT inside a READ ONLY transaction
        await expect(runQuery(unrecognizedQuery)).rejects.toThrow(
          /cannot execute INSERT in a read-only transaction/
        );

        // Verify zero rows were inserted
        const checkRes = await adminClient.query(
          `SELECT count(*)::int AS cnt FROM organizations WHERE name = '${testOrgName}';`
        );
        expect(checkRes.rows[0].cnt).toBe(0);
      } finally {
        await adminClient.query(`DROP FUNCTION IF EXISTS ${funcName}();`).catch(() => {});
        await adminClient.query(`DELETE FROM organizations WHERE name = '${testOrgName}';`).catch(() => {});
        await adminClient.end();
      }
    }
  });

  it('38. Authorized RLS test transactions execute successfully via runQuery and runTestTransaction', async () => {
    process.env.DATABASE_URL_ADMIN = originalAdminUrl;
    if (process.env.DATABASE_URL_ADMIN && isApprovedTestDatabase(process.env.DATABASE_URL_ADMIN)) {
      // 1. Authorized multi-statement transaction via runQuery
      const rlsTestQuery = `
        BEGIN;
        SET LOCAL ROLE anon;
        SELECT count(*)::int AS org_count FROM organizations;
        COMMIT;
      `;
      const rows = await runQuery(rlsTestQuery);
      expect(rows).toBeDefined();
      expect(Array.isArray(rows)).toBe(true);
      expect(typeof rows[0]?.org_count).toBe('number');

      // 2. Dedicated runTestTransaction helper
      const txRows = await runTestTransaction(`
        BEGIN;
        SET LOCAL ROLE anon;
        SELECT 42 AS answer;
        COMMIT;
      `);
      expect(txRows).toBeDefined();
      expect(Array.isArray(txRows)).toBe(true);
      expect(txRows[0]?.answer).toBe(42);
    }
  });

  it('39. Management API fallback strictly rejects user-defined function calls and transaction control', async () => {
    delete process.env.DATABASE_URL_ADMIN;
    delete process.env.DATABASE_URL;
    process.env.SUPABASE_MANAGEMENT_TOKEN = 'test-token';
    process.env.SUPABASE_PROJECT_REF = 'qshujrddrzoemlzmleru';

    // Transaction control is rejected
    await expect(runQuery('BEGIN; SELECT 1; COMMIT;')).rejects.toThrow(
      /Destructive or mutating database operations require direct DATABASE_URL_ADMIN PostgreSQL connectivity/
    );

    // Schema-qualified user-defined function is rejected by isSafeReadOnlyQuery
    await expect(runQuery('SELECT public.my_custom_mutator();')).rejects.toThrow(
      /Read-only execution cannot be safely guaranteed for this query/
    );

    await expect(runQuery('SELECT custom_schema.calculate_risk(1);')).rejects.toThrow(
      /Read-only execution cannot be safely guaranteed for this query/
    );
  });
});
