import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { runQuery as runSupabaseQuery } from './supabase-runner.mjs';

try {
  process.loadEnvFile?.();
} catch {}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const migrationsDir = path.join(rootDir, 'db', 'migrations');

/**
 * Migration Executor that safely separates administrative credentials
 * from restricted application runtime credentials.
 */
class MigrationExecutor {
  constructor() {
    this.pgPool = null;
    this.mode = 'none';
  }

  async init() {
    const adminUrl = process.env.DATABASE_URL_ADMIN;
    const managementToken = process.env.SUPABASE_MANAGEMENT_TOKEN;
    const runtimeUrl = process.env.DATABASE_URL;

    if (adminUrl) {
      console.log('[MIGRATION] Using administrative PostgreSQL connection (DATABASE_URL_ADMIN)...');
      const ssl = process.env.DATABASE_CA_PATH && fs.existsSync(process.env.DATABASE_CA_PATH)
        ? { ca: fs.readFileSync(process.env.DATABASE_CA_PATH, 'utf8'), rejectUnauthorized: true }
        : (adminUrl.includes('localhost') || adminUrl.includes('127.0.0.1')) ? false : { rejectUnauthorized: false };

      this.pgPool = new pg.Pool({ connectionString: adminUrl, ssl, max: 2 });
      this.mode = 'pg';
    } else if (managementToken) {
      console.log('[MIGRATION] Using Supabase Management API via SUPABASE_MANAGEMENT_TOKEN...');
      this.mode = 'supabase_api';
    } else if (runtimeUrl) {
      // Check if user is attempting to run migrations with restricted runtime login
      if (runtimeUrl.includes('pramaan_app_user')) {
        throw new Error(
          'FATAL: Migration execution rejected. DATABASE_URL is configured as restricted runtime user \'pramaan_app_user\' (NOBYPASSRLS, no DDL privileges). Provide administrative credentials via DATABASE_URL_ADMIN or SUPABASE_MANAGEMENT_TOKEN.'
        );
      }
      console.warn('[MIGRATION WARNING] DATABASE_URL_ADMIN not set; falling back to DATABASE_URL with DDL check...');
      const ssl = process.env.DATABASE_CA_PATH && fs.existsSync(process.env.DATABASE_CA_PATH)
        ? { ca: fs.readFileSync(process.env.DATABASE_CA_PATH, 'utf8'), rejectUnauthorized: true }
        : (runtimeUrl.includes('localhost') || runtimeUrl.includes('127.0.0.1')) ? false : { rejectUnauthorized: false };

      this.pgPool = new pg.Pool({ connectionString: runtimeUrl, ssl, max: 2 });
      this.mode = 'pg';
    } else {
      throw new Error(
        'FATAL: No migration credentials available. Set DATABASE_URL_ADMIN (preferred for DDL) or SUPABASE_MANAGEMENT_TOKEN.'
      );
    }
  }

  async execute(sql) {
    if (this.mode === 'pg') {
      const client = await this.pgPool.connect();
      try {
        return await client.query(sql);
      } finally {
        client.release();
      }
    } else if (this.mode === 'supabase_api') {
      return await runSupabaseQuery(sql);
    } else {
      throw new Error('MigrationExecutor not initialized');
    }
  }

  async query(sql, params = []) {
    if (this.mode === 'pg') {
      const client = await this.pgPool.connect();
      try {
        const result = await client.query(sql, params);
        return result.rows;
      } finally {
        client.release();
      }
    } else if (this.mode === 'supabase_api') {
      // Supabase query API executes raw SQL without parameter binding; sanitize or format simple parameters
      let formattedSql = sql;
      if (params && params.length > 0) {
        params.forEach((param, idx) => {
          const placeholder = new RegExp(`\\$${idx + 1}\\b`, 'g');
          const escaped = typeof param === 'string' ? `'${param.replace(/'/g, "''")}'` : String(param);
          formattedSql = formattedSql.replace(placeholder, escaped);
        });
      }
      const data = await runSupabaseQuery(formattedSql);
      return Array.isArray(data) ? data : (data?.rows || []);
    }
  }

  async close() {
    if (this.pgPool) {
      await this.pgPool.end();
    }
  }
}

/**
 * Computes deterministic SHA-256 hash of a file's content
 */
function computeChecksum(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Main migration entry point
 */
export async function runMigrations() {
  console.log('[MIGRATION] Initializing PRAMAAN Migration Engine...');
  const executor = new MigrationExecutor();
  await executor.init();

  try {
    // 1. Ensure Ledger Table: schema_migrations
    console.log('[MIGRATION] Ensuring migration ledger table (schema_migrations)...');
    await executor.execute(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        checksum VARCHAR(64) NOT NULL
      );
    `);

    // 2. Ensure base application roles exist idempotently (before migrations create tables/policies)
    console.log('[MIGRATION] Ensuring foundational security roles (app_api, ai_worker, fairness_job)...');
    await executor.execute(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_api') THEN
          CREATE ROLE app_api WITH NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
        ELSE
          ALTER ROLE app_api NOBYPASSRLS;
        END IF;

        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ai_worker') THEN
          CREATE ROLE ai_worker WITH NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
        ELSE
          ALTER ROLE ai_worker NOBYPASSRLS;
        END IF;

        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fairness_job') THEN
          CREATE ROLE fairness_job WITH NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
        ELSE
          ALTER ROLE fairness_job NOBYPASSRLS;
        END IF;
      END $$;
    `);

    // 3. Query existing applied migrations from ledger
    const appliedRows = await executor.query('SELECT version, checksum FROM schema_migrations;');
    const appliedMap = new Map();
    for (const row of appliedRows) {
      appliedMap.set(row.version, row.checksum);
    }
    console.log(`[MIGRATION] Found ${appliedMap.size} previously applied migrations in ledger.`);

    // 4. Discover and sort all migration files in db/migrations/
    const allFiles = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));

    console.log(`[MIGRATION] Discovered ${allFiles.length} migration files in sequence:`);
    allFiles.forEach(f => console.log(`  - ${f}`));

    let newlyAppliedCount = 0;
    let skippedCount = 0;

    for (const filename of allFiles) {
      const fullPath = path.join(migrationsDir, filename);
      const sqlContent = fs.readFileSync(fullPath, 'utf8');
      const checksum = computeChecksum(sqlContent);
      
      // Version identifier extracted from filename prefix (e.g., '001', '006b', '007', '008')
      const versionMatch = filename.match(/^([0-9a-zA-Z_]+?)(?:_|$)/);
      const version = versionMatch ? versionMatch[1] : filename;

      if (appliedMap.has(version)) {
        skippedCount++;
        const previousChecksum = appliedMap.get(version);
        if (previousChecksum !== checksum) {
          console.warn(`[MIGRATION WARNING] Checksum drift detected for already-applied migration ${filename}! Recorded: ${previousChecksum.substring(0, 8)}..., Current: ${checksum.substring(0, 8)}... (Skipping rerun)`);
        } else {
          console.log(`[MIGRATION SKIP] Migration ${version} (${filename}) already recorded in ledger.`);
        }
        continue;
      }

      console.log(`[MIGRATION APPLYING] ${version} (${filename})...`);
      try {
        await executor.execute(sqlContent);

        // Record in ledger
        await executor.query(
          `INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES ($1, $2, CURRENT_TIMESTAMP, $3);`,
          [version, filename, checksum]
        );
        newlyAppliedCount++;
        console.log(`[MIGRATION SUCCESS] Applied & recorded ${version} (${filename})`);
      } catch (err) {
        console.error(`[MIGRATION FAILED] Error applying ${filename}:`, err);
        throw err;
      }
    }

    console.log(`[MIGRATION COMPLETE] Total: ${allFiles.length} | Newly applied: ${newlyAppliedCount} | Skipped (up-to-date): ${skippedCount}`);
    return {
      total: allFiles.length,
      newlyApplied: newlyAppliedCount,
      skipped: skippedCount
    };
  } finally {
    await executor.close();
  }
}

// Auto-run if executed directly
if (process.argv[1]?.endsWith('migrate-supabase.mjs')) {
  runMigrations()
    .then(() => {
      console.log('[MIGRATION PROCESS EXIT] Clean termination.');
      process.exit(0);
    })
    .catch(err => {
      console.error('[MIGRATION PROCESS FATAL]', err);
      process.exit(1);
    });
}
