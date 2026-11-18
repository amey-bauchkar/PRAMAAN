import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { createDemoApp, DemoApp } from '../src/v2/demo.js';

/** Withdrawing repository consent through the screen the student uses (the v2 route) must clean up everything. */
let demo: DemoApp;
let token: string;
const call = async (method: 'GET' | 'POST', url: string, body?: unknown) => {
  const res = await demo.app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload: body as any });
  return { status: res.statusCode, body: res.payload ? JSON.parse(res.payload) : null };
};

describe('Consent withdrawal (BR-13, ST-08)', () => {
  beforeAll(async () => { demo = await createDemoApp(); token = await demo.tokenFor('rahul'); }, 300_000);

  it('demotes skills, stops running ingestion jobs and does not touch other students', async () => {
    const admin = demo.db.admin;
    const st = (await admin.query<any>(`SELECT s.id, s.org_id FROM students s JOIN users u ON u.id = s.user_id WHERE u.auth_subject = 'demo|student:cse:0'`)).rows[0];
    const other = (await admin.query<any>(`SELECT s.id FROM students s WHERE s.org_id = $1 AND s.id <> $2 LIMIT 1`, [st.org_id, st.id])).rows[0];
    const grant = (await admin.query<any>(`SELECT id FROM consent_grants WHERE student_id = $1 AND purpose = 'repo_verification' AND revoked_at IS NULL`, [st.id])).rows[0];
    const addJob = async (studentId: string, status: string) => {
      const repo = (await admin.query<any>(`INSERT INTO repositories (student_id, provider_repo_id, url, consent_grant_id) VALUES ($1,$2,'https://github.example/x',$3) RETURNING id`, [studentId, randomUUID(), grant.id])).rows[0];
      return (await admin.query<any>(`INSERT INTO ingestion_jobs (ingestion_id, org_id, student_id, repository_id, owner, repo, status) VALUES ($1,$2,$3,$4,'o','r',$5) RETURNING id`, [randomUUID(), st.org_id, studentId, repo.id, status])).rows[0].id;
    };
    const mine = await addJob(st.id, 'fetching');
    const done = await addJob(st.id, 'completed');
    const theirs = await addJob(other.id, 'fetching');

    const r = await call('POST', '/api/v2/student/consents', { purpose: 'repo_verification', action: 'revoke' });
    expect(r.status).toBe(200);
    expect(r.body.active).toBe(false);

    const state = async (id: string) => (await admin.query<any>(`SELECT status, error FROM ingestion_jobs WHERE id = $1`, [id])).rows[0];
    expect(await state(mine)).toMatchObject({ status: 'failed', error: 'CONSENT_REVOKED' });
    expect((await state(done)).status).toBe('completed');   // history is kept
    expect((await state(theirs)).status).toBe('fetching');  // other students are untouched
  });
});
