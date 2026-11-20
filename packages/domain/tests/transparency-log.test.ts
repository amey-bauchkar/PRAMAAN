import { describe, it, expect } from 'vitest';
import { createHash, generateKeyPairSync, webcrypto } from 'crypto';
import {
  canonicalJson, leafHash, merkleRoot, inclusionProof, verifyInclusion, consistencyProof, verifyConsistency,
  signCheckpoint, verifyCheckpoint, keyId, verifyPlacementEntry, offerHash, OfferStatement, AcceptanceStatement, PlacementEntry, Jwk,
} from '../src/transparency-log.js';

// RFC 6962 reference data: the Certificate Transparency test tree leaves.
const ctData = ['', '00', '10', '2021', '3031', '40414243', '5051525354555657', '606162636465666768696a6b6c6d6e6f'];
const ctLeaves = ctData.map(d => createHash('sha256').update(Buffer.concat([Buffer.from([0]), Buffer.from(d, 'hex')])).digest('hex'));
const ctRoots = [
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  '6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d',
  'fac54203e7cc696cf0dfcb42c92a1d9dbaf70ad9e621f4bd8d98662f00e3c125',
  'aeb6bcfe274b70a14fb067a5e5578264db0fa9b51af5e0ba159158f329e06e77',
  'd37ee418976dd95753c1c73862b9398fa2a2cf9b4ff0fdfe8b30cd95209614b7',
  '4e3bbb1f7b478dcfe71fb631631519a3bca12c9aefca1612bfce4c13a86264d4',
  '76e67dadbcdf1e10e1b74ddc608abd2f98dfb16fbce75277b5232a127f2087ef',
  'ddb89be403809e325750d3d263cd78929c2942b7942a34b77e122c9594a74c8c',
  '5dc9da79a70659a9ad559cb701ded9a2ab9d823aad2f4960cfe370eff4604328',
];

describe('Merkle log (RFC 6962 / 9162)', () => {
  it('matches the Certificate Transparency reference roots for 0 to 8 leaves', () => {
    for (let n = 0; n <= 8; n++) expect(merkleRoot(ctLeaves.slice(0, n)), `n=${n}`).toBe(ctRoots[n]);
  });

  const leaves = (n: number) => Array.from({ length: n }, (_, i) => leafHash({ i }));

  it('every leaf of every tree size up to 40 has a proof that verifies, and wrong data does not', () => {
    for (let n = 1; n <= 40; n++) {
      const ls = leaves(n), root = merkleRoot(ls);
      for (let i = 0; i < n; i++) {
        const p = inclusionProof(ls, i);
        expect(verifyInclusion(ls[i], i, n, p, root), `n=${n} i=${i}`).toBe(true);
        expect(verifyInclusion(leafHash({ i: 'other' }), i, n, p, root)).toBe(false);
        expect(verifyInclusion(ls[i], (i + 1) % n === i ? i : (i + 1) % n, n, p, root) && n > 1 && (i + 1) % n !== i).toBe(false);
      }
    }
  });

  it('proves that an older tree is a prefix of a newer one, for every pair of sizes up to 40', () => {
    const ls = leaves(40);
    for (let m = 1; m <= 40; m++) {
      for (let n = m; n <= 40; n++) {
        const proof = consistencyProof(ls.slice(0, n), m);
        expect(verifyConsistency(m, n, merkleRoot(ls.slice(0, m)), merkleRoot(ls.slice(0, n)), proof), `m=${m} n=${n}`).toBe(true);
      }
    }
  });

  it('refuses a consistency proof when history was rewritten', () => {
    const ls = leaves(20);
    const rewritten = [...ls]; rewritten[3] = leafHash({ forged: true });
    const proof = consistencyProof(rewritten, 10);
    expect(verifyConsistency(10, 20, merkleRoot(ls.slice(0, 10)), merkleRoot(rewritten), proof)).toBe(false);
    const dropped = ls.filter((_, i) => i !== 5);
    expect(verifyConsistency(10, 19, merkleRoot(ls.slice(0, 10)), merkleRoot(dropped), consistencyProof(dropped, 10))).toBe(false);
  });

  it('canonical JSON is the same however the object was built', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: 'x' } })).toBe('{"a":{"c":"x","d":[1,{"y":2,"z":1}]},"b":1}');
    expect(() => canonicalJson({ a: undefined })).toThrow();
  });

  it('signs and verifies a checkpoint, and rejects a changed one', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const cp = { origin: 'pramaan-ledger/org-1', size: 12, root: merkleRoot(leaves(12)), at: '2026-11-19T10:00:00.000Z' };
    const sig = signCheckpoint(cp, privateKey);
    expect(verifyCheckpoint(cp, sig, pem)).toBe(true);
    expect(verifyCheckpoint({ ...cp, size: 13 }, sig, pem)).toBe(false);
  });
});

describe('Signed offers', () => {
  const subtle = webcrypto.subtle;
  async function newKey() {
    const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = (await subtle.exportKey('jwk', kp.publicKey)) as unknown as Jwk;
    const signJson = async (v: unknown) => Buffer.from(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, Buffer.from(canonicalJson(v)))).toString('base64url');
    return { jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } as Jwk, signJson };
  }
  async function entry(): Promise<PlacementEntry> {
    const rec = await newKey(), stu = await newKey();
    const offer: OfferStatement = { v: 1, type: 'offer', orgId: 'o', driveId: 'd', applicationId: 'a', studentRef: 'ref', company: 'Acme', role: 'Engineer', ctcInr: 600000, issuedAt: '2026-11-19T09:00:00.000Z', recruiterKeyId: keyId(rec.jwk) };
    const acceptance: AcceptanceStatement = { v: 1, type: 'accept', offerHash: offerHash(offer), acceptedAt: '2026-11-19T10:00:00.000Z', studentKeyId: keyId(stu.jwk) };
    return { kind: 'offer_accepted', offer, recruiterSig: await rec.signJson(offer), recruiterKey: rec.jwk, acceptance, studentSig: await stu.signJson(acceptance), studentKey: stu.jwk };
  }

  it('accepts an offer signed by the recruiter and accepted by the student', async () => {
    expect(verifyPlacementEntry(await entry())).toEqual({ valid: true, problems: [] });
  });
  it('catches a changed salary even if every hash is recomputed (the signature will not match)', async () => {
    const e = await entry();
    const forged = { ...e, offer: { ...e.offer, ctcInr: 1200000 } };
    const r = verifyPlacementEntry(forged);
    expect(r.valid).toBe(false);
    expect(r.problems.join(' ')).toMatch(/recruiter signature/);
  });
  it('catches an acceptance that was signed by a different key or points at another offer', async () => {
    const e = await entry(), other = await newKey();
    expect(verifyPlacementEntry({ ...e, studentKey: other.jwk }).valid).toBe(false);
    expect(verifyPlacementEntry({ ...e, acceptance: { ...e.acceptance, offerHash: 'f'.repeat(64) } }).valid).toBe(false);
  });
});
