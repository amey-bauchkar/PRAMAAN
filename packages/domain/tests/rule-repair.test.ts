import { describe, it, expect } from 'vitest';
import { candidateEdits, candidateRepairs, rankRepairs, shortfallOf, RepairEvaluation } from '../src/rule-repair.js';
import { EligibilityRuleSpec } from '@pramaan/contracts';

const SQL = '10000000-0000-0000-0000-000000000002';
const rule = {
  academics: { minCgpa: 7.5, minTwelfthOrDiplomaPct: 75 }, backlogs: { maxActive: 0, maxHistory: 0 },
  branches: [], graduatingYears: [2027], skills: [{ skillId: SQL, name: 'SQL', minLevel: 2, minProof: 'L3' }], policy: {},
} as unknown as EligibilityRuleSpec;

describe('Fairness rule repair', () => {
  it('only relaxes thresholds and never removes a required skill', () => {
    const edits = candidateEdits(rule);
    expect(edits.map(e => e.id)).toEqual(expect.arrayContaining(['cgpa-0.25', 'twelfth-10', 'history+1', `proof-${SQL}`, `level-${SQL}`]));
    for (const c of candidateRepairs(rule)) {
      expect(c.rules.skills.map(s => s.skillId)).toEqual([SQL]);
      expect(c.rules.academics.minCgpa).toBeGreaterThanOrEqual(5);
    }
    expect(edits.find(e => e.id === `proof-${SQL}`)!.touchesSkills).toBe(true);
    expect(edits.find(e => e.id === 'twelfth-10')!.apply(rule).academics.minTwelfthOrDiplomaPct).toBe(65);
  });

  it('can relax two cutoffs that bind together by any step, e.g. 10th and 12th marks both by 15', () => {
    const both = { ...rule, academics: { minTenthPct: 80, minTwelfthOrDiplomaPct: 80 } } as unknown as EligibilityRuleSpec;
    const ids = candidateRepairs(both).filter(c => c.edits.length === 2).map(c => c.edits.map(e => e.id).sort().join('+'));
    expect(ids).toContain('tenth-15+twelfth-15');
    expect(ids).toContain('tenth-10+twelfth-5');
  });

  it('pairs combine different knobs only', () => {
    const pairs = candidateRepairs(rule).filter(c => c.edits.length === 2);
    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs.every(p => p.edits[0].id.split('-')[0] !== p.edits[1].id.split('-')[0])).toBe(true);
  });

  it('prefers the cheapest edit that removes adverse impact, non-skill edits first at equal cost', () => {
    const ev = (ids: string[], adverse: string[], eligible: number, shortfall: number): RepairEvaluation => {
      const edits = candidateEdits(rule).filter(e => ids.includes(e.id));
      return { edits, rules: rule, eligible, minImpactRatio: adverse.length ? 0.6 : 0.85, adverseDimensions: adverse, shortfall };
    };
    const ranked = rankRepairs({ eligible: 40, shortfall: 6 }, [
      ev(['twelfth-15'], [], 70, 0), ev(['twelfth-5'], ['category'], 50, 3), ev(['twelfth-10'], [], 60, 0), ev([`proof-${SQL}`], [], 80, 0),
    ]);
    expect(ranked[0].description[0]).toMatch(/to 65%/);
    expect(ranked[0].fixesAdverseImpact).toBe(true);
    expect(ranked[0].eligibleChange).toBe(20);
    expect(ranked.some(r => r.description[0].includes('75% to 70%'))).toBe(false);
  });

  it('when nothing fully fixes it, ranks partial fixes by how much they raise the lowest ratio, not by head-count shortfall', () => {
    const edits = candidateEdits(rule);
    const base = { eligible: 3, shortfall: 2, minImpactRatio: 0.2, adverseDimensions: ['category'] };
    const ranked = rankRepairs(base, [
      // A tiny pool: small shortfall only because almost nobody qualifies. Ratio barely moves.
      { edits: [edits[0]], rules: rule, eligible: 4, minImpactRatio: 0.22, adverseDimensions: ['category'], shortfall: 1 },
      // A real improvement: many more qualify and the lowest ratio rises a lot, though the head-count gap is larger.
      { edits: [edits[1]], rules: rule, eligible: 40, minImpactRatio: 0.65, adverseDimensions: ['category'], shortfall: 8 },
      { edits: [edits[2]], rules: rule, eligible: 30, minImpactRatio: 0.4, adverseDimensions: ['category'], shortfall: 6 },
    ]);
    expect(ranked).toHaveLength(2);
    expect(ranked[0].eligible).toBe(40);
    expect(ranked[0].fixesAdverseImpact).toBe(false);
  });

  it('shortfall counts the people needed to reach four-fifths of the reference rate', () => {
    expect(shortfallOf([{ total: 100, selected: 60, compared: true }, { total: 50, selected: 15, compared: true }])).toBe(9);
    expect(shortfallOf([{ total: 100, selected: 60, compared: true }, { total: 3, selected: 0, compared: false }])).toBe(0);
  });
});
