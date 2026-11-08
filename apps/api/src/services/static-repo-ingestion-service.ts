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
import { IRepositoryRepository } from '../repositories/repository-repository.js';
import { ITenantRepository } from '../repositories/tenant-repository.js';
import { AnchorService } from './anchor-service.js';

export interface IngestionLimits {
  maxFiles?: number;
  maxFileSizeBytes?: number;
  maxTotalBytes?: number;
  maxTreeEntries?: number;
  maxDirectoryTraversals?: number;
  maxTreeApiRequests?: number;
  maxWallClockMs?: number;
}

export interface EligibleTreeEntry {
  entry: GitHubTreeEntry;
  canonicalPath: string;
}

export interface BoundedTraversalResult {
  eligibleEntries: EligibleTreeEntry[];
  excludedDiagnostics: Record<string, string>;
  totalTreeEntries: number;
  directoriesTraversed: number;
  apiRequestsCount: number;
}

export interface StaticRepoIngestionServiceOptions {
  githubClient: IGitHubClient;
  githubAccountService: GitHubAccountService;
  consentRepo: IConsentRepository;
  trustedIngestionStore: ITrustedIngestionStore;
  snapshotStore: ISourceSnapshotStore;
  anchorService: AnchorService;
  ingestionJobRepo?: IIngestionJobRepository;
  repositoryRepo?: IRepositoryRepository;
  tenantRepo?: ITenantRepository;
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
  private repositoryRepo?: IRepositoryRepository;
  private tenantRepo?: ITenantRepository;

  private maxFiles: number;
  private maxFileSizeBytes: number;
  private maxTotalBytes: number;
  private maxTreeEntries: number;
  private maxDirectoryTraversals: number;
  private maxTreeApiRequests: number;
  private maxWallClockMs: number;

  constructor(opts: StaticRepoIngestionServiceOptions) {
    this.githubClient = opts.githubClient;
    this.githubAccountService = opts.githubAccountService;
    this.consentRepo = opts.consentRepo;
    this.trustedIngestionStore = opts.trustedIngestionStore;
    this.snapshotStore = opts.snapshotStore;
    this.anchorService = opts.anchorService;
    this.ingestionJobRepo = opts.ingestionJobRepo;
    this.repositoryRepo = opts.repositoryRepo;
    this.tenantRepo = opts.tenantRepo;

    this.maxFiles = opts.limits?.maxFiles ?? 200;
    this.maxFileSizeBytes = opts.limits?.maxFileSizeBytes ?? 512 * 1024; // 512 KB
    this.maxTotalBytes = opts.limits?.maxTotalBytes ?? 10 * 1024 * 1024; // 10 MB
    this.maxTreeEntries = opts.limits?.maxTreeEntries ?? 5000;
    this.maxDirectoryTraversals = opts.limits?.maxDirectoryTraversals ?? 100;
    this.maxTreeApiRequests = opts.limits?.maxTreeApiRequests ?? 30;
    this.maxWallClockMs = opts.limits?.maxWallClockMs ?? 30000;
  }

  /**
   * Bounded GitHub Tree Traversal.
   * Enforces configurable budgets across:
   * - Maximum total tree entries parsed (maxTreeEntries).
   * - Maximum directory traversals during fallback (maxDirectoryTraversals).
   * - Maximum tree API requests to GitHub (maxTreeApiRequests).
   * - Maximum eligible source files (maxFiles) with immediate early termination.
   * - Never constructs an unbounded in-memory list of repository entries.
   */
  private async fetchBoundedEligibleEntries(
    accessToken: string,
    owner: string,
    repo: string,
    rootTreeSha: string,
    signal?: AbortSignal
  ): Promise<BoundedTraversalResult> {
    let apiRequestsCount = 0;
    let directoriesTraversed = 0;
    let totalTreeEntries = 0;
    const eligibleEntries: EligibleTreeEntry[] = [];
    const excludedDiagnostics: Record<string, string> = {};

    // 1. Attempt single recursive traversal with budget checks
    apiRequestsCount++;
    if (apiRequestsCount > this.maxTreeApiRequests) {
      throw new Error(`TREE_API_BUDGET_EXCEEDED: Exceeded GitHub tree API request budget of ${this.maxTreeApiRequests}`);
    }

    const initial = await this.githubClient.getTree(accessToken, owner, repo, rootTreeSha, true, signal);

    if (!initial.truncated) {
      totalTreeEntries = initial.tree.length;
      if (totalTreeEntries > this.maxTreeEntries) {
        throw new Error(
          `TREE_ENTRY_BUDGET_EXCEEDED: Repository tree contains ${totalTreeEntries} entries, exceeding budget of ${this.maxTreeEntries}`
        );
      }

      for (const entry of initial.tree) {
        if (entry.type !== 'blob') continue;

        if (entry.size !== undefined && entry.size > this.maxFileSizeBytes) {
          excludedDiagnostics[entry.path] = `EXCLUDED_FILE_SIZE: Declared size ${entry.size} exceeds limit ${this.maxFileSizeBytes}`;
          continue;
        }

        const evalRes = evaluateFileEligibility(entry.path, entry.mode);
        if (evalRes.eligible && evalRes.canonicalPath) {
          eligibleEntries.push({
            entry,
            canonicalPath: evalRes.canonicalPath,
          });
          // Early termination: abort immediately if eligible files budget is exceeded
          if (eligibleEntries.length > this.maxFiles) {
            throw new Error(
              `FILE_COUNT_LIMIT_EXCEEDED: Repository contains more than ${this.maxFiles} eligible files, exceeding limit of ${this.maxFiles}`
            );
          }
        } else {
          excludedDiagnostics[entry.path] = evalRes.reason || 'EXCLUDED';
        }
      }

      return {
        eligibleEntries,
        excludedDiagnostics,
        totalTreeEntries,
        directoriesTraversed: 0,
        apiRequestsCount,
      };
    }

    // 2. Truncation detected: Bounded iterative directory-by-directory traversal
    const treeQueue: Array<{ prefix: string; sha: string }> = [{ prefix: '', sha: rootTreeSha }];
    const visitedShas = new Set<string>();

    while (treeQueue.length > 0) {
      if (signal?.aborted) {
        throw new Error(`INGESTION_TIMEOUT: Traversal exceeded wall-clock duration budget of ${this.maxWallClockMs}ms`);
      }

      if (directoriesTraversed >= this.maxDirectoryTraversals) {
        throw new Error(
          `DIRECTORY_TRAVERSAL_BUDGET_EXCEEDED: Directory traversal budget of ${this.maxDirectoryTraversals} exceeded`
        );
      }

      if (apiRequestsCount >= this.maxTreeApiRequests) {
        throw new Error(
          `TREE_API_BUDGET_EXCEEDED: GitHub tree API request budget of ${this.maxTreeApiRequests} exceeded`
        );
      }

      const current = treeQueue.shift()!;
      if (visitedShas.has(current.sha)) {
        continue; // Cycle protection
      }
      visitedShas.add(current.sha);

      apiRequestsCount++;
      directoriesTraversed++;
      const treeRes = await this.githubClient.getTree(accessToken, owner, repo, current.sha, false, signal);

      for (const item of treeRes.tree) {
        totalTreeEntries++;
        if (totalTreeEntries > this.maxTreeEntries) {
          throw new Error(
            `TREE_ENTRY_BUDGET_EXCEEDED: Repository tree entries reached ${totalTreeEntries}, exceeding budget of ${this.maxTreeEntries}`
          );
        }

        const fullPath = current.prefix ? `${current.prefix}/${item.path}` : item.path;

        if (item.type === 'tree') {
          treeQueue.push({
            prefix: fullPath,
            sha: item.sha,
          });
        } else if (item.type === 'blob') {
          if (item.size !== undefined && item.size > this.maxFileSizeBytes) {
            excludedDiagnostics[fullPath] = `EXCLUDED_FILE_SIZE: Declared size ${item.size} exceeds limit ${this.maxFileSizeBytes}`;
            continue;
          }

          const evalRes = evaluateFileEligibility(fullPath, item.mode);
          if (evalRes.eligible && evalRes.canonicalPath) {
            eligibleEntries.push({
              entry: {
                ...item,
                path: fullPath,
              },
              canonicalPath: evalRes.canonicalPath,
            });

            // Early termination check on each discovered file
            if (eligibleEntries.length > this.maxFiles) {
              throw new Error(
                `FILE_COUNT_LIMIT_EXCEEDED: Repository contains more than ${this.maxFiles} eligible files, exceeding limit of ${this.maxFiles}`
              );
            }
          } else {
            excludedDiagnostics[fullPath] = evalRes.reason || 'EXCLUDED';
          }
        }
      }
    }

    return {
      eligibleEntries,
      excludedDiagnostics,
      totalTreeEntries,
      directoriesTraversed,
      apiRequestsCount,
    };
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
    const targetStudentId = request.studentId;
    if (!targetStudentId) {
      throw new Error('STUDENT_OWNERSHIP_REQUIRED: Ingestion requires an identified student owner.');
    }

    // Role check: If caller is student and tenantRepo is available, enforce ownership against student record
    if (context.role === 'student' && this.tenantRepo) {
      const student = await this.tenantRepo.getStudentByUserId(context, context.userId);
      if (!student || student.id !== targetStudentId) {
        throw new Error('FORBIDDEN_STUDENT_ACCESS: Students can only ingest repositories for their own account.');
      }
    }

    const ingestionId = crypto.randomUUID();
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort(
        new Error(`INGESTION_TIMEOUT: Ingestion exceeded wall-clock duration budget of ${this.maxWallClockMs}ms`)
      );
    }, this.maxWallClockMs);

    try {
      // 2. PHASE 4: CONSENT-BEFORE-FETCH ENFORCEMENT
      // Must verify active purpose-specific 'repo_verification' consent BEFORE ANY GITHUB API CALL!
      let activeGrant: any;
      try {
        activeGrant = await this.consentRepo.getActiveGrant(context, targetStudentId, 'repo_verification');
      } catch (err: any) {
        throw new Error(`CONSENT_SERVICE_UNAVAILABLE: Failed to evaluate consent for student '${targetStudentId}': ${err.message}`, {
          cause: err,
        });
      }

      if (!activeGrant) {
        throw new Error(
          `CONSENT_REQUIRED_OR_REVOKED: Student '${targetStudentId}' has not granted active consent for purpose 'repo_verification'`
        );
      }

      // 3. Resolve authenticated GitHub access token
      const accessToken = await this.githubAccountService.getDecryptedAccessToken(context, targetStudentId);

      // 4. Verify repository access permissions
      const access = await this.githubClient.verifyRepositoryAccess(
        accessToken,
        request.owner,
        request.repo,
        abortController.signal
      );
      if (!access.accessible) {
        throw new Error(`REPOSITORY_ACCESS_DENIED: Linked GitHub account does not have access to ${request.owner}/${request.repo}`);
      }

      // 5. Option B: Reject private repositories under public-repository-only architecture
      if (access.isPrivate) {
        throw new Error(
          'PRIVATE_REPOSITORY_NOT_SUPPORTED: Private repository ingestion requires GitHub App installation. Only public repositories are supported in this release.'
        );
      }

      // 6. Resolve or create canonical repository record in database
      if (!this.repositoryRepo) {
        throw new Error(
          'REPOSITORY_REPOSITORY_REQUIRED: Cannot ingest repository without configured IRepositoryRepository.'
        );
      }
      const repoRecord = await this.repositoryRepo.getOrCreateRepository(context, {
        studentId: targetStudentId,
        providerRepoId: String(access.repoId),
        url: `https://github.com/${request.owner}/${request.repo}`,
        defaultBranch: access.defaultBranch || request.ref || 'main',
        consentGrantId: activeGrant.id,
        requestedRepositoryId: request.repositoryId,
      });
      const repositoryId = repoRecord.id;

      // 7. Initialize tracking job if outbox/job repo is available
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

      // 8. Commit & Tree Resolution
      if (this.ingestionJobRepo) {
        await this.ingestionJobRepo.updateJob(context, ingestionId, 'resolving');
      }

      const commitInfo = await this.githubClient.resolveCommit(
        accessToken,
        request.owner,
        request.repo,
        request.ref,
        abortController.signal
      );
      const commitSha = commitInfo.commitSha;
      const treeSha = commitInfo.treeSha;

      // 9. Bounded Tree Traversal
      if (this.ingestionJobRepo) {
        await this.ingestionJobRepo.updateJob(context, ingestionId, 'fetching', {
          commitSha,
          treeSha,
        });
      }

      const { eligibleEntries, excludedDiagnostics } = await this.fetchBoundedEligibleEntries(
        accessToken,
        request.owner,
        request.repo,
        treeSha,
        abortController.signal
      );

      // 10. Fetch & Cryptographically Verify Each File
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
          entry.sha,
          abortController.signal
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

        // Check file size limit after download
        if (rawBytes.length > this.maxFileSizeBytes) {
          excludedDiagnostics[canonicalPath] = `EXCLUDED_FILE_SIZE: Size ${rawBytes.length} exceeds limit ${this.maxFileSizeBytes}`;
          continue;
        }

        // Enforce aggregate retained bytes limit
        if (totalRetainedBytes + rawBytes.length > this.maxTotalBytes) {
          throw new Error(
            `TOTAL_SIZE_LIMIT_EXCEEDED: Total retained bytes would reach ${totalRetainedBytes + rawBytes.length}, exceeding limit of ${this.maxTotalBytes}`
          );
        }
        totalRetainedBytes += rawBytes.length;

        // Cryptographic Git blob SHA-1 & raw SHA-256 verification
        const verifyRes = verifyGitBlob(rawBytes, entry.sha);
        if (!verifyRes.valid) {
          throw new Error(`BLOB_VERIFICATION_FAILED for file '${canonicalPath}': ${verifyRes.reason}`);
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
        throw new Error(`CONSENT_SERVICE_UNAVAILABLE_PRE_PERSIST: ${err.message}`, { cause: err });
      }

      if (!prePersistConsent) {
        // Discard in-memory data immediately, do not persist!
        throw new Error(`CONSENT_REVOKED_DURING_INGESTION: Active consent for student '${targetStudentId}' was revoked prior to persistence`);
      }

      // 11. Create & Persist Trusted Ingestion Record
      const existingRecord = await this.trustedIngestionStore.getRecord(
        orgId,
        repositoryId,
        commitSha,
        targetStudentId
      );

      const verifiedRecord: TrustedIngestionRecord = {
        ingestionId: existingRecord ? existingRecord.ingestionId : ingestionId,
        orgId,
        repositoryId,
        commitSha,
        treeSha,
        studentId: targetStudentId,
        verifiedAt: existingRecord ? existingRecord.verifiedAt : new Date().toISOString(),
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
      const anchorContext: SessionContext = {
        ...context,
        userId: context.role === 'student' ? targetStudentId : context.userId,
        actorUserId: context.userId,
      };
      for (const snapshot of verifiedSnapshots) {
        await this.anchorService.registerTrustedSnapshot(anchorContext, verifiedRecord, snapshot);
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
    } catch (err: any) {
      const errorMessage =
        abortController.signal.aborted && abortController.signal.reason?.message
          ? abortController.signal.reason.message
          : err.name === 'AbortError'
          ? `INGESTION_TIMEOUT: Ingestion exceeded wall-clock duration budget of ${this.maxWallClockMs}ms`
          : err.message;

      if (this.ingestionJobRepo) {
        try {
          await this.ingestionJobRepo.updateJob(context, ingestionId, 'failed', {
            error: errorMessage,
          });
        } catch {
          // preserve original error
        }
      }
      throw new Error(errorMessage, { cause: err });
    } finally {
      clearTimeout(timeoutId);
    }
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
