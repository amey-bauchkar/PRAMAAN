import { createHash, createPublicKey, sign as nodeSign, verify as nodeVerify, KeyObject } from 'crypto';

/**
 * Append-only Merkle log in the style of Certificate Transparency (RFC 6962, with the checks of RFC 9162 section 2.1).
 * Everything here is pure: no database, no network. The API stores entries and signed checkpoints; anyone can re-run
 * these functions on public data to check that a log was not changed.
 */

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest();
const hex = (b: Buffer) => b.toString('hex');
const unhex = (h: string) => Buffer.from(h, 'hex');

/** Canonical JSON: keys sorted, no whitespace. Identical for equal data however it was stored. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) throw new Error('canonicalJson: undefined is not allowed');
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

export const sha256Hex = (s: string | Buffer) => hex(sha(s));

/** Hash of one log entry: SHA-256(0x00 || canonical JSON). */
export function leafHash(entry: unknown): string {
  return hex(sha(Buffer.concat([Buffer.from([0x00]), Buffer.from(canonicalJson(entry), 'utf8')])));
}

const node = (l: string, r: string) => hex(sha(Buffer.concat([Buffer.from([0x01]), unhex(l), unhex(r)])));
const largestPowerOfTwoBelow = (n: number) => { let k = 1; while (k * 2 < n) k *= 2; return k; };

/** Merkle tree hash over already-computed leaf hashes. The empty tree hashes the empty string. */
export function merkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return hex(sha(''));
  if (leaves.length === 1) return leaves[0];
  const k = largestPowerOfTwoBelow(leaves.length);
  return node(merkleRoot(leaves.slice(0, k)), merkleRoot(leaves.slice(k)));
}

/** Audit path proving that leaves[index] is in the tree of all given leaves. */
export function inclusionProof(leaves: string[], index: number): string[] {
  if (index < 0 || index >= leaves.length) throw new Error('inclusionProof: index out of range');
  if (leaves.length === 1) return [];
  const k = largestPowerOfTwoBelow(leaves.length);
  return index < k
    ? [...inclusionProof(leaves.slice(0, k), index), merkleRoot(leaves.slice(k))]
    : [...inclusionProof(leaves.slice(k), index - k), merkleRoot(leaves.slice(0, k))];
}

export function verifyInclusion(leaf: string, index: number, treeSize: number, proof: string[], root: string): boolean {
  if (index < 0 || index >= treeSize) return false;
  let fn = index, sn = treeSize - 1, r = leaf;
  for (const p of proof) {
    if (sn === 0) return false;
    if ((fn & 1) === 1 || fn === sn) {
      r = node(p, r);
      if ((fn & 1) === 0) while ((fn & 1) === 0 && fn !== 0) { fn >>= 1; sn >>= 1; }
    } else {
      r = node(r, p);
    }
    fn >>= 1; sn >>= 1;
  }
  return sn === 0 && r === root;
}

/** Proof that the tree of the first `oldSize` leaves is a prefix of the tree of all leaves (nothing was changed or removed). */
export function consistencyProof(leaves: string[], oldSize: number): string[] {
  const n = leaves.length;
  if (oldSize < 0 || oldSize > n) throw new Error('consistencyProof: bad size');
  if (oldSize === 0 || oldSize === n) return [];
  const sub = (m: number, d: string[], complete: boolean): string[] => {
    if (m === d.length) return complete ? [] : [merkleRoot(d)];
    const k = largestPowerOfTwoBelow(d.length);
    return m <= k
      ? [...sub(m, d.slice(0, k), complete), merkleRoot(d.slice(k))]
      : [...sub(m - k, d.slice(k), false), merkleRoot(d.slice(0, k))];
  };
  return sub(oldSize, leaves, true);
}

export function verifyConsistency(oldSize: number, newSize: number, oldRoot: string, newRoot: string, proof: string[]): boolean {
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
      fr = node(c, fr); sr = node(c, sr);
      while ((fn & 1) === 0 && fn !== 0) { fn >>= 1; sn >>= 1; }
    } else {
      sr = node(sr, c);
    }
    fn >>= 1; sn >>= 1;
  }
  return fr === oldRoot && sr === newRoot && sn === 0;
}

// ---------- Signed checkpoints (the college signs the tree head) ----------

export interface Checkpoint { origin: string; size: number; root: string; at: string }
export const checkpointText = (c: Checkpoint) => `${c.origin}\n${c.size}\n${c.root}\n${c.at}\n`;

export function signCheckpoint(c: Checkpoint, privateKey: KeyObject): string {
  return nodeSign(null, Buffer.from(checkpointText(c)), privateKey).toString('base64url');
}
export function verifyCheckpoint(c: Checkpoint, signature: string, publicKeyPem: string): boolean {
  try { return nodeVerify(null, Buffer.from(checkpointText(c)), createPublicKey(publicKeyPem), Buffer.from(signature, 'base64url')); } catch { return false; }
}

// ---------- Offers: recruiter signs, student accepts ----------

export interface Jwk { kty: string; crv: string; x: string; y?: string }

/** Short stable id of a public key: first 16 hex characters of SHA-256 of its canonical JSON. */
export function keyId(jwk: Jwk): string {
  const c = jwk.y ? { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y } : { crv: jwk.crv, kty: jwk.kty, x: jwk.x };
  return sha256Hex(canonicalJson(c)).slice(0, 16);
}

/** ECDSA P-256 / SHA-256 with the raw (IEEE P1363) signature that WebCrypto produces. */
export function verifyEcdsaP256(jwk: Jwk, message: string, signature: string): boolean {
  try {
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') return false;
    const key = createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } as any, format: 'jwk' });
    return nodeVerify('sha256', Buffer.from(message), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'));
  } catch { return false; }
}

export interface OfferStatement {
  v: 1; type: 'offer'; orgId: string; driveId: string; applicationId: string; studentRef: string;
  company: string; role: string; ctcInr: number; issuedAt: string; recruiterKeyId: string;
}
export interface AcceptanceStatement { v: 1; type: 'accept'; offerHash: string; acceptedAt: string; studentKeyId: string }

export const offerHash = (o: OfferStatement) => sha256Hex(canonicalJson(o));

/** What a log entry for an accepted offer holds. Everything needed to check both signatures is inside it. */
export interface PlacementEntry {
  kind: 'offer_accepted';
  offer: OfferStatement; recruiterSig: string; recruiterKey: Jwk;
  acceptance: AcceptanceStatement; studentSig: string; studentKey: Jwk;
}

export interface ReceiptCheck { valid: boolean; problems: string[] }

/** Checks both signatures and that every statement refers to the key that signed it. Needs no database. */
export function verifyPlacementEntry(e: PlacementEntry): ReceiptCheck {
  const problems: string[] = [];
  if (keyId(e.recruiterKey) !== e.offer.recruiterKeyId) problems.push('The recruiter key does not match the key named in the offer.');
  if (!verifyEcdsaP256(e.recruiterKey, canonicalJson(e.offer), e.recruiterSig)) problems.push('The recruiter signature does not match the offer. The offer was changed after it was signed, or was never signed by this key.');
  if (keyId(e.studentKey) !== e.acceptance.studentKeyId) problems.push('The student key does not match the key named in the acceptance.');
  if (e.acceptance.offerHash !== offerHash(e.offer)) problems.push('The acceptance refers to a different offer.');
  if (!verifyEcdsaP256(e.studentKey, canonicalJson(e.acceptance), e.studentSig)) problems.push('The student signature does not match the acceptance.');
  return { valid: problems.length === 0, problems };
}

// ---------- Witnessing: a second party signs the checkpoint with a key the college does not hold ----------

/**
 * What a witness signs: the log's checkpoint, the witness's own key id (so a cosignature cannot be replayed under another key)
 * and the witness's own clock time (so the log operator cannot backdate a witnessing).
 */
export const witnessText = (c: Checkpoint, witnessKeyId: string, witnessedAt: string) => `${checkpointText(c)}witnessed-by:${witnessKeyId}\nwitnessed-at:${witnessedAt}\n`;

export interface WitnessCosignature { size: number; root: string; witnessKeyId: string; signature: string; witnessKey: Jwk | null; at: string }

/** True when the cosignature is a valid signature over this checkpoint state, made by the key it names at the time it names. */
export function verifyWitnessCosignature(origin: string, w: WitnessCosignature, checkpointAt: string): boolean {
  if (!w.witnessKey || keyId(w.witnessKey) !== w.witnessKeyId) return false;
  return verifyEcdsaP256(w.witnessKey, witnessText({ origin, size: w.size, root: w.root, at: checkpointAt }, w.witnessKeyId, w.at), w.signature);
}

// ---------- Audit sampling that anyone can reproduce ----------

/**
 * Picks k distinct entries out of n from a seed and the signed tree root. The auditor chooses the seed after the log has committed to
 * the root, so the operator cannot steer which entries are checked, and anyone with the seed and the root gets the same sample.
 */
export function sampleIndices(n: number, k: number, seed: string, root: string): number[] {
  const want = Math.min(Math.max(0, k), n);
  const picked: number[] = [];
  const seen = new Set<number>();
  for (let counter = 0; picked.length < want; counter++) {
    const h = sha256Hex(`${seed}|${root}|${counter}`);
    const idx = Number(BigInt('0x' + h.slice(0, 15)) % BigInt(n));
    if (!seen.has(idx)) { seen.add(idx); picked.push(idx); }
  }
  return picked;
}
