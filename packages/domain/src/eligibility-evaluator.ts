import { createHash } from 'crypto';
import {
  EligibilityRuleVersion,
  EligibilityRuleSpec,
  EligibilityRuleSpecSchema,
  StudentAcademicSnapshot,
  EligibilityEvaluationResult,
  EligibilityCheck,
  EligibilityStatus,
  ReasonCode,
  meetsMinProof,
} from '@pramaan/contracts';

export interface EvaluationOptions {
  /** Skills must still be valid on this date. Defaults to `now`. */
  driveStartsAt?: string;
  /** Clock override for deterministic results. */
  now?: string;
}

/** Deterministic JSON: object keys sorted, so the same input always hashes the same. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().filter(k => obj[k] !== undefined).map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

const fmtInr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

export class EligibilityEvaluator {
  /** SHA-256 over the full input snapshot, the rule version id and the rule content. */
  public static computeInputHash(snapshot: StudentAcademicSnapshot, ruleVersionId: string, rules?: EligibilityRuleSpec): string {
    const canonical = {
      ...snapshot,
      skills: [...(snapshot.skills ?? [])].sort((a, b) => a.skillId.localeCompare(b.skillId)),
      ruleVersionId,
      rules: rules ?? null,
    };
    return createHash('sha256').update(stableStringify(canonical), 'utf8').digest('hex');
  }

  /**
   * Pure, deterministic evaluation of one student against one immutable rule version.
   * Result is three-valued: a failed rule → ineligible; otherwise any unknown → needs_review; else eligible.
   */
  public static evaluate(
    snapshot: StudentAcademicSnapshot,
    ruleVersion: EligibilityRuleVersion,
    options: EvaluationOptions = {}
  ): EligibilityEvaluationResult {
    const rules = EligibilityRuleSpecSchema.parse(ruleVersion.rules);
    const nowIso = options.now ?? new Date().toISOString();
    const checkDate = Date.parse(options.driveStartsAt ?? nowIso);
    const checks: EligibilityCheck[] = [];
    const missingSkills: string[] = [];

    type Vars = Record<string, string | number>;
    const add = (id: string, passed: boolean | null, reasonCode: ReasonCode | null, message: string, actionableByProof = false, key?: string, vars: Vars = {}) =>
      checks.push({ id, passed, reasonCode: passed === true ? null : reasonCode, message, actionableByProof, ...(key ? { t: { key, vars } } : {}) });

    // Academics
    const a = rules.academics;
    if (a.minCgpa !== undefined) {
      if (snapshot.cgpa === null) add('academics.minCgpa', null, 'MISSING_DATA', `CGPA is not on record, so an officer must review (required ${a.minCgpa}).`, false, 'cgpa.missing', { req: a.minCgpa });
      else {
        const ok = snapshot.cgpa >= a.minCgpa;
        add('academics.minCgpa', ok, 'INSUFFICIENT_CGPA',
          ok ? `CGPA ${snapshot.cgpa} meets the minimum ${a.minCgpa}.` : `CGPA ${snapshot.cgpa} is below the minimum ${a.minCgpa}.`, false, ok ? 'cgpa.pass' : 'cgpa.fail', { v: snapshot.cgpa, req: a.minCgpa });
      }
    }
    if (a.minTenthPct !== undefined) {
      const v = snapshot.tenthPct;
      if (v === null) add('academics.minTenthPct', null, 'MISSING_DATA', `10th marks are not on record, so an officer must review.`, false, 'tenth.missing');
      else {
        const ok = v >= a.minTenthPct;
        add('academics.minTenthPct', ok, 'INSUFFICIENT_TENTH_PCT',
          ok ? `10th marks ${v}% meet the minimum ${a.minTenthPct}%.` : `10th marks ${v}% are below the minimum ${a.minTenthPct}%.`, false, ok ? 'tenth.pass' : 'tenth.fail', { v, req: a.minTenthPct });
      }
    }
    if (a.minTwelfthOrDiplomaPct !== undefined) {
      const options12 = [snapshot.twelfthPct, snapshot.diplomaPct].filter((x): x is number => x !== null);
      if (options12.length === 0) add('academics.minTwelfthOrDiplomaPct', null, 'MISSING_DATA', `12th / diploma marks are not on record, so an officer must review.`, false, 'twelfth.missing');
      else {
        const best = Math.max(...options12);
        const ok = best >= a.minTwelfthOrDiplomaPct;
        add('academics.minTwelfthOrDiplomaPct', ok, 'INSUFFICIENT_TWELFTH_OR_DIPLOMA_PCT',
          ok ? `12th / diploma marks ${best}% meet the minimum ${a.minTwelfthOrDiplomaPct}%.` : `12th / diploma marks ${best}% are below the minimum ${a.minTwelfthOrDiplomaPct}%.`, false, ok ? 'twelfth.pass' : 'twelfth.fail', { v: best, req: a.minTwelfthOrDiplomaPct });
      }
    }
    if (a.maxGapYears !== undefined) {
      const g = snapshot.gapYears;
      if (g === null) add('academics.maxGapYears', null, 'MISSING_DATA', `Education gap is not on record, so an officer must review.`, false, 'gap.missing');
      else {
        const ok = g <= a.maxGapYears;
        add('academics.maxGapYears', ok, 'EXCESSIVE_GAP_YEARS',
          ok ? `Education gap of ${g} year(s) is within the limit of ${a.maxGapYears}.` : `Education gap of ${g} year(s) exceeds the limit of ${a.maxGapYears}.`, false, ok ? 'gap.pass' : 'gap.fail', { v: g, req: a.maxGapYears });
      }
    }

    // Backlogs
    const b = rules.backlogs;
    if (b.maxActive !== undefined) {
      const v = snapshot.activeBacklogs;
      if (v === null) add('backlogs.maxActive', null, 'MISSING_DATA', `Active backlogs are not on record, so an officer must review.`, false, 'active.missing');
      else {
        const ok = v <= b.maxActive;
        add('backlogs.maxActive', ok, 'EXCESSIVE_BACKLOGS',
          ok ? `${v} active backlog(s), within the limit of ${b.maxActive}.` : `${v} active backlog(s); the limit is ${b.maxActive}.`, false, ok ? 'active.pass' : 'active.fail', { v, req: b.maxActive });
      }
    }
    if (b.maxHistory !== undefined) {
      const v = snapshot.backlogHistory;
      if (v === null) add('backlogs.maxHistory', null, 'MISSING_DATA', `Backlog history is not on record, so an officer must review.`, false, 'history.missing');
      else {
        const ok = v <= b.maxHistory;
        add('backlogs.maxHistory', ok, 'EXCESSIVE_BACKLOG_HISTORY',
          ok ? `${v} past backlog(s), within the limit of ${b.maxHistory}.` : `${v} past backlog(s); the limit is ${b.maxHistory}.`, false, ok ? 'history.pass' : 'history.fail', { v, req: b.maxHistory });
      }
    }

    // Branch and year
    if (rules.branches.length > 0) {
      const ok = rules.branches.some(x => x.trim().toLowerCase() === snapshot.branch.trim().toLowerCase());
      add('branch', ok, 'BRANCH_INELIGIBLE', ok ? `Branch ${snapshot.branch} is eligible.` : `Branch ${snapshot.branch} is not in the eligible list (${rules.branches.join(', ')}).`,
        false, ok ? 'branch.pass' : 'branch.fail', { v: snapshot.branch, list: rules.branches.join(', ') });
    }
    if (rules.graduatingYears.length > 0) {
      const ok = rules.graduatingYears.includes(snapshot.graduatingYear);
      add('graduatingYear', ok, 'GRADUATION_YEAR_MISMATCH', ok ? `Graduating year ${snapshot.graduatingYear} is eligible.` : `Graduating year ${snapshot.graduatingYear} is not in ${rules.graduatingYears.join(', ')}.`,
        false, ok ? 'year.pass' : 'year.fail', { v: snapshot.graduatingYear, list: rules.graduatingYears.join(', ') });
    }

    // Skills: matched by id, with level, proof level and validity at the drive date.
    for (const req of rules.skills) {
      const id = `skills.${req.skillId}`;
      const s = (snapshot.skills ?? []).find(x => x.skillId === req.skillId);
      const want = `${req.name} (level ${req.minLevel}, proof ≥ ${req.minProof})`;
      const sv = { skill: req.name, level: req.minLevel, proof: req.minProof };
      if (!s || s.state !== 'verified') {
        missingSkills.push(req.name);
        add(id, false, 'MISSING_REQUIRED_VERIFIED_SKILLS', `${want} is required; it is ${s ? s.state.replace('_', '-') : 'not on your profile'}.`, true, 'skill.missing', { ...sv, state: s ? s.state : 'none' });
      } else if ((s.level ?? 1) < req.minLevel) {
        missingSkills.push(req.name);
        add(id, false, 'SKILL_LEVEL_TOO_LOW', `${req.name} is Verified at level ${s.level ?? 1}; this drive needs level ${req.minLevel}.`, true, 'skill.level', { ...sv, have: s.level ?? 1 });
      } else if (!meetsMinProof(s.proofLevel, req.minProof)) {
        missingSkills.push(req.name);
        add(id, false, 'SKILL_PROOF_LEVEL_TOO_LOW', `${req.name} is Verified at ${s.proofLevel ?? 'an unknown level'}; this drive needs proof ≥ ${req.minProof}.`, true, 'skill.proof', { ...sv, have: s.proofLevel ?? '?' });
      } else if (s.validUntil && Date.parse(s.validUntil) < checkDate) {
        missingSkills.push(req.name);
        add(id, false, 'SKILL_EXPIRES_BEFORE_DRIVE', `${req.name} proof expires on ${s.validUntil.slice(0, 10)}, before the drive. Re-verify to stay eligible.`, true, 'skill.expires', { ...sv, date: s.validUntil.slice(0, 10) });
      } else {
        add(id, true, null, `${req.name} is Verified (${s.proofLevel}) and meets the requirement.`, false, 'skill.pass', { ...sv, have: s.proofLevel ?? '' });
      }
    }

    // Placement policy limits
    const p = rules.policy;
    if (p.maxOffersHeld !== undefined) {
      const ok = snapshot.offersHeld <= p.maxOffersHeld;
      add('policy.maxOffersHeld', ok, 'OFFER_LIMIT_REACHED', ok ? `Offer policy allows you to apply.` : `You already hold ${snapshot.offersHeld} offer(s); policy allows ${p.maxOffersHeld}.`,
        false, ok ? 'offers.pass' : 'offers.fail', { v: snapshot.offersHeld, req: p.maxOffersHeld });
    }
    if (p.blockIfPlacedAtOrAboveCtcInr !== undefined && snapshot.highestOfferCtcInr !== null) {
      const ok = snapshot.highestOfferCtcInr < p.blockIfPlacedAtOrAboveCtcInr;
      add('policy.placedCtc', ok, 'ALREADY_PLACED_AT_OR_ABOVE_CTC',
        ok ? `Your current offer is below the ${fmtInr(p.blockIfPlacedAtOrAboveCtcInr)} threshold, so you may apply.` : `You are placed at ${fmtInr(snapshot.highestOfferCtcInr)}; this drive is open only below ${fmtInr(p.blockIfPlacedAtOrAboveCtcInr)}.`,
        false, ok ? 'ctc.pass' : 'ctc.fail', { v: fmtInr(snapshot.highestOfferCtcInr), req: fmtInr(p.blockIfPlacedAtOrAboveCtcInr) });
    }

    if (snapshot.disciplinaryHold) {
      add('hold.disciplinary', null, 'DISCIPLINARY_HOLD', `A hold is on record; an officer must review before you can apply.`, false, 'hold');
    }

    const status: EligibilityStatus = checks.some(c => c.passed === false)
      ? 'ineligible'
      : checks.some(c => c.passed === null) ? 'needs_review' : 'eligible';

    const reasonCodes = status === 'eligible'
      ? (['CRITERIA_MET'] as ReasonCode[])
      : [...new Set(checks.filter(c => c.passed !== true && c.reasonCode).map(c => c.reasonCode as ReasonCode))];

    return {
      eligible: status === 'eligible',
      status,
      reasonCodes,
      checks,
      missingSkills,
      ruleVersionId: ruleVersion.id,
      evaluatedAt: nowIso,
      inputHash: this.computeInputHash(snapshot, ruleVersion.id, rules),
    };
  }

  /** Plain-language explanation lines, failures first. */
  public static explain(result: EligibilityEvaluationResult): string[] {
    const order = (c: EligibilityCheck) => (c.passed === false ? 0 : c.passed === null ? 1 : 2);
    return [...result.checks].sort((x, y) => order(x) - order(y)).map(c =>
      `${c.passed === true ? 'Pass' : c.passed === false ? 'Fail' : 'Review'}: ${c.message}`);
  }
}
