import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
// @ts-ignore
import { resolveAdminSslConfig } from '../../scripts/admin-db-ssl.mjs';
// @ts-ignore
import { runMigrations } from '../../scripts/migrate-supabase.mjs';

describe('Administrative Migration & Seed TLS Verification (P0-2) and Ledger Integrity (P1-3)', () => {
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

  // P0-2 Unit Tests
  it('1. Localhost CI connection resolves to ssl: false', () => {
    const localhostUrls = [
      'postgresql://postgres:ci_password@localhost:5432/pramaan_test',
      'postgresql://postgres:ci_password@127.0.0.1:5432/pramaan_test',
      'postgresql://postgres:ci_password@[::1]:5432/pramaan_test'
    ];

    for (const url of localhostUrls) {
      const ssl = resolveAdminSslConfig(url);
      expect(ssl).toBe(false);
    }
  });

  it('2. Remote connection with valid CA enforces strict verification (rejectUnauthorized: true, servername, ca)', () => {
    const dummyCa = '-----BEGIN CERTIFICATE-----\nMIIBdummyCA...\n-----END CERTIFICATE-----';
    setEnv('DATABASE_CA_CERT', dummyCa);
    delete process.env.DATABASE_CA_PATH;

    const remoteUrl = 'postgresql://admin:supersecret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres';
    const ssl = resolveAdminSslConfig(remoteUrl);

    expect(typeof ssl).toBe('object');
    expect(ssl.rejectUnauthorized).toBe(true);
    expect(ssl.servername).toBe('aws-0-ap-southeast-1.pooler.supabase.com');
    expect(ssl.ca).toBe(dummyCa);
  });

  it('3. Remote connection without CA fails closed immediately (rejectUnauthorized: false prohibited)', () => {
    delete process.env.DATABASE_CA_CERT;
    delete process.env.DATABASE_CA_PATH;

    const remoteUrl = 'postgresql://admin:supersecret@remote-db.example.com:5432/pramaan';

    // Mock fs.existsSync to simulate an environment where no CA bundle is present on disk
    const originalExistsSync = fs.existsSync;
    fs.existsSync = () => false;

    try {
      expect(() => {
        resolveAdminSslConfig(remoteUrl);
      }).toThrow(/Remote database connection to 'remote-db\.example\.com' requires verified TLS/);
    } finally {
      fs.existsSync = originalExistsSync;
    }
  });

  it('4. Explicit invalid CA path fails fast and immediately', () => {
    delete process.env.DATABASE_CA_CERT;
    setEnv('DATABASE_CA_PATH', '/nonexistent/path/to/missing_admin_ca.crt');

    const remoteUrl = 'postgresql://admin:supersecret@remote-db.example.com:5432/pramaan';
    expect(() => {
      resolveAdminSslConfig(remoteUrl);
    }).toThrow(/DATABASE_CA_PATH is configured \('.*missing_admin_ca\.crt'\) but file does not exist or is inaccessible/);
  });

  it('5. Insecure TLS environment-variable bypass attempt is strictly rejected/ignored', () => {
    const dummyCa = '-----BEGIN CERTIFICATE-----\nMIIBdummyCA...\n-----END CERTIFICATE-----';
    setEnv('DATABASE_CA_CERT', dummyCa);
    setEnv('DATABASE_SSL_ALLOW_INSECURE', 'true'); // Attempted bypass flag

    const remoteUrl = 'postgresql://admin:supersecret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres';
    const ssl = resolveAdminSslConfig(remoteUrl);

    // Bypass flag must be ignored; rejectUnauthorized MUST remain true
    expect(ssl.rejectUnauthorized).toBe(true);
    expect(ssl.servername).toBe('aws-0-ap-southeast-1.pooler.supabase.com');
  });

  // P1-3 Unit Test: Checksum drift
  it('6. Checksum drift detection terminates migration execution with non-zero exit code (P1-3)', async () => {
    const adminUrl = process.env.DATABASE_URL_ADMIN;
    if (!adminUrl) return;

    // We can simulate checksum drift by temporarily tampering with an applied migration file in memory/test
    const migrationsDir = path.resolve(process.cwd(), 'db', 'migrations');
    const targetMigration = path.join(migrationsDir, '001_identity_and_tenancy.sql');
    const originalContent = fs.readFileSync(targetMigration, 'utf8');

    try {
      // Append a comment to change the checksum of migration 001
      fs.writeFileSync(targetMigration, originalContent + '\n-- TAMPERED CHECKSUM TEST COMMENT\n', 'utf8');

      await expect(runMigrations()).rejects.toThrow(
        /Migration ledger integrity violation! Checksum drift detected/
      );
    } finally {
      // Restore original file content exactly
      fs.writeFileSync(targetMigration, originalContent, 'utf8');
    }
  });
});
