import { describe, it, expect, beforeEach } from 'vitest';
import { AuditService } from '../src/services/audit-service.js';
import { SessionContext } from '@pramaan/contracts';

describe('M1: Cryptographic Audit Chain (P0-02)', () => {
  let auditService: AuditService;

  const tenantA: SessionContext = {
    orgId: '00000000-0000-0000-0000-000000000001',
    userId: '20000000-0000-0000-0000-000000000001',
    role: 'officer'
  };

  const tenantB: SessionContext = {
    orgId: '00000000-0000-0000-0000-000000000002',
    userId: '20000000-0000-0000-0000-000000000099',
    role: 'officer'
  };

  beforeEach(() => {
    auditService = new AuditService();
  });

  it('records audit events with monotonic sequence and valid SHA-256 hash chaining', () => {
    const e1 = auditService.log(tenantA, 'STUDENT_ENROLLED', 'student', 'std-1', { roll: 'CS-01' });
    const e2 = auditService.log(tenantA, 'CONSENT_GRANTED', 'consent_grant', 'grant-1', { purpose: 'repo_verification' });
    const e3 = auditService.log(tenantA, 'PROBE_EXECUTED', 'probe_run', 'probe-1', { passed: true });

    expect(e1.seq).toBe(1);
    expect(e2.seq).toBe(2);
    expect(e3.seq).toBe(3);

    expect(e2.prevHash).toBe(e1.hash);
    expect(e3.prevHash).toBe(e2.hash);

    const integrity = auditService.verifyIntegrity();
    expect(integrity.valid).toBe(true);
  });

  it('RLS-12: Tenant context filters audit events strictly to own organization', () => {
    auditService.log(tenantA, 'TENANT_A_ACTION', 'doc', 'doc-1');
    auditService.log(tenantB, 'TENANT_B_ACTION', 'doc', 'doc-2');

    const tenantAEvents = auditService.getEventsForTenant(tenantA);
    expect(tenantAEvents).toHaveLength(1);
    expect(tenantAEvents[0].action).toBe('TENANT_A_ACTION');

    const tenantBEvents = auditService.getEventsForTenant(tenantB);
    expect(tenantBEvents).toHaveLength(1);
    expect(tenantBEvents[0].action).toBe('TENANT_B_ACTION');
  });

  it('detects tampering if an audit event payload is modified', () => {
    auditService.log(tenantA, 'AUTH_LOGIN', 'user', 'usr-1');
    auditService.log(tenantA, 'ELIGIBILITY_OVERRIDE', 'decision', 'dec-1', { approved: false });
    auditService.log(tenantA, 'EXPORT_REPORT', 'report', 'rep-1');

    // Tamper with seq 2
    auditService.__tamperWithEvent(2, 'UNAUTHORIZED_ALTERATION');

    const integrity = auditService.verifyIntegrity();
    expect(integrity.valid).toBe(false);
    expect(integrity.brokenAtSeq).toBe(2);
    expect(integrity.error).toMatch(/Tampered event payload/);
  });
});

