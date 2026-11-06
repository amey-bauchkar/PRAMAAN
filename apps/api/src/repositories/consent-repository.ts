import pg from 'pg';
import { randomUUID } from 'crypto';
import {
  ConsentGrant,
  ConsentPurposeCode,
  SessionContext
} from '@pramaan/contracts';
import { withTenantTransaction, getDbPool } from '../db/pool.js';
import { ConsentService, RevocationResult } from '../services/consent-service.js';
import { IAuditRepository } from './audit-repository.js';

export interface IConsentRepository {
  grantConsent(
    context: SessionContext,
    studentId: string,
    purpose: ConsentPurposeCode,
    noticeVersion?: number,
    scope?: Record<string, unknown>
  ): Promise<ConsentGrant>;
  getGrant(context: SessionContext, grantId: string): Promise<ConsentGrant | null>;
  hasActiveConsent(
    context: SessionContext,
    studentId: string,
    purpose: ConsentPurposeCode
  ): Promise<boolean>;
  revokeConsent(
    context: SessionContext,
    grantId: string,
    reason?: string
  ): Promise<RevocationResult>;
}

export class InMemoryConsentRepository implements IConsentRepository {
  constructor(private service: ConsentService) {}

  public async grantConsent(
    context: SessionContext,
    studentId: string,
    purpose: ConsentPurposeCode,
    noticeVersion = 1,
    scope: Record<string, unknown> = {}
  ): Promise<ConsentGrant> {
    return this.service.grantConsent(context, studentId, purpose, noticeVersion, scope);
  }

  public async hasActiveConsent(
    _context: SessionContext,
    studentId: string,
    purpose: ConsentPurposeCode
  ): Promise<boolean> {
    return this.service.hasActiveConsent(studentId, purpose);
  }

  public async getGrant(_context: SessionContext, grantId: string): Promise<ConsentGrant | null> {
    const grant = this.service.getGrant(grantId);
    return grant ?? null;
  }

  public async revokeConsent(
    context: SessionContext,
    grantId: string,
    reason = 'Student initiated revocation'
  ): Promise<RevocationResult> {
    return this.service.revokeConsent(context, grantId, reason);
  }

  public getService(): ConsentService {
    return this.service;
  }
}

export class PgConsentRepository implements IConsentRepository {
  constructor(
    private pool: pg.Pool = getDbPool(),
    private auditRepository?: IAuditRepository
  ) {}

  public async grantConsent(
    context: SessionContext,
    studentId: string,
    purpose: ConsentPurposeCode,
    noticeVersion = 1,
    scope: Record<string, unknown> = {}
  ): Promise<ConsentGrant> {
    return withTenantTransaction(context, async (client) => {
      const id = randomUUID();
      const grantedAt = new Date().toISOString();

      const query = `
        INSERT INTO consent_grants (id, student_id, purpose, notice_version, scope, granted_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, student_id, purpose, notice_version, scope, granted_at, revoked_at;
      `;

      const res = await client.query(query, [
        id,
        studentId,
        purpose,
        noticeVersion,
        JSON.stringify(scope),
        grantedAt
      ]);

      const row = res.rows[0];
      const grant: ConsentGrant = {
        id: row.id,
        studentId: row.student_id,
        purpose: row.purpose,
        noticeVersion: row.notice_version,
        scope: typeof row.scope === 'string' ? JSON.parse(row.scope) : row.scope,
        grantedAt: new Date(row.granted_at).toISOString(),
        revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null
      };

      if (this.auditRepository) {
        if (this.auditRepository.logInTransaction) {
          await this.auditRepository.logInTransaction(
            client,
            context,
            'CONSENT_GRANTED',
            'consent_grant',
            grant.id,
            { studentId, purpose, noticeVersion }
          );
        } else {
          await this.auditRepository.log(
            context,
            'CONSENT_GRANTED',
            'consent_grant',
            grant.id,
            { studentId, purpose, noticeVersion }
          );
        }
      }

      return grant;
    }, this.pool);
  }

  /**
   * Tenant-scoped check whether an active, non-revoked consent grant exists for a student and purpose.
   * Executes strictly within withTenantTransaction() under the caller's SessionContext and app_api role,
   * guaranteeing RLS tenant boundaries and preventing cross-tenant leakage.
   */
  public async hasActiveConsent(
    context: SessionContext,
    studentId: string,
    purpose: ConsentPurposeCode
  ): Promise<boolean> {
    return withTenantTransaction(context, async (client) => {
      const query = `
        SELECT id 
        FROM consent_grants 
        WHERE student_id = $1 AND purpose = $2 AND revoked_at IS NULL
        LIMIT 1;
      `;
      const res = await client.query(query, [studentId, purpose]);
      return res.rows.length > 0;
    }, this.pool);
  }

  public async getGrant(context: SessionContext, grantId: string): Promise<ConsentGrant | null> {
    return withTenantTransaction(context, async (client) => {
      const res = await client.query(`
        SELECT id, student_id, purpose, notice_version, scope, granted_at, revoked_at
        FROM consent_grants
        WHERE id = $1;
      `, [grantId]);
      if (res.rows.length === 0) return null;
      const r = res.rows[0];
      return {
        id: r.id,
        studentId: r.student_id,
        purpose: r.purpose,
        noticeVersion: r.notice_version,
        scope: r.scope,
        grantedAt: new Date(r.granted_at).toISOString(),
        revokedAt: r.revoked_at ? new Date(r.revoked_at).toISOString() : null
      };
    }, this.pool);
  }

  public async revokeConsent(
    context: SessionContext,
    grantId: string,
    reason = 'Student initiated revocation'
  ): Promise<RevocationResult> {
    return withTenantTransaction(context, async (client) => {
      // 1. Fetch grant
      const grantRes = await client.query(`
        SELECT id, student_id, purpose, revoked_at 
        FROM consent_grants 
        WHERE id = $1;
      `, [grantId]);

      if (grantRes.rows.length === 0) {
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

      const grant = grantRes.rows[0];
      if (grant.revoked_at) {
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

      // 2. Mark grant revoked
      await client.query(`
        UPDATE consent_grants 
        SET revoked_at = NOW() 
        WHERE id = $1;
      `, [grantId]);

      let localTokenPurged = false;
      let withdrawnEvidenceCount = 0;
      let downgradedSkillsCount = 0;

      if (grant.purpose === 'repo_verification') {
        // A. Purge connected OAuth tokens
        const tokenDelRes = await client.query(`
          DELETE FROM connected_accounts 
          WHERE student_id = $1;
        `, [grant.student_id]);
        localTokenPurged = (tokenDelRes.rowCount ?? 0) > 0;

        // B. Withdraw derived repository evidence
        const evidenceRes = await client.query(`
          UPDATE evidence_items 
          SET status = 'withdrawn' 
          WHERE student_id = $1 AND kind IN ('code_span', 'commit') AND status = 'accepted';
        `, [grant.student_id]);
        withdrawnEvidenceCount = evidenceRes.rowCount ?? 0;

        // C. Downgrade skills that no longer have accepted evidence
        const skillRes = await client.query(`
          UPDATE student_skills sk
          SET state = 'claimed'
          WHERE sk.student_id = $1 
            AND sk.state IN ('evidence_linked', 'verified')
            AND NOT EXISTS (
              SELECT 1 
              FROM skill_evidence se 
              JOIN evidence_items ei ON ei.id = se.evidence_id 
              WHERE se.student_skill_id = sk.id AND ei.status = 'accepted'
            );
        `, [grant.student_id]);
        downgradedSkillsCount = skillRes.rowCount ?? 0;
      }

      const providerRevocationStatus = (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET)
        ? 'revoked_upstream'
        : 'sandbox_inert';

      if (this.auditRepository) {
        if (this.auditRepository.logInTransaction) {
          await this.auditRepository.logInTransaction(
            client,
            context,
            'CONSENT_REVOKED',
            'consent_grant',
            grantId,
            {
              studentId: grant.student_id,
              purpose: grant.purpose,
              reason,
              localTokenPurged,
              providerRevocationStatus,
              withdrawnEvidenceCount,
              downgradedSkillsCount
            }
          );
        } else {
          await this.auditRepository.log(
            context,
            'CONSENT_REVOKED',
            'consent_grant',
            grantId,
            {
              studentId: grant.student_id,
              purpose: grant.purpose,
              reason,
              localTokenPurged,
              providerRevocationStatus,
              withdrawnEvidenceCount,
              downgradedSkillsCount
            }
          );
        }
      }

      return {
        success: true,
        grantId,
        localTokenPurged,
        providerRevocationStatus,
        withdrawnEvidenceCount,
        downgradedSkillsCount
      };
    }, this.pool);
  }
}
