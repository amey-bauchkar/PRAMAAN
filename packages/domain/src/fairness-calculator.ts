import {
  FairnessAuditReport,
  DemographicGroupMetric
} from '@pramaan/contracts';

export interface StudentDemographicRecord {
  studentId: string;
  groupValue: string; // e.g. "Female", "Male", "General", "OBC", "SC", "ST", "CSE", "ECE"
  eligible: boolean;
}

export class FairnessCalculator {
  public static readonly DEFAULT_MIN_GROUP_SIZE = 5;
  public static readonly ADVERSE_IMPACT_THRESHOLD = 0.80; // 4/5ths Rule
  public static readonly POLICY_NOTE = 
    'PROPOSED POLICY: Small-group suppression threshold (default N=5) is an institutional privacy safeguard, not a statutory legal mandate.';

  /**
   * Computes demographic selection rates, impact ratios, and small group suppression.
   */
  public static computeFairness(
    records: StudentDemographicRecord[],
    dimension: 'gender' | 'category' | 'branch',
    ruleVersionId: string,
    minGroupSize = FairnessCalculator.DEFAULT_MIN_GROUP_SIZE
  ): FairnessAuditReport {
    // 1. Handle empty cohort
    if (!records || records.length === 0) {
      return {
        dimension,
        ruleVersionId,
        minGroupSize,
        policyNote: FairnessCalculator.POLICY_NOTE,
        highestSelectionRate: 0,
        groups: {},
        adverseImpactDetected: false,
        analyzedAt: new Date().toISOString()
      };
    }

    // 2. Aggregate counts per group
    const groupTotals: Record<string, { total: number; eligible: number }> = {};

    for (const record of records) {
      const g = (record.groupValue || 'Unspecified').trim();
      if (!groupTotals[g]) {
        groupTotals[g] = { total: 0, eligible: 0 };
      }
      groupTotals[g].total += 1;
      if (record.eligible) {
        groupTotals[g].eligible += 1;
      }
    }

    // 3. Compute selection rates
    const rawMetrics: Record<string, { total: number; eligible: number; selectionRate: number; isSuppressed: boolean }> = {};
    let highestSelectionRate = 0;

    for (const [groupName, counts] of Object.entries(groupTotals)) {
      const isSuppressed = counts.total < minGroupSize;
      const selectionRate = counts.total > 0 ? counts.eligible / counts.total : 0;

      rawMetrics[groupName] = {
        total: counts.total,
        eligible: counts.eligible,
        selectionRate,
        isSuppressed
      };

      // Highest selection rate is derived only from unsuppressed groups
      if (!isSuppressed && selectionRate > highestSelectionRate) {
        highestSelectionRate = selectionRate;
      }
    }

    // 4. Compute impact ratios relative to highest selection rate
    const groups: Record<string, DemographicGroupMetric> = {};
    let adverseImpactDetected = false;

    for (const [groupName, metric] of Object.entries(rawMetrics)) {
      let impactRatio: number | null = null;

      if (!metric.isSuppressed && highestSelectionRate > 0) {
        impactRatio = Number((metric.selectionRate / highestSelectionRate).toFixed(4));
        if (impactRatio < FairnessCalculator.ADVERSE_IMPACT_THRESHOLD) {
          adverseImpactDetected = true;
        }
      }

      groups[groupName] = {
        groupName,
        totalCandidates: metric.total,
        eligibleCandidates: metric.eligible,
        selectionRate: Number(metric.selectionRate.toFixed(4)),
        impactRatio,
        isSuppressed: metric.isSuppressed
      };
    }

    return {
      dimension,
      ruleVersionId,
      minGroupSize,
      policyNote: FairnessCalculator.POLICY_NOTE,
      highestSelectionRate: Number(highestSelectionRate.toFixed(4)),
      groups,
      adverseImpactDetected,
      analyzedAt: new Date().toISOString()
    };
  }
}
