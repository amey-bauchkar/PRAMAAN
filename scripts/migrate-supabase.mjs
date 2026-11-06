import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { resolveAdminSslConfig } from './admin-db-ssl.mjs';

try {
  process.loadEnvFile?.();
} catch {}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const migrationsDir = path.join(rootDir, 'db', 'migrations');

// PostgreSQL advisory lock ID to prevent concurrent migration runners from colliding
const MIGRATION_ADVISORY_LOCK_ID = 8429104820948123n;

/**
 * Migration Executor that strictly enforces administrative credentials (DATABASE_URL_ADMIN),
 * session advisory locks, and transactional DDL atomicity.
 * Stateless HTTP management API mode and runtime credentials (DATABASE_URL) are prohibited.
 */
class MigrationExecutor {
  constructor() {
    this.pgPool = null;
    this.pgClient = null;
    this.hasAdvisoryLock = false;
  }

  async init() {
    const adminUrl = process.env.DATABASE_URL_ADMIN;

    if (!adminUrl) {
      throw new Error(
        'FATAL: DATABASE_URL_ADMIN is required for schema migrations. Management API mode is disabled due to lack of session advisory locking and transactional DDL, and fallback to application runtime credentials (DATABASE_URL) is strictly prohibited.'
      );
    }

    console.log('[MIGRATION] Using administrative PostgreSQL connection (DATABASE_URL_ADMIN)...');
    const ssl = resolveAdminSslConfig(adminUrl);
    this.pgPool = new pg.Pool({ connectionString: adminUrl, ssl, max: 2 });
    this.pgClient = await this.pgPool.connect();
    
    // Acquire PostgreSQL session advisory lock to prevent concurrent migration runs
    await this.pgClient.query(`SELECT pg_advisory_lock(${MIGRATION_ADVISORY_LOCK_ID});`);
    this.hasAdvisoryLock = true;
  }

  async execute(sql) {
    if (!this.pgClient) {
      throw new Error('MigrationExecutor not initialized');
    }
    return await this.pgClient.query(sql);
  }

  async query(sql, params = []) {
    if (!this.pgClient) {
      throw new Error('MigrationExecutor not initialized');
    }
    const result = await this.pgClient.query(sql, params);
    return result.rows;
  }

  /**
   * Applies a single migration script and its corresponding ledger entry atomically.
   */
  async applyMigrationTransactional(version, filename, sqlContent, checksum) {
    if (!this.pgClient) {
      throw new Error('MigrationExecutor not initialized');
    }
    await this.pgClient.query('BEGIN;');
    try {
      await this.pgClient.query(sqlContent);
      await this.pgClient.query(
        `INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES ($1, $2, CURRENT_TIMESTAMP, $3);`,
        [version, filename, checksum]
      );
      await this.pgClient.query('COMMIT;');
    } catch (err) {
      await this.pgClient.query('ROLLBACK;');
      throw err;
    }
  }

  async close() {
    if (this.pgClient) {
      if (this.hasAdvisoryLock) {
        try {
          await this.pgClient.query(`SELECT pg_advisory_unlock(${MIGRATION_ADVISORY_LOCK_ID});`);
        } catch (err) {
          console.warn('[MIGRATION WARNING] Failed to release advisory lock during shutdown:', err);
        }
      }
      this.pgClient.release();
      this.pgClient = null;
    }
    if (this.pgPool) {
      await this.pgPool.end();
      this.pgPool = null;
    }
  }
}

/**
 * Computes deterministic SHA-256 hash of a file's content (normalizing line endings)
 */
export function computeChecksum(content) {
  const normalized = content.replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
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
      
      // Version identifier extracted from filename prefix (e.g., '001', '006b', '007', '008', '009')
      const versionMatch = filename.match(/^([0-9a-zA-Z_]+?)(?:_|$)/);
      const version = versionMatch ? versionMatch[1] : filename;

      if (appliedMap.has(version)) {
        const previousChecksum = appliedMap.get(version);
        if (previousChecksum !== checksum) {
          throw new Error(
            `FATAL: Migration ledger integrity violation! Checksum drift detected for previously applied migration '${filename}' (version ${version}).\n` +
            `Ledger Checksum:  ${previousChecksum}\n` +
            `Current File Hash: ${checksum}\n` +
            `Applied migrations are strictly immutable. Schema modifications must be applied via a new numbered migration.`
          );
        }
        skippedCount++;
        console.log(`[MIGRATION SKIP] Migration ${version} (${filename}) already recorded in ledger.`);
        continue;
      }

      console.log(`[MIGRATION APPLYING] ${version} (${filename}) [Atomic Transaction]...`);
      try {
        await executor.applyMigrationTransactional(version, filename, sqlContent, checksum);
        newlyAppliedCount++;
        console.log(`[MIGRATION SUCCESS] Applied & recorded ${version} (${filename})`);
      } catch (err) {
        console.error(`[MIGRATION FAILED] Error applying ${filename} (Transaction rolled back):`, err);
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
