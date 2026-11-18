import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'crypto';
import { issueSdJwt, presentSdJwt, verifySdJwt, makeDisclosure, PublicJwk } from '../src/sd-jwt.js';
import { issuerKeyFromSeed } from '../src/credentials.js';

const { privateKey, publicKeyPem } = issuerKeyFromSeed('22'.repeat(32));
const holder = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const holderJwk = holder.publicKey.export({ format: 'jwk' }) as unknown as PublicJwk;
const NOW = 1_800_000_000;

function pass() {
  return issueSdJwt({
    issuer: 'urn:pramaan:issuer:college-a', kid: 'k1', privateKey, vct: 'urn:pramaan:eligibility-pass:1', holderJwk, iat: NOW, exp: NOW + 86_400,
    visible: { drive: 'Backend Developer · Nimbus', eligible: true, rule_version: 3 },
    selective: { name: 'Rahul Deshmukh', branch: 'CSE', cgpa_at_least_7_5: true, no_active_backlogs: true, sql_proof: 'L2_assessed', cgpa: 7.8 },
  });
}

describe('SD-JWT (RFC 9901) Eligibility Pass', () => {
  it('verifies a presentation that reveals only the chosen claims, with hidden ones counted but unreadable', () => {
    const { sdJwt } = pass();
    const p = presentSdJwt(sdJwt, ['cgpa_at_least_7_5', 'no_active_backlogs'], { holderPrivateKey: holder.privateKey, aud: 'recruiter-nimbus', nonce: 'n-123', iat: NOW });
    const r = verifySdJwt(p, { issuerPublicKeyPem: publicKeyPem, expectedAud: 'recruiter-nimbus', expectedNonce: 'n-123', requireKeyBinding: true, now: NOW + 5 });
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
    expect(r.keyBound).toBe(true);
    expect(r.visible).toMatchObject({ drive: 'Backend Developer · Nimbus', eligible: true });
    expect(r.disclosed).toEqual({ cgpa_at_least_7_5: true, no_active_backlogs: true });
    expect(r.disclosed).not.toHaveProperty('cgpa');
    expect(r.hiddenCount).toBeGreaterThanOrEqual(4 + 3);  // 4 undisclosed claims + decoys
    expect(p).not.toContain('7.8');
  });

  it('rejects replay to another verifier or with another nonce', () => {
    const { sdJwt } = pass();
    const p = presentSdJwt(sdJwt, ['name'], { holderPrivateKey: holder.privateKey, aud: 'recruiter-nimbus', nonce: 'n-1', iat: NOW });
    expect(verifySdJwt(p, { issuerPublicKeyPem: publicKeyPem, expectedAud: 'someone-else', now: NOW }).errors.join(' ')).toMatch(/different verifier/);
    expect(verifySdJwt(p, { issuerPublicKeyPem: publicKeyPem, expectedNonce: 'n-2', now: NOW }).errors.join(' ')).toMatch(/replay/);
  });

  it('rejects a forged disclosure, a dropped key binding and a tampered issuer JWT', () => {
    const { sdJwt } = pass();
    const forged = `${sdJwt.split('~')[0]}~${makeDisclosure('cgpa_at_least_9', true).encoded}~`;
    expect(verifySdJwt(forged, { issuerPublicKeyPem: publicKeyPem, now: NOW }).errors.join(' ')).toMatch(/not signed by the issuer/);

    const noKb = presentSdJwt(sdJwt, ['name']);
    expect(verifySdJwt(noKb, { issuerPublicKeyPem: publicKeyPem, requireKeyBinding: true, now: NOW }).valid).toBe(false);

    const [h, payload, s] = sdJwt.split('~')[0].split('.');
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString());
    body.eligible = true; body.rule_version = 99;
    const tampered = `${h}.${Buffer.from(JSON.stringify(body)).toString('base64url')}.${s}~`;
    expect(verifySdJwt(tampered, { issuerPublicKeyPem: publicKeyPem, now: NOW }).errors.join(' ')).toMatch(/Issuer signature is invalid/);
  });

  it('rejects expired passes and key bindings that do not cover the shown disclosures', () => {
    const { sdJwt } = pass();
    const p = presentSdJwt(sdJwt, ['name'], { holderPrivateKey: holder.privateKey, aud: 'a', nonce: 'n', iat: NOW });
    expect(verifySdJwt(p, { issuerPublicKeyPem: publicKeyPem, now: NOW + 90_000 }).errors.join(' ')).toMatch(/expired/);
    const [base, kb] = [p.slice(0, p.lastIndexOf('~') + 1), p.slice(p.lastIndexOf('~') + 1)];
    const extra = base + sdJwt.split('~').filter(Boolean)[2] + '~' + kb;
    expect(verifySdJwt(extra, { issuerPublicKeyPem: publicKeyPem, now: NOW }).errors.join(' ')).toMatch(/does not cover/);
  });
});
