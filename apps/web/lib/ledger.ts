'use client';

/**
 * Browser side of the placement ledger. Everything that proves something runs here with WebCrypto, so a visitor
 * never has to trust the server's word: hashing, Merkle proofs, signature checks and signing with a private key
 * that never leaves this browser.
 */
const enc = new TextEncoder();
const bytesToHex = (b: Uint8Array) => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
const hexToBytes = (h: string) => Uint8Array.from(h.match(/../g)?.map(x => parseInt(x, 16)) ?? []);
const b64uToBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const bytesToB64u = (b: ArrayBuffer | Uint8Array) => { const u = b instanceof Uint8Array ? b : new Uint8Array(b); let s = ''; for (const x of u) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const concat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };

export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

const sha = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', b as unknown as ArrayBuffer));
export const sha256Hex = async (t: string) => bytesToHex(await sha(enc.encode(t)));
export const leafHashOf = async (entry: unknown) => bytesToHex(await sha(concat(Uint8Array.of(0), enc.encode(canonicalJson(entry)))));
const node = async (l: string, r: string) => bytesToHex(await sha(concat(Uint8Array.of(1), hexToBytes(l), hexToBytes(r))));

const pow2Below = (n: number) => { let k = 1; while (k * 2 < n) k *= 2; return k; };

export async function merkleRoot(leaves: string[]): Promise<string> {
  if (leaves.length === 0) return bytesToHex(await sha(new Uint8Array()));
  if (leaves.length === 1) return leaves[0];
  const k = pow2Below(leaves.length);
  return node(await merkleRoot(leaves.slice(0, k)), await merkleRoot(leaves.slice(k)));
}

export async function verifyInclusion(leaf: string, index: number, size: number, proof: string[], root: string): Promise<boolean> {
  if (index < 0 || index >= size) return false;
  let fn = index, sn = size - 1, r = leaf;
  for (const p of proof) {
    if (sn === 0) return false;
    if ((fn & 1) === 1 || fn === sn) {
      r = await node(p, r);
      if ((fn & 1) === 0) while ((fn & 1) === 0 && fn !== 0) { fn >>= 1; sn >>= 1; }
    } else r = await node(r, p);
    fn >>= 1; sn >>= 1;
  }
  return sn === 0 && r === root;
}

export async function verifyConsistency(oldSize: number, newSize: number, oldRoot: string, newRoot: string, proof: string[]): Promise<boolean> {
  if (oldSize < 0 || oldSize > newSize) return false;
  if (oldSize === newSize) return proof.length === 0 && oldRoot === newRoot;
  if (oldSize === 0) return proof.length === 0;
  const p = [...proof];
  if ((oldSize & (oldSize - 1)) === 0) p.unshift(oldRoot);
  if (p.length === 0) return false;
  let fn = oldSize - 1, sn = newSize - 1;
  while ((fn & 1) === 1) { fn >>= 1; sn >>= 1; }
  let fr = p[0], sr = p[0];
  for (const c of p.slice(1)) {
    if (sn === 0) return false;
    if ((fn & 1) === 1 || fn === sn) {
      fr = await node(c, fr); sr = await node(c, sr);
      while ((fn & 1) === 0 && fn !== 0) { fn >>= 1; sn >>= 1; }
    } else sr = await node(sr, c);
    fn >>= 1; sn >>= 1;
  }
  return fr === oldRoot && sr === newRoot && sn === 0;
}

// ---------- Signatures ----------
export interface Jwk { kty: string; crv: string; x: string; y?: string }
export const keyIdOf = async (j: Jwk) => (await sha256Hex(canonicalJson(j.y ? { crv: j.crv, kty: j.kty, x: j.x, y: j.y } : { crv: j.crv, kty: j.kty, x: j.x }))).slice(0, 16);

export async function verifyEcdsa(jwk: Jwk, message: string, signature: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64uToBytes(signature) as unknown as ArrayBuffer, enc.encode(message));
  } catch { return false; }
}

export interface Checkpoint { origin: string; size: number; root: string; at: string; signature: string; keyId: string }
export const checkpointText = (c: { origin: string; size: number; root: string; at: string }) => `${c.origin}\n${c.size}\n${c.root}\n${c.at}\n`;
/** What a witness signs: the checkpoint, the witness's key id and the witness's own clock time. */
export const witnessTextOf = (c: { origin: string; size: number; root: string; at: string }, witnessKeyId: string, witnessedAt: string) =>
  `${checkpointText(c)}witnessed-by:${witnessKeyId}\nwitnessed-at:${witnessedAt}\n`;

/** Returns true or false, or null when this browser cannot verify Ed25519 signatures. */
export async function verifyCheckpointSignature(c: Checkpoint, issuerPem: string): Promise<boolean | null> {
  try {
    const der = Uint8Array.from(atob(issuerPem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), ch => ch.charCodeAt(0));
    const key = await crypto.subtle.importKey('spki', der as unknown as ArrayBuffer, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, b64uToBytes(c.signature) as unknown as ArrayBuffer, enc.encode(checkpointText(c)));
  } catch (e) {
    return e instanceof DOMException && e.name === 'NotSupportedError' ? null : e instanceof TypeError || (e as any)?.name === 'NotSupportedError' ? null : false;
  }
}

// ---------- Each person's own signing key, kept in this browser only ----------
const DB = 'pramaan-wallet', STORE = 'kv';
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
const kvGet = async <T,>(k: string) => { const db = await idb(); return new Promise<T | undefined>((res, rej) => { const t = db.transaction(STORE).objectStore(STORE).get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); }); };
const kvPut = async (k: string, v: unknown) => { const db = await idb(); return new Promise<void>((res, rej) => { const t = db.transaction(STORE, 'readwrite').objectStore(STORE).put(v, k); t.onsuccess = () => res(); t.onerror = () => rej(t.error); }); };

/** What this browser last saw of a log (size and root), so it can later prove history only grew. Kept per person and per log. */
export const rememberedState = (userId: string, origin: string) => kvGet<{ size: number; root: string }>(`seen:${userId}:${origin}`);
export const rememberState = (userId: string, origin: string, s: { size: number; root: string }) => kvPut(`seen:${userId}:${origin}`, s);

export interface SigningKey { privateKey: CryptoKey; publicJwk: Jwk; keyId: string }

/** This person's signing key in this browser, created on first use. A different person in the same browser gets a different key. */
export async function signingKeyFor(userId: string): Promise<SigningKey> {
  const k = `ledger-key:${userId}`;
  const have = await kvGet<SigningKey>(k);
  if (have) return have;
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const j = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const publicJwk: Jwk = { kty: j.kty!, crv: j.crv!, x: j.x!, y: j.y! };
  const made = { privateKey: pair.privateKey, publicJwk, keyId: await keyIdOf(publicJwk) };
  await kvPut(k, made);
  return made;
}
export async function signText(key: SigningKey, text: string): Promise<string> {
  return bytesToB64u(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key.privateKey, enc.encode(text)));
}

// ---------- Checking a receipt without trusting anyone ----------
export interface Check { label: string; ok: boolean | null; detail?: string }

export async function checkReceipt(receipt: any, issuerPem: string | null): Promise<Check[]> {
  const out: Check[] = [];
  const e = receipt.entry;
  out.push({ label: 'The entry matches its fingerprint', ok: (await leafHashOf(e)) === receipt.leafHash });
  out.push({ label: 'The entry is part of the signed log', ok: await verifyInclusion(receipt.leafHash, receipt.seq - 1, receipt.treeSize, receipt.proof, receipt.checkpoint.root), detail: `entry ${receipt.seq} of ${receipt.treeSize}` });
  if (issuerPem) {
    const s = await verifyCheckpointSignature(receipt.checkpoint, issuerPem);
    out.push({ label: 'The log operator signed that log state', ok: s, detail: s === null ? 'This browser cannot check Ed25519 signatures. Use a current Chrome, Edge, Firefox or Safari.' : undefined });
  }
  out.push({ label: 'The recruiter signed this exact offer', ok: (await keyIdOf(e.recruiterKey)) === e.offer.recruiterKeyId && await verifyEcdsa(e.recruiterKey, canonicalJson(e.offer), e.recruiterSig) });
  out.push({ label: 'The student signed the acceptance of this offer', ok: (await keyIdOf(e.studentKey)) === e.acceptance.studentKeyId && e.acceptance.offerHash === await sha256Hex(canonicalJson(e.offer)) && await verifyEcdsa(e.studentKey, canonicalJson(e.acceptance), e.studentSig) });
  return out;
}
