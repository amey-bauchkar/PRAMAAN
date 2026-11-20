import { randomUUID, createHash } from 'crypto';
import {
  SessionContext, EvidenceItem, EvidenceKind, StudentAcademicSnapshot, EligibilityRuleSpecSchema,
  EligibilityRuleVersion, PROOF_LEVEL_RANK, ProofLevel, SkillState,
} from '@pramaan/contracts';
import { SkillStateMachine, VerificationResultInput, EligibilityEvaluator, DriveRuleContext } from '@pramaan/domain';
import { Sql } from './db.js';
import { HttpError } from './http.js';
import { audit } from './audit.js';
import { appendLedger, ledgerEnabled, studentRef } from './ledger.js';
import { merkleRoot, leafHash } from '@pramaan/domain';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function studentForUser(sql: Sql, ctx: SessionContext): Promise<{ id: string; departmentId: string; fullName: string; enrollmentNo: string; isMinor: boolean }> {
  const r = await sql.query<any>(
    `SELECT s.id, s.department_id, u.full_name, s.enrollment_no, student_is_minor(s.id) AS is_minor
       FROM students s JOIN users u ON u.id = s.user_id WHERE s.user_id = $1 AND s.org_id = $2`, [ctx.userId, ctx.orgId]);
  if (!r.rows[0]) throw new HttpError(404, 'No student record for this account in this college.');
  const x = r.rows[0];
  return { id: x.id, departmentId: x.department_id, fullName: x.full_name, enrollmentNo: x.enrollment_no, isMinor: !!x.is_minor };
}

async function rowsToEvidence(sql: Sql, studentSkillId: string): Promise<EvidenceItem[]> {
  const r = await sql.query<any>(
    `SELECT e.id, e.student_id, e.kind, e.content_hash, e.status, e.valid_until, e.created_at
       FROM skill_evidence se JOIN evidence_items e ON e.id = se.evidence_id WHERE se.student_skill_id = $1`, [studentSkillId]);
  return r.rows.map(x => ({
    id: x.id, studentId: x.student_id, kind: x.kind, contentHash: x.content_hash, status: x.status,
    validUntil: x.valid_until ? new Date(x.valid_until).toISOString() : null, createdAt: new Date(x.created_at).toISOString(),
  }));
}

const MODALITY: Record<VerificationResultInput['type'], string> = {
  code_backed: 'code_backed', issuer_verified: 'issuer_verified', assessment: 'test_score', probe: 'probe', viva: 'defence', attestation: 'mentor',
};

export interface AwardInput {
  studentId: string;
  skillSlug?: string;
  skillId?: string;
  evidence: { kind: EvidenceKind; description: string; source: string; contentHash?: string; path?: string | null; validDays?: number };
  verification?: Omit<VerificationResultInput, 'verificationId' | 'outcome' | 'completedAt'>;
  reasonCode: string;
  level?: number;
  /** Signals that are not pinned to a specific artifact (e.g. platform stats) only make a skill Observed. */
  observeOnly?: boolean;
  /** Completes an existing in-progress verification session (Live Mutation Probe) instead of creating one. */
  sessionId?: string;
}

export interface AwardResult { skillId: string; skillName: string; studentSkillId: string; state: SkillState; proofLevel: ProofLevel | null; validUntil: string | null; message: string; evidenceId: string }

/**
 * The Evidence Bus: every module records proof through this one function. It stores the evidence,
 * links it to the skill, and moves the skill through the deterministic state machine. The database
 * trigger re-checks every Verified transition. Nothing here is decided by a model.
 */
export async function awardProof(sql: Sql, ctx: SessionContext, input: AwardInput): Promise<AwardResult> {
  const sk = await sql.query<{ id: string; canonical_name: string; half_life_days: number }>(
    input.skillId ? `SELECT id, canonical_name, half_life_days FROM skills WHERE id = $1` : `SELECT id, canonical_name, half_life_days FROM skills WHERE slug = $1`,
    [input.skillId ?? input.skillSlug]);
  if (!sk.rows[0]) throw new HttpError(400, `Unknown skill ${input.skillSlug ?? input.skillId}.`);
  const skill = sk.rows[0];

  let ss = (await sql.query<any>(`SELECT * FROM student_skills WHERE student_id = $1 AND skill_id = $2`, [input.studentId, skill.id])).rows[0];
  if (!ss) {
    const id = randomUUID();
    await sql.query(`INSERT INTO student_skills (id, student_id, skill_id, state, level) VALUES ($1,$2,$3,'claimed',$4)`, [id, input.studentId, skill.id, input.level ?? 1]);
    ss = (await sql.query<any>(`SELECT * FROM student_skills WHERE id = $1`, [id])).rows[0];
  }

  const evidenceId = randomUUID();
  const validDays = input.evidence.validDays ?? skill.half_life_days;
  await sql.query(
    `INSERT INTO evidence_items (id, student_id, kind, content_hash, status, path, accepted_at, valid_until, description, source)
     VALUES ($1,$2,$3,$4,'accepted',$5, now(), now() + ($6 || ' days')::interval, $7, $8)`,
    [evidenceId, input.studentId, input.evidence.kind, input.evidence.contentHash ?? sha256(`${evidenceId}:${input.evidence.description}`),
      input.evidence.path ?? null, String(validDays), input.evidence.description, input.evidence.source]);
  await sql.query(`INSERT INTO skill_evidence (student_skill_id, evidence_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [ss.id, evidenceId]);

  const event = async (from: string, to: string, reason: string, verificationId: string | null, proof: string | null) => {
    await sql.query(`INSERT INTO skill_state_events (student_skill_id, from_state, to_state, reason_code, actor_type, actor_id, verification_id, proof_level)
      VALUES ($1,$2,$3,$4,'evaluator_service',$5,$6,$7)`, [ss.id, from, to, reason, ctx.userId, verificationId, proof]);
  };

  let state: SkillState = ss.state;
  if (input.observeOnly) {
    if (state === 'claimed') {
      await sql.query(`UPDATE student_skills SET state = 'observed' WHERE id = $1`, [ss.id]);
      await event('claimed', 'observed', input.reasonCode, null, null);
      state = 'observed';
    }
    return { skillId: skill.id, skillName: skill.canonical_name, studentSkillId: ss.id, state, proofLevel: ss.proof_level ?? null,
      validUntil: ss.valid_until ? new Date(ss.valid_until).toISOString() : null, message: `${skill.canonical_name}: signal recorded (${state.replace('_', '-')}).`, evidenceId };
  }
  if (state === 'claimed' || state === 'observed') {
    const t = SkillStateMachine.transition({
      studentSkillId: ss.id, studentId: input.studentId, currentState: state, targetState: 'evidence_linked',
      actorType: 'evaluator_service', reasonCode: 'EVIDENCE_ACCEPTED', acceptedEvidence: await rowsToEvidence(sql, ss.id),
    });
    if (!t.success) throw new HttpError(400, t.error ?? 'Could not link evidence.');
    await sql.query(`UPDATE student_skills SET state = 'evidence_linked' WHERE id = $1`, [ss.id]);
    await event(state, 'evidence_linked', 'EVIDENCE_ACCEPTED', null, null);
    state = 'evidence_linked';
  }

  let proofLevel: ProofLevel | null = ss.proof_level ?? null;
  let validUntil: string | null = ss.valid_until ? new Date(ss.valid_until).toISOString() : null;
  let message = `${skill.canonical_name}: evidence recorded.`;

  if (input.verification) {
    const verificationId = input.sessionId ?? randomUUID();
    const completedAt = new Date().toISOString();
    const t = SkillStateMachine.transition({
      studentSkillId: ss.id, studentId: input.studentId, currentState: state,
      currentStateSince: ss.state_since ? new Date(ss.state_since).toISOString() : undefined,
      targetState: 'verified', actorType: 'evaluator_service', actorId: ctx.userId, reasonCode: input.reasonCode,
      acceptedEvidence: await rowsToEvidence(sql, ss.id),
      verificationResult: { ...input.verification, verificationId, outcome: 'passed', completedAt },
      halfLifeDays: skill.half_life_days,
    });
    const newRank = t.proofLevel ? PROOF_LEVEL_RANK[t.proofLevel] : 0;
    const curRank = state === 'verified' && proofLevel ? PROOF_LEVEL_RANK[proofLevel] : 0;
    if (!t.success) {
      message = `${skill.canonical_name}: evidence recorded; not verified (${t.error}).`;
    } else if (state === 'verified' && newRank < curRank) {
      message = `${skill.canonical_name}: already Verified at a higher proof level; new evidence added.`;
    } else {
      const rubric = await sql.query<{ id: string }>(`SELECT id FROM rubric_versions WHERE skill_id = $1 ORDER BY version_no DESC LIMIT 1`, [skill.id]);
      if (!rubric.rows[0]) throw new HttpError(500, `No rubric configured for ${skill.canonical_name}.`);
      if (input.sessionId) {
        await sql.query(`UPDATE verification_sessions SET completed_at = $2, outcome = 'passed', modality = $3 WHERE id = $1 AND student_skill_id = $4`,
          [verificationId, completedAt, MODALITY[input.verification.type], ss.id]);
      } else {
        await sql.query(`INSERT INTO verification_sessions (id, student_skill_id, rubric_version_id, modality, started_at, completed_at, outcome)
          VALUES ($1,$2,$3,$4,$5,$5,'passed')`, [verificationId, ss.id, rubric.rows[0].id, MODALITY[input.verification.type], completedAt]);
      }
      await sql.query(`UPDATE student_skills SET state = 'verified', proof_level = $2, valid_until = $3, last_verification_id = $4, level = GREATEST(level, $5) WHERE id = $1`,
        [ss.id, t.proofLevel, t.validUntil, verificationId, input.level ?? 1]);
      await event(state, 'verified', input.reasonCode, verificationId, t.proofLevel ?? null);
      await audit(sql, ctx, 'SKILL_VERIFIED', 'student_skill', ss.id, { skill: skill.canonical_name, proofLevel: t.proofLevel, method: input.verification.type, studentId: input.studentId });
      state = 'verified'; proofLevel = t.proofLevel ?? null; validUntil = t.validUntil ?? null;
      message = `${skill.canonical_name} is now Verified (${String(proofLevel).replace('_', ' ')}).`;
    }
  }

  return { skillId: skill.id, skillName: skill.canonical_name, studentSkillId: ss.id, state, proofLevel, validUntil, message, evidenceId };
}

/** Frozen input for eligibility evaluation; stored with each decision for reproducibility. */
export async function academicSnapshot(sql: Sql, studentId: string): Promise<StudentAcademicSnapshot> {
  const m = await academicSnapshots(sql, [studentId]);
  const s = m.get(studentId);
  if (!s) throw new HttpError(404, 'Student not found.');
  return s;
}

/** Loads snapshots for many students with two queries in total (instead of two per student). */
export async function academicSnapshots(sql: Sql, studentIds: string[]): Promise<Map<string, StudentAcademicSnapshot>> {
  const out = new Map<string, StudentAcademicSnapshot>();
  if (studentIds.length === 0) return out;
  const r = await sql.query<any>(`
    SELECT s.id, s.graduating_year, s.disciplinary_hold, d.code AS branch,
           a.cgpa, a.tenth_pct, a.twelfth_pct, a.diploma_pct, a.gap_years, a.active_backlogs, a.backlog_history,
           (SELECT count(*)::int FROM applications ap WHERE ap.student_id = s.id AND ap.stage = 'offer_accepted')
             + (SELECT count(*)::int FROM student_outcomes o WHERE o.student_id = s.id AND o.outcome_type = 'placed') AS offers,
           GREATEST((SELECT max(o.ctc_inr) FROM student_outcomes o WHERE o.student_id = s.id AND o.outcome_type = 'placed'),
                    (SELECT max(f.ctc_inr) FROM offers f JOIN applications ap ON ap.id = f.application_id WHERE ap.student_id = s.id AND f.status = 'accepted')) AS top_ctc
      FROM students s JOIN departments d ON d.id = s.department_id
      LEFT JOIN LATERAL (SELECT * FROM academic_records x WHERE x.student_id = s.id ORDER BY x.as_of DESC LIMIT 1) a ON TRUE
     WHERE s.id = ANY($1::uuid[])`, [studentIds]);
  const skills = await sql.query<any>(`SELECT ss.student_id, ss.skill_id, k.canonical_name, ss.state, ss.level, ss.proof_level, ss.valid_until
    FROM student_skills ss JOIN skills k ON k.id = ss.skill_id WHERE ss.student_id = ANY($1::uuid[])`, [studentIds]);
  const n = (v: any) => (v === null || v === undefined ? null : Number(v));
  const skillsBy = new Map<string, any[]>();
  for (const s of skills.rows) (skillsBy.get(s.student_id) ?? skillsBy.set(s.student_id, []).get(s.student_id)!).push(s);
  for (const x of r.rows) out.set(x.id, {
    studentId: x.id, cgpa: n(x.cgpa), tenthPct: n(x.tenth_pct), twelfthPct: n(x.twelfth_pct), diplomaPct: n(x.diploma_pct),
    gapYears: n(x.gap_years), activeBacklogs: n(x.active_backlogs), backlogHistory: n(x.backlog_history),
    branch: x.branch, graduatingYear: x.graduating_year,
    skills: (skillsBy.get(x.id) ?? []).map(s => ({ skillId: s.skill_id, name: s.canonical_name, state: s.state, level: s.level ?? 1, proofLevel: s.proof_level, validUntil: s.valid_until ? new Date(s.valid_until).toISOString() : null })),
    offersHeld: x.offers ?? 0, highestOfferCtcInr: n(x.top_ctc), disciplinaryHold: !!x.disciplinary_hold,
  });
  return out;
}

export async function driveContexts(sql: Sql, where = `d.status IN ('scheduled', 'draft')`, params: unknown[] = []): Promise<(DriveRuleContext & { status: string; company: string; ctc: number | null; publishedAt: string | null })[]> {
  const r = await sql.query<any>(`
    SELECT d.id, d.title, d.status, d.starts_at, d.ctc_inr, d.decisions_published_at, c.name AS company,
           v.id AS rv_id, v.rule_set_id, v.version_no, v.rules, v.rationale, v.published_by, v.published_at
      FROM drives d JOIN companies c ON c.id = d.company_id
      JOIN eligibility_rule_versions v ON v.id = d.rule_version_id
     WHERE ${where} ORDER BY d.starts_at`, params);
  return r.rows.map(x => ({
    driveId: x.id, title: x.title.replace('[SYNTHETIC] ', ''), status: x.status, company: x.company.replace('[SYNTHETIC] ', ''),
    ctc: x.ctc_inr ? Number(x.ctc_inr) : null, publishedAt: x.decisions_published_at ? new Date(x.decisions_published_at).toISOString() : null,
    startsAt: new Date(x.starts_at).toISOString(),
    ruleVersion: {
      id: x.rv_id, ruleSetId: x.rule_set_id, versionNo: x.version_no, rules: EligibilityRuleSpecSchema.parse(x.rules),
      rationale: x.rationale, publishedBy: x.published_by, publishedAt: new Date(x.published_at).toISOString(),
    } as EligibilityRuleVersion,
  }));
}

/**
 * Evaluates every student of the college against a drive's current rule version and stores one decision
 * each, with the frozen input snapshot and its hash. `publish` makes them visible to students.
 */
export async function evaluateDrive(sql: Sql, ctx: SessionContext, driveId: string, opts: { publish: boolean; studentIds?: string[] }): Promise<{ eligible: number; ineligible: number; needsReview: number }> {
  const [drive] = await driveContexts(sql, `d.id = $1`, [driveId]);
  if (!drive) throw new HttpError(404, 'Drive not found or has no rule version.');
  const students = opts.studentIds
    ? opts.studentIds
    : (await sql.query<{ id: string }>(`SELECT id FROM students WHERE org_id = $1`, [ctx.orgId])).rows.map(r => r.id);
  const counts = { eligible: 0, ineligible: 0, needsReview: 0 };
  const snaps = await academicSnapshots(sql, students);
  for (const sid of students) {
    const snap = snaps.get(sid);
    if (!snap) continue;
    const res = EligibilityEvaluator.evaluate(snap, drive.ruleVersion, { driveStartsAt: drive.startsAt });
    if (res.status === 'eligible') counts.eligible++; else if (res.status === 'ineligible') counts.ineligible++; else counts.needsReview++;
    await sql.query(`
      INSERT INTO eligibility_decisions (drive_id, student_id, rule_version_id, input_snapshot, input_hash, result, reasons, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (drive_id, student_id, rule_version_id) DO UPDATE SET
        input_snapshot = EXCLUDED.input_snapshot, input_hash = EXCLUDED.input_hash, result = EXCLUDED.result, reasons = EXCLUDED.reasons,
        status = CASE WHEN eligibility_decisions.status = 'overridden' THEN 'overridden'
                      WHEN eligibility_decisions.status = 'published' THEN 'published' ELSE EXCLUDED.status END,
        created_at = now()`,
      [driveId, sid, drive.ruleVersion.id, JSON.stringify(snap), res.inputHash, res.status, JSON.stringify({ reasonCodes: res.reasonCodes, checks: res.checks }), opts.publish ? 'published' : 'provisional']);
  }
  if (opts.publish && !opts.studentIds) {
    await sql.query(`UPDATE eligibility_decisions SET status = 'published' WHERE drive_id = $1 AND rule_version_id = $2 AND status = 'provisional'`, [driveId, drive.ruleVersion.id]);
    await sql.query(`UPDATE drives SET decisions_published_at = now() WHERE id = $1`, [driveId]);
    if (ledgerEnabled()) {
      // Commit the whole batch to the ledger: one leaf per decision, then the root of those leaves. A student can later check theirs is in it.
      const rows = (await sql.query<any>(`SELECT student_id, result, input_hash FROM eligibility_decisions WHERE drive_id = $1 AND rule_version_id = $2 ORDER BY student_id`, [driveId, drive.ruleVersion.id])).rows;
      const decisionsRoot = merkleRoot(rows.map(x => leafHash({ studentRef: studentRef(ctx.orgId, x.student_id), result: x.result, inputHash: x.input_hash })));
      await appendLedger(sql, ctx, { kind: 'decisions_published', driveId, ruleVersionId: drive.ruleVersion.id, count: rows.length, decisionsRoot, at: new Date().toISOString() });
    }
  }
  await audit(sql, ctx, opts.studentIds ? 'ELIGIBILITY_REEVALUATED' : opts.publish ? 'ELIGIBILITY_PUBLISHED' : 'ELIGIBILITY_EVALUATED', 'drive', driveId,
    { ruleVersionId: drive.ruleVersion.id, students: students.length, ...counts });
  return counts;
}

/**
 * After a student gains proof, re-applies the already-published rule versions to that student only,
 * so a new eligibility appears without waiting for the officer. The rules are the officer's approved
 * policy; overridden decisions are never touched.
 */
export async function reevaluateStudent(sql: Sql, ctx: SessionContext, studentId: string): Promise<void> {
  const published = await sql.query<{ id: string }>(`SELECT id FROM drives WHERE decisions_published_at IS NOT NULL AND status IN ('scheduled', 'draft') AND rule_version_id IS NOT NULL`);
  if (published.rows.length === 0) return;
  await asPolicyEngine(sql, ctx, async () => {
    for (const d of published.rows) await evaluateDrive(sql, ctx, d.id, { publish: true, studentIds: [studentId] });
  });
}

/**
 * Runs a server-side policy step with the eligibility engine's write permission (RLS sees 'officer'),
 * then restores the caller's role in the same transaction. Only server code can call it; the role is
 * never taken from a request. Used for re-applying already-published rules.
 */
export async function asPolicyEngine<T>(sql: Sql, ctx: SessionContext, fn: () => Promise<T>): Promise<T> {
  await sql.query(`SELECT set_config('app.current_user_role', 'officer', true)`);
  try {
    return await fn();
  } finally {
    await sql.query(`SELECT set_config('app.current_user_role', $1, true)`, [ctx.role]);
  }
}

export const displayName = (n: string) => n.replace(' [SYNTHETIC]', '');
