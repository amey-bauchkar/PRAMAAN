import { describe, it, expect, beforeAll } from 'vitest';
import { createHash, randomUUID } from 'crypto';
import { createDemoApp, DemoApp } from '../src/v2/demo.js';
import { signalsFromFiles } from '../src/v2/github-evidence.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('signalsFromFiles', () => {
  it('maps extensions to skills, counts non-blank lines and ignores vendored folders', () => {
    const f = (path: string, text: string) => ({ path, rawFileHash: sha(path + text), bytes: Buffer.from(text), repo: 'me/app' });
    const s = signalsFromFiles([f('src/a.py', 'x=1\n\ny=2\n'), f('src/b.py', 'z=3\n'), f('node_modules/lib/i.js', 'x'), f('Dockerfile', 'FROM node\n'), f('README.md', '# hi')], sha);
    expect(s.map(x => x.skillSlug).sort()).toEqual(['docker', 'python']);
    expect(s.find(x => x.skillSlug === 'python')).toMatchObject({ files: 2, lines: 3 });
  });
});

describe('Imported code becomes evidence (ST-02)', () => {
  let demo: DemoApp; let token: string;
  const call = async (method: 'GET' | 'POST', url: string) => {
    const res = await demo.app.inject({ method, url, headers: { authorization: `Bearer ${token}` } });
    return { status: res.statusCode, body: JSON.parse(res.payload) };
  };
  beforeAll(async () => { demo = await createDemoApp(); token = await demo.tokenFor('rahul'); }, 300_000);

  it('adds evidence-linked skills from snapshots, once, and refuses without consent or after quarantine', async () => {
    const admin = demo.db.admin;
    const st = (await admin.query<any>(`SELECT s.id, s.org_id FROM students s JOIN users u ON u.id = s.user_id WHERE u.auth_subject = 'demo|student:cse:0'`)).rows[0];
    const grant = (await admin.query<any>(`SELECT id FROM consent_grants WHERE student_id = $1 AND purpose = 'repo_verification' AND revoked_at IS NULL`, [st.id])).rows[0];
    const repo = (await admin.query<any>(`INSERT INTO repositories (student_id, provider_repo_id, url, consent_grant_id) VALUES ($1,$2,'https://github.com/rahul/canteen-go',$3) RETURNING id`, [st.id, randomUUID(), grant.id])).rows[0];
    const code = 'package main\n\nfunc main() {}\n';
    await admin.query(`INSERT INTO source_snapshots (snapshot_id, org_id, student_id, repository_id, commit_sha, file_path, raw_bytes, raw_file_hash, blob_sha, ingestion_id, registration_state)
      VALUES ($1,$2,$3,$4,$5,'cmd/main.go',$6,$7,$8,$9,'audit_committed')`, [randomUUID(), st.org_id, st.id, repo.id, 'a'.repeat(40), Buffer.from(code), sha(code), 'b'.repeat(40), randomUUID()]);

    const sum = await call('GET', '/api/v2/student/github/summary');
    expect(sum.body.signals.map((s: any) => s.skillSlug)).toContain('go');
    const add = await call('POST', '/api/v2/student/github/evidence');
    expect(add.status).toBe(200);
    expect(add.body.added).toBe(1);
    expect(add.body.skills[0]).toMatchObject({ state: 'evidence_linked' });
    expect((await call('POST', '/api/v2/student/github/evidence')).body.added).toBe(0); // not added twice

    await call('POST', '/api/v2/student/consents').catch(() => null);
    const res = await demo.app.inject({ method: 'POST', url: '/api/v2/student/consents', headers: { authorization: `Bearer ${token}` }, payload: { purpose: 'repo_verification', action: 'revoke' } });
    expect(res.statusCode).toBe(200);
    expect((await call('POST', '/api/v2/student/github/evidence')).status).toBe(403);
    expect((await call('GET', '/api/v2/student/github/summary')).body.files).toBe(0); // snapshots are quarantined
  });
});
