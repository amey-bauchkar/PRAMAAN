import { z } from 'zod';
import { MinProofSchema, ProofLevelSchema, SkillStateSchema } from './skill.js';

/**
 * Eligibility Rule DSL v2 (PRAMAAN v2 §4.3).
 * Covers the PS's "academics, backlogs, skills, policy limits" (PS p2, p5) using the criteria Indian
 * campus drives actually use. Every block is optional; an omitted block imposes no constraint.
 */
export const SkillRequirementSchema = z.object({
  skillId: z.string().uuid(),
  /** Display name, used only in explanations. Matching is always by skillId. */
  name: z.string().min(1),
  minLevel: z.number().int().min(1).max(3).default(1),
  minProof: MinProofSchema.default('L1'),
});
export type SkillRequirement = z.infer<typeof SkillRequirementSchema>;

export const EligibilityRuleSpecSchema = z.object({
  schemaVersion: z.literal(2).default(2),
  academics: z.object({
    minCgpa: z.number().min(0).max(10).optional(),
    minTenthPct: z.number().min(0).max(100).optional(),
    /** Satisfied by either 12th or diploma percentage, as campus drives commonly allow. */
    minTwelfthOrDiplomaPct: z.number().min(0).max(100).optional(),
    maxGapYears: z.number().int().min(0).optional(),
  }).default({}),
  backlogs: z.object({
    maxActive: z.number().int().min(0).optional(),
    maxHistory: z.number().int().min(0).optional(),
  }).default({}),
  branches: z.array(z.string()).default([]),
  graduatingYears: z.array(z.number().int()).default([]),
  skills: z.array(SkillRequirementSchema).default([]),
  policy: z.object({
    /** Maximum number of accepted offers a student may already hold to still apply. */
    maxOffersHeld: z.number().int().min(0).optional(),
    /** Students already placed at or above this CTC are blocked (dream/super-dream policy). */
    blockIfPlacedAtOrAboveCtcInr: z.number().min(0).optional(),
  }).default({}),
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

export const StudentSkillSnapshotSchema = z.object({
  skillId: z.string().uuid(),
  name: z.string(),
  state: SkillStateSchema,
  level: z.number().int().min(1).max(3).default(1),
  proofLevel: ProofLevelSchema.nullable().optional(),
  validUntil: z.string().datetime().nullable().optional(),
});
export type StudentSkillSnapshot = z.infer<typeof StudentSkillSnapshotSchema>;

/**
 * Everything the evaluator reads, frozen at evaluation time and stored with each decision so it can be
 * reproduced and appealed. `null` means the institution has not supplied the value (→ needs_review).
 */
export const StudentAcademicSnapshotSchema = z.object({
  studentId: z.string(),
  cgpa: z.number().min(0).max(10).nullable(),
  tenthPct: z.number().min(0).max(100).nullable().default(null),
  twelfthPct: z.number().min(0).max(100).nullable().default(null),
  diplomaPct: z.number().min(0).max(100).nullable().default(null),
  gapYears: z.number().int().min(0).nullable().default(0),
  activeBacklogs: z.number().int().min(0).nullable(),
  backlogHistory: z.number().int().min(0).nullable().default(0),
  branch: z.string(),
  graduatingYear: z.number().int(),
  skills: z.array(StudentSkillSnapshotSchema).default([]),
  offersHeld: z.number().int().min(0).default(0),
  highestOfferCtcInr: z.number().min(0).nullable().default(null),
  disciplinaryHold: z.boolean().default(false),
});
export type StudentAcademicSnapshot = z.infer<typeof StudentAcademicSnapshotSchema>;

export const ReasonCodeSchema = z.enum([
  'CRITERIA_MET',
  'INSUFFICIENT_CGPA',
  'INSUFFICIENT_TENTH_PCT',
  'INSUFFICIENT_TWELFTH_OR_DIPLOMA_PCT',
  'EXCESSIVE_GAP_YEARS',
  'EXCESSIVE_BACKLOGS',
  'EXCESSIVE_BACKLOG_HISTORY',
  'BRANCH_INELIGIBLE',
  'GRADUATION_YEAR_MISMATCH',
  'MISSING_REQUIRED_VERIFIED_SKILLS',
  'SKILL_LEVEL_TOO_LOW',
  'SKILL_PROOF_LEVEL_TOO_LOW',
  'SKILL_EXPIRES_BEFORE_DRIVE',
  'OFFER_LIMIT_REACHED',
  'ALREADY_PLACED_AT_OR_ABOVE_CTC',
  'DISCIPLINARY_HOLD',
  'MISSING_DATA',
]);
export type ReasonCode = z.infer<typeof ReasonCodeSchema>;

export const EligibilityCheckSchema = z.object({
  /** Stable check id, e.g. "academics.minCgpa" or "skills.<skillId>". */
  id: z.string(),
  /** true = passed, false = failed, null = could not be evaluated (missing data or needs a human). */
  passed: z.boolean().nullable(),
  reasonCode: ReasonCodeSchema.nullable(),
  /** Plain-language line shown to students, officers and recruiters. */
  message: z.string(),
  /** Whether the student can fix this by producing new proof (used by Proof Path). */
  actionableByProof: z.boolean().default(false),
  /** Template key and values, so the same reason can be shown in the student's language. */
  t: z.object({ key: z.string(), vars: z.record(z.union([z.string(), z.number()])) }).optional(),
});
export type EligibilityCheck = z.infer<typeof EligibilityCheckSchema>;

export const EligibilityStatusSchema = z.enum(['eligible', 'ineligible', 'needs_review']);
export type EligibilityStatus = z.infer<typeof EligibilityStatusSchema>;

export const EligibilityEvaluationResultSchema = z.object({
  eligible: z.boolean(),
  status: EligibilityStatusSchema,
  reasonCodes: z.array(ReasonCodeSchema),
  checks: z.array(EligibilityCheckSchema),
  missingSkills: z.array(z.string()),
  ruleVersionId: z.string().uuid(),
  evaluatedAt: z.string().datetime(),
  inputHash: z.string().length(64),
});
export type EligibilityEvaluationResult = z.infer<typeof EligibilityEvaluationResultSchema>;
