import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  assertSafeTestEnvironment,
  assertNotInstitutionalTenant,
  INSTITUTIONAL_ORG_IDS
} from '../../scripts/supabase-runner.mjs';

describe('Database Test Safety Guard & Production Environment Protection', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalEnvironment = process.env.ENVIRONMENT;
  const originalVercelEnv = process.env.VERCEL_ENV;

  beforeEach(() => {
    (process.env as any).NODE_ENV = 'test';
    delete process.env.ENVIRONMENT;
    delete process.env.VERCEL_ENV;
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
  });

  it('1. Allows execution when NODE_ENV is test or development', () => {
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

  it('5. Protects institutional tenant records from destructive operations', () => {
    for (const orgId of INSTITUTIONAL_ORG_IDS) {
      expect(() => assertNotInstitutionalTenant(orgId, 'DELETE')).toThrow(
        /Institutional tenant protection/
      );
    }
  });

  it('6. Allows fixture operations on non-institutional test UUIDs', () => {
    const testFixtureId = 'e0000000-0000-0000-0000-000000000099';
    expect(() => assertNotInstitutionalTenant(testFixtureId, 'DELETE')).not.toThrow();
  });
});

