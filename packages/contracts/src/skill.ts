import { z } from 'zod';

export const SkillStateSchema = z.enum([
  'claimed',
  'observed',
  'evidence_linked',
  'verified',
  'expired'
]);
export type SkillState = z.infer<typeof SkillStateSchema>;

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
  occurredAt: z.string().datetime(),
});
export type SkillStateTransitionEvent = z.infer<typeof SkillStateTransitionEventSchema>;

