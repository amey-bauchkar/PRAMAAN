import crypto from 'crypto';
import {
  SessionContext,
  TrustedIngestionRecord,
  TrustedFileManifestEntry,
  SourceSnapshot,
  RepositoryIngestionRequest,
  IngestionJobProgress,
} from '@pramaan/contracts';
import {
  ITrustedIngestionStore,
  ISourceSnapshotStore,
  evaluateFileEligibility,
  verifyGitBlob,
  isBinaryContent,
} from '@pramaan/domain';
import { IGitHubClient, GitHubTreeEntry } from './github-client.js';
import { GitHubAccountService } from './github-account-service.js';
import { IConsentRepository } from '../repositories/consent-repository.js';
import { IIngestionJobRepository } from '../repositories/ingestion-job-repository.js';
import { AnchorService } from './anchor-service.js';

export interface IngestionLimits {
  maxFiles?: number;
  maxFileSizeBytes?: number;
  maxTotalBytes?: number;
}

export interface StaticRepoIngestionServiceOptions {
  githubClient: IGitHubClient;
  githubAccountService: GitHubAccountService;
  consentRepo: IConsentRepository;
  trustedIngestionStore: ITrustedIngestionStore;
  snapshotStore: ISourceSnapshotStore;
  anchorService: AnchorService;
  ingestionJobRepo?: IIngestionJobRepository;
  limits?: IngestionLimits;
}

export interface IngestionResult {
  success: boolean;
  ingestionId: string;
  repositoryId: string;
  commitSha: string;
  treeSha: string;
  fileCount: number;
  retainedBytes: number;
  registeredSnapshotsCount: number;
  diagnostics?: Record<string, unknown>;
}

export class StaticRepoIngestionService {
  private githubClient: IGitHubClient;
  private githubAccountService: GitHubAccountService;
  private consentRepo: IConsentRepository;
  private trustedIngestionStore: ITrustedIngestionStore;
  private snapshotStore: ISourceSnapshotStore;
  private anchorService: AnchorService;
  private ingestionJobRepo?: IIngestionJobRepository;

  private maxFiles: number;
  private maxFileSizeBytes: number;
  private maxTotalBytes: number;

  constructor(opts: StaticRepoIngestionServiceOptions) {
    this.githubClient = opts.githubClient;
    this.githubAccountService = opts.githubAccountService;
    this.consentRepo = opts.consentRepo;
    this.trustedIngestionStore = opts.trustedIngestionStore;
    this.snapshotStore = opts.snapshotStore;
    this.anchorService = opts.anchorService;
    this.ingestionJobRepo = opts.ingestionJobRepo;

    this.maxFiles = opts.limits?.maxFiles ?? 500;
    this.maxFileSizeBytes = opts.limits?.maxFileSizeBytes ?? 1024 * 1024; // 1 MB
    this.maxTotalBytes = opts.limits?.maxTotalBytes ?? 10 * 1024 * 1024; // 10 MB
  }

  /**
   * Recursive tree traversal with fallback for GitHub's truncated trees.
   * If a recursive tree lookup returns truncated: true, falls back to
   * non-recursive directory-by-directory traversal.
   */
  private async fetchCompleteTree(
    accessToken: string,
    owner: string,
    repo: string,
    rootTreeSha: string
  ): Promise<GitHubTreeEntry[]> {
    // 1. Attempt single recursive traversal
    const initial = await this.githubClient.getTree(accessToken, owner, repo, rootTreeSha, true);
    if (!initial.truncated) {
      return initial.tree;
    }

    // 2. Truncation detected: Fall back to iterative non-recursive traversal
    const completeEntries: GitHubTreeEntry[] = [];
    const treeQueue: Array<{ prefix: string; sha: string }> = [{ prefix: '', sha: rootTreeSha }];
    const visitedShas = new Set<string>();

    while (treeQueue.length > 0) {
      const current = treeQueue.shift()!;
      if (visitedShas.has(current.sha)) {
        continue; // Cycle protection
      }
      visitedShas.add(current.sha);

      const treeRes = await this.githubClient.getTree(accessToken, owner, repo, current.sha, false);
      for (const item of treeRes.tree) {
        const fullPath = current.prefix ? `${current.prefix}/${item.path}` : item.path;
        if (item.type === 'blob') {
          completeEntries.push({
            ...item,
            path: fullPath,
          });
        } else if (item.type === 'tree') {
          treeQueue.push({
            prefix: fullPath,
            sha: item.sha,
          });
        }
      }
    }

    return completeEntries;
  }

  /**
   * Main entrypoint for Static Repository Ingestion.
   * Enforces strict consent-before-fetch, server-controlled verification, and durable persistence.
   */
  public async ingestRepository(
    context: SessionContext,
    request: RepositoryIngestionRequest
  ): Promise<IngestionResult> {
    const orgId = context.orgId;
    if (!orgId) {
      throw new Error('TENANT_CONTEXT_REQUIRED: Cannot ingest repository without active tenant.');
    }

    // 1. Resolve student ownership
    const targetStudentId = context.role === 'student' ? context.userId : (request.studentId || context.userId);
    if (!targetStudentId) {
      throw new Error('STUDENT_OWNERSHIP_REQUIRED: Ingestion requires an identified student owner.');
    }

    // Role check: If caller is student, cannot ingest for other students
    if (context.role === 'student' && context.userId !== targetStudentId) {
      throw new Error('FORBIDDEN_STUDENT_ACCESS: Students can only ingest repositories for their own account.');
    }

    const repositoryId = request.repositoryId || crypto.randomUUID();
    const ingestionId = crypto.randomUUID();

    // 2. Initialize tracking job if outbox/job repo is available
    if (this.ingestionJobRepo) {
      const initialJob: IngestionJobProgress = {
        ingestionId,
        orgId,
        studentId: targetStudentId,
        repositoryId,
        owner: request.owner,
        repo: request.repo,
        ref: request.ref,
        status: 'queued',
        fileCount: 0,
        retainedBytes: 0,
        registeredSnapshotsCount: 0,
        createdAt: new Date().toISOString(),
      };
      await this.ingestionJobRepo.createJob(initialJob);
    }

    // 3. PHASE 4: CONSENT-BEFORE-FETCH ENFORCEMENT
    // Must verify active purpose-specific 'repo_verification' consent BEFORE ANY GITHUB API CALL!
    let hasConsent: boolean;
    try {
      hasConsent = await this.consentRepo.hasActiveConsent(context, targetStudentId, 'repo_verification');
    } catch (err: any) {
      if (this.ingestionJobRepo) {
        await this.ingestionJobRepo.updateJob(context, ingestionId, 'failed', {
          error: `CONSENT_SERVICE_UNAVAILABLE: ${err.message}`,
        });
      }
      throw new Error(`CONSENT_SERVICE_UNAVAILABLE: Failed to evaluate consent for student '${targetStudentId}': ${err.message}`, {
        cause: err,
      });
    }

    if (!hasConsent) {
      if (this.ingestionJobRepo) {
        await this.ingestionJobRepo.updateJob(context, ingestionId, 'failed', {
          error: `CONSENT_REQUIRED_OR_REVOKED: Student '${targetStudentId}' has not granted active consent for purpose 'repo_verification'`,
        });
      }
      throw new Error(
        `CONSENT_REQUIRED_OR_REVOKED: Student '${targetStudentId}' has not granted active consent for purpose 'repo_verification'`
      );
    }

    // 4. Resolve authenticated GitHub access token
    let accessToken: string;
    try {
      accessToken = await this.githubAccountService.getDecryptedAccessToken(context, targetStudentId);
    } catch (err: any) {
      if (this.ingestionJobRepo) {
        await this.ingestionJobRepo.updateJob(context, ingestionId, 'failed', {
          error: err.message,
        });
      }
      throw err;
    }

    // 5. Verify repository access permissions
    const access = await this.githubClient.verifyRepositoryAccess(accessToken, request.owner, request.repo);
    if (!access.accessible) {
      const msg = `REPOSITORY_ACCESS_DENIED: Linked GitHub account does not have access to ${request.owner}/${request.repo}`;
      if (this.ingestionJobRepo) {
        await this.ingestionJobRepo.updateJob(context, ingestionId, 'failed', { error: msg });
      }
      throw new Error(msg);
    }

    // 6. Commit & Tree Resolution
    if (this.ingestionJobRepo) {
      await this.ingestionJobRepo.updateJob(context, ingestionId, 'resolving');
    }

    const commitInfo = await this.githubClient.resolveCommit(
      accessToken,
      request.owner,
      request.repo,
      request.ref
    );
    const commitSha = commitInfo.commitSha;
    const treeSha = commitInfo.treeSha;

    // 7. Complete Tree Traversal
    if (this.ingestionJobRepo) {
      await this.ingestionJobRepo.updateJob(context, ingestionId, 'fetching', {
        commitSha,
        treeSha,
      });
    }

    const treeEntries = await this.fetchCompleteTree(accessToken, request.owner, request.repo, treeSha);

    // 8. Filter file entries
    const eligibleEntries: Array<{ entry: GitHubTreeEntry; canonicalPath: string }> = [];
    const excludedDiagnostics: Record<string, string> = {};

    for (const entry of treeEntries) {
      if (entry.type !== 'blob') continue;

      const evalRes = evaluateFileEligibility(entry.path, entry.mode);
      if (evalRes.eligible && evalRes.canonicalPath) {
        eligibleEntries.push({
          entry,
          canonicalPath: evalRes.canonicalPath,
        });
      } else {
        excludedDiagnostics[entry.path] = evalRes.reason || 'EXCLUDED';
      }
    }

    if (eligibleEntries.length > this.maxFiles) {
      const msg = `FILE_COUNT_LIMIT_EXCEEDED: Repository contains ${eligibleEntries.length} eligible files, exceeding limit of ${this.maxFiles}`;
      if (this.ingestionJobRepo) {
        await this.ingestionJobRepo.updateJob(context, ingestionId, 'failed', { error: msg });
      }
      throw new Error(msg);
    }

    // 9. Fetch & Cryptographically Verify Each File
    if (this.ingestionJobRepo) {
      await this.ingestionJobRepo.updateJob(context, ingestionId, 'verifying', {
        fileCount: eligibleEntries.length,
      });
    }

    const manifestEntries: TrustedFileManifestEntry[] = [];
    const verifiedSnapshots: SourceSnapshot[] = [];
    let totalRetainedBytes = 0;

    for (const { entry, canonicalPath } of eligibleEntries) {
      // Fetch blob
      const blobRes = await this.githubClient.getBlob(
        accessToken,
        request.owner,
        request.repo,
        entry.sha
      );

      const rawBytes =
        blobRes.encoding === 'base64'
          ? Buffer.from(blobRes.content, 'base64')
          : Buffer.from(blobRes.content, 'utf8');

      // Check for binary content
      if (isBinaryContent(rawBytes)) {
        excludedDiagnostics[canonicalPath] = 'EXCLUDED_BINARY_CONTENT: Null bytes detected in source';
        continue;
      }

      // Check file size limit
      if (rawBytes.length > this.maxFileSizeBytes) {
        excludedDiagnostics[canonicalPath] = `EXCLUDED_FILE_SIZE: Size ${rawBytes.length} exceeds limit ${this.maxFileSizeBytes}`;
        continue;
      }

      totalRetainedBytes += rawBytes.length;
      if (totalRetainedBytes > this.maxTotalBytes) {
        const msg = `TOTAL_SIZE_LIMIT_EXCEEDED: Total retained bytes ${totalRetainedBytes} exceeds limit ${this.maxTotalBytes}`;
        if (this.ingestionJobRepo) {
          await this.ingestionJobRepo.updateJob(context, ingestionId, 'failed', { error: msg });
        }
        throw new Error(msg);
      }

      // Cryptographic Git blob SHA-1 & raw SHA-256 verification
      const verifyRes = verifyGitBlob(rawBytes, entry.sha);
      if (!verifyRes.valid) {
        const msg = `BLOB_VERIFICATION_FAILED for file '${canonicalPath}': ${verifyRes.reason}`;
        if (this.ingestionJobRepo) {
          await this.ingestionJobRepo.updateJob(context, ingestionId, 'failed', { error: msg });
        }
        throw new Error(msg);
      }

      const manifestEntry: TrustedFileManifestEntry = {
        filePath: canonicalPath,
        blobSha: verifyRes.blobSha,
        rawFileHash: verifyRes.rawFileHash,
        byteSize: verifyRes.byteSize,
      };
      manifestEntries.push(manifestEntry);

      const snapshot: SourceSnapshot = {
        snapshotId: crypto.randomUUID(),
        orgId,
        studentId: targetStudentId,
        repositoryId,
        commitSha,
        filePath: canonicalPath,
        rawBytes,
        rawFileHash: verifyRes.rawFileHash,
        blobSha: verifyRes.blobSha,
        capturedAt: new Date().toISOString(),
        provenance: 'trusted_ingestion_pipeline',
        ingestionId,
        registrationState: 'pending_audit',
      };
      verifiedSnapshots.push(snapshot);
    }

    // 10. RECHECK CONSENT IMMEDIATELY BEFORE DURABLE PERSISTENCE
    let prePersistConsent: boolean;
    try {
      prePersistConsent = await this.consentRepo.hasActiveConsent(context, targetStudentId, 'repo_verification');
    } catch (err: any) {
      if (this.ingestionJobRepo) {
        await this.ingestionJobRepo.updateJob(context, ingestionId, 'failed', {
          error: `CONSENT_SERVICE_UNAVAILABLE_PRE_PERSIST: ${err.message}`,
        });
      }
      throw new Error(`CONSENT_SERVICE_UNAVAILABLE_PRE_PERSIST: ${err.message}`, { cause: err });
    }

    if (!prePersistConsent) {
      // Discard in-memory data immediately, do not persist!
      const msg = `CONSENT_REVOKED_DURING_INGESTION: Active consent for student '${targetStudentId}' was revoked prior to persistence`;
      if (this.ingestionJobRepo) {
        await this.ingestionJobRepo.updateJob(context, ingestionId, 'failed', { error: msg });
      }
      throw new Error(msg);
    }

    // 11. Create & Persist Trusted Ingestion Record
    const verifiedRecord: TrustedIngestionRecord = {
      ingestionId,
      orgId,
      repositoryId,
      commitSha,
      treeSha,
      studentId: targetStudentId,
      verifiedAt: new Date().toISOString(),
      provenance: 'trusted_ingestion_pipeline',
      manifest: manifestEntries,
    };

    if (this.ingestionJobRepo) {
      await this.ingestionJobRepo.updateJob(context, ingestionId, 'persisted', {
        retainedBytes: totalRetainedBytes,
        fileCount: verifiedSnapshots.length,
      });
    }

    await this.trustedIngestionStore.saveRecord(verifiedRecord);

    // 12. Register Snapshots via AnchorService authoritative flow
    let registeredCount = 0;
    for (const snapshot of verifiedSnapshots) {
      await this.anchorService.registerTrustedSnapshot(context, verifiedRecord, snapshot);
      registeredCount++;
    }

    // 13. Mark Job Completed
    if (this.ingestionJobRepo) {
      await this.ingestionJobRepo.updateJob(context, ingestionId, 'completed', {
        registeredSnapshotsCount: registeredCount,
        completedAt: new Date().toISOString(),
        diagnostics: {
          excludedFilesCount: Object.keys(excludedDiagnostics).length,
          sampleExcluded: Object.entries(excludedDiagnostics).slice(0, 10),
        },
      });
    }

    return {
      success: true,
      ingestionId,
      repositoryId,
      commitSha,
      treeSha,
      fileCount: verifiedSnapshots.length,
      retainedBytes: totalRetainedBytes,
      registeredSnapshotsCount: registeredCount,
      diagnostics: {
        excludedCount: Object.keys(excludedDiagnostics).length,
      },
    };
  }

  /**
   * Retrieves ingestion job progress by ID.
   */
  public async getJob(
    context: SessionContext,
    ingestionId: string
  ): Promise<IngestionJobProgress | null> {
    if (!this.ingestionJobRepo) {
      return null;
    }
    return this.ingestionJobRepo.getJob(context, ingestionId);
  }
}
