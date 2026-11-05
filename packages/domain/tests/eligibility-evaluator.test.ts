import { describe, it, expect } from 'vitest';
import { EligibilityEvaluator } from '../src/eligibility-evaluator.js';
import { EligibilityRuleVersion, StudentAcademicSnapshot } from '@pramaan/contracts';

describe('EligibilityEvaluator Deterministic Rules Engine', () => {
  const sampleRuleVersion: EligibilityRuleVersion = {
    id: '99999999-9999-9999-9999-999999999999',
    ruleSetId: '88888888-8888-8888-8888-888888888888',
    versionNo: 1,
    rules: {
      minCgpa: 7.5,
      maxBacklogs: 0,
      allowedBranches: ['Computer Science', 'Information Technology'],
      graduatingYears: [2027],
      requiredSkills: ['Python', 'SQL']
    },
    rationale: 'Core technical criteria for 2027 Software Engineering campus drive',
    publishedBy: '77777777-7777-7777-7777-777777777777',
    publishedAt: '2026-11-06T00:00:00.000Z'
  };

  it('marks a fully compliant candidate as eligible with CRITERIA_MET', () => {
    const student: StudentAcademicSnapshot = {
      studentId: 'std-1',
      cgpa: 8.4,
      activeBacklogs: 0,
      branch: 'Computer Science',
      graduatingYear: 2027,
      verifiedSkillNames: ['Python', 'SQL', 'Docker']
    };

    const result = EligibilityEvaluator.evaluate(student, sampleRuleVersion);
    expect(result.eligible).toBe(true);
    expect(result.status).toBe('eligible');
    expect(result.reasonCodes).toEqual(['CRITERIA_MET']);
    expect(result.missingSkills).toHaveLength(0);
    expect(result.inputHash).toBeDefined();
  });

  it('identifies INSUFFICIENT_CGPA when CGPA is below threshold', () => {
    const student: StudentAcademicSnapshot = {
      studentId: 'std-2',
      cgpa: 7.1, // < 7.5
      activeBacklogs: 0,
      branch: 'Computer Science',
      graduatingYear: 2027,
      verifiedSkillNames: ['Python', 'SQL']
    };

    const result = EligibilityEvaluator.evaluate(student, sampleRuleVersion);
    expect(result.eligible).toBe(false);
    expect(result.status).toBe('ineligible');
    expect(result.reasonCodes).toContain('INSUFFICIENT_CGPA');
  });

  it('identifies EXCESSIVE_BACKLOGS and BRANCH_INELIGIBLE concurrently', () => {
    const student: StudentAcademicSnapshot = {
      studentId: 'std-3',
      cgpa: 8.0,
      activeBacklogs: 2, // > 0
      branch: 'Mechanical Engineering', // not in allowedBranches
      graduatingYear: 2027,
      verifiedSkillNames: ['Python', 'SQL']
    };

    const result = EligibilityEvaluator.evaluate(student, sampleRuleVersion);
    expect(result.eligible).toBe(false);
    expect(result.reasonCodes).toContain('EXCESSIVE_BACKLOGS');
    expect(result.reasonCodes).toContain('BRANCH_INELIGIBLE');
  });

  it('identifies MISSING_REQUIRED_VERIFIED_SKILLS and lists missing skills', () => {
    const student: StudentAcademicSnapshot = {
      studentId: 'std-4',
      cgpa: 8.5,
      activeBacklogs: 0,
      branch: 'Information Technology',
      graduatingYear: 2027,
      verifiedSkillNames: ['JavaScript', 'HTML'] // Missing Python and SQL
    };

    const result = EligibilityEvaluator.evaluate(student, sampleRuleVersion);
    expect(result.eligible).toBe(false);
    expect(result.reasonCodes).toContain('MISSING_REQUIRED_VERIFIED_SKILLS');
    expect(result.missingSkills).toEqual(['Python', 'SQL']);
  });

  it('computes identical inputHash for identical inputs', () => {
    const studentA: StudentAcademicSnapshot = {
      studentId: 'std-5',
      cgpa: 9.0,
      activeBacklogs: 0,
      branch: 'Computer Science',
      graduatingYear: 2027,
      verifiedSkillNames: ['SQL', 'Python'] // Reversed order
    };

    const studentB: StudentAcademicSnapshot = {
      studentId: 'std-5',
      cgpa: 9.0,
      activeBacklogs: 0,
      branch: 'Computer Science',
      graduatingYear: 2027,
      verifiedSkillNames: ['Python', 'SQL']
    };

    const hashA = EligibilityEvaluator.computeInputHash(studentA, sampleRuleVersion.id);
    const hashB = EligibilityEvaluator.computeInputHash(studentB, sampleRuleVersion.id);
    expect(hashA).toBe(hashB);
  });
});

