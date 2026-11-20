import {
  EligibilityRuleVersion,
  EligibilityRuleSpecSchema,
  MinProof,
  ProofLevel,
  StudentAcademicSnapshot,
} from '@pramaan/contracts';
import { EligibilityEvaluator } from './eligibility-evaluator.js';

/**
 * Proof Path (PRAMAAN v2 §3.3 #3): counterfactual eligibility.
 * Re-runs the same versioned rules on "what-if" profiles to find the single proof that unlocks the most
 * drives for a student, and the interventions that unlock the most eligibilities for a cohort.
 * Deterministic: no model, no hidden score.
 */
export interface DriveRuleContext {
  driveId: string;
  title?: string;
  ruleVersion: EligibilityRuleVersion;
  startsAt?: string;
}

export interface ProofAction {
  skillId: string;
  name: string;
  /** Highest level / proof any blocked drive needs for this skill. */
  targetLevel: number;
  targetProof: MinProof;
  unlocksDriveIds: string[];
  unlocksCount: number;
}

export interface DriveBlockers {
  driveId: string;
  title?: string;
  status: 'eligible' | 'ineligible' | 'needs_review';
  /** Messages for failed checks the student can fix with new proof. */
  proofBlockers: string[];
  /** Messages for failed or unresolved checks proof cannot fix (marks, branch, policy, hold). */
  otherBlockers: string[];
}

export interface StudentProofPath {
  eligibleDriveIds: string[];
  totalDrives: number;
  actions: ProofAction[];
  drives: DriveBlockers[];
}

export interface InterventionRanking {
  skillId: string;
  name: string;
  targetLevel: number;
  targetProof: MinProof;
  studentsAffected: number;
  eligibilitiesGained: number;
}

const PROOF_FOR_MIN: Record<MinProof, ProofLevel> = { L1: 'L1_code_backed', L2: 'L2_assessed', L3: 'L3_defended' };
const FAR_FUTURE = '2999-01-01T00:00:00.000Z';
const proofRank = (p: MinProof) => Number(p.slice(1));

function withSkill(snapshot: StudentAcademicSnapshot, skillId: string, name: string, level: number, proof: MinProof): StudentAcademicSnapshot {
  const skills = (snapshot.skills ?? []).filter(s => s.skillId !== skillId);
  skills.push({ skillId, name, state: 'verified', level, proofLevel: PROOF_FOR_MIN[proof], validUntil: FAR_FUTURE });
  return { ...snapshot, skills };
}

function evalAll(snapshot: StudentAcademicSnapshot, drives: DriveRuleContext[], now: string) {
  return drives.map(d => ({
    drive: d,
    result: EligibilityEvaluator.evaluate(snapshot, d.ruleVersion, { driveStartsAt: d.startsAt, now }),
  }));
}

/** Collects, per skill, the strongest requirement among drives where that skill is a failing check. */
function candidateTargets(evals: ReturnType<typeof evalAll>) {
  const targets = new Map<string, { name: string; level: number; proof: MinProof }>();
  for (const { drive, result } of evals) {
    if (result.status === 'eligible') continue;
    const rules = EligibilityRuleSpecSchema.parse(drive.ruleVersion.rules);
    for (const c of result.checks) {
      if (c.passed !== false || !c.actionableByProof) continue;
      const req = rules.skills.find(s => `skills.${s.skillId}` === c.id);
      if (!req) continue;
      const cur = targets.get(req.skillId);
      targets.set(req.skillId, {
        name: req.name,
        level: Math.max(cur?.level ?? 1, req.minLevel),
        proof: !cur || proofRank(req.minProof) > proofRank(cur.proof) ? req.minProof : cur.proof,
      });
    }
  }
  return targets;
}

/** Whether a proof can realistically be earned before a given drive closes. */
export type RecourseHorizon = 'in_time' | 'tight' | 'next_drives';

export interface DriveTiming {
  driveId: string;
  title?: string;
  daysLeft: number;
  horizon: RecourseHorizon;
}

export interface ActionTiming {
  skillId: string;
  /** Study effort from the learning tasks for this skill up to the target proof. */
  estHours: number;
  /** Calendar days needed at the student's pace, plus time for a mentor to schedule a defence (L3). */
  daysNeeded: number;
  hoursPerDay: number;
  /** Unlocked drives the proof can be earned in time for (in_time or tight). */
  inTimeCount: number;
  drives: DriveTiming[];
  /** One plain-language line for the student. */
  summary: string;
}

/** Days a mentor needs to schedule and hold a defence. A stated planning assumption, not a measured figure. */
export const DEFENCE_SCHEDULING_DAYS = 2;

/**
 * Deadline-aware recourse: for each Proof Path action, compares the effort to earn the proof with the time
 * left before each drive it unlocks. A drive is "in_time" if the work fits in 70% of the days left, "tight"
 * if it fits at all, otherwise the proof only helps with later drives. Pace is study hours per day.
 */
export function recourseTiming(
  actions: ProofAction[],
  drives: DriveRuleContext[],
  effort: { skillId: string; targetProof: MinProof; estHours: number }[],
  options: { now?: string; hoursPerDay?: number } = {},
): ActionTiming[] {
  const now = Date.parse(options.now ?? new Date().toISOString());
  const pace = options.hoursPerDay ?? 2;
  return actions.map(a => {
    const tasks = effort.filter(t => t.skillId === a.skillId && proofRank(t.targetProof) <= proofRank(a.targetProof));
    const estHours = tasks.length ? tasks.reduce((s, t) => s + t.estHours, 0) : 4;
    const daysNeeded = Math.ceil(estHours / pace) + (a.targetProof === 'L3' ? DEFENCE_SCHEDULING_DAYS : 0);
    const timed = a.unlocksDriveIds.map(id => {
      const d = drives.find(x => x.driveId === id);
      const daysLeft = d?.startsAt ? Math.max(0, Math.floor((Date.parse(d.startsAt) - now) / 86_400_000)) : 365;
      const horizon: RecourseHorizon = daysNeeded <= daysLeft * 0.7 ? 'in_time' : daysNeeded <= daysLeft ? 'tight' : 'next_drives';
      return { driveId: id, title: d?.title, daysLeft, horizon };
    });
    const inTime = timed.filter(t => t.horizon !== 'next_drives').length;
    const days = `${daysNeeded} day${daysNeeded === 1 ? '' : 's'}`;
    const summary = timed.length === 0 ? `About ${estHours} hours of work.`
      : inTime === timed.length ? `About ${estHours} hours (${days} at ${pace} h/day): you can finish before ${timed.length === 1 ? 'this drive' : 'all of these drives'}.`
      : inTime === 0 ? `About ${estHours} hours (${days}): too late for ${timed.length === 1 ? 'this drive' : 'these drives'}, but it counts for every later drive that needs it.`
      : `About ${estHours} hours (${days}): in time for ${inTime} of ${timed.length} drives.`;
    return { skillId: a.skillId, estHours, daysNeeded, hoursPerDay: pace, inTimeCount: inTime, drives: timed, summary };
  });
}

export class ProofPath {
  /** The student's next best proofs, ranked by how many currently-blocked drives each one unlocks on its own. */
  public static forStudent(snapshot: StudentAcademicSnapshot, drives: DriveRuleContext[], options: { now?: string } = {}): StudentProofPath {
    const now = options.now ?? new Date().toISOString();
    const base = evalAll(snapshot, drives, now);
    const blocked = new Set(base.filter(e => e.result.status !== 'eligible').map(e => e.drive.driveId));

    const actions: ProofAction[] = [];
    for (const [skillId, t] of candidateTargets(base)) {
      const after = evalAll(withSkill(snapshot, skillId, t.name, t.level, t.proof), drives, now);
      const unlocks = after.filter(e => blocked.has(e.drive.driveId) && e.result.status === 'eligible').map(e => e.drive.driveId);
      actions.push({ skillId, name: t.name, targetLevel: t.level, targetProof: t.proof, unlocksDriveIds: unlocks, unlocksCount: unlocks.length });
    }
    actions.sort((x, y) => y.unlocksCount - x.unlocksCount || x.name.localeCompare(y.name));

    return {
      eligibleDriveIds: base.filter(e => e.result.status === 'eligible').map(e => e.drive.driveId),
      totalDrives: drives.length,
      actions,
      drives: base.map(({ drive, result }) => ({
        driveId: drive.driveId,
        title: drive.title,
        status: result.status,
        proofBlockers: result.checks.filter(c => c.passed === false && c.actionableByProof).map(c => c.message),
        otherBlockers: result.checks.filter(c => c.passed !== true && !c.actionableByProof).map(c => c.message),
      })),
    };
  }

  /**
   * Cohort view for officers: for each skill, how many drive eligibilities the cohort would gain if every
   * student blocked by that skill reached the required proof. Ranks interventions (workshops, labs).
   */
  public static rankInterventions(snapshots: StudentAcademicSnapshot[], drives: DriveRuleContext[], options: { now?: string } = {}): InterventionRanking[] {
    const now = options.now ?? new Date().toISOString();
    const bySkill = new Map<string, InterventionRanking>();

    for (const snapshot of snapshots) {
      const base = evalAll(snapshot, drives, now);
      const blocked = new Set(base.filter(e => e.result.status !== 'eligible').map(e => e.drive.driveId));
      for (const [skillId, t] of candidateTargets(base)) {
        // Only a blocked drive that asks for this skill can change, so only those are re-checked.
        const after = evalAll(withSkill(snapshot, skillId, t.name, t.level, t.proof), drives.filter(d => blocked.has(d.driveId) && d.ruleVersion.rules.skills.some(s => s.skillId === skillId)), now);
        const gained = after.filter(e => e.result.status === 'eligible').length;
        const cur = bySkill.get(skillId) ?? { skillId, name: t.name, targetLevel: t.level, targetProof: t.proof, studentsAffected: 0, eligibilitiesGained: 0 };
        cur.studentsAffected += 1;
        cur.eligibilitiesGained += gained;
        cur.targetLevel = Math.max(cur.targetLevel, t.level);
        if (proofRank(t.proof) > proofRank(cur.targetProof)) cur.targetProof = t.proof;
        bySkill.set(skillId, cur);
      }
    }
    return [...bySkill.values()].sort((x, y) => y.eligibilitiesGained - x.eligibilitiesGained || y.studentsAffected - x.studentsAffected);
  }
}
