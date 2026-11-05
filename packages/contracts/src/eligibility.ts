import { z } from 'zod';

export const EligibilityRuleSpecSchema = z.object({
  minCgpa: z.number().min(0).max(10).default(0),
  maxBacklogs: z.number().int().min(0).default(0),
  allowedBranches: z.array(z.string()).default([]),
  graduatingYears: z.array(z.number().int()).default([]),
  requiredSkills: z.array(z.string()).default([]), // canonical skill names that must be Verified
});
export type EligibilityRuleSpec = z.infer<typeof EligibilityRuleSpecSchema>;

export const EligibilityRuleVersionSchema = z.object({
  id: z.string().uuid(),
  ruleSetId: z.string().uuid(),
  versionNo: z.number().int().positive(),
  rules: EligibilityRuleSpecSchema,
  rationale: z.string().min(5),
  publishedBy: z.string().uuid(),
  publishedAt: z.string().datetime(),
});
export type EligibilityRuleVersion = z.infer<typeof EligibilityRuleVersionSchema>;

export const StudentAcademicSnapshotSchema = z.object({
  studentId: z.string().uuid(),
  cgpa: z.number().min(0).max(10),
  activeBacklogs: z.number().int().min(0),
  branch: z.string(),
  graduatingYear: z.number().int(),
  verifiedSkillNames: z.array(z.string()),
});
export type StudentAcademicSnapshot = z.infer<typeof StudentAcademicSnapshotSchema>;

export const ReasonCodeSchema = z.enum([
  'CRITERIA_MET',
  'INSUFFICIENT_CGPA',
  'EXCESSIVE_BACKLOGS',
  'BRANCH_INELIGIBLE',
  'GRADUATION_YEAR_MISMATCH',
  'MISSING_REQUIRED_VERIFIED_SKILLS',
  'DISCIPLINARY_HOLD'
]);
export type ReasonCode = z.infer<typeof ReasonCodeSchema>;

export const EligibilityEvaluationResultSchema = z.object({
  eligible: z.boolean(),
  status: z.enum(['eligible', 'ineligible', 'conditionally_eligible']),
  reasonCodes: z.array(ReasonCodeSchema),
  missingSkills: z.array(z.string()),
  ruleVersionId: z.string().uuid(),
  evaluatedAt: z.string().datetime(),
  inputHash: z.string().length(64),
});
export type EligibilityEvaluationResult = z.infer<typeof EligibilityEvaluationResultSchema>;

