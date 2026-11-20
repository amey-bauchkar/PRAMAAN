import { randomBytes } from 'crypto';
import { SessionContext } from '@pramaan/contracts';
import {
  leafHash, merkleRoot, signCheckpoint, verifyCheckpoint, consistencyProof, verifyConsistency, sha256Hex,
  verifyPlacementEntry, PlacementEntry, Checkpoint, verifyWitnessCosignature, sampleIndices,
} from '@pramaan/domain';
import { Sql } from './db.js';
import { HttpError } from './http.js';
import { IssuerConfig } from './config.js';

/**
 * The placement ledger: an append-only Merkle log kept per college. Each append is serialised with an advisory lock,
 * hashed, and followed by a checkpoint signed with the deployment's issuer key (one key serves every college today, so the
 * log operator holds it, not the college). The tree is rebuilt from stored leaf hashes
 * on every append, which is fine for thousands of entries; very large colleges would keep the frontier instead.
 */

let issuerForLedger: IssuerConfig | null = null;
let originSalt = '';
/**
 * Set once when the product routes are registered, so any module can append without passing the key around.
 * `originSalt` makes the log's identity unique to one run. Only the demo uses it: its database starts empty on every boot,
 * so a visitor's remembered state from an earlier run would otherwise be mistaken for a rewrite of the same log.
 */
export function configureLedger(issuer: IssuerConfig | null, opts: { originSalt?: string } = {}) { issuerForLedger = issuer; originSalt = opts.originSalt ?? ''; }

/** A pseudonym for a student inside the ledger. It cannot be turned back into the student without the student's own id. */
export const studentRef = (orgId: string, studentId: string) => sha256Hex(`pramaan-student-ref:${orgId}:${studentId}`);
export const ledgerEnabled = () => issuerForLedger !== null;
export const ledgerOrigin = (orgId: string) => `pramaan-ledger/${orgId}${originSalt ? `/${originSalt}` : ''}`;
export const issuerKeyId = (issuer: IssuerConfig) => sha256Hex(issuer.publicKeyPem).slice(0, 16);

export type LedgerPayload = { kind: 'offer_accepted' } & Omit<PlacementEntry, 'kind'>
  | { kind: 'rule_published'; driveId: string; versionNo: number; rulesHash: string; population: number; eligible: number; groupsBelowFourFifths: string[]; at: string }
  | { kind: 'decisions_published'; driveId: string; ruleVersionId: string; count: number; decisionsRoot: string; at: string };

export interface Appended { seq: number; leafHash: string; size: number; root: string }

export async function appendLedger(sql: Sql, ctx: SessionContext, payload: LedgerPayload): Promise<Appended> {
  const issuer = issuerForLedger;
  if (!issuer) throw new HttpError(501, 'The placement ledger needs a signing key (PRAMAAN_ISSUER_SEED).');
  await sql.query(`SELECT pg_advisory_xact_lock(hashtext('ledger'), hashtext($1))`, [ctx.orgId]);
  const leaves = (await sql.query<{ leaf_hash: string }>(`SELECT leaf_hash FROM ledger_entries WHERE org_id = $1 ORDER BY seq`, [ctx.orgId])).rows.map(r => r.leaf_hash);
  const seq = leaves.length + 1;
  const lh = leafHash(payload);
  await sql.query(`INSERT INTO ledger_entries (org_id, seq, kind, payload, leaf_hash) VALUES ($1,$2,$3,$4,$5)`, [ctx.orgId, seq, payload.kind, JSON.stringify(payload), lh]);
  const root = merkleRoot([...leaves, lh]);
  const cp: Checkpoint = { origin: ledgerOrigin(ctx.orgId), size: seq, root, at: new Date().toISOString() };
  await sql.query(`INSERT INTO ledger_checkpoints (org_id, tree_size, root_hash, signed_at, signature, key_id) VALUES ($1,$2,$3,$4,$5,$6)`,
    [ctx.orgId, seq, root, cp.at, signCheckpoint(cp, issuer.privateKey), issuerKeyId(issuer)]);
  return { seq, leafHash: lh, size: seq, root };
}

export interface LedgerProblem { seq: number | null; text: string }
export interface LedgerReport { valid: boolean; entries: number; checkpoints: number; offersChecked: number; witnessed: number; problems: LedgerProblem[]; checkedAt: string }

/** Re-checks everything that can be checked: hashes, the tree against every signed checkpoint, append-only consistency and every offer signature. */
export async function verifyLedger(sql: Sql, orgId: string, issuer: IssuerConfig | null): Promise<LedgerReport> {
  const entries = (await sql.query<any>(`SELECT seq, kind, payload, leaf_hash FROM ledger_entries WHERE org_id = $1 ORDER BY seq`, [orgId])).rows;
  const cps = (await sql.query<any>(`SELECT tree_size, root_hash, signed_at, signature FROM ledger_checkpoints WHERE org_id = $1 ORDER BY tree_size`, [orgId])).rows;
  const problems: LedgerProblem[] = [];
  let offersChecked = 0;
  for (const e of entries) {
    if (leafHash(e.payload) !== e.leaf_hash) problems.push({ seq: Number(e.seq), text: 'The stored content does not match the hash that was recorded for it.' });
    if (e.kind === 'offer_accepted') {
      offersChecked++;
      const r = verifyPlacementEntry(e.payload);
      if (!r.valid) for (const p of r.problems) problems.push({ seq: Number(e.seq), text: p });
    }
  }
  const stored = entries.map(e => e.leaf_hash);
  const recomputed = entries.map(e => leafHash(e.payload));
  let prev: { size: number; root: string } | null = null;
  const rootMismatch: number[] = [], badSignatures: number[] = [], notExtending: number[] = [];
  for (const c of cps) {
    const size = Number(c.tree_size);
    if (size > entries.length) { problems.push({ seq: null, text: `A signed checkpoint covers ${size} entries but only ${entries.length} exist. Entries were removed.` }); continue; }
    const rootStored = merkleRoot(stored.slice(0, size));
    const rootRecomputed = merkleRoot(recomputed.slice(0, size));
    if (rootStored !== c.root_hash || rootRecomputed !== c.root_hash) rootMismatch.push(size);
    if (issuer && !verifyCheckpoint({ origin: ledgerOrigin(orgId), size, root: c.root_hash, at: new Date(c.signed_at).toISOString() }, c.signature, issuer.publicKeyPem)) {
      badSignatures.push(size);
    }
    if (prev && !verifyConsistency(prev.size, size, prev.root, c.root_hash, consistencyProof(stored.slice(0, size), prev.size))) {
      notExtending.push(size);
    }
    prev = { size, root: c.root_hash };
  }
  const many = (a: number[]) => (a.length > 1 ? ` (and ${a.length - 1} later signed state${a.length > 2 ? 's' : ''})` : '');
  if (rootMismatch.length) problems.push({ seq: null, text: `The log no longer matches what the log operator signed: the signed state of ${rootMismatch[0]} entries${many(rootMismatch)} does not match the entries now stored.` });
  if (badSignatures.length) problems.push({ seq: null, text: `The college signature on the signed state of ${badSignatures[0]} entries${many(badSignatures)} is not valid.` });
  if (notExtending.length) problems.push({ seq: null, text: `The log of ${notExtending[0]} entries is not an extension of the earlier log${many(notExtending)}: history was rewritten.` });
  // University witnesses: a state the university signed must still match the entries now stored. This is what catches a log operator that rewrites history and signs it again.
  const witnesses = (await sql.query<any>(`SELECT * FROM public_ledger_witnesses($1)`, [orgId])).rows;
  const cpAt = new Map<number, string>(cps.map((c: any) => [Number(c.tree_size), new Date(c.signed_at).toISOString()]));
  const clean = (n: string) => String(n).replace('[SYNTHETIC] ', '');
  const mismatched = new Map<string, { first: number; badSignature: boolean; count: number }>();
  for (const w of witnesses) {
    const size = Number(w.tree_size);
    const sigOk = verifyWitnessCosignature(ledgerOrigin(orgId), { size, root: w.root_hash, witnessKeyId: w.witness_key_id, signature: w.signature, witnessKey: w.public_jwk, at: new Date(w.cosigned_at).toISOString() }, cpAt.get(size) ?? '');
    const sameHistory = size <= entries.length && merkleRoot(recomputed.slice(0, size)) === w.root_hash;
    if (sigOk && sameHistory) continue;
    const name = clean(w.witness_name), seen = mismatched.get(name);
    if (seen) seen.count++; else mismatched.set(name, { first: size, badSignature: !sigOk, count: 1 });
  }
  for (const [name, m] of mismatched) {
    const more = m.count > 1 ? ` (and ${m.count - 1} later state${m.count > 2 ? 's' : ''} it witnessed)` : '';
    problems.push({
      seq: null,
      text: m.badSignature
        ? `The signature of ${name} on the state of ${m.first} entries is not valid${more}.`
        : `${name} witnessed a different history for the first ${m.first} entries${more}. The log was rewritten after it was witnessed.`,
    });
  }
  if (cps.length === 0 && entries.length > 0) problems.push({ seq: null, text: 'There are entries but no signed checkpoint.' });
  return { valid: problems.length === 0, entries: entries.length, checkpoints: cps.length, offersChecked, witnessed: witnesses.length, problems, checkedAt: new Date().toISOString() };
}

export interface AuditedOffer {
  seq: number; company: string; role: string; ctcInr: number; issuedAt: string; acceptedAt: string; studentRef: string;
  recruiterKeyId: string; recruiterKeyRegisteredAt: string | null; recruiterSignatureValid: boolean; studentSignatureValid: boolean; problems: string[];
}

export interface AuditResult { population: number; seed: string; treeSize: number; treeRoot: string; sample: AuditedOffer[]; method: string }

/**
 * Checks a sample of accepted offers: both signatures are re-verified and the recruiter key's registration date is shown.
 * The sample is derived from a seed and the signed tree root, so anyone with the seed and the root can pick the same entries.
 * Pass an auditor's own seed to stop the operator steering which entries are checked. Student names are never stored in an entry.
 */
export function auditFromRows(rows: { seq: number | string; payload: PlacementEntry; registeredAt?: string | null }[], treeSize: number, treeRoot: string, k: number, seed: string): AuditResult {
  const indices = sampleIndices(rows.length, Math.min(25, Math.max(1, k)), seed, treeRoot).sort((a, b) => a - b);
  const sample: AuditedOffer[] = indices.map(i => {
    const e = rows[i], p = e.payload;
    const check = verifyPlacementEntry(p);
    return {
      seq: Number(e.seq), company: p.offer.company, role: p.offer.role, ctcInr: p.offer.ctcInr, issuedAt: p.offer.issuedAt, acceptedAt: p.acceptance.acceptedAt,
      studentRef: p.offer.studentRef.slice(0, 8), recruiterKeyId: p.offer.recruiterKeyId, recruiterKeyRegisteredAt: e.registeredAt ? new Date(e.registeredAt).toISOString() : null,
      recruiterSignatureValid: !check.problems.some(x => /recruiter/i.test(x)), studentSignatureValid: !check.problems.some(x => /student|acceptance/i.test(x)),
      problems: check.problems,
    };
  });
  return { population: rows.length, seed, treeSize, treeRoot, sample, method: 'Entry numbers = SHA-256(seed | root | counter) mod population, skipping repeats, counter from 0. Population = accepted-offer entries in order.' };
}

/** The college's own audit of its accepted offers. A college auditing itself is weaker than an outside auditor, so the seed is returned and can be replaced. */
export async function auditSample(sql: Sql, orgId: string, k: number, seed: string = randomBytes(8).toString('hex')): Promise<AuditResult> {
  const rows = (await sql.query<any>(`SELECT e.seq, e.payload,
      (SELECT min(s.registered_at) FROM signing_keys s WHERE s.owner_kind = 'recruiter' AND s.key_id = e.payload -> 'offer' ->> 'recruiterKeyId') AS registered_at
    FROM ledger_entries e WHERE e.org_id = $1 AND e.kind = 'offer_accepted' ORDER BY e.seq`, [orgId])).rows;
  const head = (await sql.query<any>(`SELECT tree_size, root_hash FROM ledger_checkpoints WHERE org_id = $1 ORDER BY tree_size DESC LIMIT 1`, [orgId])).rows[0];
  if (rows.length === 0 || !head) throw new HttpError(409, 'There are no accepted offers in the ledger yet.');
  return auditFromRows(rows.map(r => ({ seq: r.seq, payload: r.payload, registeredAt: r.registered_at })), Number(head.tree_size), head.root_hash, k, seed);
}
