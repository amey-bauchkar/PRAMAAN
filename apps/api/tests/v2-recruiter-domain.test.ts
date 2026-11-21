import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPairSync } from 'crypto';
import { createDemoApp, DemoApp } from '../src/v2/demo.js';
import { normaliseDomain, isPublicAddress, proofText } from '../src/v2/domain-proof.js';

let demo: DemoApp;
const call = async (persona: string, method: 'GET' | 'POST', url: string, payload?: unknown) => {
  const res = await demo.app.inject({ method, url, headers: { authorization: `Bearer ${await demo.tokenFor(persona)}` }, payload: payload as any });
  return { status: res.statusCode, body: res.payload ? JSON.parse(res.payload) : null };
};
const jwk = () => { const j = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ format: 'jwk' }) as any; return { kty: 'EC', crv: 'P-256', x: j.x, y: j.y }; };

describe('Recruiter domain proof', () => {
  beforeAll(async () => { demo = await createDemoApp(); }, 300_000);

  it('accepts public host names only and never private addresses', () => {
    expect(normaliseDomain(' Example.COM. ')).toBe('example.com');
    for (const bad of ['localhost', '127.0.0.1', '10.0.0.5', 'example', 'a_b.com', 'x.internal', 'http://example.com', '', null, 42]) expect(normaliseDomain(bad)).toBeNull();
    for (const a of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1']) expect(isPublicAddress(a)).toBe(false);
    for (const a of ['8.8.8.8', '2606:4700:4700::1111']) expect(isPublicAddress(a)).toBe(true);
  });

  it('a recruiter claims a domain, reads the proof line, and is verified only when the file holds it', async () => {
    const key = jwk();
    const reg = await call('recruiter', 'POST', '/api/v2/recruiter/keys', { publicJwk: key });
    expect(reg.status).toBe(200);
    const keyId = reg.body.keyId;

    expect((await call('recruiter', 'POST', '/api/v2/recruiter/keys/domain', { keyId, domain: 'localhost' })).status).toBe(400);
    expect((await call('recruiter', 'POST', '/api/v2/recruiter/keys/domain', { keyId: 'nope', domain: 'acme.example' })).status).toBe(400);
    expect((await call('recruiter', 'POST', '/api/v2/recruiter/keys/domain/verify', { keyId })).status).toBe(400); // no claim yet

    const claim = await call('recruiter', 'POST', '/api/v2/recruiter/keys/domain', { keyId, domain: 'Acme-Corp.example' });
    expect(claim.status).toBe(200);
    expect(claim.body.url).toBe('https://acme-corp.example/.well-known/pramaan-recruiter.txt');
    expect(claim.body.content).toMatch(new RegExp(`^pramaan-recruiter-key=${keyId} challenge=[0-9a-f]{24}$`));

    const listed = (await call('recruiter', 'GET', '/api/v2/recruiter/keys')).body.find((k: any) => k.keyId === keyId);
    expect(listed.verifiedAt).toBeNull();
    expect(listed.proof.content).toBe(claim.body.content);

    // A domain the offline demo cannot read fails and stays unverified.
    await call('recruiter', 'POST', '/api/v2/recruiter/keys/domain', { keyId, domain: 'acme-corp.com' });
    expect((await call('recruiter', 'POST', '/api/v2/recruiter/keys/domain/verify', { keyId })).status).toBe(422);

    await call('recruiter', 'POST', '/api/v2/recruiter/keys/domain', { keyId, domain: 'acme-corp.example' });
    const ok = await call('recruiter', 'POST', '/api/v2/recruiter/keys/domain/verify', { keyId });
    expect(ok.status).toBe(200);
    const after = (await call('recruiter', 'GET', '/api/v2/recruiter/keys')).body.find((k: any) => k.keyId === keyId);
    expect(after.domain).toBe('acme-corp.example');
    expect(after.verifiedAt).not.toBeNull();
    expect(after.proof).toBeNull();

    // Choosing another domain withdraws the verification until it is proved again.
    await call('recruiter', 'POST', '/api/v2/recruiter/keys/domain', { keyId, domain: 'other.example' });
    expect((await call('recruiter', 'GET', '/api/v2/recruiter/keys')).body.find((k: any) => k.keyId === keyId).verifiedAt).toBeNull();
  });

  it('only recruiters can use it, and the audit sample shows the verified domain', async () => {
    expect((await call('rahul', 'POST', '/api/v2/recruiter/keys/domain', { keyId: 'x', domain: 'acme.example' })).status).toBe(403);
    const audit = await call('tpo', 'POST', '/api/v2/tpo/ledger/audit', { k: 5, seed: 'domain-test' });
    expect(audit.status).toBe(200);
    expect(audit.body.sample.length).toBeGreaterThan(0);
    expect(audit.body.sample.every((s: any) => s.recruiterDomain === 'medisys-health.example')).toBe(true);
    expect(proofText('k', 'c')).toBe('pramaan-recruiter-key=k challenge=c');
  });
});
