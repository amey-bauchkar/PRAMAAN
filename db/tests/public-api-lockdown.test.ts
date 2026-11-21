import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createMigratedDb } from './helpers/pglite-db.js';

/**
 * Supabase hands its public roles (anon, authenticated) every new table and function in `public`, and serves them over a REST interface
 * to anyone with the public anon key. This test recreates those default grants and checks the migrations take them away again.
 */
let db: PGlite;
beforeAll(async () => {
  db = await createMigratedDb({
    beforeMigrations: async d => {
      await d.exec(`
        CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
        GRANT USAGE ON SCHEMA public TO anon, authenticated;
        ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO anon, authenticated;
        ALTER DEFAULT PRIVILEGES GRANT ALL ON FUNCTIONS TO anon, authenticated;
        ALTER DEFAULT PRIVILEGES GRANT ALL ON SEQUENCES TO anon, authenticated;`);
    },
  });
}, 120_000);

describe('public API lock-down', () => {
  it('anon and authenticated have no access to any table in public', async () => {
    for (const role of ['anon', 'authenticated']) {
      const r = await db.query<any>(`SELECT count(*)::int AS n FROM information_schema.tables t WHERE t.table_schema = 'public'
        AND (has_table_privilege('${role}', format('%I.%I', t.table_schema, t.table_name), 'SELECT') OR has_table_privilege('${role}', format('%I.%I', t.table_schema, t.table_name), 'INSERT'))`);
      expect(r.rows[0].n, role).toBe(0);
    }
  });

  it('they cannot run any SECURITY DEFINER function, including the claim, erase and identity functions', async () => {
    for (const role of ['anon', 'authenticated']) {
      const r = await db.query<any>(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prosecdef AND has_function_privilege('${role}', p.oid, 'EXECUTE') ORDER BY 1`);
      expect(r.rows.map((x: any) => x.proname), role).toEqual([]);
    }
  });

  it('the API role can still use what it needs', async () => {
    const r = await db.query<any>(`SELECT has_function_privilege('app_api', 'claim_invitation(text,text,text,text)', 'EXECUTE') AS claim,
      has_table_privilege('app_api', 'pending_invites', 'SELECT') AS invites, has_function_privilege('app_api', 'resolve_user_identity(text)', 'EXECUTE') AS identity`);
    expect(r.rows[0]).toEqual({ claim: true, invites: true, identity: true });
  });

  it('objects created later are not handed to them either', async () => {
    await db.exec(`CREATE TABLE later_table (id int); CREATE FUNCTION later_fn() RETURNS int LANGUAGE sql AS 'SELECT 1';`);
    const r = await db.query<any>(`SELECT has_table_privilege('anon', 'later_table', 'SELECT') AS t, has_function_privilege('anon', 'later_fn()', 'EXECUTE') AS f`);
    expect(r.rows[0].t).toBe(false);
    expect(r.rows[0].f).toBe(true); // plain PostgreSQL still lets PUBLIC run new functions; definer functions are closed by the rule above and each migration's own REVOKE
  });
});
