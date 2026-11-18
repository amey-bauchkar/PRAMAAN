'use client';

/**
 * Student-side Eligibility Pass wallet. The holder key is a non-extractable P-256 key created with
 * WebCrypto and kept in this browser's IndexedDB: the server never sees the private key, and the signed
 * pass itself is stored only here. Presentations follow RFC 9901 (SD-JWT) with a Key Binding JWT.
 */
const DB = 'pramaan-wallet', STORE = 'kv';

function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function get<T>(key: string): Promise<T | undefined> {
  const db = await idb();
  return new Promise((res, rej) => { const t = db.transaction(STORE).objectStore(STORE).get(key); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); });
}
async function put(key: string, value: unknown): Promise<void> {
  const db = await idb();
  return new Promise((res, rej) => { const t = db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key); t.onsuccess = () => res(); t.onerror = () => rej(t.error); });
}

const b64u = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64uText = (t: string) => b64u(new TextEncoder().encode(t));
const fromB64uText = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0)));

/** Returns this browser's holder key pair, creating it on first use. */
export async function holderKey(): Promise<{ privateKey: CryptoKey; publicJwk: JsonWebKey }> {
  const existing = await get<{ privateKey: CryptoKey; publicJwk: JsonWebKey }>('holder');
  if (existing) return existing;
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const publicJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
  await put('holder', { privateKey: pair.privateKey, publicJwk });
  return { privateKey: pair.privateKey, publicJwk };
}

export interface StoredPass { id: string; drive: string; sdJwt: string; expiresAt: string; predicates: Record<string, string>; exact: string[] }
export async function savePass(p: StoredPass) { const all = (await get<StoredPass[]>('passes')) ?? []; await put('passes', [p, ...all.filter(x => x.id !== p.id)]); }
export async function listPasses(): Promise<StoredPass[]> { return (await get<StoredPass[]>('passes')) ?? []; }

export interface Claim { name: string; value: unknown; encoded: string }
export function claimsOf(sdJwt: string): Claim[] {
  return sdJwt.split('~').slice(1).filter(Boolean).map(encoded => { const [, name, value] = JSON.parse(fromB64uText(encoded)); return { name, value, encoded }; });
}

export function decodeRequest(code: string): { nonce: string; audience: string } {
  const j = JSON.parse(fromB64uText(code.trim()));
  if (typeof j.n !== 'string' || typeof j.a !== 'string') throw new Error('Not a PRAMAAN request code.');
  return { nonce: j.n, audience: j.a };
}

/** Builds an RFC 9901 presentation revealing only `reveal`, bound to the verifier's one-time request. */
export async function present(sdJwt: string, reveal: string[], request: { nonce: string; audience: string }): Promise<string> {
  const { privateKey } = await holderKey();
  const jwt = sdJwt.split('~')[0];
  const chosen = claimsOf(sdJwt).filter(c => reveal.includes(c.name)).map(c => c.encoded);
  const base = `${jwt}~${chosen.length ? chosen.join('~') + '~' : ''}`;
  const sdHash = b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(base)));
  const input = `${b64uText(JSON.stringify({ alg: 'ES256', typ: 'kb+jwt' }))}.${b64uText(JSON.stringify({ iat: Math.floor(Date.now() / 1000), aud: request.audience, nonce: request.nonce, sd_hash: sdHash }))}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, new TextEncoder().encode(input));
  return `${base}${input}.${b64u(sig)}`;
}
