import {
  ExactCodeAnchor,
  SourceSnapshot,
  ResolutionResult,
  SessionContext,
  ParseResult,
  TrustedIngestionRecord,
  TrustedIngestionRecordSchema,
} from '@pramaan/contracts';
import {
  AnchorResolver,
  ISourceSnapshotStore,
  InMemorySourceSnapshotStore,
  ITrustedIngestionStore,
  ParserRegistry,
  normalizeFilePath,
} from '@pramaan/domain';
import { IAuditRepository } from '../repositories/audit-repository.js';
import { IConsentRepository } from '../repositories/consent-repository.js';

export interface AnchorServiceOptions {
  auditRepo: IAuditRepository;
  consentRepo?: IConsentRepository;
  snapshotStore?: ISourceSnapshotStore;
  parserRegistry?: ParserRegistry;
  isProduction?: boolean;
  trustedIngestionStore?: ITrustedIngestionStore;
}

export interface ResolveAnchorOptions {
  allowDiagnosticSnapshot?: boolean;
  authoritative?: boolean;
}

export class AnchorService {
  private snapshotStore: ISourceSnapshotStore;
  private auditRepo: IAuditRepository;
  private consentRepo?: IConsentRepository;
  private parserRegistry: ParserRegistry;
  private isProduction: boolean;
  private trustedIngestionStore?: ITrustedIngestionStore;
  private registrationQueues = new Map<string, Promise<void>>();

  constructor(opts: AnchorServiceOptions) {
    this.auditRepo = opts.auditRepo;
    this.consentRepo = opts.consentRepo;
    this.snapshotStore = opts.snapshotStore || new InMemorySourceSnapshotStore();
    this.parserRegistry = opts.parserRegistry || ParserRegistry.getInstance();
    this.isProduction = opts.isProduction ?? process.env.NODE_ENV === 'production';
    this.trustedIngestionStore = opts.trustedIngestionStore;
  }

  public getSnapshotStore(): ISourceSnapshotStore {
    return this.snapshotStore;
  }

  public getTrustedIngestionStore(): ITrustedIngestionStore | undefined {
    return this.trustedIngestionStore;
  }

  /**
   * Serializes operations per key to guarantee atomic execution across concurrent requests.
   * Stores the exact queued promise so that map cleanup safely removes the entry
   * when all waiters in the queue have completed, without race conditions or memory leaks.
   */
  private async runWithLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const currentQueue = this.registrationQueues.get(key) || Promise.resolve();
    let release!: () => void;
    const nextInQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    const queuedPromise = currentQueue.then(
      () => nextInQueue,
      () => nextInQueue
    );
    this.registrationQueues.set(key, queuedPromise);

    await currentQueue;
    try {
      return await fn();
    } finally {
      release();
      if (this.registrationQueues.get(key) === queuedPromise) {
        this.registrationQueues.delete(key);
      }
    }
  }

  public getRegistrationQueuesSize(): number {
    return this.registrationQueues.size;
  }

  /**
   * Registers an immutable source snapshot in tenant storage.
   * Fails closed if running in production with only an in-memory store.
   * Enforces trusted student ownership and DPDP purpose consent (repo_verification).
   * Serializes registration per snapshot identity and executes failure-safe audit logging
   * with conditional compensating rollback.
   */
  public async registerSnapshot(
    context: SessionContext,
    snapshot: SourceSnapshot
  ): Promise<{ success: boolean; snapshotId: string }> {
    // 1. Production Fail-Closed Storage Check
    if (this.isProduction && this.snapshotStore instanceof InMemorySourceSnapshotStore) {
      throw new Error(
        'DURABLE_STORAGE_REQUIRED: Production environment prohibits using in-memory snapshot store for authoritative evidence retention. Configure an approved durable ISourceSnapshotStore adapter.'
      );
    }

    // 2. Canonical file path validation
    let canonicalPath: string;
    try {
      canonicalPath = normalizeFilePath(snapshot.filePath);
    } catch (err: any) {
      throw new Error(`INVALID_SNAPSHOT_PATH: ${err.message}`, { cause: err });
    }

    // 3. Trusted Student Ownership & Purpose Consent Enforcement (P0-05 Defect 2)
    let studentOwnerId: string;
    if (context.role === 'student') {
      studentOwnerId = context.userId;
      if (snapshot.studentId && snapshot.studentId !== context.userId) {
        throw new Error('FORBIDDEN_STUDENT_ACCESS: Student cannot register snapshots for another student');
      }
    } else {
      // Officer, Platform Admin, etc.
      if (!snapshot.studentId) {
        throw new Error('STUDENT_OWNERSHIP_REQUIRED: Student repository snapshot must have a trusted studentId owner reference');
      }
      studentOwnerId = snapshot.studentId;
    }

    // Purpose Consent Check (Fail-Closed)
    if (!this.consentRepo) {
      throw new Error('CONSENT_SERVICE_UNAVAILABLE: Consent repository is required to register student repository data');
    }
    const hasConsent = await this.consentRepo.hasActiveConsent(context, studentOwnerId, 'repo_verification');
    if (!hasConsent) {
      throw new Error(`CONSENT_REQUIRED_OR_REVOKED: Student ${studentOwnerId} has not granted active consent for repo_verification`);
    }

    // Bind snapshot to authenticated tenant organization and trusted student owner.
    // Public/client registration permanently forces provenance: 'unverified_client_input'
    const tenantBoundSnapshot: SourceSnapshot = {
      ...snapshot,
      orgId: context.orgId,
      studentId: studentOwnerId,
      filePath: canonicalPath,
      provenance: 'unverified_client_input',
      ingestionId: undefined,
    };

    // Serialize registration per snapshot identity key to prevent concurrent rollback races
    const lockKey = `${context.orgId}:${studentOwnerId}:${snapshot.repositoryId}:${snapshot.commitSha.toLowerCase()}:${canonicalPath}`;

    return this.runWithLock(lockKey, async () => {
      // Check if snapshot already existed in store under this tenant and student
      const wasAlreadyPresent = await this.snapshotStore.hasSnapshot(
        snapshot.repositoryId,
        snapshot.commitSha,
        canonicalPath,
        context.orgId,
        studentOwnerId
      );

      // Save snapshot into immutable content-addressed storage
      await this.snapshotStore.saveSnapshot(tenantBoundSnapshot);

      // Audit logging with conditional compensating rollback on failure
      try {
        await this.auditRepo.log(
          context,
          'SNAPSHOT_REGISTERED',
          'evidence',
          snapshot.snapshotId,
          {
            repositoryId: snapshot.repositoryId,
            commitSha: snapshot.commitSha,
            filePath: canonicalPath,
            rawFileHash: snapshot.rawFileHash,
            studentId: studentOwnerId,
            wasAlreadyPresent,
          }
        );
      } catch (auditErr: any) {
        // Compensating rollback:
        // Only rollback if the snapshot was newly inserted by THIS operation.
        // If it was already present, preserve the pre-existing snapshot!
        if (!wasAlreadyPresent) {
          if (!this.snapshotStore.deleteSnapshot) {
            throw new Error(
              `SNAPSHOT_REGISTRATION_FAILED_UNROLLABLE: Audit logging failed (${auditErr.message}) and snapshot store does not support compensating rollback.`,
              { cause: auditErr }
            );
          }

          let rollbackError: Error | undefined;
          try {
            const deleted = await this.snapshotStore.deleteSnapshot(
              snapshot.repositoryId,
              snapshot.commitSha,
              canonicalPath,
              context.orgId,
              studentOwnerId,
              snapshot.snapshotId
            );
            if (!deleted) {
              rollbackError = new Error(`Snapshot ${snapshot.snapshotId} was not found or ID mismatch during rollback`);
            }
          } catch (rErr: any) {
            rollbackError = rErr;
          }

          if (rollbackError) {
            throw new Error(
              `SNAPSHOT_REGISTRATION_FAILED_WITH_ROLLBACK_ERROR: Audit logging failed (${auditErr.message}) and compensating rollback failed (${rollbackError.message})`,
              { cause: auditErr }
            );
          }
        }

        throw new Error(
          `SNAPSHOT_REGISTRATION_FAILED: Audit logging failed (${auditErr.message}). ${wasAlreadyPresent ? 'Pre-existing snapshot was preserved.' : 'Newly stored snapshot was safely rolled back.'}`,
          { cause: auditErr }
        );
      }

      return { success: true, snapshotId: snapshot.snapshotId };
    });
  }

  /**
   * Registers a verified source snapshot originating from the server-controlled
   * trusted ingestion pipeline (P0-04).
   * Validates that the file exists in the ingestion manifest, matches blobSha and rawFileHash,
   * enforces snapshot-record agreement, write-once semantics, and tags the snapshot as authoritative with provenance 'trusted_ingestion_pipeline'.
   */
  public async registerTrustedSnapshot(
    context: SessionContext,
    ingestionRecord: TrustedIngestionRecord,
    snapshot: SourceSnapshot
  ): Promise<{ success: boolean; snapshotId: string }> {
    if (this.isProduction && this.snapshotStore instanceof InMemorySourceSnapshotStore) {
      throw new Error(
        'DURABLE_STORAGE_REQUIRED: Production environment prohibits using in-memory snapshot store.'
      );
    }
    if (!this.trustedIngestionStore) {
      throw new Error('TRUSTED_INGESTION_STORE_NOT_CONFIGURED: Trusted ingestion store is required.');
    }

    // 1. Context tenant isolation and ownership check
    if (context.orgId !== ingestionRecord.orgId) {
      throw new Error('CROSS_TENANT_ACCESS_REJECTED: Context orgId does not match ingestion record orgId');
    }
    if (context.role === 'student' && context.userId !== ingestionRecord.studentId) {
      throw new Error('FORBIDDEN_STUDENT_ACCESS: Student cannot register trusted snapshot for another student');
    }

    // 2. Validate ingestion record against schema and save/verify in store (write-once)
    const parsedRecord = TrustedIngestionRecordSchema.parse(ingestionRecord);

    const existingRecord = await this.trustedIngestionStore.getRecord(
      parsedRecord.orgId,
      parsedRecord.repositoryId,
      parsedRecord.commitSha,
      parsedRecord.studentId
    );

    if (existingRecord) {
      // Must not overwrite an already trusted ingestion record with different data
      if (existingRecord.ingestionId !== parsedRecord.ingestionId) {
        throw new Error(
          `INGESTION_RECORD_MISMATCH: Supplied ingestionId '${parsedRecord.ingestionId}' does not match persisted record '${existingRecord.ingestionId}'`
        );
      }
      if (existingRecord.treeSha.toLowerCase() !== parsedRecord.treeSha.toLowerCase()) {
        throw new Error(
          `INGESTION_RECORD_MISMATCH: Supplied treeSha '${parsedRecord.treeSha}' does not match persisted record '${existingRecord.treeSha}'`
        );
      }
      // saveRecord enforces write-once semantics and allows idempotent duplicates
      await this.trustedIngestionStore.saveRecord(parsedRecord);
    } else {
      await this.trustedIngestionStore.saveRecord(parsedRecord);
    }

    const trustedRecord = (await this.trustedIngestionStore.getRecord(
      parsedRecord.orgId,
      parsedRecord.repositoryId,
      parsedRecord.commitSha,
      parsedRecord.studentId
    ))!;

    // 3. Ensure snapshot attributes agree with ingestion record
    if (snapshot.orgId && snapshot.orgId !== trustedRecord.orgId) {
      throw new Error(
        `SNAPSHOT_RECORD_MISMATCH: Snapshot orgId '${snapshot.orgId}' does not match ingestion record orgId '${trustedRecord.orgId}'`
      );
    }
    if (snapshot.studentId && snapshot.studentId !== trustedRecord.studentId) {
      throw new Error(
        `SNAPSHOT_RECORD_MISMATCH: Snapshot studentId '${snapshot.studentId}' does not match ingestion record studentId '${trustedRecord.studentId}'`
      );
    }
    if (snapshot.repositoryId !== trustedRecord.repositoryId) {
      throw new Error(
        `SNAPSHOT_RECORD_MISMATCH: Snapshot repositoryId '${snapshot.repositoryId}' does not match ingestion record repositoryId '${trustedRecord.repositoryId}'`
      );
    }
    if (snapshot.commitSha.toLowerCase() !== trustedRecord.commitSha.toLowerCase()) {
      throw new Error(
        `SNAPSHOT_RECORD_MISMATCH: Snapshot commitSha '${snapshot.commitSha}' does not match ingestion record commitSha '${trustedRecord.commitSha}'`
      );
    }

    // 4. Require Git blob SHA for trusted snapshots
    if (!snapshot.blobSha || !/^[0-9a-fA-F]{40}$/.test(snapshot.blobSha)) {
      throw new Error(
        'TRUSTED_SNAPSHOT_BLOB_SHA_REQUIRED: Trusted ingestion snapshots must specify a valid 40-character Git blobSha.'
      );
    }

    // 5. Canonicalize snapshot file path
    let canonicalPath: string;
    try {
      canonicalPath = normalizeFilePath(snapshot.filePath);
    } catch (err: any) {
      throw new Error(`INVALID_SNAPSHOT_PATH: ${err.message}`, { cause: err });
    }

    // 6. Verify file against ingestion manifest (path, blobSha, rawFileHash)
    const manifestResult = await this.trustedIngestionStore.verifyFileManifest(
      trustedRecord.orgId,
      trustedRecord.repositoryId,
      trustedRecord.commitSha,
      trustedRecord.studentId,
      canonicalPath,
      snapshot.blobSha,
      snapshot.rawFileHash
    );

    if (!manifestResult.valid) {
      throw new Error(`TRUSTED_INGESTION_MANIFEST_VIOLATION: ${manifestResult.reason}`);
    }

    // 7. Store trusted snapshot
    const trustedSnapshot: SourceSnapshot = {
      ...snapshot,
      orgId: trustedRecord.orgId,
      studentId: trustedRecord.studentId,
      filePath: canonicalPath,
      blobSha: snapshot.blobSha.toLowerCase(),
      rawFileHash: snapshot.rawFileHash.toLowerCase(),
      provenance: 'trusted_ingestion_pipeline',
      ingestionId: trustedRecord.ingestionId,
    };

    await this.snapshotStore.saveSnapshot(trustedSnapshot);

    // 8. Log audit event
    await this.auditRepo.log(
      context,
      'TRUSTED_SNAPSHOT_INGESTED',
      'evidence',
      snapshot.snapshotId,
      {
        ingestionId: trustedRecord.ingestionId,
        repositoryId: trustedRecord.repositoryId,
        commitSha: trustedRecord.commitSha,
        filePath: canonicalPath,
        rawFileHash: snapshot.rawFileHash,
        blobSha: snapshot.blobSha,
        studentId: trustedRecord.studentId,
      }
    );

    return { success: true, snapshotId: snapshot.snapshotId };
  }

  /**
   * Resolves an anchor with tenant isolation, student ownership enforcement,
   * purpose-consent enforcement, server-controlled provenance verification, and cryptographic audit logging.
   */
  public async resolveAnchor(
    context: SessionContext,
    anchor: ExactCodeAnchor,
    snapshotOverride?: SourceSnapshot,
    options: ResolveAnchorOptions = {}
  ): Promise<ResolutionResult> {
    // 1. Strict Tenant Isolation (TB1 / TB2 Boundary)
    if (anchor.orgId !== context.orgId) {
      await this.auditRepo.log(
        context,
        'ANCHOR_RESOLUTION_REJECTED',
        'evidence',
        anchor.id,
        {
          error: 'CROSS_TENANT_ACCESS_REJECTED',
          reason: `Context tenant '${context.orgId}' cannot access anchor for tenant '${anchor.orgId}'`,
        }
      );

      return {
        status: 'ANCHOR_INVALID',
        valid: false,
        error: 'CROSS_TENANT_ACCESS_REJECTED',
        anchorId: anchor.id,
        diagnostics: {
          reason: `Cross-tenant anchor access rejected: context tenant '${context.orgId}' cannot access anchor for tenant '${anchor.orgId}'`,
        },
      };
    }

    // 2. Mandatory Student Ownership Check (Fail-Closed)
    if (!anchor.studentId) {
      return {
        status: 'ANCHOR_INVALID',
        valid: false,
        error: 'STUDENT_OWNERSHIP_REQUIRED',
        anchorId: anchor.id,
        diagnostics: {
          reason: 'Student-owned repository evidence must contain a valid studentId owner reference',
        },
      };
    }

    // Student caller must only access their own evidence
    if (context.role === 'student' && anchor.studentId !== context.userId) {
      await this.auditRepo.log(
        context,
        'ANCHOR_RESOLUTION_REJECTED',
        'evidence',
        anchor.id,
        {
          error: 'FORBIDDEN_STUDENT_ACCESS',
          reason: `Student ${context.userId} attempted to access anchor belonging to student ${anchor.studentId}`,
        }
      );

      return {
        status: 'ANCHOR_INVALID',
        valid: false,
        error: 'FORBIDDEN_STUDENT_ACCESS',
        anchorId: anchor.id,
        diagnostics: {
          reason: `Student ${context.userId} cannot resolve evidence anchors belonging to student ${anchor.studentId}`,
        },
      };
    }

    // 3. Mandatory Purpose Consent Check (Fail-Closed)
    if (!this.consentRepo) {
      return {
        status: 'ANCHOR_INVALID',
        valid: false,
        error: 'CONSENT_SERVICE_UNAVAILABLE',
        anchorId: anchor.id,
        diagnostics: {
          reason: 'Consent repository infrastructure is unavailable; failing closed',
        },
      };
    }

    const hasConsent = await this.consentRepo.hasActiveConsent(
      context,
      anchor.studentId,
      'repo_verification'
    );

    if (!hasConsent) {
      await this.auditRepo.log(
        context,
        'ANCHOR_RESOLUTION_REJECTED',
        'evidence',
        anchor.id,
        {
          error: 'CONSENT_REQUIRED_OR_REVOKED',
          studentId: anchor.studentId,
          reason: 'Student has not granted or has revoked purpose consent for repo_verification',
        }
      );

      return {
        status: 'ANCHOR_INVALID',
        valid: false,
        error: 'CONSENT_REQUIRED_OR_REVOKED',
        anchorId: anchor.id,
        diagnostics: {
          reason: 'Student has not granted or has revoked purpose consent for repo_verification',
        },
      };
    }

    // 4. Server-Controlled Ingestion Provenance Resolution (P0-05 Defect 3 & Requirement 3)
    let snapshot = snapshotOverride;
    let isAuthoritative = false;
    let provenance = 'unverified_client_input';

    if (snapshotOverride) {
      // Inline snapshot: check student ownership if anchor has studentId
      if (anchor.studentId) {
        if (!snapshotOverride.studentId) {
          return {
            status: 'ANCHOR_INVALID',
            valid: false,
            error: 'STUDENT_OWNERSHIP_REQUIRED',
            anchorId: anchor.id,
            diagnostics: {
              reason: 'Student-owned evidence anchor requires a snapshot with student ownership',
            },
          };
        }
        if (snapshotOverride.studentId !== anchor.studentId) {
          return {
            status: 'ANCHOR_INVALID',
            valid: false,
            error: 'STUDENT_OWNERSHIP_MISMATCH',
            anchorId: anchor.id,
            diagnostics: {
              reason: `Inline snapshot studentId (${snapshotOverride.studentId}) does not match anchor studentId (${anchor.studentId})`,
            },
          };
        }
      }

      // Client-supplied inline snapshot: Permanently non-authoritative!
      if (options.authoritative) {
        return {
          status: 'ANCHOR_INVALID',
          valid: false,
          authoritative: false,
          provenance: 'unverified_client_input',
          error: 'UNTRUSTED_CLIENT_SNAPSHOT',
          anchorId: anchor.id,
          diagnostics: {
            reason: 'Client-supplied inline snapshots cannot establish authoritative evidence. Trusted ingestion (P0-04) is required.',
          },
        };
      }
    } else {
      // Lookup snapshot from persisted store with tenant and student scoping
      snapshot = await this.snapshotStore.getSnapshot(
        anchor.repositoryId,
        anchor.commitSha,
        anchor.filePath || anchor.path || '',
        context.orgId,
        anchor.studentId
      );

      if (!snapshot) {
        return {
          status: 'SNAPSHOT_NOT_FOUND',
          valid: false,
          authoritative: false,
          provenance: 'retained_snapshot_store',
          error: 'SNAPSHOT_NOT_FOUND',
          anchorId: anchor.id,
          diagnostics: {
            reason: `No retained immutable source snapshot found for repository '${anchor.repositoryId}', commit '${anchor.commitSha}', file '${anchor.filePath || anchor.path}'`,
          },
        };
      }

      // Establish that retrieved snapshot belongs to the same student as the anchor
      if (anchor.studentId && snapshot.studentId !== anchor.studentId) {
        return {
          status: 'ANCHOR_INVALID',
          valid: false,
          authoritative: false,
          provenance: 'retained_snapshot_store',
          error: 'STUDENT_OWNERSHIP_MISMATCH',
          anchorId: anchor.id,
          diagnostics: {
            reason: `Retrieved snapshot studentId (${snapshot.studentId}) does not match anchor studentId (${anchor.studentId})`,
          },
        };
      }

      // File-level server-controlled trusted ingestion verification
      if (snapshot.provenance !== 'trusted_ingestion_pipeline' || !snapshot.ingestionId) {
        // Snapshot was uploaded via client registration route; remains permanently non-authoritative
        isAuthoritative = false;
        provenance = snapshot.provenance || 'retained_snapshot_store';

        if (options.authoritative) {
          return {
            status: 'ANCHOR_INVALID',
            valid: false,
            authoritative: false,
            provenance,
            error: 'UNTRUSTED_CLIENT_SNAPSHOT',
            anchorId: anchor.id,
            diagnostics: {
              reason: 'Retained snapshot was not ingested via the trusted server-controlled ingestion pipeline (provenance is client input).',
            },
          };
        }
      } else {
        // Snapshot claims trusted_ingestion_pipeline with ingestionId
        if (!snapshot.blobSha || !/^[0-9a-fA-F]{40}$/.test(snapshot.blobSha)) {
          isAuthoritative = false;
          provenance = 'retained_snapshot_store';

          if (options.authoritative) {
            return {
              status: 'ANCHOR_INVALID',
              valid: false,
              authoritative: false,
              provenance: 'retained_snapshot_store',
              error: 'UNTRUSTED_CLIENT_SNAPSHOT',
              anchorId: anchor.id,
              diagnostics: {
                reason: 'Authoritative resolution requires a trusted snapshot with a valid 40-character Git blobSha.',
              },
            };
          }
        } else if (!this.trustedIngestionStore) {
          return {
            status: 'ANCHOR_INVALID',
            valid: false,
            authoritative: false,
            provenance: 'retained_snapshot_store',
            error: 'TRUSTED_INGESTION_NOT_AVAILABLE',
            anchorId: anchor.id,
            diagnostics: { reason: 'Trusted ingestion store is not configured on server' },
          };
        } else {
          const record = await this.trustedIngestionStore.getRecord(
            context.orgId,
            anchor.repositoryId,
            anchor.commitSha,
            anchor.studentId
          );

        if (!record || record.ingestionId !== snapshot.ingestionId) {
          isAuthoritative = false;
          provenance = 'retained_snapshot_store';

          if (options.authoritative) {
            return {
              status: 'ANCHOR_INVALID',
              valid: false,
              authoritative: false,
              provenance,
              error: 'INGESTION_RECORD_MISMATCH',
              anchorId: anchor.id,
              diagnostics: { reason: 'Snapshot ingestionId does not match verified server ingestion record' },
            };
          }
        } else {
          // Verify file against the trusted tree manifest
          const manifestCheck = await this.trustedIngestionStore.verifyFileManifest(
            context.orgId,
            anchor.repositoryId,
            anchor.commitSha,
            anchor.studentId,
            anchor.filePath || anchor.path || '',
            snapshot.blobSha,
            snapshot.rawFileHash
          );

          if (!manifestCheck.valid) {
            isAuthoritative = false;
            provenance = 'retained_snapshot_store';

            if (options.authoritative) {
              return {
                status: 'ANCHOR_INVALID',
                valid: false,
                authoritative: false,
                provenance: 'retained_snapshot_store',
                error: manifestCheck.reason?.split(':')[0] || 'UNTRUSTED_CLIENT_SNAPSHOT',
                anchorId: anchor.id,
                diagnostics: {
                  reason: `Snapshot failed trusted manifest verification: ${manifestCheck.reason}`,
                },
              };
            }
          } else {
            isAuthoritative = true;
            provenance = 'trusted_ingestion_pipeline';
          }
        }
      }
    }
  }

    // 5. Deterministic Resolution
    const result = AnchorResolver.resolve(snapshot, anchor, {
      registry: this.parserRegistry,
    });

    const enrichedResult: ResolutionResult = {
      ...result,
      authoritative: result.valid ? isAuthoritative : false,
      provenance,
    };

    // 6. Cryptographic Audit Logging
    await this.auditRepo.log(
      context,
      result.valid ? 'ANCHOR_RESOLVED' : 'ANCHOR_RESOLUTION_FAILED',
      'evidence',
      anchor.id,
      {
        status: result.status,
        valid: result.valid,
        authoritative: enrichedResult.authoritative,
        provenance,
        commitSha: anchor.commitSha,
        filePath: anchor.filePath,
        contentHash: anchor.contentHash,
        error: result.error,
      }
    );

    return enrichedResult;
  }

  /**
   * Deterministically parses a source file into function/method/class spans
   * with mandatory student ownership and active DPDP purpose consent verification.
   * Parse results are explicitly marked diagnosticOnly: true and authoritative: false.
   */
  public async parseSourceWithConsent(
    context: SessionContext,
    source: string | Buffer | Uint8Array,
    filePath: string,
    targetStudentId?: string
  ): Promise<ParseResult & { authoritative: boolean; diagnosticOnly: boolean; provenance: string }> {
    // 1. Establish trusted student ownership
    let studentOwnerId: string;
    if (context.role === 'student') {
      studentOwnerId = context.userId;
      if (targetStudentId && targetStudentId !== context.userId) {
        throw new Error('FORBIDDEN_STUDENT_ACCESS: Student cannot parse code for another student');
      }
    } else {
      if (!targetStudentId) {
        throw new Error('STUDENT_OWNERSHIP_REQUIRED: Student repository data parsing requires an explicit studentId owner reference');
      }
      studentOwnerId = targetStudentId;
    }

    // 2. Purpose Consent Enforcement (Fail-Closed)
    if (!this.consentRepo) {
      throw new Error('CONSENT_SERVICE_UNAVAILABLE: Consent repository is required to parse student repository data');
    }
    const hasConsent = await this.consentRepo.hasActiveConsent(context, studentOwnerId, 'repo_verification');
    if (!hasConsent) {
      throw new Error(`CONSENT_REQUIRED_OR_REVOKED: Student ${studentOwnerId} has not granted active consent for repo_verification`);
    }

    // 3. Pure AST parsing
    const parseResult = this.parseSource(source, filePath);

    // 4. Audit logging
    await this.auditRepo.log(
      context,
      'SOURCE_PARSED',
      'evidence',
      undefined,
      {
        filePath,
        studentId: studentOwnerId,
        success: parseResult.success,
        symbolsCount: parseResult.symbols.length,
        diagnosticOnly: true,
      }
    );

    return {
      ...parseResult,
      authoritative: false,
      diagnosticOnly: true,
      provenance: 'diagnostic_parser',
    };
  }

  /**
   * Deterministically parses a source file into function/method/class spans
   * using the registered offline AST parser without executing untrusted code.
   * Pure domain parsing function with no external network/I/O side effects.
   */
  public parseSource(source: string | Buffer | Uint8Array, filePath: string): ParseResult {
    // Validate file path to prevent traversal or null byte injection
    try {
      normalizeFilePath(filePath);
    } catch (err: any) {
      return {
        success: false,
        parserName: 'unknown',
        parserVersion: 'none',
        language: 'unsupported',
        symbols: [],
        errors: [`INVALID_FILE_PATH: ${err.message}`],
      };
    }

    const parser = this.parserRegistry.getParserForFile(filePath);
    if (!parser) {
      return {
        success: false,
        parserName: 'unknown',
        parserVersion: 'none',
        language: 'unsupported',
        symbols: [],
        errors: [`No registered parser supports file path: ${filePath}`],
      };
    }

    return parser.parse(source, filePath);
  }
}
