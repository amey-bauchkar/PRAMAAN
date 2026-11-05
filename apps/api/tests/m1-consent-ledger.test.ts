import { describe, it, expect, beforeEach } from 'vitest';
import { ConsentService } from '../src/services/consent-service.js';
import { AuditService } from '../src/services/audit-service.js';
import { SessionContext, EvidenceItem, StudentSkill } from '@pramaan/contracts';

describe('M1: Consent Ledger, Instant Revocation & Artifact Handling (P0-03)', () => {
  let auditService: AuditService;
  let consentService: ConsentService;

  const studentContext: SessionContext = {
    orgId: '00000000-0000-0000-0000-000000000001',
    userId: '20000000-0000-0000-0000-000000000003',
    role: 'student'
  };

  const studentId = '40000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    auditService = new AuditService();
    consentService = new ConsentService(auditService);
  });

  it('rejects storing OAuth tokens before consent is granted for repo_verification', () => {
    const res = consentService.storeConnectedToken(studentContext, studentId, 'ghp_secret_dummy_token');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/CONSENT_REQUIRED/);
    expect(consentService.hasValidConnectedToken(studentId)).toBe(false);
  });

  it('allows token storage after student grants repo_verification consent', () => {
    const grant = consentService.grantConsent(studentContext, studentId, 'repo_verification', 1);
    expect(grant.id).toBeDefined();
    expect(grant.revokedAt).toBeNull();
    expect(consentService.hasActiveConsent(studentId, 'repo_verification')).toBe(true);

    const tokenRes = consentService.storeConnectedToken(studentContext, studentId, 'ghp_secret_dummy_token');
    expect(tokenRes.success).toBe(true);
    expect(consentService.hasValidConnectedToken(studentId)).toBe(true);

    const events = auditService.getEventsForTenant(studentContext);
    expect(events.map(e => e.action)).toContain('CONSENT_GRANTED');
    expect(events.map(e => e.action)).toContain('OAUTH_TOKEN_STORED');
  });

  it('instant revocation: purges tokens, withdraws derived evidence, downgrades skill, and audits', async () => {
    // 1. Grant consent & connect token
    const grant = consentService.grantConsent(studentContext, studentId, 'repo_verification', 1);
    consentService.storeConnectedToken(studentContext, studentId, 'ghp_secret_dummy_token');

    // 2. Register derived evidence item and evidence-linked skill
    const derivedEvidence: EvidenceItem = {
      id: '55555555-5555-5555-5555-555555555555',
      studentId,
      kind: 'code_span',
      contentHash: 'c'.repeat(64),
      status: 'accepted',
      createdAt: new Date().toISOString()
    };
    consentService.registerEvidence(derivedEvidence);

    const studentSkill: StudentSkill = {
      id: '66666666-6666-6666-6666-666666666666',
      studentId,
      skillId: '77777777-7777-7777-7777-777777777777',
      state: 'evidence_linked',
      stateSince: new Date().toISOString(),
      evidenceStrength: 'medium'
    };
    consentService.registerStudentSkill(studentSkill);

    // 3. Execute revocation
    const revokeRes = await consentService.revokeConsent(studentContext, grant.id, 'User clicked revoke in UI');
    expect(revokeRes.success).toBe(true);
    expect(revokeRes.localTokenPurged).toBe(true);
    expect(revokeRes.providerRevocationStatus).toBe('sandbox_inert'); // Documented sandbox fallback
    expect(revokeRes.withdrawnEvidenceCount).toBe(1);
    expect(revokeRes.downgradedSkillsCount).toBe(1);

    // 4. Assert token is purged and active consent is false
    expect(consentService.hasActiveConsent(studentId, 'repo_verification')).toBe(false);
    expect(consentService.hasValidConnectedToken(studentId)).toBe(false);

    // 5. Assert derived evidence was marked withdrawn
    expect(derivedEvidence.status).toBe('withdrawn');

    // 6. Assert skill was downgraded to claimed
    expect(studentSkill.state).toBe('claimed');

    // 7. Verify complete audit trail
    const events = auditService.getEventsForTenant(studentContext);
    const actions = events.map(e => e.action);
    expect(actions).toContain('CONSENT_GRANTED');
    expect(actions).toContain('OAUTH_TOKEN_STORED');
    expect(actions).toContain('OAUTH_TOKENS_PURGED');
    expect(actions).toContain('DERIVED_ARTIFACTS_WITHDRAWN');
    expect(actions).toContain('CONSENT_REVOKED');
  });
});
