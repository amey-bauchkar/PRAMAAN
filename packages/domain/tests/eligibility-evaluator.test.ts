import { describe, it, expect } from 'vitest';
import { EligibilityEvaluator } from '../src/eligibility-evaluator.js';
import { ProofPath, DriveRuleContext } from '../src/proof-path.js';
import { EligibilityRuleVersion, StudentAcademicSnapshot, EligibilityRuleSpec } from '@pramaan/contracts';

const NOW = '2026-11-16T00:00:00.000Z';
const PY = '10000000-0000-0000-0000-000000000001';
const SQL = '10000000-0000-0000-0000-000000000002';
const DOCKER = '10000000-0000-0000-0000-000000000003';

function rule(rules: Partial<EligibilityRuleSpec>, id = '99999999-9999-9999-9999-999999999999'): EligibilityRuleVersion {
  return {
    id,
    ruleSetId: '88888888-8888-8888-8888-888888888888',
    versionNo: 1,
    rules: rules as EligibilityRuleSpec,
    rationale: 'Software engineering drive criteria',
    publishedBy: '77777777-7777-7777-7777-777777777777',
    publishedAt: '2026-11-06T00:00:00.000Z',
  };
}

function student(over: Partial<StudentAcademicSnapshot> = {}): StudentAcademicSnapshot {
  return {
    studentId: 'std-1',
    cgpa: 8.4,
    tenthPct: 88,
    twelfthPct: 79,
    diplomaPct: null,
    gapYears: 0,
    activeBacklogs: 0,
    backlogHistory: 0,
    branch: 'Computer Science',
    graduatingYear: 2027,
    skills: [
      { skillId: PY, name: 'Python', state: 'verified', level: 2, proofLevel: 'L2_assessed', validUntil: '2027-10-01T00:00:00.000Z' },
      { skillId: SQL, name: 'SQL', state: 'verified', level: 2, proofLevel: 'L1_code_backed', validUntil: '2027-10-01T00:00:00.000Z' },
    ],
    offersHeld: 0,
    highestOfferCtcInr: null,
    disciplinaryHold: false,
    ...over,
  };
}

const sweRule = rule({
  academics: { minCgpa: 7.5, minTenthPct: 60, minTwelfthOrDiplomaPct: 60, maxGapYears: 1 },
  backlogs: { maxActive: 0, maxHistory: 2 },
  branches: ['Computer Science', 'Information Technology'],
  graduatingYears: [2027],
  skills: [
    { skillId: PY, name: 'Python', minLevel: 2, minProof: 'L2' },
    { skillId: SQL, name: 'SQL', minLevel: 1, minProof: 'L1' },
  ],
  policy: { maxOffersHeld: 0 },
});

describe('EligibilityEvaluator v2', () => {
  it('marks a fully compliant candidate eligible with CRITERIA_MET and a pass line for every check', () => {
    const r = EligibilityEvaluator.evaluate(student(), sweRule, { now: NOW });
    expect(r.status).toBe('eligible');
    expect(r.eligible).toBe(true);
    expect(r.reasonCodes).toEqual(['CRITERIA_MET']);
    expect(r.checks.every(c => c.passed === true)).toBe(true);
    expect(r.evaluatedAt).toBe(NOW);
  });

  it('reports every failed rule with its own reason code and plain-language message', () => {
    const r = EligibilityEvaluator.evaluate(student({ cgpa: 6.9, activeBacklogs: 2, branch: 'Mechanical' }), sweRule, { now: NOW });
    expect(r.status).toBe('ineligible');
    expect(r.reasonCodes).toEqual(expect.arrayContaining(['INSUFFICIENT_CGPA', 'EXCESSIVE_BACKLOGS', 'BRANCH_INELIGIBLE']));
    expect(EligibilityEvaluator.explain(r)[0]).toMatch(/^Fail: /);
    expect(r.checks.find(c => c.id === 'academics.minCgpa')?.message).toBe('CGPA 6.9 is below the minimum 7.5.');
  });

  it('accepts diploma marks in place of 12th marks', () => {
    const r = EligibilityEvaluator.evaluate(student({ twelfthPct: null, diplomaPct: 72 }), sweRule, { now: NOW });
    expect(r.status).toBe('eligible');
  });

  it('missing institutional data gives needs_review, never a silent pass or fail', () => {
    const r = EligibilityEvaluator.evaluate(student({ cgpa: null }), sweRule, { now: NOW });
    expect(r.status).toBe('needs_review');
    expect(r.reasonCodes).toContain('MISSING_DATA');
  });

  it('a disciplinary hold routes to an officer instead of auto-rejecting', () => {
    const r = EligibilityEvaluator.evaluate(student({ disciplinaryHold: true }), sweRule, { now: NOW });
    expect(r.status).toBe('needs_review');
    expect(r.reasonCodes).toEqual(['DISCIPLINARY_HOLD']);
  });

  it('a failed rule outranks missing data: ineligible, with both reasons listed', () => {
    const r = EligibilityEvaluator.evaluate(student({ cgpa: null, branch: 'Civil' }), sweRule, { now: NOW });
    expect(r.status).toBe('ineligible');
    expect(r.reasonCodes).toEqual(expect.arrayContaining(['MISSING_DATA', 'BRANCH_INELIGIBLE']));
  });

  it('matches skills by id and checks level, proof level and expiry at the drive date', () => {
    const lowProof = EligibilityEvaluator.evaluate(student({
      skills: [{ skillId: PY, name: 'Python', state: 'verified', level: 2, proofLevel: 'L1_code_backed' }, student().skills[1]],
    }), sweRule, { now: NOW });
    expect(lowProof.reasonCodes).toEqual(['SKILL_PROOF_LEVEL_TOO_LOW']);

    const lowLevel = EligibilityEvaluator.evaluate(student({
      skills: [{ skillId: PY, name: 'Python', state: 'verified', level: 1, proofLevel: 'L3_defended' }, student().skills[1]],
    }), sweRule, { now: NOW });
    expect(lowLevel.reasonCodes).toEqual(['SKILL_LEVEL_TOO_LOW']);

    const expiresBeforeDrive = EligibilityEvaluator.evaluate(student(), sweRule, { now: NOW, driveStartsAt: '2027-11-01T00:00:00.000Z' });
    expect(expiresBeforeDrive.reasonCodes).toEqual(['SKILL_EXPIRES_BEFORE_DRIVE']);

    const sameNameDifferentId = EligibilityEvaluator.evaluate(student({
      skills: [{ skillId: DOCKER, name: 'Python', state: 'verified', level: 3, proofLevel: 'L3_defended' }, student().skills[1]],
    }), sweRule, { now: NOW });
    expect(sameNameDifferentId.missingSkills).toEqual(['Python']);
  });

  it('enforces placement policy limits', () => {
    const offerHeld = EligibilityEvaluator.evaluate(student({ offersHeld: 1, highestOfferCtcInr: 450000 }), sweRule, { now: NOW });
    expect(offerHeld.reasonCodes).toEqual(['OFFER_LIMIT_REACHED']);

    const dream = rule({ policy: { maxOffersHeld: 1, blockIfPlacedAtOrAboveCtcInr: 600000 } });
    expect(EligibilityEvaluator.evaluate(student({ offersHeld: 1, highestOfferCtcInr: 450000 }), dream, { now: NOW }).status).toBe('eligible');
    expect(EligibilityEvaluator.evaluate(student({ offersHeld: 1, highestOfferCtcInr: 800000 }), dream, { now: NOW }).reasonCodes)
      .toEqual(['ALREADY_PLACED_AT_OR_ABOVE_CTC']);
  });

  it('input hash is deterministic, independent of skill order, and changes with any input or rule', () => {
    const a = EligibilityEvaluator.evaluate(student(), sweRule, { now: NOW });
    const reordered = EligibilityEvaluator.evaluate(student({ skills: [...student().skills].reverse() }), sweRule, { now: NOW });
    const changed = EligibilityEvaluator.evaluate(student({ cgpa: 8.5 }), sweRule, { now: NOW });
    expect(a.inputHash).toHaveLength(64);
    expect(reordered.inputHash).toBe(a.inputHash);
    expect(changed.inputHash).not.toBe(a.inputHash);
  });
});

describe('ProofPath counterfactual eligibility', () => {
  const sqlL2 = (id: string, title: string): DriveRuleContext => ({
    driveId: id, title,
    ruleVersion: rule({ skills: [{ skillId: SQL, name: 'SQL', minLevel: 1, minProof: 'L2' }] }, `9999999${id.slice(-1)}-9999-9999-9999-999999999999`),
  });
  const drives: DriveRuleContext[] = [
    sqlL2('d1', 'Backend A'),
    sqlL2('d2', 'Backend B'),
    { driveId: 'd3', title: 'DevOps', ruleVersion: rule({ skills: [{ skillId: DOCKER, name: 'Docker', minLevel: 1, minProof: 'L1' }] }, '99999993-9999-9999-9999-999999999999') },
    { driveId: 'd4', title: 'Mech only', ruleVersion: rule({ branches: ['Mechanical'], skills: [{ skillId: SQL, name: 'SQL', minLevel: 1, minProof: 'L2' }] }, '99999994-9999-9999-9999-999999999999') },
    { driveId: 'd5', title: 'Python', ruleVersion: rule({ skills: [{ skillId: PY, name: 'Python', minLevel: 1, minProof: 'L1' }] }, '99999995-9999-9999-9999-999999999999') },
  ];

  it('ranks the single proof that unlocks the most drives, and keeps non-proof blockers separate', () => {
    const path = ProofPath.forStudent(student(), drives, { now: NOW });
    expect(path.eligibleDriveIds).toEqual(['d5']);
    expect(path.actions[0]).toMatchObject({ skillId: SQL, targetProof: 'L2', unlocksCount: 2, unlocksDriveIds: ['d1', 'd2'] });
    expect(path.actions[1]).toMatchObject({ skillId: DOCKER, unlocksCount: 1 });
    const mech = path.drives.find(d => d.driveId === 'd4')!;
    expect(mech.otherBlockers[0]).toMatch(/Branch Computer Science is not in the eligible list/);
  });

  it('ranks cohort interventions by eligibilities gained', () => {
    const cohort = [
      student({ studentId: 's1' }),
      student({ studentId: 's2' }),
      student({ studentId: 's3', skills: [student().skills[0], { ...student().skills[1], proofLevel: 'L2_assessed' }] }),
    ];
    const ranking = ProofPath.rankInterventions(cohort, drives, { now: NOW });
    expect(ranking[0]).toMatchObject({ skillId: SQL, studentsAffected: 2, eligibilitiesGained: 4 });
    expect(ranking[1]).toMatchObject({ skillId: DOCKER, studentsAffected: 3, eligibilitiesGained: 3 });
  });
});
