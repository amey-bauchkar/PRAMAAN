import { runQuery } from './supabase-runner.mjs';

async function audit() {
  const sql = `
    SELECT 
      c.relname as table_name,
      c.relrowsecurity as rls_enabled,
      c.relforcerowsecurity as rls_forced,
      COUNT(p.policyname) as policy_count,
      COALESCE(string_agg(p.policyname || ' (' || p.cmd || ')', ', '), 'NONE') as policies
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_policies p ON p.schemaname = n.nspname AND p.tablename = c.relname
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
    ORDER BY c.relname;
  `;

  const rows = await runQuery(sql);
  console.table(rows);
  return rows;
}

audit().catch(console.error);
