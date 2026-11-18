import { z } from 'zod';

export const SkillStateSchema = z.enum([
  'claimed',
  'observed',
  'evidence_linked',
  'verified',
  'expired'
]);
export type SkillState = z.infer<typeof SkillStateSchema>;

/**
 * Proof Levels (PRAMAAN v2 §3.2). A Verified skill always carries the level that says HOW it was verified.
 * - L1_code_backed: substantial code in a consented repository, or an issuer-verified certificate.
 * - L2_assessed:    a platform test score (mock machine test, aptitude section, learning-task acceptance tests).
 * - L3_defended:    Live Mutation Probe or code-grounded viva on the student's own work.
 * - L3_attested:    faculty mentor sign-off against a rubric (labs, hardware, non-code work).
 */
export const ProofLevelSchema = z.enum(['L1_code_backed', 'L2_assessed', 'L3_defended', 'L3_attested']);
export type ProofLevel = z.infer<typeof ProofLevelSchema>;

/** Numeric rank of a proof level; both L3 variants rank equally. */
export const PROOF_LEVEL_RANK: Record<ProofLevel, number> = {
  L1_code_backed: 1,
  L2_assessed: 2,
  L3_defended: 3,
  L3_attested: 3,
};

/** Shorthand used in eligibility rules and recruiter filters ("SQL ≥ L2"). */
export const MinProofSchema = z.enum(['L1', 'L2', 'L3']);
export type MinProof = z.infer<typeof MinProofSchema>;

export function meetsMinProof(level: ProofLevel | null | undefined, min: MinProof): boolean {
  if (!level) return false;
  return PROOF_LEVEL_RANK[level] >= Number(min.slice(1));
}

export const EvidenceStrengthSchema = z.enum(['low', 'medium', 'high']);
export type EvidenceStrength = z.infer<typeof EvidenceStrengthSchema>;

export const SkillSchema = z.object({
  id: z.string().uuid(),
  canonicalName: z.string().min(1).max(100),
  category: z.string().min(1).max(50),
  description: z.string(),
  levelDefinitions: z.record(z.string()).default({
    '1': 'Novice',
    '2': 'Competent',
    '3': 'Proficient'
  }),
  taxonomyVersion: z.string().default('1.0'),
  halfLifeDays: z.number().int().positive().default(365),
});
export type Skill = z.infer<typeof SkillSchema>;

export const StudentSkillSchema = z.object({
  id: z.string().uuid(),
  studentId: z.string().uuid(),
  skillId: z.string().uuid(),
  state: SkillStateSchema,
  stateSince: z.string().datetime(),
  validUntil: z.string().datetime().nullable().optional(),
  evidenceStrength: EvidenceStrengthSchema.default('low'),
  lastVerificationId: z.string().uuid().nullable().optional(),
  proofLevel: ProofLevelSchema.nullable().optional(),
  level: z.number().int().min(1).max(3).optional(),
});
export type StudentSkill = z.infer<typeof StudentSkillSchema>;

export const SkillStateTransitionEventSchema = z.object({
  id: z.string().uuid(),
  studentSkillId: z.string().uuid(),
  fromState: SkillStateSchema,
  toState: SkillStateSchema,
  reasonCode: z.string(),
  actorType: z.enum(['student', 'mentor', 'officer', 'evaluator_service', 'expiry_cron']),
  actorId: z.string().uuid().nullable().optional(),
  verificationId: z.string().uuid().nullable().optional(),
  proofLevel: ProofLevelSchema.nullable().optional(),
  validUntil: z.string().datetime().nullable().optional(),
  occurredAt: z.string().datetime(),
});
export type SkillStateTransitionEvent = z.infer<typeof SkillStateTransitionEventSchema>;
