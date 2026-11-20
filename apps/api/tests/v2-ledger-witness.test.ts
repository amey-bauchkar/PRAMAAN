import { describe, it, expect, beforeAll } from 'vitest';
import { webcrypto } from 'crypto';
import { createDemoApp, DemoApp } from '../src/v2/demo.js';
import { merkleRoot, verifyCheckpoint, verifyWitnessCosignature, witnessText, Jwk } from '@pramaan/domain';

const subtle = webcrypto.subtle;
async function newKey() {
  const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const j = (await subtle.exportKey('jwk', kp.publicKey)) as unknown as Jwk;
  const sign = async (text: string) => Buffer.from(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, Buffer.from(text))).toString('base64url');
  return { jwk: { kty: j.kty, crv: j.crv, x: j.x, y: j.y } as Jwk, sign };
}

let demo: DemoApp;
const tokens: Record<string, string> = {};
async function call(who: string, method: 'GET' | 'POST', url: string, body?: unknown) {
  const res = await demo.app.inject({ method, url, headers: who ? { authorization: `Bearer ${tokens[who]}` } : {}, payload: body as any });
  return { status: res.statusCode, body: res.payload ? JSON.parse(res.payload) : null };
}

describe('University witness: a rewritten log that is signed again is still caught', () => {
  let orgId = '';
  beforeAll(async () => {
    demo = await createDemoApp();
    for (const p of ['university', 'tpo', 'tpo-poly', 'rahul']) tokens[p] = await demo.tokenFor(p);
    orgId = (await call('', 'GET', '/api/demo/ledger')).body.orgId;
  }, 300_000);

  it('the demo starts with the newest state already witnessed, and the public page can check the witness', async () => {
    const head = (await call('', 'GET', `/api/public/ledger/${orgId}`)).body;
    expect(head.witnesses.length).toBeGreaterThanOrEqual(1);
    const w = head.witnesses[head.witnesses.length - 1];
    expect(w.size).toBe(head.checkpoint.size);
    expect(w.root).toBe(head.checkpoint.root);
    expect(verifyWitnessCosignature(head.origin, { size: w.size, root: w.root, witnessKeyId: w.keyId, signature: w.signature, witnessKey: w.publicKey, at: w.at }, w.checkpointAt)).toBe(true);
    expect(verifyCheckpoint(head.checkpoint, head.checkpoint.signature, head.issuerPublicKeyPem)).toBe(true);
    const v = (await call('tpo', 'POST', '/api/v2/tpo/ledger/verify')).body;
    expect(v).toMatchObject({ valid: true, witnessed: expect.any(Number) });
    expect(v.witnessed).toBeGreaterThanOrEqual(1);
  });

  it('only the college\'s own university can witness, with a registered key and a valid signature', async () => {
    const uni = await newKey();
    expect((await call('rahul', 'POST', '/api/v2/university/witness/key', { publicJwk: uni.jwk })).status).toBe(403);
    const keyId = (await call('university', 'POST', '/api/v2/university/witness/key', { publicJwk: uni.jwk })).body.keyId;
    const list = (await call('university', 'GET', '/api/v2/university/witness')).body.colleges;
    const college = list.find((c: any) => c.collegeId === orgId);
    expect(college).toBeTruthy();
    // Nothing new yet to witness: the demo seed already witnessed the newest state.
    expect((await call('university', 'POST', '/api/v2/university/witness/prepare', { collegeId: orgId, keyId })).status).toBe(409);
    // Another university's admin has no access to this college.
    expect((await call('tpo-poly', 'POST', '/api/v2/university/witness/prepare', { collegeId: orgId, keyId })).status).toBe(403);
  });

  it('a witness signs its own time, which must be close to now, and the signature must match', async () => {
    const uni = await newKey();
    const keyId = (await call('university', 'POST', '/api/v2/university/witness/key', { publicJwk: uni.jwk })).body.keyId;
    // Make a new entry so there is something new to witness: publish a drive's decisions.
    const drives = (await call('tpo', 'GET', '/api/v2/tpo/drives')).body.drives;
    const drive = drives.find((d: any) => d.published) ?? drives[0];
    expect((await call('tpo', 'POST', `/api/v2/tpo/drives/${drive.id}/decisions/publish`)).status).toBe(200);
    const prep = (await call('university', 'POST', '/api/v2/university/witness/prepare', { collegeId: orgId, keyId })).body;
    const cp = prep.checkpoint;
    const body = (at: string, sign = uni.sign) => async () => ({ collegeId: orgId, size: cp.size, root: cp.root, keyId, at, signature: await sign(witnessText(cp, keyId, at)) });
    const old = new Date(Date.now() - 3600_000).toISOString();
    expect((await call('university', 'POST', '/api/v2/university/witness/cosign', await body(old)())).status).toBe(400);   // time too far from now
    const other = await newKey();
    expect((await call('university', 'POST', '/api/v2/university/witness/cosign', await body(new Date().toISOString(), other.sign)())).status).toBe(400); // wrong key
    const ok = await call('university', 'POST', '/api/v2/university/witness/cosign', await body(new Date().toISOString())());
    expect(ok.status).toBe(200);
    const head = (await call('', 'GET', `/api/public/ledger/${orgId}`)).body;
    const w = head.witnesses.find((x: any) => x.keyId === keyId);
    expect(w.size).toBe(cp.size);
    expect(verifyWitnessCosignature(head.origin, { size: w.size, root: w.root, witnessKeyId: w.keyId, signature: w.signature, witnessKey: w.publicKey, at: w.at }, w.checkpointAt)).toBe(true);
    // The witnessed time is part of what was signed: moving it breaks the signature.
    expect(verifyWitnessCosignature(head.origin, { size: w.size, root: w.root, witnessKeyId: w.keyId, signature: w.signature, witnessKey: w.publicKey, at: new Date(Date.parse(w.at) + 1000).toISOString() }, w.checkpointAt)).toBe(false);
  });

  it('the witnessing university can audit a sample with its own seed, and anyone with the seed and root gets the same sample', async () => {
    const run = async (seed: string) => (await call('university', 'POST', '/api/v2/university/witness/audit', { collegeId: orgId, seed, k: 4 })).body;
    const a = await run('auditor-seed-1'), b = await run('auditor-seed-1'), c = await run('auditor-seed-2');
    expect(a.sample.length).toBe(4);
    expect(a.sample.map((s: any) => s.seq)).toEqual(b.sample.map((s: any) => s.seq));
    expect(a.sample.every((s: any) => s.recruiterSignatureValid && s.studentSignatureValid)).toBe(true);
    expect(a.sample[0].recruiterKeyRegisteredAt).not.toBeNull();
    expect(a.seed).toBe('auditor-seed-1');
    expect(a.treeRoot).toBeTruthy();
    expect(c.seed).toBe('auditor-seed-2');
    expect((await call('tpo', 'POST', '/api/v2/university/witness/audit', { collegeId: orgId })).status).toBe(403);
    expect((await call('tpo', 'POST', '/api/v2/tpo/ledger/audit', { k: 3, seed: 'x' })).body.seed).toBe('x');
  });

  it('catches a log operator that rewrites a committed batch of decisions and signs every checkpoint again', async () => {
    const before = (await call('tpo', 'POST', '/api/v2/tpo/ledger/verify')).body;
    expect(before.valid).toBe(true);

    expect((await call('', 'POST', '/api/demo/ledger/rewrite')).body.rewritten).toBe(true);

    // The college's own checks pass: every hash, root and college signature was recomputed.
    const head = (await call('', 'GET', `/api/public/ledger/${orgId}`)).body;
    const { leaves } = (await call('', 'GET', `/api/public/ledger/${orgId}/leaves`)).body;
    expect(merkleRoot(leaves.slice(0, head.checkpoint.size).map((l: any) => l.leafHash))).toBe(head.checkpoint.root);
    expect(verifyCheckpoint(head.checkpoint, head.checkpoint.signature, head.issuerPublicKeyPem)).toBe(true);

    // The university's earlier signature does not match the rewritten history.
    const w = head.witnesses[head.witnesses.length - 1];
    expect(merkleRoot(leaves.slice(0, w.size).map((l: any) => l.leafHash))).not.toBe(w.root);

    const after = (await call('tpo', 'POST', '/api/v2/tpo/ledger/verify')).body;
    expect(after.valid).toBe(false);
    const text = after.problems.map((p: any) => p.text).join(' | ');
    expect(text).toMatch(/witnessed a different history/);
    expect(text).not.toMatch(/recruiter signature/);

    expect((await call('', 'POST', '/api/demo/ledger/restore')).body.restored).toBe(true);
    expect((await call('tpo', 'POST', '/api/v2/tpo/ledger/verify')).body.valid).toBe(true);
  });
});
