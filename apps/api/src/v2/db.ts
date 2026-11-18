import fs from 'fs';
import path from 'path';
import type { PGlite } from '@electric-sql/pglite';
import { SessionContext } from '@pramaan/contracts';
import { getDbPool } from '../db/pool.js';

/** Minimal query surface shared by node-postgres clients and PGlite transactions. */
export interface Sql {
  query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface TenantOptions {
  /**
   * Overrides the role written to app.current_user_role for this transaction. Only used for
   * narrowly-scoped server jobs (never taken from the request).
   */
  appRole?: string;
}

/**
 * Data access for the v2 modules. Every request runs inside one transaction as the restricted `app_api`
 * database role with the tenant context set, so row-level security applies to every statement, in the
 * demo (PGlite) and in production (PostgreSQL) alike.
 */
export interface Db {
  readonly kind: 'pglite' | 'postgres';
  withTenant<T>(ctx: SessionContext, fn: (sql: Sql) => Promise<T>, opts?: TenantOptions): Promise<T>;
  /** As app_api with no tenant: only SECURITY DEFINER functions return data (public credential checks). */
  withPublic<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
}

const SET_CONTEXT = `SELECT set_config('app.current_org_id', $1, true), set_config('app.current_user_id', $2, true), set_config('app.current_user_role', $3, true)`;

export class PgliteDb implements Db {
  readonly kind = 'pglite' as const;
  constructor(private readonly pg: PGlite) {}

  /** Admin access for bootstrapping only (migrations, seeds, demo setup). Never used by routes. */
  get admin(): PGlite { return this.pg; }

  async withTenant<T>(ctx: SessionContext, fn: (sql: Sql) => Promise<T>, opts: TenantOptions = {}): Promise<T> {
    if (!ctx?.orgId) throw new Error('TENANT_CONTEXT_REQUIRED');
    return this.pg.transaction(async tx => {
      await tx.query('SET LOCAL ROLE app_api');
      await tx.query(SET_CONTEXT, [ctx.orgId, ctx.userId ?? '', opts.appRole ?? ctx.role ?? '']);
      return fn(tx as unknown as Sql);
    });
  }

  async withPublic<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
    return this.pg.transaction(async tx => {
      await tx.query('SET LOCAL ROLE app_api');
      return fn(tx as unknown as Sql);
    });
  }
}

export class PostgresDb implements Db {
  readonly kind = 'postgres' as const;

  async withTenant<T>(ctx: SessionContext, fn: (sql: Sql) => Promise<T>, opts: TenantOptions = {}): Promise<T> {
    if (!ctx?.orgId) throw new Error('TENANT_CONTEXT_REQUIRED');
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_api');
      await client.query(SET_CONTEXT, [ctx.orgId, ctx.userId ?? '', opts.appRole ?? ctx.role ?? '']);
      const out = await fn(client as unknown as Sql);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch {}
      throw err;
    } finally {
      client.release();
    }
  }

  async withPublic<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_api');
      const out = await fn(client as unknown as Sql);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch {}
      throw err;
    } finally {
      client.release();
    }
  }
}

function repoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'db', 'migrations'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('Could not locate db/migrations from ' + __dirname);
}

/**
 * Creates an in-process PostgreSQL (PGlite) with every migration and seed applied, in the same order as
 * scripts/migrate-supabase.mjs and scripts/seed-demo.mjs. Used by the demo server and integration tests.
 */
export async function createPgliteDatabase(options: { seeds?: boolean; dataDir?: string } = {}): Promise<PGlite> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { btree_gist } = await import('@electric-sql/pglite/contrib/btree_gist');
  const pg = await PGlite.create({ dataDir: options.dataDir, extensions: { pgcrypto, btree_gist } });
  const root = repoRoot();
  await pg.exec(`
    CREATE ROLE app_api WITH NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
    CREATE ROLE ai_worker WITH NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
    CREATE ROLE fairness_job WITH NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  `);
  const dir = path.join(root, 'db', 'migrations');
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.sql')).sort((a, b) => a.localeCompare(b))) {
    await pg.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
  if (options.seeds !== false) {
    const sdir = path.join(root, 'db', 'seeds');
    for (const f of fs.readdirSync(sdir).filter(x => x.endsWith('.sql')).sort((a, b) => a.localeCompare(b))) {
      await pg.exec(fs.readFileSync(path.join(sdir, f), 'utf8'));
    }
  }
  return pg as unknown as PGlite;
}
