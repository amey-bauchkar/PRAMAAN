import { describe, it, expect } from 'vitest';
import { SkillStateMachine, StateTransitionContext } from '../src/skill-state-machine.js';
import { EvidenceItem, Attestation, meetsMinProof } from '@pramaan/contracts';

const NOW = '2026-11-16T00:00:00.000Z';
const studentA = '22222222-2222-2222-2222-222222222222';

function ev(over: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    studentId: studentA,
    kind: 'code_span',
    contentHash: 'a'.repeat(64),
    status: 'accepted',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function base(over: Partial<StateTransitionContext> = {}): StateTransitionContext {
  return {
    studentSkillId: 'ss-1',
    studentId: studentA,
    currentState: 'evidence_linked',
    targetState: 'verified',
    actorType: 'evaluator_service',
    reasonCode: 'VERIFY',
    acceptedEvidence: [ev()],
    now: NOW,
    ...over,
  };
}

const passedProbe = {
  probeId: 'p', passed: true, exitCode: 0, executionTimeMs: 10, stdout: '', stderr: '',
  testSummary: { total: 1, passed: 1, failed: 0 },
};

describe('Proof Levels: each verification type yields its level', () => {
  it('probe → L3_defended with a re-verify date one half-life away', () => {
    const r = SkillStateMachine.transition(base({
      halfLifeDays: 365,
      verificationResult: { type: 'probe', verificationId: 'v1', outcome: 'passed', probeResult: passedProbe },
    }));
    expect(r.success).toBe(true);
    expect(r.proofLevel).toBe('L3_defended');
    expect(r.validUntil).toBe('2027-11-16T00:00:00.000Z');
    expect(r.event?.proofLevel).toBe('L3_defended');
  });

  it('code_backed → L1 only when the L1 policy is met', () => {
    const weak = SkillStateMachine.transition(base({
      verificationResult: { type: 'code_backed', verificationId: 'v', outcome: 'passed', codeBacked: { anchoredFiles: 1, anchoredLines: 400, commitSpanDays: 60 } },
    }));
    expect(weak.success).toBe(false);
    expect(weak.error).toMatch(/Code-backed proof needs/);

    const ok = SkillStateMachine.transition(base({
      verificationResult: { type: 'code_backed', verificationId: 'v', outcome: 'passed', codeBacked: { anchoredFiles: 3, anchoredLines: 120, commitSpanDays: 30 } },
    }));
    expect(ok.success).toBe(true);
    expect(ok.proofLevel).toBe('L1_code_backed');
  });

  it('assessment → L2 only above the pass ratio and only with test_result evidence', () => {
    const wrongKind = SkillStateMachine.transition(base({
      verificationResult: { type: 'assessment', verificationId: 'v', outcome: 'passed', assessment: { score: 18, maxScore: 20 } },
    }));
    expect(wrongKind.success).toBe(false);
    expect(wrongKind.error).toMatch(/requires fresh accepted evidence of kind: test_result/);

    const low = SkillStateMachine.transition(base({
      acceptedEvidence: [ev({ kind: 'test_result' })],
      verificationResult: { type: 'assessment', verificationId: 'v', outcome: 'passed', assessment: { score: 10, maxScore: 20 } },
    }));
    expect(low.success).toBe(false);
    expect(low.error).toMatch(/below the pass ratio/);

    const ok = SkillStateMachine.transition(base({
      acceptedEvidence: [ev({ kind: 'test_result' })],
      verificationResult: { type: 'assessment', verificationId: 'v', outcome: 'passed', assessment: { score: 14, maxScore: 20 } },
    }));
    expect(ok.success).toBe(true);
    expect(ok.proofLevel).toBe('L2_assessed');
  });

  it('meetsMinProof ranks both L3 variants equally', () => {
    expect(meetsMinProof('L3_attested', 'L3')).toBe(true);
    expect(meetsMinProof('L2_assessed', 'L3')).toBe(false);
    expect(meetsMinProof('L1_code_backed', 'L1')).toBe(true);
    expect(meetsMinProof(null, 'L1')).toBe(false);
  });
});

describe('C3: studentId is mandatory', () => {
  it('rejects a transition with no studentId instead of skipping the ownership check', () => {
    const r = SkillStateMachine.transition({ ...base(), studentId: '' as string });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/studentId is required/);
  });
});

describe('C4: mentor attestation must pass its rubric and be in date', () => {
  const lab = ev({ id: '33333333-3333-3333-3333-333333333333', kind: 'lab' });
  const att = (over: Partial<Attestation> = {}): Attestation => ({
    id: '44444444-4444-4444-4444-444444444444',
    evidenceId: lab.id,
    mentorMembershipId: '55555555-5555-5555-5555-555555555555',
    rubricVersionId: '66666666-6666-6666-6666-666666666666',
    scopeText: 'Built and calibrated the line-follower robot',
    rubricScores: { design: 3, execution: 2, explanation: 2 },
    validUntil: '2027-06-01T00:00:00.000Z',
    createdAt: '2026-10-01T00:00:00.000Z',
    ...over,
  });

  it('requires an explicit passed outcome', () => {
    const r = SkillStateMachine.transition(base({
      acceptedEvidence: [lab],
      verificationResult: { type: 'attestation', verificationId: 'v', attestation: att() },
    }));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/must be explicitly 'passed'/);
  });

  it('rejects a low rubric score', () => {
    const r = SkillStateMachine.transition(base({
      acceptedEvidence: [lab],
      verificationResult: { type: 'attestation', verificationId: 'v', outcome: 'passed', attestation: att({ rubricScores: { design: 1, execution: 2 } }) },
    }));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/below the pass mark/);
  });

  it('rejects an expired attestation', () => {
    const r = SkillStateMachine.transition(base({
      acceptedEvidence: [lab],
      verificationResult: { type: 'attestation', verificationId: 'v', outcome: 'passed', attestation: att({ validUntil: '2026-10-31T00:00:00.000Z' }) },
    }));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/attestation has expired/);
  });

  it('rejects an attestation that points at evidence not linked to the skill', () => {
    const r = SkillStateMachine.transition(base({
      acceptedEvidence: [lab],
      verificationResult: { type: 'attestation', verificationId: 'v', outcome: 'passed', attestation: att({ evidenceId: '77777777-7777-7777-7777-777777777777' }) },
    }));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/must reference one of the accepted evidence items/);
  });

  it('a valid attestation gives L3_attested, capped at the attestation validity', () => {
    const r = SkillStateMachine.transition(base({
      acceptedEvidence: [lab],
      verificationResult: { type: 'attestation', verificationId: 'v', outcome: 'passed', attestation: att() },
    }));
    expect(r.success).toBe(true);
    expect(r.proofLevel).toBe('L3_attested');
    expect(r.validUntil).toBe('2027-06-01T00:00:00.000Z');
  });
});

describe('C2: no stale proof', () => {
  it('rejects verification when all accepted evidence has passed its validity date', () => {
    const r = SkillStateMachine.transition(base({
      acceptedEvidence: [ev({ validUntil: '2026-06-01T00:00:00.000Z' })],
      verificationResult: { type: 'probe', verificationId: 'v', outcome: 'passed', probeResult: passedProbe },
    }));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/passed its validity date/);
  });

  it('re-verifying an expired skill needs a verification newer than the expiry', () => {
    const stale = SkillStateMachine.transition(base({
      currentState: 'expired',
      currentStateSince: '2026-09-01T00:00:00.000Z',
      verificationResult: { type: 'probe', verificationId: 'v', outcome: 'passed', probeResult: passedProbe, completedAt: '2026-03-01T00:00:00.000Z' },
    }));
    expect(stale.success).toBe(false);
    expect(stale.error).toMatch(/newer than the expiry/);

    const missing = SkillStateMachine.transition(base({
      currentState: 'expired',
      verificationResult: { type: 'probe', verificationId: 'v', outcome: 'passed', probeResult: passedProbe },
    }));
    expect(missing.success).toBe(false);
    expect(missing.error).toMatch(/requires currentStateSince/);
  });
});

describe('C1: Verified can be demoted, but only for a recognised reason', () => {
  it('consent withdrawal demotes verified → claimed', () => {
    const r = SkillStateMachine.transition(base({
      currentState: 'verified', targetState: 'claimed', acceptedEvidence: [],
      reasonCode: 'EVIDENCE_WITHDRAWN_CONSENT_REVOKED',
    }));
    expect(r.success).toBe(true);
    expect(r.newState).toBe('claimed');
    expect(r.proofLevel).toBeNull();
  });

  it('verified → evidence_linked keeps the skill only if accepted evidence remains', () => {
    const none = SkillStateMachine.transition(base({
      currentState: 'verified', targetState: 'evidence_linked', acceptedEvidence: [], reasonCode: 'ATTESTATION_RETRACTED',
    }));
    expect(none.success).toBe(false);

    const some = SkillStateMachine.transition(base({
      currentState: 'verified', targetState: 'evidence_linked', acceptedEvidence: [ev({ kind: 'certificate' })], reasonCode: 'ATTESTATION_RETRACTED',
    }));
    expect(some.success).toBe(true);
  });

  it('rejects a demotion with an arbitrary reason', () => {
    const r = SkillStateMachine.transition(base({
      currentState: 'verified', targetState: 'claimed', acceptedEvidence: [], reasonCode: 'I_FEEL_LIKE_IT',
    }));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Demoting a Verified skill requires/);
  });

  it('only the expiry job or an officer can expire a skill', () => {
    const byMentor = SkillStateMachine.transition(base({ currentState: 'verified', targetState: 'expired', actorType: 'mentor' }));
    expect(byMentor.success).toBe(false);
    const byCron = SkillStateMachine.transition(base({ currentState: 'verified', targetState: 'expired', actorType: 'expiry_cron' }));
    expect(byCron.success).toBe(true);
  });

  it('verified → verified upgrades the proof level with a new verification', () => {
    const r = SkillStateMachine.transition(base({
      currentState: 'verified',
      verificationResult: { type: 'probe', verificationId: 'v2', outcome: 'passed', probeResult: passedProbe },
    }));
    expect(r.success).toBe(true);
    expect(r.proofLevel).toBe('L3_defended');
  });
});

describe('C5: evidence-linked with mixed evidence', () => {
  it('links when at least one item is accepted and fresh, and says so clearly otherwise', () => {
    const none = SkillStateMachine.transition(base({
      currentState: 'claimed', targetState: 'evidence_linked',
      acceptedEvidence: [ev({ status: 'rejected' }), ev({ status: 'withdrawn' })],
    }));
    expect(none.success).toBe(false);
    expect(none.error).toMatch(/none of the supplied evidence items is accepted/);

    const mixed = SkillStateMachine.transition(base({
      currentState: 'claimed', targetState: 'evidence_linked',
      acceptedEvidence: [ev({ status: 'rejected' }), ev()],
    }));
    expect(mixed.success).toBe(true);
  });
});
