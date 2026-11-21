import { generateKeyPairSync, sign, KeyObject } from 'crypto';
import {
  canonicalJson, keyId, offerHash, leafHash, merkleRoot, signCheckpoint, witnessText, Jwk, OfferStatement, AcceptanceStatement,
} from '@pramaan/domain';
import { PgliteDb } from './db.js';
import { IssuerConfig } from './config.js';
import { appendLedger, studentRef, ledgerOrigin } from './ledger.js';

/**
 * Demo only. Gives the offline demo a ledger that already has history: some offers signed with demo keys that are
 * generated at start-up and thrown away, a university witness, and one shortlisted candidate who is waiting for a live offer.
 * Production never imports this file.
 */
function demoKey() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const j = publicKey.export({ format: 'jwk' }) as any;
  const jwk: Jwk = { kty: 'EC', crv: 'P-256', x: j.x, y: j.y };
  const signText = (t: string) => sign('sha256', Buffer.from(t), { key: privateKey as KeyObject, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return { jwk, id: keyId(jwk), signText };
}

export interface FeaturedCandidate { authSubject: string; name: string; applicationId: string }

export async function seedDemoLedger(db: PgliteDb): Promise<FeaturedCandidate | null> {
  const admin = db.admin;
  const officer = (await admin.query<any>(`SELECT m.user_id, m.org_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.auth_subject = 'demo|tpo-a'`)).rows[0];
  if (!officer) return null;
  const ctx = { userId: officer.user_id, orgId: officer.org_id, role: 'officer' as const };
  const recruiters = (await admin.query<any>(`SELECT m.id, u.auth_subject FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.auth_subject IN ('demo|recruiter-1', 'demo|recruiter-2') ORDER BY u.auth_subject`)).rows;
  if (recruiters.length === 0) return null;
  const recKeys = new Map(recruiters.map(r => [r.id as string, demoKey()]));

  await db.withTenant(ctx, async sql => {
    for (const r of recruiters) {
      const k = recKeys.get(r.id)!;
      // The demo company's domain is shown as verified. ".example" is reserved and never resolves: this is a stand-in for a real company site.
      await sql.query(`INSERT INTO signing_keys (org_id, owner_kind, owner_id, key_id, public_jwk, domain, domain_verified_at) VALUES ($1,'recruiter',$2,$3,$4,'medisys-health.example', now()) ON CONFLICT DO NOTHING`, [ctx.orgId, r.id, k.id, JSON.stringify(k.jwk)]);
    }
    const apps = (await sql.query<any>(`SELECT a.id, a.student_id, a.drive_id, d.title, c.name AS company, d.ctc_inr AS drive_ctc,
        (SELECT max(o.ctc_inr) FROM student_outcomes o WHERE o.student_id = a.student_id AND o.outcome_type = 'placed') AS outcome_ctc
      FROM applications a JOIN drives d ON d.id = a.drive_id JOIN companies c ON c.id = d.company_id
      WHERE a.stage = 'offered' AND NOT EXISTS (SELECT 1 FROM offers f WHERE f.application_id = a.id) ORDER BY a.id LIMIT 6`)).rows;
    let i = 0;
    for (const a of apps) {
      const rec = recruiters[i++ % recruiters.length];
      const rk = recKeys.get(rec.id)!, sk = demoKey();
      await sql.query(`INSERT INTO signing_keys (org_id, owner_kind, owner_id, key_id, public_jwk) VALUES ($1,'student',$2,$3,$4) ON CONFLICT DO NOTHING`, [ctx.orgId, a.student_id, sk.id, JSON.stringify(sk.jwk)]);
      const ctc = Math.round(Number(a.outcome_ctc ?? a.drive_ctc ?? 450000));
      const issuedAt = new Date(Date.now() - 36 * 3600_000).toISOString();
      const offer: OfferStatement = {
        v: 1, type: 'offer', orgId: ctx.orgId, driveId: a.drive_id, applicationId: a.id, studentRef: studentRef(ctx.orgId, a.student_id),
        company: String(a.company).replace('[SYNTHETIC] ', ''), role: String(a.title).replace('[SYNTHETIC] ', ''), ctcInr: ctc, issuedAt, recruiterKeyId: rk.id,
      };
      const acceptance: AcceptanceStatement = { v: 1, type: 'accept', offerHash: offerHash(offer), acceptedAt: new Date(Date.now() - 20 * 3600_000).toISOString(), studentKeyId: sk.id };
      const recruiterSig = rk.signText(canonicalJson(offer)), studentSig = sk.signText(canonicalJson(acceptance));
      const offerId = (await sql.query<any>(`INSERT INTO offers (application_id, ctc_inr, signed) VALUES ($1,$2,TRUE) RETURNING id`, [a.id, ctc])).rows[0].id;
      await sql.query(`INSERT INTO signed_offers (offer_id, org_id, statement, offer_hash, recruiter_sig, recruiter_key) VALUES ($1,$2,$3,$4,$5,$6)`,
        [offerId, ctx.orgId, JSON.stringify(offer), offerHash(offer), recruiterSig, JSON.stringify(rk.jwk)]);
      const added = await appendLedger(sql, ctx, { kind: 'offer_accepted', offer, recruiterSig, recruiterKey: rk.jwk, acceptance, studentSig, studentKey: sk.jwk });
      await sql.query(`UPDATE offers SET status = 'accepted', responded_at = now(), ledger_seq = $2 WHERE id = $1`, [offerId, added.seq]);
      await sql.query(`UPDATE applications SET stage = 'offer_accepted' WHERE id = $1`, [a.id]);
    }
  });

  // The featured candidate: shortlisted, shares with recruiters, and the demo recruiter has access to that drive.
  const c = (await admin.query<any>(`SELECT a.id, u.auth_subject, u.full_name FROM applications a JOIN students s ON s.id = a.student_id JOIN users u ON u.id = s.user_id
      JOIN recruiter_access_grants g ON g.drive_id = a.drive_id AND g.recruiter_membership_id = $1 AND g.expires_at > now()
     WHERE a.stage = 'shortlisted' AND u.auth_subject LIKE 'demo|%'
       AND EXISTS (SELECT 1 FROM consent_grants cg WHERE cg.student_id = s.id AND cg.purpose = 'recruiter_sharing' AND cg.revoked_at IS NULL)
     ORDER BY a.id LIMIT 1`, [recruiters.find(r => r.auth_subject === 'demo|recruiter-1')?.id ?? recruiters[0].id])).rows[0];
  return c ? { authSubject: c.auth_subject, name: String(c.full_name).replace(' [SYNTHETIC]', ''), applicationId: c.id } : null;
}

/** The university witnesses each college's current state with a throwaway key, so a rewrite can be shown being caught. */
export async function seedDemoWitness(db: PgliteDb): Promise<void> {
  const admin = db.admin;
  const uni = (await admin.query<any>(`SELECT m.id, m.user_id, m.org_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.auth_subject = 'demo|uni-admin'`)).rows[0];
  if (!uni) return;
  const cps = (await admin.query<any>(`SELECT DISTINCT ON (org_id) org_id, tree_size, root_hash, signed_at FROM ledger_checkpoints ORDER BY org_id, tree_size DESC`)).rows;
  const k = demoKey();
  const ctx = { userId: uni.user_id, orgId: uni.org_id, role: 'university_admin' as const };
  await db.withTenant(ctx, async sql => {
    await sql.query(`INSERT INTO signing_keys (org_id, owner_kind, owner_id, key_id, public_jwk) VALUES ($1,'witness',$2,$3,$4) ON CONFLICT DO NOTHING`, [ctx.orgId, uni.id, k.id, JSON.stringify(k.jwk)]);
    for (const c of cps) {
      const cp = { origin: ledgerOrigin(c.org_id), size: Number(c.tree_size), root: c.root_hash as string, at: new Date(c.signed_at).toISOString() };
      await sql.query(`SAVEPOINT w`);
      try {
        const at = new Date().toISOString();
        await sql.query(`SELECT witness_cosign($1,$2,$3,$4,$5,$6)`, [c.org_id, cp.size, cp.root, k.id, k.signText(witnessText(cp, k.id, at)), at]);
        await sql.query(`RELEASE SAVEPOINT w`);
      } catch {
        await sql.query(`ROLLBACK TO SAVEPOINT w`); // not a college of this university
      }
    }
  });
}

interface Saved {
  entries: { orgId: string; seq: number; payload: unknown; leaf: string }[];
  checkpoints: { orgId: string; size: number; root: string; signature: string }[];
}
let saved: Saved | null = null;

/**
 * The one college whose ledger the demo tampers with: the college of the demo placement officer, which is also the one
 * that has signed offers and a university witness. Every demo college has a ledger, so without this the buttons could hit a
 * different college's log from the one on screen.
 */
export async function demoLedgerOrg(db: PgliteDb): Promise<string | null> {
  const row = (await db.admin.query<any>(`SELECT m.org_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.auth_subject = 'demo|tpo-a' AND EXISTS (SELECT 1 FROM ledger_entries e WHERE e.org_id = m.org_id) LIMIT 1`)).rows[0];
  return row?.org_id ?? null;
}

/** Demo only: plays a dishonest insider with database access who triples one salary and recomputes that entry's hash. */
export async function demoTamper(db: PgliteDb): Promise<{ tampered: boolean; seq?: number; was?: number; now?: number }> {
  const admin = db.admin;
  if (saved) return { tampered: true, seq: saved.entries[0]?.seq };
  const orgId = await demoLedgerOrg(db);
  if (!orgId) return { tampered: false };
  const row = (await admin.query<any>(`SELECT org_id, seq, payload, leaf_hash FROM ledger_entries WHERE org_id = $1 AND kind = 'offer_accepted' ORDER BY seq LIMIT 1`, [orgId])).rows[0];
  if (!row) return { tampered: false };
  const forged = { ...row.payload, offer: { ...row.payload.offer, ctcInr: row.payload.offer.ctcInr * 3 } };
  saved = { entries: [{ orgId: row.org_id, seq: Number(row.seq), payload: row.payload, leaf: row.leaf_hash }], checkpoints: [] };
  await admin.query(`SET session_replication_role = replica`);
  await admin.query(`UPDATE ledger_entries SET payload = $3, leaf_hash = $4 WHERE org_id = $1 AND seq = $2`, [row.org_id, row.seq, JSON.stringify(forged), leafHash(forged)]);
  await admin.query(`SET session_replication_role = origin`);
  return { tampered: true, seq: Number(row.seq), was: row.payload.offer.ctcInr, now: forged.offer.ctcInr };
}

/**
 * Demo only: whoever runs the log, holding its signing key, rewrites a committed batch of decisions and signs every
 * checkpoint it touches again. The log's own checks all pass. Only the university's earlier witness signature gives it away.
 */
export async function demoRewrite(db: PgliteDb, issuer: IssuerConfig): Promise<{ rewritten: boolean; seq?: number }> {
  const admin = db.admin;
  if (saved) return { rewritten: true, seq: saved.entries[0]?.seq };
  const orgId = await demoLedgerOrg(db);
  if (!orgId) return { rewritten: false };
  const row = (await admin.query<any>(`SELECT org_id, seq, payload, leaf_hash FROM ledger_entries WHERE org_id = $1 AND kind = 'decisions_published' ORDER BY seq LIMIT 1`, [orgId])).rows[0];
  if (!row) return { rewritten: false };
  const forged = { ...row.payload, decisionsRoot: leafHash({ rewritten: true, was: row.payload.decisionsRoot }) };
  const cps = (await admin.query<any>(`SELECT tree_size, root_hash, signature, signed_at FROM ledger_checkpoints WHERE org_id = $1 ORDER BY tree_size`, [row.org_id])).rows;
  saved = {
    entries: [{ orgId: row.org_id, seq: Number(row.seq), payload: row.payload, leaf: row.leaf_hash }],
    checkpoints: cps.map(c => ({ orgId: row.org_id, size: Number(c.tree_size), root: c.root_hash, signature: c.signature })),
  };
  await admin.query(`SET session_replication_role = replica`);
  await admin.query(`UPDATE ledger_entries SET payload = $3, leaf_hash = $4 WHERE org_id = $1 AND seq = $2`, [row.org_id, row.seq, JSON.stringify(forged), leafHash(forged)]);
  const hashes = (await admin.query<any>(`SELECT leaf_hash FROM ledger_entries WHERE org_id = $1 ORDER BY seq`, [row.org_id])).rows.map(r => r.leaf_hash as string);
  for (const c of cps.filter(x => Number(x.tree_size) >= Number(row.seq))) {
    const size = Number(c.tree_size), root = merkleRoot(hashes.slice(0, size));
    const signature = signCheckpoint({ origin: ledgerOrigin(row.org_id), size, root, at: new Date(c.signed_at).toISOString() }, issuer.privateKey);
    await admin.query(`UPDATE ledger_checkpoints SET root_hash = $3, signature = $4 WHERE org_id = $1 AND tree_size = $2`, [row.org_id, size, root, signature]);
  }
  await admin.query(`SET session_replication_role = origin`);
  return { rewritten: true, seq: Number(row.seq) };
}

export async function demoRestore(db: PgliteDb): Promise<{ restored: boolean }> {
  if (!saved) return { restored: false };
  const admin = db.admin;
  await admin.query(`SET session_replication_role = replica`);
  for (const e of saved.entries) await admin.query(`UPDATE ledger_entries SET payload = $3, leaf_hash = $4 WHERE org_id = $1 AND seq = $2`, [e.orgId, e.seq, JSON.stringify(e.payload), e.leaf]);
  for (const c of saved.checkpoints) await admin.query(`UPDATE ledger_checkpoints SET root_hash = $3, signature = $4 WHERE org_id = $1 AND tree_size = $2`, [c.orgId, c.size, c.root, c.signature]);
  await admin.query(`SET session_replication_role = origin`);
  saved = null;
  return { restored: true };
}
