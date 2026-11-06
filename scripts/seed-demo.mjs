import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { runQuery as runSupabaseQuery } from './supabase-runner.mjs';
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

  const adminUrl = process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL;
  if (adminUrl) {
    console.log('[SEED] Executing seed via PostgreSQL connection...');
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
  } else if (process.env.SUPABASE_MANAGEMENT_TOKEN) {
    console.log('[SEED] Executing seed via Supabase Management API...');
    await runSupabaseQuery(sql);
  } else {
    throw new Error('No database connection credentials available for seeding. Set DATABASE_URL_ADMIN or SUPABASE_MANAGEMENT_TOKEN.');
  }

  console.log('[SEED] Demo seed data applied successfully.');
}

seed().catch(err => {
  console.error('[SEED FAILED]', err);
  process.exit(1);
});
