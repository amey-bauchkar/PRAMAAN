#!/usr/bin/env node
/**
 * Loads the generated VPPCOE sample tenant (staff, 140 students, skills, drives, applications, mock drives) into your Supabase project
 * through the management API (SUPABASE_PROJECT_REF and SUPABASE_MANAGEMENT_TOKEN in .env). Safe to run again: every insert is
 * ON CONFLICT DO NOTHING. The college's existing departments, admin, invitations and anything people created are left alone.
 *
 *   npm run sample:vppcoe            generate and load
 *
 * Sample data cannot be removed again with a script: students who have application history are protected by the append-only history
 * tables, by design. To start clean, use a fresh Supabase project or a new college.
 *
 * The data is generated, not real people. Emails use the reserved .example domain, so nothing can reach a real inbox.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

try { process.loadEnvFile?.(); } catch { /* no .env */ }
const ref = process.env.SUPABASE_PROJECT_REF, token = process.env.SUPABASE_MANAGEMENT_TOKEN;
if (!ref || !token) { console.error('SUPABASE_PROJECT_REF and SUPABASE_MANAGEMENT_TOKEN must be set in .env.'); process.exit(1); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COLLEGE = "Vasantdada Patil Pratishthan's College of Engineering and Visual Arts (VPPCOE)";

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
  const body = await r.json().catch(() => ({}));
  if (r.status >= 300) throw new Error(`${r.status} ${JSON.stringify(body).slice(0, 400)}`);
  return Array.isArray(body) ? body : [];
}

/** Splits SQL into statements at semicolons that are outside quoted text and comments. */
export function splitSql(text) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { cur += c; if (c === "'") { if (text[i + 1] === "'") { cur += "'"; i++; } else q = false; } continue; }
    if (c === '-' && text[i + 1] === '-') { while (i < text.length && text[i] !== '\n') i++; cur += '\n'; continue; }
    if (c === "'") { q = true; cur += c; continue; }
    if (c === ';') { if (cur.trim()) out.push(cur.trim() + ';'); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim() + ';');
  return out;
}

const org = (await sql(`select id from organizations where name = '${COLLEGE.replace(/'/g, "''")}'`))[0];
if (!org) { console.error(`The college "${COLLEGE}" does not exist yet. Run npm run bootstrap:college first.`); process.exit(1); }

console.log('Generating the sample tenant...');
// The college's existing departments (real invitations may point at them) are kept and used as they are.
const depts = Object.fromEntries((await sql(`select code, id from departments where org_id = '${org.id}'`)).map(d => [d.code, d.id]));
for (const c of ['CSE', 'IT', 'ENTC']) if (!depts[c]) { console.error(`Department ${c} is missing. Run npm run bootstrap:college first.`); process.exit(1); }
execFileSync(process.execPath, [path.join(root, 'scripts', 'generate-demo-seed.mjs')], { cwd: root, stdio: 'inherit', env: { ...process.env, SEED_TENANT: 'vppcoe', VPPCOE_ORG_ID: org.id, VPPCOE_DEPT_IDS: JSON.stringify(depts) } });
const text = fs.readFileSync(path.join(root, 'db', 'sample', 'vppcoe_sample_tenant.sql'), 'utf8');
const statements = splitSql(text);

// Questions copied in when the college was first created are replaced by the sample's approved ones. Questions the app drafted are kept.
await sql(`DELETE FROM interview_questions WHERE org_id = '${org.id}' AND status = 'draft' AND drafted_by = 'officer'`);

const LIMIT = 250_000;
let batch = [], size = 0, n = 0;
const flush = async () => {
  if (!batch.length) return;
  n++;
  try { await sql(`BEGIN;\n${batch.join('\n')}\nCOMMIT;`); }
  catch (e) { console.error(`Batch ${n} failed: ${e.message}`); process.exit(1); }
  process.stdout.write(`\rapplied ${n} batches (${statements.indexOf(batch[batch.length - 1]) + 1}/${statements.length} statements)`);
  batch = []; size = 0;
};
for (const st of statements) { if (size + st.length > LIMIT) await flush(); batch.push(st); size += st.length; }
await flush();
// Evaluate and publish the upcoming drives as the sample officer, then let eligible students apply (about 70%, and always the three
// drive-ready sample candidates). Recruiters only ever see students who applied, so without this their candidate lists are empty.
console.log('\nPublishing eligibility decisions for the upcoming drives...');
execFileSync('npx', ['tsx', '--env-file=.env', 'apps/api/src/publish-sample-drives.ts'], { cwd: root, stdio: 'inherit', env: process.env });
await sql(`BEGIN;
  INSERT INTO applications (id, drive_id, student_id, stage)
  SELECT gen_random_uuid(), e.drive_id, e.student_id, 'applied'
    FROM eligibility_decisions e JOIN drives d ON d.id = e.drive_id JOIN students s ON s.id = e.student_id JOIN users u ON u.id = s.user_id
   WHERE d.org_id = '${org.id}' AND d.status = 'scheduled' AND e.result = 'eligible' AND e.status IN ('published', 'overridden')
     AND (u.full_name IN ('Aarav Deshpande', 'Ishita Joshi', 'Varun Mehta') OR abs(hashtext(e.student_id::text || e.drive_id::text)) % 10 < 7)
  ON CONFLICT DO NOTHING;
  INSERT INTO application_events (id, application_id, from_stage, to_stage, occurred_at)
  SELECT gen_random_uuid(), a.id, NULL, 'applied', now() - interval '2 days' FROM applications a JOIN drives d ON d.id = a.drive_id
   WHERE d.org_id = '${org.id}' AND d.status = 'scheduled' AND NOT EXISTS (SELECT 1 FROM application_events x WHERE x.application_id = a.id);
COMMIT;`);
console.log('\nLoaded. Summary:');
for (const [label, query] of [
  ['students', `select count(*)::int n from students where org_id='${org.id}'`],
  ['staff', `select role, count(*)::int n from memberships where org_id='${org.id}' and role<>'student' group by role order by role`],
  ['verified skills', `select count(*)::int n from student_skills ss join students s on s.id=ss.student_id where s.org_id='${org.id}' and ss.state='verified'`],
  ['drives', `select count(*)::int n from drives where org_id='${org.id}'`],
  ['applications', `select count(*)::int n from applications a join drives d on d.id=a.drive_id where d.org_id='${org.id}'`],
  ['mock attempts', `select count(*)::int n from mock_attempts m join students s on s.id=m.student_id where s.org_id='${org.id}'`],
]) console.log(' ', label.padEnd(18), JSON.stringify(await sql(query)));
