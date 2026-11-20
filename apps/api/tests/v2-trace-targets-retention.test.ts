import { describe, it, expect, beforeAll } from 'vitest';
import { createHash, randomUUID } from 'crypto';
import { createDemoApp, DemoApp } from '../src/v2/demo.js';

let demo: DemoApp;
const tokens: Record<string, string> = {};
const call = async (who: string, method: 'GET' | 'POST', url: string, body?: unknown) => {
  const res = await demo.app.inject({ method, url, headers: { authorization: `Bearer ${tokens[who]}` }, payload: body as any });
  return { status: res.statusCode, body: res.payload ? JSON.parse(res.payload) : null };
};

describe('Decision to evidence (BR-12)', () => {
  beforeAll(async () => { demo = await createDemoApp(); for (const p of ['rahul', 'tpo']) tokens[p] = await demo.tokenFor(p); }, 300_000);

  it('links a decision to its rule version, input fingerprint, skill state and evidence', async () => {
    const drives = (await call('rahul', 'GET', '/api/v2/student/drives')).body.drives;
    const d = drives.find((x: any) => x.title === 'Backend Developer');
    const t = (await call('rahul', 'GET', `/api/v2/student/decisions/${d.decision.id}/trace`)).body;
    expect(t.rules.version).toBeGreaterThanOrEqual(1);
    expect(t.decision.inputHash).toHaveLength(16);
    const skillChecks = t.checks.filter((c: any) => c.skill);
    expect(skillChecks.length).toBeGreaterThan(0);
    expect(skillChecks.some((c: any) => c.skill.evidence.length > 0)).toBe(true);
    expect((await call('tpo', 'GET', `/api/v2/student/decisions/${d.decision.id}/trace`)).status).toBe(403);
  });
});

describe('Saved target roles (ST-04)', () => {
  it('saves and removes a role and shows saved roles first', async () => {
    const list = (await call('rahul', 'GET', '/api/v2/student/targets')).body;
    const last = list[list.length - 1];
    expect(last.saved).toBe(false);
    expect((await call('rahul', 'POST', `/api/v2/student/targets/${last.roleId}/toggle`)).body.saved).toBe(true);
    expect((await call('rahul', 'GET', '/api/v2/student/targets')).body[0]).toMatchObject({ roleId: last.roleId, saved: true });
    expect((await call('rahul', 'POST', `/api/v2/student/targets/${last.roleId}/toggle`)).body.saved).toBe(false);
  });
});

describe('Retention purge (DPDP)', () => {
  it('deletes imported code only after the retention period has passed since consent ended', async () => {
    const admin = demo.db.admin;
    const st = (await admin.query<any>(`SELECT s.id, s.org_id FROM students s JOIN users u ON u.id = s.user_id WHERE u.auth_subject = 'demo|student:cse:0'`)).rows[0];
    const grant = (await admin.query<any>(`SELECT id FROM consent_grants WHERE student_id = $1 AND purpose = 'repo_verification' AND revoked_at IS NULL`, [st.id])).rows[0];
    const repo = (await admin.query<any>(`INSERT INTO repositories (student_id, provider_repo_id, url, consent_grant_id) VALUES ($1,$2,'https://github.com/rahul/x',$3) RETURNING id`, [st.id, randomUUID(), grant.id])).rows[0];
    const code = 'print(1)\n';
    await admin.query(`INSERT INTO source_snapshots (snapshot_id, org_id, student_id, repository_id, commit_sha, file_path, raw_bytes, raw_file_hash, blob_sha, ingestion_id, registration_state)
      VALUES ($1,$2,$3,$4,$5,'a.py',$6,$7,$8,$9,'audit_committed')`, [randomUUID(), st.org_id, st.id, repo.id, 'a'.repeat(40), Buffer.from(code), createHash('sha256').update(code).digest('hex'), 'b'.repeat(40), randomUUID()]);
    const count = async () => Number((await admin.query<any>(`SELECT count(*)::int AS n FROM source_snapshots WHERE student_id = $1`, [st.id])).rows[0].n);

    expect((await call('tpo', 'POST', '/api/v2/tpo/retention/run')).body.snapshotsDeleted).toBe(0); // consent still active
    expect((await call('rahul', 'POST', '/api/v2/tpo/retention/run')).status).toBe(403);
    await call('rahul', 'POST', '/api/v2/student/consents', { purpose: 'repo_verification', action: 'revoke' });
    expect((await call('tpo', 'POST', '/api/v2/tpo/retention/run')).body.snapshotsDeleted).toBe(0); // withdrawn today, inside the period
    expect(await count()).toBe(1);
    await admin.query(`UPDATE consent_grants SET revoked_at = now() - interval '400 days' WHERE student_id = $1 AND purpose = 'repo_verification'`, [st.id]);
    const run = await call('tpo', 'POST', '/api/v2/tpo/retention/run');
    expect(run.body.snapshotsDeleted).toBe(1);
    expect(await count()).toBe(0);
  });
});
