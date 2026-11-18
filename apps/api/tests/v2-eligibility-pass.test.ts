import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPairSync } from 'crypto';
import { presentSdJwt } from '@pramaan/domain';
import { createDemoApp, DemoApp } from '../src/v2/demo.js';

/** Privacy-preserving Eligibility Pass (SD-JWT, RFC 9901) through the real API on the demo database. */
let demo: DemoApp;
let token: string;
let driveId: string;
const holder = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const holderJwk = holder.publicKey.export({ format: 'jwk' });

const post = (url: string, body: unknown, auth?: string) =>
  demo.app.inject({ method: 'POST', url, payload: body as any, headers: auth ? { authorization: `Bearer ${auth}` } : {} }).then(r => ({ status: r.statusCode, body: JSON.parse(r.payload) }));

beforeAll(async () => {
  demo = await createDemoApp();
  const row = (await demo.db.admin.query<any>(`SELECT u.auth_subject, ed.drive_id FROM eligibility_decisions ed JOIN students s ON s.id = ed.student_id JOIN users u ON u.id = s.user_id
    JOIN drives d ON d.id = ed.drive_id WHERE ed.result = 'eligible' AND ed.status = 'published' AND d.title LIKE '%Backend Developer' LIMIT 1`)).rows[0];
  token = await demo.tokenForSubject(row.auth_subject);
  driveId = row.drive_id;
}, 300_000);

async function freshPresentation(sdJwt: string, reveal: string[]) {
  const req = await post('/api/public/pass-requests', { verifier: 'Nimbus Analytics' });
  return presentSdJwt(sdJwt, reveal, { holderPrivateKey: holder.privateKey, aud: req.body.audience, nonce: req.body.nonce });
}

describe('Eligibility Pass', () => {
  let sdJwt = '';
  let passId = '';

  it('issues a pass of signed predicates bound to the student\'s key, with no category, gender or date of birth', async () => {
    const r = await post('/api/v2/student/passes', { driveId, holderJwk }, token);
    expect(r.status).toBe(200);
    sdJwt = r.body.sdJwt; passId = r.body.id;
    expect(Object.keys(r.body.predicates)).toEqual(expect.arrayContaining(['meets_min_cgpa', 'skill_sql']));
    expect(r.body.predicates.meets_min_cgpa).toMatch(/^CGPA ≥ /);
    const everything = Buffer.from(sdJwt.split('~').slice(1).join(''), 'base64url').toString();
    expect(everything).not.toMatch(/gender|category|date_of_birth|Female|Male|OBC/);
  });

  it('a verifier sees only what the student chose, and nothing else is readable', async () => {
    const p = await freshPresentation(sdJwt, ['meets_min_cgpa', 'skill_sql']);
    const v = await post('/api/public/passes/verify', { presentation: p });
    expect(v.body.errors).toEqual([]);
    expect(v.body.valid).toBe(true);
    expect(v.body.keyBound).toBe(true);
    expect(v.body.visible).toMatchObject({ eligible: true, drive: 'Backend Developer' });
    expect(Object.keys(v.body.disclosed).sort()).toEqual(['meets_min_cgpa', 'skill_sql']);
    expect(v.body.disclosed).not.toHaveProperty('cgpa');
    expect(p).not.toMatch(/"cgpa",\s*\d/);
  });

  it('the same presentation cannot be replayed', async () => {
    const p = await freshPresentation(sdJwt, ['name']);
    expect((await post('/api/public/passes/verify', { presentation: p })).body.valid).toBe(true);
    const again = await post('/api/public/passes/verify', { presentation: p });
    expect(again.body.valid).toBe(false);
    expect(again.body.errors.join(' ')).toMatch(/already used/);
  });

  it('someone without the student\'s device key cannot present the pass', async () => {
    const thief = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const req = await post('/api/public/pass-requests', { verifier: 'Nimbus Analytics' });
    const p = presentSdJwt(sdJwt, ['name'], { holderPrivateKey: thief.privateKey, aud: req.body.audience, nonce: req.body.nonce });
    const v = await post('/api/public/passes/verify', { presentation: p });
    expect(v.body.valid).toBe(false);
    expect(v.body.errors.join(' ')).toMatch(/Holder signature is invalid/);
  });

  it('a revoked pass fails verification', async () => {
    expect((await post(`/api/v2/student/passes/${passId}/revoke`, {}, token)).status).toBe(200);
    const v = await post('/api/public/passes/verify', { presentation: await freshPresentation(sdJwt, ['name']) });
    expect(v.body.valid).toBe(false);
    expect(v.body.errors.join(' ')).toMatch(/revoked/);
  });

  it('cannot be issued for a drive the student is not eligible for', async () => {
    const other = (await demo.db.admin.query<any>(`SELECT d.id FROM drives d WHERE d.title LIKE '%Design Engineer%'`)).rows[0].id;
    const r = await post('/api/v2/student/passes', { driveId: other, holderJwk }, token);
    expect([404, 409]).toContain(r.status);
  });
});
