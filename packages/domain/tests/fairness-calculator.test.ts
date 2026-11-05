import { describe, it, expect } from 'vitest';
import { FairnessCalculator, StudentDemographicRecord } from '../src/fairness-calculator.js';

describe('FairnessCalculator 4/5ths Rule & Policy Verification', () => {
  const ruleVersionId = '99999999-9999-9999-9999-999999999999';

  it('calculates selection rate and impact ratio accurately', () => {
    // 20 Males (16 eligible -> 80%), 20 Females (14 eligible -> 70%)
    const records: StudentDemographicRecord[] = [
      ...Array(16).fill(null).map((_, i) => ({ studentId: `m-e-${i}`, groupValue: 'Male', eligible: true })),
      ...Array(4).fill(null).map((_, i) => ({ studentId: `m-i-${i}`, groupValue: 'Male', eligible: false })),
      ...Array(14).fill(null).map((_, i) => ({ studentId: `f-e-${i}`, groupValue: 'Female', eligible: true })),
      ...Array(6).fill(null).map((_, i) => ({ studentId: `f-i-${i}`, groupValue: 'Female', eligible: false })),
    ];

    const report = FairnessCalculator.computeFairness(records, 'gender', ruleVersionId);

    expect(report.highestSelectionRate).toBe(0.8);
    expect(report.groups['Male'].selectionRate).toBe(0.8);
    expect(report.groups['Male'].impactRatio).toBe(1.0);
    expect(report.groups['Female'].selectionRate).toBe(0.7);
    expect(report.groups['Female'].impactRatio).toBe(0.875);
    expect(report.adverseImpactDetected).toBe(false);
    expect(report.policyNote).toContain('PROPOSED POLICY');
  });

  it('detects adverse impact when group impact ratio is below 0.80', () => {
    const records: StudentDemographicRecord[] = [
      ...Array(16).fill(null).map((_, i) => ({ studentId: `a-e-${i}`, groupValue: 'General', eligible: true })),
      ...Array(4).fill(null).map((_, i) => ({ studentId: `a-i-${i}`, groupValue: 'General', eligible: false })),
      ...Array(10).fill(null).map((_, i) => ({ studentId: `b-e-${i}`, groupValue: 'Reserved', eligible: true })),
      ...Array(10).fill(null).map((_, i) => ({ studentId: `b-i-${i}`, groupValue: 'Reserved', eligible: false })),
    ];

    const report = FairnessCalculator.computeFairness(records, 'category', ruleVersionId);

    expect(report.highestSelectionRate).toBe(0.8);
    expect(report.groups['Reserved'].selectionRate).toBe(0.5);
    expect(report.groups['Reserved'].impactRatio).toBe(0.625);
    expect(report.adverseImpactDetected).toBe(true);
  });

  it('suppresses small groups with size less than configurable minGroupSize', () => {
    const records: StudentDemographicRecord[] = [
      ...Array(10).fill(null).map((_, i) => ({ studentId: `cse-${i}`, groupValue: 'CSE', eligible: true })),
      ...Array(4).fill(null).map((_, i) => ({ studentId: `min-${i}`, groupValue: 'Mining', eligible: false })),
    ];

    // Configurable threshold set to 5
    const report = FairnessCalculator.computeFairness(records, 'branch', ruleVersionId, 5);

    expect(report.groups['CSE'].isSuppressed).toBe(false);
    expect(report.groups['Mining'].isSuppressed).toBe(true);
    expect(report.groups['Mining'].impactRatio).toBeNull();
  });

  it('handles empty cohort gracefully with zero selection rates and no crashes', () => {
    const report = FairnessCalculator.computeFairness([], 'gender', ruleVersionId);
    expect(report.highestSelectionRate).toBe(0);
    expect(report.groups).toEqual({});
    expect(report.adverseImpactDetected).toBe(false);
  });

  it('handles cohort where 0 candidates are eligible across all groups', () => {
    const records: StudentDemographicRecord[] = [
      ...Array(10).fill(null).map((_, i) => ({ studentId: `m-${i}`, groupValue: 'Male', eligible: false })),
      ...Array(10).fill(null).map((_, i) => ({ studentId: `f-${i}`, groupValue: 'Female', eligible: false })),
    ];

    const report = FairnessCalculator.computeFairness(records, 'gender', ruleVersionId);
    expect(report.highestSelectionRate).toBe(0);
    expect(report.groups['Male'].selectionRate).toBe(0);
    expect(report.groups['Male'].impactRatio).toBeNull();
    expect(report.adverseImpactDetected).toBe(false);
  });
});
