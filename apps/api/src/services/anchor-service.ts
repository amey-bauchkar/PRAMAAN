import {
  ExactCodeAnchor,
  SourceSnapshot,
  ResolutionResult,
  SessionContext,
  ParseResult,
} from '@pramaan/contracts';
import {
  AnchorResolver,
  ISourceSnapshotStore,
  InMemorySourceSnapshotStore,
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
  trustedIngestionActive?: boolean;
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
  private trustedIngestionActive: boolean;

  constructor(opts: AnchorServiceOptions) {
    this.auditRepo = opts.auditRepo;
    this.consentRepo = opts.consentRepo;
    this.snapshotStore = opts.snapshotStore || new InMemorySourceSnapshotStore();
    this.parserRegistry = opts.parserRegistry || ParserRegistry.getInstance();
    this.isProduction = opts.isProduction ?? process.env.NODE_ENV === 'production';
    this.trustedIngestionActive = opts.trustedIngestionActive ?? false;
  }

  public getSnapshotStore(): ISourceSnapshotStore {
    return this.snapshotStore;
  }

  public isTrustedIngestionActive(): boolean {
    return this.trustedIngestionActive;
  }

  public setTrustedIngestionActive(active: boolean): void {
    this.trustedIngestionActive = active;
  }

  /**
   * Registers an immutable source snapshot in tenant storage.
   * Fails closed if running in production with only an in-memory store.
   * Enforces purpose consent when registering student-owned repository data.
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

    // 3. Purpose Consent Check for Student Repository Data
    if (context.role === 'student') {
      if (!this.consentRepo) {
        throw new Error('CONSENT_SERVICE_UNAVAILABLE: Consent repository is required to register student repository data');
      }
      const hasConsent = await this.consentRepo.hasActiveConsent(context, context.userId, 'repo_verification');
      if (!hasConsent) {
        throw new Error('CONSENT_REQUIRED_OR_REVOKED: Student has not granted active consent for repo_verification');
      }
    }

    // Bind snapshot to the authenticated tenant organization
    const tenantBoundSnapshot: SourceSnapshot = {
      ...snapshot,
      orgId: context.orgId,
      filePath: canonicalPath,
    };

    // Save snapshot into immutable content-addressed storage
    await this.snapshotStore.saveSnapshot(tenantBoundSnapshot);

    // Audit the snapshot registration
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
      }
    );

    return { success: true, snapshotId: snapshot.snapshotId };
  }

  /**
   * Resolves an anchor with tenant isolation, student ownership enforcement,
   * purpose-consent enforcement, authoritative content verification, and cryptographic audit logging.
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
    // Student-owned repository evidence must explicitly designate the student owner
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
    // Neither students, officers, mentors, nor admins can bypass the student's purpose consent
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

    // 4. Authoritative Ingestion vs Diagnostic Snapshot Resolution (Section 5)
    let snapshot = snapshotOverride;
    let isAuthoritative = false;
    let provenance = 'unverified_client_input';

    if (snapshotOverride) {
      // Client-supplied inline snapshot: Cannot establish trusted repository provenance!
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

      isAuthoritative = this.trustedIngestionActive;
      provenance = this.trustedIngestionActive ? 'trusted_ingestion_pipeline' : 'retained_snapshot_store';
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
   * using the registered offline AST parser without executing untrusted code.
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

