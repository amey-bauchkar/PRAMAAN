import { describe, it, expect, afterEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { InMemoryTenantRepository } from '../src/repositories/tenant-repository.js';
import { TenantStore } from '../src/services/tenant-store.js';
import { resolveSslConfig } from '../src/db/pool.js';
import fs from 'fs';

describe('Production Mode Fail-Closed Invariants (P1-7)', () => {
  const originalEnv = { ...process.env };

  const setEnv = (key: string, value?: string) => {
    if (value === undefined) {
      delete (process.env as any)[key];
    } else {
      (process.env as any)[key] = value;
    }
  };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('1. Fails startup in production when DATABASE_URL is missing', () => {
    setEnv('NODE_ENV', 'production');
    delete process.env.DATABASE_URL;
    process.env.SUPABASE_URL = 'https://qshujrddrzoemlzmleru.supabase.co';

    expect(() => {
      buildApp();
    }).toThrow(/FATAL: Production mode requires a valid DATABASE_URL/);
  });

  it('2. Fails startup in production when attempting to inject in-memory repositories', () => {
    setEnv('NODE_ENV', 'production');
    process.env.DATABASE_URL = 'postgresql://fake:password@localhost:5432/db';
    process.env.SUPABASE_URL = 'https://qshujrddrzoemlzmleru.supabase.co';

    expect(() => {
      buildApp({
        tenantRepository: new InMemoryTenantRepository(new TenantStore())
      });
    }).toThrow(/FATAL: Production mode prohibits in-memory repositories/);

    expect(() => {
      buildApp({
        persistenceMode: 'in-memory'
      });
    }).toThrow(/FATAL: Production mode prohibits in-memory persistenceMode/);
  });

  it('2b. Fails startup in production when attempting to inject any in-memory repository variant', async () => {
    setEnv('NODE_ENV', 'production');
    process.env.DATABASE_URL = 'postgresql://fake:password@localhost:5432/db';
    process.env.SUPABASE_URL = 'https://qshujrddrzoemlzmleru.supabase.co';

    const { InMemoryAuditRepository } = await import('../src/repositories/audit-repository.js');
    const { InMemoryConsentRepository } = await import('../src/repositories/consent-repository.js');
    const { InMemoryUserRepository } = await import('../src/repositories/user-repository.js');
    const { AuditService } = await import('../src/services/audit-service.js');
    const { ConsentService } = await import('../src/services/consent-service.js');

    const auditSvc = new AuditService();
    expect(() => {
      buildApp({ auditRepository: new InMemoryAuditRepository(auditSvc) });
    }).toThrow(/FATAL: Production mode prohibits in-memory repositories/);

    expect(() => {
      buildApp({ consentRepository: new InMemoryConsentRepository(new ConsentService(auditSvc)) });
    }).toThrow(/FATAL: Production mode prohibits in-memory repositories/);

    expect(() => {
      buildApp({ userRepository: new InMemoryUserRepository() });
    }).toThrow(/FATAL: Production mode prohibits in-memory repositories/);
  });

  it('2c. Fails startup when persistenceMode is postgres but DATABASE_URL is missing', () => {
    delete process.env.DATABASE_URL;
    expect(() => {
      buildApp({ persistenceMode: 'postgres' });
    }).toThrow(/FATAL: persistenceMode is set to 'postgres' but DATABASE_URL is not configured/);
  });

  it('2d. Development/Test mode honors explicit persistenceMode and reports it via /health', async () => {
    setEnv('NODE_ENV');
    process.env.SUPABASE_URL = 'https://qshujrddrzoemlzmleru.supabase.co';
    const memApp = buildApp({ persistenceMode: 'in-memory' });
    expect(memApp.persistenceMode).toBe('in-memory');
    const memRes = await memApp.inject({ method: 'GET', url: '/health' });
    expect(memRes.json().persistenceMode).toBe('in-memory');

    if (process.env.DATABASE_URL) {
      const pgApp = buildApp({ persistenceMode: 'postgres' });
      expect(pgApp.persistenceMode).toBe('postgres');
      const pgRes = await pgApp.inject({ method: 'GET', url: '/health' });
      expect(pgRes.json().persistenceMode).toBe('postgres');
    }
  });

  it('3. Fails startup in production when Supabase JWT configuration is completely missing', () => {
    setEnv('NODE_ENV', 'production');
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
    setEnv('NODE_ENV', 'production');
    delete process.env.DATABASE_CA_CERT;
    delete process.env.DATABASE_CA_PATH;

    const remoteUrl = 'postgresql://pramaan_app_user:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres';
    const sslConfig = resolveSslConfig(remoteUrl);

    expect(typeof sslConfig).toBe('object');
    expect((sslConfig as any).rejectUnauthorized).toBe(true);
    expect((sslConfig as any).servername).toBe('aws-0-ap-southeast-1.pooler.supabase.com');
  });

  it('5. Production strictly prohibits TLS downgrade even if DATABASE_SSL_ALLOW_INSECURE=true is set', () => {
    setEnv('NODE_ENV', 'production');
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
    setEnv('NODE_ENV', 'production');
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

  it('7. Fails fast when DATABASE_CA_PATH is explicitly set but file does not exist', () => {
    setEnv('NODE_ENV', 'production');
    process.env.DATABASE_CA_PATH = '/nonexistent/path/to/missing_ca.crt';
    delete process.env.DATABASE_CA_CERT;

    const remoteUrl = 'postgresql://pramaan_app_user:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres';
    expect(() => {
      resolveSslConfig(remoteUrl);
    }).toThrow(/DATABASE_CA_PATH is configured \('.*missing_ca\.crt'\) but file does not exist/);
  });

  it('8. Verifies production TLS configuration on live remote database connection', async () => {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl || dbUrl.includes('localhost')) return;

    setEnv('NODE_ENV', 'production');
    const sslConfig = resolveSslConfig(dbUrl);
    expect(typeof sslConfig).toBe('object');
    expect((sslConfig as any).rejectUnauthorized).toBe(true);
    expect((sslConfig as any).servername).toBeDefined();

    // Verify a live connection under strict production SSL succeeds
    const pg = await import('pg');
    const pool = new pg.default.Pool({
      connectionString: dbUrl,
      ssl: sslConfig as any,
      max: 1
    });

    try {
      const client = await pool.connect();
      const res = await client.query('SELECT current_user, inet_server_port();');
      expect(res.rows[0].current_user).toBe('pramaan_app_user');
      client.release();
    } finally {
      await pool.end();
    }
  });

  it('9. Fails startup in production when custom AuthService is injected (P0-1)', async () => {
    setEnv('NODE_ENV', 'production');
    process.env.DATABASE_URL = 'postgresql://pramaan_app_user:secret@localhost:5432/pramaan';
    process.env.SUPABASE_URL = 'https://qshujrddrzoemlzmleru.supabase.co';

    const { AuthService } = await import('../src/services/auth-service.js');
    const { JwtVerifier } = await import('../src/services/jwt-verifier.js');
    const { TEST_JWT_SECRET } = await import('../src/testing/test-jwt-utils.js');

    const customAuth = new AuthService({
      jwtVerifier: new JwtVerifier(TEST_JWT_SECRET)
    });

    expect(() => {
      buildApp({ authService: customAuth });
    }).toThrow(/FATAL: Production mode prohibits injecting custom authService/);
  });

  it('10. Prevents weak symmetric test JWT verifier injection in production mode (P0-1)', async () => {
    setEnv('NODE_ENV', 'production');
    process.env.DATABASE_URL = 'postgresql://pramaan_app_user:secret@localhost:5432/pramaan';
    process.env.SUPABASE_URL = 'https://qshujrddrzoemlzmleru.supabase.co';

    const { AuthService } = await import('../src/services/auth-service.js');
    const { JwtVerifier } = await import('../src/services/jwt-verifier.js');

    const weakAuthService = new AuthService({
      jwtVerifier: new JwtVerifier({ jwtSecret: 'weak-test-secret-at-least-32-chars!' })
    });

    expect(() => {
      buildApp({ authService: weakAuthService });
    }).toThrow(/FATAL: Production mode prohibits injecting custom authService/);
  });

  it('11. Allows custom AuthService injection in test / development mode (P0-1)', async () => {
    setEnv('NODE_ENV', 'test');
    process.env.SUPABASE_URL = 'https://qshujrddrzoemlzmleru.supabase.co';

    const { AuthService } = await import('../src/services/auth-service.js');
    const { JwtVerifier } = await import('../src/services/jwt-verifier.js');
    const { TEST_JWT_SECRET } = await import('../src/testing/test-jwt-utils.js');

    const customAuth = new AuthService({
      jwtVerifier: new JwtVerifier(TEST_JWT_SECRET)
    });

    const testApp = buildApp({ authService: customAuth, persistenceMode: 'in-memory' });
    expect(testApp).toBeDefined();
    const res = await testApp.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });
});
