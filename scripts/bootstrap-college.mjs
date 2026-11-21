#!/usr/bin/env node
/**
 * Creates a college, its departments and the invitation for its first college admin. This replaces editing the database by hand.
 * It prints the admin's claim link ONCE: only a hash of the token is stored.
 *
 *   node scripts/bootstrap-college.mjs --college "Apex College of Engineering" \
 *     --departments "CSE:Computer Engineering,IT:Information Technology" \
 *     --admin-name "Priya Sharma" --admin-email priya@apex.edu [--parent <university id>] [--web-url https://pramaan.example]
 *
 * Needs DATABASE_URL_ADMIN (the same administrative connection the migrations use).
 */
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const EMAIL = /^[^@\s]{1,100}@[^@\s]+\.[^@\s]{2,}$/;

/**
 * @param q anything with query(text, params): a pg client inside a transaction, or PGlite.
 * Safe to run twice: an existing college of the same name is reused, departments are added if missing, and any older waiting
 * invitation for the same admin is cancelled so only the newest link works.
 */
export async function bootstrapCollege(q, { collegeName, departments, adminName, adminEmail, parentId = null, webUrl = 'http://localhost:3000', inviteDays = 14 }) {
  const email = String(adminEmail ?? '').trim().toLowerCase();
  const withAdmin = email !== '' || !!adminName;
  if (!collegeName || String(collegeName).trim().length < 3) throw new Error('A college name of at least 3 characters is required.');
  // The admin is optional: a college can be created first and its admin invited later by running this again with the admin's details.
  if (withAdmin && !EMAIL.test(email)) throw new Error('A valid admin email is required.');
  if (withAdmin && (!adminName || String(adminName).trim().length < 2)) throw new Error('The admin name is required.');
  if (!Array.isArray(departments) || departments.length === 0) throw new Error('At least one department (CODE:Name) is required.');

  const existing = (await q.query(`SELECT id FROM organizations WHERE kind = 'college' AND name = $1`, [collegeName.trim()])).rows[0];
  const orgId = existing?.id ?? (await q.query(`INSERT INTO organizations (kind, name, parent_id) VALUES ('college', $1, $2) RETURNING id`, [collegeName.trim(), parentId])).rows[0].id;

  const departmentIds = {};
  for (const d of departments) {
    if (!/^[A-Za-z0-9_-]{1,20}$/.test(d.code) || !d.name) throw new Error(`Department "${d.code}:${d.name}" is not valid. Use CODE:Name, with a short code.`);
    await q.query(`INSERT INTO departments (org_id, name, code) VALUES ($1,$2,$3) ON CONFLICT (org_id, code) DO NOTHING`, [orgId, d.name, d.code.toUpperCase()]);
    departmentIds[d.code.toUpperCase()] = (await q.query(`SELECT id FROM departments WHERE org_id = $1 AND code = $2`, [orgId, d.code.toUpperCase()])).rows[0].id;
  }

  if (!withAdmin) return { orgId, reusedCollege: !!existing, departmentIds, adminInvite: null };
  await q.query(`UPDATE pending_invites SET status = 'revoked' WHERE org_id = $1 AND lower(email) = $2 AND role = 'college_admin' AND status = 'pending'`, [orgId, email]);
  const token = crypto.randomBytes(32).toString('base64url');
  const inv = (await q.query(`INSERT INTO pending_invites (org_id, email, full_name, role, token_hash, expires_at)
    VALUES ($1,$2,$3,'college_admin',$4, now() + ($5 * interval '1 day')) RETURNING id`, [orgId, email, adminName.trim(), sha256(token), inviteDays])).rows[0];
  return { orgId, reusedCollege: !!existing, departmentIds, adminInvite: { id: inv.id, email, claimUrl: `${webUrl.replace(/\/$/, '')}/claim#t=${token}` } };
}

function arg(name) { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : undefined; }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile?.(); } catch { /* no .env file */ }
  const url = process.env.DATABASE_URL_ADMIN;
  if (!url) { console.error('DATABASE_URL_ADMIN is not set. This script needs the administrative database connection.'); process.exit(1); }
  const { default: pg } = await import('pg');
  const { resolveAdminSslConfig } = await import('./admin-db-ssl.mjs');
  const client = new pg.Client({ connectionString: url, ssl: resolveAdminSslConfig(url) });
  try {
    const departments = String(arg('departments') ?? '').split(',').map(x => x.trim()).filter(Boolean).map(x => { const [code, ...n] = x.split(':'); return { code: code.trim(), name: n.join(':').trim() }; });
    await client.connect();
    await client.query('BEGIN');
    const out = await bootstrapCollege(client, {
      collegeName: arg('college'), departments, adminName: arg('admin-name'), adminEmail: arg('admin-email'),
      parentId: arg('parent') ?? null, webUrl: arg('web-url') ?? process.env.PRAMAAN_WEB_URL ?? 'http://localhost:3000',
    });
    await client.query('COMMIT');
    console.log(`${out.reusedCollege ? 'Using the existing' : 'Created the'} college ${out.orgId} with departments: ${Object.keys(out.departmentIds).join(', ')}`);
    if (out.adminInvite) console.log(`\nInvitation for ${out.adminInvite.email} (college admin). Send them this link. It works once, expires in 14 days, and is not shown again:\n\n  ${out.adminInvite.claimUrl}\n`);
    else console.log('\nNo admin was invited. Run this again with --admin-name and --admin-email to invite one.');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* not connected */ }
    console.error(`Bootstrap failed: ${e.message}`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}
