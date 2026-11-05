import { describe, it, expect, afterEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { InMemoryTenantRepository } from '../src/repositories/tenant-repository.js';
import { TenantStore } from '../src/services/tenant-store.js';

describe('Production Mode Fail-Closed Invariants (P1-7)', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('1. Fails startup in production when DATABASE_URL is missing', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DATABASE_URL;
    process.env.SUPABASE_URL = 'https://qshujrddrzoemlzmleru.supabase.co';

    expect(() => {
      buildApp();
    }).toThrow(/FATAL: Production mode requires a valid DATABASE_URL/);
  });

  it('2. Fails startup in production when attempting to inject in-memory repositories', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://fake:password@localhost:5432/db';
    process.env.SUPABASE_URL = 'https://qshujrddrzoemlzmleru.supabase.co';

    expect(() => {
      buildApp({
        tenantRepository: new InMemoryTenantRepository(new TenantStore())
      });
    }).toThrow(/FATAL: Production mode prohibits in-memory repositories/);
  });

  it('3. Fails startup in production when Supabase JWT configuration is completely missing', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://fake:password@localhost:5432/db';
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_JWKS_URI;
    delete process.env.SUPABASE_JWT_SECRET;

    expect(() => {
      buildApp();
    }).toThrow(/FATAL: Production mode requires Supabase JWT configuration/);
  });
});
