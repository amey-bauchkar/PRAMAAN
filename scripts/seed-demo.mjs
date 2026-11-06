import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { resolveAdminSslConfig } from './admin-db-ssl.mjs';

try {
  process.loadEnvFile?.();
} catch {}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const seedPath = path.resolve(__dirname, '..', 'db', 'seeds', '001_demo_seed.sql');

async function seed() {
  console.log('[SEED] Running demo seed data...');
  if (!fs.existsSync(seedPath)) {
    throw new Error(`Seed file not found: ${seedPath}`);
  }
  const sql = fs.readFileSync(seedPath, 'utf8');

  const adminUrl = process.env.DATABASE_URL_ADMIN;
  if (!adminUrl) {
    throw new Error(
      'FATAL: DATABASE_URL_ADMIN is required exclusively for database seeding. Fallback to DATABASE_URL or Management API is strictly prohibited.'
    );
  }

  console.log('[SEED] Executing seed via administrative PostgreSQL connection (DATABASE_URL_ADMIN)...');
  const ssl = resolveAdminSslConfig(adminUrl);

  const pool = new pg.Pool({ connectionString: adminUrl, ssl, max: 1 });
  try {
    const client = await pool.connect();
    try {
      await client.query(sql);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }

  console.log('[SEED] Demo seed data applied successfully.');
}

seed().catch(err => {
  console.error('[SEED FAILED]', err);
  process.exit(1);
});
