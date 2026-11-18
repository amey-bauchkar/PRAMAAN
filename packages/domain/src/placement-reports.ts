/**
 * Recruiter candidate matching (AD-08) and accreditation reporting (AD-11). Both are explicit rules,
 * not scores: a recruiter sees exactly which filters a student matched and the evidence behind them.
 */
import { MinProof, meetsMinProof, ProofLevel } from '@pramaan/contracts';

export interface CandidateSkill { skillId: string; name: string; state: string; proofLevel: ProofLevel | null; verifiedAt: string | null; validUntil: string | null }
export interface CandidateInput { studentId: string; displayName: string; branch: string; skills: CandidateSkill[] }
export interface SkillFilter { skillId: string; name: string; minProof: MinProof; maxAgeDays?: number }

export interface CandidateMatch {
  studentId: string; displayName: string; branch: string;
  matched: { skill: string; proofLevel: ProofLevel; ageDays: number; reason: string }[];
  unmatched: { skill: string; reason: string }[];
  matchedCount: number;
  freshestProofDays: number | null;
}

/**
 * Returns students matching at least one filter. Sorted by number of filters matched, then by freshness
 * of proof, then by name: the sort order is stated to the recruiter, and there is no hidden score.
 */
export function matchCandidates(candidates: CandidateInput[], filters: SkillFilter[], now = new Date().toISOString()): CandidateMatch[] {
  const nowMs = Date.parse(now);
  const out: CandidateMatch[] = [];
  for (const c of candidates) {
    const matched: CandidateMatch['matched'] = [], unmatched: CandidateMatch['unmatched'] = [];
    for (const f of filters) {
      const s = c.skills.find(x => x.skillId === f.skillId);
      if (!s || s.state !== 'verified' || !s.proofLevel) { unmatched.push({ skill: f.name, reason: s ? `${s.state.replace('_', '-')}` : 'not on profile' }); continue; }
      if (s.validUntil && Date.parse(s.validUntil) <= nowMs) { unmatched.push({ skill: f.name, reason: 'proof expired' }); continue; }
      if (!meetsMinProof(s.proofLevel, f.minProof)) { unmatched.push({ skill: f.name, reason: `proof ${s.proofLevel} below ${f.minProof}` }); continue; }
      const ageDays = s.verifiedAt ? Math.floor((nowMs - Date.parse(s.verifiedAt)) / 86_400_000) : 0;
      if (f.maxAgeDays !== undefined && ageDays > f.maxAgeDays) { unmatched.push({ skill: f.name, reason: `proof ${ageDays} days old (limit ${f.maxAgeDays})` }); continue; }
      matched.push({ skill: f.name, proofLevel: s.proofLevel, ageDays, reason: `${f.name} Verified (${s.proofLevel.replace('_', ' ')}), ${ageDays} days ago` });
    }
    if (matched.length > 0) {
      out.push({ studentId: c.studentId, displayName: c.displayName, branch: c.branch, matched, unmatched, matchedCount: matched.length,
        freshestProofDays: Math.min(...matched.map(m => m.ageDays)) });
    }
  }
  return out.sort((a, b) => b.matchedCount - a.matchedCount || (a.freshestProofDays ?? 1e9) - (b.freshestProofDays ?? 1e9) || a.displayName.localeCompare(b.displayName));
}

export interface OutcomeRow { studentId: string; branch: string; outcomeType: 'placed' | 'higher_studies' | 'entrepreneurship' | 'unplaced'; ctcInr: number | null }
export interface BranchOutcome {
  branch: string; graduating: number; placed: number; placedPercent: number;
  higherStudies: number; entrepreneurship: number;
  medianCtcInr: number | null; highestCtcInr: number | null; averageCtcInr: number | null;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * NAAC/NIRF-style placement table. Each student is counted once (highest offer), so multiple offers do
 * not inflate placement counts.
 */
export function accreditationSummary(graduatingByBranch: Map<string, number>, outcomes: OutcomeRow[]): { rows: BranchOutcome[]; total: BranchOutcome; notes: string[] } {
  const best = new Map<string, OutcomeRow>();
  const priority = { placed: 3, higher_studies: 2, entrepreneurship: 1, unplaced: 0 } as const;
  for (const o of outcomes) {
    const cur = best.get(o.studentId);
    if (!cur || priority[o.outcomeType] > priority[cur.outcomeType] || (o.outcomeType === cur.outcomeType && (o.ctcInr ?? 0) > (cur.ctcInr ?? 0))) best.set(o.studentId, o);
  }
  const build = (branch: string, graduating: number, rows: OutcomeRow[]): BranchOutcome => {
    const ctcs = rows.filter(r => r.outcomeType === 'placed' && r.ctcInr).map(r => r.ctcInr as number);
    const placed = rows.filter(r => r.outcomeType === 'placed').length;
    return {
      branch, graduating, placed, placedPercent: graduating ? Math.round((placed / graduating) * 1000) / 10 : 0,
      higherStudies: rows.filter(r => r.outcomeType === 'higher_studies').length,
      entrepreneurship: rows.filter(r => r.outcomeType === 'entrepreneurship').length,
      medianCtcInr: median(ctcs), highestCtcInr: ctcs.length ? Math.max(...ctcs) : null,
      averageCtcInr: ctcs.length ? Math.round(ctcs.reduce((a, b) => a + b, 0) / ctcs.length) : null,
    };
  };
  const all = [...best.values()];
  const rows = [...graduatingByBranch.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([branch, n]) => build(branch, n, all.filter(r => r.branch === branch)));
  const total = build('All branches', [...graduatingByBranch.values()].reduce((a, b) => a + b, 0), all);
  return {
    rows, total,
    notes: [
      'Each student is counted once, by their best outcome (placed > higher studies > entrepreneurship).',
      'Salary figures use the highest offer per placed student, in INR per annum.',
      'Draft for institutional verification: reconcile with university registers before submission.',
    ],
  };
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    // Neutralise spreadsheet formula injection.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
}
