import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createMigratedDb, applySeed } from './helpers/pglite-db';
import { EligibilityRuleSpecSchema, EligibilityRuleVersion, StudentAcademicSnapshot } from '@pramaan/contracts';
import { EligibilityEvaluator, ProofPath, FairnessCalculator, DriveRuleContext } from '@pramaan/domain';

/**
 * Phase 0 seeds (010 taxonomy, 020 synthetic tenant) applied on top of every migration in PGlite,
 * then exercised end-to-end through the real domain code.
 */
const NOW = '2026-11-16T00:00:00.000Z';
let db: PGlite;

async function snapshots(where = 'TRUE'): Promise<StudentAcademicSnapshot[]> {
  const res = await db.query<{ id: string; cgpa: string; active_backlogs: number; tenth: string | null; twelfth: string | null; diploma: string | null; gap: number | null; history: number | null; branch: string; graduating_year: number; skills: StudentAcademicSnapshot['skills'] | null; offers: number }>(`
    SELECT s.id, a.cgpa, a.active_backlogs, a.tenth_pct AS tenth, a.twelfth_pct AS twelfth, a.diploma_pct AS diploma, a.gap_years AS gap, a.backlog_history AS history, d.code AS branch, s.graduating_year,
           (SELECT count(*)::int FROM student_outcomes o WHERE o.student_id = s.id AND o.outcome_type = 'placed') AS offers,
           (SELECT jsonb_agg(jsonb_build_object('skillId', ss.skill_id, 'name', k.canonical_name, 'state', ss.state, 'level', ss.level,
                   'proofLevel', ss.proof_level, 'validUntil', to_char(ss.valid_until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
              FROM student_skills ss JOIN skills k ON k.id = ss.skill_id WHERE ss.student_id = s.id) AS skills
      FROM students s
      JOIN academic_records a ON a.student_id = s.id
      JOIN departments d ON d.id = s.department_id
      JOIN organizations o ON o.id = s.org_id
     WHERE o.name LIKE '[SYNTHETIC]%' AND ${where}`);
  return res.rows.map(r => ({
    studentId: r.id, cgpa: Number(r.cgpa), tenthPct: r.tenth === null ? null : Number(r.tenth), twelfthPct: r.twelfth === null ? null : Number(r.twelfth),
    diplomaPct: r.diploma === null ? null : Number(r.diploma), gapYears: r.gap, activeBacklogs: r.active_backlogs, backlogHistory: r.history, branch: r.branch, graduatingYear: r.graduating_year,
    skills: r.skills ?? [], offersHeld: r.offers, highestOfferCtcInr: null, disciplinaryHold: false,
  }));
}

async function drives(status = "'scheduled'"): Promise<DriveRuleContext[]> {
  const res = await db.query<{ id: string; title: string; starts_at: string; rv: Omit<EligibilityRuleVersion, 'rules'> & { rules: unknown } }>(`
    SELECT d.id, d.title, d.starts_at,
           jsonb_build_object('id', v.id, 'ruleSetId', v.rule_set_id, 'versionNo', v.version_no, 'rules', v.rules,
                              'rationale', v.rationale, 'publishedBy', v.published_by, 'publishedAt', '2026-11-01T00:00:00.000Z') AS rv
      FROM drives d
      JOIN eligibility_rule_sets rs ON rs.title LIKE '%criteria' AND rs.org_id = d.org_id
      JOIN eligibility_rule_versions v ON v.rule_set_id = rs.id
     WHERE d.status IN (${status}) AND d.title = '[SYNTHETIC] ' || replace(rs.title, ' criteria', '')`);
  return res.rows.map(r => ({
    driveId: r.id, title: r.title, startsAt: new Date(r.starts_at).toISOString(),
    ruleVersion: { ...r.rv, rules: EligibilityRuleSpecSchema.parse(r.rv.rules) } as EligibilityRuleVersion,
  }));
}

beforeAll(async () => {
  db = await createMigratedDb();
  await applySeed(db, '001_demo_seed.sql');
  await applySeed(db, '010_skill_taxonomy.sql');
  await applySeed(db, '015_assessment_banks.sql');
  await applySeed(db, '020_synthetic_demo_tenant.sql');
}, 180_000);

describe('Seed 010: taxonomy', () => {
  it('loads ~145 slugged skills with aliases, and every framework mapping is pending review with no invented code', async () => {
    const s = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM skills WHERE slug IS NOT NULL`);
    expect(s.rows[0].n).toBeGreaterThanOrEqual(140);
    const m = await db.query<{ n: number; bad: number }>(`SELECT count(*)::int AS n, count(*) FILTER (WHERE status <> 'pending_review' OR code IS NOT NULL)::int AS bad FROM skill_mappings`);
    expect(m.rows[0].n).toBeGreaterThan(50);
    expect(m.rows[0].bad).toBe(0);
    const legacy = await db.query<{ slug: string }>(`SELECT slug FROM skills WHERE id = '50000000-0000-0000-0000-000000000001'`);
    expect(legacy.rows[0].slug).toBe('python'); // seed 001 row kept its id and gained a slug
  });
});

describe('Seed 020: synthetic tenant', () => {
  it('has 300 students, all visibly synthetic, with .invalid e-mail addresses', async () => {
    const r = await db.query<{ n: number; bad_email: number }>(`
      SELECT count(*)::int AS n, count(*) FILTER (WHERE u.email NOT LIKE '%.invalid' OR u.full_name NOT LIKE '%[SYNTHETIC]')::int AS bad_email
        FROM students s JOIN users u ON u.id = s.user_id JOIN organizations o ON o.id = s.org_id WHERE o.name LIKE '[SYNTHETIC]%'`);
    expect(r.rows[0]).toEqual({ n: 300, bad_email: 0 });
  });

  it('derives 10 minors from date of birth; a minor without verified guardian consent never shares with recruiters', async () => {
    const m = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM student_age_status a JOIN organizations o ON o.id = a.org_id WHERE o.name LIKE '[SYNTHETIC]%' AND a.is_minor_effective`);
    expect(m.rows[0].n).toBe(10);
    const leak = await db.query<{ n: number }>(`
      SELECT count(*)::int AS n FROM student_age_status a
        JOIN consent_grants c ON c.student_id = a.student_id AND c.purpose = 'recruiter_sharing' AND c.revoked_at IS NULL
       WHERE a.is_minor_effective AND NOT a.has_verified_guardian_consent`);
    expect(leak.rows[0].n).toBe(0);
  });

  it('every verified skill passed the v2 trigger: proof level, passed session and fresh evidence', async () => {
    const r = await db.query<{ verified: number; missing: number }>(`
      SELECT count(*)::int AS verified,
             count(*) FILTER (WHERE ss.proof_level IS NULL OR vs.outcome IS DISTINCT FROM 'passed')::int AS missing
        FROM student_skills ss LEFT JOIN verification_sessions vs ON vs.id = ss.last_verification_id
       WHERE ss.state = 'verified'`);
    expect(r.rows[0].verified).toBeGreaterThan(800);
    expect(r.rows[0].missing).toBe(0);
  });

  it('is idempotent: re-applying both seeds changes nothing', async () => {
    const before = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM student_skills`);
    await applySeed(db, '010_skill_taxonomy.sql');
    await applySeed(db, '020_synthetic_demo_tenant.sql');
    const after = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM student_skills`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});

describe('Seeded data through the domain engines', () => {
  it('every seeded rule is valid DSL v2, and the cohort gets a realistic mix of outcomes', async () => {
    const ds = await drives();
    expect(ds.length).toBeGreaterThanOrEqual(8);
    const banks = await db.query<{ apt: number; probs: number; tasks: number }>(`SELECT (SELECT count(*)::int FROM aptitude_questions) AS apt, (SELECT count(*)::int FROM coding_problems) AS probs, (SELECT count(*)::int FROM learning_tasks) AS tasks`);
    expect(banks.rows[0].apt).toBeGreaterThanOrEqual(90);
    expect(banks.rows[0].probs).toBe(8);
    expect(banks.rows[0].tasks).toBeGreaterThanOrEqual(20);
    const cse = await snapshots(`d.code IN ('CSE', 'IT')`);
    const backend = ds.find(d => d.title?.includes('Backend Developer'))!;
    const results = cse.map(s => EligibilityEvaluator.evaluate(s, backend.ruleVersion, { now: NOW, driveStartsAt: backend.startsAt }));
    const eligible = results.filter(r => r.status === 'eligible').length;
    expect(eligible).toBeGreaterThan(0);
    expect(eligible).toBeLessThan(results.length);
  });

  it('Proof Path for the hero student (Rahul, CSE) puts SQL first and it unlocks the Backend Developer drive', async () => {
    const [rahul] = await snapshots(`s.enrollment_no = 'SCOE-2027-CSE-001'`);
    expect(rahul).toBeDefined();
    const ds = await drives();
    const path = ProofPath.forStudent(rahul, ds, { now: NOW });
    const backend = ds.find(d => d.title?.includes('Backend Developer'))!;
    expect(path.actions[0].name).toBe('SQL');
    expect(path.actions[0].targetProof).toBe('L2');
    expect(path.actions[0].unlocksDriveIds).toContain(backend.driveId);
  });

  it('cohort intervention ranking and per-stage fairness run on the completed drive', async () => {
    const ds = await drives();
    const cohort = await snapshots(`d.code IN ('CSE', 'IT')`);
    const ranking = ProofPath.rankInterventions(cohort, ds, { now: NOW });
    expect(ranking.length).toBeGreaterThan(3);
    expect(ranking[0].eligibilitiesGained).toBeGreaterThan(0);

    const funnel = await db.query<{ student_id: string; gender: string | null; stage: string }>(`
      SELECT a.student_id, g.gender, a.stage FROM applications a
        JOIN drives d ON d.id = a.drive_id AND d.status = 'completed'
        LEFT JOIN student_group_attributes g ON g.student_id = a.student_id`);
    const report = FairnessCalculator.computeFunnel(funnel.rows.map(r => ({
      studentId: r.student_id, groupValue: r.gender ?? 'Unspecified', eligible: true,
      shortlisted: r.stage !== 'rejected', offered: r.stage === 'offered',
    })), 'gender', '00000000-0000-0000-0000-000000000000', 5, { now: NOW });
    expect(report.shortlist.referenceGroup).not.toBeNull();
    expect(Object.keys(report.shortlist.groups)).toEqual(expect.arrayContaining(['Female', 'Male']));
  });
});
