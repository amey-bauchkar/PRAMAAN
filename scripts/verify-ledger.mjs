#!/usr/bin/env node
/**
 * Independent verifier for a PRAMAAN placement ledger.
 *
 * It uses only Node's built-in crypto and fetch and shares no code with the platform, so a check made with your own copy does
 * not depend on the page the college's platform serves. Pin the keys you trust with --issuer-key and --witness-key; without
 * pinning, keys come from the same server and only internal consistency is checked.
 *
 *   node scripts/verify-ledger.mjs <api base url> <college id> [--state file] [--issuer-key pem-file]
 *        [--witness-key keyId=jwk-file ...] [--receipt receipt.json]
 *
 * Exit code 0 means every check passed, 1 means at least one failed.
 */
import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const sha = b => createHash('sha256').update(b).digest();
const hex = b => b.toString('hex');
const unhex = h => Buffer.from(h, 'hex');

export function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
}
export const leafHash = entry => hex(sha(Buffer.concat([Buffer.from([0]), Buffer.from(canonicalJson(entry))])));
const node = (l, r) => hex(sha(Buffer.concat([Buffer.from([1]), unhex(l), unhex(r)])));
const pow2Below = n => { let k = 1; while (k * 2 < n) k *= 2; return k; };
export function merkleRoot(leaves) {
  if (leaves.length === 0) return hex(sha(''));
  if (leaves.length === 1) return leaves[0];
  const k = pow2Below(leaves.length);
  return node(merkleRoot(leaves.slice(0, k)), merkleRoot(leaves.slice(k)));
}
export function verifyInclusion(leaf, index, size, proof, root) {
  if (index < 0 || index >= size) return false;
  let fn = index, sn = size - 1, r = leaf;
  for (const p of proof) {
    if (sn === 0) return false;
    if ((fn & 1) === 1 || fn === sn) { r = node(p, r); if ((fn & 1) === 0) while ((fn & 1) === 0 && fn !== 0) { fn >>= 1; sn >>= 1; } } else r = node(r, p);
    fn >>= 1; sn >>= 1;
  }
  return sn === 0 && r === root;
}
export function verifyConsistency(oldSize, newSize, oldRoot, newRoot, proof) {
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
    if ((fn & 1) === 1 || fn === sn) { fr = node(c, fr); sr = node(c, sr); while ((fn & 1) === 0 && fn !== 0) { fn >>= 1; sn >>= 1; } } else sr = node(sr, c);
    fn >>= 1; sn >>= 1;
  }
  return fr === oldRoot && sr === newRoot && sn === 0;
}

const checkpointText = c => `${c.origin}\n${c.size}\n${c.root}\n${c.at}\n`;
const witnessText = (c, keyId, at) => `${checkpointText(c)}witnessed-by:${keyId}\nwitnessed-at:${at}\n`;
const b64u = s => Buffer.from(s, 'base64url');
const keyIdOf = j => hex(sha(Buffer.from(canonicalJson({ crv: j.crv, kty: j.kty, x: j.x, y: j.y })))).slice(0, 16);
const ecdsaOk = (jwk, text, sig) => {
  try {
    const key = createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, format: 'jwk' });
    return cryptoVerify('sha256', Buffer.from(text), { key, dsaEncoding: 'ieee-p1363' }, b64u(sig));
  } catch { return false; }
};
const ed25519Ok = (pem, text, sig) => { try { return cryptoVerify(null, Buffer.from(text), createPublicKey(pem), b64u(sig)); } catch { return false; } };

/** Placement receipt: leaf hash, inclusion in the signed tree, and both signatures. */
export function checkReceipt(receipt, issuerPem) {
  const out = [], e = receipt.entry;
  out.push({ label: 'the entry matches its fingerprint', ok: leafHash(e) === receipt.leafHash });
  out.push({ label: `the entry is in the signed log (entry ${receipt.seq} of ${receipt.treeSize})`, ok: verifyInclusion(receipt.leafHash, receipt.seq - 1, receipt.treeSize, receipt.proof, receipt.checkpoint.root) });
  if (issuerPem) out.push({ label: 'the log operator signed that log state', ok: ed25519Ok(issuerPem, checkpointText(receipt.checkpoint), receipt.checkpoint.signature) });
  out.push({ label: 'the recruiter signed this exact offer', ok: keyIdOf(e.recruiterKey) === e.offer.recruiterKeyId && ecdsaOk(e.recruiterKey, canonicalJson(e.offer), e.recruiterSig) });
  out.push({ label: 'the student signed the acceptance of this offer', ok: keyIdOf(e.studentKey) === e.acceptance.studentKeyId && e.acceptance.offerHash === hex(sha(Buffer.from(canonicalJson(e.offer)))) && ecdsaOk(e.studentKey, canonicalJson(e.acceptance), e.studentSig) });
  return out;
}

/**
 * Runs every check against a live ledger and returns a list of results. `getJson(path)` fetches a path under the API base.
 * `seen` is the state remembered from last time, `pins` holds keys you trust.
 */
export async function verifyLedgerAt(getJson, orgId, { seen = null, issuerPem = null, witnessPins = {}, receipt = null } = {}) {
  const res = [];
  const add = (label, ok, detail) => res.push({ label, ok, detail });
  const head = await getJson(`/api/public/ledger/${orgId}`);
  const { leaves } = await getJson(`/api/public/ledger/${orgId}/leaves`);
  const cp = head.checkpoint, hashes = leaves.map(l => l.leafHash);
  const pem = issuerPem ?? head.issuerPublicKeyPem;
  add(`published list holds ${hashes.length} fingerprints; newest signed state covers ${cp.size}`, hashes.length >= cp.size);
  const local = merkleRoot(hashes.slice(0, cp.size));
  add('tree rebuilt from the fingerprints matches the root the operator signed', local === cp.root, `root ${cp.root.slice(0, 24)}...`);
  add(`operator signature on that state is valid${issuerPem ? ' (pinned key)' : ' (key taken from the same server: not pinned)'}`, pem ? ed25519Ok(pem, checkpointText(cp), cp.signature) : false);
  const witnesses = head.witnesses ?? [];
  if (witnesses.length === 0) add('no witness has signed this log yet', null, 'a rewrite by the operator itself would not be caught by a witness');
  for (const w of witnesses) {
    const jwk = witnessPins[w.keyId] ?? w.publicKey;
    const sigOk = !!jwk && keyIdOf(jwk) === w.keyId && ecdsaOk(jwk, witnessText({ origin: head.origin, size: w.size, root: w.root, at: w.checkpointAt }, w.keyId, w.at), w.signature);
    const same = w.size <= hashes.length && merkleRoot(hashes.slice(0, w.size)) === w.root;
    add(`${w.name} witnessed the first ${w.size} entries and they are unchanged${witnessPins[w.keyId] ? ' (pinned key)' : ''}`, sigOk && same, !sigOk ? 'witness signature not valid' : !same ? 'THE LOG WAS REWRITTEN after it was witnessed' : `signed ${w.at} by the witness's clock`);
  }
  if (seen) {
    if (seen.size > cp.size) add(`nothing was removed since your last run (${seen.size} then, ${cp.size} now)`, false);
    else {
      const c = await getJson(`/api/public/ledger/${orgId}/consistency?from=${seen.size}&to=${cp.size}`);
      add(`history only grew since your last run (${seen.size} entries then, ${cp.size} now)`, Array.isArray(c.proof) && verifyConsistency(seen.size, cp.size, seen.root, local, c.proof));
    }
  } else add('first run: this state is saved so the next run can prove history only grew', true);
  if (receipt) for (const r of checkReceipt(receipt, pem)) add(`receipt: ${r.label}`, r.ok);
  return { results: res, ok: res.every(r => r.ok !== false), state: { size: cp.size, root: local } };
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name, all = false) => { const out = []; for (let i = 0; i < args.length; i++) if (args[i] === name) out.push(args[i + 1]); return all ? out : out[0]; };
  const [base, orgId] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
  // The exit code is set rather than calling process.exit(): on Windows, exiting while fetch connections are closing can abort Node with a libuv assertion (exit code 127).
  if (!base || !orgId) { console.error('Usage: node scripts/verify-ledger.mjs <api base url> <college id> [--state file] [--issuer-key pem-file] [--witness-key keyId=jwk-file] [--receipt file]'); process.exitCode = 2; return; }
  const stateFile = flag('--state') ?? '.pramaan-ledger-state.json';
  const issuerFile = flag('--issuer-key');
  const witnessPins = Object.fromEntries(flag('--witness-key', true).map(s => { const [id, file] = s.split('='); return [id, JSON.parse(readFileSync(file, 'utf8'))]; }));
  const receiptFile = flag('--receipt');
  const states = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
  const getJson = async p => { const r = await fetch(new URL(p, base), { cache: 'no-store' }); if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`); return r.json(); };
  const out = await verifyLedgerAt(getJson, orgId, {
    seen: states[orgId] ?? null, issuerPem: issuerFile ? readFileSync(issuerFile, 'utf8') : null, witnessPins, receipt: receiptFile ? JSON.parse(readFileSync(receiptFile, 'utf8')) : null,
  });
  for (const r of out.results) console.log(`${r.ok === true ? 'PASS' : r.ok === false ? 'FAIL' : 'NOTE'}  ${r.label}${r.detail ? `  [${r.detail}]` : ''}`);
  if (out.ok) { states[orgId] = out.state; writeFileSync(stateFile, JSON.stringify(states, null, 2)); }
  console.log(out.ok ? '\nAll checks passed.' : '\nAt least one check FAILED. The saved state was not updated.');
  process.exitCode = out.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message); process.exitCode = 1; });
