import fs from 'fs';
import path from 'path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

const ROOT = path.resolve(__dirname, '..', '..', '..');
export const MIGRATIONS_DIR = path.join(ROOT, 'db', 'migrations');
export const SEEDS_DIR = path.join(ROOT, 'db', 'seeds');

/**
 * In-process PostgreSQL (PGlite) with every migration applied in the same order as
 * scripts/migrate-supabase.mjs. Needs no Docker and never touches a live database.
 * Runs as the bootstrap superuser, so RLS is bypassed; use it for schema, trigger and constraint tests.
 */
export async function createMigratedDb(options: { upTo?: string } = {}): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { pgcrypto, btree_gist } });
  // Same foundational roles the migration runner creates before applying files.
  await db.exec(`
    CREATE ROLE app_api WITH NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
    CREATE ROLE ai_worker WITH NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
    CREATE ROLE fairness_job WITH NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  `);
  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort((a, b) => a.localeCompare(b));
  for (const f of files) {
    if (options.upTo && f.localeCompare(options.upTo) > 0) break;
    await db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

export async function applySeed(db: PGlite, file: string): Promise<void> {
  await db.exec(fs.readFileSync(path.join(SEEDS_DIR, file), 'utf8'));
}
