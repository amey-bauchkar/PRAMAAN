import { describe, it, expect } from 'vitest';
import { EligibilityEvaluator } from '../src/eligibility-evaluator.js';
import { ProofPath, DriveRuleContext } from '../src/proof-path.js';
import { FairnessCalculator } from '../src/fairness-calculator.js';
import { StudentAcademicSnapshot, EligibilityRuleVersion } from '@pramaan/contracts';

/**
 * Phase 3 load check: a university-scale batch (5,000 students × 12 drives) through the eligibility
 * engine, Proof Path cohort ranking and fairness. Budgets are generous for CI machines; the point is to
 * catch accidental quadratic behaviour.
 */
const NOW = '2026-11-16T00:00:00.000Z';
const SKILLS = Array.from({ length: 30 }, (_, i) => `10000000-0000-0000-0000-${String(i).padStart(12, '0')}`);
const BRANCHES = ['CSE', 'IT', 'ENTC', 'MECH', 'CIVIL', 'EE'];

function rng(seed: number) { let s = seed; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; }

function cohort(n: number): StudentAcademicSnapshot[] {
  const r = rng(42);
  return Array.from({ length: n }, (_, i) => ({
    studentId: `s${i}`, cgpa: Math.round((5 + r() * 5) * 100) / 100, tenthPct: 55 + r() * 40, twelfthPct: 55 + r() * 40, diplomaPct: null,
    gapYears: r() < 0.9 ? 0 : 1, activeBacklogs: r() < 0.8 ? 0 : 1, backlogHistory: r() < 0.8 ? 0 : 2,
    branch: BRANCHES[i % BRANCHES.length], graduatingYear: 2027,
    skills: SKILLS.filter(() => r() < 0.3).map(id => ({ skillId: id, name: id.slice(-3), state: r() < 0.6 ? 'verified' : 'evidence_linked', level: 1 + Math.floor(r() * 3),
      proofLevel: (['L1_code_backed', 'L2_assessed', 'L3_defended'] as const)[Math.floor(r() * 3)], validUntil: '2027-12-01T00:00:00.000Z' })),
    offersHeld: 0, highestOfferCtcInr: null, disciplinaryHold: false,
  }));
}

function drives(n: number): DriveRuleContext[] {
  return Array.from({ length: n }, (_, i) => ({
    driveId: `d${i}`, startsAt: '2027-01-15T00:00:00.000Z',
    ruleVersion: {
      id: `99999999-9999-9999-9999-${String(i).padStart(12, '0')}`, ruleSetId: '88888888-8888-8888-8888-888888888888', versionNo: 1,
      rules: { schemaVersion: 2, academics: { minCgpa: 6 + (i % 3) * 0.5, minTenthPct: 60 }, backlogs: { maxActive: 0 }, branches: [BRANCHES[i % 6], BRANCHES[(i + 1) % 6]],
        graduatingYears: [2027], skills: [{ skillId: SKILLS[i % 30], name: `k${i}`, minLevel: 1, minProof: 'L2' }, { skillId: SKILLS[(i + 7) % 30], name: `k${i + 7}`, minLevel: 1, minProof: 'L1' }], policy: {} },
      rationale: 'load test', publishedBy: '77777777-7777-7777-7777-777777777777', publishedAt: NOW,
    } as unknown as EligibilityRuleVersion,
  }));
}

describe('Load: 5,000 students', () => {
  const students = cohort(5000);
  const ds = drives(12);

  it('evaluates 60,000 eligibility decisions within budget', () => {
    const t0 = performance.now();
    let eligible = 0;
    for (const d of ds) for (const s of students) if (EligibilityEvaluator.evaluate(s, d.ruleVersion, { now: NOW, driveStartsAt: d.startsAt }).eligible) eligible++;
    const ms = performance.now() - t0;
    expect(eligible).toBeGreaterThan(0);
    expect(ms).toBeLessThan(30_000);
  }, 60_000);

  it('ranks cohort interventions (Proof Path) within budget', () => {
    const t0 = performance.now();
    const ranking = ProofPath.rankInterventions(students.slice(0, 2000), ds, { now: NOW });
    expect(ranking.length).toBeGreaterThan(0);
    expect(performance.now() - t0).toBeLessThan(60_000);
  }, 120_000);

  it('computes funnel fairness for 5,000 records quickly', () => {
    const t0 = performance.now();
    const rep = FairnessCalculator.computeFunnel(students.map((s, i) => ({ studentId: s.studentId, groupValue: s.branch, eligible: i % 2 === 0, shortlisted: i % 4 === 0, offered: i % 8 === 0 })), 'branch', '00000000-0000-0000-0000-000000000000');
    expect(Object.keys(rep.eligibility.groups)).toHaveLength(6);
    expect(performance.now() - t0).toBeLessThan(2_000);
  });
});
