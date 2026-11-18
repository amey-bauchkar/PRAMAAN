import { z } from 'zod';

/** PS p2: gender, category, branch, college tier. */
export const FairnessDimensionSchema = z.enum(['gender', 'category', 'branch', 'college_tier']);
export type FairnessDimension = z.infer<typeof FairnessDimensionSchema>;

/** Funnel stage being measured: selection rate at each stage is conditional on reaching the previous one. */
export const FairnessStageSchema = z.enum(['eligibility', 'shortlist', 'offer']);
export type FairnessStage = z.infer<typeof FairnessStageSchema>;

export const DemographicGroupMetricSchema = z.object({
  groupName: z.string(),
  totalCandidates: z.number().int().nonnegative(),
  eligibleCandidates: z.number().int().nonnegative(),
  selectionRate: z.number().min(0).max(1),
  impactRatio: z.number().min(0).nullable(), // relative to the reference (highest-rate) group
  isSuppressed: z.boolean(), // true if totalCandidates < minGroupSize
  /** "Unspecified" / "Prefer not to say" are reported but never compared or used as the reference. */
  excludedFromComparison: z.boolean().default(false),
  /** Two-sided Fisher's exact test p-value against the reference group (null when not compared). */
  fisherPValue: z.number().min(0).max(1).nullable().default(null),
});
export type DemographicGroupMetric = z.infer<typeof DemographicGroupMetricSchema>;

export const FairnessAuditReportSchema = z.object({
  dimension: FairnessDimensionSchema,
  stage: FairnessStageSchema.default('eligibility'),
  ruleVersionId: z.string().uuid(),
  minGroupSize: z.number().int().positive().default(5),
  policyNote: z.string().default(
    'PROPOSED POLICY: Small-group suppression threshold (default N=5) is an institutional privacy safeguard, not a statutory legal mandate.'
  ),
  highestSelectionRate: z.number().min(0).max(1),
  referenceGroup: z.string().nullable().default(null),
  groups: z.record(DemographicGroupMetricSchema),
  adverseImpactDetected: z.boolean(), // true if any compared group has impactRatio < 0.80
  notes: z.array(z.string()).default([]),
  analyzedAt: z.string().datetime(),
});
export type FairnessAuditReport = z.infer<typeof FairnessAuditReportSchema>;
