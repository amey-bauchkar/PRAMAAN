/**
 * Evaluates and publishes the scheduled drives of the VPPCOE sample tenant, as its sample placement officer, through the same code the
 * app uses (row-level security on). Without this, recruiters see no candidates and students see no eligibility decisions.
 *
 *   npx tsx --env-file=.env apps/api/src/publish-sample-drives.ts
 *
 * Needs DATABASE_URL (the API's runtime role) and SUPABASE_PROJECT_REF plus SUPABASE_MANAGEMENT_TOKEN to look up the college and officer.
 */
import { PostgresDb } from './v2/db.js';
import { evaluateDrive } from './v2/services.js';

const ref = process.env.SUPABASE_PROJECT_REF, token = process.env.SUPABASE_MANAGEMENT_TOKEN;
if (!process.env.DATABASE_URL || !ref || !token) { console.error('DATABASE_URL, SUPABASE_PROJECT_REF and SUPABASE_MANAGEMENT_TOKEN must be set in .env.'); process.exit(1); }

async function lookup(query: string): Promise<any[]> {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query/read-only`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error(`Lookup failed: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

async function main() {
  const [o] = await lookup(`select o.id as org_id, m.user_id from organizations o join memberships m on m.org_id = o.id join users u on u.id = m.user_id
    where o.name like 'Vasantdada%' and m.role = 'officer' and u.email = 'kavita.rane@vppcoe.example'`);
  if (!o) throw new Error('The VPPCOE sample officer was not found. Run npm run sample:vppcoe first.');
  const db = new PostgresDb();
  const ctx = { userId: o.user_id, orgId: o.org_id, role: 'officer' as const };
  const results = await db.withTenant(ctx, async sql => {
    const drives = (await sql.query<{ id: string; title: string }>(`SELECT id, title FROM drives WHERE status = 'scheduled' AND rule_version_id IS NOT NULL ORDER BY starts_at`)).rows;
    const out: { title: string; eligible: number; ineligible: number; needsReview: number }[] = [];
    for (const d of drives) out.push({ title: d.title, ...(await evaluateDrive(sql, ctx, d.id, { publish: true })) });
    return out;
  });
  for (const r of results) console.log(`${r.title.padEnd(34)} eligible ${String(r.eligible).padStart(3)}  not eligible ${String(r.ineligible).padStart(3)}  needs review ${r.needsReview}`);
  process.exit(0);
}
main().catch(e => { console.error(e?.message ?? e); process.exit(1); });
