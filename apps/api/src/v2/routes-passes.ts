import { randomUUID, createHash } from 'crypto';
import { FastifyInstance } from 'fastify';
import { issueSdJwt, verifySdJwt } from '@pramaan/domain';
import { EligibilityRuleSpecSchema } from '@pramaan/contracts';
import { Router, HttpError, requireUuid, one } from './http.js';
import { Db } from './db.js';
import { IssuerConfig } from './config.js';
import { studentForUser, displayName } from './services.js';
import { audit } from './audit.js';

/** RFC 7638 JWK thumbprint for a P-256 public key. */
function thumbprint(jwk: any): string {
  if (jwk?.kty !== 'EC' || jwk?.crv !== 'P-256' || typeof jwk.x !== 'string' || typeof jwk.y !== 'string' || jwk.d) {
    throw new HttpError(400, 'holderJwk must be a P-256 public key (no private part).');
  }
  return createHash('sha256').update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })).digest('base64url');
}

const PASS_DAYS = 7;
export const PASS_VCT = 'urn:pramaan:eligibility-pass:1';

/**
 * Turns the published decision into signed predicates. Each predicate states the drive's requirement and
 * that it is met, never the student's underlying value. Exact values (name, CGPA, branch) are separate,
 * optional disclosures. Gender, category and date of birth are never put in a pass.
 */
function predicates(rules: any, checks: any[], skills: Map<string, { name: string; slug: string }>): Record<string, string> {
  const r = EligibilityRuleSpecSchema.parse(rules);
  const passed = new Set(checks.filter(c => c.passed === true).map(c => c.id));
  const out: Record<string, string> = {};
  const add = (id: string, key: string, text: string) => { if (passed.has(id)) out[key] = text; };
  if (r.academics.minCgpa !== undefined) add('academics.minCgpa', 'meets_min_cgpa', `CGPA ≥ ${r.academics.minCgpa}`);
  if (r.academics.minTenthPct !== undefined) add('academics.minTenthPct', 'meets_min_10th', `10th ≥ ${r.academics.minTenthPct}%`);
  if (r.academics.minTwelfthOrDiplomaPct !== undefined) add('academics.minTwelfthOrDiplomaPct', 'meets_min_12th_or_diploma', `12th or diploma ≥ ${r.academics.minTwelfthOrDiplomaPct}%`);
  if (r.academics.maxGapYears !== undefined) add('academics.maxGapYears', 'within_gap_limit', `Education gap ≤ ${r.academics.maxGapYears} year(s)`);
  if (r.backlogs.maxActive !== undefined) add('backlogs.maxActive', 'within_active_backlogs', `Active backlogs ≤ ${r.backlogs.maxActive}`);
  if (r.backlogs.maxHistory !== undefined) add('backlogs.maxHistory', 'within_backlog_history', `Past backlogs ≤ ${r.backlogs.maxHistory}`);
  if (r.branches.length) add('branch', 'branch_eligible', `Branch is one of ${r.branches.join(', ')}`);
  if (r.graduatingYears.length) add('graduatingYear', 'graduating_year_eligible', `Graduating in ${r.graduatingYears.join(' or ')}`);
  for (const s of r.skills) {
    const k = skills.get(s.skillId);
    add(`skills.${s.skillId}`, `skill_${(k?.slug ?? s.skillId).replace(/-/g, '_')}`, `${s.name} Verified with proof ≥ ${s.minProof}`);
  }
  if (r.policy.maxOffersHeld !== undefined) add('policy.maxOffersHeld', 'within_offer_policy', `Holds ≤ ${r.policy.maxOffersHeld} offer(s)`);
  return out;
}

export function registerPassRoutes(r: Router, app: FastifyInstance, db: Db, issuer: IssuerConfig | null) {
  const S = ['student'] as const;

  r.post('/api/v2/student/passes', S, async ({ ctx, sql, body }) => {
    if (!issuer) throw new HttpError(501, 'Pass signing is not configured (PRAMAAN_ISSUER_SEED).');
    const st = await studentForUser(sql, ctx);
    const driveId = requireUuid(body.driveId, 'driveId');
    const thumb = thumbprint(body.holderJwk);
    const dec = await one<any>(sql, `SELECT ed.id, ed.result, ed.reasons, ed.input_snapshot, ed.created_at, v.version_no, v.rules, d.title, c.name AS company, o.name AS college
      FROM eligibility_decisions ed JOIN drives d ON d.id = ed.drive_id AND d.rule_version_id = ed.rule_version_id JOIN eligibility_rule_versions v ON v.id = ed.rule_version_id
      JOIN companies c ON c.id = d.company_id JOIN organizations o ON o.id = d.org_id
      WHERE ed.drive_id = $1 AND ed.student_id = $2 AND ed.status IN ('published', 'overridden') ORDER BY ed.created_at DESC LIMIT 1`, [driveId, st.id], 'No published eligibility for this drive.');
    if (dec.result !== 'eligible') throw new HttpError(409, 'A pass can only be issued for a drive you are eligible for.');
    const skills = new Map<string, { name: string; slug: string }>(
      (await sql.query<any>(`SELECT id, canonical_name, slug FROM skills WHERE id = ANY($1)`, [(dec.rules.skills ?? []).map((s: any) => s.skillId)])).rows.map(x => [x.id, { name: x.canonical_name, slug: x.slug }]));
    const preds = predicates(dec.rules, dec.reasons.checks ?? [], skills);
    const exact: Record<string, unknown> = {
      name: displayName(st.fullName), branch: dec.input_snapshot.branch, graduating_year: dec.input_snapshot.graduatingYear,
      cgpa: dec.input_snapshot.cgpa,
    };
    const passId = randomUUID();
    const keyId = `urn:pramaan:issuer:${ctx.orgId}#key-1`;
    await sql.query(`INSERT INTO issuer_keys (id, org_id, public_key_pem) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`, [keyId, ctx.orgId, issuer.publicKeyPem]);
    const exp = Math.floor(Date.now() / 1000) + PASS_DAYS * 86_400;
    const { sdJwt } = issueSdJwt({
      issuer: `urn:pramaan:issuer:${ctx.orgId}`, kid: keyId, privateKey: issuer.privateKey, vct: PASS_VCT, holderJwk: {
        kty: 'EC', crv: 'P-256', x: body.holderJwk.x, y: body.holderJwk.y,
      }, exp,
      visible: { jti: passId, college: dec.college.replace('[SYNTHETIC] ', ''), drive: dec.title.replace('[SYNTHETIC] ', ''), company: dec.company.replace('[SYNTHETIC] ', ''),
        eligible: true, rule_version: dec.version_no, decided_at: new Date(dec.created_at).toISOString() },
      selective: { ...preds, ...exact },
      decoys: 4,
    });
    await sql.query(`INSERT INTO eligibility_passes (id, org_id, student_id, drive_id, decision_id, issuer_key_id, holder_key_thumbprint, selective_claims, expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8, to_timestamp($9))`, [passId, ctx.orgId, st.id, driveId, dec.id, keyId, thumb, Object.keys({ ...preds, ...exact }), exp]);
    await audit(sql, ctx, 'ELIGIBILITY_PASS_ISSUED', 'eligibility_pass', passId, { driveId, claims: Object.keys(preds).length });
    return { id: passId, sdJwt, expiresAt: new Date(exp * 1000).toISOString(), predicates: preds, exact: Object.keys(exact) };
  });

  r.get('/api/v2/student/passes', S, async ({ ctx, sql }) => {
    const st = await studentForUser(sql, ctx);
    const rows = (await sql.query<any>(`SELECT p.id, p.status, p.issued_at, p.expires_at, p.selective_claims, d.title FROM eligibility_passes p JOIN drives d ON d.id = p.drive_id
      WHERE p.student_id = $1 ORDER BY p.issued_at DESC`, [st.id])).rows;
    return rows.map(x => ({ id: x.id, drive: x.title.replace('[SYNTHETIC] ', ''), status: x.status, issuedAt: x.issued_at, expiresAt: x.expires_at, claims: x.selective_claims }));
  });

  r.post('/api/v2/student/passes/:id/revoke', S, async ({ ctx, sql, params }) => {
    const st = await studentForUser(sql, ctx);
    await one(sql, `UPDATE eligibility_passes SET status = 'revoked', revoked_at = now() WHERE id = $1 AND student_id = $2 RETURNING id`, [requireUuid(params.id, 'id'), st.id], 'Pass not found.');
    await audit(sql, ctx, 'ELIGIBILITY_PASS_REVOKED', 'eligibility_pass', params.id, {});
    return { status: 'revoked' };
  });

  // ---------- Public verifier (no account needed) ----------
  app.post('/api/public/pass-requests', async (req, reply) => {
    const verifier = String((req.body as any)?.verifier ?? '').trim().slice(0, 80);
    if (verifier.length < 3) return reply.status(400).send({ error: 'Give the verifier a name (e.g. your company).' });
    const audience = `pramaan-verifier:${verifier}`;
    const row = await db.withPublic(async sql => (await sql.query<any>(`SELECT * FROM create_pass_request($1)`, [audience])).rows[0]);
    const requestCode = Buffer.from(JSON.stringify({ n: row.nonce, a: row.audience })).toString('base64url');
    return { nonce: row.nonce, audience: row.audience, requestCode, expiresInMinutes: 15 };
  });

  app.post('/api/public/passes/verify', async (req, reply) => {
    const presentation = String((req.body as any)?.presentation ?? '').trim();
    if (presentation.length < 20 || presentation.length > 20_000) return reply.status(400).send({ error: 'Paste the full pass presentation.' });
    let kbPayload: any, issuerPayload: any;
    try {
      const parts = presentation.split('~');
      issuerPayload = JSON.parse(Buffer.from(parts[0].split('.')[1], 'base64url').toString('utf8'));
      kbPayload = JSON.parse(Buffer.from(parts[parts.length - 1].split('.')[1], 'base64url').toString('utf8'));
    } catch { return reply.status(400).send({ error: 'This is not a PRAMAAN pass presentation.' }); }
    if (issuerPayload?.vct !== PASS_VCT) return reply.status(400).send({ error: 'Not an Eligibility Pass.' });

    const out = await db.withPublic(async sql => {
      const status = (await sql.query<any>(`SELECT * FROM public_pass_status($1)`, [String(issuerPayload.jti)])).rows[0];
      const audience = (await sql.query<any>(`SELECT consume_pass_request($1) AS a`, [String(kbPayload?.nonce ?? '')])).rows[0]?.a ?? null;
      return { status, audience };
    });
    const errors: string[] = [];
    if (!out.status) return reply.status(404).send({ error: 'Unknown pass.' });
    if (out.status.status !== 'active') errors.push('The student has revoked this pass.');
    if (!out.audience) errors.push('The request code was already used, expired, or never issued: ask for a fresh presentation.');
    const r = verifySdJwt(presentation, { issuerPublicKeyPem: out.status.public_key_pem, expectedAud: out.audience ?? '__none__', expectedNonce: kbPayload?.nonce, requireKeyBinding: true });
    const allErrors = [...new Set([...errors, ...r.errors])];
    return { valid: allErrors.length === 0, errors: allErrors, visible: r.visible, disclosed: r.disclosed, hiddenCount: r.hiddenCount, keyBound: r.keyBound, verifier: out.audience };
  });
}
