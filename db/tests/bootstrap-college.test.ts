import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createHash } from 'crypto';
import { createMigratedDb } from './helpers/pglite-db.js';
import { bootstrapCollege } from '../../scripts/bootstrap-college.mjs';

let db: PGlite;
beforeAll(async () => { db = await createMigratedDb(); }, 120_000);

const tokenOf = (url: string) => url.split('#t=')[1];
const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const opts = { collegeName: 'Bootstrap Test College', departments: [{ code: 'cse', name: 'Computer Engineering' }, { code: 'it', name: 'Information Technology' }], adminName: 'Priya Sharma', adminEmail: 'Priya@Bootstrap.test', webUrl: 'https://pramaan.test/' };

describe('bootstrap-college', () => {
  it('creates a college, departments and a one-time admin link that makes a real college admin', async () => {
    const r = await bootstrapCollege(db, opts);
    expect(Object.keys(r.departmentIds).sort()).toEqual(['CSE', 'IT']);
    expect(r.adminInvite!.claimUrl).toMatch(/^https:\/\/pramaan\.test\/claim#t=[A-Za-z0-9_-]{40,}$/);
    const stored = (await db.query<any>(`SELECT token_hash, email, role FROM pending_invites WHERE id = $1`, [r.adminInvite!.id])).rows[0];
    expect(stored).toMatchObject({ email: 'priya@bootstrap.test', role: 'college_admin' });
    expect(stored.token_hash).toBe(hash(tokenOf(r.adminInvite!.claimUrl)));

    const claimed = (await db.query<any>(`SELECT * FROM claim_invitation($1,$2,$3,$4)`, [stored.token_hash, 'supabase|admin-1', 'priya@bootstrap.test', 'email'])).rows[0];
    expect(claimed).toMatchObject({ out_org_id: r.orgId, out_role: 'college_admin' });
    const m = (await db.query<any>(`SELECT role, status FROM memberships WHERE user_id = $1 AND org_id = $2`, [claimed.out_user_id, r.orgId])).rows;
    expect(m).toEqual([{ role: 'college_admin', status: 'active' }]);
    await expect(db.query(`SELECT * FROM claim_invitation($1,$2,$3,$4)`, [stored.token_hash, 'supabase|admin-2', 'priya@bootstrap.test', 'email'])).rejects.toThrow(/INVITE_USED/);
  });

  it('is safe to run again: it reuses the college and only the newest link works', async () => {
    const a = await bootstrapCollege(db, { ...opts, collegeName: 'Second College', adminEmail: 'a@second.test' });
    const b = await bootstrapCollege(db, { ...opts, collegeName: 'Second College', adminEmail: 'a@second.test' });
    expect(b.reusedCollege).toBe(true);
    expect(b.orgId).toBe(a.orgId);
    expect((await db.query<any>(`SELECT count(*)::int AS n FROM departments WHERE org_id = $1`, [a.orgId])).rows[0].n).toBe(2);
    await expect(db.query(`SELECT * FROM claim_invitation($1,$2,$3,$4)`, [hash(tokenOf(a.adminInvite!.claimUrl)), 'supabase|x', 'a@second.test', 'email'])).rejects.toThrow(/INVITE_REVOKED/);
    expect((await db.query<any>(`SELECT * FROM claim_invitation($1,$2,$3,$4)`, [hash(tokenOf(b.adminInvite!.claimUrl)), 'supabase|x', 'a@second.test', 'email'])).rows[0].out_role).toBe('college_admin');
  });

  it('can create a college first and invite its admin later', async () => {
    const a = await bootstrapCollege(db, { collegeName: 'Admin Later College', departments: [{ code: 'cse', name: 'Computer Engineering' }] });
    expect(a.adminInvite).toBeNull();
    const b = await bootstrapCollege(db, { collegeName: 'Admin Later College', departments: [{ code: 'cse', name: 'Computer Engineering' }], adminName: 'Late Admin', adminEmail: 'late@later.test' });
    expect(b.reusedCollege).toBe(true);
    expect(b.adminInvite?.claimUrl).toMatch(/\/claim#t=/);
  });

  it('refuses bad input', async () => {
    await expect(bootstrapCollege(db, { ...opts, adminEmail: 'nope' })).rejects.toThrow(/valid admin email/);
    await expect(bootstrapCollege(db, { ...opts, departments: [] })).rejects.toThrow(/department/i);
    await expect(bootstrapCollege(db, { ...opts, departments: [{ code: 'bad code!', name: 'X' }] })).rejects.toThrow(/not valid/);
    await expect(bootstrapCollege(db, { ...opts, collegeName: 'x' })).rejects.toThrow(/college name/);
  });
});
