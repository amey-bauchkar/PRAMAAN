import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createMigratedDb } from './helpers/pglite-db';

/**
 * Phase 0 schema invariants (migrations 017–019), verified on an in-process PostgreSQL (PGlite).
 * No live database is touched.
 */
const ORG = '00000000-0000-0000-0000-0000000000a1';
const ORG2 = '00000000-0000-0000-0000-0000000000a2';
const DEPT = '00000000-0000-0000-0000-0000000000d1';
const U_STUDENT = '00000000-0000-0000-0000-0000000000b1';
const U_MENTOR = '00000000-0000-0000-0000-0000000000b2';
const U_OUTSIDER = '00000000-0000-0000-0000-0000000000b3';
const M_STUDENT = '00000000-0000-0000-0000-0000000000c1';
const M_MENTOR = '00000000-0000-0000-0000-0000000000c2';
const M_OUTSIDER = '00000000-0000-0000-0000-0000000000c3';
const STUDENT = '00000000-0000-0000-0000-0000000000e1';
const SKILL = '00000000-0000-0000-0000-0000000000f1';
const SS = '00000000-0000-0000-0000-000000000101';
const EVID = '00000000-0000-0000-0000-000000000201';
const RUBRIC = '00000000-0000-0000-0000-000000000301';

let db: PGlite;

async function rejects(sql: string, params: unknown[] = [], pattern?: RegExp) {
  let err: Error | null = null;
  try { await db.query(sql, params); } catch (e) { err = e as Error; }
  expect(err, `expected failure for: ${sql}`).not.toBeNull();
  if (pattern) expect(err!.message).toMatch(pattern);
}

async function session(id: string, modality: string, outcome: string | null, completedAt: string | null) {
  await db.query(
    `INSERT INTO verification_sessions (id, student_skill_id, rubric_version_id, modality, completed_at, outcome)
     VALUES ($1, $2, $3, $4, $5, $6)`, [id, SS, RUBRIC, modality, completedAt, outcome]);
}

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`
    INSERT INTO organizations (id, kind, name) VALUES ('${ORG}', 'college', 'Test College'), ('${ORG2}', 'college', 'Other College');
    INSERT INTO departments (id, org_id, name, code) VALUES ('${DEPT}', '${ORG}', 'Computer Engineering', 'CE');
    INSERT INTO users (id, auth_subject, email, full_name) VALUES
      ('${U_STUDENT}', 'sub-s', 's@test.invalid', 'Student'),
      ('${U_MENTOR}', 'sub-m', 'm@test.invalid', 'Mentor'),
      ('${U_OUTSIDER}', 'sub-o', 'o@test.invalid', 'Outsider');
    INSERT INTO memberships (id, user_id, org_id, department_id, role) VALUES
      ('${M_STUDENT}', '${U_STUDENT}', '${ORG}', '${DEPT}', 'student'),
      ('${M_MENTOR}', '${U_MENTOR}', '${ORG}', '${DEPT}', 'mentor'),
      ('${M_OUTSIDER}', '${U_OUTSIDER}', '${ORG2}', NULL, 'mentor');
    INSERT INTO students (id, org_id, user_id, department_id, enrollment_no, graduating_year)
      VALUES ('${STUDENT}', '${ORG}', '${U_STUDENT}', '${DEPT}', 'E-001', 2027);
    INSERT INTO skills (id, canonical_name, category, description) VALUES ('${SKILL}', 'SQL', 'Data', 'Structured Query Language');
    INSERT INTO rubric_versions (id, skill_id, version_no, dimensions, levels) VALUES ('${RUBRIC}', '${SKILL}', 1, '[]', '[]');
    INSERT INTO student_skills (id, student_id, skill_id, state) VALUES ('${SS}', '${STUDENT}', '${SKILL}', 'evidence_linked');
    INSERT INTO evidence_items (id, student_id, kind, content_hash, status) VALUES ('${EVID}', '${STUDENT}', 'test_result', repeat('a', 64), 'accepted');
    INSERT INTO skill_evidence (student_skill_id, evidence_id) VALUES ('${SS}', '${EVID}');
  `);
}, 120_000);

describe('017 privacy fixes', () => {
  it('D1: a guardian consent inserted without a status is pending, not verified', async () => {
    const r = await db.query<{ status: string; verified_at: string | null }>(
      `INSERT INTO guardian_consents (student_id, guardian_name, relationship, verification_ref)
       VALUES ($1, 'Parent', 'mother', 'ref-1') RETURNING status, verified_at`, [STUDENT]);
    expect(r.rows[0]).toEqual({ status: 'pending', verified_at: null });
  });

  it('D1: verified requires a verifier, a method and a timestamp', async () => {
    await rejects(
      `INSERT INTO guardian_consents (student_id, guardian_name, relationship, verification_ref, status)
       VALUES ($1, 'Parent', 'father', 'ref-2', 'verified')`, [STUDENT], /chk_guardian_verified_requires_verifier/);
    await db.query(
      `INSERT INTO guardian_consents (student_id, guardian_name, relationship, verification_ref, status, verified_by, verification_method, verified_at)
       VALUES ($1, 'Parent', 'father', 'ref-3', 'verified', $2, 'digilocker', now())`, [STUDENT, M_MENTOR]);
  });

  it('D2: minor status is derived from date of birth', async () => {
    const dob = new Date(); dob.setFullYear(dob.getFullYear() - 17);
    await db.query(`UPDATE students SET date_of_birth = $1, is_minor = false WHERE id = $2`, [dob.toISOString().slice(0, 10), STUDENT]);
    const r = await db.query<{ m: boolean }>(`SELECT student_is_minor($1) AS m`, [STUDENT]);
    expect(r.rows[0].m).toBe(true);
    const v = await db.query<{ is_minor_effective: boolean; age_unverified: boolean }>(
      `SELECT is_minor_effective, age_unverified FROM student_age_status WHERE student_id = $1`, [STUDENT]);
    expect(v.rows[0]).toEqual({ is_minor_effective: true, age_unverified: false });
    await db.query(`UPDATE students SET date_of_birth = '2004-01-01' WHERE id = $1`, [STUDENT]);
  });

  it('D3/D5: fairness_monitoring purpose exists and every purpose has a retention period', async () => {
    const r = await db.query<{ code: string; retention_days: number | null }>(`SELECT code, retention_days FROM consent_purposes`);
    expect(r.rows.map(x => x.code)).toContain('fairness_monitoring');
    expect(r.rows.every(x => x.retention_days !== null)).toBe(true);
  });
});

describe('018 roles and taxonomy', () => {
  it('B11: accepts college_admin; dept_coordinator must have a department', async () => {
    await db.query(`INSERT INTO memberships (user_id, org_id, role) VALUES ($1, $2, 'college_admin')`, [U_MENTOR, ORG]);
    await rejects(`INSERT INTO memberships (user_id, org_id, role) VALUES ($1, $2, 'dept_coordinator')`, [U_OUTSIDER, ORG], /chk_dept_coordinator_has_department/);
    await rejects(`INSERT INTO memberships (user_id, org_id, role) VALUES ($1, $2, 'superhero')`, [U_OUTSIDER, ORG], /memberships_role_check/);
  });

  it('B11: RLS sees college_admin and dept_coordinator as officer; the exact role stays available', async () => {
    await db.query(`SELECT set_config('app.current_user_role', 'dept_coordinator', false)`);
    const r = await db.query<{ policy_role: string; exact: string }>(`SELECT current_app_user_role() AS policy_role, current_app_user_role_exact() AS exact`);
    expect(r.rows[0]).toEqual({ policy_role: 'officer', exact: 'dept_coordinator' });
    await db.query(`SELECT set_config('app.current_user_role', 'student', false)`);
    const s = await db.query<{ r: string }>(`SELECT current_app_user_role() AS r`);
    expect(s.rows[0].r).toBe('student');
  });

  it('B12: a confirmed framework mapping must carry a code', async () => {
    await rejects(`INSERT INTO skill_mappings (skill_id, framework, label, status) VALUES ($1, 'ESCO', 'SQL', 'confirmed')`, [SKILL], /chk_confirmed_mapping_has_code/);
    await db.query(`INSERT INTO skill_mappings (skill_id, framework, label) VALUES ($1, 'ESCO', 'SQL')`, [SKILL]);
  });
});

describe('019 skill state v2 trigger', () => {
  it('fixes the NULL-outcome bypass: an unfinished session cannot verify a skill', async () => {
    await session('00000000-0000-0000-0000-000000000401', 'test_score', null, null);
    await rejects(
      `UPDATE student_skills SET state = 'verified', last_verification_id = $1, valid_until = now() + interval '1 year', proof_level = 'L2_assessed' WHERE id = $2`,
      ['00000000-0000-0000-0000-000000000401', SS], /must be completed with outcome passed/);
  });

  it('requires proof_level to match the session modality', async () => {
    await session('00000000-0000-0000-0000-000000000402', 'test_score', 'passed', new Date().toISOString());
    await rejects(
      `UPDATE student_skills SET state = 'verified', last_verification_id = $1, valid_until = now() + interval '1 year', proof_level = 'L3_defended' WHERE id = $2`,
      ['00000000-0000-0000-0000-000000000402', SS], /does not match session modality/);
  });

  it('rejects evidence past its validity date', async () => {
    await db.query(`UPDATE evidence_items SET valid_until = now() - interval '1 day' WHERE id = $1`, [EVID]);
    await rejects(
      `UPDATE student_skills SET state = 'verified', last_verification_id = $1, valid_until = now() + interval '1 year', proof_level = 'L2_assessed' WHERE id = $2`,
      ['00000000-0000-0000-0000-000000000402', SS], /fresh accepted evidence/);
    await db.query(`UPDATE evidence_items SET valid_until = NULL WHERE id = $1`, [EVID]);
  });

  it('verifies with a matching completed session, then clears proof_level when the skill leaves verified', async () => {
    await db.query(
      `UPDATE student_skills SET state = 'verified', last_verification_id = $1, valid_until = now() + interval '1 year', proof_level = 'L2_assessed' WHERE id = $2`,
      ['00000000-0000-0000-0000-000000000402', SS]);
    await db.query(`UPDATE student_skills SET state = 'expired' WHERE id = $1`, [SS]);
    const r = await db.query<{ proof_level: string | null }>(`SELECT proof_level FROM student_skills WHERE id = $1`, [SS]);
    expect(r.rows[0].proof_level).toBeNull();
  });

  it('re-verifying an expired skill needs a session completed after the expiry', async () => {
    await rejects(
      `UPDATE student_skills SET state = 'verified', last_verification_id = $1, proof_level = 'L2_assessed' WHERE id = $2`,
      ['00000000-0000-0000-0000-000000000402', SS], /completed after the expiry/);

    await session('00000000-0000-0000-0000-000000000403', 'test_score', 'passed', new Date(Date.now() + 60_000).toISOString());
    await db.query(
      `UPDATE student_skills SET state = 'verified', last_verification_id = $1, proof_level = 'L2_assessed' WHERE id = $2`,
      ['00000000-0000-0000-0000-000000000403', SS]);
  });
});

describe('019 attestation guard (C4)', () => {
  const insertAttestation = (membership: string) => db.query(
    `INSERT INTO attestations (evidence_id, mentor_membership_id, rubric_version_id, scope_text, rubric_scores, valid_until)
     VALUES ($1, $2, $3, 'Lab: SQL query optimisation exercise', '{"accuracy": 3}', now() + interval '1 year')`,
    [EVID, membership, RUBRIC]);

  it('accepts an active mentor from the same college', async () => {
    await insertAttestation(M_MENTOR);
  });
  it('rejects a mentor from another college', async () => {
    await expect(insertAttestation(M_OUTSIDER)).rejects.toThrow(/must belong to the student's college/);
  });
  it('rejects a student attesting their own evidence', async () => {
    await expect(insertAttestation(M_STUDENT)).rejects.toThrow(/active mentor or officer/);
  });
});

describe('019 fairness stages and needs_review', () => {
  it('fairness_reviews accepts college_tier and a funnel stage; eligibility accepts needs_review', async () => {
    const c = await db.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname IN ('fairness_reviews_dimension_check', 'chk_fairness_reviews_stage', 'eligibility_decisions_result_check') ORDER BY conname`);
    const defs = c.rows.map(r => r.def).join(' ');
    expect(defs).toMatch(/college_tier/);
    expect(defs).toMatch(/shortlist/);
    expect(defs).toMatch(/needs_review/);
  });
});
