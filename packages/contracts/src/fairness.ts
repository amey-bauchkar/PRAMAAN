import { z } from 'zod';

export const DemographicGroupMetricSchema = z.object({
  groupName: z.string(),
  totalCandidates: z.number().int().nonnegative(),
  eligibleCandidates: z.number().int().nonnegative(),
  selectionRate: z.number().min(0).max(1),
  impactRatio: z.number().min(0).nullable(), // relative to the highest selection rate group
  isSuppressed: z.boolean(), // true if totalCandidates < minGroupSize
});
export type DemographicGroupMetric = z.infer<typeof DemographicGroupMetricSchema>;

export const FairnessAuditReportSchema = z.object({
  dimension: z.enum(['gender', 'category', 'branch']),
  ruleVersionId: z.string().uuid(),
  minGroupSize: z.number().int().positive().default(5),
  policyNote: z.string().default(
    'PROPOSED POLICY: Small-group suppression threshold (default N=5) is an institutional privacy safeguard, not a statutory legal mandate.'
  ),
  highestSelectionRate: z.number().min(0).max(1),
  groups: z.record(DemographicGroupMetricSchema),
  adverseImpactDetected: z.boolean(), // true if any unsuppressed group has impactRatio < 0.80
  analyzedAt: z.string().datetime(),
});
export type FairnessAuditReport = z.infer<typeof FairnessAuditReportSchema>;
