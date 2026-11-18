/**
 * Selective Disclosure JWT (IETF RFC 9901) with Key Binding, implemented on Node's crypto (no extra
 * dependencies). Used for the Eligibility Pass: the college signs facts about a student, and the student
 * shows a verifier only the facts they choose, bound to the verifier's nonce so it cannot be replayed.
 *
 * Format:  <issuer-signed JWT>~<disclosure>~...~<optional KB-JWT>
 *   disclosure = base64url(JSON [salt, claim_name, claim_value]); the JWT carries sha-256 digests in `_sd`.
 *   Issuer signs EdDSA (Ed25519). Holder Key Binding JWT is ES256 (P-256), which browsers can create with
 *   WebCrypto; its `sd_hash` covers the issuer JWT plus the chosen disclosures.
 */
import { createHash, randomBytes, sign as edSign, verify as edVerify, createPublicKey, KeyObject } from 'crypto';

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const fromB64u = (s: string) => Buffer.from(s, 'base64url');
const sha256b64u = (s: string) => b64u(createHash('sha256').update(s, 'ascii').digest());

/** Minimal public JWK shape (EC P-256) used for key binding. */
export interface PublicJwk { kty: string; crv?: string; x?: string; y?: string; [k: string]: unknown }

export interface Disclosure { salt: string; name: string; value: unknown; encoded: string; digest: string }

export function makeDisclosure(name: string, value: unknown, salt = b64u(randomBytes(16))): Disclosure {
  const encoded = b64u(JSON.stringify([salt, name, value]));
  return { salt, name, value, encoded, digest: sha256b64u(encoded) };
}

export function parseDisclosure(encoded: string): Disclosure {
  const arr = JSON.parse(fromB64u(encoded).toString('utf8'));
  if (!Array.isArray(arr) || arr.length !== 3 || typeof arr[0] !== 'string' || typeof arr[1] !== 'string') throw new Error('Malformed disclosure.');
  return { salt: arr[0], name: arr[1], value: arr[2], encoded, digest: sha256b64u(encoded) };
}

function signJwt(header: object, payload: object, sign: (data: Buffer) => Buffer): string {
  const input = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`;
  return `${input}.${b64u(sign(Buffer.from(input, 'ascii')))}`;
}

function decodeJwt(jwt: string) {
  const [h, p, s] = jwt.split('.');
  if (!h || !p || !s) throw new Error('Malformed JWT.');
  return { header: JSON.parse(fromB64u(h).toString('utf8')), payload: JSON.parse(fromB64u(p).toString('utf8')), signingInput: `${h}.${p}`, signature: fromB64u(s) };
}

export interface IssueInput {
  issuer: string;
  kid: string;
  privateKey: KeyObject;            // Ed25519
  vct: string;                      // credential type
  visible: Record<string, unknown>; // always disclosed (e.g. drive, college, expiry)
  selective: Record<string, unknown>; // holder chooses which of these to reveal
  holderJwk?: PublicJwk;            // P-256 public key for key binding (cnf)
  iat?: number;
  exp: number;
  /** Extra decoy digests so the number of hidden claims is not revealed (RFC 9901 §4.2.5). */
  decoys?: number;
}

export function issueSdJwt(input: IssueInput): { sdJwt: string; disclosures: Disclosure[] } {
  const disclosures = Object.entries(input.selective).map(([k, v]) => makeDisclosure(k, v));
  const decoys = Array.from({ length: input.decoys ?? 3 }, () => sha256b64u(b64u(randomBytes(32))));
  const payload = {
    iss: input.issuer, iat: input.iat ?? Math.floor(Date.now() / 1000), exp: input.exp, vct: input.vct,
    ...input.visible,
    _sd: [...disclosures.map(d => d.digest), ...decoys].sort(),
    _sd_alg: 'sha-256',
    ...(input.holderJwk ? { cnf: { jwk: input.holderJwk } } : {}),
  };
  const jwt = signJwt({ alg: 'EdDSA', typ: 'dc+sd-jwt', kid: input.kid }, payload, data => edSign(null, data, input.privateKey));
  return { sdJwt: `${jwt}~${disclosures.map(d => d.encoded).join('~')}~`, disclosures };
}

/** Holder side (server-side variant for tests; the web app does the same with WebCrypto). */
export function presentSdJwt(sdJwt: string, reveal: string[], kb?: { holderPrivateKey: KeyObject; aud: string; nonce: string; iat?: number }): string {
  const parts = sdJwt.split('~');
  const jwt = parts[0];
  const chosen = parts.slice(1).filter(Boolean).filter(e => reveal.includes(parseDisclosure(e).name));
  const base = `${jwt}~${chosen.length ? chosen.join('~') + '~' : ''}`;
  if (!kb) return base;
  const kbJwt = signJwt({ alg: 'ES256', typ: 'kb+jwt' }, { iat: kb.iat ?? Math.floor(Date.now() / 1000), aud: kb.aud, nonce: kb.nonce, sd_hash: sha256b64u(base) },
    data => edSign('sha256', data, { key: kb.holderPrivateKey, dsaEncoding: 'ieee-p1363' }));
  return base + kbJwt;
}

export interface VerifyOptions {
  issuerPublicKeyPem: string;
  expectedAud?: string;
  expectedNonce?: string;
  requireKeyBinding?: boolean;
  now?: number;            // seconds
  maxKbAgeSeconds?: number;
}

export interface VerifyResult {
  valid: boolean;
  errors: string[];
  visible: Record<string, unknown>;
  disclosed: Record<string, unknown>;
  hiddenCount: number;
  keyBound: boolean;
}

export function verifySdJwt(presentation: string, opts: VerifyOptions): VerifyResult {
  const errors: string[] = [];
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const parts = presentation.split('~');
  const kbPart = parts[parts.length - 1];
  const disclosuresEnc = parts.slice(1, -1).filter(Boolean);
  let decoded: ReturnType<typeof decodeJwt>;
  try { decoded = decodeJwt(parts[0]); } catch { return { valid: false, errors: ['Not an SD-JWT.'], visible: {}, disclosed: {}, hiddenCount: 0, keyBound: false }; }
  const { header, payload } = decoded;

  if (header.alg !== 'EdDSA') errors.push(`Unexpected issuer algorithm ${header.alg}.`);
  let sigOk: boolean;
  try { sigOk = edVerify(null, Buffer.from(decoded.signingInput, 'ascii'), createPublicKey(opts.issuerPublicKeyPem), decoded.signature); } catch { sigOk = false; }
  if (!sigOk) errors.push('Issuer signature is invalid: the pass was altered or not issued by this college.');
  if (payload._sd_alg !== 'sha-256') errors.push('Unsupported digest algorithm.');
  if (typeof payload.exp !== 'number' || payload.exp <= now) errors.push('The pass has expired.');

  const digests = new Set<string>(Array.isArray(payload._sd) ? payload._sd : []);
  const disclosed: Record<string, unknown> = {};
  const seen = new Set<string>();
  for (const enc of disclosuresEnc) {
    let d: Disclosure;
    try { d = parseDisclosure(enc); } catch { errors.push('A disclosure is malformed.'); continue; }
    if (!digests.has(d.digest)) { errors.push(`Disclosure "${d.name}" was not signed by the issuer.`); continue; }
    if (seen.has(d.digest)) { errors.push('A disclosure is repeated.'); continue; }
    if (d.name in payload || d.name === '_sd' || d.name === '...') { errors.push(`Disclosure "${d.name}" collides with a signed claim.`); continue; }
    seen.add(d.digest);
    disclosed[d.name] = d.value;
  }

  let keyBound = false;
  if (kbPart) {
    try {
      const kb = decodeJwt(kbPart);
      if (kb.header.typ !== 'kb+jwt' || kb.header.alg !== 'ES256') throw new Error('Key binding JWT has the wrong type.');
      if (!payload.cnf?.jwk) throw new Error('The pass is not bound to a holder key.');
      const pub = createPublicKey({ key: payload.cnf.jwk as any, format: 'jwk' });
      if (!edVerify('sha256', Buffer.from(kb.signingInput, 'ascii'), { key: pub, dsaEncoding: 'ieee-p1363' }, kb.signature)) throw new Error('Holder signature is invalid.');
      const base = presentation.slice(0, presentation.length - kbPart.length);
      if (kb.payload.sd_hash !== sha256b64u(base)) throw new Error('Key binding does not cover these disclosures.');
      if (opts.expectedAud && kb.payload.aud !== opts.expectedAud) throw new Error('The pass was presented to a different verifier.');
      if (opts.expectedNonce && kb.payload.nonce !== opts.expectedNonce) throw new Error('The pass was made for a different request (nonce mismatch): possible replay.');
      if (typeof kb.payload.iat !== 'number' || Math.abs(now - kb.payload.iat) > (opts.maxKbAgeSeconds ?? 600)) throw new Error('The presentation is too old.');
      keyBound = true;
    } catch (e: any) { errors.push(e.message); }
  } else if (opts.requireKeyBinding) {
    errors.push('The holder did not prove possession of the pass (no key binding).');
  }

  const { _sd: _a, _sd_alg: _b, cnf: _c, ...visible } = payload;
  return { valid: errors.length === 0, errors, visible, disclosed, hiddenCount: digests.size - seen.size, keyBound };
}
