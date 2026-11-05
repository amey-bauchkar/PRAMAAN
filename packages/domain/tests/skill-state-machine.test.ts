import { describe, it, expect } from 'vitest';
import { SkillStateMachine } from '../src/skill-state-machine.js';
import { EvidenceItem } from '@pramaan/contracts';

describe('SkillStateMachine Domain Invariants & 5-State Lifecycle', () => {
  const dummyAcceptedEvidence: EvidenceItem = {
    id: '11111111-1111-1111-1111-111111111111',
    studentId: '22222222-2222-2222-2222-222222222222',
    kind: 'code_span',
    contentHash: 'a'.repeat(64),
    status: 'accepted',
    createdAt: new Date().toISOString()
  };

  const dummyRejectedEvidence: EvidenceItem = {
    id: '11111111-1111-1111-1111-111111111112',
    studentId: '22222222-2222-2222-2222-222222222222',
    kind: 'code_span',
    contentHash: 'b'.repeat(64),
    status: 'rejected',
    createdAt: new Date().toISOString()
  };

  it('verifies all 5 states exist and have defined transitions', () => {
    expect(SkillStateMachine.getAllowedTargets('claimed')).toEqual(['observed', 'evidence_linked']);
    expect(SkillStateMachine.getAllowedTargets('observed')).toEqual(['evidence_linked', 'claimed']);
    expect(SkillStateMachine.getAllowedTargets('evidence_linked')).toEqual(['verified', 'claimed', 'observed']);
    expect(SkillStateMachine.getAllowedTargets('verified')).toEqual(['expired']);
    expect(SkillStateMachine.getAllowedTargets('expired')).toEqual(['evidence_linked', 'verified', 'claimed']);
  });

  it('rejects direct transition from claimed to verified', () => {
    const result = SkillStateMachine.transition({
      studentSkillId: 'skill-1',
      currentState: 'claimed',
      targetState: 'verified',
      actorType: 'student',
      reasonCode: 'SELF_PROMOTION'
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Illegal state transition/);
  });

  it('rejects direct transition from observed to verified', () => {
    const result = SkillStateMachine.transition({
      studentSkillId: 'skill-1',
      currentState: 'observed',
      targetState: 'verified',
      actorType: 'evaluator_service',
      reasonCode: 'DIRECT_PROMOTION'
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Illegal state transition/);
  });

  it('allows claimed to transition to observed when static parser identifies a signal', () => {
    const result = SkillStateMachine.transition({
      studentSkillId: 'skill-1',
      currentState: 'claimed',
      targetState: 'observed',
      actorType: 'evaluator_service',
      reasonCode: 'STATIC_IMPORT_DETECTED_PYTHON'
    });
    expect(result.success).toBe(true);
    expect(result.newState).toBe('observed');
  });

  it('allows observed to revert to claimed if source repo is withdrawn', () => {
    const result = SkillStateMachine.transition({
      studentSkillId: 'skill-1',
      currentState: 'observed',
      targetState: 'claimed',
      actorType: 'student',
      reasonCode: 'REPO_CONSENT_REVOKED'
    });
    expect(result.success).toBe(true);
    expect(result.newState).toBe('claimed');
  });

  it('allows transition to evidence_linked with accepted evidence', () => {
    const result = SkillStateMachine.transition({
      studentSkillId: 'skill-1',
      currentState: 'claimed',
      targetState: 'evidence_linked',
      actorType: 'student',
      reasonCode: 'ATTACH_EVIDENCE',
      acceptedEvidence: [dummyAcceptedEvidence]
    });
    expect(result.success).toBe(true);
    expect(result.newState).toBe('evidence_linked');
  });

  it('rejects transition to evidence_linked when evidence is rejected', () => {
    const result = SkillStateMachine.transition({
      studentSkillId: 'skill-1',
      currentState: 'claimed',
      targetState: 'evidence_linked',
      actorType: 'student',
      reasonCode: 'ATTACH_EVIDENCE',
      acceptedEvidence: [dummyRejectedEvidence]
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/must have status 'accepted'/);
  });

  it('rejects transition to verified if verification record is missing, even with accepted evidence', () => {
    const result = SkillStateMachine.transition({
      studentSkillId: 'skill-1',
      currentState: 'evidence_linked',
      targetState: 'verified',
      actorType: 'evaluator_service',
      reasonCode: 'EVALUATE',
      acceptedEvidence: [dummyAcceptedEvidence],
      verificationResult: undefined // Missing!
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/without an attached qualifying verification record/);
  });

  it('rejects transition to verified if accepted evidence is missing, even with passing probe', () => {
    const result = SkillStateMachine.transition({
      studentSkillId: 'skill-1',
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

  it('rejects transition to verified if probe failed', () => {
    const result = SkillStateMachine.transition({
      studentSkillId: 'skill-1',
      currentState: 'evidence_linked',
      targetState: 'verified',
      actorType: 'evaluator_service',
      reasonCode: 'PROBE_FAILED',
      acceptedEvidence: [dummyAcceptedEvidence],
      verificationResult: {
        type: 'probe',
        verificationId: 'verif-1',
        probeResult: {
          probeId: 'probe-1',
          passed: false,
          exitCode: 1,
          executionTimeMs: 120,
          stdout: '',
          stderr: 'AssertionError',
          testSummary: { total: 2, passed: 1, failed: 1 }
        }
      }
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Probe test did not pass/);
  });

  it('promotes skill from evidence_linked to verified with passing probe and accepted evidence', () => {
    const result = SkillStateMachine.transition({
      studentSkillId: 'skill-1',
      currentState: 'evidence_linked',
      targetState: 'verified',
      actorType: 'evaluator_service',
      reasonCode: 'PROBE_PASSED',
      acceptedEvidence: [dummyAcceptedEvidence],
      verificationResult: {
        type: 'probe',
        verificationId: 'verif-2',
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

  it('supports direct re-verification from expired to verified', () => {
    const result = SkillStateMachine.transition({
      studentSkillId: 'skill-1',
      currentState: 'expired',
      targetState: 'verified',
      actorType: 'evaluator_service',
      reasonCode: 'REVERIFICATION_PASSED',
      acceptedEvidence: [dummyAcceptedEvidence],
      verificationResult: {
        type: 'probe',
        verificationId: 'verif-3',
        probeResult: {
          probeId: 'probe-3',
          passed: true,
          exitCode: 0,
          executionTimeMs: 30,
          stdout: 'Pass',
          stderr: '',
          testSummary: { total: 1, passed: 1, failed: 0 }
        }
      }
    });
    expect(result.success).toBe(true);
    expect(result.newState).toBe('verified');
  });
});
