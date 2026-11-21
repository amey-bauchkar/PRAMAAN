import { randomUUID } from 'crypto';
import {
  sampleAptitudeSet, scoreAptitude, scoreMachineProblem, buildMockReport,
  AptitudeQuestion, PROCTOR_EVENT_KINDS, PROCTOR_LABELS, PROCTOR_SEVERITY, ProctorEventInput, ProctorEventKind, summarizeIntegrity, mayAwardProof, analyzeTyping, cleanTypingStats, SERVER_ONLY_KINDS, codeTokens, judgeSimilarity, pickDefenceTest, checkDefenceAnswer, DEFENCE_SECONDS_PER_QUESTION, ProofPath, recourseTiming, planLearningPath, EligibilityEvaluator, buildOpenBadge, signCredential, verifyCredential,
} from '@pramaan/domain';
import { PROOF_LEVEL_RANK, EligibilityRuleSpecSchema } from '@pramaan/contracts';
import { Router, HttpError, requireString, requireUuid, one } from './http.js';
import { Judge } from './judge.js';
import { audit } from './audit.js';
import { scoreAnswer, CoverageJudge } from './interview-judge.js';
import { signalsFromFiles } from './github-evidence.js';
import { studentForUser, awardProof, academicSnapshot, driveContexts, reevaluateStudent, sha256, displayName, AwardResult } from './services.js';
import { MOCK_ROLES, ExternalProfileAdapter, IssuerConfig, newToken } from './config.js';
import { Db } from './db.js';

export interface StudentDeps {
  judge: Judge; profiles: ExternalProfileAdapter; issuer: IssuerConfig | null; db: Db; interviewJudge?: CoverageJudge | null;
  /** Revokes the GitHub OAuth grant at GitHub and purges the stored token. Without it only local data is removed. */
  githubRevoker?: (ctx: any, studentId: string) => Promise<{ providerRevocationStatus: 'confirmed' | 'failed' | 'local_only' }>;
}

const S = ['student'] as const;
const iso = (v: any) => (v ? new Date(v).toISOString() : null);

function seededPick<T>(arr: T[], n: number, seed: string): T[] {
  const a = [...arr];
  let h = parseInt(sha256(seed).slice(0, 8), 16);
  for (let i = a.length - 1; i > 0; i--) { h = (h * 1103515245 + 12345) % 2147483648; const j = h % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}

export function registerStudentRoutes(r: Router, deps: StudentDeps) {
  // ---------- Profile & skills (ST-01, ST-03) ----------
  r.get('/api/v2/student/profile', S, async ({ ctx, sql }) => {
    const st = await studentForUser(sql, ctx);
    const info = await one<any>(sql, `
      SELECT s.enrollment_no, s.graduating_year, d.name AS department, d.code AS branch, o.name AS college, u.full_name, u.email,
             a.cgpa, a.tenth_pct, a.twelfth_pct, a.diploma_pct, a.active_backlogs
        FROM students s JOIN users u ON u.id = s.user_id JOIN departments d ON d.id = s.department_id JOIN organizations o ON o.id = s.org_id
        LEFT JOIN LATERAL (SELECT * FROM academic_records x WHERE x.student_id = s.id ORDER BY as_of DESC LIMIT 1) a ON TRUE
       WHERE s.id = $1`, [st.id]);
    const skills = await sql.query<any>(`
      SELECT ss.id, ss.skill_id, k.slug, k.canonical_name AS name, k.category, ss.state, ss.proof_level, ss.level, ss.valid_until, ss.state_since,
             (SELECT count(*)::int FROM skill_evidence se JOIN evidence_items e ON e.id = se.evidence_id WHERE se.student_skill_id = ss.id AND e.status = 'accepted') AS evidence_count,
             EXISTS (SELECT 1 FROM probe_definitions p WHERE p.student_id = ss.student_id AND p.skill_id = ss.skill_id) AS has_probe
        FROM student_skills ss JOIN skills k ON k.id = ss.skill_id WHERE ss.student_id = $1
       ORDER BY CASE ss.state WHEN 'verified' THEN 0 WHEN 'evidence_linked' THEN 1 WHEN 'observed' THEN 2 WHEN 'expired' THEN 3 ELSE 4 END, k.canonical_name`, [st.id]);
    const ext = await sql.query<any>(`SELECT provider, handle, status, stats, source, verified_at, verification_token FROM external_profiles WHERE student_id = $1`, [st.id]);
    const creds = await sql.query<any>(`SELECT c.id, k.canonical_name AS skill, c.proof_level, c.status, c.issued_at, c.valid_until FROM credentials c JOIN skills k ON k.id = c.skill_id WHERE c.student_id = $1 ORDER BY c.issued_at DESC`, [st.id]);
    const soon = Date.now() + 60 * 86_400_000;
    return {
      student: { id: st.id, name: displayName(info.full_name), email: info.email, enrollmentNo: info.enrollment_no, department: info.department, branch: info.branch,
        college: info.college.replace('[SYNTHETIC] ', ''), graduatingYear: info.graduating_year, isMinor: st.isMinor },
      academics: { cgpa: info.cgpa && Number(info.cgpa), tenthPct: info.tenth_pct && Number(info.tenth_pct), twelfthPct: info.twelfth_pct && Number(info.twelfth_pct), diplomaPct: info.diploma_pct && Number(info.diploma_pct), activeBacklogs: info.active_backlogs },
      skills: skills.rows.map(x => ({ id: x.id, skillId: x.skill_id, slug: x.slug, name: x.name, category: x.category, state: x.state, proofLevel: x.proof_level, level: x.level,
        validUntil: iso(x.valid_until), stateSince: iso(x.state_since), evidenceCount: x.evidence_count, hasProbe: x.has_probe,
        expiresSoon: x.state === 'verified' && x.valid_until && new Date(x.valid_until).getTime() < soon })),
      externalProfiles: ext.rows.map(x => ({ provider: x.provider, handle: x.handle, status: x.status, stats: x.stats, source: x.source, verifiedAt: iso(x.verified_at), token: x.status === 'pending' ? x.verification_token : null })),
      credentials: creds.rows.map(x => ({ id: x.id, skill: x.skill, proofLevel: x.proof_level, status: x.status, issuedAt: iso(x.issued_at), validUntil: iso(x.valid_until) })),
    };
  });

  r.get('/api/v2/student/skills/:id', S, async ({ ctx, sql, params }) => {
    const st = await studentForUser(sql, ctx);
    const sk = await one<any>(sql, `SELECT ss.*, k.canonical_name AS name, k.slug, k.half_life_days FROM student_skills ss JOIN skills k ON k.id = ss.skill_id WHERE ss.id = $1 AND ss.student_id = $2`, [requireUuid(params.id, 'id'), st.id], 'Skill not found.');
    const ev = await sql.query<any>(`SELECT e.id, e.kind, e.status, e.description, e.source, e.path, e.valid_until, e.created_at FROM skill_evidence se JOIN evidence_items e ON e.id = se.evidence_id WHERE se.student_skill_id = $1 ORDER BY e.created_at DESC`, [sk.id]);
    const events = await sql.query<any>(`SELECT from_state, to_state, reason_code, proof_level, occurred_at FROM skill_state_events WHERE student_skill_id = $1 ORDER BY occurred_at`, [sk.id]);
    const explain: Record<string, string> = {
      claimed: `You added ${sk.name}, but there is no proof yet. Add your work or take a test.`,
      observed: `We found a sign of ${sk.name} (for example from your coding-platform stats), but it is not linked to a specific piece of your work yet.`,
      evidence_linked: `${sk.name} is linked to your work. Pass one check to make it Verified.`,
      verified: `${sk.name} is Verified (${String(sk.proof_level).replace('_', ' ')}). Check it again before ${iso(sk.valid_until)?.slice(0, 10)}.`,
      expired: `Your proof for ${sk.name} is more than ${sk.half_life_days} days old. Pass a new check to make it Verified again.`,
    };
    return {
      id: sk.id, name: sk.name, slug: sk.slug, state: sk.state, proofLevel: sk.proof_level, level: sk.level, validUntil: iso(sk.valid_until), explanation: explain[sk.state],
      evidence: ev.rows.map(x => ({ id: x.id, kind: x.kind, status: x.status, description: x.description ?? (x.path ? `Code: ${x.path}` : x.kind.replace('_', ' ')), source: x.source, path: x.path, validUntil: iso(x.valid_until), createdAt: iso(x.created_at) })),
      history: events.rows.map(x => ({ from: x.from_state, to: x.to_state, reason: x.reason_code, proofLevel: x.proof_level, at: iso(x.occurred_at) })),
    };
  });

  r.post('/api/v2/student/skills/claim', S, async ({ ctx, sql, body }) => {
    const st = await studentForUser(sql, ctx);
    const k = await one<any>(sql, `SELECT id, canonical_name FROM skills WHERE slug = $1`, [requireString(body.skillSlug, 'skillSlug')], 'Unknown skill.');
    await sql.query(`INSERT INTO student_skills (student_id, skill_id, state) VALUES ($1,$2,'claimed') ON CONFLICT (student_id, skill_id) DO NOTHING`, [st.id, k.id]);
    await audit(sql, ctx, 'SKILL_CLAIMED', 'student_skill', null, {});
    return { ok: true, message: `${k.canonical_name} added as Claimed. Add proof to verify it.` };
  });

  // ---------- Evidence import (ST-02): non-repository proof for mentor review ----------
  r.post('/api/v2/student/evidence', S, async ({ ctx, sql, body }) => {
    const st = await studentForUser(sql, ctx);
    const kind = body.kind;
    if (!['lab', 'certificate', 'competition'].includes(kind)) throw new HttpError(400, 'kind must be lab, certificate or competition.');
    const k = await one<any>(sql, `SELECT id, canonical_name FROM skills WHERE slug = $1`, [requireString(body.skillSlug, 'skillSlug')], 'Unknown skill.');
    const title = requireString(body.title, 'title', 3, 200);
    const details = typeof body.details === 'string' ? body.details.slice(0, 2000) : '';
    const link = typeof body.link === 'string' && /^https?:\/\//.test(body.link) ? body.link.slice(0, 500) : null;
    const id = randomUUID();
    await sql.query(`INSERT INTO evidence_items (id, student_id, kind, content_hash, status, object_key, description, source, claimed_skill_id)
      VALUES ($1,$2,$3,$4,'submitted',$5,$6,'student_upload',$7)`, [id, st.id, kind, sha256(`${id}:${title}:${details}:${link}`), link, `${title}${details ? ` — ${details}` : ''}`, k.id]);
    await sql.query(`INSERT INTO student_skills (student_id, skill_id, state) VALUES ($1,$2,'claimed') ON CONFLICT (student_id, skill_id) DO NOTHING`, [st.id, k.id]);
    await audit(sql, ctx, 'EVIDENCE_SUBMITTED', 'evidence_item', id, { kind, skill: k.canonical_name });
    return { id, message: `Sent to your mentor. ${k.canonical_name} is added to your profile once accepted, and becomes Verified (Level 3) if your mentor approves it.` };
  });

  r.get('/api/v2/student/evidence', S, async ({ ctx, sql }) => {
    const st = await studentForUser(sql, ctx);
    const rows = await sql.query<any>(`SELECT e.id, e.kind, e.status, e.description, e.object_key AS link, e.review_note, e.created_at, k.canonical_name AS skill
      FROM evidence_items e LEFT JOIN skills k ON k.id = e.claimed_skill_id WHERE e.student_id = $1 AND e.source = 'student_upload' ORDER BY e.created_at DESC`, [st.id]);
    return rows.rows.map(x => ({ ...x, createdAt: iso(x.created_at) }));
  });

  // ---------- External profiles: ownership-token linking ----------
  r.post('/api/v2/student/external-profiles', S, async ({ ctx, sql, body }) => {
    const st = await studentForUser(sql, ctx);
    const provider = body.provider;
    if (!['leetcode', 'codeforces'].includes(provider)) throw new HttpError(400, 'provider must be leetcode or codeforces.');
    const handle = requireString(body.handle, 'handle', 1, 40);
    if (!/^[A-Za-z0-9_.-]+$/.test(handle)) throw new HttpError(400, 'Handle may contain letters, digits, dot, dash and underscore.');
    const token = newToken();
    await sql.query(`INSERT INTO external_profiles (student_id, provider, handle, verification_token, status) VALUES ($1,$2,$3,$4,'pending')
      ON CONFLICT (student_id, provider) DO UPDATE SET handle = EXCLUDED.handle, verification_token = EXCLUDED.verification_token, status = 'pending', stats = NULL, verified_at = NULL`,
      [st.id, provider, handle, token]);
    await audit(sql, ctx, 'EXTERNAL_PROFILE_LINK_STARTED', 'external_profile', null, {});
    return { token, instructions: provider === 'leetcode'
      ? `Add ${token} to your LeetCode profile summary, then press Verify. You can remove it afterwards.`
      : `Add ${token} to the "organization" field of your Codeforces profile, then press Verify. You can remove it afterwards.` };
  });

  r.post('/api/v2/student/external-profiles/:provider/verify', S, async ({ ctx, sql, params }) => {
    const st = await studentForUser(sql, ctx);
    const p = await one<any>(sql, `SELECT * FROM external_profiles WHERE student_id = $1 AND provider = $2`, [st.id, params.provider], 'Link the profile first.');
    const check = await deps.profiles.check(p.provider, p.handle, p.verification_token);
    if (!check.ownershipConfirmed) {
      await sql.query(`UPDATE external_profiles SET status = 'failed', fetched_at = now() WHERE id = $1`, [p.id]);
      return { verified: false, note: check.note };
    }
    await sql.query(`UPDATE external_profiles SET status = 'verified', stats = $2, source = $3, verified_at = now(), fetched_at = now() WHERE id = $1`, [p.id, JSON.stringify(check.stats), check.source]);
    const solved = Number((check.stats as any)?.solved ?? 0);
    const desc = p.provider === 'leetcode' ? `LeetCode @${p.handle}: ${solved} problems solved (${check.source === 'demo_fixture' ? 'demo fixture' : 'public profile'})` : `Codeforces @${p.handle}: rating ${(check.stats as any)?.rating}`;
    const res = await awardProof(sql, ctx, { studentId: st.id, skillSlug: 'problem-solving', observeOnly: true, reasonCode: 'EXTERNAL_PROFILE_LINKED',
      evidence: { kind: 'external_profile', description: desc, source: p.provider } });
    await audit(sql, ctx, 'EXTERNAL_PROFILE_VERIFIED', 'external_profile', p.id, { provider: p.provider, source: check.source });
    return { verified: true, note: check.note, stats: check.stats, skill: res.message,
      next: 'Your platform stats show a sign of Problem Solving. Take the practice coding test to make it Verified (Level 2).' };
  });

  // ---------- Resume (ST-01): generated from the profile, never uploaded ----------
  r.get('/api/v2/student/resume', S, async ({ ctx, sql }) => {
    const st = await studentForUser(sql, ctx);
    const info = await one<any>(sql, `SELECT u.full_name, u.email, d.name AS department, o.name AS college, s.graduating_year, a.cgpa, a.tenth_pct, a.twelfth_pct, a.diploma_pct
      FROM students s JOIN users u ON u.id = s.user_id JOIN departments d ON d.id = s.department_id JOIN organizations o ON o.id = s.org_id
      LEFT JOIN LATERAL (SELECT * FROM academic_records x WHERE x.student_id = s.id ORDER BY as_of DESC LIMIT 1) a ON TRUE WHERE s.id = $1`, [st.id]);
    const skills = await sql.query<any>(`SELECT k.canonical_name AS name, k.category, ss.proof_level, ss.valid_until FROM student_skills ss JOIN skills k ON k.id = ss.skill_id
      WHERE ss.student_id = $1 AND ss.state = 'verified' ORDER BY ss.proof_level DESC, k.canonical_name`, [st.id]);
    const projects = await sql.query<any>(`SELECT DISTINCT ON (e.path) e.path, e.description, k.canonical_name AS skill FROM evidence_items e
      JOIN skill_evidence se ON se.evidence_id = e.id JOIN student_skills ss ON ss.id = se.student_skill_id JOIN skills k ON k.id = ss.skill_id
      WHERE e.student_id = $1 AND e.kind = 'code_span' AND e.status = 'accepted' AND e.path IS NOT NULL ORDER BY e.path LIMIT 6`, [st.id]);
    const mock = await sql.query<any>(`SELECT role_title, report, completed_at FROM mock_attempts WHERE student_id = $1 AND status = 'completed' ORDER BY completed_at DESC LIMIT 1`, [st.id]);
    const ext = await sql.query<any>(`SELECT provider, handle, stats FROM external_profiles WHERE student_id = $1 AND status = 'verified'`, [st.id]);
    await audit(sql, ctx, 'RESUME_GENERATED', 'student', st.id, {});
    return {
      name: displayName(info.full_name), email: info.email, department: info.department, college: info.college.replace('[SYNTHETIC] ', ''), graduatingYear: info.graduating_year,
      academics: { cgpa: info.cgpa && Number(info.cgpa), tenthPct: info.tenth_pct && Number(info.tenth_pct), twelfthPct: info.twelfth_pct && Number(info.twelfth_pct), diplomaPct: info.diploma_pct && Number(info.diploma_pct) },
      verifiedSkills: skills.rows.map(x => ({ name: x.name, category: x.category, proofLevel: x.proof_level, validUntil: iso(x.valid_until) })),
      projects: projects.rows.map(x => ({ path: x.path, skill: x.skill, description: x.description })),
      latestMock: mock.rows[0] ? { role: mock.rows[0].role_title, totalPercent: mock.rows[0].report?.totalPercent, at: iso(mock.rows[0].completed_at) } : null,
      profiles: ext.rows.map(x => ({ provider: x.provider, handle: x.handle, stats: x.stats })),
      generatedAt: new Date().toISOString(),
      note: 'Created from your verified profile. Every skill listed has proof behind it.',
    };
  });

  // ---------- Mock drive (ST-05) ----------
  r.get('/api/v2/student/mock', S, async ({ ctx, sql }) => {
    const st = await studentForUser(sql, ctx);
    const roles = await sql.query<{ role_title: string; n: number }>(`SELECT role_title, count(*)::int AS n FROM interview_questions WHERE status = 'approved' GROUP BY role_title`);
    const attempts = await sql.query<any>(`SELECT id, role_title, status, report, started_at, completed_at FROM mock_attempts WHERE student_id = $1 ORDER BY started_at DESC`, [st.id]);
    return {
      roles: roles.rows.filter(x => MOCK_ROLES[x.role_title] && x.n >= 3).map(x => x.role_title).sort(),
      attempts: attempts.rows.map(x => ({ id: x.id, role: x.role_title, status: x.status, summary: x.report?.summary ?? null, totalPercent: x.report?.totalPercent ?? null, startedAt: iso(x.started_at), completedAt: iso(x.completed_at) })),
    };
  });

  r.post('/api/v2/student/mock/attempts', S, async ({ ctx, sql, body }) => {
    const st = await studentForUser(sql, ctx);
    const role = requireString(body.role, 'role');
    const cfg = MOCK_ROLES[role];
    if (!cfg) throw new HttpError(400, 'Unknown role.');
    const open = await sql.query<{ id: string }>(`SELECT id FROM mock_attempts WHERE student_id = $1 AND status = 'in_progress'`, [st.id]);
    if (open.rows[0]) return { id: open.rows[0].id, resumed: true };
    const n = (await sql.query<{ n: number }>(`SELECT count(*)::int AS n FROM mock_attempts WHERE student_id = $1`, [st.id])).rows[0].n;
    const bank = (await sql.query<any>(`SELECT id, topic, subtopic, difficulty, stem, options, answer_index, explanation FROM aptitude_questions WHERE status = 'active'`)).rows
      .map(x => ({ id: x.id, topic: x.topic, subtopic: x.subtopic, difficulty: x.difficulty, stem: x.stem, options: x.options, answerIndex: x.answer_index, explanation: x.explanation }));
    const apt = sampleAptitudeSet(bank as AptitudeQuestion[], `${st.id}:${n + 1}`);
    const probs = (await sql.query<any>(`SELECT id, slug, language FROM coding_problems WHERE slug = ANY($1) AND status = 'active'`, [cfg.problems])).rows;
    const chosen: string[] = [];
    for (const [i, lang] of cfg.languages.entries()) {
      const pool = probs.filter(p => p.language === lang && !chosen.includes(p.id));
      const [p] = seededPick(pool, 1, `${st.id}:${n}:${i}`);
      if (p) chosen.push(p.id);
    }
    const iq = (await sql.query<any>(`SELECT id FROM interview_questions WHERE role_title = $1 AND status = 'approved'`, [role])).rows;
    const interview = seededPick(iq.map(x => x.id), 3, `${st.id}:${n}:iq`);
    const id = randomUUID();
    await sql.query(`INSERT INTO mock_attempts (id, student_id, role_title, aptitude_question_ids, coding_problem_ids, interview_question_ids) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, st.id, role, apt.map(q => q.id), chosen, interview]);
    await audit(sql, ctx, 'MOCK_STARTED', 'mock_attempt', id, { role });
    return { id, resumed: false };
  });

  const loadAttempt = async (sql: any, studentId: string, id: string) =>
    one<any>(sql, `SELECT * FROM mock_attempts WHERE id = $1 AND student_id = $2`, [requireUuid(id, 'attempt id'), studentId], 'Attempt not found.');

  r.get('/api/v2/student/mock/attempts/:id', S, async ({ ctx, sql, params }) => {
    const st = await studentForUser(sql, ctx);
    const a = await loadAttempt(sql, st.id, params.id);
    const done = (await sql.query<any>(`SELECT round, score, max_score, details FROM mock_round_results WHERE attempt_id = $1`, [a.id])).rows;
    const has = (r0: string) => done.find(d => d.round === r0);
    const out: any = { id: a.id, role: a.role_title, status: a.status, rounds: done.map(d => ({ round: d.round, score: Number(d.score), maxScore: Number(d.max_score) })), report: a.report };
    const integ: { summary: ReturnType<typeof summarizeIntegrity>; rows: any[] } = await loadIntegrity(sql, a.id);
    // Students under 18 are not put under camera or test-window rules at all (project rule D4/D2).
    out.proctorRequired = !st.isMinor;
    if (st.isMinor) integ.summary = summarizeIntegrity([], { exempt: true });
    out.integrity = integ.summary;
    out.proctorEvents = integ.rows.slice(-100).map(x => ({ kind: x.kind, label: PROCTOR_LABELS[x.kind as ProctorEventKind] ?? x.kind, severity: PROCTOR_SEVERITY[x.kind as ProctorEventKind] ?? 'minor', seconds: x.seconds, why: x.detail?.why ?? null, problem: x.detail?.problem ?? null, at: iso(x.occurred_at) }));
    // Questions are only sent once a proctored session with the camera on has been started for this attempt.
    out.questionsLocked = a.status === 'in_progress' && !st.isMinor && !(integ.summary.proctored && integ.summary.cameraOn);
    if (out.questionsLocked) return out;
    const pend = (await sql.query<any>(`SELECT d.id, d.problem_id, d.kind, d.entry, d.code, d.args, d.setup, d.deadline_at, c.title FROM mock_defence_checks d JOIN coding_problems c ON c.id = d.problem_id
      WHERE d.attempt_id = $1 AND d.answered_at IS NULL AND d.deadline_at IS NOT NULL ORDER BY c.title`, [a.id])).rows;
    if (pend.length) out.defence = pend.map(d => ({ id: d.id, title: d.title, kind: d.kind, entry: d.entry, code: d.code, args: d.args, setup: d.setup, deadlineAt: iso(d.deadline_at), expired: new Date(d.deadline_at).getTime() < Date.now() }));
    if (!has('aptitude')) {
      const q = await sql.query<any>(`SELECT id, topic, subtopic, stem, options FROM aptitude_questions WHERE id = ANY($1)`, [a.aptitude_question_ids]);
      const order = new Map<string, number>(a.aptitude_question_ids.map((x: string, i: number) => [x, i]));
      out.aptitude = q.rows.sort((x, y) => (order.get(x.id) ?? 0) - (order.get(y.id) ?? 0));
    } else out.aptitudeResult = has('aptitude').details;
    if (!has('machine_test')) {
      const p = await sql.query<any>(`SELECT id, title, statement, language, entry_function, starter_code, public_tests, marks, sql_schema FROM coding_problems WHERE id = ANY($1)`, [a.coding_problem_ids]);
      out.machine = p.rows.map(x => ({ id: x.id, title: x.title, statement: x.statement, language: x.language, entry: x.entry_function, starter: x.starter_code?.[x.language] ?? '', publicTests: x.public_tests, marks: x.marks, schema: x.sql_schema }));
    } else out.machineResult = has('machine_test').details;
    if (!has('interview')) {
      const q = await sql.query<any>(`SELECT id, topic, question FROM interview_questions WHERE id = ANY($1)`, [a.interview_question_ids]);
      out.interview = q.rows;
    } else out.interviewResult = has('interview').details;
    out.reviews = (await sql.query<any>(`SELECT id, status, reason, decision_note, previous_score, revised_score, created_at, decided_at FROM mock_review_requests WHERE attempt_id = $1 ORDER BY created_at DESC`, [a.id])).rows
      .map(x => ({ id: x.id, status: x.status, reason: x.reason, note: x.decision_note, previousScore: x.previous_score === null ? null : Number(x.previous_score), revisedScore: x.revised_score === null ? null : Number(x.revised_score), createdAt: iso(x.created_at), decidedAt: iso(x.decided_at) }));
    return out;
  });
  // ---------- Test integrity (proctoring) ----------
  // Only rule events are stored (never video). The summary is authoritative here: the browser can warn, but this decides.
  const loadIntegrity = async (sql: any, attemptId: string) => {
    const rows = (await sql.query(`SELECT kind, seconds, detail, occurred_at FROM mock_proctor_events WHERE attempt_id = $1 ORDER BY occurred_at, id`, [attemptId])).rows as any[];
    const events: ProctorEventInput[] = rows.map(x => ({ kind: x.kind as ProctorEventKind, seconds: x.seconds ?? undefined, detail: x.detail ?? {} }));
    return { summary: summarizeIntegrity(events), rows };
  };
  const cleanDetail = (d: any): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    if (d && typeof d === 'object') {
      if (typeof d.camera === 'boolean') out.camera = d.camera;
      if (typeof d.why === 'string') out.why = d.why.slice(0, 60);
      if (typeof d.key === 'string') out.key = d.key.slice(0, 20);
    }
    return out;
  };

  r.post('/api/v2/student/mock/attempts/:id/proctor', S, async ({ ctx, sql, params, body }) => {
    const st = await studentForUser(sql, ctx);
    if (st.isMinor) throw new HttpError(403, 'The camera and test-window rules are not used for students under 18.');
    const a = await loadAttempt(sql, st.id, params.id);
    if (a.status !== 'in_progress') throw new HttpError(409, 'This attempt is already completed.');
    const list = Array.isArray(body.events) ? body.events : null;
    if (!list || list.length === 0 || list.length > 50) throw new HttpError(400, 'Send between 1 and 50 events.');
    const had = (await loadIntegrity(sql, a.id)).summary;
    const existing = (await sql.query<{ n: number }>(`SELECT count(*)::int AS n FROM mock_proctor_events WHERE attempt_id = $1`, [a.id])).rows[0].n;
    if (existing + list.length > 2000) throw new HttpError(429, 'Too many events for one attempt.');
    for (const e of list) {
      if (!e || !(PROCTOR_EVENT_KINDS as readonly string[]).includes(e.kind) || (SERVER_ONLY_KINDS as readonly string[]).includes(e.kind)) throw new HttpError(400, `Unknown event kind "${String(e?.kind).slice(0, 30)}".`);
      const seconds = Number.isFinite(e.seconds) ? Math.max(0, Math.min(86400, Math.round(e.seconds))) : null;
      // The server clock decides when an event happened, so a client cannot back-date or hide the order of events.
      await sql.query(`INSERT INTO mock_proctor_events (attempt_id, student_id, kind, seconds, detail) VALUES ($1,$2,$3,$4,$5)`,
        [a.id, st.id, e.kind, seconds, JSON.stringify(cleanDetail(e.detail))]);
    }
    const now = (await loadIntegrity(sql, a.id)).summary;
    if (!had.proctored && now.proctored) await audit(sql, ctx, 'MOCK_PROCTOR_STARTED', 'mock_attempt', a.id, { camera: now.cameraOn });
    if (had.status !== 'flagged' && now.status === 'flagged' && now.proctored) await audit(sql, ctx, 'MOCK_PROCTOR_FLAGGED', 'mock_attempt', a.id, { major: now.major, minor: now.minor });
    return { integrity: now };
  });

  r.post('/api/v2/student/mock/attempts/:id/review', S, async ({ ctx, sql, params, body }) => {
    const st = await studentForUser(sql, ctx);
    const a = await loadAttempt(sql, st.id, params.id);
    const res = (await sql.query<any>(`SELECT score FROM mock_round_results WHERE attempt_id = $1 AND round = 'interview'`, [a.id])).rows[0];
    if (!res) throw new HttpError(409, 'Finish the interview round before asking for a review.');
    const reason = requireString(body.reason, 'reason', 10, 1000);
    try {
      await sql.query(`INSERT INTO mock_review_requests (attempt_id, student_id, reason, previous_score) VALUES ($1,$2,$3,$4)`, [a.id, st.id, reason, res.score]);
    } catch (e: any) {
      if (e?.code === '23505') throw new HttpError(409, 'You already have a review waiting for this attempt.');
      throw e;
    }
    await audit(sql, ctx, 'MOCK_REVIEW_REQUESTED', 'mock_attempt', a.id, {});
    return { message: 'Review requested. A placement officer or mentor will read your answers and reply here.' };
  });

  const finishIfComplete = async (sql: any, ctx: any, studentId: string, attemptId: string, isMinor: boolean) => {
    const rounds = (await sql.query(`SELECT round, details FROM mock_round_results WHERE attempt_id = $1`, [attemptId])).rows as any[];
    if (rounds.length < 3) return null;

    // Follow-up step: the clock starts when the last round ends, and the drive is not finished until every check is answered.
    const checks = (await sql.query(`SELECT id, problem_id, kind, deadline_at, answered_at, correct FROM mock_defence_checks WHERE attempt_id = $1`, [attemptId])).rows as any[];
    if (checks.some(c => c.deadline_at === null)) {
      await sql.query(`UPDATE mock_defence_checks SET deadline_at = now() + ($2 * interval '1 second') WHERE attempt_id = $1 AND deadline_at IS NULL`, [attemptId, DEFENCE_SECONDS_PER_QUESTION * checks.length]);
      return null;
    }
    if (checks.some(c => c.answered_at === null)) return null;

    const get = (x: string) => rounds.find(r0 => r0.round === x).details;
    const machine = get('machine_test').problems;
    const report = buildMockReport({ aptitude: get('aptitude'), machine, interview: get('interview').answers, machineSkillSlugs: [] });
    const awarded: AwardResult[] = [];
    const withheld: { what: string; reason: string }[] = [];
    const integrity = isMinor ? summarizeIntegrity([], { exempt: true }) : (await loadIntegrity(sql, attemptId)).summary;
    const mayAward = mayAwardProof(integrity);
    if (!mayAward) withheld.push({ what: 'All proof from this drive', reason: integrity.message });
    for (const sig of report.skillSignals.filter(s => mayAward && s.passed)) {
      awarded.push(await awardProof(sql, ctx, { studentId, skillSlug: sig.skillSlug, reasonCode: 'MOCK_ROUND_PASSED', level: 1,
        evidence: { kind: 'test_result', description: `Mock drive aptitude: ${sig.percent}% in ${sig.skillSlug.replace('-', ' ')}`, source: 'mock_drive' },
        verification: { type: 'assessment', assessment: { score: sig.percent, maxScore: 100 } } }));
    }
    for (const p of machine) {
      const pct = p.maxMarks ? (p.marks / p.maxMarks) * 100 : 0;
      if (pct < 60) continue;
      const dc = checks.find(c => c.problem_id === p.problemId);
      const similar = p.similarity?.flagged === true;
      const undefended = !!dc && dc.correct !== true;
      if (similar) withheld.push({ what: p.title, reason: 'The code is very close to another student\'s answer, so it adds no proof. Ask your placement officer to review it if this is a mistake.' });
      else if (undefended) withheld.push({ what: p.title, reason: 'The follow-up question about your own code was not answered correctly in time, so it adds no proof.' });
      if (!mayAward || similar || undefended) continue;
      for (const slug of p.skills ?? []) {
        awarded.push(await awardProof(sql, ctx, { studentId, skillSlug: slug, reasonCode: 'MOCK_MACHINE_TEST_PASSED', level: 2,
          evidence: { kind: 'test_result', description: `Mock machine test "${p.title}": ${p.marks}/${p.maxMarks} (${p.passed}/${p.total} hidden tests)`, source: 'mock_drive' },
          verification: { type: 'assessment', assessment: { score: p.marks, maxScore: p.maxMarks } } }));
      }
    }
    const defence = checks.map(c => ({ title: machine.find((p: any) => p.problemId === c.problem_id)?.title ?? 'Coding problem', correct: c.correct === true }));
    const notes = awarded.map(x => x.message);
    const full = { ...report, awarded: notes, withheld, defence, integrity };
    await sql.query(`UPDATE mock_attempts SET status = 'completed', completed_at = now(), report = $2 WHERE id = $1`, [attemptId, JSON.stringify(full)]);
    await audit(sql, ctx, 'MOCK_COMPLETED', 'mock_attempt', attemptId, { totalPercent: report.totalPercent, weakTopics: report.weakTopics });
    await reevaluateStudent(sql, ctx, studentId);
    return full;
  };

  r.post('/api/v2/student/mock/attempts/:id/aptitude', S, async ({ ctx, sql, params, body }) => {
    const st = await studentForUser(sql, ctx);
    const a = await loadAttempt(sql, st.id, params.id);
    if (a.status !== 'in_progress') throw new HttpError(409, 'This attempt is already completed.');
    const qs = (await sql.query<any>(`SELECT id, topic, subtopic, difficulty, stem, options, answer_index, explanation FROM aptitude_questions WHERE id = ANY($1)`, [a.aptitude_question_ids])).rows
      .map(x => ({ id: x.id, topic: x.topic, subtopic: x.subtopic, difficulty: x.difficulty, stem: x.stem, options: x.options, answerIndex: x.answer_index, explanation: x.explanation }));
    const answers: Record<string, number | null> = {};
    for (const q of qs) { const v = body.answers?.[q.id]; answers[q.id] = Number.isInteger(v) ? v : null; }
    const res = scoreAptitude(qs as AptitudeQuestion[], answers);
    await sql.query(`INSERT INTO mock_round_results (attempt_id, round, score, max_score, details) VALUES ($1,'aptitude',$2,$3,$4)`, [a.id, res.score, res.maxScore, JSON.stringify(res)]);
    await audit(sql, ctx, 'MOCK_APTITUDE_SUBMITTED', 'mock_attempt', null, {});
    return { result: res, report: await finishIfComplete(sql, ctx, st.id, a.id, st.isMinor) };
  });

  r.post('/api/v2/student/mock/attempts/:id/machine/run', S, async ({ ctx, sql, params, body }) => {
    const st = await studentForUser(sql, ctx);
    const a = await loadAttempt(sql, st.id, params.id);
    const sess = (await loadIntegrity(sql, a.id)).summary;
    if (!st.isMinor && !(sess.proctored && sess.cameraOn)) throw new HttpError(403, 'Start the proctored test window first.');
    const p = await one<any>(sql, `SELECT * FROM coding_problems WHERE id = $1`, [requireUuid(body.problemId, 'problemId')]);
    if (!a.coding_problem_ids.includes(p.id)) throw new HttpError(400, 'Problem is not part of this attempt.');
    const code = requireString(body.code, 'code', 1, 20000);
    return p.language === 'sql'
      ? deps.judge.runSql(p.sql_schema, p.public_tests, code, p.reference_solution)
      : deps.judge.runJavaScript(code, p.entry_function, p.public_tests);
  });

  r.post('/api/v2/student/mock/attempts/:id/machine/submit', S, async ({ ctx, sql, params, body }) => {
    const st = await studentForUser(sql, ctx);
    const a = await loadAttempt(sql, st.id, params.id);
    if (a.status !== 'in_progress') throw new HttpError(409, 'This attempt is already completed.');
    const probs = (await sql.query<any>(`SELECT * FROM coding_problems WHERE id = ANY($1)`, [a.coding_problem_ids])).rows;
    const problems = [];
    for (const p of probs) {
      const code = typeof body.solutions?.[p.id] === 'string' ? body.solutions[p.id] : '';
      const out = code.trim() === ''
        ? { runner: deps.judge.name, results: p.hidden_tests.map((t: any, index: number) => ({ index, passed: false, description: t.description, error: 'No answer submitted' })), passed: 0, total: p.hidden_tests.length }
        : p.language === 'sql' ? await deps.judge.runSql(p.sql_schema, p.hidden_tests, code, p.reference_solution) : await deps.judge.runJavaScript(code, p.entry_function, p.hidden_tests);
      // Typing observations (students 18 and over only). Counts and timing come from the browser, never the text. They are
      // recorded as facts for a person to review and never withhold proof on their own.
      if (!st.isMinor && code.trim()) {
        const stats = body.typing && typeof body.typing === 'object' && body.typing[p.id] ? cleanTypingStats(body.typing[p.id]) : null;
        for (const ev of analyzeTyping(stats, code.length)) {
          await sql.query(`INSERT INTO mock_proctor_events (attempt_id, student_id, kind, detail) VALUES ($1,$2,$3,$4)`,
            [a.id, st.id, ev.kind, JSON.stringify({ ...(ev.detail ?? {}), problem: String(p.title).slice(0, 80) })]);
        }
      }
      // Similarity: compare with the latest saved answer of every other student in this college for the same problem.
      let similarity = { flagged: false, score: 0 };
      if (code.trim()) {
        const lang = p.language === 'sql' ? 'sql' : 'javascript';
        const peers = (await sql.query<any>(`SELECT DISTINCT ON (student_id) student_id, ref_id, code FROM judge_runs
          WHERE purpose = 'mock' AND problem_id = $1 AND student_id <> $2 ORDER BY student_id, created_at DESC LIMIT 500`, [p.id, st.id])).rows;
        const v = judgeSimilarity(codeTokens(code, lang), peers.map((x: any) => codeTokens(x.code, lang)), p.reference_solution ? codeTokens(p.reference_solution, lang) : null);
        similarity = { flagged: v.flagged, score: v.score };
        // The closest attempt goes to the audit log for a person to look at; the student is never told whose it is.
        if (v.flagged) await audit(sql, ctx, 'MOCK_SIMILARITY_FLAGGED', 'mock_attempt', a.id, { problemId: p.id, score: v.score, otherAttemptId: peers[v.closest]?.ref_id ?? null });
        await sql.query(`INSERT INTO judge_runs (student_id, purpose, ref_id, problem_id, language, code, passed, total, results, runner) VALUES ($1,'mock',$2,$3,$4,$5,$6,$7,$8,$9)`,
          [st.id, a.id, p.id, p.language, code, out.passed, out.total, JSON.stringify(out.results), out.runner]);
      }
      const scored = scoreMachineProblem({ id: p.id, title: p.title, marks: p.marks, topics: p.topics, hiddenTests: p.hidden_tests }, out.results);
      problems.push({ ...scored, skills: p.skill_slugs, language: p.language, similarity });
      // Follow-up: one hidden test this code passed, whose input the student has never seen.
      if (scored.maxMarks && (scored.marks / scored.maxMarks) * 100 >= 60) {
        const t = pickDefenceTest({ language: p.language, hiddenTests: p.hidden_tests }, out.results, `${a.id}:${p.id}`);
        if (t) await sql.query(`INSERT INTO mock_defence_checks (attempt_id, problem_id, kind, entry, code, args, setup, expected) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (attempt_id, problem_id) DO NOTHING`,
          [a.id, p.id, t.kind, p.entry_function ?? null, code, t.args ? JSON.stringify(t.args) : null, t.setup ?? null, JSON.stringify(t.expected)]);
      }
    }
    const score = problems.reduce((s, x) => s + x.marks, 0), max = problems.reduce((s, x) => s + x.maxMarks, 0);
    await sql.query(`INSERT INTO mock_round_results (attempt_id, round, score, max_score, details) VALUES ($1,'machine_test',$2,$3,$4)`, [a.id, score, max, JSON.stringify({ problems })]);
    await audit(sql, ctx, 'MOCK_CODING_SUBMITTED', 'mock_attempt', null, {});
    return { result: { score, maxScore: max, problems }, report: await finishIfComplete(sql, ctx, st.id, a.id, st.isMinor) };
  });

  r.post('/api/v2/student/mock/attempts/:id/defence', S, async ({ ctx, sql, params, body }) => {
    const st = await studentForUser(sql, ctx);
    const a = await loadAttempt(sql, st.id, params.id);
    if (a.status !== 'in_progress') throw new HttpError(409, 'This attempt is already completed.');
    const pend = (await sql.query<any>(`SELECT id, kind, expected, deadline_at FROM mock_defence_checks WHERE attempt_id = $1 AND answered_at IS NULL AND deadline_at IS NOT NULL`, [a.id])).rows;
    if (pend.length === 0) throw new HttpError(409, 'There is no follow-up question waiting.');
    const answers = body.answers && typeof body.answers === 'object' ? body.answers : {};
    for (const d of pend) {
      const raw = typeof answers[d.id] === 'string' ? answers[d.id].slice(0, 400) : '';
      // The server clock decides whether the answer came in time. A late answer is recorded but counts as wrong.
      const inTime = Date.now() <= new Date(d.deadline_at).getTime() + 2000;
      await sql.query(`UPDATE mock_defence_checks SET answer = $2, correct = $3, answered_at = now() WHERE id = $1`, [d.id, raw, inTime && checkDefenceAnswer(d.kind, raw, d.expected)]);
    }
    await audit(sql, ctx, 'MOCK_DEFENCE_ANSWERED', 'mock_attempt', a.id, { questions: pend.length });
    return { report: await finishIfComplete(sql, ctx, st.id, a.id, st.isMinor) };
  });

  r.post('/api/v2/student/mock/attempts/:id/interview', S, async ({ ctx, sql, params, body }) => {
    const st = await studentForUser(sql, ctx);
    const a = await loadAttempt(sql, st.id, params.id);
    if (a.status !== 'in_progress') throw new HttpError(409, 'This attempt is already completed.');
    const qs = (await sql.query<any>(`SELECT id, topic, question, key_points FROM interview_questions WHERE id = ANY($1)`, [a.interview_question_ids])).rows;
    const judge = deps.interviewJudge ?? null;
    const answers = [];
    for (const q of qs) answers.push(await scoreAnswer({ id: q.id, topic: q.topic, question: q.question, keyPoints: q.key_points }, String(body.answers?.[q.id] ?? '').slice(0, 4000), judge));
    const scorer = answers.every(x => x.scorer === 'rules') ? 'rules' : answers[0]?.scorer ?? 'rules';
    const score = Math.round(answers.reduce((s, x) => s + x.score, 0) * 10) / 10;
    await sql.query(`INSERT INTO mock_round_results (attempt_id, round, score, max_score, details) VALUES ($1,'interview',$2,$3,$4)`,
      [a.id, score, answers.length * 10, JSON.stringify({ answers, scorer, scoring: (scorer === 'rules' ? 'Keyword rubric: share of expected key points your answer mentions. No AI model was used.' : 'An AI model judged which expected key points your answer covers. The score is the share covered.') + ' This is a draft score and you can ask a person to review it. No voice, video or behaviour is used.' })]);
    await audit(sql, ctx, 'MOCK_INTERVIEW_SUBMITTED', 'mock_attempt', a.id, {});
    return { result: { score, maxScore: answers.length * 10, answers }, report: await finishIfComplete(sql, ctx, st.id, a.id, st.isMinor) };
  });

  // ---------- Learning path (ST-06) ----------
  const pathView = async (sql: any, studentId: string) => {
    const p = (await sql.query(`SELECT * FROM learning_paths WHERE student_id = $1 AND status = 'active'`, [studentId])).rows[0];
    if (!p) return null;
    const items = (await sql.query(`SELECT i.id, i.position, i.reason, i.status, i.completed_at, t.title, t.description, t.kind, t.target_proof, t.est_hours, k.canonical_name AS skill
      FROM learning_path_items i JOIN learning_tasks t ON t.id = i.task_id JOIN skills k ON k.id = t.skill_id WHERE i.path_id = $1 ORDER BY i.position`, [p.id])).rows;
    return { id: p.id, targetRole: p.target_role, rationale: p.rationale, createdAt: iso(p.created_at), items: items.map((x: any) => ({ ...x, completedAt: iso(x.completed_at), estHours: Number(x.est_hours) })),
      retakeUnlocked: items.length > 0 && items.filter((x: any) => x.status === 'passed').length >= Math.ceil(items.length / 2) };
  };

  r.get('/api/v2/student/learning-path', S, async ({ ctx, sql }) => {
    const st = await studentForUser(sql, ctx);
    return { path: await pathView(sql, st.id) };
  });

  r.post('/api/v2/student/learning-path/generate', S, async ({ ctx, sql, body }) => {
    const st = await studentForUser(sql, ctx);
    const last = (await sql.query<any>(`SELECT role_title, report FROM mock_attempts WHERE student_id = $1 AND status = 'completed' ORDER BY completed_at DESC LIMIT 1`, [st.id])).rows[0];
    const role = typeof body.targetRole === 'string' ? body.targetRole : last?.role_title ?? 'Backend Developer';
    const snap = await academicSnapshot(sql, st.id);
    const drives = await driveContexts(sql);
    const path = ProofPath.forStudent(snap, drives);
    const tasks = (await sql.query<any>(`SELECT t.id, t.slug, t.skill_id, k.canonical_name, t.title, t.kind, t.target_proof, t.weak_topics, t.est_hours FROM learning_tasks t JOIN skills k ON k.id = t.skill_id`)).rows
      .map(x => ({ id: x.id, slug: x.slug, skillId: x.skill_id, skillName: x.canonical_name, title: x.title, kind: x.kind, targetProof: x.target_proof, weakTopics: x.weak_topics, estHours: Number(x.est_hours) }));
    const verified = new Map(snap.skills.filter(s => s.state === 'verified' && s.proofLevel).map(s => [s.skillId, PROOF_LEVEL_RANK[s.proofLevel!]]));
    const weakTopics: string[] = last?.report?.weakTopics ?? [];
    const plan = planLearningPath({ proofActions: path.actions.map(a => ({ skillId: a.skillId, name: a.name, unlocksCount: a.unlocksCount, targetProof: a.targetProof })), weakTopics, verified, tasks });
    if (plan.length === 0) throw new HttpError(409, 'Nothing to plan: no blocking gaps or weak topics found. Take a mock drive first.');
    await sql.query(`UPDATE learning_paths SET status = 'archived' WHERE student_id = $1 AND status = 'active'`, [st.id]);
    const pid = randomUUID();
    await sql.query(`INSERT INTO learning_paths (id, student_id, target_role, rationale) VALUES ($1,$2,$3,$4)`,
      [pid, st.id, role, JSON.stringify({ weakTopics, topActions: path.actions.slice(0, 3).map(a => `${a.name} → ${a.targetProof} unlocks ${a.unlocksCount} drive(s)`) })]);
    for (const it of plan) await sql.query(`INSERT INTO learning_path_items (path_id, task_id, position, reason) VALUES ($1,$2,$3,$4)`, [pid, it.taskId, it.position, it.reason]);
    await audit(sql, ctx, 'LEARNING_PATH_GENERATED', 'learning_path', pid, { items: plan.length, weakTopics });
    return { path: await pathView(sql, st.id) };
  });

  r.get('/api/v2/student/learning-path/items/:id', S, async ({ ctx, sql, params }) => {
    const st = await studentForUser(sql, ctx);
    const it = await one<any>(sql, `SELECT i.*, t.title, t.description, t.kind, t.target_proof, t.coding_problem_id, k.canonical_name AS skill
      FROM learning_path_items i JOIN learning_paths p ON p.id = i.path_id JOIN learning_tasks t ON t.id = i.task_id JOIN skills k ON k.id = t.skill_id
      WHERE i.id = $1 AND p.student_id = $2`, [requireUuid(params.id, 'id'), st.id], 'Task not found.');
    let problem = null;
    if (it.coding_problem_id) {
      const p = await one<any>(sql, `SELECT id, title, statement, language, entry_function, starter_code, public_tests, sql_schema FROM coding_problems WHERE id = $1`, [it.coding_problem_id]);
      problem = { id: p.id, title: p.title, statement: p.statement, language: p.language, entry: p.entry_function, starter: p.starter_code?.[p.language] ?? '', publicTests: p.public_tests, schema: p.sql_schema };
    }
    return { id: it.id, title: it.title, description: it.description, kind: it.kind, targetProof: it.target_proof, skill: it.skill, status: it.status, reason: it.reason, problem };
  });

  r.post('/api/v2/student/learning-path/items/:id/submit', S, async ({ ctx, sql, params, body }) => {
    const st = await studentForUser(sql, ctx);
    const it = await one<any>(sql, `SELECT i.*, t.title, t.kind, t.skill_id, t.coding_problem_id, t.target_proof FROM learning_path_items i JOIN learning_paths p ON p.id = i.path_id
      JOIN learning_tasks t ON t.id = i.task_id WHERE i.id = $1 AND p.student_id = $2`, [requireUuid(params.id, 'id'), st.id], 'Task not found.');
    if (it.status === 'passed') return { status: 'passed', message: 'Already passed.' };
    if (it.kind === 'coding') {
      const p = await one<any>(sql, `SELECT * FROM coding_problems WHERE id = $1`, [it.coding_problem_id]);
      const code = requireString(body.code, 'code', 1, 20000);
      const out = p.language === 'sql' ? await deps.judge.runSql(p.sql_schema, p.hidden_tests, code, p.reference_solution) : await deps.judge.runJavaScript(code, p.entry_function, p.hidden_tests);
      await sql.query(`INSERT INTO judge_runs (student_id, purpose, ref_id, language, code, passed, total, results, runner) VALUES ($1,'learning_task',$2,$3,$4,$5,$6,$7,$8)`,
        [st.id, it.id, p.language, code, out.passed, out.total, JSON.stringify(out.results), out.runner]);
      if (out.passed < out.total) {
        await sql.query(`UPDATE learning_path_items SET status = 'failed' WHERE id = $1`, [it.id]);
        return { status: 'failed', judge: out, message: `${out.passed}/${out.total} hidden tests passed. Fix the failing cases and resubmit.` };
      }
      const award = await awardProof(sql, ctx, { studentId: st.id, skillId: it.skill_id, reasonCode: 'LEARNING_TASK_PASSED', level: 2,
        evidence: { kind: 'test_result', description: `Learning task "${it.title}": all ${out.total} hidden tests passed`, source: 'learning_path', contentHash: sha256(code) },
        verification: { type: 'assessment', assessment: { score: out.passed, maxScore: out.total } } });
      await sql.query(`UPDATE learning_path_items SET status = 'passed', evidence_id = $2, completed_at = now() WHERE id = $1`, [it.id, award.evidenceId]);
      await reevaluateStudent(sql, ctx, st.id);
      return { status: 'passed', judge: out, message: `${award.message} New proof added to your profile.` };
    }
    const link = typeof body.link === 'string' && /^https?:\/\//.test(body.link) ? body.link.slice(0, 500) : null;
    if (!link) throw new HttpError(400, 'Submit a link (repository, document or drive folder) to your work.');
    const eid = randomUUID();
    await sql.query(`INSERT INTO evidence_items (id, student_id, kind, content_hash, status, object_key, description, source, claimed_skill_id)
      VALUES ($1,$2,$3,$4,'submitted',$5,$6,'learning_path',$7)`, [eid, st.id, it.kind === 'project' ? 'lab' : 'lab', sha256(`${eid}:${link}`), link, `Learning task "${it.title}"`, it.skill_id]);
    await sql.query(`UPDATE learning_path_items SET status = 'submitted', evidence_id = $2 WHERE id = $1`, [it.id, eid]);
    return { status: 'submitted', message: 'Sent to your mentor. If they approve it, it counts as Level 3 proof.' };
  });

  // ---------- Live Mutation Probe (L3 Defended) ----------
  r.get('/api/v2/student/probes', S, async ({ ctx, sql }) => {
    const st = await studentForUser(sql, ctx);
    const rows = await sql.query<any>(`SELECT p.id, p.title, p.description, p.file_path, p.commit_sha, k.canonical_name AS skill, ss.state, ss.proof_level, p.provenance
      FROM probe_definitions p JOIN skills k ON k.id = p.skill_id LEFT JOIN student_skills ss ON ss.student_id = p.student_id AND ss.skill_id = p.skill_id WHERE p.student_id = $1`, [st.id]);
    return rows.rows;
  });

  r.get('/api/v2/student/probes/:id', S, async ({ ctx, sql, params }) => {
    const st = await studentForUser(sql, ctx);
    const p = await one<any>(sql, `SELECT p.*, k.canonical_name AS skill FROM probe_definitions p JOIN skills k ON k.id = p.skill_id WHERE p.id = $1 AND p.student_id = $2`, [requireUuid(params.id, 'id'), st.id], 'Probe not found.');
    const session = (await sql.query<any>(`SELECT vs.id, vq.evaluator_score, vq.rubric_evaluation FROM verification_sessions vs JOIN student_skills ss ON ss.id = vs.student_skill_id
      LEFT JOIN verification_questions vq ON vq.session_id = vs.id WHERE ss.student_id = $1 AND ss.skill_id = $2 AND vs.modality = 'probe' AND vs.outcome IS NULL ORDER BY vs.started_at DESC LIMIT 1`, [st.id, p.skill_id])).rows[0];
    return {
      id: p.id, title: p.title, skill: p.skill, provenance: p.provenance,
      anchor: { repository: p.description, commitSha: p.commit_sha, filePath: p.file_path, lineStart: p.line_start, lineEnd: p.line_end, contentHash: p.content_hash,
        hashVerified: sha256(p.code_span) === p.content_hash },
      code: p.code_span, predictQuestion: p.predict_question, mutationTask: p.mutation_task, entry: p.entry_function_name,
      predict: session?.evaluator_score !== undefined && session?.evaluator_score !== null ? { score: Number(session.evaluator_score), feedback: session.rubric_evaluation } : null,
    };
  });

  r.post('/api/v2/student/probes/:id/predict', S, async ({ ctx, sql, params, body }) => {
    const st = await studentForUser(sql, ctx);
    const p = await one<any>(sql, `SELECT * FROM probe_definitions WHERE id = $1 AND student_id = $2`, [requireUuid(params.id, 'id'), st.id], 'Probe not found.');
    const answer = requireString(body.answer, 'answer', 10, 4000);
    const scored = await scoreAnswer({ id: p.id, topic: 'probe', question: p.predict_question, keyPoints: p.predict_key_points }, answer, deps.interviewJudge ?? null);
    const ss = (await sql.query<any>(`SELECT id FROM student_skills WHERE student_id = $1 AND skill_id = $2`, [st.id, p.skill_id])).rows[0];
    if (!ss) throw new HttpError(409, 'Link the repository evidence for this skill first.');
    const rubric = await one<any>(sql, `SELECT id FROM rubric_versions WHERE skill_id = $1 ORDER BY version_no DESC LIMIT 1`, [p.skill_id]);
    const sid = randomUUID();
    await sql.query(`INSERT INTO verification_sessions (id, student_skill_id, rubric_version_id, modality) VALUES ($1,$2,$3,'probe')`, [sid, ss.id, rubric.id]);
    const ev = (await sql.query<any>(`SELECT e.id FROM evidence_items e JOIN skill_evidence se ON se.evidence_id = e.id WHERE se.student_skill_id = $1 AND e.kind = 'code_span' ORDER BY e.created_at LIMIT 1`, [ss.id])).rows[0];
    if (!ev) throw new HttpError(409, 'No code evidence is linked to this skill.');
    await sql.query(`INSERT INTO verification_questions (session_id, evidence_id, question_text, expected_criteria, student_response, evaluator_score, rubric_evaluation)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`, [sid, ev.id, p.predict_question, JSON.stringify(p.predict_key_points.map((k: any) => k.point)), answer, scored.score, JSON.stringify({ covered: scored.covered, missed: scored.missed, scorer: scored.scorer })]);
    const passed = scored.score >= 6;
    return { score: scored.score, covered: scored.covered, missed: scored.missed, passed,
      message: passed ? 'Good reasoning. Now make the change in the editor; hidden tests will check it.' : 'Your explanation missed key points. Re-read the code and try again.' };
  });

  r.post('/api/v2/student/probes/:id/mutate', S, async ({ ctx, sql, params, body }) => {
    const st = await studentForUser(sql, ctx);
    const p = await one<any>(sql, `SELECT * FROM probe_definitions WHERE id = $1 AND student_id = $2`, [requireUuid(params.id, 'id'), st.id], 'Probe not found.');
    const session = (await sql.query<any>(`SELECT vs.id, vq.evaluator_score FROM verification_sessions vs JOIN student_skills ss ON ss.id = vs.student_skill_id
      JOIN verification_questions vq ON vq.session_id = vs.id WHERE ss.student_id = $1 AND ss.skill_id = $2 AND vs.modality = 'probe' AND vs.outcome IS NULL ORDER BY vs.started_at DESC LIMIT 1`, [st.id, p.skill_id])).rows[0];
    if (!session || Number(session.evaluator_score) < 6) throw new HttpError(409, 'Answer the prediction question first.');
    const code = requireString(body.code, 'code', 1, 20000);
    const tests = JSON.parse(p.test_harness_code);
    const out = await deps.judge.runJavaScript(code, p.entry_function_name, tests);
    await sql.query(`INSERT INTO probe_runs (session_id, probe_id, submitted_code, passed, exit_code, execution_time_ms, test_summary) VALUES ($1,$2,$3,$4,0,0,$5)`,
      [session.id, p.id, code, out.passed === out.total, JSON.stringify({ total: out.total, passed: out.passed, failed: out.total - out.passed })]);
    if (out.passed < out.total) return { passed: false, judge: out, message: `${out.passed}/${out.total} hidden tests passed. Read the failing case and try again.` };
    const award = await awardProof(sql, ctx, { studentId: st.id, skillId: p.skill_id, sessionId: session.id, reasonCode: 'LIVE_MUTATION_PROBE_PASSED', level: 2,
      evidence: { kind: 'code_span', description: `Live Mutation Probe on ${p.file_path}: explained the code and changed it; ${out.total}/${out.total} hidden tests passed`, source: 'live_probe', contentHash: sha256(code), path: p.file_path },
      verification: { type: 'probe', probeResult: { probeId: p.id, passed: true, exitCode: 0, executionTimeMs: 0, stdout: '', stderr: '', testSummary: { total: out.total, passed: out.passed, failed: 0 } } } });
    await reevaluateStudent(sql, ctx, st.id);
    return { passed: true, judge: out, message: award.message };
  });

  // ---------- My drives & eligibility (ST-07) ----------
  r.get('/api/v2/student/drives', S, async ({ ctx, sql }) => {
    const st = await studentForUser(sql, ctx);
    const drives = await driveContexts(sql);
    const snap = await academicSnapshot(sql, st.id);
    const path = ProofPath.forStudent(snap, drives);
    const decisions = await sql.query<any>(`SELECT ed.id, ed.drive_id, ed.result, ed.reasons, ed.status, ed.created_at,
        (SELECT jsonb_build_object('status', a.status, 'note', a.decision_note) FROM eligibility_appeals a WHERE a.decision_id = ed.id ORDER BY a.created_at DESC LIMIT 1) AS appeal
      FROM eligibility_decisions ed WHERE ed.student_id = $1`, [st.id]);
    const apps = await sql.query<any>(`SELECT id, drive_id, stage FROM applications WHERE student_id = $1`, [st.id]);
    const rounds = await sql.query<any>(`SELECT drive_id, title, starts_at, ends_at FROM drive_rounds WHERE status = 'scheduled' ORDER BY starts_at`);
    const effort = (await sql.query<any>(`SELECT skill_id, target_proof, est_hours FROM learning_tasks`)).rows
      .map(x => ({ skillId: x.skill_id, targetProof: x.target_proof, estHours: Number(x.est_hours) }));
    const topActions = path.actions.filter(a => a.unlocksCount > 0).slice(0, 5);
    const timing = recourseTiming(topActions, drives, effort);
    return {
      drives: drives.map(d => {
        const dec = decisions.rows.find(x => x.drive_id === d.driveId && x.status !== 'provisional');
        const blockers = path.drives.find(x => x.driveId === d.driveId);
        return {
          id: d.driveId, title: d.title, company: d.company, startsAt: d.startsAt, ctc: d.ctc, ruleVersion: d.ruleVersion.versionNo,
          published: !!dec,
          decision: dec ? { id: dec.id, result: dec.result, checks: dec.reasons.checks, decidedAt: iso(dec.created_at), overridden: dec.status === 'overridden', appeal: dec.appeal } : null,
          application: apps.rows.find(x => x.drive_id === d.driveId)?.stage ?? null,
          applicationId: apps.rows.find(x => x.drive_id === d.driveId)?.id ?? null,
          proofBlockers: blockers?.proofBlockers ?? [],
          rounds: rounds.rows.filter(x => x.drive_id === d.driveId).map(x => ({ title: x.title, startsAt: iso(x.starts_at), endsAt: iso(x.ends_at) })),
        };
      }),
      proofPath: { eligibleNow: path.eligibleDriveIds.length, total: path.totalDrives, actions: topActions
        .map((a, i) => ({ ...a, drives: a.unlocksDriveIds.map(id => drives.find(d => d.driveId === id)?.title), timing: timing[i] })) },
    };
  });

  r.post('/api/v2/student/drives/:id/apply', S, async ({ ctx, sql, params }) => {
    const st = await studentForUser(sql, ctx);
    const driveId = requireUuid(params.id, 'drive id');
    const dec = (await sql.query<any>(`SELECT result FROM eligibility_decisions WHERE drive_id = $1 AND student_id = $2 AND status IN ('published', 'overridden') ORDER BY created_at DESC LIMIT 1`, [driveId, st.id])).rows[0];
    if (!dec || dec.result !== 'eligible') throw new HttpError(403, 'You can apply once your eligibility for this drive is published as eligible.');
    const id = randomUUID();
    await sql.query(`INSERT INTO applications (id, drive_id, student_id, stage) VALUES ($1,$2,$3,'applied')`, [id, driveId, st.id]);
    await sql.query(`INSERT INTO application_events (application_id, from_stage, to_stage, note) VALUES ($1, NULL, 'applied', 'Student applied')`, [id]);
    await audit(sql, ctx, 'APPLICATION_CREATED', 'application', id, { driveId });
    return { id, stage: 'applied' };
  });

  r.post('/api/v2/student/appeals', S, async ({ ctx, sql, body }) => {
    const st = await studentForUser(sql, ctx);
    const decisionId = requireUuid(body.decisionId, 'decisionId');
    const reason = requireString(body.reason, 'reason', 10, 2000);
    await one(sql, `SELECT id FROM eligibility_decisions WHERE id = $1 AND student_id = $2 AND status IN ('published', 'overridden')`, [decisionId, st.id], 'Decision not found.');
    const id = randomUUID();
    await sql.query(`INSERT INTO eligibility_appeals (id, decision_id, student_id, reason) VALUES ($1,$2,$3,$4)`, [id, decisionId, st.id, reason]);
    await audit(sql, ctx, 'APPEAL_SUBMITTED', 'eligibility_appeal', id, { decisionId });
    return { id, message: 'Appeal sent to the placement office. You will see their answer here, usually within 3 days.' };
  });

  // ---------- Target companies & gaps (ST-04) ----------
  r.get('/api/v2/student/targets', S, async ({ ctx, sql }) => {
    const st = await studentForUser(sql, ctx);
    const snap = await academicSnapshot(sql, st.id);
    const roles = await sql.query<any>(`SELECT jr.id, jr.title, c.name AS company, d.id AS drive_id, d.ctc_inr,
        jsonb_agg(jsonb_build_object('skillId', k.id, 'name', k.canonical_name, 'minLevel', jrs.min_level)) AS skills
      FROM job_roles jr JOIN companies c ON c.id = jr.company_id JOIN job_role_skills jrs ON jrs.role_id = jr.id JOIN skills k ON k.id = jrs.skill_id
      LEFT JOIN drives d ON d.role_id = jr.id AND d.status IN ('scheduled', 'draft')
      GROUP BY jr.id, jr.title, c.name, d.id, d.ctc_inr`);
    const drives = await driveContexts(sql);
    const saved = new Set((await sql.query<any>(`SELECT role_id FROM student_targets WHERE student_id = $1`, [st.id])).rows.map(x => x.role_id));
    return roles.rows.map(r0 => {
      const required = r0.skills.map((s: any) => {
        const mine = snap.skills.find(x => x.skillId === s.skillId);
        return { name: s.name, requiredLevel: s.minLevel, state: mine?.state ?? 'missing', proofLevel: mine?.proofLevel ?? null, met: mine?.state === 'verified' && (mine.level ?? 1) >= s.minLevel };
      });
      const drive = drives.find(d => d.driveId === r0.drive_id);
      const elig = drive ? EligibilityEvaluator.evaluate(snap, drive.ruleVersion, { driveStartsAt: drive.startsAt }) : null;
      return { roleId: r0.id, saved: saved.has(r0.id), title: r0.title, company: r0.company.replace('[SYNTHETIC] ', ''), ctc: r0.ctc_inr ? Number(r0.ctc_inr) : null,
        fitPercent: Math.round((required.filter((x: any) => x.met).length / required.length) * 100), required,
        gaps: required.filter((x: any) => !x.met).map((x: any) => `${x.name}: ${x.state === 'missing' ? 'not on profile' : x.state.replace('_', '-')}`),
        eligibilityPreview: elig ? { status: elig.status, failing: elig.checks.filter(c => c.passed !== true).map(c => c.message) } : null };
    }).sort((a: any, b: any) => Number(b.saved) - Number(a.saved) || b.fitPercent - a.fitPercent);
  });
  /** Saves or removes a role the student is working towards. Saved roles come first and drive the gap list. */
  r.post('/api/v2/student/targets/:roleId/toggle', S, async ({ ctx, sql, params }) => {
    const st = await studentForUser(sql, ctx);
    const role = await one<any>(sql, `SELECT id FROM job_roles WHERE id = $1`, [requireUuid(params.roleId, 'role id')], 'Role not found.');
    const had = (await sql.query<any>(`DELETE FROM student_targets WHERE student_id = $1 AND role_id = $2 RETURNING 1`, [st.id, role.id])).rows.length > 0;
    if (!had) await sql.query(`INSERT INTO student_targets (student_id, role_id) VALUES ($1,$2)`, [st.id, role.id]);
    await audit(sql, ctx, had ? 'TARGET_REMOVED' : 'TARGET_SAVED', 'job_role', role.id, {});
    return { saved: !had };
  });

  // ---------- Privacy & consent (ST-08) ----------
  r.get('/api/v2/student/privacy', S, async ({ ctx, sql }) => {
    const st = await studentForUser(sql, ctx);
    const purposes = await sql.query<any>(`SELECT p.code, p.description, p.retention_days, p.requires_guardian_for_minor,
        (SELECT g.granted_at FROM consent_grants g WHERE g.student_id = $1 AND g.purpose = p.code AND g.revoked_at IS NULL ORDER BY g.granted_at DESC LIMIT 1) AS granted_at
      FROM consent_purposes p ORDER BY p.code`, [st.id]);
    const gh = await sql.query<any>(`SELECT status, connected_at FROM connected_accounts WHERE student_id = $1 AND provider = 'github'`, [st.id]);
    const reqs = await sql.query<any>(`SELECT id, type, status, due_at, created_at FROM data_requests WHERE student_id = $1 ORDER BY created_at DESC`, [st.id]);
    const guardian = await sql.query<any>(`SELECT status FROM guardian_consents WHERE student_id = $1 ORDER BY verified_at DESC NULLS LAST LIMIT 1`, [st.id]);
    return {
      isMinor: st.isMinor, guardianConsent: guardian.rows[0]?.status ?? null,
      purposes: purposes.rows.map(x => ({ code: x.code, description: x.description, retentionDays: x.retention_days, active: !!x.granted_at, grantedAt: iso(x.granted_at),
        blockedForMinor: st.isMinor && x.code === 'recruiter_sharing' && guardian.rows[0]?.status !== 'verified' })),
      github: gh.rows[0] ? { status: gh.rows[0].status, connectedAt: iso(gh.rows[0].connected_at) } : null,
      dataRequests: reqs.rows.map(x => ({ ...x, dueAt: iso(x.due_at), createdAt: iso(x.created_at) })),
      howScoresWork: [
        'Skills are Verified only with evidence and a passed check: code (L1), a platform test (L2), or a defence or mentor sign-off (L3).',
        'Eligibility uses only the rules your placement office published; each rule shows pass or fail in plain words.',
        'Gender and category, if you choose to share them, are used only in aggregate fairness checks and never in eligibility or by recruiters.',
        'The interview round is scored only on what you say, never on voice, video or behaviour.',
      ],
    };
  });

  r.post('/api/v2/student/consents', S, async ({ ctx, sql, body }) => {
    const st = await studentForUser(sql, ctx);
    const purpose = requireString(body.purpose, 'purpose');
    await one(sql, `SELECT code FROM consent_purposes WHERE code = $1`, [purpose], 'Unknown purpose.');
    if (body.action === 'grant') {
      if (st.isMinor && purpose === 'recruiter_sharing') {
        const g = (await sql.query<any>(`SELECT 1 FROM guardian_consents WHERE student_id = $1 AND status = 'verified'`, [st.id])).rows[0];
        if (!g) throw new HttpError(403, 'Students under 18 need verified parental consent before sharing with recruiters. Ask the placement office.');
      }
      await sql.query(`UPDATE consent_grants SET revoked_at = now() WHERE student_id = $1 AND purpose = $2 AND revoked_at IS NULL`, [st.id, purpose]);
      await sql.query(`INSERT INTO consent_grants (student_id, purpose, notice_version) VALUES ($1,$2,1)`, [st.id, purpose]);
      await audit(sql, ctx, 'CONSENT_GRANTED', 'consent_grant', null, { purpose });
      return { active: true };
    }
    if (body.action !== 'revoke') throw new HttpError(400, 'action must be grant or revoke.');
    await sql.query(`UPDATE consent_grants SET revoked_at = now() WHERE student_id = $1 AND purpose = $2 AND revoked_at IS NULL`, [st.id, purpose]);
    // Recruiters may only work with a student who agreed to share. Withdrawing that agreement removes any interview kits made about them.
    if (purpose === 'recruiter_sharing') await sql.query(`DELETE FROM project_kits WHERE student_id = $1`, [st.id]);
    let demoted = 0;
    let upstream: string = 'not_connected';
    if (purpose === 'repo_verification') {
      if (deps.githubRevoker) {
        try { upstream = (await deps.githubRevoker(ctx, st.id)).providerRevocationStatus; } catch { upstream = 'failed'; }
      }
      // Imported code can no longer be used as proof: seal snapshots, mark ingestion records revoked, stop running jobs.
      await sql.query(`UPDATE source_snapshots SET registration_state = 'quarantined' WHERE student_id = $1`, [st.id]);
      await sql.query(`UPDATE trusted_ingestion_records SET status = 'revoked' WHERE student_id = $1`, [st.id]);
      await sql.query(`UPDATE ingestion_jobs SET status = 'failed', error = 'CONSENT_REVOKED', completed_at = CURRENT_TIMESTAMP WHERE student_id = $1 AND status IN ('queued', 'resolving', 'fetching', 'verifying', 'persisted')`, [st.id]);
      await sql.query(`DELETE FROM connected_accounts WHERE student_id = $1 AND provider = 'github'`, [st.id]);
      await sql.query(`UPDATE evidence_items SET status = 'withdrawn' WHERE student_id = $1 AND kind IN ('code_span', 'commit') AND status = 'accepted' AND COALESCE(source, '') <> 'live_probe'`, [st.id]);
      const skills = await sql.query<any>(`SELECT ss.id, ss.state,
          (SELECT count(*)::int FROM skill_evidence se JOIN evidence_items e ON e.id = se.evidence_id WHERE se.student_skill_id = ss.id AND e.status = 'accepted') AS remaining,
          (SELECT count(*)::int FROM skill_evidence se JOIN evidence_items e ON e.id = se.evidence_id WHERE se.student_skill_id = ss.id AND e.status = 'withdrawn') AS withdrawn
        FROM student_skills ss WHERE ss.student_id = $1 AND ss.state IN ('verified', 'evidence_linked')`, [st.id]);
      for (const s of skills.rows) {
        if (s.withdrawn === 0) continue;
        const target = s.remaining > 0 ? 'evidence_linked' : 'claimed';
        if (target === s.state) continue;
        await sql.query(`UPDATE student_skills SET state = $2 WHERE id = $1`, [s.id, target]);
        await sql.query(`INSERT INTO skill_state_events (student_skill_id, from_state, to_state, reason_code, actor_type, actor_id) VALUES ($1,$2,$3,'EVIDENCE_WITHDRAWN_CONSENT_REVOKED','student',$4)`, [s.id, s.state, target, ctx.userId]);
        demoted++;
      }
      await reevaluateStudent(sql, ctx, st.id);
    }
    await audit(sql, ctx, 'CONSENT_REVOKED', 'consent_grant', null, { purpose, skillsDemoted: demoted, githubGrant: upstream });
    return { active: false, skillsDemoted: demoted, githubGrant: upstream,
      message: purpose === 'repo_verification' ? `Repository access withdrawn; code evidence withdrawn; ${demoted} skill(s) updated${upstream === 'confirmed' ? '; GitHub access revoked at GitHub' : upstream === 'failed' ? '; we could not reach GitHub, so please also remove PRAMAAN in your GitHub settings' : ''}.` : 'Consent withdrawn.' };
  });

  // ---------- Decision to evidence: one chain from a result to the proof behind it (BR-12) ----------
  r.get('/api/v2/student/decisions/:id/trace', S, async ({ sql, ctx, params }) => {
    const st = await studentForUser(sql, ctx);
    const d = await one<any>(sql, `SELECT ed.id, ed.result, ed.reasons, ed.status, ed.created_at, ed.input_hash, ed.input_snapshot, v.version_no, v.rationale, v.published_at, dr.title, c.name AS company
      FROM eligibility_decisions ed JOIN eligibility_rule_versions v ON v.id = ed.rule_version_id JOIN drives dr ON dr.id = ed.drive_id JOIN companies c ON c.id = dr.company_id
      WHERE ed.id = $1 AND ed.student_id = $2`, [requireUuid(params.id, 'decision id'), st.id], 'Decision not found.');
    const checks: any[] = d.reasons?.checks ?? [];
    const out: any[] = [];
    for (const c of checks) {
      const item: any = { id: c.id, passed: c.passed, message: c.message, skill: null };
      const m = /^skills\.([0-9a-f-]{36})$/.exec(String(c.id));
      if (m) {
        const ss = (await sql.query<any>(`SELECT ss.id, ss.state, ss.proof_level, ss.level, ss.valid_until, k.canonical_name FROM student_skills ss JOIN skills k ON k.id = ss.skill_id WHERE ss.student_id = $1 AND ss.skill_id = $2`, [st.id, m[1]])).rows[0];
        if (ss) {
          const ev = (await sql.query<any>(`SELECT e.kind, e.description, e.source, e.path, e.content_hash, e.status, e.accepted_at FROM skill_evidence se JOIN evidence_items e ON e.id = se.evidence_id WHERE se.student_skill_id = $1 ORDER BY e.created_at DESC`, [ss.id])).rows;
          const hist = (await sql.query<any>(`SELECT from_state, to_state, reason_code, proof_level, occurred_at FROM skill_state_events WHERE student_skill_id = $1 ORDER BY occurred_at DESC LIMIT 5`, [ss.id])).rows;
          item.skill = { id: ss.id, name: ss.canonical_name, state: ss.state, proofLevel: ss.proof_level, level: ss.level, validUntil: iso(ss.valid_until),
            evidence: ev.map(e => ({ kind: e.kind, description: e.description, source: e.source, path: e.path, hash: String(e.content_hash).slice(0, 12), status: e.status, acceptedAt: iso(e.accepted_at) })),
            history: hist.map(h => ({ from: h.from_state, to: h.to_state, reason: h.reason_code, proofLevel: h.proof_level, at: iso(h.occurred_at) })) };
        }
      }
      out.push(item);
    }
    return { decision: { id: d.id, drive: d.title.replace('[SYNTHETIC] ', ''), company: d.company.replace('[SYNTHETIC] ', ''), result: d.result, status: d.status, decidedAt: iso(d.created_at), inputHash: String(d.input_hash).slice(0, 16) },
      rules: { version: d.version_no, rationale: d.rationale, publishedAt: iso(d.published_at) }, checks: out,
      howToReproduce: 'The same marks, skills and rule version always give the same result. The input fingerprint above identifies the exact data that was used.' };
  });

  /**
   * Replays a decision: runs the rules again on the saved inputs (not on today's data) and compares the result and the input
   * fingerprint with what was stored. A match shows the stored decision follows from its saved inputs and rule version.
   * It does not show the rule itself is fair or the inputs were correct.
   */
  r.post('/api/v2/student/decisions/:id/replay', S, async ({ sql, ctx, params }) => {
    const st = await studentForUser(sql, ctx);
    const d = await one<any>(sql, `SELECT ed.id, ed.result, ed.input_snapshot, ed.input_hash, ed.reasons, v.id AS rv_id, v.rule_set_id, v.version_no, v.rules, v.rationale, v.published_by, v.published_at, dr.starts_at, ed.status
      FROM eligibility_decisions ed JOIN eligibility_rule_versions v ON v.id = ed.rule_version_id JOIN drives dr ON dr.id = ed.drive_id WHERE ed.id = $1 AND ed.student_id = $2`, [requireUuid(params.id, 'decision id'), st.id], 'Decision not found.');
    const version = { id: d.rv_id, ruleSetId: d.rule_set_id, versionNo: d.version_no, rules: EligibilityRuleSpecSchema.parse(d.rules), rationale: d.rationale, publishedBy: d.published_by, publishedAt: new Date(d.published_at).toISOString() } as any;
    const res = EligibilityEvaluator.evaluate(d.input_snapshot, version, { driveStartsAt: new Date(d.starts_at).toISOString() });
    const sameResult = res.status === d.result;
    const sameInputs = res.inputHash === d.input_hash;
    const sameChecks = JSON.stringify((res.checks ?? []).map((c: any) => [c.id, c.passed])) === JSON.stringify((d.reasons?.checks ?? []).map((c: any) => [c.id, c.passed]));
    const overridden = d.status === 'overridden';
    return { reproduced: sameResult && sameInputs && sameChecks, sameResult, sameInputs, sameChecks, storedResult: d.result, replayedResult: res.status, ruleVersion: d.version_no, overridden,
      message: overridden ? 'This decision was changed by the placement office after an appeal, so the stored result differs from the rules by design.'
        : sameResult && sameInputs && sameChecks ? 'Same rules and same saved inputs give the same result, check by check.' : 'The replay did not match the stored decision. Ask the placement office to look into it.' };
  });

  // ---------- Imported GitHub code becomes evidence (ST-02) ----------
  const importedFiles = async (sql: any, studentId: string) => (await sql.query(`SELECT s.file_path, s.raw_file_hash, s.raw_bytes, r.url FROM source_snapshots s JOIN repositories r ON r.id = s.repository_id
      WHERE s.student_id = $1 AND s.registration_state <> 'quarantined'`, [studentId])).rows.map((x: any) => ({ path: x.file_path, rawFileHash: x.raw_file_hash, bytes: x.raw_bytes, repo: String(x.url).replace("https://github.com/", "") }));
  r.get('/api/v2/student/github/summary', S, async ({ sql, ctx }) => {
    const st = await studentForUser(sql, ctx);
    const files = await importedFiles(sql, st.id);
    return { files: files.length, repositories: [...new Set(files.map((f: any) => f.repo))], signals: signalsFromFiles(files, sha256) };
  });
  /** Records the skills shown by code the student imported. Each becomes Evidence-linked at most; verification still needs a test, a code check or a mentor. */
  r.post('/api/v2/student/github/evidence', S, async ({ sql, ctx }) => {
    const st = await studentForUser(sql, ctx);
    const consent = (await sql.query<any>(`SELECT 1 FROM consent_grants WHERE student_id = $1 AND purpose = 'repo_verification' AND revoked_at IS NULL`, [st.id])).rows[0];
    if (!consent) throw new HttpError(403, 'Repository sharing is switched off. Turn it on in Privacy & Consent first.');
    const signals = signalsFromFiles(await importedFiles(sql, st.id), sha256).filter(s => s.files >= 1);
    const results: AwardResult[] = [];
    for (const s of signals) {
      const exists = (await sql.query<any>(`SELECT 1 FROM evidence_items WHERE student_id = $1 AND content_hash = $2 AND status = 'accepted'`, [st.id, s.contentHash])).rows[0];
      if (exists) continue;
      results.push(await awardProof(sql, ctx, { studentId: st.id, skillSlug: s.skillSlug, reasonCode: 'GITHUB_CODE_IMPORTED',
        evidence: { kind: 'code_span', description: `Code you imported: ${s.files} file(s), ${s.lines} lines in ${s.repos.join(', ')} (for example ${s.examplePaths[0]})`, source: 'github_import', contentHash: s.contentHash, path: s.examplePaths[0] } }));
    }
    await audit(sql, ctx, 'GITHUB_EVIDENCE_RECORDED', 'student', st.id, { skills: results.length });
    return { added: results.length, skills: results.map(x => ({ skill: x.skillName, state: x.state })), message: results.length ? `${results.length} skill(s) now have evidence from your code. Pass a test or the code check to make them Verified.` : 'Nothing new to add from your imported code.' };
  });

  r.post('/api/v2/student/data-requests', S, async ({ ctx, sql, body }) => {
    const st = await studentForUser(sql, ctx);
    if (!['access', 'correction', 'erasure', 'grievance'].includes(body.type)) throw new HttpError(400, 'Unknown request type.');
    const id = randomUUID();
    await sql.query(`INSERT INTO data_requests (id, student_id, type, due_at, exception_note) VALUES ($1,$2,$3, now() + interval '30 days', $4)`, [id, st.id, body.type, typeof body.note === 'string' ? body.note.slice(0, 1000) : null]);
    await audit(sql, ctx, 'DATA_REQUEST_CREATED', 'data_request', id, { type: body.type });
    return { id, message: 'Request recorded. The placement office must respond within 30 days.' };
  });

  r.get('/api/v2/student/export', S, async ({ ctx, sql }) => {
    const st = await studentForUser(sql, ctx);
    const q = async (text: string) => (await sql.query<any>(text, [st.id])).rows;
    const data = {
      exportedAt: new Date().toISOString(),
      student: await q(`SELECT s.enrollment_no, s.graduating_year, s.date_of_birth, u.full_name, u.email FROM students s JOIN users u ON u.id = s.user_id WHERE s.id = $1`),
      academics: await q(`SELECT cgpa, tenth_pct, twelfth_pct, diploma_pct, active_backlogs, backlog_history, gap_years, as_of FROM academic_records WHERE student_id = $1`),
      skills: await q(`SELECT k.canonical_name, ss.state, ss.proof_level, ss.valid_until FROM student_skills ss JOIN skills k ON k.id = ss.skill_id WHERE ss.student_id = $1`),
      evidence: await q(`SELECT kind, status, description, path, created_at, valid_until FROM evidence_items WHERE student_id = $1`),
      consents: await q(`SELECT purpose, granted_at, revoked_at FROM consent_grants WHERE student_id = $1`),
      eligibility: await q(`SELECT drive_id, result, reasons, status, created_at FROM eligibility_decisions WHERE student_id = $1`),
      applications: await q(`SELECT drive_id, stage, created_at FROM applications WHERE student_id = $1`),
      mockAttempts: await q(`SELECT role_title, status, report, completed_at FROM mock_attempts WHERE student_id = $1`),
    };
    await audit(sql, ctx, 'DATA_EXPORTED', 'student', st.id, {});
    return data;
  });

  // ---------- Skill Passport ----------
  r.post('/api/v2/student/credentials', S, async ({ ctx, sql, body }) => {
    if (!deps.issuer) throw new HttpError(501, 'Credential issuing is not configured (PRAMAAN_ISSUER_SEED).');
    const st = await studentForUser(sql, ctx);
    const ss = await one<any>(sql, `SELECT ss.*, k.canonical_name, o.name AS college FROM student_skills ss JOIN skills k ON k.id = ss.skill_id JOIN students s ON s.id = ss.student_id JOIN organizations o ON o.id = s.org_id
      WHERE ss.id = $1 AND ss.student_id = $2`, [requireUuid(body.studentSkillId, 'studentSkillId'), st.id], 'Skill not found.');
    if (ss.state !== 'verified') throw new HttpError(409, 'Only Verified skills can be issued as a credential.');
    const esco = (await sql.query<any>(`SELECT code FROM skill_mappings WHERE skill_id = $1 AND framework = 'ESCO' AND status = 'confirmed' LIMIT 1`, [ss.skill_id])).rows[0]?.code ?? null;
    const ev = await sql.query<any>(`SELECT e.id, e.kind, e.description FROM skill_evidence se JOIN evidence_items e ON e.id = se.evidence_id WHERE se.student_skill_id = $1 AND e.status = 'accepted' ORDER BY e.created_at DESC LIMIT 5`, [ss.id]);
    const keyId = `urn:pramaan:issuer:${ctx.orgId}#key-1`;
    await sql.query(`INSERT INTO issuer_keys (id, org_id, public_key_pem) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`, [keyId, ctx.orgId, deps.issuer.publicKeyPem]);
    const id = randomUUID();
    const payload = buildOpenBadge({
      credentialId: id, issuer: { id: `urn:pramaan:issuer:${ctx.orgId}`, name: ss.college.replace('[SYNTHETIC] ', '') },
      student: { id: st.id, name: st.fullName.replace(' [SYNTHETIC]', '') }, skill: { id: ss.skill_id, name: ss.canonical_name, esco },
      proofLevel: ss.proof_level, method: ss.proof_level, evidence: ev.rows.map(x => ({ id: x.id, kind: x.kind, description: x.description ?? x.kind })),
      issuedAt: new Date().toISOString(), validUntil: new Date(ss.valid_until).toISOString(),
    }, deps.issuer.verifyBaseUrl);
    const proof = signCredential(payload, deps.issuer.privateKey);
    await sql.query(`INSERT INTO credentials (id, org_id, student_id, student_skill_id, skill_id, proof_level, payload, proof_value, issuer_key_id, valid_until) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, ctx.orgId, st.id, ss.id, ss.skill_id, ss.proof_level, JSON.stringify(payload), proof, keyId, ss.valid_until]);
    await audit(sql, ctx, 'CREDENTIAL_ISSUED', 'credential', id, { skill: ss.canonical_name, proofLevel: ss.proof_level });
    return { id, verifyUrl: `${deps.issuer.verifyBaseUrl}/${id}`, credential: { ...payload, proof: { type: 'Ed25519Signature', verificationMethod: keyId, proofValue: proof } } };
  });
}

/** Public, unauthenticated credential verification (anyone the student shares the link with). */
export function registerPublicRoutes(app: import('fastify').FastifyInstance, db: Db) {
  app.get('/api/public/credentials/:id', async (req, reply) => {
    const id = (req.params as any).id;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return reply.status(400).send({ error: 'Invalid credential id.' });
    const row = await db.withPublic(async sql => (await sql.query<any>(`SELECT * FROM public_credential($1)`, [id])).rows[0]);
    if (!row) return reply.status(404).send({ error: 'No credential with this id.' });
    const check = verifyCredential({ payload: row.payload, proofValue: row.proof_value, publicKeyPem: row.public_key_pem, status: row.status, validUntil: new Date(row.valid_until).toISOString() });
    return { check, credential: row.payload, issuerKeyId: row.issuer_key_id };
  });
}
