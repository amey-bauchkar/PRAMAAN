-- ==============================================================================
-- PRAMAAN MIGRATION 019: SKILL STATE v2, ATTESTATION GUARD, FAIRNESS STAGES (v2 audit C1, C2, C4, C6, B8)
-- ==============================================================================
-- Replaces trg_verify_skill_evidence (006b) with a v2 function that additionally:
--   * fixes a NULL-outcome bypass: `outcome != 'passed'` is NULL (not true) for a NULL outcome, so an
--     unfinished session satisfied the old check. Now uses IS DISTINCT FROM.
--   * requires a completed session and a proof_level consistent with the session modality;
--   * rejects evidence past its valid_until (C2);
--   * on re-verification from 'expired', requires a session completed after the expiry (C2);
--   * stamps state_since on every state change and clears proof_level when leaving 'verified' (C1).
-- Adds a guard on attestations (C4): the attesting member must be active staff of the student's
-- college and must not be the student.
-- Extends fairness_reviews with funnel stage and college tier (B8) and eligibility results with
-- 'needs_review' (C6).
-- ==============================================================================

CREATE OR REPLACE FUNCTION verify_skill_evidence_before_verified() RETURNS TRIGGER AS $$
DECLARE
  v_session RECORD;
  v_expected_level VARCHAR(20);
  accepted_count INT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.state IS DISTINCT FROM OLD.state THEN
    NEW.state_since := CURRENT_TIMESTAMP;
  END IF;

  IF NEW.state <> 'verified' THEN
    NEW.proof_level := NULL;
    RETURN NEW;
  END IF;

  IF NEW.last_verification_id IS NULL OR NEW.valid_until IS NULL OR NEW.proof_level IS NULL THEN
    RAISE EXCEPTION 'Database invariant violation: Verified skills require last_verification_id, valid_until and proof_level.';
  END IF;

  SELECT * INTO v_session FROM verification_sessions WHERE id = NEW.last_verification_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Database invariant violation: Verification session % does not exist.', NEW.last_verification_id;
  END IF;

  IF v_session.student_skill_id IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'Database invariant violation: Verification session % belongs to student_skill %, not %.',
      NEW.last_verification_id, v_session.student_skill_id, NEW.id;
  END IF;

  IF v_session.outcome IS DISTINCT FROM 'passed' OR v_session.completed_at IS NULL THEN
    RAISE EXCEPTION 'Database invariant violation: Verification session % must be completed with outcome passed (got %).',
      NEW.last_verification_id, COALESCE(v_session.outcome, 'NULL');
  END IF;

  v_expected_level := CASE v_session.modality
    WHEN 'code_backed'     THEN 'L1_code_backed'
    WHEN 'issuer_verified' THEN 'L1_code_backed'
    WHEN 'test_score'      THEN 'L2_assessed'
    WHEN 'probe'           THEN 'L3_defended'
    WHEN 'defence'         THEN 'L3_defended'
    WHEN 'mentor'          THEN 'L3_attested'
  END;
  IF NEW.proof_level IS DISTINCT FROM v_expected_level THEN
    RAISE EXCEPTION 'Database invariant violation: proof_level % does not match session modality % (expected %).',
      NEW.proof_level, v_session.modality, v_expected_level;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.state = 'expired' AND v_session.completed_at <= OLD.state_since THEN
    RAISE EXCEPTION 'Database invariant violation: Re-verification of an expired skill needs a session completed after the expiry.';
  END IF;

  SELECT COUNT(*) INTO accepted_count
    FROM skill_evidence se
    JOIN evidence_items ei ON ei.id = se.evidence_id
   WHERE se.student_skill_id = NEW.id
     AND ei.student_id = NEW.student_id
     AND ei.status = 'accepted'
     AND (ei.valid_until IS NULL OR ei.valid_until > CURRENT_TIMESTAMP);

  IF accepted_count = 0 THEN
    RAISE EXCEPTION 'Database invariant violation: Cannot set skill state to verified without fresh accepted evidence belonging to the student.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_verify_skill_evidence ON student_skills;
CREATE TRIGGER trg_verify_skill_evidence
BEFORE INSERT OR UPDATE ON student_skills
FOR EACH ROW EXECUTE FUNCTION verify_skill_evidence_before_verified();

-- C4: attestation guard -------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_attestation_attester() RETURNS TRIGGER AS $$
DECLARE
  v_member RECORD;
  v_student RECORD;
BEGIN
  SELECT m.user_id, m.org_id, m.role, m.status INTO v_member
    FROM memberships m WHERE m.id = NEW.mentor_membership_id;
  SELECT s.user_id, s.org_id INTO v_student
    FROM evidence_items e JOIN students s ON s.id = e.student_id WHERE e.id = NEW.evidence_id;

  IF v_member IS NULL OR v_student IS NULL THEN
    RAISE EXCEPTION 'Attestation invariant violation: unknown attester membership or evidence.';
  END IF;
  IF v_member.status <> 'active' OR v_member.role NOT IN ('mentor', 'officer', 'college_admin', 'dept_coordinator') THEN
    RAISE EXCEPTION 'Attestation invariant violation: attester must be an active mentor or officer.';
  END IF;
  IF v_member.org_id IS DISTINCT FROM v_student.org_id THEN
    RAISE EXCEPTION 'Attestation invariant violation: attester must belong to the student''s college.';
  END IF;
  IF v_member.user_id = v_student.user_id THEN
    RAISE EXCEPTION 'Attestation invariant violation: a student cannot attest their own evidence.';
  END IF;
  IF NEW.valid_until <= NEW.created_at THEN
    RAISE EXCEPTION 'Attestation invariant violation: valid_until must be after created_at.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_attestation_attester ON attestations;
CREATE TRIGGER trg_guard_attestation_attester
BEFORE INSERT OR UPDATE ON attestations
FOR EACH ROW EXECUTE FUNCTION guard_attestation_attester();

-- B8: fairness per funnel stage and college tier --------------------------------
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
     WHERE con.conrelid = 'fairness_reviews'::regclass AND con.contype = 'c' AND att.attname = 'dimension'
  LOOP
    EXECUTE format('ALTER TABLE fairness_reviews DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE fairness_reviews ADD CONSTRAINT fairness_reviews_dimension_check
  CHECK (dimension IN ('gender', 'category', 'branch', 'college_tier'));
ALTER TABLE fairness_reviews ADD COLUMN IF NOT EXISTS stage VARCHAR(20) NOT NULL DEFAULT 'eligibility';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_fairness_reviews_stage') THEN
    ALTER TABLE fairness_reviews ADD CONSTRAINT chk_fairness_reviews_stage
      CHECK (stage IN ('eligibility', 'shortlist', 'offer'));
  END IF;
END $$;

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS tier VARCHAR(20);

-- C6: three-valued eligibility ---------------------------------------------------
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
     WHERE con.conrelid = 'eligibility_decisions'::regclass AND con.contype = 'c' AND att.attname = 'result'
  LOOP
    EXECUTE format('ALTER TABLE eligibility_decisions DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE eligibility_decisions ADD CONSTRAINT eligibility_decisions_result_check
  CHECK (result IN ('eligible', 'ineligible', 'needs_review', 'conditionally_eligible'));
