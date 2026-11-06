import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runQuery } from './supabase-runner.mjs';

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
  await runQuery(sql);
  console.log('[SEED] Demo seed data applied successfully.');
}

seed().catch(err => {
  console.error('[SEED FAILED]', err);
  process.exit(1);
});
