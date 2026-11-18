/**
 * Fairness repair for eligibility rules ("less discriminatory alternative" search).
 *
 * Given a draft rule that shows adverse impact, enumerate small, neutral edits to its thresholds, evaluate
 * each, and return the cheapest edits that bring every compared group to an impact ratio ≥ 0.80.
 * Job-related skill requirements are never removed; at most their proof level or skill level is relaxed,
 * and such edits are labelled so the officer can judge job-relatedness. The officer decides; nothing is
 * applied automatically.
 */
import { EligibilityRuleSpec, EligibilityRuleSpecSchema, MinProof } from '@pramaan/contracts';

export interface RuleEdit {
  id: string;
  description: string;
  /** Rough size of the change (0–1 per unit), used to prefer the smallest repair. */
  cost: number;
  touchesSkills: boolean;
  apply: (r: EligibilityRuleSpec) => EligibilityRuleSpec;
}

const clone = (r: EligibilityRuleSpec): EligibilityRuleSpec => JSON.parse(JSON.stringify(r));
const LOWER_PROOF: Record<MinProof, MinProof | null> = { L3: 'L2', L2: 'L1', L1: null };

/** Single-step relaxations of a rule. */
export function candidateEdits(input: EligibilityRuleSpec): RuleEdit[] {
  const r = EligibilityRuleSpecSchema.parse(input);
  const out: RuleEdit[] = [];
  const a = r.academics, b = r.backlogs;
  if (a.minCgpa !== undefined) for (const d of [0.25, 0.5, 1.0]) {
    const v = Math.round((a.minCgpa - d) * 100) / 100;
    if (v >= 5) out.push({ id: `cgpa-${d}`, description: `Lower minimum CGPA from ${a.minCgpa} to ${v}`, cost: d / 2, touchesSkills: false, apply: x => { const y = clone(x); y.academics.minCgpa = v; return y; } });
  }
  if (a.minTenthPct !== undefined) for (const d of [5, 10, 15]) {
    const v = a.minTenthPct - d;
    if (v >= 40) out.push({ id: `tenth-${d}`, description: `Lower minimum 10th marks from ${a.minTenthPct}% to ${v}%`, cost: d / 20, touchesSkills: false, apply: x => { const y = clone(x); y.academics.minTenthPct = v; return y; } });
  }
  if (a.minTwelfthOrDiplomaPct !== undefined) for (const d of [5, 10, 15]) {
    const v = a.minTwelfthOrDiplomaPct - d;
    if (v >= 40) out.push({ id: `twelfth-${d}`, description: `Lower minimum 12th/diploma marks from ${a.minTwelfthOrDiplomaPct}% to ${v}%`, cost: d / 20, touchesSkills: false, apply: x => { const y = clone(x); y.academics.minTwelfthOrDiplomaPct = v; return y; } });
  }
  if (a.maxGapYears !== undefined) out.push({ id: 'gap+1', description: `Allow ${a.maxGapYears + 1} gap year(s) instead of ${a.maxGapYears}`, cost: 0.3, touchesSkills: false, apply: x => { const y = clone(x); y.academics.maxGapYears = (a.maxGapYears ?? 0) + 1; return y; } });
  if (b.maxHistory !== undefined) out.push({ id: 'history+1', description: `Allow ${b.maxHistory + 1} past backlog(s) instead of ${b.maxHistory}`, cost: 0.3, touchesSkills: false, apply: x => { const y = clone(x); y.backlogs.maxHistory = (b.maxHistory ?? 0) + 1; return y; } });
  r.skills.forEach((s, i) => {
    const p = LOWER_PROOF[s.minProof];
    if (p) out.push({ id: `proof-${s.skillId}`, description: `Accept ${s.name} proven at ${p} instead of ${s.minProof} (the skill is still required)`, cost: 0.6, touchesSkills: true, apply: x => { const y = clone(x); y.skills[i].minProof = p; return y; } });
    if (s.minLevel > 1) out.push({ id: `level-${s.skillId}`, description: `Accept ${s.name} at level ${s.minLevel - 1} instead of ${s.minLevel} (the skill is still required)`, cost: 0.6, touchesSkills: true, apply: x => { const y = clone(x); y.skills[i].minLevel = s.minLevel - 1; return y; } });
  });
  return out;
}

/**
 * Singles plus pairwise combinations (bounded search). Pairs use every non-skill edit (at most 11, so at most
 * ~50 pairs) plus the cheapest skill relaxations, so two cutoffs that bind together, such as 10th and 12th
 * marks, can be relaxed together by any step size.
 */
export function candidateRepairs(input: EligibilityRuleSpec, maxSkillEditsInPairs = 2): { edits: RuleEdit[]; rules: EligibilityRuleSpec }[] {
  const base = EligibilityRuleSpecSchema.parse(input);
  const singles = candidateEdits(base);
  const out = singles.map(e => ({ edits: [e], rules: e.apply(base) }));
  const cheap = [
    ...singles.filter(e => !e.touchesSkills),
    ...singles.filter(e => e.touchesSkills).sort((x, y) => x.cost - y.cost).slice(0, maxSkillEditsInPairs),
  ];
  for (let i = 0; i < cheap.length; i++) for (let j = i + 1; j < cheap.length; j++) {
    if (cheap[i].id.split('-')[0] === cheap[j].id.split('-')[0]) continue; // same knob twice
    out.push({ edits: [cheap[i], cheap[j]], rules: cheap[j].apply(cheap[i].apply(base)) });
  }
  return out;
}

export interface RepairEvaluation {
  edits: RuleEdit[];
  rules: EligibilityRuleSpec;
  eligible: number;
  minImpactRatio: number | null;
  adverseDimensions: string[];
  /** People the lowest group is short of parity with the reference group ("shortfall"). */
  shortfall: number;
  /** Sum over compared groups of how far each impact ratio is below 0.80. 0 means no group is below. */
  ratioGap?: number;
}

export interface RepairOption {
  description: string[];
  cost: number;
  touchesSkills: boolean;
  rules: EligibilityRuleSpec;
  eligible: number;
  eligibleChange: number;
  minImpactRatio: number | null;
  shortfall: number;
  ratioGap: number | null;
  fixesAdverseImpact: boolean;
}

/**
 * Keeps the options that remove adverse impact, cheapest first, non-skill edits before equally cheap skill
 * relaxations. If none remove it, keeps the options that narrow it (fewer flagged dimensions, or a lowest
 * impact ratio at least 0.05 higher, or a total ratio gap at least 0.05 smaller) and ranks them by how much they narrow it. Shortfall is a head count, so
 * it grows when more students qualify; it is reported but never used to rank partial fixes.
 */
export function rankRepairs(
  baseline: { eligible: number; shortfall: number; minImpactRatio?: number | null; adverseDimensions?: string[]; ratioGap?: number },
  evaluated: RepairEvaluation[], limit = 5,
): RepairOption[] {
  const cost = (e: RepairEvaluation) => e.edits.reduce((s, x) => s + x.cost, 0);
  const toOption = (e: RepairEvaluation): RepairOption => ({
    description: e.edits.map(x => x.description), cost: Math.round(cost(e) * 100) / 100, touchesSkills: e.edits.some(x => x.touchesSkills),
    rules: e.rules, eligible: e.eligible, eligibleChange: e.eligible - baseline.eligible, minImpactRatio: e.minImpactRatio, shortfall: e.shortfall,
    ratioGap: e.ratioGap === undefined ? null : Math.round(e.ratioGap * 100) / 100,
    fixesAdverseImpact: e.adverseDimensions.length === 0,
  });
  const skill = (e: RepairEvaluation) => Number(e.edits.some(x => x.touchesSkills));
  const fixing = evaluated.filter(e => e.adverseDimensions.length === 0);
  if (fixing.length > 0) {
    return fixing.sort((x, y) => cost(x) - cost(y) || skill(x) - skill(y) || y.eligible - x.eligible).slice(0, limit).map(toOption);
  }
  const baseDims = baseline.adverseDimensions?.length ?? Infinity;
  const baseRatio = baseline.minImpactRatio ?? 0;
  const ratio = (e: RepairEvaluation) => e.minImpactRatio ?? 0;
  const gap = (e: RepairEvaluation) => e.ratioGap ?? 0;
  const baseGap = baseline.ratioGap;
  return evaluated
    .filter(e => e.adverseDimensions.length < baseDims || ratio(e) >= baseRatio + 0.05 || (baseGap !== undefined && e.ratioGap !== undefined && e.ratioGap <= baseGap - 0.05))
    .sort((x, y) => x.adverseDimensions.length - y.adverseDimensions.length || gap(x) - gap(y) || ratio(y) - ratio(x) || skill(x) - skill(y) || cost(x) - cost(y))
    .slice(0, limit)
    .map(toOption);
}

/** Shortfall: how many more people the worst compared group would need selected to match the reference rate. */
export function shortfallOf(groups: { total: number; selected: number; compared: boolean }[]): number {
  const cmp = groups.filter(g => g.compared && g.total > 0);
  if (cmp.length < 2) return 0;
  const best = Math.max(...cmp.map(g => g.selected / g.total));
  return Math.max(0, ...cmp.map(g => Math.ceil(best * g.total * 0.8 - g.selected)));
}
