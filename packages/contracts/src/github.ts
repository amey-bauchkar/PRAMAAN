import { z } from 'zod';

export const GitHubConnectInitResponseSchema = z.object({
  url: z.string().url(),
  state: z.string().min(16),
});
export type GitHubConnectInitResponse = z.infer<typeof GitHubConnectInitResponseSchema>;

export const GitHubCallbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(16),
});
export type GitHubCallbackQuery = z.infer<typeof GitHubCallbackQuerySchema>;

export const GitHubConnectionStatusSchema = z.object({
  connected: z.boolean(),
  githubUserId: z.string().optional(),
  githubUsername: z.string().optional(),
  scopes: z.array(z.string()).default([]),
  connectedAt: z.string().datetime().optional(),
  tokenExpiresAt: z.string().datetime().nullable().optional(),
});
export type GitHubConnectionStatus = z.infer<typeof GitHubConnectionStatusSchema>;

export const RepositoryIngestionRequestSchema = z.object({
  owner: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_.-]+$/, 'Invalid GitHub repository owner'),
  repo: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_.-]+$/, 'Invalid GitHub repository name'),
  ref: z.string().min(1).max(100).default('main'),
  repositoryId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
});
export type RepositoryIngestionRequest = z.infer<typeof RepositoryIngestionRequestSchema>;

export const IngestionJobStatusSchema = z.enum([
  'queued',
  'resolving',
  'fetching',
  'verifying',
  'persisted',
  'completed',
  'failed',
]);
export type IngestionJobStatus = z.infer<typeof IngestionJobStatusSchema>;

export const IngestionJobProgressSchema = z.object({
  ingestionId: z.string().uuid(),
  orgId: z.string().uuid(),
  studentId: z.string().uuid(),
  repositoryId: z.string().uuid(),
  owner: z.string(),
  repo: z.string(),
  ref: z.string(),
  commitSha: z.string().length(40).optional(),
  treeSha: z.string().length(40).optional(),
  status: IngestionJobStatusSchema,
  fileCount: z.number().int().nonnegative().default(0),
  retainedBytes: z.number().int().nonnegative().default(0),
  registeredSnapshotsCount: z.number().int().nonnegative().default(0),
  error: z.string().optional(),
  diagnostics: z.record(z.unknown()).optional(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable().optional(),
});
export type IngestionJobProgress = z.infer<typeof IngestionJobProgressSchema>;
