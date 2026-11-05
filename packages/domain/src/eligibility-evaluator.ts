import { createHash } from 'crypto';
import {
  EligibilityRuleVersion,
  StudentAcademicSnapshot,
  EligibilityEvaluationResult,
  ReasonCode
} from '@pramaan/contracts';

export class EligibilityEvaluator {
  /**
   * Generates a deterministic SHA-256 fingerprint of the input snapshot and rule specification.
   */
  public static computeInputHash(snapshot: StudentAcademicSnapshot, ruleVersionId: string): string {
    const payload = JSON.stringify({
      studentId: snapshot.studentId,
      cgpa: snapshot.cgpa,
      activeBacklogs: snapshot.activeBacklogs,
      branch: snapshot.branch,
      graduatingYear: snapshot.graduatingYear,
      verifiedSkills: [...snapshot.verifiedSkillNames].sort(),
      ruleVersionId
    });
    return createHash('sha256').update(payload, 'utf8').digest('hex');
  }

  /**
   * Pure evaluation function computing student eligibility against a versioned rule.
   */
  public static evaluate(
    snapshot: StudentAcademicSnapshot,
    ruleVersion: EligibilityRuleVersion
  ): EligibilityEvaluationResult {
    const rules = ruleVersion.rules;
    const reasonCodes: ReasonCode[] = [];
    const missingSkills: string[] = [];

    // 1. CGPA Check
    if (snapshot.cgpa < rules.minCgpa) {
      reasonCodes.push('INSUFFICIENT_CGPA');
    }

    // 2. Backlogs Check
    if (snapshot.activeBacklogs > rules.maxBacklogs) {
      reasonCodes.push('EXCESSIVE_BACKLOGS');
    }

    // 3. Branch Check (if allowedBranches is non-empty)
    if (rules.allowedBranches.length > 0) {
      const branchAllowed = rules.allowedBranches.some(
        (b: string) => b.trim().toLowerCase() === snapshot.branch.trim().toLowerCase()
      );
      if (!branchAllowed) {
        reasonCodes.push('BRANCH_INELIGIBLE');
      }
    }

    // 4. Graduating Year Check (if graduatingYears is non-empty)
    if (rules.graduatingYears.length > 0) {
      if (!rules.graduatingYears.includes(snapshot.graduatingYear)) {
        reasonCodes.push('GRADUATION_YEAR_MISMATCH');
      }
    }

    // 5. Required Verified Skills Check
    if (rules.requiredSkills.length > 0) {
      const verifiedSet = new Set(snapshot.verifiedSkillNames.map((s: string) => s.trim().toLowerCase()));
      for (const requiredSkill of rules.requiredSkills) {
        if (!verifiedSet.has(requiredSkill.trim().toLowerCase())) {
          missingSkills.push(requiredSkill);
        }
      }
      if (missingSkills.length > 0) {
        reasonCodes.push('MISSING_REQUIRED_VERIFIED_SKILLS');
      }
    }

    const eligible = reasonCodes.length === 0;
    if (eligible) {
      reasonCodes.push('CRITERIA_MET');
    }

    return {
      eligible,
      status: eligible ? 'eligible' : 'ineligible',
      reasonCodes,
      missingSkills,
      ruleVersionId: ruleVersion.id,
      evaluatedAt: new Date().toISOString(),
      inputHash: this.computeInputHash(snapshot, ruleVersion.id)
    };
  }
}

