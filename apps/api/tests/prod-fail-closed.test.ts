import { describe, it, expect, afterEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { InMemoryTenantRepository } from '../src/repositories/tenant-repository.js';
import { TenantStore } from '../src/services/tenant-store.js';
import { resolveSslConfig } from '../src/db/pool.js';
import fs from 'fs';

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

  // --- Production TLS Invariants (Item 3) ---

  it('4. Production enforces rejectUnauthorized: true for remote database connections', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DATABASE_CA_CERT;
    delete process.env.DATABASE_CA_PATH;

    const remoteUrl = 'postgresql://pramaan_app_user:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres';
    const sslConfig = resolveSslConfig(remoteUrl);

    expect(typeof sslConfig).toBe('object');
    expect((sslConfig as any).rejectUnauthorized).toBe(true);
    expect((sslConfig as any).servername).toBe('aws-0-ap-southeast-1.pooler.supabase.com');
  });

  it('5. Production strictly prohibits TLS downgrade even if DATABASE_SSL_ALLOW_INSECURE=true is set', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_SSL_ALLOW_INSECURE = 'true'; // Attempted exploit / bypass
    delete process.env.DATABASE_CA_CERT;
    delete process.env.DATABASE_CA_PATH;

    const remoteUrl = 'postgresql://pramaan_app_user:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres';
    const sslConfig = resolveSslConfig(remoteUrl);

    expect(typeof sslConfig).toBe('object');
    // Must remain true; downgrade is strictly impossible in production
    expect((sslConfig as any).rejectUnauthorized).toBe(true);
  });

  it('6. Production verifies CA certificate and loads bundle when present', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DATABASE_SSL_ALLOW_INSECURE;

    const remoteUrl = 'postgresql://pramaan_app_user:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres';
    const sslConfig = resolveSslConfig(remoteUrl);

    expect(typeof sslConfig).toBe('object');
    expect((sslConfig as any).rejectUnauthorized).toBe(true);
    if (fs.existsSync('certs/supabase-ca.crt')) {
      expect((sslConfig as any).ca).toBeDefined();
      expect((sslConfig as any).ca).toContain('BEGIN CERTIFICATE');
    }
  });
});
