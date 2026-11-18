/**
 * Explainable analytics for the placement office: KPI dictionary (PS p3), Readiness Radar (AD-03),
 * industry demand vs cohort supply (AD-02) and learning-path planning (ST-06). Pure functions; every
 * number carries the inputs and formula that produced it.
 */

// ---------- KPIs ----------
export interface Kpi {
  key: string;
  label: string;
  value: number | null;
  numerator: number;
  denominator: number;
  unit: '%' | 'ratio' | 'days' | 'score';
  formula: string;
}

export interface KpiInputs {
  optedIn: number;
  placedStudents: number;
  requiredSkillSlots: number;
  verifiedRequiredSkillSlots: number;
  gapsOpenAtSeasonStart: number;
  gapsClosedSinceSeasonStart: number;
  shortlisted: number;
  offers: number;
  daysToShortlist: number[];
  recruiterActions: { evidenceCardsOpened: number; feedbackGiven: number; reprobesRequested: number };
  activeRecruiters: number;
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Weights for Recruiter Engagement, shown next to the score. */
export const ENGAGEMENT_WEIGHTS = { evidenceCardsOpened: 1, feedbackGiven: 3, reprobesRequested: 2 } as const;

export function computeKpis(i: KpiInputs): Kpi[] {
  const eng = i.recruiterActions.evidenceCardsOpened * ENGAGEMENT_WEIGHTS.evidenceCardsOpened
    + i.recruiterActions.feedbackGiven * ENGAGEMENT_WEIGHTS.feedbackGiven
    + i.recruiterActions.reprobesRequested * ENGAGEMENT_WEIGHTS.reprobesRequested;
  const med = median(i.daysToShortlist);
  return [
    { key: 'placement_rate', label: 'Placement Rate', value: pct(i.placedStudents, i.optedIn), numerator: i.placedStudents, denominator: i.optedIn, unit: '%', formula: 'Students with ≥1 accepted offer ÷ students opted in for placement' },
    { key: 'verified_skill_coverage', label: 'Verified Skill Coverage', value: pct(i.verifiedRequiredSkillSlots, i.requiredSkillSlots), numerator: i.verifiedRequiredSkillSlots, denominator: i.requiredSkillSlots, unit: '%', formula: 'Branch core skills Verified (any proof level) ÷ branch core skills required, across opted-in students' },
    { key: 'gap_closure_rate', label: 'Skill-Gap Closure Rate', value: pct(i.gapsClosedSinceSeasonStart, i.gapsOpenAtSeasonStart), numerator: i.gapsClosedSinceSeasonStart, denominator: i.gapsOpenAtSeasonStart, unit: '%', formula: 'Gaps closed with new proof since the baseline snapshot ÷ gaps open at the baseline' },
    { key: 'shortlist_to_offer', label: 'Shortlist-to-Offer Ratio', value: pct(i.offers, i.shortlisted), numerator: i.offers, denominator: i.shortlisted, unit: '%', formula: 'Offers ÷ shortlisted applications' },
    { key: 'time_to_shortlist', label: 'Time-to-Shortlist', value: med, numerator: med ?? 0, denominator: i.daysToShortlist.length, unit: 'days', formula: 'Median days from drive publication to shortlist, across drives with a shortlist' },
    { key: 'recruiter_engagement', label: 'Recruiter Engagement Score', value: i.activeRecruiters > 0 ? Math.round((eng / i.activeRecruiters) * 10) / 10 : null, numerator: eng, denominator: i.activeRecruiters, unit: 'score', formula: `(cards opened × ${ENGAGEMENT_WEIGHTS.evidenceCardsOpened} + feedback × ${ENGAGEMENT_WEIGHTS.feedbackGiven} + re-probes × ${ENGAGEMENT_WEIGHTS.reprobesRequested}) ÷ active recruiters` },
  ];
}

// ---------- Readiness Radar ----------
export interface ReadinessInput {
  studentId: string;
  coreSkillsRequired: number;
  coreSkillsVerified: number;
  latestMockPercent: number | null;
  learningTasksAssigned: number;
  learningTasksPassed: number;
  activeBacklogs: number;
}

export interface ReadinessFactor { key: string; label: string; weight: number; value: number; contribution: number; explanation: string }
export interface ReadinessResult { studentId: string; score: number; factors: ReadinessFactor[]; missingData: string[] }

export const READINESS_WEIGHTS = { coverage: 0.45, mock: 0.3, learning: 0.15, backlogs: 0.1 } as const;
export const READINESS_THRESHOLD = 55;

/**
 * Transparent readiness score (0–100) as a weighted sum of four visible factors. It is a heuristic for
 * prioritising support, not a validated prediction; it is shown to officers only, never as a label on
 * the student.
 */
export function readiness(i: ReadinessInput): ReadinessResult {
  const missing: string[] = [];
  const coverage = i.coreSkillsRequired > 0 ? i.coreSkillsVerified / i.coreSkillsRequired : 0;
  let mock = 0.5;
  if (i.latestMockPercent === null) missing.push('No mock drive attempted yet (counted as 50%).');
  else mock = i.latestMockPercent / 100;
  const learning = i.learningTasksAssigned > 0 ? i.learningTasksPassed / i.learningTasksAssigned : 0.5;
  const backlogs = i.activeBacklogs === 0 ? 1 : i.activeBacklogs === 1 ? 0.5 : 0;
  const f = (key: keyof typeof READINESS_WEIGHTS, label: string, value: number, explanation: string): ReadinessFactor => ({
    key, label, weight: READINESS_WEIGHTS[key], value: Math.round(value * 100) / 100,
    contribution: Math.round(value * READINESS_WEIGHTS[key] * 1000) / 10, explanation,
  });
  const factors = [
    f('coverage', 'Core skills verified', coverage, `${i.coreSkillsVerified} of ${i.coreSkillsRequired} branch core skills are Verified.`),
    f('mock', 'Latest mock drive', mock, i.latestMockPercent === null ? 'No attempt yet.' : `Scored ${i.latestMockPercent}% overall.`),
    f('learning', 'Learning tasks passed', learning, i.learningTasksAssigned ? `${i.learningTasksPassed} of ${i.learningTasksAssigned} tasks passed.` : 'No learning path yet (counted as 50%).'),
    f('backlogs', 'Active backlogs', backlogs, `${i.activeBacklogs} active backlog(s).`),
  ];
  return { studentId: i.studentId, score: Math.round(factors.reduce((s, x) => s + x.contribution, 0)), factors, missingData: missing };
}

/** Wilson score interval for a proportion. */
export function wilson(successes: number, n: number, z = 1.96): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 0 };
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

export interface CohortForecast { cohortSize: number; readyCount: number; estimatePercent: number; lowPercent: number; highPercent: number; threshold: number; caveat: string }

export function cohortForecast(results: ReadinessResult[], threshold = READINESS_THRESHOLD): CohortForecast {
  const ready = results.filter(r => r.score >= threshold).length;
  const w = wilson(ready, results.length);
  const r1 = (x: number) => Math.round(x * 1000) / 10;
  return {
    cohortSize: results.length, readyCount: ready, threshold,
    estimatePercent: results.length ? r1(ready / results.length) : 0, lowPercent: r1(w.low), highPercent: r1(w.high),
    caveat: 'This is an early estimate: the share of students at or above the target score, with a likely range. It has not yet been compared with real past placement results.',
  };
}

// ---------- Industry demand vs cohort supply ----------
export interface TaxonomyEntry { skillId: string; slug: string; name: string; aliases: string[] }
export interface SkillMention { skillId: string; matchedText: string }

function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * Deterministic skill extraction: whole-word, case-insensitive match of skill names and aliases.
 * Handles tokens like C++, C#, .NET and Node.js. Single-letter names (C, R) only match as standalone words
 * followed by a programming context word, to avoid false hits.
 */
/**
 * Terms that are also everyday English words or short abbreviations. In job descriptions they only count
 * when written with the product's own capitalisation (e.g. "Go", "Swift", "Spring"); lowercase aliases in
 * this set are ignored for extraction (they remain valid for search).
 */
const AMBIGUOUS = new Set(['go', 'swift', 'rust', 'spring', 'express', 'flask', 'next', 'node', 'shell', 'testing', 'spark', 'excel',
  'english', 'containers', 'collaboration', 'documentation', 'reasoning', 'quant', 'ml', 'dl', 'cv', 'os', 'cn', 'ds', 'dsa', 'qa',
  'seo', 'ui', 'ux', 'bim', 'fea', 'sdlc', 'rest', 'algo', 'oops', 'scrum', 'mongo', 'k8s', 'gd']);

export function extractSkills(text: string, taxonomy: TaxonomyEntry[]): SkillMention[] {
  const found = new Map<string, string>();
  for (const t of taxonomy) {
    for (const term of [t.name, ...t.aliases]) {
      if (!term) continue;
      if (AMBIGUOUS.has(term.toLowerCase())) {
        if (term === term.toLowerCase()) continue; // lowercase ambiguous alias: never used for extraction
        const re = new RegExp(`(^|[^A-Za-z0-9+#.])${escapeRe(term)}(?![A-Za-z0-9+#])`); // case-sensitive
        if (re.test(text) && !found.has(t.skillId)) found.set(t.skillId, term);
        continue;
      }
      if (term.length === 1) {
        const re = new RegExp(`(^|[^A-Za-z0-9+#])${escapeRe(term)}(?=\\s*(programming|language|\\/|,\\s*C\\+\\+))`, 'i');
        if (re.test(text) && !found.has(t.skillId)) found.set(t.skillId, term);
        continue;
      }
      const re = new RegExp(`(^|[^A-Za-z0-9+#.])${escapeRe(term)}(?![A-Za-z0-9+#])`, 'i');
      const m = text.match(re);
      if (m && !found.has(t.skillId)) found.set(t.skillId, term);
    }
  }
  return [...found.entries()].map(([skillId, matchedText]) => ({ skillId, matchedText }));
}

export interface DemandRow {
  skillId: string; name: string;
  demandCount: number; demandPercent: number;
  supplyCount: number; supplyPercent: number;
  gapPoints: number;
}

export interface DemandReport {
  sampleSize: number; dateFrom: string | null; dateTo: string | null; cohortSize: number;
  rows: DemandRow[]; alerts: (DemandRow & { message: string })[];
}

export const ALERT_MIN_DEMAND = 20;
export const ALERT_MIN_GAP = 15;

export function demandVsSupply(
  jds: { id: string; postedOn: string; skillIds: string[] }[],
  cohort: { studentId: string; verifiedSkillIds: string[] }[],
  names: Map<string, string>
): DemandReport {
  const demand = new Map<string, number>();
  for (const jd of jds) for (const s of new Set(jd.skillIds)) demand.set(s, (demand.get(s) ?? 0) + 1);
  const supply = new Map<string, number>();
  for (const st of cohort) for (const s of new Set(st.verifiedSkillIds)) supply.set(s, (supply.get(s) ?? 0) + 1);
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const rows = [...demand.entries()].map(([skillId, d]) => {
    const dp = jds.length ? (d / jds.length) * 100 : 0;
    const sp = cohort.length ? ((supply.get(skillId) ?? 0) / cohort.length) * 100 : 0;
    return { skillId, name: names.get(skillId) ?? skillId, demandCount: d, demandPercent: r1(dp), supplyCount: supply.get(skillId) ?? 0, supplyPercent: r1(sp), gapPoints: r1(dp - sp) };
  }).sort((a, b) => b.demandPercent - a.demandPercent || a.name.localeCompare(b.name));
  const dates = jds.map(j => j.postedOn).sort();
  return {
    sampleSize: jds.length, dateFrom: dates[0] ?? null, dateTo: dates[dates.length - 1] ?? null, cohortSize: cohort.length,
    rows,
    alerts: rows.filter(r => r.demandPercent >= ALERT_MIN_DEMAND && r.gapPoints >= ALERT_MIN_GAP).map(r => ({
      ...r, message: `${r.demandPercent}% of ${jds.length} job descriptions ask for ${r.name}; only ${r.supplyPercent}% of the batch has it Verified.`,
    })),
  };
}

// ---------- Learning path planning ----------
export interface TaskCandidate { id: string; slug: string; skillId: string; skillName: string; title: string; kind: string; targetProof: 'L1' | 'L2' | 'L3'; weakTopics: string[]; estHours: number }
export interface PlannedItem { taskId: string; position: number; reason: string }

/**
 * Orders tasks by impact: first those that close a gap blocking the most drives (from Proof Path), then
 * those that train a weak mock topic. Skips skills already verified at the task's proof level. Max 6 items.
 */
export function planLearningPath(input: {
  proofActions: { skillId: string; name: string; unlocksCount: number; targetProof: 'L1' | 'L2' | 'L3' }[];
  weakTopics: string[];
  verified: Map<string, number>; // skillId → proof rank
  tasks: TaskCandidate[];
  max?: number;
}): PlannedItem[] {
  const max = input.max ?? 6;
  const chosen: PlannedItem[] = [];
  const used = new Set<string>();
  const rank = (p: 'L1' | 'L2' | 'L3') => Number(p.slice(1));
  const add = (t: TaskCandidate, reason: string) => {
    if (used.has(t.id) || chosen.length >= max) return;
    if ((input.verified.get(t.skillId) ?? 0) >= rank(t.targetProof)) return;
    used.add(t.id);
    chosen.push({ taskId: t.id, position: chosen.length + 1, reason });
  };
  for (const a of input.proofActions.filter(x => x.unlocksCount > 0)) {
    for (const t of input.tasks.filter(x => x.skillId === a.skillId && rank(x.targetProof) >= rank(a.targetProof))) {
      add(t, `Gets ${a.name} to ${a.targetProof}, which unlocks ${a.unlocksCount} drive(s).`);
    }
  }
  for (const topic of input.weakTopics) {
    for (const t of input.tasks.filter(x => x.weakTopics.includes(topic))) {
      add(t, `Practises ${topic.replace(/-/g, ' ')}, a weak topic in your last mock drive.`);
    }
  }
  return chosen;
}
