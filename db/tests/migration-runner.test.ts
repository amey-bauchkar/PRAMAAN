import { describe, it, expect } from 'vitest';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
// @ts-ignore
import { runMigrations } from '../../scripts/migrate-supabase.mjs';

try {
  process.loadEnvFile?.();
} catch {}

describe('PRAMAAN Database Migration Reproducibility & Ledger Verification (Area 1 — P0)', () => {
  const adminUrl = process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL;
  const caPath = process.env.DATABASE_CA_PATH;
  const isLocal = adminUrl && (adminUrl.includes('localhost') || adminUrl.includes('127.0.0.1'));
  const ssl = caPath && fs.existsSync(caPath)
    ? { ca: fs.readFileSync(caPath, 'utf8'), rejectUnauthorized: true }
    : (isLocal ? false : { rejectUnauthorized: false });

  it('1. Verifies schema_migrations ledger records all migrations with SHA-256 checksums', async () => {
    if (!adminUrl) {
      console.warn('Skipping test: DATABASE_URL_ADMIN not configured');
      return;
    }

    const pool = new pg.Pool({ connectionString: adminUrl, ssl, max: 1 });
    try {
      const res = await pool.query(
        'SELECT version, name, applied_at, checksum FROM schema_migrations ORDER BY version ASC;'
      );

      expect(res.rows.length).toBeGreaterThanOrEqual(10);
      const versions = res.rows.map(r => r.version);
      expect(versions).toContain('001');
      expect(versions).toContain('002');
      expect(versions).toContain('003');
      expect(versions).toContain('004');
      expect(versions).toContain('005');
      expect(versions).toContain('006');
      expect(versions).toContain('006b');
      expect(versions).toContain('007');
      expect(versions).toContain('008');
      expect(versions).toContain('009');

      // Verify SHA-256 checksum format
      for (const row of res.rows) {
        expect(row.checksum).toMatch(/^[a-f0-9]{64}$/);
        expect(row.applied_at).toBeInstanceOf(Date);
      }
    } finally {
      await pool.end();
    }
  });

  it('2. Migration idempotency: rerunning migrations skips all previously recorded migrations', async () => {
    const result = await runMigrations();
    expect(result.total).toBeGreaterThanOrEqual(10);
    expect(result.newlyApplied).toBe(0);
    expect(result.skipped).toBe(result.total);
  });

  it('3. Security role separation: migration runner rejects execution under restricted runtime user', async () => {
    const originalAdmin = process.env.DATABASE_URL_ADMIN;
    const originalToken = process.env.SUPABASE_MANAGEMENT_TOKEN;
    const originalDbUrl = process.env.DATABASE_URL;

    try {
      delete process.env.DATABASE_URL_ADMIN;
      delete process.env.SUPABASE_MANAGEMENT_TOKEN;
      process.env.DATABASE_URL = 'postgresql://pramaan_app_user:somepassword@localhost:5432/pramaan';

      await expect(runMigrations()).rejects.toThrow(
        /DATABASE_URL is configured as restricted runtime user 'pramaan_app_user'/
      );
    } finally {
      if (originalAdmin) process.env.DATABASE_URL_ADMIN = originalAdmin;
      if (originalToken) process.env.SUPABASE_MANAGEMENT_TOKEN = originalToken;
      if (originalDbUrl) process.env.DATABASE_URL = originalDbUrl;
    }
  });

  it('4. Migration checksum integrity: file contents match recorded checksums in ledger', async () => {
    if (!adminUrl) return;

    const pool = new pg.Pool({ connectionString: adminUrl, ssl, max: 1 });
    try {
      const res = await pool.query('SELECT version, name, checksum FROM schema_migrations;');
      const recorded = new Map(res.rows.map(r => [r.name, r.checksum]));

      const migrationsDir = path.resolve(__dirname, '..', 'migrations');
      const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));

      for (const file of files) {
        const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        const hash = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
        const recordedHash = recorded.get(file);
        expect(recordedHash).toBeDefined();
        expect(hash).toBe(recordedHash);
      }
    } finally {
      await pool.end();
    }
  });
});
