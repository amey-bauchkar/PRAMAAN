import { describe, it, expect } from 'vitest';
import { SkillStateMachine } from '../src/skill-state-machine.js';
import { EvidenceItem } from '@pramaan/contracts';

describe('SkillStateMachine Domain Invariants & 8 Verification Security Paths', () => {
  const studentA = '22222222-2222-2222-2222-222222222222';
  const studentB = '99999999-9999-9999-9999-999999999999';

  const dummyAcceptedEvidenceA: EvidenceItem = {
    id: '11111111-1111-1111-1111-111111111111',
    studentId: studentA,
    kind: 'code_span',
    contentHash: 'a'.repeat(64),
    status: 'accepted',
    createdAt: new Date().toISOString()
  };

  const dummyWithdrawnEvidenceA: EvidenceItem = {
    id: '11111111-1111-1111-1111-111111111112',
    studentId: studentA,
    kind: 'code_span',
    contentHash: 'b'.repeat(64),
    status: 'withdrawn',
    createdAt: new Date().toISOString()
  };

  const dummyForeignStudentEvidence: EvidenceItem = {
    id: '11111111-1111-1111-1111-111111111113',
    studentId: studentB, // Different student!
    kind: 'code_span',
    contentHash: 'c'.repeat(64),
    status: 'accepted',
    createdAt: new Date().toISOString()
  };

  it('1. Cannot transition to VERIFIED from claimed or observed without accepted evidence', () => {
    const resClaimed = SkillStateMachine.transition({
      studentSkillId: 'skill-1',
      studentId: studentA,
      currentState: 'claimed',
      targetState: 'verified',
      actorType: 'student',
      reasonCode: 'SELF_PROMOTION'
    });
    expect(resClaimed.success).toBe(false);
    expect(resClaimed.error).toMatch(/Illegal state transition/);

    const resObserved = SkillStateMachine.transition({
      studentSkillId: 'skill-1',
      studentId: studentA,
      currentState: 'observed',
      targetState: 'verified',
      actorType: 'evaluator_service',
      reasonCode: 'DIRECT_PROMOTION'
    });
    expect(resObserved.success).toBe(false);
    expect(resObserved.error).toMatch(/Illegal state transition/);
  });

  it('2. Cannot update an existing skill (evidence_linked) to VERIFIED without accepted evidence', () => {
    const result = SkillStateMachine.transition({
      studentSkillId: 'skill-1',
      studentId: studentA,
      currentState: 'evidence_linked',
      targetState: 'verified',
      actorType: 'evaluator_service',
      reasonCode: 'EVALUATE',
      acceptedEvidence: [], // No evidence!
      verificationResult: {
        type: 'probe',
        verificationId: 'verif-1',
        probeResult: {
          probeId: 'probe-1',
          passed: true,
          exitCode: 0,
          executionTimeMs: 40,
          stdout: '',
          stderr: '',
          testSummary: { total: 1, passed: 1, failed: 0 }
        }
      }
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/without at least one accepted evidence item/);
  });

  it('3. Cannot verify against withdrawn evidence', () => {
    const result = SkillStateMachine.transition({
      studentSkillId: 'skill-1',
      studentId: studentA,
      currentState: 'evidence_linked',
      targetState: 'verified',
      actorType: 'evaluator_service',
      reasonCode: 'EVALUATE',
      acceptedEvidence: [dummyWithdrawnEvidenceA], // Withdrawn status!
      verificationResult: {
        type: 'probe',
        verificationId: 'verif-1',
        probeResult: {
          probeId: 'probe-1',
          passed: true,
          exitCode: 0,
          executionTimeMs: 40,
          stdout: '',
          stderr: '',
          testSummary: { total: 1, passed: 1, failed: 0 }
        }
      }
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/withdrawn or non-accepted evidence/);
  });

  it('4. Cannot verify using evidence belonging to a different student', () => {
    const result = SkillStateMachine.transition({
      studentSkillId: 'skill-1',
      studentId: studentA, // Student A
      currentState: 'evidence_linked',
      targetState: 'verified',
      actorType: 'evaluator_service',
      reasonCode: 'EVALUATE',
      acceptedEvidence: [dummyForeignStudentEvidence], // Belongs to Student B!
      verificationResult: {
        type: 'probe',
        verificationId: 'verif-1',
        probeResult: {
          probeId: 'probe-1',
          passed: true,
          exitCode: 0,
          executionTimeMs: 40,
          stdout: '',
          stderr: '',
          testSummary: { total: 1, passed: 1, failed: 0 }
        }
      }
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Evidence ownership violation.*different student/);
  });

  it('5. Cannot link evidence belonging to a different student to evidence_linked', () => {
    const result = SkillStateMachine.transition({
      studentSkillId: 'skill-1',
      studentId: studentA,
      currentState: 'claimed',
      targetState: 'evidence_linked',
      actorType: 'student',
      reasonCode: 'ATTACH_EVIDENCE',
      acceptedEvidence: [dummyForeignStudentEvidence]
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Evidence ownership violation.*another student/);
  });

  it('6. Cannot verify after a failed probe', () => {
    const result = SkillStateMachine.transition({
      studentSkillId: 'skill-1',
      studentId: studentA,
      currentState: 'evidence_linked',
      targetState: 'verified',
      actorType: 'evaluator_service',
      reasonCode: 'PROBE_FAILED',
      acceptedEvidence: [dummyAcceptedEvidenceA],
      verificationResult: {
        type: 'probe',
        verificationId: 'verif-1',
        probeResult: {
          probeId: 'probe-1',
          passed: false, // FAILED!
          exitCode: 1,
          executionTimeMs: 120,
          stdout: '',
          stderr: 'AssertionError: expected 5 to be 10',
          testSummary: { total: 2, passed: 1, failed: 1 }
        }
      }
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Probe test did not pass/);
  });

  it('7. Can verify with qualifying accepted evidence and a passing verification result', () => {
    const result = SkillStateMachine.transition({
      studentSkillId: 'skill-1',
      studentId: studentA,
      currentState: 'evidence_linked',
      targetState: 'verified',
      actorType: 'evaluator_service',
      reasonCode: 'PROBE_PASSED',
      acceptedEvidence: [dummyAcceptedEvidenceA],
      verificationResult: {
        type: 'probe',
        verificationId: 'verif-2',
        outcome: 'passed',
        probeResult: {
          probeId: 'probe-2',
          passed: true,
          exitCode: 0,
          executionTimeMs: 35,
          stdout: 'Pass',
          stderr: '',
          testSummary: { total: 3, passed: 3, failed: 0 }
        }
      }
    });
    expect(result.success).toBe(true);
    expect(result.newState).toBe('verified');
  });

  it('8. EXPIRED can be re-verified only through the permitted verification path', () => {
    // Attempt re-verification without passing probe
    const failedReverif = SkillStateMachine.transition({
      studentSkillId: 'skill-1',
      studentId: studentA,
      currentState: 'expired',
      targetState: 'verified',
      actorType: 'evaluator_service',
      reasonCode: 'REVERIF_ATTEMPT',
      acceptedEvidence: [dummyAcceptedEvidenceA],
      verificationResult: {
        type: 'probe',
        verificationId: 'verif-3',
        outcome: 'failed',
        probeResult: {
          probeId: 'probe-3',
          passed: false,
          exitCode: 1,
          executionTimeMs: 50,
          stdout: '',
          stderr: 'Failed',
          testSummary: { total: 1, passed: 0, failed: 1 }
        }
      }
    });
    expect(failedReverif.success).toBe(false);
    expect(failedReverif.error).toMatch(/Verification session outcome is 'failed'/);

    // Permitted re-verification path with valid probe
    const validReverif = SkillStateMachine.transition({
      studentSkillId: 'skill-1',
      studentId: studentA,
      currentState: 'expired',
      targetState: 'verified',
      actorType: 'evaluator_service',
      reasonCode: 'REVERIFICATION_PASSED',
      acceptedEvidence: [dummyAcceptedEvidenceA],
      verificationResult: {
        type: 'probe',
        verificationId: 'verif-4',
        outcome: 'passed',
        probeResult: {
          probeId: 'probe-4',
          passed: true,
          exitCode: 0,
          executionTimeMs: 25,
          stdout: 'Pass',
          stderr: '',
          testSummary: { total: 1, passed: 1, failed: 0 }
        }
      }
    });
    expect(validReverif.success).toBe(true);
    expect(validReverif.newState).toBe('verified');
  });
});
