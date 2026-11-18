import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { EligibilityEvaluator } from '../src/eligibility-evaluator.js';
import { reasonText, hasTemplate, REASON_KEYS } from '../../../apps/web/lib/i18n.js';

const evaluatorSrc = readFileSync(path.resolve(__dirname, '../src/eligibility-evaluator.ts'), 'utf8');
const emittedKeys = [...new Set([...evaluatorSrc.matchAll(/'([a-z]+\.(?:pass|fail|missing|level|proof|expires))'|'(hold)'/g)].map(m => m[1] ?? m[2]))];

const SQL = '00000000-0000-4000-8000-0000000000aa';
const version = (rules: any) => ({ id: '00000000-0000-4000-8000-000000000001', ruleSetId: '00000000-0000-4000-8000-000000000002', versionNo: 1, rules, rationale: 'x', publishedBy: '00000000-0000-4000-8000-000000000003', publishedAt: '2026-11-01T00:00:00.000Z' }) as any;
const snapshot: any = {
  studentId: '00000000-0000-4000-8000-000000000004', cgpa: 6.8, tenthPct: 72, twelfthPct: 64, diplomaPct: null, gapYears: 0,
  activeBacklogs: 1, backlogHistory: 2, branch: 'ME', graduatingYear: 2027, offersHeld: 0, highestOfferCtcInr: null, disciplinaryHold: false,
  skills: [{ skillId: SQL, name: 'SQL', state: 'evidence_linked', level: 1, proofLevel: null, validUntil: null }],
};

describe('Eligibility reasons in Hindi and Marathi', () => {
  it('has a Hindi and a Marathi template for every reason key the evaluator can emit', () => {
    expect(emittedKeys.length).toBeGreaterThan(25);
    for (const k of emittedKeys) {
      expect(hasTemplate('hi', k), `hi: ${k}`).toBe(true);
      expect(hasTemplate('mr', k), `mr: ${k}`).toBe(true);
    }
    expect([...REASON_KEYS].sort()).toEqual([...emittedKeys].sort());
  });

  it('renders the same decision with the real values, and English stays the stored message', () => {
    const res = EligibilityEvaluator.evaluate(snapshot, version({
      academics: { minCgpa: 7, minTwelfthOrDiplomaPct: 60 }, backlogs: { maxActive: 0 }, branches: ['CSE', 'IT'], graduatingYears: [2027],
      skills: [{ skillId: SQL, name: 'SQL', minLevel: 1, minProof: 'L2' }], policy: {},
    }), { now: '2026-11-17T00:00:00.000Z' });
    const by = (id: string) => res.checks.find(c => c.id === id)!;
    expect(reasonText(by('academics.minCgpa'), 'en')).toBe(by('academics.minCgpa').message);
    expect(reasonText(by('academics.minCgpa'), 'hi')).toBe('CGPA 6.8 न्यूनतम 7 से कम है।');
    expect(reasonText(by('academics.minCgpa'), 'mr')).toBe('CGPA 6.8 किमान 7 पेक्षा कमी आहे.');
    expect(reasonText(by('branch'), 'hi')).toContain('CSE, IT');
    expect(reasonText(by(`skills.${SQL}`), 'mr')).toContain('पुरावा जोडला, सत्यापन बाकी');
    for (const c of res.checks) for (const l of ['hi', 'mr'] as const) expect(reasonText(c, l)).not.toMatch(/\{\w+\}/);
  });

  it('falls back to English for a check stored before templates existed', () => {
    expect(reasonText({ message: 'Old reason.' }, 'hi')).toBe('Old reason.');
  });
});

describe('Proof Path timing line in Hindi and Marathi', () => {
  it('builds the line from the same facts the English summary uses', async () => {
    const { timingText } = await import('../../../apps/web/lib/i18n.js');
    const t = { summary: 'About 3.5 hours (2 days at 2 h/day): you can finish before all of these drives.', estHours: 3.5, daysNeeded: 2, hoursPerDay: 2, inTimeCount: 1, drives: [{}, {}] };
    expect(timingText(t, 'en')).toBe(t.summary);
    expect(timingText(t, 'hi')).toBe('लगभग 3.5 घंटे (2 दिन): 2 में से 1 ड्राइव के लिए समय पर।');
    expect(timingText({ ...t, inTimeCount: 2 }, 'mr')).toMatch(/^सुमारे 3.5 तास \(2 दिवस, दररोज 2 तास\)/);
  });
});
