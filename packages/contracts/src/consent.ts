import { z } from 'zod';

export const ConsentPurposeCodeSchema = z.enum([
  'placement_operations',
  'repo_verification',
  'recruiter_sharing',
  'analytics_research',
  'model_evaluation'
]);
export type ConsentPurposeCode = z.infer<typeof ConsentPurposeCodeSchema>;

export const ConsentGrantSchema = z.object({
  id: z.string().uuid(),
  studentId: z.string().uuid(),
  purpose: ConsentPurposeCodeSchema,
  noticeVersion: z.number().int().positive(),
  scope: z.record(z.unknown()).default({}),
  grantedAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable().optional(),
});
export type ConsentGrant = z.infer<typeof ConsentGrantSchema>;

export const CreateConsentGrantRequestSchema = z.object({
  purpose: ConsentPurposeCodeSchema,
  noticeVersion: z.number().int().positive(),
  scope: z.record(z.unknown()).default({}),
});
export type CreateConsentGrantRequest = z.infer<typeof CreateConsentGrantRequestSchema>;

export const RevokeConsentRequestSchema = z.object({
  grantId: z.string().uuid(),
  reason: z.string().optional(),
});
export type RevokeConsentRequest = z.infer<typeof RevokeConsentRequestSchema>;

export const GuardianConsentSchema = z.object({
  id: z.string().uuid(),
  studentId: z.string().uuid(),
  guardianName: z.string().min(2),
  relationship: z.string().min(2),
  verificationRef: z.string(),
  status: z.enum(['pending', 'verified', 'rejected']),
  verifiedAt: z.string().datetime().nullable().optional(),
});
export type GuardianConsent = z.infer<typeof GuardianConsentSchema>;

export const DataRequestTypeSchema = z.enum(['access', 'correction', 'erasure', 'grievance']);
export type DataRequestType = z.infer<typeof DataRequestTypeSchema>;

export const DataRequestSchema = z.object({
  id: z.string().uuid(),
  studentId: z.string().uuid(),
  type: DataRequestTypeSchema,
  status: z.enum(['pending', 'processing', 'completed', 'rejected']),
  dueAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable().optional(),
  exceptionNote: z.string().nullable().optional(),
});
export type DataRequest = z.infer<typeof DataRequestSchema>;

