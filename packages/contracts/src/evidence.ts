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

/**
 * Validates and normalizes repository-relative source file paths.
 * Enforces canonical representation and rejects traversal, absolute paths, null bytes, and empty paths.
 */
export function normalizeFilePath(filePath: string): string {
  if (typeof filePath !== 'string' || filePath.trim().length === 0) {
    throw new Error('INVALID_FILE_PATH: File path cannot be empty or whitespace');
  }

  // Reject null bytes
  if (filePath.includes('\0')) {
    throw new Error('INVALID_FILE_PATH: File path contains null bytes');
  }

  // Reject Windows drive paths (e.g. C:, D:)
  if (/^[a-zA-Z]:/.test(filePath)) {
    throw new Error('INVALID_FILE_PATH: Absolute Windows drive paths are prohibited');
  }

  // Reject absolute paths starting with / or \
  if (filePath.startsWith('/') || filePath.startsWith('\\')) {
    throw new Error('INVALID_FILE_PATH: Absolute paths are prohibited');
  }

  // Convert backslashes to forward slashes
  const unified = filePath.replace(/\\/g, '/');

  // Check for duplicate separators
  if (unified.includes('//')) {
    throw new Error('INVALID_FILE_PATH: Duplicate path separators are prohibited');
  }

  // Check for path traversal components
  const segments = unified.split('/');
  for (const seg of segments) {
    if (seg === '..' || seg === '.') {
      throw new Error(`INVALID_FILE_PATH: Path traversal segment '${seg}' is prohibited`);
    }
    if (seg.trim().length === 0) {
      throw new Error('INVALID_FILE_PATH: Empty path segments are prohibited');
    }
  }

  return unified;
}

export const CanonicalFilePathSchema = z.string().min(1).refine(
  (val) => {
    try {
      normalizeFilePath(val);
      return true;
    } catch {
      return false;
    }
  },
  { message: 'filePath must be a valid canonical repository-relative path without traversal sequences' }
);

export const SnapshotRegistrationStateSchema = z.enum([
  'pending_audit',
  'audit_committed',
  'quarantined',
]);
export type SnapshotRegistrationState = z.infer<typeof SnapshotRegistrationStateSchema>;

export const SourceSnapshotSchema = z.object({
  snapshotId: z.string().uuid(),
  orgId: z.string().uuid().optional(), // Tenant organization identifier
  studentId: z.string().uuid().optional(), // Student owner identifier where applicable
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
  provenance: z.enum(['unverified_client_input', 'trusted_ingestion_pipeline']).default('unverified_client_input').optional(),
  ingestionId: z.string().uuid().optional(),
  registrationState: SnapshotRegistrationStateSchema.optional(),
}).superRefine((val, ctx) => {
  if (val.provenance === 'trusted_ingestion_pipeline') {
    if (!val.blobSha || !/^[0-9a-fA-F]{40}$/.test(val.blobSha)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'blobSha is required and must be a 40-character Git SHA for trusted ingestion pipeline snapshots',
        path: ['blobSha'],
      });
    }
  }
});
export type SourceSnapshot = z.infer<typeof SourceSnapshotSchema>;

export const TrustedFileManifestEntrySchema = z.object({
  filePath: CanonicalFilePathSchema,
  blobSha: z.string().regex(/^[0-9a-fA-F]{40}$/, 'blobSha must be a 40-character hex string'),
  rawFileHash: z.string().regex(/^[0-9a-fA-F]{64}$/, 'rawFileHash must be a 64-character SHA-256 hex string'),
  byteSize: z.number().int().nonnegative(),
});
export type TrustedFileManifestEntry = z.infer<typeof TrustedFileManifestEntrySchema>;

export const TrustedIngestionRecordSchema = z.object({
  ingestionId: z.string().uuid(),
  orgId: z.string().uuid(),
  repositoryId: z.string().uuid(),
  commitSha: z.string().regex(/^[0-9a-fA-F]{40}$/, 'commitSha must be a 40-character hex string'),
  treeSha: z.string().regex(/^[0-9a-fA-F]{40}$/, 'treeSha must be a 40-character hex string'),
  studentId: z.string().uuid(),
  verifiedAt: z.string().datetime(),
  provenance: z.literal('trusted_ingestion_pipeline').default('trusted_ingestion_pipeline'),
  manifest: z.array(TrustedFileManifestEntrySchema).default([]),
  consentGrantId: z.string().uuid().optional(),
  status: z.enum(['persisted', 'revoked']).optional(),
}).superRefine((record, ctx) => {
  const seenPaths = new Set<string>();
  for (let i = 0; i < record.manifest.length; i++) {
    const entry = record.manifest[i];
    try {
      const canonical = normalizeFilePath(entry.filePath);
      if (seenPaths.has(canonical)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate canonical file path in manifest: '${canonical}'`,
          path: ['manifest', i, 'filePath'],
        });
      }
      seenPaths.add(canonical);
    } catch (err: any) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid manifest file path: ${err.message}`,
        path: ['manifest', i, 'filePath'],
      });
    }
  }
});
export type TrustedIngestionRecord = z.infer<typeof TrustedIngestionRecordSchema>;

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

