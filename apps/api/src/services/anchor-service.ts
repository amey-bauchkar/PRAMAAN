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
} from '@pramaan/domain';
import { IAuditRepository } from '../repositories/audit-repository.js';
import { IConsentRepository } from '../repositories/consent-repository.js';

export class AnchorService {
  private snapshotStore: ISourceSnapshotStore;
  private auditRepo: IAuditRepository;
  private consentRepo?: IConsentRepository;
  private parserRegistry: ParserRegistry;

  constructor(opts: {
    auditRepo: IAuditRepository;
    consentRepo?: IConsentRepository;
    snapshotStore?: ISourceSnapshotStore;
    parserRegistry?: ParserRegistry;
  }) {
    this.auditRepo = opts.auditRepo;
    this.consentRepo = opts.consentRepo;
    this.snapshotStore = opts.snapshotStore || new InMemorySourceSnapshotStore();
    this.parserRegistry = opts.parserRegistry || ParserRegistry.getInstance();
  }

  public getSnapshotStore(): ISourceSnapshotStore {
    return this.snapshotStore;
  }

  /**
   * Registers an immutable source snapshot in tenant storage.
   */
  public async registerSnapshot(
    context: SessionContext,
    snapshot: SourceSnapshot
  ): Promise<{ success: boolean; snapshotId: string }> {
    // Save snapshot into immutable content-addressed storage
    await this.snapshotStore.saveSnapshot(snapshot);

    // Audit the snapshot registration
    await this.auditRepo.log(
      context,
      'SNAPSHOT_REGISTERED',
      'evidence',
      snapshot.snapshotId,
      {
        repositoryId: snapshot.repositoryId,
        commitSha: snapshot.commitSha,
        filePath: snapshot.filePath,
        rawFileHash: snapshot.rawFileHash,
      }
    );

    return { success: true, snapshotId: snapshot.snapshotId };
  }

  /**
   * Resolves an anchor with tenant isolation, purpose-consent enforcement,
   * authoritative content verification, and cryptographic audit logging.
   */
  public async resolveAnchor(
    context: SessionContext,
    anchor: ExactCodeAnchor,
    snapshotOverride?: SourceSnapshot
  ): Promise<ResolutionResult> {
    // 1. Strict Tenant Isolation (TB1 / TB2 Boundary)
    if (anchor.orgId !== context.orgId) {
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

    // 2. Student Ownership Verification
    if (context.role === 'student' && anchor.studentId && anchor.studentId !== context.userId) {
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

    // 3. Purpose Consent Check (India DPDP / PRAMAAN BR-03 / ST-08)
    if (anchor.studentId && this.consentRepo) {
      const hasConsent = await this.consentRepo.hasActiveConsent(
        context,
        anchor.studentId,
        'repo_verification'
      );
      if (!hasConsent) {
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
    }

    // 4. Retrieve or verify snapshot
    let snapshot = snapshotOverride;
    if (!snapshot) {
      snapshot = await this.snapshotStore.getSnapshot(
        anchor.repositoryId,
        anchor.commitSha,
        anchor.filePath || anchor.path || ''
      );
    }

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

    // 5. Deterministic Resolution
    const result = AnchorResolver.resolve(snapshot, anchor, {
      registry: this.parserRegistry,
    });

    // 6. Cryptographic Audit Logging
    await this.auditRepo.log(
      context,
      result.valid ? 'ANCHOR_RESOLVED' : 'ANCHOR_RESOLUTION_FAILED',
      'evidence',
      anchor.id,
      {
        status: result.status,
        valid: result.valid,
        commitSha: anchor.commitSha,
        filePath: anchor.filePath,
        contentHash: anchor.contentHash,
        error: result.error,
      }
    );

    return result;
  }

  /**
   * Deterministically parses a source file into function/method/class spans
   * using the registered offline AST parser without executing untrusted code.
   */
  public parseSource(source: string | Buffer | Uint8Array, filePath: string): ParseResult {
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
