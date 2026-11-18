import { describe, it, expect, beforeEach } from 'vitest';
import { ConsentService } from '../src/services/consent-service.js';
import { AuditService } from '../src/services/audit-service.js';
import { SessionContext, EvidenceItem, StudentSkill } from '@pramaan/contracts';

/**
 * Phase 0 fix C1: revoking repository consent must demote Verified skills that relied on repository
 * evidence (previously the transition was rejected and Verified skills silently stayed Verified),
 * while skills backed by other accepted evidence keep that evidence.
 */
describe('Consent revocation demotes repository-derived skills (C1)', () => {
  let consentService: ConsentService;
  const ctx: SessionContext = {
    orgId: '00000000-0000-0000-0000-000000000001',
    userId: '20000000-0000-0000-0000-000000000003',
    role: 'student',
  };
  const studentId = '40000000-0000-0000-0000-000000000001';

  const evidence = (id: string, kind: EvidenceItem['kind']): EvidenceItem => ({
    id, studentId, kind, contentHash: 'c'.repeat(64), status: 'accepted', createdAt: new Date().toISOString(),
  });
  const skill = (id: string, state: StudentSkill['state']): StudentSkill => ({
    id, studentId, skillId: '77777777-7777-7777-7777-77777777777' + id.slice(-1), state,
    stateSince: new Date().toISOString(), evidenceStrength: 'medium', proofLevel: state === 'verified' ? 'L1_code_backed' : null,
  });

  beforeEach(() => {
    consentService = new ConsentService(new AuditService());
  });

  it('verified skill backed only by code drops to claimed; one with a certificate drops to evidence_linked; a certificate-only skill is untouched', async () => {
    const grant = consentService.grantConsent(ctx, studentId, 'repo_verification', 1);

    const code = evidence('50000000-0000-0000-0000-000000000001', 'code_span');
    const cert = evidence('50000000-0000-0000-0000-000000000002', 'certificate');
    consentService.registerEvidence(code);
    consentService.registerEvidence(cert);

    const codeOnly = skill('60000000-0000-0000-0000-000000000001', 'verified');
    const codeAndCert = skill('60000000-0000-0000-0000-000000000002', 'verified');
    const certOnly = skill('60000000-0000-0000-0000-000000000003', 'verified');
    for (const s of [codeOnly, codeAndCert, certOnly]) consentService.registerStudentSkill(s);
    consentService.linkSkillEvidence(codeOnly.id, code.id);
    consentService.linkSkillEvidence(codeAndCert.id, code.id);
    consentService.linkSkillEvidence(codeAndCert.id, cert.id);
    consentService.linkSkillEvidence(certOnly.id, cert.id);

    const res = await consentService.revokeConsent(ctx, grant.id, 'Student revoked GitHub access');
    expect(res.success).toBe(true);
    expect(res.downgradedSkillsCount).toBe(2);

    expect(codeOnly.state).toBe('claimed');
    expect(codeOnly.proofLevel).toBeNull();
    expect(codeAndCert.state).toBe('evidence_linked');
    expect(certOnly.state).toBe('verified');
    expect(code.status).toBe('withdrawn');
    expect(cert.status).toBe('accepted');
  });
});
