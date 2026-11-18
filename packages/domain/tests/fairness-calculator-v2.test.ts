import { describe, it, expect } from 'vitest';
import { FairnessCalculator, FunnelRecord, fisherExactTwoSided, StudentDemographicRecord } from '../src/fairness-calculator.js';

const RV = '99999999-9999-9999-9999-999999999999';
const make = (group: string, selected: number, rejected: number): StudentDemographicRecord[] => [
  ...Array.from({ length: selected }, (_, i) => ({ studentId: `${group}-s${i}`, groupValue: group, eligible: true })),
  ...Array.from({ length: rejected }, (_, i) => ({ studentId: `${group}-r${i}`, groupValue: group, eligible: false })),
];

describe("Fisher's exact test", () => {
  it('matches the textbook value for [[1,9],[11,3]] (two-sided p ≈ 0.002759)', () => {
    expect(fisherExactTwoSided(1, 9, 11, 3)).toBeCloseTo(0.002759, 5);
  });
  it('returns 1 for identical proportions', () => {
    expect(fisherExactTwoSided(5, 5, 5, 5)).toBeCloseTo(1, 6);
  });
});

describe('FairnessCalculator v2 (C8, B8)', () => {
  it('excludes "Prefer not to say" from comparison and from being the reference group', () => {
    const report = FairnessCalculator.computeFairness(
      [...make('Male', 16, 4), ...make('Female', 14, 6), ...make('Prefer not to say', 10, 0)],
      'gender', RV
    );
    expect(report.referenceGroup).toBe('Male');
    expect(report.groups['Prefer not to say'].excludedFromComparison).toBe(true);
    expect(report.groups['Prefer not to say'].impactRatio).toBeNull();
    expect(report.notes.join(' ')).toMatch(/10 candidate\(s\) did not disclose gender/);
  });

  it('reports a Fisher p-value next to the impact ratio for each compared group', () => {
    const report = FairnessCalculator.computeFairness([...make('General', 16, 4), ...make('Reserved', 10, 10)], 'category', RV);
    expect(report.groups['Reserved'].impactRatio).toBe(0.625);
    expect(report.groups['Reserved'].fisherPValue).toBeGreaterThan(0);
    expect(report.groups['General'].fisherPValue).toBeNull(); // reference group
    expect(report.adverseImpactDetected).toBe(true);
  });

  it('supports college tier and warns when the reference group is small', () => {
    const report = FairnessCalculator.computeFairness([...make('Tier 1', 6, 1), ...make('Tier 2', 20, 30)], 'college_tier', RV);
    expect(report.dimension).toBe('college_tier');
    expect(report.notes.join(' ')).toMatch(/Reference group "Tier 1" has only 7 candidates/);
  });

  it('computes conditional rates at each funnel stage', () => {
    const rec = (g: string, n: number, e: number, s: number, o: number): FunnelRecord[] =>
      Array.from({ length: n }, (_, i) => ({ studentId: `${g}${i}`, groupValue: g, eligible: i < e, shortlisted: i < s, offered: i < o }));
    const funnel = FairnessCalculator.computeFunnel([...rec('CSE', 40, 30, 20, 10), ...rec('ENTC', 40, 30, 6, 3)], 'branch', RV);

    expect(funnel.eligibility.adverseImpactDetected).toBe(false);
    expect(funnel.shortlist.stage).toBe('shortlist');
    expect(funnel.shortlist.groups['ENTC'].totalCandidates).toBe(30);
    expect(funnel.shortlist.groups['ENTC'].impactRatio).toBe(0.3);
    expect(funnel.shortlist.adverseImpactDetected).toBe(true);
    expect(funnel.offer.groups['CSE'].selectionRate).toBe(0.5);
  });
});
