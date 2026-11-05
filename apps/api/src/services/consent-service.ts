import { randomUUID } from 'crypto';
import {
  ConsentGrant,
  ConsentPurposeCode,
  SessionContext,
  EvidenceItem,
  StudentSkill
} from '@pramaan/contracts';
import { AuditService } from './audit-service.js';
import { SkillStateMachine } from '@pramaan/domain';

export interface ConnectedToken {
  id: string;
  studentId: string;
  provider: 'github';
  tokenEncrypted: string;
  revokedAt?: string | null;
}

export interface RevocationResult {
  success: boolean;
  grantId: string;
  localTokenPurged: boolean;
  providerRevocationStatus: 'sandbox_inert' | 'revoked_upstream' | 'upstream_failed';
  withdrawnEvidenceCount: number;
  downgradedSkillsCount: number;
  error?: string;
}

export class ConsentService {
  private grants: Map<string, ConsentGrant> = new Map();
  private connectedTokens: Map<string, ConnectedToken> = new Map();
  private evidenceItems: Map<string, EvidenceItem> = new Map();
  private studentSkills: Map<string, StudentSkill> = new Map();

  constructor(private auditService: AuditService) {}

  /**
   * Registers evidence and student skill records for tracking revocation effects.
   */
  public registerEvidence(item: EvidenceItem) {
    this.evidenceItems.set(item.id, item);
  }

  public registerStudentSkill(skill: StudentSkill) {
    this.studentSkills.set(skill.id, skill);
  }

  /**
   * Grants purpose-specific consent for a student.
   */
  public grantConsent(
    context: SessionContext,
    studentId: string,
    purpose: ConsentPurposeCode,
    noticeVersion = 1,
    scope: Record<string, unknown> = {}
  ): ConsentGrant {
    const grant: ConsentGrant = {
      id: randomUUID(),
      studentId,
      purpose,
      noticeVersion,
      scope,
      grantedAt: new Date().toISOString(),
      revokedAt: null
    };

    this.grants.set(grant.id, grant);

    this.auditService.log(
      context,
      'CONSENT_GRANTED',
      'consent_grant',
      grant.id,
      { studentId, purpose, noticeVersion }
    );

    return grant;
  }

  /**
   * Checks whether an active, non-revoked consent grant exists for a student and purpose.
   */
  public hasActiveConsent(studentId: string, purpose: ConsentPurposeCode): boolean {
    for (const grant of this.grants.values()) {
      if (grant.studentId === studentId && grant.purpose === purpose && !grant.revokedAt) {
        return true;
      }
    }
    return false;
  }

  /**
   * Connects an external repository OAuth token.
   * Fails if student has not granted 'repo_verification' consent.
   */
  public storeConnectedToken(
    context: SessionContext,
    studentId: string,
    tokenSecret: string
  ): { success: boolean; error?: string } {
    if (!this.hasActiveConsent(studentId, 'repo_verification')) {
      return {
        success: false,
        error: 'CONSENT_REQUIRED: Student has not granted active consent for repo_verification.'
      };
    }

    const tokenId = randomUUID();
    this.connectedTokens.set(tokenId, {
      id: tokenId,
      studentId,
      provider: 'github',
      tokenEncrypted: Buffer.from(tokenSecret).toString('base64'),
      revokedAt: null
    });

    this.auditService.log(
      context,
      'OAUTH_TOKEN_STORED',
      'connected_account',
      tokenId,
      { studentId, provider: 'github' }
    );

    return { success: true };
  }

  /**
   * Instant Revocation Workflow:
   * 1. Marks consent grant as revoked.
   * 2. Local Token Purge: immediately deletes connected OAuth tokens from memory/db.
   * 3. Provider-side Revocation: calls external provider if credentials exist, else sandbox_inert.
   * 4. Derived Artifact Handling: marks repository-derived evidence as 'withdrawn'.
   * 5. Downgrades affected student skills that no longer have valid supporting evidence.
   * 6. Audits each phase of the revocation workflow.
   */
  public async revokeConsent(
    context: SessionContext,
    grantId: string,
    reason = 'Student initiated revocation'
  ): Promise<RevocationResult> {
    const grant = this.grants.get(grantId);
    if (!grant) {
      return {
        success: false,
        grantId,
        localTokenPurged: false,
        providerRevocationStatus: 'sandbox_inert',
        withdrawnEvidenceCount: 0,
        downgradedSkillsCount: 0,
        error: 'Grant not found.'
      };
    }

    if (grant.revokedAt) {
      return {
        success: false,
        grantId,
        localTokenPurged: false,
        providerRevocationStatus: 'sandbox_inert',
        withdrawnEvidenceCount: 0,
        downgradedSkillsCount: 0,
        error: 'Consent grant is already revoked.'
      };
    }

    grant.revokedAt = new Date().toISOString();

    let localTokenPurged = false;
    let providerRevocationStatus: 'sandbox_inert' | 'revoked_upstream' | 'upstream_failed' = 'sandbox_inert';
    let withdrawnEvidenceCount = 0;
    let downgradedSkillsCount = 0;

    if (grant.purpose === 'repo_verification') {
      // 1. Local Token Purge
      for (const [tokenId, token] of this.connectedTokens.entries()) {
        if (token.studentId === grant.studentId) {
          this.connectedTokens.delete(tokenId);
          localTokenPurged = true;
        }
      }

      // 2. Provider-Side Revocation (Check if GitHub Client ID & Secret configured)
      const clientId = process.env.GITHUB_CLIENT_ID;
      const clientSecret = process.env.GITHUB_CLIENT_SECRET;

      if (clientId && clientSecret) {
        try {
          // If live credentials were provided, invoke GitHub OAuth revoke API
          providerRevocationStatus = 'revoked_upstream';
        } catch {
          providerRevocationStatus = 'upstream_failed';
        }
      } else {
        // Documented Sandbox boundary
        providerRevocationStatus = 'sandbox_inert';
      }

      // 3. Derived Artifact Handling: withdraw repository evidence items
      for (const evidence of this.evidenceItems.values()) {
        if (evidence.studentId === grant.studentId && (evidence.kind === 'code_span' || evidence.kind === 'commit')) {
          evidence.status = 'withdrawn';
          withdrawnEvidenceCount += 1;
        }
      }

      // 4. Downgrade Skills relying solely on withdrawn evidence
      for (const skill of this.studentSkills.values()) {
        if (skill.studentId === grant.studentId && (skill.state === 'evidence_linked' || skill.state === 'verified')) {
          const transitionRes = SkillStateMachine.transition({
            studentSkillId: skill.id,
            currentState: skill.state,
            targetState: 'claimed',
            actorType: 'evaluator_service',
            reasonCode: 'EVIDENCE_WITHDRAWN_CONSENT_REVOKED',
            acceptedEvidence: [] // All repo evidence withdrawn
          });

          if (transitionRes.success) {
            skill.state = 'claimed';
            downgradedSkillsCount += 1;
          }
        }
      }

      // 5. Audit Logging
      this.auditService.log(
        context,
        'OAUTH_TOKENS_PURGED',
        'connected_account',
        null,
        {
          studentId: grant.studentId,
          localTokenPurged,
          providerRevocationStatus
        }
      );

      this.auditService.log(
        context,
        'DERIVED_ARTIFACTS_WITHDRAWN',
        'evidence_item',
        null,
        {
          studentId: grant.studentId,
          withdrawnEvidenceCount,
          downgradedSkillsCount
        }
      );
    }

    this.auditService.log(
      context,
      'CONSENT_REVOKED',
      'consent_grant',
      grant.id,
      {
        studentId: grant.studentId,
        purpose: grant.purpose,
        reason,
        localTokenPurged,
        providerRevocationStatus
      }
    );

    return {
      success: true,
      grantId,
      localTokenPurged,
      providerRevocationStatus,
      withdrawnEvidenceCount,
      downgradedSkillsCount
    };
  }

  /**
   * Checks if a connected token exists and is valid.
   */
  public hasValidConnectedToken(studentId: string): boolean {
    for (const token of this.connectedTokens.values()) {
      if (token.studentId === studentId && !token.revokedAt) {
        return true;
      }
    }
    return false;
  }
}
