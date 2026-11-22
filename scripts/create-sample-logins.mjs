#!/usr/bin/env node
/**
 * Gives key VPPCOE sample people a real Supabase login, so every role can be shown signed in. Each person is created in Supabase Auth with
 * their sample email (a reserved .example address, so no real inbox) and a generated password, and their sample record is attached to it.
 * Passwords are written ONLY to .local/demo-logins.md (git-ignored). Safe to run again: people who already have a login are skipped.
 *
 *   SUPABASE_SERVICE_ROLE_KEY=... npm run sample:logins
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

try { process.loadEnvFile?.(); } catch { /* no .env */ }
const { SUPABASE_PROJECT_REF: ref, SUPABASE_MANAGEMENT_TOKEN: token, SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: srk } = process.env;
if (!ref || !token || !url) { console.error('SUPABASE_PROJECT_REF, SUPABASE_MANAGEMENT_TOKEN and SUPABASE_URL must be set in .env.'); process.exit(1); }
if (!srk) { console.error('Set SUPABASE_SERVICE_ROLE_KEY for this one command (it is not kept in .env).'); process.exit(1); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const sql = async query => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
  const j = await r.json();
  if (r.status >= 300) throw new Error(JSON.stringify(j).slice(0, 300));
  return Array.isArray(j) ? j : [];
};
const admin = (method, p, body) => fetch(`${url}/auth/v1/admin${p}`, { method, headers: { apikey: srk, Authorization: `Bearer ${srk}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

const PEOPLE = [
  ['sample|tpo-a', 'Placement officer', '/tpo'], ['sample|coord-cse', 'Department coordinator (Computer Engineering)', '/tpo'], ['sample|mentor-cse', 'Mentor (Computer Engineering)', '/tpo'],
  ['sample|recruiter-1', 'Recruiter (Nimbus Analytics, Backend drive)', '/recruiter'], ['sample|uni-admin', 'University admin (University of Mumbai)', '/university'],
  ['sample|student:cse:1', 'Student, drive-ready (full-stack and AI profile)', '/student'], ['sample|student:cse:2', 'Student, drive-ready (front-end profile)', '/student'],
  ['sample|student:cse:0', 'Student, the SQL-gap story (not yet eligible for Backend)', '/student'],
];
const existing = (await admin('GET', '/users?per_page=1000')).body.users ?? [];
const lines = [], skipped = [];
for (const [subject, label, home] of PEOPLE) {
  const [u] = await sql(`select id, email, full_name from users where auth_subject = '${subject}'`);
  if (!u) { skipped.push(`${label}: already has a real login or does not exist`); continue; }
  if (existing.some(x => x.email === u.email)) { skipped.push(`${label}: a Supabase login for ${u.email} already exists`); continue; }
  const password = crypto.randomBytes(12).toString('base64url');
  const made = await admin('POST', '/users', { email: u.email, password, email_confirm: true, user_metadata: { full_name: u.full_name, sample_data: true } });
  if (made.status >= 300 || !made.body.id) { skipped.push(`${label}: Supabase refused (${made.status} ${JSON.stringify(made.body).slice(0, 120)})`); continue; }
  await sql(`update users set auth_subject = '${made.body.id}' where auth_subject = '${subject}'`);
  lines.push({ label, name: u.full_name, email: u.email, password, home });
}
fs.mkdirSync(path.join(root, '.local'), { recursive: true });
const file = path.join(root, '.local', 'demo-logins.md');
const body = lines.length ? `# VPPCOE sample logins\n\nSign in at /login with email and password. These are generated sample people on reserved .example addresses.\n\n| Role | Name | Email | Password | Opens |\n|---|---|---|---|---|\n${lines.map(l => `| ${l.label} | ${l.name} | ${l.email} | ${l.password} | ${l.home} |`).join('\n')}\n` : null;
if (body) { fs.writeFileSync(file, (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') + '\n' : '') + body, { mode: 0o600 }); console.log(`Created ${lines.length} logins. Passwords are in ${file}`); }
for (const s of skipped) console.log('Skipped:', s);
