-- ==============================================================================
-- PRAMAAN MIGRATION 017: PRIVACY FIXES (PRAMAAN v2 audit D1, D2, D3, D5)
-- ==============================================================================
-- D1  guardian_consents defaulted to status 'verified' with verified_at = now(), so any insert that
--     omitted the status created a *verified* parental consent. Fail closed: default 'pending', and a
--     'verified' row must name who verified it, how, and when.
-- D2  students.is_minor was a static flag set at import time. Store date_of_birth and derive minor
--     status at query time (student_is_minor / student_age_status).
-- D3  student_group_attributes requires a consent grant, but no fairness-monitoring purpose existed.
-- D5  No per-purpose retention period.
-- ==============================================================================

-- D1 -------------------------------------------------------------------------
ALTER TABLE guardian_consents ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE guardian_consents ALTER COLUMN verified_at DROP DEFAULT;
ALTER TABLE guardian_consents ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES memberships(id);
ALTER TABLE guardian_consents ADD COLUMN IF NOT EXISTS verification_method VARCHAR(30);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_guardian_verification_method') THEN
    ALTER TABLE guardian_consents ADD CONSTRAINT chk_guardian_verification_method
      CHECK (verification_method IS NULL OR verification_method IN
        ('digilocker', 'in_person_document', 'signed_form_otp', 'institution_record'));
  END IF;
END $$;

-- Rows that claim 'verified' without a recorded verifier cannot be trusted: return them to pending
-- (fail closed) so a guardian consent is re-collected before any minor's data is shared.
UPDATE guardian_consents
   SET status = 'pending', verified_at = NULL
 WHERE status = 'verified' AND (verified_by IS NULL OR verification_method IS NULL);

UPDATE guardian_consents SET verified_at = NULL WHERE status <> 'verified';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_guardian_verified_requires_verifier') THEN
    ALTER TABLE guardian_consents ADD CONSTRAINT chk_guardian_verified_requires_verifier
      CHECK (status <> 'verified'
             OR (verified_by IS NOT NULL AND verification_method IS NOT NULL AND verified_at IS NOT NULL));
  END IF;
END $$;

-- D2 -------------------------------------------------------------------------
ALTER TABLE students ADD COLUMN IF NOT EXISTS date_of_birth DATE;

COMMENT ON COLUMN students.is_minor IS
  'DEPRECATED as a source of truth (migration 017). Used only when date_of_birth is unknown. Use student_is_minor().';

-- Minor status is derived from date of birth at query time. When the date of birth is unknown the
-- legacy flag is used; callers that need certainty must treat NULL date_of_birth as "verify age".
CREATE OR REPLACE FUNCTION student_is_minor(p_student_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
           WHEN s.date_of_birth IS NOT NULL THEN s.date_of_birth > (CURRENT_DATE - INTERVAL '18 years')::date
           ELSE s.is_minor
         END
    FROM public.students s
   WHERE s.id = p_student_id;
$$;

REVOKE ALL ON FUNCTION student_is_minor(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION student_is_minor(UUID) TO app_api, fairness_job;

-- security_invoker: the view runs with the caller's privileges, so students' RLS still applies.
CREATE OR REPLACE VIEW student_age_status WITH (security_invoker = true) AS
SELECT s.id AS student_id,
       s.org_id,
       s.date_of_birth,
       CASE
         WHEN s.date_of_birth IS NOT NULL THEN s.date_of_birth > (CURRENT_DATE - INTERVAL '18 years')::date
         ELSE s.is_minor
       END AS is_minor_effective,
       (s.date_of_birth IS NULL) AS age_unverified,
       EXISTS (SELECT 1 FROM guardian_consents g WHERE g.student_id = s.id AND g.status = 'verified') AS has_verified_guardian_consent
  FROM students s;

GRANT SELECT ON student_age_status TO app_api;

-- D3 + D5 --------------------------------------------------------------------
ALTER TABLE consent_purposes ADD COLUMN IF NOT EXISTS retention_days INT;

INSERT INTO consent_purposes (code, description, version, requires_guardian_for_minor) VALUES
  ('fairness_monitoring',
   'Voluntary self-identification of gender and category, used only in aggregate to check placement outcomes for bias. "Prefer not to say" is always available and never affects eligibility.',
   1, TRUE)
ON CONFLICT (code) DO NOTHING;

-- Retention defaults (institutions may shorten; legal review required before a real pilot).
UPDATE consent_purposes SET retention_days = 1095 WHERE code = 'placement_operations' AND retention_days IS NULL;
UPDATE consent_purposes SET retention_days = 365  WHERE code = 'repo_verification'    AND retention_days IS NULL;
UPDATE consent_purposes SET retention_days = 365  WHERE code = 'recruiter_sharing'    AND retention_days IS NULL;
UPDATE consent_purposes SET retention_days = 730  WHERE code = 'analytics_research'   AND retention_days IS NULL;
UPDATE consent_purposes SET retention_days = 365  WHERE code = 'model_evaluation'     AND retention_days IS NULL;
UPDATE consent_purposes SET retention_days = 1095 WHERE code = 'fairness_monitoring'  AND retention_days IS NULL;
