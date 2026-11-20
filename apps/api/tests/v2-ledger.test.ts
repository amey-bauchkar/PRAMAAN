import { describe, it, expect, beforeAll } from 'vitest';
import { webcrypto } from 'crypto';
import { createDemoApp, DemoApp } from '../src/v2/demo.js';
import {
  canonicalJson, leafHash, merkleRoot, verifyInclusion, verifyConsistency, verifyCheckpoint, verifyPlacementEntry, Jwk,
} from '@pramaan/domain';

const subtle = webcrypto.subtle;
async function newKey() {
  const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const j = (await subtle.exportKey('jwk', kp.publicKey)) as unknown as Jwk;
  const jwk = { kty: j.kty, crv: j.crv, x: j.x, y: j.y } as Jwk;
  const sign = async (text: string) => Buffer.from(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, Buffer.from(text))).toString('base64url');
  return { jwk, sign };
}

let demo: DemoApp;
const tokens: Record<string, string> = {};
async function call(who: string, method: 'GET' | 'POST', url: string, body?: unknown) {
  const headers: Record<string, string> = who ? { authorization: `Bearer ${tokens[who]}` } : {};
  const res = await demo.app.inject({ method, url, headers, payload: body as any });
  return { status: res.statusCode, body: res.payload ? JSON.parse(res.payload) : null };
}

describe('Placement ledger: signed offers, receipts, public verification', () => {
  let orgId = '', applicationId = '', studentSubject = '';
  const rec = { key: null as any, id: '' };
  const stu = { key: null as any, id: '' };
  let receipt: any;

  beforeAll(async () => {
    demo = await createDemoApp();
    for (const p of ['recruiter', 'tpo', 'rahul']) tokens[p] = await demo.tokenFor(p);
    orgId = (await demo.db.admin.query<any>(`SELECT o.id FROM organizations o WHERE o.name LIKE '%Sahyadri%' LIMIT 1`)).rows[0].id;
    const drives = (await call('recruiter', 'GET', '/api/v2/recruiter/drives')).body.drives;
    for (const d of drives) {
      const c = (await call('recruiter', 'GET', `/api/v2/recruiter/offers?driveId=${d.id}`)).body.find((x: any) => x.stage === 'shortlisted' && !x.offer);
      if (c) { applicationId = c.applicationId; break; }
    }
    expect(applicationId).not.toBe('');
    studentSubject = (await demo.db.admin.query<any>(`SELECT u.auth_subject FROM applications a JOIN students s ON s.id = a.student_id JOIN users u ON u.id = s.user_id WHERE a.id = $1`, [applicationId])).rows[0].auth_subject;
    tokens.candidate = await demo.tokenForSubject(studentSubject);
    rec.key = await newKey(); stu.key = await newKey();
  }, 300_000);

  it('rules and decisions published at start are already in the ledger', async () => {
    const l = (await call('tpo', 'GET', '/api/v2/tpo/ledger')).body;
    expect(l.counts.decisions_published).toBeGreaterThan(0);
    expect(l.head.size).toBe(Object.values<number>(l.counts).reduce((a, b) => a + b, 0));
  });

  it('refuses an offer without a registered key, with a wrong signature, or from the placement office', async () => {
    expect((await call('recruiter', 'POST', '/api/v2/recruiter/offers/prepare', { applicationId, ctcInr: 500000, keyId: 'abcdefgh12345678' })).status).toBe(400);
    rec.id = (await call('recruiter', 'POST', '/api/v2/recruiter/keys', { publicJwk: rec.key.jwk })).body.keyId;
    const prep = (await call('recruiter', 'POST', '/api/v2/recruiter/offers/prepare', { applicationId, ctcInr: 500000, keyId: rec.id })).body;
    const other = await newKey();
    expect((await call('recruiter', 'POST', '/api/v2/recruiter/offers', { applicationId, statement: prep.statement, signature: await other.sign(prep.canonical) })).status).toBe(400);
    expect((await call('recruiter', 'POST', '/api/v2/recruiter/offers', { applicationId, statement: { ...prep.statement, company: 'Another Company' }, signature: await rec.key.sign(canonicalJson({ ...prep.statement, company: 'Another Company' })) })).status).toBe(400);
    expect((await call('tpo', 'POST', '/api/v2/recruiter/offers/prepare', { applicationId, ctcInr: 500000, keyId: rec.id })).status).toBe(403);
  });

  it('the recruiter signs an offer and the student signs the acceptance', async () => {
    const prep = (await call('recruiter', 'POST', '/api/v2/recruiter/offers/prepare', { applicationId, ctcInr: 500000, keyId: rec.id })).body;
    const issued = await call('recruiter', 'POST', '/api/v2/recruiter/offers', { applicationId, statement: prep.statement, signature: await rec.key.sign(prep.canonical) });
    expect(issued.status).toBe(200);
    expect((await call('recruiter', 'POST', '/api/v2/recruiter/offers', { applicationId, statement: prep.statement, signature: await rec.key.sign(prep.canonical) })).status).toBe(409);

    // The old accept button must not be a way around the signature.
    expect((await call('candidate', 'POST', `/api/v2/student/offers/${applicationId}/respond`, { accept: true })).status).toBe(409);
    const offers = (await call('candidate', 'GET', '/api/v2/student/offers')).body;
    expect(offers[0]).toMatchObject({ signed: true, needsSignature: true, ctcInr: 500000 });

    stu.id = (await call('candidate', 'POST', '/api/v2/student/keys', { publicJwk: stu.key.jwk })).body.keyId;
    const prepA = (await call('candidate', 'POST', `/api/v2/student/offers/${applicationId}/accept/prepare`, { keyId: stu.id })).body;
    expect((await call('candidate', 'POST', `/api/v2/student/offers/${applicationId}/accept`, { acceptance: prepA.acceptance, signature: await (await newKey()).sign(prepA.canonical) })).status).toBe(400);
    // Another student cannot accept someone else's offer.
    expect((await call('rahul', 'POST', `/api/v2/student/offers/${applicationId}/accept/prepare`, { keyId: stu.id })).status).toBe(404);
    const done = await call('candidate', 'POST', `/api/v2/student/offers/${applicationId}/accept`, { acceptance: prepA.acceptance, signature: await stu.key.sign(prepA.canonical) });
    expect(done.status).toBe(200);
    receipt = done.body.receipt;
    expect((await call('candidate', 'POST', `/api/v2/student/offers/${applicationId}/accept`, { acceptance: prepA.acceptance, signature: await stu.key.sign(prepA.canonical) })).status).toBe(409);
  });

  it('the receipt proves the placement without asking the college', async () => {
    expect(verifyPlacementEntry(receipt.entry)).toEqual({ valid: true, problems: [] });
    expect(leafHash(receipt.entry)).toBe(receipt.leafHash);
    expect(verifyInclusion(receipt.leafHash, receipt.seq - 1, receipt.treeSize, receipt.proof, receipt.checkpoint.root)).toBe(true);
    const pub = (await call('', 'GET', `/api/public/ledger/${orgId}`)).body;
    expect(verifyCheckpoint({ origin: receipt.checkpoint.origin, size: receipt.checkpoint.size, root: receipt.checkpoint.root, at: receipt.checkpoint.at }, receipt.checkpoint.signature, pub.issuerPublicKeyPem)).toBe(true);
    // No name or student id appears anywhere in the entry.
    expect(JSON.stringify(receipt.entry)).not.toMatch(/full_name|enrollment|@/);
  });

  it('anyone can rebuild the tree from public hashes and check history only grew', async () => {
    const head = (await call('', 'GET', `/api/public/ledger/${orgId}`)).body;
    const { leaves, checkpoints } = (await call('', 'GET', `/api/public/ledger/${orgId}/leaves`)).body;
    const hashes = leaves.map((l: any) => l.leafHash);
    expect(merkleRoot(hashes.slice(0, head.checkpoint.size))).toBe(head.checkpoint.root);
    expect(checkpoints.length).toBe(hashes.length);
    const proof = (await call('', 'GET', `/api/public/ledger/${orgId}/proof?seq=${receipt.seq}`)).body;
    expect(verifyInclusion(proof.leafHash, proof.seq - 1, proof.treeSize, proof.proof, proof.root)).toBe(true);
    const c = (await call('', 'GET', `/api/public/ledger/${orgId}/consistency?from=2&to=${head.checkpoint.size}`)).body;
    expect(verifyConsistency(2, head.checkpoint.size, c.fromRoot, c.toRoot, c.proof)).toBe(true);
    // A verifier must never be served a stale log from a browser or proxy cache.
    for (const path of ['', '/leaves', '/proof?seq=1']) {
      const res = await demo.app.inject({ method: 'GET', url: `/api/public/ledger/${orgId}${path}` });
      expect(res.headers['cache-control'], path).toBe('no-store');
    }
    expect((await call('', 'GET', '/api/public/ledger/not-a-uuid')).status).toBe(400);
    expect((await call('', 'GET', '/api/public/ledger/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });

  it('the placement office sees one verified placement, and the full check passes', async () => {
    const l = (await call('tpo', 'GET', '/api/v2/tpo/ledger')).body;
    expect(l.verifiedPlacements).toBeGreaterThanOrEqual(1);
    const v = (await call('tpo', 'POST', '/api/v2/tpo/ledger/verify')).body;
    expect(v).toMatchObject({ valid: true, problems: [] });
    const a = (await call('tpo', 'POST', '/api/v2/tpo/ledger/audit', { k: 3 })).body;
    expect(a.sample.every((s: any) => s.recruiterSignatureValid && s.studentSignatureValid)).toBe(true);
    expect(a.sample[0].studentRef).toHaveLength(8);
    expect((await call('rahul', 'POST', '/api/v2/tpo/ledger/verify')).status).toBe(403);
  });

  it('catches an insider who raises a salary and recomputes the hash, and the audit shows the broken signature', async () => {
    const admin = demo.db.admin;
    const row = (await admin.query<any>(`SELECT seq, payload FROM ledger_entries WHERE org_id = $1 AND kind = 'offer_accepted' ORDER BY seq LIMIT 1`, [orgId])).rows[0];
    const forged = { ...row.payload, offer: { ...row.payload.offer, ctcInr: row.payload.offer.ctcInr * 3 } };
    // The database refuses an ordinary change.
    await expect(admin.query(`UPDATE ledger_entries SET payload = $2 WHERE org_id = $1 AND seq = $3`, [orgId, JSON.stringify(forged), row.seq])).rejects.toThrow(/append-only/);
    // An insider with superuser access switches the guard off, edits the entry and recomputes its hash.
    await admin.query(`SET session_replication_role = replica`);
    await admin.query(`UPDATE ledger_entries SET payload = $2, leaf_hash = $4 WHERE org_id = $1 AND seq = $3`, [orgId, JSON.stringify(forged), row.seq, leafHash(forged)]);
    await admin.query(`SET session_replication_role = origin`);
    const v = (await call('tpo', 'POST', '/api/v2/tpo/ledger/verify')).body;
    expect(v.valid).toBe(false);
    const text = v.problems.map((p: any) => p.text).join(' | ');
    expect(text).toMatch(/recruiter signature/);
    expect(text).toMatch(/no longer matches what the log operator signed/);
    const audit = (await call('tpo', 'POST', '/api/v2/tpo/ledger/audit', { k: 25 })).body;
    expect(audit.sample.some((s: any) => !s.recruiterSignatureValid)).toBe(true);
  });
});
