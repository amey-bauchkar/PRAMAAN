import {
  SkillState,
  SkillStateTransitionEvent,
  EvidenceItem,
  ProbeRunResult,
  Attestation,
  ProofLevel,
} from '@pramaan/contracts';

/**
 * How a verification was performed. Each type maps to exactly one Proof Level (PRAMAAN v2 §3.2).
 */
export type VerificationType =
  | 'code_backed'      // L1: substantial code in a consented repository
  | 'issuer_verified'  // L1: certificate confirmed with its issuer
  | 'assessment'       // L2: platform test score (mock machine test, aptitude, learning-task tests)
  | 'probe'            // L3: Live Mutation Probe on the student's own code
  | 'viva'             // L3: code-grounded viva, scored by rubric
  | 'attestation';     // L3: faculty mentor sign-off against a rubric

export const PROOF_LEVEL_BY_VERIFICATION: Record<VerificationType, ProofLevel> = {
  code_backed: 'L1_code_backed',
  issuer_verified: 'L1_code_backed',
  assessment: 'L2_assessed',
  probe: 'L3_defended',
  viva: 'L3_defended',
  attestation: 'L3_attested',
};

/** Evidence kinds that may back each verification type. */
const QUALIFYING_EVIDENCE_KINDS: Record<VerificationType, EvidenceItem['kind'][]> = {
  code_backed: ['code_span', 'commit'],
  issuer_verified: ['certificate', 'competition'],
  assessment: ['test_result'],
  probe: ['code_span'],
  viva: ['code_span', 'lab'],
  attestation: ['lab', 'competition', 'certificate', 'mentor_attestation', 'code_span'],
};

/** Minimum signal for an L1 Code-backed verification. Configurable per tenant later. */
export const L1_CODE_BACKED_POLICY = {
  minAnchoredFiles: 2,
  minAnchoredLines: 50,
  minCommitSpanDays: 14,
} as const;

export const DEFAULT_ASSESSMENT_PASS_RATIO = 0.6;
/** Mean rubric score (1–3 scale) a mentor attestation must reach. */
export const DEFAULT_ATTESTATION_PASS_MARK = 2;
export const DEFAULT_SKILL_HALF_LIFE_DAYS = 365;

/** Reason codes that may take a skill out of Verified (other than expiry). */
export const DEMOTION_REASON_CODES = [
  'CONSENT_WITHDRAWN',
  'EVIDENCE_WITHDRAWN',
  'EVIDENCE_WITHDRAWN_CONSENT_REVOKED',
  'ATTESTATION_RETRACTED',
  'DISPUTE_UPHELD',
  'VERIFICATION_REVOKED',
] as const;

export interface VerificationResultInput {
  type: VerificationType;
  verificationId: string;
  outcome?: 'passed' | 'failed' | 'inconclusive_review_required';
  /** ISO time the verification session completed. Required when re-verifying an Expired skill. */
  completedAt?: string;
  probeResult?: ProbeRunResult;
  attestation?: Attestation;
  /** Override for the attestation pass mark (mean rubric score). */
  rubricPassMark?: number;
  assessment?: { score: number; maxScore: number; passRatio?: number };
  codeBacked?: { anchoredFiles: number; anchoredLines: number; commitSpanDays: number };
  issuerVerification?: { verified: boolean; issuer: string };
}

export interface StateTransitionContext {
  studentSkillId: string;
  /** Owner of the skill. Required: every evidence item is checked against it. */
  studentId: string;
  skillId?: string;
  currentState: SkillState;
  /** When the skill entered its current state. Required when re-verifying from Expired. */
  currentStateSince?: string;
  targetState: SkillState;
  actorType: 'student' | 'mentor' | 'officer' | 'evaluator_service' | 'expiry_cron';
  actorId?: string | null;
  reasonCode: string;
  acceptedEvidence?: EvidenceItem[];
  verificationResult?: VerificationResultInput;
  /** Skill half-life used to compute the re-verify date. */
  halfLifeDays?: number;
  /** Clock override for deterministic evaluation and tests. */
  now?: string;
}

export interface StateTransitionResult {
  success: boolean;
  newState: SkillState;
  proofLevel?: ProofLevel | null;
  validUntil?: string | null;
  event?: Omit<SkillStateTransitionEvent, 'id'>;
  error?: string;
}

/**
 * Authoritative Skill State Transition Matrix (PS p1: Claimed, Observed, Evidence-linked, Verified, Expired).
 * v2 changes: Verified can be demoted (consent withdrawal, retracted attestation, upheld dispute) and
 * refreshed/upgraded (verified → verified with a new verification).
 */
const ALLOWED_TRANSITIONS: Record<SkillState, SkillState[]> = {
  claimed: ['observed', 'evidence_linked'],
  observed: ['evidence_linked', 'claimed'],
  evidence_linked: ['verified', 'claimed', 'observed'],
  verified: ['expired', 'verified', 'evidence_linked', 'claimed'],
  expired: ['evidence_linked', 'verified', 'claimed'],
};

function fail(currentState: SkillState, error: string): StateTransitionResult {
  return { success: false, newState: currentState, error };
}

function isFresh(e: EvidenceItem, nowMs: number): boolean {
  return !e.validUntil || Date.parse(e.validUntil) > nowMs;
}

export class SkillStateMachine {
  public static getAllowedTargets(from: SkillState): SkillState[] {
    return ALLOWED_TRANSITIONS[from] || [];
  }

  public static canTransition(from: SkillState, to: SkillState): boolean {
    const allowed = ALLOWED_TRANSITIONS[from];
    return allowed ? allowed.includes(to) : false;
  }

  /**
   * Applies a state transition and validates every evidence and verification invariant.
   * INVARIANT: a skill can never become 'verified' without fresh, accepted, owned evidence of a qualifying
   * kind AND a passed verification of a known type. The proof level is derived, never supplied by the caller.
   */
  public static transition(context: StateTransitionContext): StateTransitionResult {
    const { currentState, targetState, actorType, actorId, reasonCode, verificationResult } = context;
    const evidence = context.acceptedEvidence ?? [];
    const nowMs = context.now ? Date.parse(context.now) : Date.now();
    const nowIso = new Date(nowMs).toISOString();

    if (!context.studentId) {
      return fail(currentState, 'studentId is required for every skill state transition.');
    }

    if (!this.canTransition(currentState, targetState)) {
      return fail(currentState, `Illegal state transition from '${currentState}' to '${targetState}'.`);
    }

    // Ownership applies to every item the caller supplies, accepted or not.
    const foreign = evidence.find(e => e.studentId !== context.studentId);
    if (foreign) {
      const phrase = targetState === 'verified' ? 'a different student' : 'another student';
      return fail(
        currentState,
        `Evidence ownership violation: Cannot ${targetState === 'verified' ? 'verify using' : 'link'} evidence belonging to ${phrase} (${foreign.studentId}).`
      );
    }

    const accepted = evidence.filter(e => e.status === 'accepted');
    const usable = accepted.filter(e => isFresh(e, nowMs));

    // Leaving Verified for anything other than expiry or refresh is a demotion and needs a recognised reason.
    if (currentState === 'verified' && (targetState === 'evidence_linked' || targetState === 'claimed')) {
      if (!(DEMOTION_REASON_CODES as readonly string[]).includes(reasonCode)) {
        return fail(
          currentState,
          `Demoting a Verified skill requires one of: ${DEMOTION_REASON_CODES.join(', ')}. Got '${reasonCode}'.`
        );
      }
    }

    if (targetState === 'evidence_linked') {
      if (evidence.length === 0) {
        return fail(currentState, `Cannot transition to 'evidence_linked' without at least one accepted evidence item.`);
      }
      if (accepted.length === 0) {
        return fail(currentState, `Cannot transition to 'evidence_linked': none of the supplied evidence items is accepted.`);
      }
      if (usable.length === 0) {
        return fail(currentState, `Cannot transition to 'evidence_linked': all accepted evidence has expired.`);
      }
    }

    if (targetState === 'expired' && actorType !== 'expiry_cron' && actorType !== 'officer') {
      return fail(currentState, `Only the expiry job or an officer can mark a skill as expired.`);
    }

    let proofLevel: ProofLevel | null = null;
    let validUntil: string | null = null;

    if (targetState === 'verified') {
      const checked = this.checkVerification(context, accepted, usable, nowMs);
      if ('error' in checked) return fail(currentState, checked.error);
      proofLevel = checked.proofLevel;
      validUntil = checked.validUntil;
    }

    return {
      success: true,
      newState: targetState,
      proofLevel,
      validUntil,
      event: {
        studentSkillId: context.studentSkillId,
        fromState: currentState,
        toState: targetState,
        reasonCode,
        actorType,
        actorId: actorId ?? null,
        verificationId: verificationResult?.verificationId ?? null,
        proofLevel,
        validUntil,
        occurredAt: nowIso,
      },
    };
  }

  private static checkVerification(
    context: StateTransitionContext,
    accepted: EvidenceItem[],
    usable: EvidenceItem[],
    nowMs: number
  ): { proofLevel: ProofLevel; validUntil: string } | { error: string } {
    const { currentState, verificationResult: v } = context;

    if (context.acceptedEvidence === undefined || context.acceptedEvidence.length === 0) {
      return { error: `Cannot transition to 'verified' without at least one accepted evidence item linked to this skill.` };
    }
    if (accepted.length === 0) {
      return { error: `Cannot transition to 'verified' using withdrawn or non-accepted evidence.` };
    }
    if (usable.length === 0) {
      return { error: `Cannot transition to 'verified': all accepted evidence has passed its validity date.` };
    }
    if (!v || !v.verificationId) {
      return { error: `Cannot transition to 'verified' without an attached qualifying verification record.` };
    }
    if (!(v.type in PROOF_LEVEL_BY_VERIFICATION)) {
      return { error: `Unknown verification type '${String(v.type)}'.` };
    }
    if (v.outcome && v.outcome !== 'passed') {
      return { error: `Verification session outcome is '${v.outcome}'. Expected 'passed'.` };
    }

    // The verification must be backed by evidence of a kind that fits it.
    const kinds = QUALIFYING_EVIDENCE_KINDS[v.type];
    const qualifying = usable.filter(e => kinds.includes(e.kind));
    if (qualifying.length === 0) {
      return { error: `Verification type '${v.type}' requires fresh accepted evidence of kind: ${kinds.join(', ')}.` };
    }

    const typeError = this.checkTypeSpecific(v, qualifying, nowMs);
    if (typeError) return { error: typeError };

    if (v.outcome !== 'passed') {
      return { error: `Verification outcome must be explicitly 'passed' to award Verified.` };
    }

    // Re-verifying an expired skill needs a verification newer than the expiry itself (no stale reuse).
    if (currentState === 'expired') {
      if (!context.currentStateSince || !v.completedAt) {
        return { error: `Re-verifying an expired skill requires currentStateSince and the verification's completedAt.` };
      }
      if (Date.parse(v.completedAt) <= Date.parse(context.currentStateSince)) {
        return { error: `Re-verification must be newer than the expiry; stale verifications cannot be reused.` };
      }
    }

    const halfLifeMs = (context.halfLifeDays ?? DEFAULT_SKILL_HALF_LIFE_DAYS) * 86_400_000;
    const caps = [nowMs + halfLifeMs];
    for (const e of qualifying) if (e.validUntil) caps.push(Date.parse(e.validUntil));
    if (v.type === 'attestation' && v.attestation) caps.push(Date.parse(v.attestation.validUntil));

    return {
      proofLevel: PROOF_LEVEL_BY_VERIFICATION[v.type],
      validUntil: new Date(Math.min(...caps)).toISOString(),
    };
  }

  private static checkTypeSpecific(v: VerificationResultInput, qualifying: EvidenceItem[], nowMs: number): string | null {
    switch (v.type) {
      case 'probe':
        if (!v.probeResult || !v.probeResult.passed) return `Probe test did not pass. Cannot award Verified status.`;
        return null;

      case 'viva':
        return null; // Rubric-scored session; outcome 'passed' is set by the reviewer, checked by the caller.

      case 'assessment': {
        const a = v.assessment;
        if (!a || a.maxScore <= 0) return `Assessment verification requires a score and a positive maxScore.`;
        const ratio = a.passRatio ?? DEFAULT_ASSESSMENT_PASS_RATIO;
        if (a.score / a.maxScore < ratio) {
          return `Assessment score ${a.score}/${a.maxScore} is below the pass ratio ${ratio}.`;
        }
        return null;
      }

      case 'code_backed': {
        const c = v.codeBacked;
        const p = L1_CODE_BACKED_POLICY;
        if (!c) return `Code-backed verification requires anchored file, line and commit-span counts.`;
        if (c.anchoredFiles < p.minAnchoredFiles || c.anchoredLines < p.minAnchoredLines || c.commitSpanDays < p.minCommitSpanDays) {
          return `Code-backed proof needs ≥${p.minAnchoredFiles} files, ≥${p.minAnchoredLines} anchored lines and ≥${p.minCommitSpanDays} days of commit history.`;
        }
        return null;
      }

      case 'issuer_verified':
        if (!v.issuerVerification?.verified) return `Certificate has not been confirmed with its issuer.`;
        return null;

      case 'attestation': {
        const att = v.attestation;
        if (!att || !att.mentorMembershipId) return `Mentor attestation record is invalid or unassigned.`;
        if (Date.parse(att.validUntil) <= nowMs) return `Mentor attestation has expired.`;
        if (!qualifying.some(e => e.id === att.evidenceId)) {
          return `Mentor attestation must reference one of the accepted evidence items for this skill.`;
        }
        const scores = Object.values(att.rubricScores ?? {});
        if (scores.length === 0) return `Mentor attestation has no rubric scores.`;
        const mean = scores.reduce((s, x) => s + x, 0) / scores.length;
        const mark = v.rubricPassMark ?? DEFAULT_ATTESTATION_PASS_MARK;
        if (mean < mark) return `Mentor rubric mean ${mean.toFixed(2)} is below the pass mark ${mark}.`;
        return null;
      }
    }
  }
}
