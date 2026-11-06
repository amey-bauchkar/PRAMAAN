import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  assertSafeTestEnvironment,
  assertNotInstitutionalTenant,
  INSTITUTIONAL_ORG_IDS,
  isProductionDatabaseTarget,
  isApprovedTestDatabase,
  isDestructiveQuery
} from '../../scripts/supabase-runner.mjs';

describe('Database Test Safety Guard & Production Target Protection (P1-3)', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalEnvironment = process.env.ENVIRONMENT;
  const originalVercelEnv = process.env.VERCEL_ENV;
  const originalOptIn = process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
  const originalAdminUrl = process.env.DATABASE_URL_ADMIN;

  beforeEach(() => {
    (process.env as any).NODE_ENV = 'test';
    delete process.env.ENVIRONMENT;
    delete process.env.VERCEL_ENV;
    process.env.ALLOW_DESTRUCTIVE_DB_TESTS = 'true';
    process.env.DATABASE_URL_ADMIN = 'postgresql://postgres:ci_password@localhost:5432/pramaan_test';
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
  });

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

  it('7. Approved isolated test database acceptance: permits verified ephemeral and sandbox test databases', () => {
    const approvedTestUrls = [
      'postgresql://postgres:ci_password@localhost:5432/pramaan_test',
      'postgresql://postgres:ci_password@127.0.0.1:5432/pramaan_test',
      'postgresql://postgres.qshujrddrzoemlzmleru:pass@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres'
    ];

    for (const url of approvedTestUrls) {
      expect(isApprovedTestDatabase(url)).toBe(true);
      expect(() => assertSafeTestEnvironment('Approved test execution', url)).not.toThrow();
    }
  });

  it('8. Arbitrary unapproved external host is rejected even with opt-in and test mode', () => {
    const unknownHostUrl = 'postgresql://postgres:pass@external-unauthorized-cluster.cloud.com:5432/db';
    expect(isApprovedTestDatabase(unknownHostUrl)).toBe(false);
    expect(() => assertSafeTestEnvironment('Destructive integration test', unknownHostUrl)).toThrow(
      /not on the approved test database allowlist/
    );
  });

  it('9. Protects institutional tenant records from destructive operations', () => {
    for (const orgId of INSTITUTIONAL_ORG_IDS) {
      expect(() => assertNotInstitutionalTenant(orgId, 'DELETE')).toThrow(
        /Institutional tenant protection/
      );
    }
  });

  it('10. Allows fixture operations on non-institutional test UUIDs', () => {
    const testFixtureId = 'e0000000-0000-0000-0000-000000000099';
    expect(() => assertNotInstitutionalTenant(testFixtureId, 'DELETE')).not.toThrow();
  });

  it('11. isDestructiveQuery correctly identifies destructive SQL commands', () => {
    expect(isDestructiveQuery('DELETE FROM audit_events WHERE org_id = 1;')).toBe(true);
    expect(isDestructiveQuery('TRUNCATE TABLE organizations CASCADE;')).toBe(true);
    expect(isDestructiveQuery('DROP TABLE users;')).toBe(true);
    expect(isDestructiveQuery('ALTER TABLE audit_events DISABLE TRIGGER trg;')).toBe(true);
    expect(isDestructiveQuery('SELECT * FROM students WHERE id = 1;')).toBe(false);
    expect(isDestructiveQuery('INSERT INTO students (id) VALUES (1);')).toBe(false);
  });
});
