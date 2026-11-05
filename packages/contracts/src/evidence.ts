import { z } from 'zod';

export const EvidenceKindSchema = z.enum([
  'code_span',
  'commit',
  'test_result',
  'lab',
  'competition',
  'certificate',
  'mentor_attestation',
  'external_profile'
]);
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

export const EvidenceStatusSchema = z.enum([
  'submitted',
  'accepted',
  'rejected',
  'withdrawn',
  'expired'
]);
export type EvidenceStatus = z.infer<typeof EvidenceStatusSchema>;

export const CodeAnchorSchema = z.object({
  commitSha: z.string().length(40),
  path: z.string().min(1),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive(),
  contentHash: z.string().length(64), // SHA-256
});
export type CodeAnchor = z.infer<typeof CodeAnchorSchema>;

export const EvidenceItemSchema = z.object({
  id: z.string().uuid(),
  studentId: z.string().uuid(),
  kind: EvidenceKindSchema,
  repoSnapshotId: z.string().uuid().nullable().optional(),
  path: z.string().nullable().optional(),
  lineStart: z.number().int().positive().nullable().optional(),
  lineEnd: z.number().int().positive().nullable().optional(),
  contentHash: z.string().length(64),
  objectKey: z.string().nullable().optional(),
  status: EvidenceStatusSchema,
  acceptedBy: z.string().uuid().nullable().optional(),
  acceptedAt: z.string().datetime().nullable().optional(),
  validUntil: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export const AttestationSchema = z.object({
  id: z.string().uuid(),
  evidenceId: z.string().uuid(),
  mentorMembershipId: z.string().uuid(),
  rubricVersionId: z.string().uuid(),
  scopeText: z.string().min(10),
  rubricScores: z.record(z.number()),
  validUntil: z.string().datetime(),
  createdAt: z.string().datetime(),
});
export type Attestation = z.infer<typeof AttestationSchema>;

export const ProbeRunResultSchema = z.object({
  probeId: z.string().uuid(),
  passed: z.boolean(),
  exitCode: z.number().int(),
  executionTimeMs: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  testSummary: z.object({
    total: z.number().int(),
    passed: z.number().int(),
    failed: z.number().int(),
  }),
});
export type ProbeRunResult = z.infer<typeof ProbeRunResultSchema>;

