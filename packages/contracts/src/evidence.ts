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

export const AnchorResolutionStatusSchema = z.enum([
  'RESOLVED',
  'ANCHOR_INVALID',
  'SNAPSHOT_NOT_FOUND',
  'FILE_NOT_FOUND',
  'PARSER_VERSION_UNAVAILABLE',
]);
export type AnchorResolutionStatus = z.infer<typeof AnchorResolutionStatusSchema>;

export const ResolutionDiagnosticSchema = z.object({
  lineEndingMismatch: z.boolean().optional(),
  whitespaceMismatch: z.boolean().optional(),
  reason: z.string().optional(),
  details: z.record(z.unknown()).optional(),
});
export type ResolutionDiagnostic = z.infer<typeof ResolutionDiagnosticSchema>;

export const ResolutionResultSchema = z.object({
  status: AnchorResolutionStatusSchema,
  valid: z.boolean(),
  authoritative: z.boolean().optional(),
  provenance: z.string().optional(),
  anchorId: z.string().uuid().optional(),
  codeSpan: z.string().optional(),
  computedHash: z.string().optional(),
  computedFileHash: z.string().optional(),
  error: z.string().optional(),
  diagnostics: ResolutionDiagnosticSchema.optional(),
});
export type ResolutionResult = z.infer<typeof ResolutionResultSchema>;

export const ExactCodeAnchorSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  studentId: z.string().uuid().optional(),
  evidenceId: z.string().uuid().optional(),
  repositoryId: z.string().uuid(),
  commitSha: z.string().length(40),
  filePath: z.string().min(1),
  path: z.string().min(1).optional(), // Backward-compatibility alias for filePath
  blobSha: z.string().length(40).optional(),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive(),
  byteStart: z.number().int().nonnegative().optional(),
  byteEnd: z.number().int().nonnegative().optional(),
  contentHash: z.string().length(64), // SHA-256 of the exact extracted span
  rawFileHash: z.string().length(64), // Authoritative SHA-256 of the whole raw file
  normalizedContentHash: z.string().length(64).optional(), // Diagnostic normalized hash
  parserName: z.string().min(1),
  parserVersion: z.string().min(1),
  grammarVersion: z.string().optional(),
  createdAt: z.string().datetime(),
  status: AnchorResolutionStatusSchema.default('RESOLVED'),
});
export type ExactCodeAnchor = z.infer<typeof ExactCodeAnchorSchema>;

export const SourceSnapshotSchema = z.object({
  snapshotId: z.string().uuid(),
  orgId: z.string().uuid().optional(), // Tenant organization identifier
  repositoryId: z.string().uuid(),
  commitSha: z.string().length(40),
  filePath: z.string().min(1),
  rawBytes: z.custom<Uint8Array | Buffer | string>(
    (val) => typeof val === 'string' || val instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(val)),
    { message: 'rawBytes must be a string, Buffer, or Uint8Array' }
  ),
  rawFileHash: z.string().length(64), // Authoritative SHA-256
  blobSha: z.string().length(40).optional(),
  capturedAt: z.string().datetime(),
});
export type SourceSnapshot = z.infer<typeof SourceSnapshotSchema>;

export const CodeSymbolLocationSchema = z.object({
  name: z.string(),
  kind: z.enum(['function', 'method', 'class', 'interface', 'block']),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive(),
  byteStart: z.number().int().nonnegative(),
  byteEnd: z.number().int().nonnegative(),
  codeSpan: z.string(),
  contentHash: z.string().length(64),
  containerName: z.string().optional(),
});
export type CodeSymbolLocation = z.infer<typeof CodeSymbolLocationSchema>;

export const ParseResultSchema = z.object({
  success: z.boolean(),
  parserName: z.string(),
  parserVersion: z.string(),
  grammarVersion: z.string().optional(),
  language: z.string(),
  symbols: z.array(CodeSymbolLocationSchema),
  errors: z.array(z.string()),
});
export type ParseResult = z.infer<typeof ParseResultSchema>;

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

