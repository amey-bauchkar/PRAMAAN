import { z } from 'zod';

export const AuditEventSchema = z.object({
  id: z.string().uuid(),
  seq: z.number().int().nonnegative(),
  orgId: z.string().uuid(),
  actorType: z.enum(['user', 'system', 'agent', 'service']),
  actorId: z.string().uuid().nullable().optional(),
  action: z.string().min(1),
  objectType: z.string().min(1),
  objectId: z.string().uuid().nullable().optional(),
  metadata: z.record(z.unknown()).default({}),
  prevHash: z.string().length(64),
  hash: z.string().length(64),
  occurredAt: z.string().datetime(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const ProposalKindSchema = z.enum([
  'slot_allocation',
  'jd_skills',
  'intervention_recommendation',
  'support_candidate'
]);
export type ProposalKind = z.infer<typeof ProposalKindSchema>;

export const ProposalStatusSchema = z.enum([
  'pending',
  'approved',
  'rejected',
  'applied',
  'expired'
]);
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;

export const ProposalSchema = z.object({
  id: z.string().uuid(),
  agentRunId: z.string().uuid(),
  kind: ProposalKindSchema,
  payload: z.record(z.unknown()),
  validationResult: z.object({
    valid: z.boolean(),
    errors: z.array(z.string()).optional(),
  }).default({ valid: true }),
  status: ProposalStatusSchema.default('pending'),
  decidedBy: z.string().uuid().nullable().optional(),
  decidedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type Proposal = z.infer<typeof ProposalSchema>;

