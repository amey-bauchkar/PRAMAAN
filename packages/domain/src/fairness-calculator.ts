import {
  FairnessAuditReport,
  DemographicGroupMetric,
  FairnessDimension,
  FairnessStage,
} from '@pramaan/contracts';

export interface StudentDemographicRecord {
  studentId: string;
  groupValue: string; // e.g. "Female", "OBC", "CSE", "Tier 2"
  /** Selected at the stage being measured (eligible / shortlisted / offered). */
  eligible: boolean;
}

/** One student's progress through a drive's funnel, for per-stage analysis. */
export interface FunnelRecord {
  studentId: string;
  groupValue: string;
  eligible: boolean;
  shortlisted: boolean;
  offered: boolean;
}

export interface FairnessOptions {
  stage?: FairnessStage;
  now?: string;
}

/** Values treated as "did not disclose": reported, never compared, never the reference group. */
const UNDISCLOSED = new Set(['unspecified', 'prefer not to say', 'prefer_not_to_say', 'not disclosed', '']);

function logFactorialTable(n: number): number[] {
  const t = new Array(n + 1).fill(0);
  for (let i = 2; i <= n; i++) t[i] = t[i - 1] + Math.log(i);
  return t;
}

/**
 * Two-sided Fisher's exact test on the 2x2 table [[a, b], [c, d]].
 * Sums the probability of every table with the same margins that is no more likely than the observed one.
 */
export function fisherExactTwoSided(a: number, b: number, c: number, d: number): number {
  const n = a + b + c + d;
  const lf = logFactorialTable(n);
  const row1 = a + b, row2 = c + d, col1 = a + c;
  const logP = (x: number) =>
    lf[row1] + lf[row2] + lf[col1] + lf[n - col1] - lf[n] - lf[x] - lf[row1 - x] - lf[col1 - x] - lf[row2 - col1 + x];
  const observed = logP(a);
  const lo = Math.max(0, col1 - row2), hi = Math.min(row1, col1);
  let p = 0;
  for (let x = lo; x <= hi; x++) {
    const lp = logP(x);
    if (lp <= observed + 1e-7) p += Math.exp(lp);
  }
  return Math.min(1, p);
}

export class FairnessCalculator {
  public static readonly DEFAULT_MIN_GROUP_SIZE = 5;
  public static readonly ADVERSE_IMPACT_THRESHOLD = 0.80; // four-fifths benchmark
  public static readonly POLICY_NOTE =
    'PROPOSED POLICY: Small-group suppression threshold (default N=5) is an institutional privacy safeguard, not a statutory legal mandate.';

  /**
   * Selection rates and impact ratios for one dimension at one funnel stage.
   * Flags are for human review only; a ratio ≥ 0.80 is not proof of fairness, and < 0.80 is not proof of bias.
   */
  public static computeFairness(
    records: StudentDemographicRecord[],
    dimension: FairnessDimension,
    ruleVersionId: string,
    minGroupSize = FairnessCalculator.DEFAULT_MIN_GROUP_SIZE,
    options: FairnessOptions = {}
  ): FairnessAuditReport {
    const stage = options.stage ?? 'eligibility';
    const analyzedAt = options.now ?? new Date().toISOString();
    const notes: string[] = [];

    const totals: Record<string, { total: number; selected: number; undisclosed: boolean }> = {};
    for (const r of records ?? []) {
      const g = (r.groupValue ?? '').trim() || 'Unspecified';
      totals[g] ??= { total: 0, selected: 0, undisclosed: UNDISCLOSED.has(g.toLowerCase()) };
      totals[g].total += 1;
      if (r.eligible) totals[g].selected += 1;
    }

    // Reference group: highest selection rate among disclosed, unsuppressed groups.
    let reference: string | null = null;
    let highest = 0;
    for (const [g, t] of Object.entries(totals)) {
      if (t.undisclosed || t.total < minGroupSize) continue;
      const rate = t.selected / t.total;
      if (reference === null || rate > highest) { reference = g; highest = rate; }
    }

    const groups: Record<string, DemographicGroupMetric> = {};
    let adverse = false;
    const ref = reference ? totals[reference] : null;

    for (const [g, t] of Object.entries(totals)) {
      const isSuppressed = t.total < minGroupSize;
      const rate = t.total > 0 ? t.selected / t.total : 0;
      const compared = !isSuppressed && !t.undisclosed && ref !== null && highest > 0;
      let impactRatio: number | null = null;
      let fisherPValue: number | null = null;
      if (compared) {
        impactRatio = Number((rate / highest).toFixed(4));
        if (impactRatio < FairnessCalculator.ADVERSE_IMPACT_THRESHOLD) adverse = true;
        if (g !== reference) {
          fisherPValue = Number(fisherExactTwoSided(t.selected, t.total - t.selected, ref!.selected, ref!.total - ref!.selected).toFixed(4));
        }
      }
      groups[g] = {
        groupName: g,
        totalCandidates: t.total,
        eligibleCandidates: t.selected,
        selectionRate: Number(rate.toFixed(4)),
        impactRatio,
        isSuppressed,
        excludedFromComparison: t.undisclosed,
        fisherPValue,
      };
    }

    if (ref && ref.total < 2 * minGroupSize) {
      notes.push(`Reference group "${reference}" has only ${ref.total} candidates; impact ratios are unstable.`);
    }
    const undisclosedCount = Object.values(totals).filter(t => t.undisclosed).reduce((s, t) => s + t.total, 0);
    if (undisclosedCount > 0) {
      notes.push(`${undisclosedCount} candidate(s) did not disclose ${dimension.replace('_', ' ')} and are excluded from comparison.`);
    }

    return {
      dimension,
      stage,
      ruleVersionId,
      minGroupSize,
      policyNote: FairnessCalculator.POLICY_NOTE,
      highestSelectionRate: Number(highest.toFixed(4)),
      referenceGroup: reference,
      groups,
      adverseImpactDetected: adverse,
      notes,
      analyzedAt,
    };
  }

  /**
   * Per-stage analysis of a drive funnel (PS p2: selection / shortlisting).
   * Stage rates are conditional: shortlist rate among the eligible, offer rate among the shortlisted.
   */
  public static computeFunnel(
    records: FunnelRecord[],
    dimension: FairnessDimension,
    ruleVersionId: string,
    minGroupSize = FairnessCalculator.DEFAULT_MIN_GROUP_SIZE,
    options: { now?: string } = {}
  ): Record<FairnessStage, FairnessAuditReport> {
    const at = (stage: FairnessStage, pool: FunnelRecord[], pick: (r: FunnelRecord) => boolean) =>
      this.computeFairness(pool.map(r => ({ studentId: r.studentId, groupValue: r.groupValue, eligible: pick(r) })),
        dimension, ruleVersionId, minGroupSize, { stage, now: options.now });
    return {
      eligibility: at('eligibility', records, r => r.eligible),
      shortlist: at('shortlist', records.filter(r => r.eligible), r => r.shortlisted),
      offer: at('offer', records.filter(r => r.shortlisted), r => r.offered),
    };
  }
}
