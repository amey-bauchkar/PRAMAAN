import {
  SkillState,
  SkillStateTransitionEvent,
  EvidenceItem,
  ProbeRunResult,
  Attestation
} from '@pramaan/contracts';

export interface StateTransitionContext {
  studentSkillId: string;
  currentState: SkillState;
  targetState: SkillState;
  actorType: 'student' | 'mentor' | 'officer' | 'evaluator_service' | 'expiry_cron';
  actorId?: string | null;
  reasonCode: string;
  acceptedEvidence?: EvidenceItem[];
  verificationResult?: {
    type: 'probe' | 'attestation';
    probeResult?: ProbeRunResult;
    attestation?: Attestation;
    verificationId: string;
  };
}

export interface StateTransitionResult {
  success: boolean;
  newState: SkillState;
  event?: Omit<SkillStateTransitionEvent, 'id'>;
  error?: string;
}

/**
 * Authoritative Skill State Transition Matrix (Pre-Implementation Package §9.1 Deliverable F)
 * 5 States: Claimed, Observed, Evidence-linked, Verified, Expired
 */
const ALLOWED_TRANSITIONS: Record<SkillState, SkillState[]> = {
  claimed: ['observed', 'evidence_linked'],
  observed: ['evidence_linked', 'claimed'],
  evidence_linked: ['verified', 'claimed', 'observed'],
  verified: ['expired'],
  expired: ['evidence_linked', 'verified', 'claimed']
};

export class SkillStateMachine {
  /**
   * Returns list of valid target states from the current state.
   */
  public static getAllowedTargets(from: SkillState): SkillState[] {
    return ALLOWED_TRANSITIONS[from] || [];
  }

  /**
   * Evaluates whether a requested transition is valid according to domain invariants.
   */
  public static canTransition(from: SkillState, to: SkillState): boolean {
    const allowed = ALLOWED_TRANSITIONS[from];
    return allowed ? allowed.includes(to) : false;
  }

  /**
   * Applies the state transition and strictly validates all required evidence and verification invariants.
   * INVARIANT: Under NO circumstances can a skill become 'verified' without accepted evidence AND a qualifying verification record.
   */
  public static transition(context: StateTransitionContext): StateTransitionResult {
    const { currentState, targetState, actorType, actorId, reasonCode, acceptedEvidence, verificationResult } = context;

    // 1. Structural transition check
    if (!this.canTransition(currentState, targetState)) {
      return {
        success: false,
        newState: currentState,
        error: `Illegal state transition from '${currentState}' to '${targetState}'.`
      };
    }

    // 2. Invariant: Moving to 'evidence_linked' requires at least one accepted evidence item
    if (targetState === 'evidence_linked') {
      if (!acceptedEvidence || acceptedEvidence.length === 0) {
        return {
          success: false,
          newState: currentState,
          error: `Cannot transition to 'evidence_linked' without at least one accepted evidence item.`
        };
      }
      const hasAccepted = acceptedEvidence.some(e => e.status === 'accepted');
      if (!hasAccepted) {
        return {
          success: false,
          newState: currentState,
          error: `All attached evidence items must have status 'accepted'.`
        };
      }
    }

    // 3. Invariant: Moving to 'verified' STRICTLY requires accepted evidence AND qualifying verification
    if (targetState === 'verified') {
      // Must come from evidence_linked (or re-verification from expired)
      if (currentState !== 'evidence_linked' && currentState !== 'expired') {
        return {
          success: false,
          newState: currentState,
          error: `Cannot transition to 'verified' from '${currentState}'. Must be 'evidence_linked' or 'expired'.`
        };
      }

      // Check evidence requirement
      if (!acceptedEvidence || acceptedEvidence.length === 0 || !acceptedEvidence.some(e => e.status === 'accepted')) {
        return {
          success: false,
          newState: currentState,
          error: `Cannot transition to 'verified' without at least one accepted evidence item linked to this skill.`
        };
      }

      // Check verification record requirement
      if (!verificationResult || !verificationResult.verificationId) {
        return {
          success: false,
          newState: currentState,
          error: `Cannot transition to 'verified' without an attached qualifying verification record.`
        };
      }

      // Check probe outcome
      if (verificationResult.type === 'probe') {
        if (!verificationResult.probeResult || !verificationResult.probeResult.passed) {
          return {
            success: false,
            newState: currentState,
            error: `Probe test did not pass. Cannot award Verified status.`
          };
        }
      }

      // Check attestation outcome
      if (verificationResult.type === 'attestation') {
        if (!verificationResult.attestation || !verificationResult.attestation.mentorMembershipId) {
          return {
            success: false,
            newState: currentState,
            error: `Mentor attestation record is invalid or unassigned.`
          };
        }
      }
    }

    // 4. Invariant: Expiry transitions should be executed by system/cron or officer
    if (targetState === 'expired' && actorType === 'student') {
      return {
        success: false,
        newState: currentState,
        error: `Students cannot manually mark their skills as expired.`
      };
    }

    // Success: construct event
    return {
      success: true,
      newState: targetState,
      event: {
        studentSkillId: context.studentSkillId,
        fromState: currentState,
        toState: targetState,
        reasonCode,
        actorType,
        actorId: actorId ?? null,
        verificationId: verificationResult?.verificationId ?? null,
        occurredAt: new Date().toISOString()
      }
    };
  }
}
