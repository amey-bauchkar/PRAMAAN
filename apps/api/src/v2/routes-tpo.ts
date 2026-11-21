import { randomUUID } from 'crypto';
import { Mailer } from './mailer.js';
import { appendLedger, ledgerEnabled } from './ledger.js';
import { canonicalJson, sha256Hex } from '@pramaan/domain';
import { FailoverLlm } from './llm.js';
import { draftWithModel } from './interview-drafter.js';
import ExcelJS from 'exceljs';
import { AuditChain } from '@pramaan/domain';
import { buildMockReport } from '@pramaan/domain';
import {
  computeKpis, readiness, cohortForecast, extractSkills, demandVsSupply, detectClashes, parseCompanyEmail, allocateRooms,
  accreditationSummary, toCsv, ProofPath, EligibilityEvaluator, FairnessCalculator, READINESS_THRESHOLD,
  candidateRepairs, rankRepairs, shortfallOf, RepairEvaluation,
} from '@pramaan/domain';
import { EligibilityRuleSpecSchema, EligibilityRuleSpec, SessionContext, FairnessDimension } from '@pramaan/contracts';
import { Router, HttpError, OFFICER_ROLES, STAFF_ROLES, requireString, requireUuid, one, membershipId } from './http.js';
import { Sql } from './db.js';
import { audit, recordAgentRun } from './audit.js';
import { awardProof, academicSnapshots, driveContexts, evaluateDrive, displayName, reevaluateStudent } from './services.js';
import { BRANCH_CORE_SKILLS } from './config.js';

const O = OFFICER_ROLES;
const iso = (v: any) => (v ? new Date(v).toISOString() : null);
const DIMENSIONS: FairnessDimension[] = ['gender', 'category', 'branch', 'college_tier'];

/** Department coordinators see only their department; other officer roles see the whole college. */
function deptScope(ctx: SessionContext): { clause: string; params: unknown[] } {
  return ctx.role === 'dept_coordinator' && ctx.departmentId
    ? { clause: 's.department_id = $1', params: [ctx.departmentId] }
    : { clause: 'TRUE', params: [] };
}

async function cohortFacts(sql: Sql, ctx: SessionContext) {
  const scope = deptScope(ctx);
  const students = (await sql.query<any>(`SELECT s.id, d.code AS branch, a.active_backlogs, u.full_name, s.enrollment_no
    FROM students s JOIN departments d ON d.id = s.department_id JOIN users u ON u.id = s.user_id
    LEFT JOIN LATERAL (SELECT * FROM academic_records x WHERE x.student_id = s.id ORDER BY as_of DESC LIMIT 1) a ON TRUE
    WHERE ${scope.clause} ORDER BY s.enrollment_no`, scope.params)).rows;
  const skills = (await sql.query<any>(`SELECT ss.student_id, k.slug, k.canonical_name, ss.state, ss.proof_level, ss.skill_id FROM student_skills ss
    JOIN skills k ON k.id = ss.skill_id JOIN students s ON s.id = ss.student_id WHERE ${scope.clause}`, scope.params)).rows;
  const mocks = (await sql.query<any>(`SELECT DISTINCT ON (m.student_id) m.student_id, m.report, m.completed_at FROM mock_attempts m JOIN students s ON s.id = m.student_id
    WHERE m.status = 'completed' AND ${scope.clause} ORDER BY m.student_id, m.completed_at DESC`, scope.params)).rows;
  const paths = (await sql.query<any>(`SELECT p.student_id, count(i.*)::int AS assigned, count(i.*) FILTER (WHERE i.status = 'passed')::int AS passed
    FROM learning_paths p JOIN learning_path_items i ON i.path_id = p.id JOIN students s ON s.id = p.student_id WHERE p.status = 'active' AND ${scope.clause} GROUP BY p.student_id`, scope.params)).rows;
  return { students, skills, mocks, paths };
}

export function registerTpoRoutes(r: Router, deps: { judgeName: string; mailer: Mailer; llm?: FailoverLlm | null }) {
  // ---------- AD-01 Cohort dashboard & reports ----------
  r.get('/api/v2/tpo/cohort', O, async ({ ctx, sql }) => {
    const { students, skills, mocks } = await cohortFacts(sql, ctx);
    const branches = [...new Set(students.map(s => s.branch))].sort();
    // Heatmap: share of each branch's students with each core skill Verified.
    const coreSlugs = [...new Set(branches.flatMap(b => BRANCH_CORE_SKILLS[b] ?? []))];
    const names = new Map(skills.map(s => [s.slug, s.canonical_name]));
    const heat = coreSlugs.map(slug => ({
      skill: names.get(slug) ?? slug, slug,
      cells: branches.map(b => {
        const pop = students.filter(s => s.branch === b);
        const required = (BRANCH_CORE_SKILLS[b] ?? []).includes(slug);
        const verified = pop.filter(s => skills.some(k => k.student_id === s.id && k.slug === slug && k.state === 'verified')).length;
        return { branch: b, required, verified, total: pop.length, percent: pop.length ? Math.round((verified / pop.length) * 1000) / 10 : 0 };
      }),
    }));

    // KPI inputs
    const opted = students.length;
    const placed = (await sql.query<any>(`SELECT count(DISTINCT so.student_id)::int AS n FROM student_outcomes so WHERE so.outcome_type = 'placed'`)).rows[0].n
      + (await sql.query<any>(`SELECT count(DISTINCT a.student_id)::int AS n FROM applications a WHERE a.stage = 'offer_accepted'
          AND NOT EXISTS (SELECT 1 FROM student_outcomes o WHERE o.student_id = a.student_id AND o.outcome_type = 'placed')`)).rows[0].n;
    let required = 0, verifiedReq = 0;
    for (const s of students) for (const slug of BRANCH_CORE_SKILLS[s.branch] ?? []) {
      required++;
      if (skills.some(k => k.student_id === s.id && k.slug === slug && k.state === 'verified')) verifiedReq++;
    }
    const gapStart = (await sql.query<any>(`SELECT taken_at FROM kpi_snapshots ORDER BY taken_at LIMIT 1`)).rows[0]?.taken_at ?? new Date(Date.now() - 60 * 86_400_000);
    // A gap is closed when a skill gained a passed verification after the baseline snapshot.
    const closed = (await sql.query<any>(`SELECT count(DISTINCT ss.id)::int AS n FROM student_skills ss JOIN verification_sessions vs ON vs.id = ss.last_verification_id
      WHERE ss.state = 'verified' AND vs.outcome = 'passed' AND vs.completed_at > $1`, [gapStart])).rows[0].n;
    const funnel = (await sql.query<any>(`SELECT count(*) FILTER (WHERE stage IN ('shortlisted','interview_scheduled','offered','offer_accepted','offer_declined'))::int AS sl,
      count(*) FILTER (WHERE stage IN ('offered','offer_accepted','offer_declined'))::int AS off FROM applications`)).rows[0];
    const tts = (await sql.query<any>(`SELECT d.id, EXTRACT(EPOCH FROM (min(e.occurred_at) - d.created_at)) / 86400 AS days FROM drives d
      JOIN applications a ON a.drive_id = d.id JOIN application_events e ON e.application_id = a.id AND e.to_stage = 'shortlisted' GROUP BY d.id, d.created_at`)).rows;
    const rec = (await sql.query<any>(`SELECT
        (SELECT count(*)::int FROM audit_events WHERE action = 'EVIDENCE_CARD_VIEWED') AS cards,
        (SELECT count(*)::int FROM recruiter_feedback) AS feedback,
        (SELECT count(*)::int FROM audit_events WHERE action = 'REPROBE_REQUESTED') AS reprobes,
        (SELECT count(DISTINCT recruiter_membership_id)::int FROM recruiter_access_grants WHERE expires_at > now()) AS recruiters`)).rows[0];
    const kpis = computeKpis({
      optedIn: opted, placedStudents: placed, requiredSkillSlots: required, verifiedRequiredSkillSlots: verifiedReq,
      gapsOpenAtSeasonStart: Math.max(required - verifiedReq + closed, 0), gapsClosedSinceSeasonStart: closed,
      shortlisted: funnel.sl, offers: funnel.off, daysToShortlist: tts.map(x => Math.max(0, Math.round(Number(x.days)))),
      recruiterActions: { evidenceCardsOpened: rec.cards, feedbackGiven: rec.feedback, reprobesRequested: rec.reprobes }, activeRecruiters: rec.recruiters,
    });

    // Mock drive report: per-round averages and top weak topics, before vs after the latest intervention.
    const allMocks = (await sql.query<any>(`SELECT m.report, m.completed_at, d.code AS branch FROM mock_attempts m JOIN students s ON s.id = m.student_id
      JOIN departments d ON d.id = s.department_id WHERE m.status = 'completed' AND ${deptScope(ctx).clause}`, deptScope(ctx).params)).rows;
    const intervention = (await sql.query<any>(`SELECT i.title, i.starts_on, i.ends_on, k.slug, k.canonical_name, dep.code AS branch
      FROM interventions i LEFT JOIN skills k ON k.id = i.skill_id LEFT JOIN departments dep ON dep.id = i.department_id ORDER BY i.starts_on DESC LIMIT 1`)).rows[0];
    let beforeAfter = null;
    if (intervention) {
      const pop = allMocks.filter(m => !intervention.branch || m.branch === intervention.branch);
      const topic = intervention.slug;
      const before = pop.filter(m => new Date(m.completed_at) < new Date(intervention.starts_on));
      const after = pop.filter(m => new Date(m.completed_at) > new Date(intervention.ends_on));
      const weakShare = (xs: any[]) => (xs.length ? Math.round((xs.filter(m => (m.report?.weakTopics ?? []).includes(topic)).length / xs.length) * 1000) / 10 : null);
      beforeAfter = { intervention: intervention.title, skill: intervention.canonical_name, branch: intervention.branch,
        before: { attempts: before.length, weakPercent: weakShare(before) }, after: { attempts: after.length, weakPercent: weakShare(after) } };
    }
    const latest = new Map<string, any>();
    for (const m of mocks) latest.set(m.student_id, m.report);
    const roundAvg = (round: string) => {
      const xs = [...latest.values()].map(rp => rp?.rounds?.find((x: any) => x.round === round)?.percent).filter((x: any) => typeof x === 'number');
      return xs.length ? Math.round((xs.reduce((a: number, b: number) => a + b, 0) / xs.length) * 10) / 10 : null;
    };
    const topicCount = new Map<string, number>();
    for (const rp of latest.values()) for (const t of rp?.weakTopics ?? []) topicCount.set(t, (topicCount.get(t) ?? 0) + 1);
    return {
      cohortSize: opted, branches, heatmap: heat, kpis,
      mock: { studentsWithAttempt: latest.size, averages: { aptitude: roundAvg('aptitude'), machine_test: roundAvg('machine_test'), interview: roundAvg('interview') },
        topWeakTopics: [...topicCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([topic, n]) => ({ topic, students: n, percent: Math.round((n / Math.max(latest.size, 1)) * 1000) / 10 })) },
      beforeAfter,
      scope: ctx.role === 'dept_coordinator' ? 'Your department' : 'Whole college',
    };
  });

  r.get('/api/v2/tpo/cohort/export.csv', O, async ({ ctx, sql, reply }) => {
    const { students, skills, mocks } = await cohortFacts(sql, ctx);
    const rows = students.map(s => {
      const mine = skills.filter(k => k.student_id === s.id);
      const rp = mocks.find(m => m.student_id === s.id)?.report;
      return { enrollment_no: s.enrollment_no, name: displayName(s.full_name), branch: s.branch,
        verified_skills: mine.filter(k => k.state === 'verified').length, verified_core_skills: (BRANCH_CORE_SKILLS[s.branch] ?? []).filter(slug => mine.some(k => k.slug === slug && k.state === 'verified')).length,
        latest_mock_percent: rp?.totalPercent ?? '', weak_topics: (rp?.weakTopics ?? []).join(' ') };
    });
    await audit(sql, ctx, 'REPORT_EXPORTED', 'cohort', null, { rows: rows.length });
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="cohort-report.csv"');
    return toCsv(rows);
  }, { raw: true });

  r.get('/api/v2/tpo/interventions', O, async ({ sql }) => {
    const drives = await driveContexts(sql);
    const ids = (await sql.query<{ id: string }>(`SELECT id FROM students`)).rows.map(x => x.id);
    const snaps = [...(await academicSnapshots(sql, ids)).values()];
    return { ranking: ProofPath.rankInterventions(snaps, drives).slice(0, 8), drives: drives.length, students: snaps.length,
      method: 'For each skill, we check the published rules again as if every student who is held back by it had reached the required level.' };
  });

  // ---------- AD-02 Industry Skill-Gap Profiler ----------
  const taxonomy = async (sql: Sql) => {
    const rows = (await sql.query<any>(`SELECT k.id, k.slug, k.canonical_name, coalesce(array_agg(a.alias) FILTER (WHERE a.alias IS NOT NULL), '{}') AS aliases
      FROM skills k LEFT JOIN skill_aliases a ON a.skill_id = k.id WHERE k.slug IS NOT NULL GROUP BY k.id`)).rows;
    return rows.map(x => ({ skillId: x.id, slug: x.slug, name: x.canonical_name, aliases: x.aliases }));
  };
  const demandReport = async (sql: Sql, ctx: SessionContext) => {
    const tax = await taxonomy(sql);
    const jds = (await sql.query<any>(`SELECT id, title, body, posted_on FROM jd_documents ORDER BY posted_on`)).rows;
    const extracted = jds.map(j => ({ id: j.id, postedOn: new Date(j.posted_on).toISOString().slice(0, 10), skillIds: extractSkills(`${j.title}. ${j.body}`, tax).map(m => m.skillId) }));
    const scope = deptScope(ctx);
    const cohort = (await sql.query<any>(`SELECT s.id, coalesce(array_agg(ss.skill_id) FILTER (WHERE ss.state = 'verified'), '{}') AS v FROM students s
      LEFT JOIN student_skills ss ON ss.student_id = s.id WHERE ${scope.clause} GROUP BY s.id`, scope.params)).rows;
    return { report: demandVsSupply(extracted, cohort.map(c => ({ studentId: c.id, verifiedSkillIds: c.v })), new Map(tax.map(t => [t.skillId, t.name]))), jds, extracted, tax };
  };
  r.get('/api/v2/tpo/demand', O, async ({ ctx, sql }) => {
    const { report } = await demandReport(sql, ctx);
    const alerts = (await sql.query<any>(`SELECT p.id, p.title, p.status, p.created_at FROM proposals p WHERE p.kind = 'gap_alert' ORDER BY p.created_at DESC LIMIT 10`)).rows;
    return { ...report, rows: report.rows.slice(0, 25), proposals: alerts.map(a => ({ ...a, createdAt: iso(a.created_at) })) };
  });
  r.post('/api/v2/tpo/demand/scan', O, async ({ ctx, sql }) => {
    const { report, extracted } = await demandReport(sql, ctx);
    for (const e of extracted) {
      await sql.query(`DELETE FROM jd_skill_mentions WHERE jd_id = $1 AND method = 'alias_match'`, [e.id]);
      for (const sid of e.skillIds) await sql.query(`INSERT INTO jd_skill_mentions (jd_id, skill_id, method) VALUES ($1,$2,'alias_match') ON CONFLICT DO NOTHING`, [e.id, sid]);
    }
    const run = await recordAgentRun(sql, ctx, 'Demand Scout',
      [{ tool: 'extract_skills', input: { jds: extracted.length }, output: { mentions: extracted.reduce((s, x) => s + x.skillIds.length, 0) } },
       { tool: 'compare_with_cohort', input: { cohortSize: report.cohortSize }, output: { alerts: report.alerts.length } }],
      report.alerts.map(a => ({ kind: 'gap_alert', title: `Skill gap: ${a.name}`, rationale: a.message,
        payload: { skillId: a.skillId, skill: a.name, demandPercent: a.demandPercent, supplyPercent: a.supplyPercent, sampleSize: report.sampleSize, dateFrom: report.dateFrom, dateTo: report.dateTo } })));
    return { scanned: extracted.length, alerts: report.alerts.length, proposals: run.proposalIds.length };
  });
  r.post('/api/v2/tpo/demand/jds', O, async ({ ctx, sql, body }) => {
    const id = randomUUID();
    await sql.query(`INSERT INTO jd_documents (id, org_id, source, title, body, posted_on) VALUES ($1,$2,'upload',$3,$4,COALESCE($5::date, CURRENT_DATE))`,
      [id, ctx.orgId, requireString(body.title, 'title', 3, 200), requireString(body.body, 'body', 20, 20000), typeof body.postedOn === 'string' ? body.postedOn : null]);
    await audit(sql, ctx, 'JOB_DESCRIPTION_ADDED', 'jd_document', id, {});
    return { id };
  });

  // ---------- AD-03 Readiness Radar ----------
  const readinessAll = async (sql: Sql, ctx: SessionContext) => {
    const { students, skills, mocks, paths } = await cohortFacts(sql, ctx);
    return students.map(s => {
      const core = BRANCH_CORE_SKILLS[s.branch] ?? [];
      const p = paths.find(x => x.student_id === s.id);
      const res = readiness({
        studentId: s.id, coreSkillsRequired: core.length, coreSkillsVerified: core.filter(slug => skills.some(k => k.student_id === s.id && k.slug === slug && k.state === 'verified')).length,
        latestMockPercent: mocks.find(m => m.student_id === s.id)?.report?.totalPercent ?? null,
        learningTasksAssigned: p?.assigned ?? 0, learningTasksPassed: p?.passed ?? 0, activeBacklogs: s.active_backlogs ?? 0,
      });
      return { ...res, name: displayName(s.full_name), enrollmentNo: s.enrollment_no, branch: s.branch };
    });
  };
  r.get('/api/v2/tpo/readiness', O, async ({ ctx, sql }) => {
    const all = await readinessAll(sql, ctx);
    const assigned = new Set((await sql.query<any>(`SELECT student_id FROM mentor_assignments`)).rows.map(x => x.student_id));
    const byBranch = [...new Set(all.map(x => x.branch))].sort().map(b => ({ branch: b, ...cohortForecast(all.filter(x => x.branch === b)) }));
    return {
      forecast: cohortForecast(all), byBranch, threshold: READINESS_THRESHOLD,
      needsSupport: all.filter(x => x.score < READINESS_THRESHOLD).sort((a, b) => a.score - b.score).slice(0, 60).map(x => ({ ...x, mentorAssigned: assigned.has(x.studentId) })),
      note: 'Officer-only view. Students never see an "at-risk" label; support is offered as mentoring and learning tasks.',
    };
  });
  r.post('/api/v2/tpo/readiness/propose-support', O, async ({ ctx, sql }) => {
    const all = (await readinessAll(sql, ctx)).filter(x => x.score < READINESS_THRESHOLD).sort((a, b) => a.score - b.score);
    const assigned = new Set((await sql.query<any>(`SELECT student_id FROM mentor_assignments`)).rows.map(x => x.student_id));
    const pending = new Set((await sql.query<any>(`SELECT target_student_id FROM proposals WHERE kind = 'support_candidate' AND status = 'pending'`)).rows.map(x => x.target_student_id));
    const mentors = (await sql.query<any>(`SELECT m.id, m.department_id, u.full_name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.role = 'mentor' AND m.status = 'active'`)).rows;
    const depts = new Map((await sql.query<any>(`SELECT s.id, s.department_id FROM students s`)).rows.map(x => [x.id, x.department_id]));
    const picks = all.filter(x => !assigned.has(x.studentId) && !pending.has(x.studentId)).slice(0, 15);
    const run = await recordAgentRun(sql, ctx, 'Readiness Analyst', [{ tool: 'score_readiness', input: { students: all.length }, output: { belowThreshold: all.length, proposed: picks.length } }],
      picks.map(x => {
        const mentor = mentors.find(m => m.department_id === depts.get(x.studentId)) ?? mentors[0];
        const weakest = [...x.factors].sort((a, b) => a.value - b.value)[0];
        return { kind: 'support_candidate', targetStudentId: x.studentId, title: `Offer mentoring: ${x.name} (${x.branch})`,
          rationale: `Readiness ${x.score}/100. Weakest factor: ${weakest.label.toLowerCase()} — ${weakest.explanation}`,
          payload: { studentId: x.studentId, mentorMembershipId: mentor?.id ?? null, mentorName: mentor ? displayName(mentor.full_name) : null, score: x.score, factors: x.factors } };
      }));
    return { proposed: run.proposalIds.length };
  });

  // ---------- AD-04 Mock drive setup ----------
  r.get('/api/v2/tpo/mock-setup', O, async ({ sql }) => {
    const apt = (await sql.query<any>(`SELECT topic, subtopic, count(*)::int AS n FROM aptitude_questions WHERE status = 'active' GROUP BY topic, subtopic ORDER BY topic, subtopic`)).rows;
    const probs = (await sql.query<any>(`SELECT id, slug, title, language, marks, topics, jsonb_array_length(hidden_tests) AS hidden, difficulty FROM coding_problems ORDER BY language, title`)).rows;
    const iq = (await sql.query<any>(`SELECT id, role_title, topic, question, key_points, status, drafted_by FROM interview_questions ORDER BY role_title, status, topic`)).rows;
    const attempts = (await sql.query<any>(`SELECT count(*)::int AS n, count(*) FILTER (WHERE status = 'completed')::int AS done FROM mock_attempts`)).rows[0];
    return { aptitude: apt, problems: probs, interviewQuestions: iq, attempts, judge: deps.judgeName };
  });
  r.post('/api/v2/tpo/mock-setup/aptitude', O, async ({ ctx, sql, body }) => {
    if (!['quantitative', 'logical', 'verbal'].includes(body.topic)) throw new HttpError(400, 'topic must be quantitative, logical or verbal.');
    const options = Array.isArray(body.options) ? body.options.map((x: unknown) => String(x).slice(0, 200)).filter(Boolean) : [];
    if (options.length < 2 || options.length > 5) throw new HttpError(400, 'Give 2 to 5 options.');
    if (!Number.isInteger(body.answerIndex) || body.answerIndex < 0 || body.answerIndex >= options.length) throw new HttpError(400, 'answerIndex must point at one of the options.');
    const id = randomUUID();
    await sql.query(`INSERT INTO aptitude_questions (id, org_id, topic, subtopic, difficulty, stem, options, answer_index, explanation) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, ctx.orgId, body.topic, requireString(body.subtopic, 'subtopic', 2, 60), Math.min(3, Math.max(1, Number(body.difficulty) || 2)), requireString(body.stem, 'stem', 5, 1000), JSON.stringify(options), body.answerIndex, requireString(body.explanation, 'explanation', 3, 1000)]);
    await audit(sql, ctx, 'QUESTION_ADDED', 'aptitude_question', id, { topic: body.topic });
    return { id };
  });
  r.post('/api/v2/tpo/mock-setup/interview-questions/draft', O, async ({ ctx, sql, body }) => {
    const role = requireString(body.role, 'role', 3, 120);
    const topics: string[] = (await sql.query<any>(`SELECT DISTINCT k.slug FROM job_roles jr JOIN job_role_skills jrs ON jrs.role_id = jr.id JOIN skills k ON k.id = jrs.skill_id WHERE jr.title = $1`, [role])).rows.map(x => x.slug);
    const fallback = ['problem-solving', 'communication'];
    const wanted = (topics.length ? topics : fallback).slice(0, 3);
    const modelDrafts = deps.llm ? await draftWithModel(deps.llm, role, wanted) : null;
    const drafts = modelDrafts ?? wanted.map(t => ({
      topic: t, question: `Describe a project where you used ${t.replace(/-/g, ' ')}. What problem did it solve, what trade-off did you make, and how did you check it worked?`,
      keyPoints: [
        { point: 'States the problem and their own role', keywords: ['problem', 'i built', 'i wrote', 'my role', 'i was responsible'] },
        { point: 'Names a concrete trade-off or alternative', keywords: ['trade-off', 'tradeoff', 'instead of', 'alternative', 'chose'] },
        { point: 'Explains how it was tested or measured', keywords: ['test', 'measured', 'verified', 'checked', 'result'] },
      ],
    }));
    const ids: string[] = [];
    for (const d of drafts) {
      const id = randomUUID();
      await sql.query(`INSERT INTO interview_questions (id, org_id, role_title, topic, question, key_points, status, drafted_by) VALUES ($1,$2,$3,$4,$5,$6,'draft','agent')`,
        [id, ctx.orgId, role, d.topic, d.question, JSON.stringify(d.keyPoints)]);
      ids.push(id);
    }
    const drafter = modelDrafts && deps.llm ? deps.llm.lastUsed ?? 'llm' : 'deterministic-rules-v1';
    await recordAgentRun(sql, ctx, 'Interview Drafter', [{ tool: 'draft_questions', input: { role, topics }, output: { drafts: ids.length, drafter } }],
      [{ kind: 'interview_questions', title: `Review ${ids.length} drafted interview questions for ${role}`, rationale: 'Drafted from the skills this role requires. Approve, edit or reject each before students see it.', payload: { questionIds: ids, role } }]);
    return { drafted: ids.length };
  });
  r.post('/api/v2/tpo/mock-setup/interview-questions/:id/status', O, async ({ ctx, sql, params, body }) => {
    if (!['approved', 'retired'].includes(body.status)) throw new HttpError(400, 'status must be approved or retired.');
    const mid = await membershipId(sql, ctx);
    const q = typeof body.question === 'string' && body.question.trim().length > 10 ? body.question.trim() : null;
    await sql.query(`UPDATE interview_questions SET status = $2, approved_by = CASE WHEN $2 = 'approved' THEN $3::uuid ELSE approved_by END, question = COALESCE($4, question) WHERE id = $1`,
      [requireUuid(params.id, 'id'), body.status, mid, q]);
    await audit(sql, ctx, 'INTERVIEW_QUESTION_REVIEWED', 'interview_question', params.id, { status: body.status, edited: !!q });
    return { ok: true };
  });

  // ---------- AD-05 Bulk mailing ----------
  r.get('/api/v2/tpo/outreach', O, async ({ sql }) => {
    const companies = (await sql.query<any>(`SELECT id, name, industry, contact_email FROM companies ORDER BY name`)).rows;
    const templates = (await sql.query<any>(`SELECT id, name, subject, body, created_at FROM outreach_templates ORDER BY created_at DESC`)).rows;
    const messages = (await sql.query<any>(`SELECT m.id, c.name AS company, m.to_email, m.subject, m.status, m.transport, m.error, m.sent_at, m.replied_at, m.reply_excerpt
      FROM outreach_messages m JOIN companies c ON c.id = m.company_id ORDER BY m.created_at DESC LIMIT 100`)).rows;
    return { companies: companies.map(c => ({ ...c, name: c.name.replace('[SYNTHETIC] ', '') })), templates, messages: messages.map(m => ({ ...m, company: m.company.replace('[SYNTHETIC] ', ''), sentAt: iso(m.sent_at), repliedAt: iso(m.replied_at) })),
      transport: deps.mailer.transport, ratePerMinute: deps.mailer.perMinute };
  });
  r.post('/api/v2/tpo/outreach/templates', O, async ({ ctx, sql, body }) => {
    const id = randomUUID();
    await sql.query(`INSERT INTO outreach_templates (id, org_id, name, subject, body, created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, ctx.orgId, requireString(body.name, 'name', 3, 120), requireString(body.subject, 'subject', 3, 300), requireString(body.body, 'body', 10, 10000), await membershipId(sql, ctx)]);
    return { id };
  });
  /** Sends up to one minute's worth of queued messages. A message becomes 'sent' only after the mail server accepts it. */
  const dispatch = async (sql: any, ctx: any, templateId: string | null) => {
    const mailer = deps.mailer;
    if (mailer.transport === 'outbox') return { sent: 0, failed: 0, remaining: 0 };
    const queued = (await sql.query(`SELECT id, to_email, subject, body FROM outreach_messages WHERE status = 'queued' AND ($1::uuid IS NULL OR template_id = $1) ORDER BY created_at LIMIT $2`, [templateId, mailer.perMinute])).rows;
    let sent = 0, failed = 0;
    for (const m of queued) {
      const res = await mailer.send({ to: m.to_email, subject: m.subject, text: m.body });
      if (res.ok) { sent++; await sql.query(`UPDATE outreach_messages SET status = 'sent', sent_at = now(), provider_message_id = $2, attempts = attempts + 1, error = NULL WHERE id = $1`, [m.id, res.messageId]); }
      else { failed++; await sql.query(`UPDATE outreach_messages SET status = 'failed', attempts = attempts + 1, error = $2 WHERE id = $1`, [m.id, res.error]); }
    }
    const remaining = Number((await sql.query(`SELECT count(*)::int AS n FROM outreach_messages WHERE status = 'queued' AND ($1::uuid IS NULL OR template_id = $1)`, [templateId])).rows[0].n);
    await audit(sql, ctx, 'OUTREACH_DISPATCHED', 'outreach_template', templateId ?? ctx.orgId, { sent, failed, remaining });
    return { sent, failed, remaining };
  };
  r.post('/api/v2/tpo/outreach/send', O, async ({ ctx, sql, body }) => {
    const t = await one<any>(sql, `SELECT * FROM outreach_templates WHERE id = $1`, [requireUuid(body.templateId, 'templateId')], 'Template not found.');
    const college = (await sql.query<any>(`SELECT name FROM organizations WHERE id = $1`, [ctx.orgId])).rows[0].name.replace('[SYNTHETIC] ', '');
    const companies = (await sql.query<any>(`SELECT id, name, contact_email FROM companies`)).rows;
    const transport = deps.mailer.transport;
    const mid = await membershipId(sql, ctx);
    for (const c of companies) {
      const fill = (s: string) => s.replace(/{{college}}/g, college).replace(/{{company}}/g, c.name.replace('[SYNTHETIC] ', ''));
      await sql.query(`INSERT INTO outreach_messages (org_id, template_id, company_id, to_email, subject, body, transport, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'queued',$8)`,
        [ctx.orgId, t.id, c.id, c.contact_email, fill(t.subject), fill(t.body), transport, mid]);
    }
    await audit(sql, ctx, 'OUTREACH_CREATED', 'outreach_template', t.id, { recipients: companies.length, transport });
    const d = await dispatch(sql, ctx, t.id);
    const note = transport === 'outbox'
      ? 'No mail server is set up, so these messages are saved in the outbox and have NOT been sent.'
      : `Sent ${d.sent}, failed ${d.failed}${d.remaining ? `, ${d.remaining} waiting (the limit is ${deps.mailer.perMinute} per minute)` : ''}.`;
    return { recipients: companies.length, transport, ...d, note };
  });
  r.post('/api/v2/tpo/outreach/dispatch', O, async ({ ctx, sql }) => {
    const d = await dispatch(sql, ctx, null);
    return { transport: deps.mailer.transport, ...d, note: deps.mailer.transport === 'outbox' ? 'No mail server is set up, so nothing was sent.' : `Sent ${d.sent}, failed ${d.failed}, ${d.remaining} still waiting.` };
  });
  r.post('/api/v2/tpo/outreach/messages/:id/retry', O, async ({ ctx, sql, params }) => {
    await sql.query(`UPDATE outreach_messages SET status = 'queued' WHERE id = $1 AND status = 'failed'`, [requireUuid(params.id, 'id')]);
    await audit(sql, ctx, 'OUTREACH_RETRY', 'outreach_message', params.id, {});
    return { ok: true };
  });
  r.post('/api/v2/tpo/outreach/messages/:id/reply', O, async ({ ctx, sql, params, body }) => {
    await sql.query(`UPDATE outreach_messages SET status = 'replied', replied_at = now(), reply_excerpt = $2 WHERE id = $1`, [requireUuid(params.id, 'id'), requireString(body.excerpt, 'excerpt', 3, 2000)]);
    await audit(sql, ctx, 'OUTREACH_REPLY_RECORDED', 'outreach_message', params.id, {});
    return { ok: true };
  });

  // ---------- AD-06 Drives & calendar ----------
  r.get('/api/v2/tpo/drives', STAFF_ROLES, async ({ sql }) => {
    const drives = (await sql.query<any>(`SELECT d.id, d.title, d.status, d.starts_at, d.ends_at, d.ctc_inr, d.decisions_published_at, c.name AS company, v.version_no,
        (SELECT count(*)::int FROM eligibility_decisions e WHERE e.drive_id = d.id AND e.rule_version_id = d.rule_version_id AND e.result = 'eligible') AS eligible,
        (SELECT count(*)::int FROM applications a WHERE a.drive_id = d.id) AS applications
      FROM drives d JOIN companies c ON c.id = d.company_id LEFT JOIN eligibility_rule_versions v ON v.id = d.rule_version_id ORDER BY d.starts_at`)).rows;
    const rounds = (await sql.query<any>(`SELECT r.id, r.drive_id, r.kind, r.title, r.starts_at, r.ends_at, r.status, rm.name AS room, r.room_id FROM drive_rounds r LEFT JOIN rooms rm ON rm.id = r.room_id WHERE r.status <> 'cancelled' ORDER BY r.starts_at`)).rows;
    const rooms = (await sql.query<any>(`SELECT id, name, capacity FROM rooms ORDER BY name`)).rows;
    const cand = (await sql.query<any>(`SELECT drive_id, student_id FROM eligibility_decisions WHERE result = 'eligible' UNION SELECT drive_id, student_id FROM applications`)).rows;
    const byDrive = new Map<string, Set<string>>();
    for (const c of cand) { if (!byDrive.has(c.drive_id)) byDrive.set(c.drive_id, new Set()); byDrive.get(c.drive_id)!.add(c.student_id); }
    const title = (id: string) => drives.find(d => d.id === id)?.title.replace('[SYNTHETIC] ', '') ?? '';
    const events = rounds.filter(x => x.status === 'scheduled').map(x => ({ id: x.id, driveId: x.drive_id, title: `${title(x.drive_id)}: ${x.title}`, startsAt: iso(x.starts_at)!, endsAt: iso(x.ends_at)!, roomId: x.room_id }));
    const companyRows = (await sql.query<any>(`SELECT id, name FROM companies ORDER BY name`)).rows;
    const slotRows = (await sql.query<any>(`SELECT s.id, s.round_id, s.panel, s.starts_at, s.ends_at, u.full_name FROM interview_slots s JOIN students st ON st.id = s.student_id JOIN users u ON u.id = st.user_id WHERE s.status = 'scheduled' ORDER BY s.starts_at`)).rows;
    const inbound = (await sql.query<any>(`SELECT i.id, i.from_email, i.subject, i.body, i.received_at, i.proposal_id, c.name AS company FROM inbound_messages i LEFT JOIN companies c ON c.id = i.company_id ORDER BY i.received_at DESC`)).rows;
    return {
      drives: drives.map(d => ({ id: d.id, title: d.title.replace('[SYNTHETIC] ', ''), company: d.company.replace('[SYNTHETIC] ', ''), status: d.status, startsAt: iso(d.starts_at), ctc: d.ctc_inr ? Number(d.ctc_inr) : null,
        ruleVersion: d.version_no, published: !!d.decisions_published_at, eligible: d.eligible, applications: d.applications })),
      rounds: rounds.map(x => ({ id: x.id, driveId: x.drive_id, drive: title(x.drive_id), kind: x.kind, title: x.title, startsAt: iso(x.starts_at), endsAt: iso(x.ends_at), room: x.room, status: x.status })),
      clashes: detectClashes(events, byDrive), rooms, companies: companyRows.map(c => ({ id: c.id, name: c.name.replace('[SYNTHETIC] ', '') })),
      slots: slotRows.map(s => ({ id: s.id, roundId: s.round_id, student: displayName(s.full_name), panel: s.panel, startsAt: iso(s.starts_at), endsAt: iso(s.ends_at) })),
      inbound: inbound.map(m => ({ ...m, company: m.company?.replace('[SYNTHETIC] ', '') ?? null, receivedAt: iso(m.received_at) })),
    };
  });
  r.post('/api/v2/tpo/drives/:id/rounds', O, async ({ ctx, sql, params, body }) => {
    const id = randomUUID();
    if (!body.startsAt || !body.endsAt || Date.parse(body.endsAt) <= Date.parse(body.startsAt)) throw new HttpError(400, 'Give a start and an end time after it.');
    await sql.query(`INSERT INTO drive_rounds (id, drive_id, kind, title, starts_at, ends_at, room_id, status) VALUES ($1,$2,$3,$4,$5,$6,$7,'scheduled')`,
      [id, requireUuid(params.id, 'drive id'), body.kind ?? 'interview', requireString(body.title, 'title', 2, 200), body.startsAt, body.endsAt, body.roomId ?? null]);
    await audit(sql, ctx, 'ROUND_SCHEDULED', 'drive_round', id, { driveId: params.id });
    return { id };
  });
  r.post('/api/v2/tpo/companies', O, async ({ ctx, sql, body }) => {
    const id = randomUUID();
    const email = requireString(body.contactEmail, 'contactEmail', 5, 255);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
    await sql.query(`INSERT INTO companies (id, org_id, name, industry, contact_email) VALUES ($1,$2,$3,$4,$5)`,
      [id, ctx.orgId, requireString(body.name, 'name', 2, 255), requireString(body.industry, 'industry', 2, 100), email]);
    await audit(sql, ctx, 'COMPANY_ADDED', 'company', id, {});
    return { id };
  });
  /** Creates a draft drive with an empty rule set. Rules are written and published from the Rules page. */
  r.post('/api/v2/tpo/drives', O, async ({ ctx, sql, body }) => {
    const company = await one<any>(sql, `SELECT id, name FROM companies WHERE id = $1`, [requireUuid(body.companyId, 'companyId')], 'Company not found.');
    if (!body.startsAt || !body.endsAt || Date.parse(body.endsAt) <= Date.parse(body.startsAt)) throw new HttpError(400, 'Give a start and an end time after it.');
    const title = requireString(body.title, 'title', 3, 255);
    const ctc = body.ctcInr === undefined || body.ctcInr === '' || body.ctcInr === null ? null : Number(body.ctcInr);
    if (ctc !== null && !(ctc > 0)) throw new HttpError(400, 'CTC must be a positive number.');
    const ruleSetId = randomUUID(), driveId = randomUUID();
    await sql.query(`INSERT INTO eligibility_rule_sets (id, org_id, title) VALUES ($1,$2,$3)`, [ruleSetId, ctx.orgId, title]);
    await sql.query(`INSERT INTO drives (id, org_id, company_id, title, venue_resource, starts_at, ends_at, status, rule_set_id, ctc_inr) VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9)`,
      [driveId, ctx.orgId, company.id, title, typeof body.venue === 'string' && body.venue.trim() ? body.venue.trim().slice(0, 100) : 'To be decided', body.startsAt, body.endsAt, ruleSetId, ctc]);
    await audit(sql, ctx, 'DRIVE_CREATED', 'drive', driveId, { company: company.name });
    return { id: driveId, message: 'Drive created as a draft. Set its eligibility rules next.' };
  });
  r.post('/api/v2/tpo/drives/:id/status', O, async ({ ctx, sql, params, body }) => {
    if (!['draft', 'scheduled', 'cancelled'].includes(body.status)) throw new HttpError(400, 'Status must be draft, scheduled or cancelled.');
    await sql.query(`UPDATE drives SET status = $2 WHERE id = $1`, [requireUuid(params.id, 'drive id'), body.status]);
    await audit(sql, ctx, 'DRIVE_STATUS_CHANGED', 'drive', params.id, { status: body.status });
    return { ok: true };
  });
  /** Gives each chosen applicant a consecutive interview slot on one panel. The database refuses any overlap for a panel or a student. */
  r.post('/api/v2/tpo/rounds/:id/slots', O, async ({ ctx, sql, params, body }) => {
    const round = await one<any>(sql, `SELECT id, starts_at, ends_at FROM drive_rounds WHERE id = $1`, [requireUuid(params.id, 'round id')], 'Round not found.');
    const ids: string[] = Array.isArray(body.applicationIds) ? body.applicationIds.map((x: unknown) => requireUuid(x, 'applicationId')) : [];
    if (ids.length === 0 || ids.length > 200) throw new HttpError(400, 'Choose between 1 and 200 applicants.');
    const panel = requireString(body.panel, 'panel', 1, 100);
    const minutes = Math.min(120, Math.max(5, Number(body.slotMinutes ?? 30) || 30));
    const apps = (await sql.query<any>(`SELECT id, student_id FROM applications WHERE id = ANY($1::uuid[])`, [ids])).rows;
    if (apps.length !== ids.length) throw new HttpError(404, 'One of the applicants was not found.');
    let at = new Date(round.starts_at).getTime();
    const end = new Date(round.ends_at).getTime();
    if (at + ids.length * minutes * 60_000 > end) throw new HttpError(400, `These ${ids.length} slots of ${minutes} minutes do not fit inside the round. Shorten the slots or choose fewer applicants.`);
    for (const a of apps) {
      await sql.query(`INSERT INTO interview_slots (round_id, student_id, panel, starts_at, ends_at) VALUES ($1,$2,$3,$4,$5)`,
        [round.id, a.student_id, panel, new Date(at).toISOString(), new Date(at + minutes * 60_000).toISOString()]);
      await sql.query(`UPDATE applications SET stage = 'interview_scheduled' WHERE id = $1 AND stage IN ('applied','assessment','shortlisted')`, [a.id]);
      at += minutes * 60_000;
    }
    await audit(sql, ctx, 'INTERVIEW_SLOTS_CREATED', 'drive_round', round.id, { panel, count: apps.length, minutes });
    return { created: apps.length, message: `${apps.length} interview slot(s) booked on ${panel}.` };
  });
  r.post('/api/v2/tpo/slots/:id/cancel', O, async ({ ctx, sql, params }) => {
    await sql.query(`UPDATE interview_slots SET status = 'cancelled' WHERE id = $1`, [requireUuid(params.id, 'slot id')]);
    await audit(sql, ctx, 'INTERVIEW_SLOT_CANCELLED', 'interview_slot', params.id, {});
    return { ok: true };
  });
  // ---------- Human review of interview scores (ST-05 R3, BR-15) ----------
  r.get('/api/v2/tpo/mock-reviews', [...O, 'mentor'], async ({ sql }) => {
    const rows = (await sql.query<any>(`SELECT q.id, q.attempt_id, q.status, q.reason, q.decision_note, q.previous_score, q.revised_score, q.created_at, u.full_name, s.enrollment_no, a.role_title,
        (SELECT details FROM mock_round_results x WHERE x.attempt_id = a.id AND x.round = 'interview') AS details
      FROM mock_review_requests q JOIN mock_attempts a ON a.id = q.attempt_id JOIN students s ON s.id = q.student_id JOIN users u ON u.id = s.user_id ORDER BY (q.status = 'pending') DESC, q.created_at DESC LIMIT 50`)).rows;
    return rows.map(x => ({ id: x.id, attemptId: x.attempt_id, status: x.status, reason: x.reason, note: x.decision_note, previousScore: x.previous_score === null ? null : Number(x.previous_score), revisedScore: x.revised_score === null ? null : Number(x.revised_score),
      student: displayName(x.full_name), enrollmentNo: x.enrollment_no, role: x.role_title, createdAt: iso(x.created_at), scorer: x.details?.scorer ?? 'rules',
      answers: (x.details?.answers ?? []).map((a: any) => ({ questionId: a.questionId, question: a.question, score: a.score, covered: a.covered, missed: a.missed })) }));
  });
  /** A person sets the score for each question (0 to 10) and writes a note. The interview score and the report are updated. */
  r.post('/api/v2/tpo/mock-reviews/:id/decide', [...O, 'mentor'], async ({ ctx, sql, params, body }) => {
    const q = await one<any>(sql, `SELECT * FROM mock_review_requests WHERE id = $1`, [requireUuid(params.id, 'review id')], 'Review not found.');
    if (q.status !== 'pending') throw new HttpError(409, 'This review was already decided.');
    const note = requireString(body.note, 'note', 5, 1000);
    const res = (await sql.query<any>(`SELECT details FROM mock_round_results WHERE attempt_id = $1 AND round = 'interview'`, [q.attempt_id])).rows[0];
    const answers: any[] = res.details.answers;
    const scores = body.scores && typeof body.scores === 'object' ? body.scores : null;
    let status: 'kept' | 'revised' = 'kept', total = Number(q.previous_score);
    if (scores) {
      const revised = answers.map(a => {
        const v = scores[a.questionId];
        if (v === undefined) return a;
        const n = Number(v);
        if (!(n >= 0 && n <= 10)) throw new HttpError(400, 'Each score must be between 0 and 10.');
        return { ...a, score: Math.round(n * 10) / 10, reviewedBy: 'person' };
      });
      total = Math.round(revised.reduce((s, x) => s + x.score, 0) * 10) / 10;
      if (total !== Number(q.previous_score)) {
        status = 'revised';
        await sql.query(`UPDATE mock_round_results SET score = $2, details = $3 WHERE attempt_id = $1 AND round = 'interview'`,
          [q.attempt_id, total, JSON.stringify({ ...res.details, answers: revised, reviewed: { note, from: Number(q.previous_score), to: total } })]);
        const rounds = (await sql.query<any>(`SELECT round, details FROM mock_round_results WHERE attempt_id = $1`, [q.attempt_id])).rows;
        if (rounds.length === 3) {
          const get = (x: string) => rounds.find((r0: any) => r0.round === x).details;
          const report = buildMockReport({ aptitude: get('aptitude'), machine: get('machine_test').problems, interview: get('interview').answers, machineSkillSlugs: [] });
          await sql.query(`UPDATE mock_attempts SET report = $2 WHERE id = $1`, [q.attempt_id, JSON.stringify(report)]);
        }
      }
    }
    await sql.query(`UPDATE mock_review_requests SET status = $2, revised_score = $3, decision_note = $4, decided_by = $5, decided_at = now() WHERE id = $1`, [q.id, status, total, note, await membershipId(sql, ctx)]);
    await audit(sql, ctx, 'MOCK_REVIEW_DECIDED', 'mock_review_request', q.id, { status, from: Number(q.previous_score), to: total });
    return { status, score: total };
  });
  r.post('/api/v2/tpo/inbound', O, async ({ ctx, sql, body }) => {
    const id = randomUUID();
    await sql.query(`INSERT INTO inbound_messages (id, org_id, company_id, from_email, subject, body) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, ctx.orgId, body.companyId ?? null, requireString(body.fromEmail, 'fromEmail', 3, 255), requireString(body.subject, 'subject', 1, 300), requireString(body.body, 'body', 10, 10000)]);
    await audit(sql, ctx, 'COMPANY_EMAIL_RECORDED', 'inbound_message', null, {});
    return { id };
  });
  r.post('/api/v2/tpo/inbound/:id/propose', O, async ({ ctx, sql, params }) => {
    const m = await one<any>(sql, `SELECT i.*, c.name AS company FROM inbound_messages i LEFT JOIN companies c ON c.id = i.company_id WHERE i.id = $1`, [requireUuid(params.id, 'id')], 'Message not found.');
    const parsed = parseCompanyEmail(m.body);
    const drive = (await sql.query<any>(`SELECT d.id, d.title FROM drives d WHERE d.company_id = $1 AND d.status IN ('scheduled', 'draft') ORDER BY d.starts_at LIMIT 1`, [m.company_id])).rows[0];
    const head = drive ? (await sql.query<any>(`SELECT count(*)::int AS n FROM eligibility_decisions WHERE drive_id = $1 AND result = 'eligible'`, [drive.id])).rows[0].n || 60 : 60;
    const rooms = (await sql.query<any>(`SELECT id, name, capacity FROM rooms`)).rows;
    const bookings = (await sql.query<any>(`SELECT room_id, starts_at, ends_at FROM drive_rounds WHERE status = 'scheduled' AND room_id IS NOT NULL`)).rows
      .map(b => ({ roomId: b.room_id, startsAt: iso(b.starts_at)!, endsAt: iso(b.ends_at)! }));
    const alloc = allocateRooms(parsed.windows, rooms, bookings, head);
    const run = await recordAgentRun(sql, ctx, 'Drive Coordinator',
      [{ tool: 'parse_company_email', input: { messageId: m.id }, output: { date: parsed.date, windows: parsed.windows.length, unparsed: parsed.unparsed.length } },
       { tool: 'allocate_rooms', input: { headCount: head, rooms: rooms.length }, output: { allocated: alloc.filter(a => a.roomId).length } }],
      [{ kind: 'slot_allocation', title: `Schedule ${m.company?.replace('[SYNTHETIC] ', '') ?? m.from_email} on ${parsed.date ?? '(date unclear)'}`,
        rationale: `Parsed from the company's email. ${alloc.length} round(s); ${alloc.filter(a => !a.roomId).length} without a free room. ${parsed.unparsed.join(' ')}`.trim(),
        payload: { driveId: drive?.id ?? null, driveTitle: drive?.title?.replace('[SYNTHETIC] ', '') ?? null, headCount: head, allocations: alloc, unparsed: parsed.unparsed, messageId: m.id } }]);
    await sql.query(`UPDATE inbound_messages SET parsed = $2, proposal_id = $3 WHERE id = $1`, [m.id, JSON.stringify(parsed), run.proposalIds[0]]);
    return { proposalId: run.proposalIds[0], parsed, allocations: alloc };
  });

  // ---------- AD-07 Eligibility rules, what-if, publish, appeals ----------
  r.get('/api/v2/tpo/drives/:id/rules', STAFF_ROLES, async ({ sql, params }) => {
    const d = await one<any>(sql, `SELECT d.*, c.name AS company FROM drives d JOIN companies c ON c.id = d.company_id WHERE d.id = $1`, [requireUuid(params.id, 'drive id')], 'Drive not found.');
    const versions = (await sql.query<any>(`SELECT id, version_no, rules, rationale, published_at FROM eligibility_rule_versions WHERE rule_set_id = $1 ORDER BY version_no DESC`, [d.rule_set_id])).rows;
    const counts = (await sql.query<any>(`SELECT result, status, count(*)::int AS n FROM eligibility_decisions WHERE drive_id = $1 AND rule_version_id = $2 GROUP BY result, status`, [d.id, d.rule_version_id])).rows;
    const skills = (await sql.query<any>(`SELECT id, slug, canonical_name AS name FROM skills WHERE slug IS NOT NULL ORDER BY canonical_name`)).rows;
    return { drive: { id: d.id, title: d.title.replace('[SYNTHETIC] ', ''), company: d.company.replace('[SYNTHETIC] ', ''), status: d.status, published: !!d.decisions_published_at, currentVersionId: d.rule_version_id },
      versions: versions.map(v => ({ ...v, publishedAt: iso(v.published_at) })), counts, skills };
  });

  /**
   * Fairness of a selection over a population, from group counts only (SECURITY DEFINER aggregate; small
   * groups suppressed). When the rule deliberately restricts branches, the population is the allowed
   * branches and branch itself is not compared, so the check measures disparity the rule did not intend.
   */
  const fairnessFor = async (sql: Sql, population: string[], selected: string[], dims: FairnessDimension[]) => {
    const reports: Record<string, any> = {};
    const adverse: string[] = [];
    let minRatio: number | null = null, shortfall = 0, ratioGap = 0;
    if (population.length < 20) return { reports, adverse, minRatio, shortfall, ratioGap };
    for (const dim of dims) {
      const counts = (await sql.query<any>(`SELECT * FROM fairness_selection_counts($1::uuid[], $2::uuid[], $3)`, [population, selected, dim])).rows;
      const recs = counts.flatMap(c => c.total === null ? Array.from({ length: 3 }, (_, i) => ({ studentId: `${c.group_value}-${i}`, groupValue: c.group_value, eligible: false }))
        : Array.from({ length: c.total }, (_, i) => ({ studentId: `${c.group_value}-${i}`, groupValue: c.group_value, eligible: i < c.selected })));
      const rep = FairnessCalculator.computeFairness(recs, dim, '00000000-0000-0000-0000-000000000000', 5, { stage: 'eligibility' });
      reports[dim] = rep;
      if (rep.adverseImpactDetected) adverse.push(dim);
      for (const g of Object.values(rep.groups) as any[]) if (g.impactRatio !== null) {
        minRatio = minRatio === null ? g.impactRatio : Math.min(minRatio, g.impactRatio);
        ratioGap += Math.max(0, 0.8 - g.impactRatio);
      }
      shortfall = Math.max(shortfall, shortfallOf(Object.values(rep.groups).map((g: any) => ({ total: g.totalCandidates, selected: g.eligibleCandidates, compared: !g.isSuppressed && !g.excludedFromComparison }))));
    }
    return { reports, adverse, minRatio, shortfall, ratioGap };
  };

  const loadPopulation = async (sql: Sql, rules: EligibilityRuleSpec) => {
    const rows = (await sql.query<{ id: string; code: string }>(`SELECT s.id, d.code FROM students s JOIN departments d ON d.id = s.department_id`)).rows;
    const allowed = rules.branches.map(b => b.toLowerCase());
    const pop = allowed.length ? rows.filter(r0 => allowed.includes(r0.code.toLowerCase())) : rows;
    const snaps = await academicSnapshots(sql, pop.map(r0 => r0.id));
    const dims: FairnessDimension[] = allowed.length ? ['gender', 'category', 'college_tier'] : DIMENSIONS;
    return { ids: pop.map(r0 => r0.id), snaps, dims };
  };

  const whatIf = async (sql: Sql, ctx: SessionContext, driveId: string, rulesInput: unknown) => {
    const parsed = EligibilityRuleSpecSchema.safeParse(rulesInput);
    if (!parsed.success) throw new HttpError(400, `Invalid rules: ${parsed.error.issues.map(i => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    const d = await one<any>(sql, `SELECT d.id, d.starts_at, d.rule_version_id FROM drives d WHERE d.id = $1`, [driveId], 'Drive not found.');
    const current = d.rule_version_id ? (await sql.query<any>(`SELECT * FROM eligibility_rule_versions WHERE id = $1`, [d.rule_version_id])).rows[0] : null;
    const { ids, snaps, dims } = await loadPopulation(sql, parsed.data);
    const asVersion = (rules: unknown) => ({ id: '00000000-0000-0000-0000-000000000000', ruleSetId: d.id, versionNo: 0, rules, rationale: 'draft', publishedBy: ctx.userId, publishedAt: new Date().toISOString() }) as any;
    const draft = asVersion(parsed.data);
    const cur = current ? asVersion(current.rules) : null;
    const opts = { driveStartsAt: iso(d.starts_at)! };
    const now: string[] = [], before: string[] = [];
    let gained = 0, lost = 0;
    for (const id of ids) {
      const a = EligibilityEvaluator.evaluate(snaps.get(id)!, draft, opts).status === 'eligible';
      const b = cur ? EligibilityEvaluator.evaluate(snaps.get(id)!, cur, opts).status === 'eligible' : false;
      if (a) now.push(id);
      if (b) before.push(id);
      if (a && !b) gained++;
      if (!a && b) lost++;
    }
    const f = await fairnessFor(sql, ids, now, dims);
    return {
      rules: parsed.data, population: ids.length, eligible: now.length, currentlyEligible: before.length, gained, lost,
      fairness: f.reports, adverseDimensions: f.adverse, minImpactRatio: f.minRatio, shortfall: f.shortfall, ratioGap: f.ratioGap,
      populationNote: parsed.data.branches.length
        ? `Compared within the allowed branches (${parsed.data.branches.join(', ')}). Branch is restricted on purpose, so it is not compared.`
        : 'Compared across all students in the college.',
      _internal: { ids, snaps, dims, opts, asVersion },
    };
  };

  r.post('/api/v2/tpo/drives/:id/rules/preview', O, async ({ ctx, sql, params, body }) => {
    const { _internal: _i, ...res } = await whatIf(sql, ctx, requireUuid(params.id, 'drive id'), body.rules);
    await sql.query(`INSERT INTO fairness_simulations (org_id, candidate_rules, summary, created_by) VALUES ($1,$2,$3,$4)`,
      [ctx.orgId, JSON.stringify(res.rules), JSON.stringify({ eligible: res.eligible, gained: res.gained, lost: res.lost, adverse: Object.entries(res.fairness).filter(([, v]: any) => v.adverseImpactDetected).map(([k]) => k) }), await membershipId(sql, ctx)]);
    return res;
  });

  // Less-discriminatory-alternative search: small neutral edits that remove adverse impact.
  r.post('/api/v2/tpo/drives/:id/rules/repair', O, async ({ ctx, sql, params, body }) => {
    const base = await whatIf(sql, ctx, requireUuid(params.id, 'drive id'), body.rules);
    const { ids, snaps, dims, opts, asVersion } = base._internal;
    const evaluated: RepairEvaluation[] = [];
    for (const c of candidateRepairs(base.rules)) {
      const v = asVersion(c.rules);
      const sel = ids.filter(id => EligibilityEvaluator.evaluate(snaps.get(id)!, v, opts).status === 'eligible');
      const f = await fairnessFor(sql, ids, sel, dims);
      evaluated.push({ edits: c.edits, rules: c.rules, eligible: sel.length, minImpactRatio: f.minRatio, adverseDimensions: f.adverse, shortfall: f.shortfall, ratioGap: f.ratioGap });
    }
    const options = rankRepairs({ eligible: base.eligible, shortfall: base.shortfall, minImpactRatio: base.minImpactRatio, adverseDimensions: base.adverseDimensions, ratioGap: base.ratioGap }, evaluated);
    await recordAgentRun(sql, ctx, 'Fairness Repair',
      [{ tool: 'search_rule_edits', input: { candidates: evaluated.length, adverse: base.adverseDimensions }, output: { options: options.length, fixes: options.filter(o => o.fixesAdverseImpact).length } }], []);
    return {
      baseline: { eligible: base.eligible, adverseDimensions: base.adverseDimensions, minImpactRatio: base.minImpactRatio, shortfall: base.shortfall, ratioGap: Math.round(base.ratioGap * 100) / 100 },
      searched: evaluated.length, options, populationNote: base.populationNote,
      note: 'Each option keeps every required skill. Options marked "makes a skill requirement easier" lower a skill or proof level, so decide whether that still suits the job. Nothing changes until you save a new version.',
    };
  });
  r.post('/api/v2/tpo/drives/:id/rules/publish', O, async ({ ctx, sql, params, body }) => {
    const driveId = requireUuid(params.id, 'drive id');
    const rationale = requireString(body.rationale, 'rationale', 5, 1000);
    const { _internal: _p, ...preview } = await whatIf(sql, ctx, driveId, body.rules);
    const d = await one<any>(sql, `SELECT rule_set_id FROM drives WHERE id = $1`, [driveId]);
    const next = (await sql.query<any>(`SELECT coalesce(max(version_no), 0) + 1 AS n FROM eligibility_rule_versions WHERE rule_set_id = $1`, [d.rule_set_id])).rows[0].n;
    const vid = randomUUID();
    await sql.query(`INSERT INTO eligibility_rule_versions (id, rule_set_id, version_no, rules, rationale, published_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [vid, d.rule_set_id, next, JSON.stringify(preview.rules), rationale, await membershipId(sql, ctx)]);
    await sql.query(`UPDATE drives SET rule_version_id = $2, decisions_published_at = NULL WHERE id = $1`, [driveId, vid]);
    await audit(sql, ctx, 'RULE_VERSION_PUBLISHED', 'eligibility_rule_version', vid, { driveId, versionNo: next, rationale, eligible: preview.eligible, gained: preview.gained, lost: preview.lost });
    if (ledgerEnabled()) {
      const adverse = Object.entries(preview.fairness ?? {}).filter(([, rep]: any) => rep?.adverseImpactDetected).map(([k]) => k);
      await appendLedger(sql, ctx, { kind: 'rule_published', driveId, versionNo: next, rulesHash: sha256Hex(canonicalJson(preview.rules)), population: preview.population, eligible: preview.eligible, groupsBelowFourFifths: adverse, at: new Date().toISOString() });
    }
    const counts = await evaluateDrive(sql, ctx, driveId, { publish: false });
    return { versionId: vid, versionNo: next, ...counts, note: 'These results are not final until you publish them to students.' };
  });
  r.post('/api/v2/tpo/drives/:id/decisions/publish', O, async ({ ctx, sql, params }) => {
    return evaluateDrive(sql, ctx, requireUuid(params.id, 'drive id'), { publish: true });
  });

  r.get('/api/v2/tpo/appeals', O, async ({ sql }) => {
    const rows = (await sql.query<any>(`SELECT a.id, a.reason, a.status, a.decision_note, a.created_at, a.due_at, u.full_name, s.enrollment_no, d.title AS drive, ed.result, ed.reasons, ed.id AS decision_id
      FROM eligibility_appeals a JOIN eligibility_decisions ed ON ed.id = a.decision_id JOIN drives d ON d.id = ed.drive_id JOIN students s ON s.id = a.student_id JOIN users u ON u.id = s.user_id
      ORDER BY a.status = 'pending' DESC, a.created_at DESC`)).rows;
    return rows.map(x => ({ id: x.id, student: displayName(x.full_name), enrollmentNo: x.enrollment_no, drive: x.drive.replace('[SYNTHETIC] ', ''), result: x.result, reason: x.reason,
      failing: (x.reasons?.checks ?? []).filter((c: any) => c.passed !== true).map((c: any) => c.message), status: x.status, note: x.decision_note, createdAt: iso(x.created_at), dueAt: iso(x.due_at) }));
  });
  r.post('/api/v2/tpo/appeals/:id/decide', O, async ({ ctx, sql, params, body }) => {
    if (!['upheld', 'overturned'].includes(body.status)) throw new HttpError(400, 'status must be upheld or overturned.');
    const note = requireString(body.note, 'note', 5, 2000);
    const mid = await membershipId(sql, ctx);
    const a = await one<any>(sql, `SELECT a.*, ed.result FROM eligibility_appeals a JOIN eligibility_decisions ed ON ed.id = a.decision_id WHERE a.id = $1 AND a.status = 'pending'`, [requireUuid(params.id, 'id')], 'Open appeal not found.');
    await sql.query(`UPDATE eligibility_appeals SET status = $2, decided_by = $3, decision_note = $4, decided_at = now() WHERE id = $1`, [a.id, body.status, mid, note]);
    if (body.status === 'overturned') {
      await sql.query(`INSERT INTO eligibility_overrides (decision_id, officer_membership_id, previous_result, new_result, justification) VALUES ($1,$2,$3,'eligible',$4)`, [a.decision_id, mid, a.result, note]);
      await sql.query(`UPDATE eligibility_decisions SET result = 'eligible', status = 'overridden' WHERE id = $1`, [a.decision_id]);
    }
    await audit(sql, ctx, 'APPEAL_DECIDED', 'eligibility_appeal', a.id, { status: body.status, note });
    return { ok: true };
  });

  // ---------- AD-09 AI proposals inbox ----------
  r.get('/api/v2/tpo/proposals', O, async ({ sql }) => {
    const rows = (await sql.query<any>(`SELECT p.id, p.kind, p.title, p.rationale, p.payload, p.status, p.decision_note, p.created_at, p.decided_at, ar.agent_name, ar.model_version
      FROM proposals p JOIN agent_runs ar ON ar.id = p.agent_run_id ORDER BY p.status = 'pending' DESC, p.created_at DESC LIMIT 200`)).rows;
    const actions = (await sql.query<any>(`SELECT agent_name, tool, input_summary, output_summary, created_at FROM agent_actions ORDER BY created_at DESC LIMIT 30`)).rows;
    return { proposals: rows.map(x => ({ ...x, createdAt: iso(x.created_at), decidedAt: iso(x.decided_at) })), recentActions: actions.map(a => ({ ...a, createdAt: iso(a.created_at) })) };
  });
  r.post('/api/v2/tpo/proposals/:id/decide', O, async ({ ctx, sql, params, body }) => {
    if (!['approve', 'reject'].includes(body.decision)) throw new HttpError(400, 'decision must be approve or reject.');
    const p = await one<any>(sql, `SELECT * FROM proposals WHERE id = $1 AND status = 'pending'`, [requireUuid(params.id, 'id')], 'Pending proposal not found.');
    const mid = await membershipId(sql, ctx);
    const note = typeof body.note === 'string' ? body.note.slice(0, 1000) : null;
    let effect = 'Rejected; nothing changed.';
    if (body.decision === 'approve') {
      const pl = p.payload;
      if (p.kind === 'slot_allocation') {
        if (!pl.driveId) throw new HttpError(409, 'No drive is linked to this company; create the drive first.');
        let n = 0;
        for (const a of pl.allocations) {
          await sql.query(`INSERT INTO drive_rounds (drive_id, kind, title, starts_at, ends_at, room_id, status) VALUES ($1,$2,$3,$4,$5,$6,'scheduled')`, [pl.driveId, a.kind, a.label, a.start, a.end, a.roomId]);
          n++;
        }
        effect = `${n} round(s) added to the calendar.`;
      } else if (p.kind === 'support_candidate') {
        if (!pl.mentorMembershipId) throw new HttpError(409, 'No mentor available for this department.');
        await sql.query(`INSERT INTO mentor_assignments (student_id, mentor_membership_id, reason, assigned_by, proposal_id) VALUES ($1,$2,$3,$4,$5)`, [pl.studentId, pl.mentorMembershipId, p.rationale, mid, p.id]);
        effect = `Mentor ${pl.mentorName} assigned.`;
      } else if (p.kind === 'interview_questions') {
        await sql.query(`UPDATE interview_questions SET status = 'approved', approved_by = $2 WHERE id = ANY($1) AND status = 'draft'`, [pl.questionIds, mid]);
        effect = `${pl.questionIds.length} question(s) approved for students.`;
      } else if (p.kind === 'gap_alert') {
        await sql.query(`INSERT INTO interventions (org_id, title, skill_id, starts_on, ends_on, created_by) VALUES ($1,$2,$3, CURRENT_DATE + 7, CURRENT_DATE + 21, $4)`, [ctx.orgId, `${pl.skill} training`, pl.skillId, mid]);
        effect = `${pl.skill} training added to interventions.`;
      } else if (p.kind === 'shortlist') {
        for (const sid of pl.studentIds) {
          const app = (await sql.query<any>(`SELECT id, stage FROM applications WHERE drive_id = $1 AND student_id = $2`, [pl.driveId, sid])).rows[0];
          if (!app) continue;
          await sql.query(`UPDATE applications SET stage = 'shortlisted', updated_at = now() WHERE id = $1`, [app.id]);
          await sql.query(`INSERT INTO application_events (application_id, from_stage, to_stage, actor_membership_id, note) VALUES ($1,$2,'shortlisted',$3,$4)`, [app.id, app.stage, mid, `Recruiter shortlist approved by officer`]);
        }
        effect = `${pl.studentIds.length} student(s) shortlisted.`;
      }
    }
    await sql.query(`UPDATE proposals SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4 WHERE id = $1`, [p.id, body.decision === 'approve' ? 'applied' : 'rejected', mid, note]);
    await audit(sql, ctx, body.decision === 'approve' ? 'PROPOSAL_APPROVED' : 'PROPOSAL_REJECTED', 'proposal', p.id, { kind: p.kind, effect });
    return { effect };
  });

  // ---------- AD-10 Fairness check ----------
  r.get('/api/v2/tpo/fairness', O, async ({ sql, query }) => {
    const driveId = requireUuid(query.driveId, 'driveId');
    const dimension = (query.dimension ?? 'gender') as FairnessDimension;
    if (!DIMENSIONS.includes(dimension)) throw new HttpError(400, 'Unknown dimension.');
    const counts = (await sql.query<any>(`SELECT * FROM fairness_funnel_counts($1, $2)`, [driveId, dimension])).rows;
    const recs = counts.flatMap(c => c.total === null
      ? Array.from({ length: 2 }, (_, i) => ({ studentId: `${c.group_value}-${i}`, groupValue: c.group_value, eligible: false, shortlisted: false, offered: false }))
      : Array.from({ length: c.total }, (_, i) => ({ studentId: `${c.group_value}-${i}`, groupValue: c.group_value, eligible: i < c.eligible, shortlisted: i < c.shortlisted, offered: i < c.offered })));
    const report = FairnessCalculator.computeFunnel(recs, dimension, '00000000-0000-0000-0000-000000000000');
    const reviews = (await sql.query<any>(`SELECT id, dimension, stage, status, notes, created_at FROM fairness_reviews WHERE drive_id = $1 ORDER BY created_at DESC`, [driveId])).rows;
    return { dimension, report, suppressedGroups: counts.filter(c => c.total === null).map(c => c.group_value), reviews };
  });
  r.post('/api/v2/tpo/fairness/flag', O, async ({ ctx, sql, body }) => {
    const id = randomUUID();
    await sql.query(`INSERT INTO fairness_reviews (id, drive_id, dimension, stage, rule_version_id, highest_selection_rate, group_metrics, adverse_impact_detected, reviewed_by, status, notes)
      SELECT $1, d.id, $3, $4, d.rule_version_id, $5, $6, TRUE, $7, $8, $9 FROM drives d WHERE d.id = $2`,
      [id, requireUuid(body.driveId, 'driveId'), body.dimension, body.stage ?? 'eligibility', Number(body.highestSelectionRate ?? 0), JSON.stringify(body.groups ?? {}), await membershipId(sql, ctx),
        body.status === 'cleared' ? 'cleared' : 'flagged_for_hearing', requireString(body.notes, 'notes', 5, 2000)]);
    await audit(sql, ctx, 'FAIRNESS_REVIEWED', 'fairness_review', id, { dimension: body.dimension, stage: body.stage, status: body.status });
    return { id };
  });

  // ---------- AD-11 Accreditation reporting ----------
  const accreditation = async (sql: Sql) => {
    const grads = (await sql.query<any>(`SELECT d.code, count(*)::int AS n FROM students s JOIN departments d ON d.id = s.department_id GROUP BY d.code`)).rows;
    const outcomes = (await sql.query<any>(`SELECT o.student_id, d.code, o.outcome_type, o.ctc_inr FROM student_outcomes o JOIN students s ON s.id = o.student_id JOIN departments d ON d.id = s.department_id
      UNION ALL SELECT a.student_id, d.code, 'placed', f.ctc_inr FROM offers f JOIN applications a ON a.id = f.application_id JOIN students s ON s.id = a.student_id JOIN departments d ON d.id = s.department_id WHERE f.status = 'accepted'`)).rows;
    return accreditationSummary(new Map(grads.map(g => [g.code, g.n])), outcomes.map(o => ({ studentId: o.student_id, branch: o.code, outcomeType: o.outcome_type, ctcInr: o.ctc_inr ? Number(o.ctc_inr) : null })));
  };
  r.get('/api/v2/tpo/accreditation', O, async ({ sql }) => accreditation(sql));
  r.get('/api/v2/tpo/accreditation/export.csv', O, async ({ ctx, sql, reply }) => {
    const s = await accreditation(sql);
    await audit(sql, ctx, 'ACCREDITATION_EXPORTED', 'report', null, {});
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="naac-nirf-placement.csv"');
    return toCsv([...s.rows, s.total].map(r0 => ({ Branch: r0.branch, 'Students graduating': r0.graduating, 'Students placed': r0.placed, 'Placement %': r0.placedPercent,
      'Higher studies': r0.higherStudies, Entrepreneurship: r0.entrepreneurship, 'Median CTC (INR)': r0.medianCtcInr ?? '', 'Highest CTC (INR)': r0.highestCtcInr ?? '', 'Average CTC (INR)': r0.averageCtcInr ?? '' })));
  }, { raw: true });

  /** A real Excel workbook (.xlsx): one sheet of placement outcomes by branch and one of notes on how each number is counted. */
  r.get('/api/v2/tpo/accreditation/export.xlsx', O, async ({ ctx, sql, reply }) => {
    const s = await accreditation(sql);
    const org = (await sql.query<any>(`SELECT name FROM organizations WHERE id = $1`, [ctx.orgId])).rows[0].name.replace('[SYNTHETIC] ', '');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'PRAMAAN'; wb.created = new Date();
    const ws = wb.addWorksheet('Placement outcomes');
    ws.addRow([`${org}: placement and progression by branch`]).font = { bold: true, size: 13 };
    ws.addRow([]);
    const head = ws.addRow(['Branch', 'Students graduating', 'Students placed', 'Placement %', 'Higher studies', 'Entrepreneurship', 'Median CTC (INR)', 'Highest CTC (INR)', 'Average CTC (INR)']);
    head.font = { bold: true };
    for (const r0 of [...s.rows, s.total]) ws.addRow([r0.branch, r0.graduating, r0.placed, r0.placedPercent, r0.higherStudies, r0.entrepreneurship, r0.medianCtcInr ?? null, r0.highestCtcInr ?? null, r0.averageCtcInr ?? null]);
    ws.getRow(ws.rowCount).font = { bold: true };
    ws.columns.forEach(c => { c.width = 20; });
    ws.getColumn(1).width = 26;
    const notes = wb.addWorksheet('Notes');
    for (const n of s.notes) notes.addRow([n]);
    notes.getColumn(1).width = 120;
    await audit(sql, ctx, 'ACCREDITATION_EXPORTED', 'report', null, { format: 'xlsx' });
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('content-disposition', 'attachment; filename="placement-outcomes.xlsx"');
    return buf;
  }, { raw: true });

  // ---------- AD-12 Roles & college data ----------
  r.get('/api/v2/tpo/members', O, async ({ sql }) => {
    const rows = (await sql.query<any>(`SELECT m.id, m.role, m.status, u.full_name, u.email, d.code AS department FROM memberships m JOIN users u ON u.id = m.user_id
      LEFT JOIN departments d ON d.id = m.department_id WHERE m.role <> 'student' ORDER BY m.role, u.full_name`)).rows;
    const counts = (await sql.query<any>(`SELECT role, count(*)::int AS n FROM memberships GROUP BY role`)).rows;
    const depts = (await sql.query<any>(`SELECT id, code, name FROM departments ORDER BY code`)).rows;
    return { members: rows.map(x => ({ ...x, full_name: displayName(x.full_name) })), counts, departments: depts };
  });
  r.post('/api/v2/tpo/members', ['officer', 'college_admin', 'platform_admin'], async ({ ctx, sql, body }) => {
    const role = body.role;
    if (!['officer', 'dept_coordinator', 'mentor', 'recruiter'].includes(role)) throw new HttpError(400, 'role must be officer, dept_coordinator, mentor or recruiter.');
    const email = requireString(body.email, 'email', 5, 255).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Invalid email.');
    const user = (await sql.query<any>(`SELECT id FROM users WHERE email = $1`, [email])).rows[0];
    if (!user) throw new HttpError(404, 'No account with this email yet. In production, the person signs up first and is then added here.');
    const id = randomUUID();
    await sql.query(`INSERT INTO memberships (id, user_id, org_id, department_id, role) VALUES ($1,$2,$3,$4,$5)`, [id, user.id, ctx.orgId, body.departmentId ?? null, role]);
    await audit(sql, ctx, 'MEMBERSHIP_ADDED', 'membership', id, { role });
    return { id };
  });
  r.post('/api/v2/tpo/members/:id/status', ['officer', 'college_admin', 'platform_admin'], async ({ ctx, sql, params, body }) => {
    if (!['active', 'suspended', 'revoked'].includes(body.status)) throw new HttpError(400, 'Invalid status.');
    await sql.query(`UPDATE memberships SET status = $2 WHERE id = $1 AND role <> 'student'`, [requireUuid(params.id, 'id'), body.status]);
    await audit(sql, ctx, 'MEMBERSHIP_STATUS_CHANGED', 'membership', params.id, { status: body.status });
    return { ok: true };
  });
  r.get('/api/v2/tpo/audit', O, async ({ sql }) => {
    const rows = (await sql.query<any>(`SELECT seq, action, object_type, actor_type, metadata, occurred_at, hash FROM audit_events ORDER BY seq DESC LIMIT 60`)).rows;
    return rows.map(x => ({ ...x, seq: Number(x.seq), occurredAt: iso(x.occurred_at), hash: String(x.hash).slice(0, 12) }));
  });

  /** Recomputes every hash in this college's audit log from the first event and reports whether the chain is intact. */
  r.get('/api/v2/tpo/audit/verify', O, async ({ ctx, sql }) => {
    const rows = (await sql.query<any>(`SELECT id, seq, org_id, actor_type, actor_id, action, object_type, object_id, metadata, prev_hash, hash, occurred_at FROM audit_events WHERE org_id = $1 ORDER BY seq`, [ctx.orgId])).rows;
    const events = rows.map(x => ({ id: x.id, seq: Number(x.seq), orgId: x.org_id, actorType: x.actor_type, actorId: x.actor_id, action: x.action, objectType: x.object_type, objectId: x.object_id, metadata: x.metadata ?? {}, prevHash: x.prev_hash, hash: x.hash, occurredAt: iso(x.occurred_at)! }));
    const res = AuditChain.verifyChain(events as any);
    return { events: events.length, valid: res.valid, status: res.status, brokenAtSeq: (res as any).brokenAtSeq ?? null, message: res.valid ? `All ${events.length} entries are linked and unchanged.` : `The log was changed or damaged at entry ${(res as any).brokenAtSeq ?? '?'}.` };
  });

  // ---------- Recruiter access to a drive (AD-08) ----------
  r.get('/api/v2/tpo/recruiter-grants', O, async ({ sql }) => {
    const grants = (await sql.query<any>(`SELECT g.id, g.expires_at, d.title AS drive, u.full_name, u.email FROM recruiter_access_grants g JOIN drives d ON d.id = g.drive_id JOIN memberships m ON m.id = g.recruiter_membership_id JOIN users u ON u.id = m.user_id ORDER BY g.expires_at DESC`)).rows;
    const recruiters = (await sql.query<any>(`SELECT m.id, u.full_name, u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.role = 'recruiter' AND m.status = 'active' ORDER BY u.full_name`)).rows;
    return { grants: grants.map(g => ({ id: g.id, drive: g.drive.replace('[SYNTHETIC] ', ''), recruiter: displayName(g.full_name), email: g.email, expiresAt: iso(g.expires_at), active: new Date(g.expires_at).getTime() > Date.now() })), recruiters: recruiters.map(x => ({ id: x.id, name: displayName(x.full_name), email: x.email })) };
  });
  r.post('/api/v2/tpo/recruiter-grants', O, async ({ ctx, sql, body }) => {
    const mid = await membershipId(sql, ctx);
    const rec = await one<any>(sql, `SELECT id FROM memberships WHERE id = $1 AND role = 'recruiter' AND status = 'active'`, [requireUuid(body.recruiterMembershipId, 'recruiter')], 'Recruiter not found.');
    const drive = await one<any>(sql, `SELECT id FROM drives WHERE id = $1`, [requireUuid(body.driveId, 'drive')], 'Drive not found.');
    const days = Math.min(180, Math.max(1, Number(body.days ?? 30) || 30));
    const id = randomUUID();
    await sql.query(`INSERT INTO recruiter_access_grants (id, recruiter_membership_id, drive_id, approved_by, expires_at) VALUES ($1,$2,$3,$4, now() + ($5 || ' days')::interval)`, [id, rec.id, drive.id, mid, String(days)]);
    await audit(sql, ctx, 'RECRUITER_ACCESS_GRANTED', 'recruiter_access_grant', id, { driveId: drive.id, days });
    return { id, message: `Access granted for ${days} days.` };
  });
  r.post('/api/v2/tpo/recruiter-grants/:id/revoke', O, async ({ ctx, sql, params }) => {
    await sql.query(`UPDATE recruiter_access_grants SET expires_at = now() WHERE id = $1`, [requireUuid(params.id, 'grant id')]);
    await audit(sql, ctx, 'RECRUITER_ACCESS_REVOKED', 'recruiter_access_grant', params.id, {});
    return { ok: true };
  });

  // ---------- Placement outcomes the system did not see (AD-11) ----------
  r.post('/api/v2/tpo/outcomes', O, async ({ ctx, sql, body }) => {
    const st = await one<any>(sql, `SELECT id FROM students WHERE enrollment_no = $1`, [requireString(body.enrollmentNo, 'enrollmentNo', 2, 50)], 'No student with that enrollment number.');
    if (!['placed', 'higher_studies', 'entrepreneurship'].includes(body.outcomeType)) throw new HttpError(400, 'Outcome must be placed, higher_studies or entrepreneurship.');
    const ctc = body.ctcInr === undefined || body.ctcInr === '' || body.ctcInr === null ? null : Number(body.ctcInr);
    if (ctc !== null && !(ctc > 0)) throw new HttpError(400, 'CTC must be a positive number.');
    const id = randomUUID();
    await sql.query(`INSERT INTO student_outcomes (id, student_id, outcome_type, organization_name, ctc_inr, evidence_ref) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, st.id, body.outcomeType, typeof body.organization === 'string' ? body.organization.slice(0, 255) : null, ctc, typeof body.evidenceRef === 'string' ? body.evidenceRef.slice(0, 255) : null]);
    await audit(sql, ctx, 'OUTCOME_RECORDED', 'student_outcome', id, { outcomeType: body.outcomeType });
    return { id, message: 'Outcome recorded. It appears in the accreditation tables.' };
  });

  // ---------- Retention (DPDP): code kept only for the retention period after consent was withdrawn ----------
  /** Deletes imported code (raw file bytes) of students whose repository consent was withdrawn longer ago than the purpose's retention period. */
  r.post('/api/v2/tpo/retention/run', O, async ({ ctx, sql }) => {
    const days = Number((await sql.query<any>(`SELECT retention_days FROM consent_purposes WHERE code = 'repo_verification'`)).rows[0]?.retention_days ?? 365);
    const stale = (await sql.query<any>(`SELECT s.student_id FROM source_snapshots s
        WHERE NOT EXISTS (SELECT 1 FROM consent_grants g WHERE g.student_id = s.student_id AND g.purpose = 'repo_verification' AND g.revoked_at IS NULL)
        GROUP BY s.student_id
        HAVING coalesce((SELECT max(g.revoked_at) FROM consent_grants g WHERE g.student_id = s.student_id AND g.purpose = 'repo_verification'), '-infinity') < now() - ($1 || ' days')::interval`, [String(days)])).rows.map(x => x.student_id);
    let deleted = 0;
    if (stale.length) deleted = (await sql.query<any>(`DELETE FROM source_snapshots WHERE student_id = ANY($1::uuid[]) RETURNING 1`, [stale])).rows.length;
    await audit(sql, ctx, 'RETENTION_PURGE_RUN', 'organization', ctx.orgId, { retentionDays: days, students: stale.length, snapshotsDeleted: deleted });
    return { retentionDays: days, students: stale.length, snapshotsDeleted: deleted, message: deleted ? `Deleted ${deleted} stored file(s) for ${stale.length} student(s) whose consent ended more than ${days} days ago.` : `Nothing is past its ${days}-day retention period.` };
  });

  // ---------- Data requests from students (DPDP rights) ----------
  r.get('/api/v2/tpo/data-requests', O, async ({ sql }) => {
    const rows = (await sql.query<any>(`SELECT q.id, q.type, q.status, q.due_at, q.completed_at, q.exception_note, q.created_at, u.full_name, s.enrollment_no, s.erased_at
      FROM data_requests q JOIN students s ON s.id = q.student_id JOIN users u ON u.id = s.user_id ORDER BY (q.status IN ('pending','processing')) DESC, q.due_at LIMIT 100`)).rows;
    return rows.map(x => ({ id: x.id, type: x.type, status: x.status, dueAt: iso(x.due_at), completedAt: iso(x.completed_at), note: x.exception_note, createdAt: iso(x.created_at), student: displayName(x.full_name), enrollmentNo: x.enrollment_no, overdue: ['pending', 'processing'].includes(x.status) && new Date(x.due_at).getTime() < Date.now() }));
  });
  /** Completes or rejects a request. Completing an erasure request removes the student's personal data (see migration 028). */
  r.post('/api/v2/tpo/data-requests/:id/decide', O, async ({ ctx, sql, params, body }) => {
    const q = await one<any>(sql, `SELECT id, student_id, type, status FROM data_requests WHERE id = $1`, [requireUuid(params.id, 'request id')], 'Request not found.');
    if (!['pending', 'processing'].includes(q.status)) throw new HttpError(409, 'This request was already closed.');
    const note = requireString(body.note, 'note', 5, 1000);
    if (!['complete', 'reject'].includes(body.action)) throw new HttpError(400, 'action must be complete or reject.');
    let removed: any = null;
    if (body.action === 'complete' && q.type === 'erasure') {
      await sql.query(`DELETE FROM project_kits WHERE student_id = $1`, [q.student_id]);
      removed = (await sql.query<any>(`SELECT erase_student_data($1) AS r`, [q.student_id])).rows[0].r;
    }
    await sql.query(`UPDATE data_requests SET status = $2::varchar, completed_at = now(), exception_note = CASE WHEN $2::varchar = 'rejected' THEN $3::text ELSE NULL END WHERE id = $1`, [q.id, body.action === 'complete' ? 'completed' : 'rejected', note]);
    await audit(sql, ctx, 'DATA_REQUEST_CLOSED', 'data_request', q.id, { type: q.type, action: body.action, removed });
    return { status: body.action === 'complete' ? 'completed' : 'rejected', removed };
  });

  // ---------- Mentor review queue (non-repo evidence, L3 Attested) ----------
  r.get('/api/v2/tpo/reviews', STAFF_ROLES, async ({ ctx, sql }) => {
    const scope = ctx.role === 'mentor' || ctx.role === 'dept_coordinator' ? `AND s.department_id = $1` : '';
    const rows = (await sql.query<any>(`SELECT e.id, e.kind, e.description, e.object_key AS link, e.created_at, e.source, u.full_name, s.enrollment_no, k.canonical_name AS skill, k.slug
      FROM evidence_items e JOIN students s ON s.id = e.student_id JOIN users u ON u.id = s.user_id LEFT JOIN skills k ON k.id = e.claimed_skill_id
      WHERE e.status = 'submitted' ${scope} ORDER BY e.created_at`, scope ? [ctx.departmentId] : [])).rows;
    return rows.map(x => ({ ...x, full_name: displayName(x.full_name), createdAt: iso(x.created_at) }));
  });
  r.post('/api/v2/tpo/reviews/:id/decide', STAFF_ROLES, async ({ ctx, sql, params, body }) => {
    const e = await one<any>(sql, `SELECT e.*, k.slug FROM evidence_items e LEFT JOIN skills k ON k.id = e.claimed_skill_id WHERE e.id = $1 AND e.status = 'submitted'`, [requireUuid(params.id, 'id')], 'Submission not found.');
    const mid = await membershipId(sql, ctx);
    if (body.decision === 'reject') {
      await sql.query(`UPDATE evidence_items SET status = 'rejected', reviewed_by = $2, review_note = $3 WHERE id = $1`, [e.id, mid, requireString(body.note, 'note', 5, 1000)]);
      await audit(sql, ctx, 'EVIDENCE_REJECTED', 'evidence_item', e.id, {});
      return { message: 'Rejected with feedback to the student.' };
    }
    const scores = body.rubricScores && typeof body.rubricScores === 'object' ? Object.fromEntries(Object.entries(body.rubricScores).map(([k, v]) => [k, Math.max(1, Math.min(3, Number(v) || 1))])) : {};
    const attest = body.decision === 'attest';
    // Accept the submission itself, then (optionally) attest it against the rubric.
    await sql.query(`UPDATE evidence_items SET status = 'accepted', accepted_by = $2, accepted_at = now(), valid_until = now() + interval '365 days', reviewed_by = $2, review_note = $3 WHERE id = $1`,
      [e.id, mid, typeof body.note === 'string' ? body.note.slice(0, 1000) : null]);
    if (!e.claimed_skill_id) return { message: 'Accepted.' };
    const ss = (await sql.query<any>(`SELECT id, state FROM student_skills WHERE student_id = $1 AND skill_id = $2`, [e.student_id, e.claimed_skill_id])).rows[0];
    await sql.query(`INSERT INTO skill_evidence (student_skill_id, evidence_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [ss.id, e.id]);
    if (ss.state === 'claimed' || ss.state === 'observed') {
      await sql.query(`UPDATE student_skills SET state = 'evidence_linked' WHERE id = $1`, [ss.id]);
      await sql.query(`INSERT INTO skill_state_events (student_skill_id, from_state, to_state, reason_code, actor_type, actor_id) VALUES ($1,$2,'evidence_linked','EVIDENCE_ACCEPTED','mentor',$3)`, [ss.id, ss.state, ctx.userId]);
    }
    let message = 'Accepted: the skill is now Evidence-linked.';
    if (attest) {
      const rubric = await one<any>(sql, `SELECT id FROM rubric_versions WHERE skill_id = $1 ORDER BY version_no DESC LIMIT 1`, [e.claimed_skill_id]);
      const attId = randomUUID();
      const validUntil = new Date(Date.now() + 365 * 86_400_000).toISOString();
      await sql.query(`INSERT INTO attestations (id, evidence_id, mentor_membership_id, rubric_version_id, scope_text, rubric_scores, valid_until) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [attId, e.id, mid, rubric.id, requireString(body.scope, 'scope', 10, 1000), JSON.stringify(scores), validUntil]);
      const res = await awardProof(sql, ctx, { studentId: e.student_id, skillId: e.claimed_skill_id, reasonCode: 'MENTOR_ATTESTED', level: 2,
        evidence: { kind: 'mentor_attestation', description: `Mentor sign-off: ${body.scope}`, source: 'mentor' },
        verification: { type: 'attestation', attestation: { id: attId, evidenceId: e.id, mentorMembershipId: mid, rubricVersionId: rubric.id, scopeText: body.scope, rubricScores: scores, validUntil, createdAt: new Date().toISOString() } } });
      // awardProof records the attestation's own evidence; the original submission is the attested artifact.
      message = res.message;
      await reevaluateStudent(sql, ctx, e.student_id);
    }
    await audit(sql, ctx, attest ? 'EVIDENCE_ATTESTED' : 'EVIDENCE_ACCEPTED', 'evidence_item', e.id, { scores });
    return { message };
  });
}
