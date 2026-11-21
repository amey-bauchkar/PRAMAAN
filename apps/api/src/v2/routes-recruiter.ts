
import { matchCandidates, SkillFilter } from '@pramaan/domain';
import { MinProof } from '@pramaan/contracts';
import { Router, HttpError, OFFICER_ROLES, requireUuid, requireString, one, membershipId } from './http.js';
import { Sql } from './db.js';
import { audit, recordAgentRun } from './audit.js';
import { displayName, studentForUser } from './services.js';

const iso = (v: any) => (v ? new Date(v).toISOString() : null);

/** Drives this recruiter may see: an officer-approved, unexpired access grant is required. */
export async function grantFor(sql: Sql, membership: string, driveId: string) {
  const g = (await sql.query<any>(`SELECT g.id, g.expires_at FROM recruiter_access_grants g WHERE g.recruiter_membership_id = $1 AND g.drive_id = $2 AND g.expires_at > now()`, [membership, driveId])).rows[0];
  if (!g) throw new HttpError(403, 'No active access grant for this drive. Ask the placement office.');
  return g;
}

/** Students a recruiter may see for a drive: eligible or applied, with active recruiter-sharing consent; minors only with verified guardian consent. */
export const SHAREABLE = `
  s.id IN (SELECT student_id FROM eligibility_decisions WHERE drive_id = $1 AND result = 'eligible' AND status IN ('published', 'overridden')
           UNION SELECT student_id FROM applications WHERE drive_id = $1)
  AND EXISTS (SELECT 1 FROM consent_grants c WHERE c.student_id = s.id AND c.purpose = 'recruiter_sharing' AND c.revoked_at IS NULL)
  AND (NOT student_is_minor(s.id) OR EXISTS (SELECT 1 FROM guardian_consents gc WHERE gc.student_id = s.id AND gc.status = 'verified'))`;

export function registerRecruiterRoutes(r: Router) {
  const R = ['recruiter'] as const;

  r.get('/api/v2/recruiter/drives', R, async ({ ctx, sql }) => {
    const mid = await membershipId(sql, ctx);
    const rows = (await sql.query<any>(`SELECT d.id, d.title, d.status, d.starts_at, c.name AS company, g.expires_at,
        (SELECT count(*)::int FROM applications a WHERE a.drive_id = d.id) AS applications
      FROM recruiter_access_grants g JOIN drives d ON d.id = g.drive_id JOIN companies c ON c.id = d.company_id
      WHERE g.recruiter_membership_id = $1 AND g.expires_at > now() ORDER BY d.starts_at`, [mid])).rows;
    const skills = (await sql.query<any>(`SELECT slug, canonical_name AS name, category FROM skills WHERE slug IS NOT NULL ORDER BY canonical_name`)).rows;
    return { drives: rows.map(x => ({ id: x.id, title: x.title.replace('[SYNTHETIC] ', ''), company: x.company.replace('[SYNTHETIC] ', ''), status: x.status, startsAt: iso(x.starts_at), accessUntil: iso(x.expires_at), applications: x.applications })), skills };
  });

  r.get('/api/v2/recruiter/search', R, async ({ ctx, sql, query }) => {
    const mid = await membershipId(sql, ctx);
    const driveId = requireUuid(query.driveId, 'driveId');
    await grantFor(sql, mid, driveId);
    const filters: SkillFilter[] = [];
    const maxAge = query.maxAgeDays ? Number(query.maxAgeDays) : undefined;
    for (const part of String(query.skills ?? '').split(',').filter(Boolean)) {
      const [slug, proof] = part.split(':');
      const k = (await sql.query<any>(`SELECT id, canonical_name FROM skills WHERE slug = $1`, [slug])).rows[0];
      if (k) filters.push({ skillId: k.id, name: k.canonical_name, minProof: (['L1', 'L2', 'L3'].includes(proof) ? proof : 'L1') as MinProof, maxAgeDays: maxAge });
    }
    if (filters.length === 0) throw new HttpError(400, 'Choose at least one skill.');
    const pool = (await sql.query<any>(`SELECT s.id, u.full_name, d.code AS branch FROM students s JOIN users u ON u.id = s.user_id JOIN departments d ON d.id = s.department_id WHERE ${SHAREABLE}`, [driveId])).rows;
    const skills = (await sql.query<any>(`SELECT ss.student_id, ss.skill_id, k.canonical_name, ss.state, ss.proof_level, ss.valid_until,
        (SELECT max(e.occurred_at) FROM skill_state_events e WHERE e.student_skill_id = ss.id AND e.to_state = 'verified') AS verified_at
      FROM student_skills ss JOIN skills k ON k.id = ss.skill_id WHERE ss.student_id = ANY($1) AND ss.skill_id = ANY($2)`, [pool.map(p => p.id), filters.map(f => f.skillId)])).rows;
    const results = matchCandidates(pool.map(p => ({ studentId: p.id, displayName: displayName(p.full_name), branch: p.branch,
      skills: skills.filter(s => s.student_id === p.id).map(s => ({ skillId: s.skill_id, name: s.canonical_name, state: s.state, proofLevel: s.proof_level, verifiedAt: iso(s.verified_at), validUntil: iso(s.valid_until) })) })), filters);
    await audit(sql, ctx, 'RECRUITER_SEARCH', 'drive', driveId, { filters: filters.map(f => `${f.name}:${f.minProof}`), results: results.length });
    return { results, poolSize: pool.length, sortOrder: 'Most filters matched first, then the most recently verified proof, then name. There is no hidden score.' };
  });

  r.get('/api/v2/recruiter/candidates/:id', R, async ({ ctx, sql, params, query }) => {
    const mid = await membershipId(sql, ctx);
    const driveId = requireUuid(query.driveId, 'driveId');
    await grantFor(sql, mid, driveId);
    const s = (await sql.query<any>(`SELECT s.id, u.full_name, d.name AS department, d.code AS branch, s.graduating_year, a.cgpa
      FROM students s JOIN users u ON u.id = s.user_id JOIN departments d ON d.id = s.department_id
      LEFT JOIN LATERAL (SELECT cgpa FROM academic_records x WHERE x.student_id = s.id ORDER BY as_of DESC LIMIT 1) a ON TRUE
      WHERE s.id = $2 AND ${SHAREABLE}`, [driveId, requireUuid(params.id, 'student id')])).rows[0];
    if (!s) throw new HttpError(404, 'Candidate not available: not in this drive, or has not consented to share with recruiters.');
    const skills = (await sql.query<any>(`SELECT ss.id, k.canonical_name AS name, ss.proof_level, ss.valid_until, ss.level,
        (SELECT max(e.occurred_at) FROM skill_state_events e WHERE e.student_skill_id = ss.id AND e.to_state = 'verified') AS verified_at
      FROM student_skills ss JOIN skills k ON k.id = ss.skill_id WHERE ss.student_id = $1 AND ss.state = 'verified' ORDER BY ss.proof_level DESC, k.canonical_name`, [s.id])).rows;
    const evidence = (await sql.query<any>(`SELECT se.student_skill_id, e.kind, e.description, e.path, e.content_hash, e.created_at FROM skill_evidence se JOIN evidence_items e ON e.id = se.evidence_id
      WHERE se.student_skill_id = ANY($1) AND e.status = 'accepted' ORDER BY e.created_at DESC`, [skills.map(x => x.id)])).rows;
    const mock = (await sql.query<any>(`SELECT role_title, report, completed_at FROM mock_attempts WHERE student_id = $1 AND status = 'completed' ORDER BY completed_at DESC LIMIT 1`, [s.id])).rows[0];
    const app = (await sql.query<any>(`SELECT id, stage FROM applications WHERE drive_id = $1 AND student_id = $2`, [driveId, s.id])).rows[0];
    await audit(sql, ctx, 'EVIDENCE_CARD_VIEWED', 'student', s.id, { driveId });
    return {
      id: s.id, name: displayName(s.full_name), department: s.department, branch: s.branch, graduatingYear: s.graduating_year, cgpa: s.cgpa ? Number(s.cgpa) : null,
      skills: skills.map(k => ({ name: k.name, proofLevel: k.proof_level, level: k.level, verifiedAt: iso(k.verified_at), validUntil: iso(k.valid_until),
        evidence: evidence.filter(e => e.student_skill_id === k.id).slice(0, 4).map(e => ({ kind: e.kind, description: e.description ?? (e.path ? `Code: ${e.path}` : e.kind), path: e.path, hash: String(e.content_hash).slice(0, 12), at: iso(e.created_at) })) })),
      mock: mock ? { role: mock.role_title, rounds: mock.report?.rounds ?? [], at: iso(mock.completed_at) } : null,
      application: app ?? null,
      note: 'Each skill shows how it was proven and when. Proof levels: Level 1 code found, Level 2 tested, Level 3 explained or mentor approved.',
    };
  });

  r.post('/api/v2/recruiter/shortlist', R, async ({ ctx, sql, body }) => {
    const mid = await membershipId(sql, ctx);
    const driveId = requireUuid(body.driveId, 'driveId');
    await grantFor(sql, mid, driveId);
    const ids: string[] = Array.isArray(body.studentIds) ? body.studentIds.filter((x: unknown) => typeof x === 'string').slice(0, 200) : [];
    if (ids.length === 0) throw new HttpError(400, 'Select at least one candidate.');
    const ok = (await sql.query<any>(`SELECT student_id FROM applications WHERE drive_id = $1 AND student_id = ANY($2) AND stage IN ('applied', 'assessment')`, [driveId, ids])).rows.map(x => x.student_id);
    if (ok.length === 0) throw new HttpError(409, 'None of the selected students has applied to this drive yet.');
    const run = await recordAgentRun(sql, ctx, 'Recruiter request', [{ tool: 'request_shortlist', input: { driveId, requested: ids.length }, output: { applicants: ok.length } }],
      [{ kind: 'shortlist', title: `Recruiter shortlist: ${ok.length} candidate(s)`, rationale: typeof body.note === 'string' && body.note.trim() ? body.note.slice(0, 1000) : 'Shortlist requested by the recruiter.',
        payload: { driveId, studentIds: ok } }], 'human-recruiter');
    await audit(sql, ctx, 'SHORTLIST_REQUESTED', 'drive', null, {});
    return { proposalId: run.proposalIds[0], message: `Sent ${ok.length} candidate(s) to the placement office for approval. Nothing changes until a placement officer approves.` };
  });

  r.post('/api/v2/recruiter/reprobe', R, async ({ ctx, sql, body }) => {
    await audit(sql, ctx, 'REPROBE_REQUESTED', 'student', requireUuid(body.studentId, 'studentId'), { skill: requireString(body.skill, 'skill', 1, 100) });
    return { message: 'Request sent. The student is asked to retake the check. Nothing changes unless they do.' };
  });

  r.get('/api/v2/recruiter/pipeline', R, async ({ ctx, sql, query }) => {
    const mid = await membershipId(sql, ctx);
    const driveId = requireUuid(query.driveId, 'driveId');
    await grantFor(sql, mid, driveId);
    const rows = (await sql.query<any>(`SELECT a.id, a.stage, a.student_id, u.full_name, d.code AS branch,
        (SELECT jsonb_agg(jsonb_build_object('round', f.round_kind, 'rating', f.rating, 'recommendation', f.recommendation)) FROM recruiter_feedback f WHERE f.application_id = a.id) AS feedback
      FROM applications a JOIN students s ON s.id = a.student_id JOIN users u ON u.id = s.user_id JOIN departments d ON d.id = s.department_id
      WHERE a.drive_id = $1 AND EXISTS (SELECT 1 FROM consent_grants c WHERE c.student_id = s.id AND c.purpose = 'recruiter_sharing' AND c.revoked_at IS NULL) ORDER BY a.stage, u.full_name`, [driveId])).rows;
    return rows.map(x => ({ applicationId: x.id, studentId: x.student_id, name: displayName(x.full_name), branch: x.branch, stage: x.stage, feedback: x.feedback ?? [] }));
  });

  r.post('/api/v2/recruiter/feedback', R, async ({ ctx, sql, body }) => {
    const mid = await membershipId(sql, ctx);
    const app = await one<any>(sql, `SELECT id, drive_id FROM applications WHERE id = $1`, [requireUuid(body.applicationId, 'applicationId')], 'Application not found.');
    await grantFor(sql, mid, app.drive_id);
    if (!['advance', 'hold', 'reject'].includes(body.recommendation)) throw new HttpError(400, 'recommendation must be advance, hold or reject.');
    await sql.query(`INSERT INTO recruiter_feedback (application_id, round_kind, recruiter_membership_id, rating, strengths, concerns, recommendation) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [app.id, requireString(body.roundKind, 'roundKind', 2, 30), mid, Math.max(1, Math.min(5, Number(body.rating) || 3)), String(body.strengths ?? '').slice(0, 2000), String(body.concerns ?? '').slice(0, 2000), body.recommendation]);
    await audit(sql, ctx, 'RECRUITER_FEEDBACK', 'application', app.id, { recommendation: body.recommendation });
    return { ok: true };
  });

  // ---------- Officer: application stages and offers ----------
  r.get('/api/v2/tpo/applications', OFFICER_ROLES, async ({ sql, query }) => {
    const rows = (await sql.query<any>(`SELECT a.id, a.stage, u.full_name, s.enrollment_no, d.code AS branch, f.ctc_inr, f.status AS offer_status
      FROM applications a JOIN students s ON s.id = a.student_id JOIN users u ON u.id = s.user_id JOIN departments d ON d.id = s.department_id
      LEFT JOIN offers f ON f.application_id = a.id WHERE a.drive_id = $1 ORDER BY a.stage, u.full_name`, [requireUuid(query.driveId, 'driveId')])).rows;
    return rows.map(x => ({ id: x.id, name: displayName(x.full_name), enrollmentNo: x.enrollment_no, branch: x.branch, stage: x.stage, offer: x.ctc_inr ? { ctc: Number(x.ctc_inr), status: x.offer_status } : null }));
  });
  r.post('/api/v2/tpo/applications/:id/stage', OFFICER_ROLES, async ({ ctx, sql, params, body }) => {
    const allowed: Record<string, string[]> = { applied: ['assessment', 'shortlisted', 'rejected'], assessment: ['shortlisted', 'rejected'], shortlisted: ['interview_scheduled', 'offered', 'rejected'], interview_scheduled: ['offered', 'rejected'] };
    const app = await one<any>(sql, `SELECT * FROM applications WHERE id = $1`, [requireUuid(params.id, 'id')], 'Application not found.');
    if (!(allowed[app.stage] ?? []).includes(body.stage)) throw new HttpError(409, `Cannot move from ${app.stage} to ${body.stage}.`);
    const mid = await membershipId(sql, ctx);
    if (body.stage === 'offered') {
      const ctc = Number(body.ctcInr);
      if (!(ctc > 0)) throw new HttpError(400, 'An offer needs a CTC.');
      await sql.query(`INSERT INTO offers (application_id, ctc_inr, joining_date) VALUES ($1,$2,$3)`, [app.id, ctc, body.joiningDate ?? null]);
    }
    await sql.query(`UPDATE applications SET stage = $2, updated_at = now(), ctc_inr = COALESCE($3, ctc_inr) WHERE id = $1`, [app.id, body.stage, body.stage === 'offered' ? Number(body.ctcInr) : null]);
    await sql.query(`INSERT INTO application_events (application_id, from_stage, to_stage, actor_membership_id, note) VALUES ($1,$2,$3,$4,$5)`, [app.id, app.stage, body.stage, mid, String(body.note ?? '').slice(0, 500) || null]);
    await audit(sql, ctx, 'APPLICATION_STAGE_CHANGED', 'application', app.id, { from: app.stage, to: body.stage });
    return { ok: true };
  });

  // Student responds to an offer.
  r.post('/api/v2/student/offers/:applicationId/respond', ['student'], async ({ ctx, sql, params, body }) => {
    const st = await studentForUser(sql, ctx);
    const app = await one<any>(sql, `SELECT a.*, f.id AS offer_id FROM applications a JOIN offers f ON f.application_id = a.id WHERE a.id = $1 AND a.student_id = $2 AND a.stage = 'offered'`,
      [requireUuid(params.applicationId, 'id'), st.id], 'Open offer not found.');
    const accept = body.accept === true;
    if (accept && (await sql.query(`SELECT 1 FROM offers WHERE id = $1 AND signed`, [app.offer_id])).rows[0]) throw new HttpError(409, 'This offer was signed by the recruiter. Accept it with your own signature in My Offers.');
    await sql.query(`UPDATE offers SET status = $2, responded_at = now() WHERE id = $1`, [app.offer_id, accept ? 'accepted' : 'declined']);
    await sql.query(`UPDATE applications SET stage = $2, updated_at = now() WHERE id = $1`, [app.id, accept ? 'offer_accepted' : 'offer_declined']);
    await sql.query(`INSERT INTO application_events (application_id, from_stage, to_stage, note) VALUES ($1,'offered',$2,'Student response')`, [app.id, accept ? 'offer_accepted' : 'offer_declined']);
    await audit(sql, ctx, accept ? 'OFFER_ACCEPTED' : 'OFFER_DECLINED', 'application', app.id, {});
    return { stage: accept ? 'offer_accepted' : 'offer_declined' };
  });

  // ---------- University: aggregates only ----------
  r.get('/api/v2/university/outcomes', ['university_admin'], async ({ sql }) => {
    const rows = (await sql.query<any>(`SELECT * FROM university_college_outcomes()`)).rows;
    return {
      colleges: rows.map(x => ({ id: x.college_id, name: x.college_name.replace('[SYNTHETIC] ', ''), tier: x.tier, students: x.students, placed: x.placed,
        placedPercent: x.students ? Math.round((x.placed / x.students) * 1000) / 10 : 0, medianCtc: x.median_ctc_inr ? Number(x.median_ctc_inr) : null,
        verifiedSkills: x.verified_skills, studentsWithVerifiedSkill: x.students_with_verified_skill,
        verifiedCoveragePercent: x.students ? Math.round((x.students_with_verified_skill / x.students) * 1000) / 10 : 0 })),
      note: 'Aggregates only. University administrators cannot see individual students; each college\'s data stays in that college.',
    };
  });

}
