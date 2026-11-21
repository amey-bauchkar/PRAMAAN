import { FastifyInstance } from 'fastify';
import {
  canonicalJson, keyId as jwkKeyId, verifyEcdsaP256, offerHash, leafHash, inclusionProof, consistencyProof,
  Jwk, OfferStatement, AcceptanceStatement, PlacementEntry, merkleRoot, verifyConsistency, witnessText,
} from '@pramaan/domain';
import { Router, HttpError, OFFICER_ROLES, requireUuid, requireString, one, membershipId } from './http.js';
import { Db } from './db.js';
import { IssuerConfig } from './config.js';
import { studentForUser } from './services.js';
import { audit } from './audit.js';
import { grantFor } from './routes-recruiter.js';
import { appendLedger, verifyLedger, auditSample, auditFromRows, ledgerOrigin, issuerKeyId, studentRef } from './ledger.js';
import { randomBytes } from 'crypto';
import { DOMAIN_PROOF_PATH, DomainFetcher, httpsDomainFetcher, normaliseDomain, proofText } from './domain-proof.js';

const R = ['recruiter'] as const;
const S = ['student'] as const;
const OFFER_STAGES = ['shortlisted', 'interview_scheduled'];
const WINDOW_MS = 15 * 60_000;
const iso = (v: any) => (v ? new Date(v).toISOString() : null);


function publicJwk(v: any): Jwk {
  if (!v || v.kty !== 'EC' || v.crv !== 'P-256' || typeof v.x !== 'string' || typeof v.y !== 'string' || 'd' in v) {
    throw new HttpError(400, 'Send a P-256 public key (without the private part).');
  }
  return { kty: 'EC', crv: 'P-256', x: v.x, y: v.y };
}
function nearNow(at: unknown, what: string): string {
  const t = typeof at === 'string' ? Date.parse(at) : NaN;
  if (!Number.isFinite(t) || Math.abs(Date.now() - t) > WINDOW_MS) throw new HttpError(400, `The ${what} time must be within 15 minutes of now. Check your device clock.`);
  return new Date(t).toISOString();
}

async function registerKey(sql: any, orgId: string, kind: 'recruiter' | 'student' | 'witness', ownerId: string, body: any) {
  const jwk = publicJwk(body.publicJwk);
  const id = jwkKeyId(jwk);
  await sql.query(`INSERT INTO signing_keys (org_id, owner_kind, owner_id, key_id, public_jwk) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (org_id, owner_kind, owner_id, key_id) DO NOTHING`, [orgId, kind, ownerId, id, JSON.stringify(jwk)]);
  return id;
}
export function registerLedgerRoutes(r: Router, app: FastifyInstance, db: Db, issuer: IssuerConfig | null, opts: { domainFetcher?: DomainFetcher } = {}) {
  const domainFetcher = opts.domainFetcher ?? httpsDomainFetcher;
  const needIssuer = () => { if (!issuer) throw new HttpError(501, 'The placement ledger needs a signing key (PRAMAAN_ISSUER_SEED).'); };
  const keyOf = async (sql: any, org: string, kind: 'recruiter' | 'student' | 'witness', owner: string, id: string): Promise<Jwk> => {
    const k = (await sql.query(`SELECT public_jwk FROM signing_keys WHERE org_id = $1 AND owner_kind = $2 AND owner_id = $3 AND key_id = $4 AND status = 'active'`, [org, kind, owner, id])).rows[0];
    if (!k) throw new HttpError(400, 'That signing key is not registered for you. Register it first.');
    return k.public_jwk as Jwk;
  };

  // ---------- Keys ----------
  r.post('/api/v2/recruiter/keys', R, async ({ ctx, sql, body }) => {
    const id = await registerKey(sql, ctx.orgId, 'recruiter', await membershipId(sql, ctx), body);
    await audit(sql, ctx, 'SIGNING_KEY_REGISTERED', 'signing_key', null, { owner: 'recruiter', keyId: id });
    return { keyId: id };
  });
  // A recruiter can show that the holder of a key controls a company domain. The server reads a file the company publishes.
  r.get('/api/v2/recruiter/keys', R, async ({ ctx, sql }) => {
    const rows = (await sql.query<any>(`SELECT key_id, domain, domain_challenge, domain_verified_at, registered_at FROM signing_keys WHERE org_id = $1 AND owner_kind = 'recruiter' AND owner_id = $2 AND status = 'active' ORDER BY registered_at`, [ctx.orgId, await membershipId(sql, ctx)])).rows;
    return rows.map(k => ({
      keyId: k.key_id, domain: k.domain, verifiedAt: iso(k.domain_verified_at), registeredAt: iso(k.registered_at),
      proof: k.domain && !k.domain_verified_at ? { url: `https://${k.domain}${DOMAIN_PROOF_PATH}`, content: proofText(k.key_id, k.domain_challenge) } : null,
    }));
  });
  r.post('/api/v2/recruiter/keys/domain', R, async ({ ctx, sql, body }) => {
    const domain = normaliseDomain(body.domain);
    if (!domain) throw new HttpError(400, 'Enter your company’s website name, for example example.com. IP addresses and local names are not accepted.');
    const keyId = requireString(body.keyId, 'keyId');
    const challenge = randomBytes(12).toString('hex');
    const res = await sql.query(`UPDATE signing_keys SET domain = $5, domain_challenge = $6, domain_verified_at = NULL WHERE org_id = $1 AND owner_kind = 'recruiter' AND owner_id = $2 AND key_id = $3 AND status = $4 RETURNING key_id`, [ctx.orgId, await membershipId(sql, ctx), keyId, 'active', domain, challenge]);
    if (res.rows.length === 0) throw new HttpError(400, 'That signing key is not registered for you. Register it first.');
    await audit(sql, ctx, 'RECRUITER_DOMAIN_CLAIMED', 'signing_key', null, { keyId, domain });
    return { domain, url: `https://${domain}${DOMAIN_PROOF_PATH}`, content: proofText(keyId, challenge) };
  });
  r.post('/api/v2/recruiter/keys/domain/verify', R, async ({ ctx, sql, body }) => {
    const keyId = requireString(body.keyId, 'keyId');
    const k = (await sql.query<any>(`SELECT domain, domain_challenge FROM signing_keys WHERE org_id = $1 AND owner_kind = 'recruiter' AND owner_id = $2 AND key_id = $3 AND status = 'active'`, [ctx.orgId, await membershipId(sql, ctx), keyId])).rows[0];
    if (!k?.domain || !k.domain_challenge) throw new HttpError(400, 'Choose your company domain for this key first.');
    const expected = proofText(keyId, k.domain_challenge);
    let text: string;
    try { text = await domainFetcher(k.domain, expected); } catch (e: any) { throw new HttpError(422, `Could not read the file on ${k.domain}: ${e?.message ?? 'unreachable'}`); }
    if (!text.includes(expected)) throw new HttpError(422, `The file on ${k.domain} does not contain the expected line.`);
    await sql.query(`UPDATE signing_keys SET domain_verified_at = now() WHERE org_id = $1 AND owner_kind = 'recruiter' AND owner_id = $2 AND key_id = $3`, [ctx.orgId, await membershipId(sql, ctx), keyId]);
    await audit(sql, ctx, 'RECRUITER_DOMAIN_VERIFIED', 'signing_key', null, { keyId, domain: k.domain });
    return { domain: k.domain, message: `${k.domain} is verified for this key. It shows control of the domain, not that the company authorised you.` };
  });
  r.post('/api/v2/student/keys', S, async ({ ctx, sql, body }) => {
    const st = await studentForUser(sql, ctx);
    const id = await registerKey(sql, ctx.orgId, 'student', st.id, body);
    await audit(sql, ctx, 'SIGNING_KEY_REGISTERED', 'signing_key', null, { owner: 'student', keyId: id });
    return { keyId: id };
  });

  // ---------- Recruiter: sign an offer ----------
  const offerFor = async (sql: any, ctx: any, applicationId: string, ctcInr: number, issuedAt: string, keyId: string): Promise<{ statement: OfferStatement; driveId: string }> => {
    const mid = await membershipId(sql, ctx);
    const a = await one<any>(sql, `SELECT a.id, a.stage, a.student_id, a.drive_id, d.title, c.name AS company FROM applications a JOIN drives d ON d.id = a.drive_id JOIN companies c ON c.id = d.company_id WHERE a.id = $1`, [applicationId], 'Application not found.');
    await grantFor(sql, mid, a.drive_id);
    if (!OFFER_STAGES.includes(a.stage)) throw new HttpError(409, 'An offer can only be made to a shortlisted candidate.');
    const consent = (await sql.query(`SELECT 1 FROM consent_grants WHERE student_id = $1 AND purpose = 'recruiter_sharing' AND revoked_at IS NULL`, [a.student_id])).rows[0];
    if (!consent) throw new HttpError(403, 'This student has not agreed to share with recruiters.');
    if ((await sql.query(`SELECT 1 FROM offers WHERE application_id = $1`, [a.id])).rows[0]) throw new HttpError(409, 'An offer already exists for this application.');
    if (!(ctcInr > 0) || !Number.isFinite(ctcInr)) throw new HttpError(400, 'Enter the CTC in rupees per year.');
    await keyOf(sql, ctx.orgId, 'recruiter', mid, keyId);
    return { driveId: a.drive_id, statement: { v: 1, type: 'offer', orgId: ctx.orgId, driveId: a.drive_id, applicationId: a.id, studentRef: studentRef(ctx.orgId, a.student_id),
      company: String(a.company).replace('[SYNTHETIC] ', ''), role: String(a.title).replace('[SYNTHETIC] ', ''), ctcInr: Math.round(ctcInr), issuedAt, recruiterKeyId: keyId } };
  };

  r.get('/api/v2/recruiter/offers', R, async ({ ctx, sql, query }) => {
    const mid = await membershipId(sql, ctx);
    const driveId = requireUuid(query.driveId, 'driveId');
    await grantFor(sql, mid, driveId);
    const rows = (await sql.query<any>(`SELECT a.id, a.stage, u.full_name, f.ctc_inr, f.status AS offer_status, f.signed
      FROM applications a JOIN students s ON s.id = a.student_id JOIN users u ON u.id = s.user_id LEFT JOIN offers f ON f.application_id = a.id
      WHERE a.drive_id = $1 AND (a.stage IN ('shortlisted','interview_scheduled') OR f.id IS NOT NULL)
        AND EXISTS (SELECT 1 FROM consent_grants c WHERE c.student_id = s.id AND c.purpose = 'recruiter_sharing' AND c.revoked_at IS NULL) ORDER BY u.full_name`, [driveId])).rows;
    return rows.map(x => ({ applicationId: x.id, name: String(x.full_name).replace(' [SYNTHETIC]', ''), stage: x.stage, offer: x.ctc_inr ? { ctc: Number(x.ctc_inr), status: x.offer_status, signed: !!x.signed } : null }));
  });
  r.post('/api/v2/recruiter/offers/prepare', R, async ({ ctx, sql, body }) => {
    const { statement } = await offerFor(sql, ctx, requireUuid(body.applicationId, 'applicationId'), Number(body.ctcInr), new Date().toISOString(), requireString(body.keyId, 'keyId', 8, 32));
    return { statement, canonical: canonicalJson(statement) };
  });
  r.post('/api/v2/recruiter/offers', R, async ({ ctx, sql, body }) => {
    needIssuer();
    const st = body.statement as OfferStatement;
    if (!st || typeof st !== 'object') throw new HttpError(400, 'Send the statement you signed.');
    const issuedAt = nearNow(st.issuedAt, 'signing');
    const { statement, driveId } = await offerFor(sql, ctx, requireUuid(body.applicationId, 'applicationId'), Number(st.ctcInr), issuedAt, String(st.recruiterKeyId));
    if (canonicalJson(statement) !== canonicalJson(st)) throw new HttpError(400, 'The signed statement does not match the real application. Prepare it again.');
    const jwk = await keyOf(sql, ctx.orgId, 'recruiter', await membershipId(sql, ctx), statement.recruiterKeyId);
    const sig = requireString(body.signature, 'signature', 40, 200);
    if (!verifyEcdsaP256(jwk, canonicalJson(statement), sig)) throw new HttpError(400, 'The signature does not match this offer.');
    const offerId = (await sql.query<any>(`INSERT INTO offers (application_id, ctc_inr, signed) VALUES ($1,$2,TRUE) RETURNING id`, [statement.applicationId, statement.ctcInr])).rows[0].id;
    await sql.query(`INSERT INTO signed_offers (offer_id, org_id, statement, offer_hash, recruiter_sig, recruiter_key) VALUES ($1,$2,$3,$4,$5,$6)`, [offerId, ctx.orgId, JSON.stringify(statement), offerHash(statement), sig, JSON.stringify(jwk)]);
    await sql.query(`UPDATE applications SET stage = 'offered', updated_at = now(), ctc_inr = $2 WHERE id = $1`, [statement.applicationId, statement.ctcInr]);
    await sql.query(`INSERT INTO application_events (application_id, from_stage, to_stage, actor_membership_id, note) VALUES ($1,$2,'offered',$3,'Offer signed by the recruiter')`, [statement.applicationId, 'shortlisted', await membershipId(sql, ctx)]);
    await audit(sql, ctx, 'OFFER_SIGNED_BY_RECRUITER', 'application', statement.applicationId, { driveId, offerHash: offerHash(statement) });
    return { offerHash: offerHash(statement), message: 'Offer signed and sent. It counts as a verified placement once the student signs their acceptance.' };
  });

  // ---------- Student: see offers, sign the acceptance, keep the receipt ----------
  const receiptFor = async (sql: any, orgId: string, seq: number) => {
    const leaves = (await sql.query(`SELECT leaf_hash FROM ledger_entries WHERE org_id = $1 ORDER BY seq`, [orgId])).rows.map((x: any) => x.leaf_hash as string);
    const head = (await sql.query(`SELECT tree_size, root_hash, signed_at, signature, key_id FROM ledger_checkpoints WHERE org_id = $1 ORDER BY tree_size DESC LIMIT 1`, [orgId])).rows[0];
    const entry = (await sql.query(`SELECT payload FROM ledger_entries WHERE org_id = $1 AND seq = $2`, [orgId, seq])).rows[0];
    const size = Number(head.tree_size);
    const used = leaves.slice(0, size);
    return { ledger: ledgerOrigin(orgId), seq, entry: entry.payload, leafHash: leafHash(entry.payload), treeSize: size, proof: inclusionProof(used, seq - 1),
      checkpoint: { origin: ledgerOrigin(orgId), size, root: head.root_hash, at: iso(head.signed_at), signature: head.signature, keyId: head.key_id } };
  };

  r.get('/api/v2/student/offers', S, async ({ ctx, sql }) => {
    const st = await studentForUser(sql, ctx);
    const rows = (await sql.query<any>(`SELECT a.id AS application_id, f.id AS offer_id, f.ctc_inr, f.status, f.signed, f.ledger_seq, d.title, c.name AS company, so.offer_hash
      FROM applications a JOIN offers f ON f.application_id = a.id JOIN drives d ON d.id = a.drive_id JOIN companies c ON c.id = d.company_id LEFT JOIN signed_offers so ON so.offer_id = f.id
      WHERE a.student_id = $1 ORDER BY f.extended_at DESC`, [st.id])).rows;
    const out = [];
    for (const x of rows) {
      out.push({ applicationId: x.application_id, company: String(x.company).replace('[SYNTHETIC] ', ''), role: String(x.title).replace('[SYNTHETIC] ', ''), ctcInr: Number(x.ctc_inr), status: x.status, signed: !!x.signed,
        needsSignature: !!x.signed && x.status === 'extended', offerHash: x.offer_hash ?? null, receipt: x.ledger_seq ? await receiptFor(sql, ctx.orgId, Number(x.ledger_seq)) : null });
    }
    return out;
  });
  const acceptanceFor = async (sql: any, ctx: any, applicationId: string, keyId: string, acceptedAt: string) => {
    const st = await studentForUser(sql, ctx);
    const o = await one<any>(sql, `SELECT f.id, f.status, f.signed, so.offer_hash FROM applications a JOIN offers f ON f.application_id = a.id JOIN signed_offers so ON so.offer_id = f.id WHERE a.id = $1 AND a.student_id = $2`, [applicationId, st.id], 'Signed offer not found.');
    if (o.status !== 'extended') throw new HttpError(409, 'This offer was already answered.');
    const key = await keyOf(sql, ctx.orgId, 'student', st.id, keyId);
    const acceptance: AcceptanceStatement = { v: 1, type: 'accept', offerHash: o.offer_hash, acceptedAt, studentKeyId: keyId };
    return { acceptance, key, offerId: o.id as string };
  };
  r.post('/api/v2/student/offers/:applicationId/accept/prepare', S, async ({ ctx, sql, params, body }) => {
    const { acceptance } = await acceptanceFor(sql, ctx, requireUuid(params.applicationId, 'application id'), requireString(body.keyId, 'keyId', 8, 32), new Date().toISOString());
    return { acceptance, canonical: canonicalJson(acceptance) };
  });
  r.post('/api/v2/student/offers/:applicationId/accept', S, async ({ ctx, sql, params, body }) => {
    needIssuer();
    const given = body.acceptance as AcceptanceStatement;
    if (!given || typeof given !== 'object') throw new HttpError(400, 'Send the statement you signed.');
    const at = nearNow(given.acceptedAt, 'signing');
    const applicationId = requireUuid(params.applicationId, 'application id');
    const { acceptance, key, offerId } = await acceptanceFor(sql, ctx, applicationId, String(given.studentKeyId), at);
    if (canonicalJson(acceptance) !== canonicalJson(given)) throw new HttpError(400, 'The signed statement does not match the offer. Prepare it again.');
    const sig = requireString(body.signature, 'signature', 40, 200);
    if (!verifyEcdsaP256(key, canonicalJson(acceptance), sig)) throw new HttpError(400, 'The signature does not match this acceptance.');
    const so = (await sql.query<any>(`SELECT statement, recruiter_sig, recruiter_key FROM signed_offers WHERE offer_id = $1`, [offerId])).rows[0];
    const entry: Omit<PlacementEntry, 'kind'> = { offer: so.statement, recruiterSig: so.recruiter_sig, recruiterKey: so.recruiter_key, acceptance, studentSig: sig, studentKey: key };
    const added = await appendLedger(sql, ctx, { kind: 'offer_accepted', ...entry });
    await sql.query(`UPDATE offers SET status = 'accepted', responded_at = now(), ledger_seq = $2 WHERE id = $1`, [offerId, added.seq]);
    await sql.query(`UPDATE applications SET stage = 'offer_accepted', updated_at = now() WHERE id = $1`, [applicationId]);
    await sql.query(`INSERT INTO application_events (application_id, from_stage, to_stage, note) VALUES ($1,'offered','offer_accepted','Student signed the acceptance')`, [applicationId]);
    await audit(sql, ctx, 'OFFER_ACCEPTED_SIGNED', 'application', applicationId, { ledgerSeq: added.seq });
    return { receipt: await receiptFor(sql, ctx.orgId, added.seq), message: 'Accepted. Your signed receipt is in the placement ledger. Keep it: it proves this placement without asking the college.' };
  });

  // ---------- Placement office: the ledger, a full check, and an auditor's random sample ----------
  r.get('/api/v2/tpo/ledger', OFFICER_ROLES, async ({ ctx, sql }) => {
    const entries = (await sql.query<any>(`SELECT seq, kind, payload, leaf_hash, created_at FROM ledger_entries WHERE org_id = $1 ORDER BY seq DESC LIMIT 100`, [ctx.orgId])).rows;
    const head = (await sql.query<any>(`SELECT tree_size, root_hash, signed_at, signature, key_id FROM ledger_checkpoints WHERE org_id = $1 ORDER BY tree_size DESC LIMIT 1`, [ctx.orgId])).rows[0];
    const counts = (await sql.query<any>(`SELECT kind, count(*)::int AS n FROM ledger_entries WHERE org_id = $1 GROUP BY kind`, [ctx.orgId])).rows;
    const recorded = (await sql.query<any>(`SELECT (SELECT count(DISTINCT a.student_id)::int FROM offers f JOIN applications a ON a.id = f.application_id WHERE f.status = 'accepted' AND NOT f.signed)
      + (SELECT count(DISTINCT o.student_id)::int FROM student_outcomes o WHERE o.outcome_type = 'placed'
           AND NOT EXISTS (SELECT 1 FROM offers f JOIN applications a ON a.id = f.application_id WHERE a.student_id = o.student_id AND f.signed AND f.status = 'accepted')) AS n`)).rows[0].n;
    const summary = (e: any) => e.kind === 'offer_accepted' ? `${e.payload.offer.company}: ${e.payload.offer.role}, signed by recruiter and student`
      : e.kind === 'rule_published' ? `Rules version ${e.payload.versionNo} published (${e.payload.eligible} of ${e.payload.population} eligible)` : `Decisions published for ${e.payload.count} students`;
    return { origin: ledgerOrigin(ctx.orgId), orgId: ctx.orgId, head: head ? { size: Number(head.tree_size), root: head.root_hash, signedAt: iso(head.signed_at), keyId: head.key_id } : null,
      counts: Object.fromEntries(counts.map(c => [c.kind, c.n])), verifiedPlacements: Number((counts.find(c => c.kind === 'offer_accepted')?.n) ?? 0), collegeRecordedPlacements: Number(recorded),
      entries: entries.map(e => ({ seq: Number(e.seq), kind: e.kind, summary: summary(e), leafHash: String(e.leaf_hash).slice(0, 16), at: iso(e.created_at) })) };
  });
  r.post('/api/v2/tpo/ledger/verify', OFFICER_ROLES, async ({ ctx, sql }) => {
    const rep = await verifyLedger(sql, ctx.orgId, issuer);
    await audit(sql, ctx, 'LEDGER_VERIFIED', 'organization', ctx.orgId, { valid: rep.valid, problems: rep.problems.length });
    return rep;
  });
  r.post('/api/v2/tpo/ledger/audit', OFFICER_ROLES, async ({ ctx, sql, body }) => {
    const k = Math.min(25, Math.max(1, Number(body.k) || 5));
    const seed = typeof body.seed === 'string' && body.seed.trim() ? body.seed.trim().slice(0, 100) : undefined;
    const res = await auditSample(sql, ctx.orgId, k, seed);
    await audit(sql, ctx, 'LEDGER_SAMPLE_AUDITED', 'organization', ctx.orgId, { population: res.population, sampled: res.sample.length, failed: res.sample.filter(s => s.problems.length).length, seed: res.seed });
    return { ...res, note: 'This is the college checking itself. An outside auditor should use their own seed, or the witnessing university can run the same audit. Names are never stored in the ledger. To confirm an offer, contact the company on contact details you got yourself and ask them to check the recruiter key fingerprint shown here.' };
  });

  // ---------- University: witness the college's log ----------
  const U = ['university_admin'] as const;
  r.post('/api/v2/university/witness/key', U, async ({ ctx, sql, body }) => {
    const id = await registerKey(sql, ctx.orgId, 'witness', await membershipId(sql, ctx), body);
    await audit(sql, ctx, 'WITNESS_KEY_REGISTERED', 'signing_key', null, { keyId: id });
    return { keyId: id };
  });
  r.get('/api/v2/university/witness', U, async ({ sql }) => {
    const rows = (await sql.query<any>(`SELECT * FROM witness_colleges()`)).rows;
    return { colleges: rows.map(x => ({ collegeId: x.college_id, name: String(x.college_name).replace('[SYNTHETIC] ', ''), size: Number(x.tree_size), root: x.root_hash, signedAt: iso(x.signed_at),
      witnessedSize: x.witnessed_size === null ? null : Number(x.witnessed_size), witnessedAt: iso(x.witnessed_at), upToDate: x.witnessed_size !== null && Number(x.witnessed_size) === Number(x.tree_size) })) };
  });
  /** Checks that the college's log still matches what this university witnessed before, then returns the exact text to sign. */
  r.post('/api/v2/university/witness/prepare', U, async ({ ctx, sql, body }) => {
    const collegeId = requireUuid(body.collegeId, 'collegeId');
    const keyId = requireString(body.keyId, 'keyId', 8, 32);
    await keyOf(sql, ctx.orgId, 'witness', await membershipId(sql, ctx), keyId);
    const row = (await sql.query<any>(`SELECT * FROM witness_colleges() WHERE college_id = $1`, [collegeId])).rows[0];
    if (!row) throw new HttpError(404, 'That college is not under your university or has no ledger yet.');
    const size = Number(row.tree_size);
    if (row.witnessed_size !== null && Number(row.witnessed_size) === size) throw new HttpError(409, 'You already witnessed the newest state of this college.');
    const leaves = (await sql.query<any>(`SELECT leaf_hash FROM public_ledger_leaves($1) ORDER BY seq`, [collegeId])).rows.map(l => l.leaf_hash as string);
    if (row.witnessed_size !== null) {
      const m = Number(row.witnessed_size);
      const was = (await sql.query<any>(`SELECT root_hash FROM public_ledger_checkpoints($1) WHERE tree_size = $2`, [collegeId, m])).rows[0];
      if (!was || merkleRoot(leaves.slice(0, m)) !== was.root_hash || !verifyConsistency(m, size, was.root_hash, row.root_hash, consistencyProof(leaves.slice(0, size), m))) {
        throw new HttpError(409, `This college's log no longer matches the state of ${m} entries you witnessed. History was rewritten. Do not sign. Tell the college and the auditor.`);
      }
    }
    if (merkleRoot(leaves.slice(0, size)) !== row.root_hash) throw new HttpError(409, "The published entries do not match the college's own signed state. Do not sign.");
    const cp = { origin: ledgerOrigin(collegeId), size, root: row.root_hash as string, at: iso(row.signed_at)! };
    // The witness's own browser should repeat these checks from the public data before it signs. The server's verdict is only a convenience.
    return { checkpoint: cp, serverChecked: true, previouslyWitnessed: row.witnessed_size === null ? null : Number(row.witnessed_size), college: String(row.college_name).replace('[SYNTHETIC] ', '') };
  });
  r.post('/api/v2/university/witness/cosign', U, async ({ ctx, sql, body }) => {
    const collegeId = requireUuid(body.collegeId, 'collegeId');
    const keyId = requireString(body.keyId, 'keyId', 8, 32);
    const size = Number(body.size), root = requireString(body.root, 'root', 64, 64);
    const jwk = await keyOf(sql, ctx.orgId, 'witness', await membershipId(sql, ctx), keyId);
    const cp = (await sql.query<any>(`SELECT * FROM public_ledger_checkpoints($1) WHERE tree_size = $2`, [collegeId, size])).rows[0];
    if (!cp || cp.root_hash !== root) throw new HttpError(404, 'The college has no signed state with that size and root.');
    const sig = requireString(body.signature, 'signature', 40, 200);
    const at = nearNow(body.at, 'witnessing');
    if (!verifyEcdsaP256(jwk, witnessText({ origin: ledgerOrigin(collegeId), size, root, at: iso(cp.signed_at)! }, keyId, at), sig)) throw new HttpError(400, 'The signature does not match.');
    await sql.query(`SELECT witness_cosign($1, $2, $3, $4, $5, $6)`, [collegeId, size, root, keyId, sig, at]);
    await audit(sql, ctx, 'LEDGER_WITNESSED', 'organization', collegeId, { size });
    return { message: `Witnessed. From now on a rewrite of the first ${size} entries shows up as a mismatch with your signature, even if the log is signed again.` };
  });
  /** The witnessing university audits a sample itself, with its own seed, instead of relying on the college to audit itself. */
  r.post('/api/v2/university/witness/audit', U, async ({ ctx, sql, body }) => {
    const collegeId = requireUuid(body.collegeId, 'collegeId');
    const row = (await sql.query<any>(`SELECT * FROM witness_colleges() WHERE college_id = $1`, [collegeId])).rows[0];
    if (!row) throw new HttpError(404, 'That college is not under your university or has no ledger yet.');
    const rows = (await sql.query<any>(`SELECT * FROM witness_college_offers($1)`, [collegeId])).rows;
    if (rows.length === 0) throw new HttpError(409, 'This college has no accepted offers in its ledger yet.');
    const seed = typeof body.seed === 'string' && body.seed.trim() ? body.seed.trim().slice(0, 100) : randomBytes(8).toString('hex');
    const res = auditFromRows(rows.map(x => ({ seq: x.seq, payload: x.payload, registeredAt: x.key_registered_at, domain: x.key_domain })), Number(row.tree_size), row.root_hash, Math.min(25, Math.max(1, Number(body.k) || 5)), seed);
    await audit(sql, ctx, 'LEDGER_SAMPLE_AUDITED_BY_UNIVERSITY', 'organization', collegeId, { population: res.population, sampled: res.sample.length, failed: res.sample.filter(s => s.problems.length).length, seed });
    return { ...res, college: String(row.college_name).replace('[SYNTHETIC] ', ''), note: 'Pick the seed yourself after the college has published its signed state. To confirm an offer, contact the company on contact details you got yourself and ask them to check the recruiter key fingerprint shown here.' };
  });

  // ---------- Public: anyone can recompute the tree from the published leaf hashes ----------
  // A verifier must never see a stale log, so browsers and proxies may not keep these responses.
  app.addHook('onSend', async (req, reply) => { if (req.url.startsWith('/api/public/ledger')) reply.header('cache-control', 'no-store'); });
  const pub = async <T>(orgId: string, f: (sql: any) => Promise<T>) => db.withPublic(f);
  const loadPublic = async (orgId: string) => pub(orgId, async sql => ({
    head: (await sql.query(`SELECT * FROM public_ledger_head($1)`, [orgId])).rows[0],
    leaves: (await sql.query(`SELECT * FROM public_ledger_leaves($1)`, [orgId])).rows as any[],
    cps: (await sql.query(`SELECT * FROM public_ledger_checkpoints($1)`, [orgId])).rows as any[],
    wit: (await sql.query(`SELECT * FROM public_ledger_witnesses($1)`, [orgId])).rows as any[],
  }));
  const uuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

  app.get('/api/public/ledger/:orgId', async (req, reply) => {
    const orgId = String((req.params as any).orgId);
    if (!uuid(orgId)) return reply.status(400).send({ error: 'Invalid college id.' });
    const { head, leaves, cps, wit } = await loadPublic(orgId);
    if (!head) return reply.status(404).send({ error: 'No ledger for this college yet.' });
    const counts: Record<string, number> = {};
    for (const l of leaves) counts[l.kind] = (counts[l.kind] ?? 0) + 1;
    return { college: String(head.org_name).replace('[SYNTHETIC] ', ''), origin: ledgerOrigin(orgId), checkpoint: { origin: ledgerOrigin(orgId), size: Number(head.tree_size), root: head.root_hash, at: iso(head.signed_at), signature: head.signature, keyId: head.key_id },
      witnesses: wit.map(w => ({ name: String(w.witness_name).replace('[SYNTHETIC] ', ''), keyId: w.witness_key_id, publicKey: w.public_jwk, size: Number(w.tree_size), root: w.root_hash, signature: w.signature, at: iso(w.cosigned_at), checkpointAt: iso(cps.find(c => Number(c.tree_size) === Number(w.tree_size))?.signed_at) })),
      issuerPublicKeyPem: issuer?.publicKeyPem ?? null, issuerKeyId: issuer ? issuerKeyId(issuer) : null, counts, note: 'Only hashes are published. Nothing in this ledger identifies a student.' };
  });
  app.get('/api/public/ledger/:orgId/leaves', async (req, reply) => {
    const orgId = String((req.params as any).orgId);
    if (!uuid(orgId)) return reply.status(400).send({ error: 'Invalid college id.' });
    const { leaves, cps } = await loadPublic(orgId);
    return { leaves: leaves.map(l => ({ seq: Number(l.seq), kind: l.kind, leafHash: l.leaf_hash, at: iso(l.created_at) })),
      checkpoints: cps.map(c => ({ size: Number(c.tree_size), root: c.root_hash, at: iso(c.signed_at), signature: c.signature, keyId: c.key_id })) };
  });
  app.get('/api/public/ledger/:orgId/proof', async (req, reply) => {
    const orgId = String((req.params as any).orgId);
    const seq = Number((req.query as any)?.seq);
    if (!uuid(orgId) || !Number.isInteger(seq) || seq < 1) return reply.status(400).send({ error: 'Give a college id and an entry number.' });
    const { head, leaves } = await loadPublic(orgId);
    if (!head || seq > leaves.length) return reply.status(404).send({ error: 'No such entry.' });
    const size = Number(head.tree_size);
    return { seq, treeSize: size, leafHash: leaves[seq - 1].leaf_hash, proof: inclusionProof(leaves.slice(0, size).map(l => l.leaf_hash), seq - 1), root: head.root_hash };
  });
  app.get('/api/public/ledger/:orgId/consistency', async (req, reply) => {
    const orgId = String((req.params as any).orgId);
    const from = Number((req.query as any)?.from), to = Number((req.query as any)?.to);
    if (!uuid(orgId) || !Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) return reply.status(400).send({ error: 'Give two sizes, from and to, with from not after to.' });
    const { leaves, cps } = await loadPublic(orgId);
    const a = cps.find(c => Number(c.tree_size) === from), b = cps.find(c => Number(c.tree_size) === to);
    if (!a || !b) return reply.status(404).send({ error: 'No signed checkpoint exists for one of those sizes.' });
    const hashes = leaves.map(l => l.leaf_hash);
    return { from, to, fromRoot: a.root_hash, toRoot: b.root_hash, proof: consistencyProof(hashes.slice(0, to), from) };
  });
}

