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
  getActiveGrant(
    context: SessionContext,
    studentId: string,
    purpose: ConsentPurposeCode
  ): Promise<ConsentGrant | null>;
  revokeConsent(
    context: SessionContext,
    grantId: string,
    reason?: string
  ): Promise<RevocationResult>;
}

export class InMemoryConsentRepository implements IConsentRepository {
  private providerRevocationDelegate?: ProviderRevocationDelegate;

  constructor(private service: ConsentService) {}

  public setProviderRevocationDelegate(delegate: ProviderRevocationDelegate): void {
    this.providerRevocationDelegate = delegate;
  }

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

  public async getActiveGrant(
    _context: SessionContext,
    studentId: string,
    purpose: ConsentPurposeCode
  ): Promise<ConsentGrant | null> {
    return this.service.getActiveGrant(studentId, purpose);
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
    let delegateResult: { localTokenPurged: boolean; providerRevocationStatus: 'confirmed' | 'failed' | 'local_only'; error?: string } | null = null;
    if (this.providerRevocationDelegate) {
      const grant = this.service.getGrant(grantId);
      if (grant && grant.purpose === 'repo_verification') {
        delegateResult = await this.providerRevocationDelegate.revokeUpstreamGrantAndUnlink(context, grant.studentId);
      }
    }

    const result = await this.service.revokeConsent(context, grantId, reason);
    if (delegateResult) {
      result.providerRevocationStatus = delegateResult.providerRevocationStatus;
      if (delegateResult.localTokenPurged) {
        result.localTokenPurged = true;
      }
      if (delegateResult.error && !result.error) {
        result.error = delegateResult.error;
      }
    }
    return result;
  }

  public getService(): ConsentService {
    return this.service;
  }
}

export interface ProviderRevocationDelegate {
  revokeUpstreamGrantAndUnlink(
    context: SessionContext,
    studentId: string
  ): Promise<{
    localTokenPurged: boolean;
    providerRevocationStatus: 'confirmed' | 'failed' | 'local_only';
    error?: string;
  }>;
}

export class PgConsentRepository implements IConsentRepository {
  constructor(
    private pool: pg.Pool = getDbPool(),
    private auditRepository?: IAuditRepository,
    private providerRevocationDelegate?: ProviderRevocationDelegate
  ) {}

  public setProviderRevocationDelegate(delegate: ProviderRevocationDelegate): void {
    this.providerRevocationDelegate = delegate;
  }

  public async grantConsent(
    context: SessionContext,
    studentId: string,
    purpose: ConsentPurposeCode,
    noticeVersion = 1,
    scope: Record<string, unknown> = {}
  ): Promise<ConsentGrant> {
    return withTenantTransaction(context, async (client) => {
      // 0. Serialize concurrent grant operations for the same (student_id, purpose)
      await client.query(`
        SELECT pg_advisory_xact_lock(hashtext($1 || ':' || $2));
      `, [studentId, purpose]);

      // 1. Transactionally transition any pre-existing active grant into revoked history
      //    strictly guaranteeing at most ONE active grant per (student_id, purpose).
      await client.query(`
        UPDATE consent_grants
        SET revoked_at = CURRENT_TIMESTAMP
        WHERE student_id = $1 AND purpose = $2 AND revoked_at IS NULL;
      `, [studentId, purpose]);

      // 2. Insert the new active grant
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

  public async getActiveGrant(
    context: SessionContext,
    studentId: string,
    purpose: ConsentPurposeCode
  ): Promise<ConsentGrant | null> {
    return withTenantTransaction(context, async (client) => {
      const query = `
        SELECT id, student_id, purpose, notice_version, scope, granted_at, revoked_at
        FROM consent_grants
        WHERE student_id = $1 AND purpose = $2 AND revoked_at IS NULL
        ORDER BY granted_at DESC
        LIMIT 1;
      `;
      const res = await client.query(query, [studentId, purpose]);
      if (res.rows.length === 0) return null;
      const r = res.rows[0];
      return {
        id: r.id,
        studentId: r.student_id,
        purpose: r.purpose,
        noticeVersion: r.notice_version,
        scope: r.scope,
        grantedAt: new Date(r.granted_at).toISOString(),
        revokedAt: r.revoked_at ? new Date(r.revoked_at).toISOString() : null,
      };
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
    // 1. Initial grant lookup under tenant context (zero mutating locks held)
    const initialGrant = await withTenantTransaction(context, async (client) => {
      const grantRes = await client.query(`
        SELECT id, student_id, purpose, revoked_at 
        FROM consent_grants 
        WHERE id = $1;
      `, [grantId]);
      if (grantRes.rows.length === 0) return null;
      return grantRes.rows[0];
    }, this.pool);

    if (!initialGrant) {
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

    if (initialGrant.revoked_at) {
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

    // 2. Perform provider-side revocation OUTSIDE of any database transaction holding locks
    let providerRevocationStatus: 'confirmed' | 'failed' | 'local_only' | 'sandbox_inert' | 'revoked_upstream' | 'upstream_failed' = 'sandbox_inert';
    let upstreamError: string | undefined;

    if (initialGrant.purpose === 'repo_verification') {
      if (this.providerRevocationDelegate) {
        try {
          const upRes = await this.providerRevocationDelegate.revokeUpstreamGrantAndUnlink(context, initialGrant.student_id);
          providerRevocationStatus = upRes.providerRevocationStatus;
          upstreamError = upRes.error;
        } catch (err: any) {
          providerRevocationStatus = 'failed';
          upstreamError = err.message;
        }
      } else {
        providerRevocationStatus = 'sandbox_inert';
      }
    }

    // 3. Atomically perform state transition, data quarantine, and audit logging in a tenant transaction
    return withTenantTransaction(context, async (client) => {
      // Re-verify under row lock to prevent race conditions
      const lockRes = await client.query(`
        SELECT id, student_id, purpose, revoked_at 
        FROM consent_grants 
        WHERE id = $1
        FOR UPDATE;
      `, [grantId]);

      if (lockRes.rows.length === 0) {
        return {
          success: false,
          grantId,
          localTokenPurged: false,
          providerRevocationStatus,
          withdrawnEvidenceCount: 0,
          downgradedSkillsCount: 0,
          error: 'Grant not found.'
        };
      }

      const grant = lockRes.rows[0];
      if (grant.revoked_at) {
        return {
          success: false,
          grantId,
          localTokenPurged: false,
          providerRevocationStatus,
          withdrawnEvidenceCount: 0,
          downgradedSkillsCount: 0,
          error: 'Consent grant is already revoked.'
        };
      }

      // Transition all active grants for (student_id, purpose) to revoked, strictly leaving zero active grants
      await client.query(`
        UPDATE consent_grants 
        SET revoked_at = CURRENT_TIMESTAMP 
        WHERE student_id = $1 AND purpose = $2 AND revoked_at IS NULL;
      `, [grant.student_id, grant.purpose]);

      let localTokenPurged = false;
      let withdrawnEvidenceCount = 0;
      let downgradedSkillsCount = 0;
      let quarantinedSnapshotCount = 0;

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

        // D. Quarantine source snapshots to ensure revoked content is inaccessible for authoritative resolution
        const snapRes = await client.query(`
          UPDATE source_snapshots
          SET registration_state = 'quarantined'
          WHERE student_id = $1;
        `, [grant.student_id]);
        quarantinedSnapshotCount = snapRes.rowCount ?? 0;

        // D2. Mark trusted ingestion records revoked to ensure they cannot be used for authoritative resolution
        await client.query(`
          UPDATE trusted_ingestion_records
          SET status = 'revoked'
          WHERE student_id = $1;
        `, [grant.student_id]);

        // E. Cancel all applicable in-progress ingestion jobs
        await client.query(`
          UPDATE ingestion_jobs
          SET status = 'failed',
              error = 'CONSENT_REVOKED',
              diagnostics = jsonb_set(
                COALESCE(diagnostics, '{}'::jsonb),
                '{revocation_reason}',
                '"CONSENT_REVOKED"'
              ),
              completed_at = CURRENT_TIMESTAMP
          WHERE student_id = $1 
            AND status IN ('queued', 'resolving', 'fetching', 'verifying', 'persisted');
        `, [grant.student_id]);
      }

      if (this.auditRepository) {
        const auditMetadata = {
          studentId: grant.student_id,
          purpose: grant.purpose,
          reason,
          localTokenPurged,
          providerRevocationStatus,
          upstreamError,
          withdrawnEvidenceCount,
          downgradedSkillsCount,
          quarantinedSnapshotCount,
        };
        if (this.auditRepository.logInTransaction) {
          await this.auditRepository.logInTransaction(
            client,
            context,
            'CONSENT_REVOKED',
            'consent_grant',
            grantId,
            auditMetadata
          );
        } else {
          await this.auditRepository.log(
            context,
            'CONSENT_REVOKED',
            'consent_grant',
            grantId,
            auditMetadata
          );
        }
      }

      return {
        success: true,
        grantId,
        localTokenPurged,
        providerRevocationStatus,
        upstreamError,
        withdrawnEvidenceCount,
        downgradedSkillsCount,
        quarantinedSnapshotCount,
      };
    }, this.pool);
  }
}
