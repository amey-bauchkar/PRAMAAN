import {
  ExactCodeAnchor,
  SourceSnapshot,
  ResolutionResult,
  SessionContext,
  ParseResult,
  TrustedIngestionRecord,
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
   * Registers an immutable source snapshot in tenant storage.
   * Fails closed if running in production with only an in-memory store.
   * Enforces trusted student ownership and DPDP purpose consent (repo_verification).
   * Executes audit logging with compensating rollback if audit writing fails.
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

    // Bind snapshot to authenticated tenant organization and trusted student owner
    const tenantBoundSnapshot: SourceSnapshot = {
      ...snapshot,
      orgId: context.orgId,
      studentId: studentOwnerId,
      filePath: canonicalPath,
    };

    // Check if snapshot already existed in store
    const alreadyExisted = await this.snapshotStore.hasSnapshot(
      snapshot.repositoryId,
      snapshot.commitSha,
      canonicalPath,
      context.orgId
    );

    // Save snapshot into immutable content-addressed storage
    await this.snapshotStore.saveSnapshot(tenantBoundSnapshot);

    // Audit logging with compensating rollback on failure (P0-05 Defect 4)
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
        }
      );
    } catch (auditErr: any) {
      // Compensating rollback:
      // If newly added, delete it so untracked snapshot does not remain
      // If pre-existing, preserve it!
      if (!alreadyExisted && this.snapshotStore.deleteSnapshot) {
        try {
          await this.snapshotStore.deleteSnapshot(
            snapshot.repositoryId,
            snapshot.commitSha,
            canonicalPath,
            context.orgId
          );
        } catch {
          // Swallow rollback error
        }
      }
      throw new Error(
        `SNAPSHOT_REGISTRATION_FAILED: Audit logging failed (${auditErr.message}). Any newly stored snapshot was rolled back.`,
        { cause: auditErr }
      );
    }

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

    // 4. Server-Controlled Ingestion Provenance Resolution (P0-05 Defect 3)
    let snapshot = snapshotOverride;
    let isAuthoritative = false;
    let provenance = 'unverified_client_input';

    if (snapshotOverride) {
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
      // Lookup snapshot from persisted store with tenant scoping
      snapshot = await this.snapshotStore.getSnapshot(
        anchor.repositoryId,
        anchor.commitSha,
        anchor.filePath || anchor.path || '',
        context.orgId
      );

      if (!snapshot) {
        return {
          status: 'SNAPSHOT_NOT_FOUND',
          valid: false,
          error: 'SNAPSHOT_NOT_FOUND',
          anchorId: anchor.id,
          diagnostics: {
            reason: `No retained immutable source snapshot found for repository '${anchor.repositoryId}', commit '${anchor.commitSha}', file '${anchor.filePath || anchor.path}'`,
          },
        };
      }

      // Check server-side trusted ingestion record
      let trustedRecord: TrustedIngestionRecord | undefined;
      if (this.trustedIngestionStore && anchor.studentId) {
        trustedRecord = await this.trustedIngestionStore.getRecord(
          context.orgId,
          anchor.repositoryId,
          anchor.commitSha,
          anchor.studentId
        );
      }

      if (trustedRecord) {
        isAuthoritative = true;
        provenance = 'trusted_ingestion_pipeline';
      } else {
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
              reason: 'Retained snapshot lacks a verified server-controlled trusted ingestion record (P0-04 required).',
            },
          };
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
