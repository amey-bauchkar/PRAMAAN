-- ==============================================================================
-- PRAMAAN MIGRATION 018: ROLE HIERARCHY & STANDARDS-ALIGNED TAXONOMY (v2 audit B11, B12, §3.2)
-- ==============================================================================
-- B11 PS roles are university, college, department, officer. Adds college_admin and dept_coordinator.
-- B12 Skills had only a unique name: no ESCO / O*NET / NSQF mapping, no aliases, no hierarchy.
-- §3.2 Proof Levels: student_skills.proof_level + level, per-skill half-life.
-- ==============================================================================

-- B11: roles -------------------------------------------------------------------
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
     WHERE con.conrelid = 'memberships'::regclass AND con.contype = 'c' AND att.attname = 'role'
  LOOP
    EXECUTE format('ALTER TABLE memberships DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE memberships ADD CONSTRAINT memberships_role_check CHECK (role IN (
  'student', 'mentor', 'officer', 'college_admin', 'dept_coordinator',
  'university_admin', 'recruiter', 'platform_admin'
));

-- A dept_coordinator must be bound to a department.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_dept_coordinator_has_department') THEN
    ALTER TABLE memberships ADD CONSTRAINT chk_dept_coordinator_has_department
      CHECK (role <> 'dept_coordinator' OR department_id IS NOT NULL);
  END IF;
END $$;

-- RLS policies written before this migration test current_app_user_role() against 'officer'.
-- college_admin and dept_coordinator act with officer privileges inside their college, so the
-- policy-facing function reports them as 'officer'. The exact role stays available through
-- current_app_user_role_exact(); department scoping is enforced in the API layer.
CREATE OR REPLACE FUNCTION current_app_user_role_exact() RETURNS VARCHAR AS $$
BEGIN
    RETURN NULLIF(current_setting('app.current_user_role', true), '');
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION current_app_user_role() RETURNS VARCHAR AS $$
DECLARE r VARCHAR := NULLIF(current_setting('app.current_user_role', true), '');
BEGIN
    IF r IN ('college_admin', 'dept_coordinator') THEN
        RETURN 'officer';
    END IF;
    RETURN r;
END;
$$ LANGUAGE plpgsql STABLE;

REVOKE ALL ON FUNCTION current_app_user_role_exact() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION current_app_user_role_exact() TO app_api, ai_worker, fairness_job;

-- B12: taxonomy ----------------------------------------------------------------
ALTER TABLE skills ADD COLUMN IF NOT EXISTS parent_skill_id UUID REFERENCES skills(id);
ALTER TABLE skills ADD COLUMN IF NOT EXISTS half_life_days INT NOT NULL DEFAULT 365 CHECK (half_life_days > 0);
ALTER TABLE skills ADD COLUMN IF NOT EXISTS slug VARCHAR(100);
CREATE UNIQUE INDEX IF NOT EXISTS uq_skills_slug ON skills (slug) WHERE slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS skill_aliases (
    skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    alias VARCHAR(100) NOT NULL,
    PRIMARY KEY (skill_id, alias)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_skill_aliases_alias_ci ON skill_aliases (lower(alias));

-- Mapping to external frameworks. `code` is the framework's identifier (ESCO concept URI, O*NET
-- element / technology code, NSQF level or qualification-pack code). A mapping whose code has not yet
-- been confirmed against the framework's own source is stored with status 'pending_review' and a
-- NULL code; it is never displayed as an official alignment until reviewed.
CREATE TABLE IF NOT EXISTS skill_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    framework VARCHAR(10) NOT NULL CHECK (framework IN ('ESCO', 'ONET', 'NSQF')),
    code VARCHAR(255),
    label VARCHAR(255) NOT NULL,
    framework_version VARCHAR(30),
    match_type VARCHAR(10) NOT NULL DEFAULT 'close' CHECK (match_type IN ('exact', 'close', 'broad', 'narrow')),
    status VARCHAR(20) NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'confirmed')),
    reviewed_at TIMESTAMPTZ,
    CONSTRAINT chk_confirmed_mapping_has_code CHECK (status <> 'confirmed' OR (code IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_skill_mappings ON skill_mappings (skill_id, framework, label);

-- Reference catalogs: readable by app roles, writable only by migrations / admin.
ALTER TABLE skill_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_aliases FORCE ROW LEVEL SECURITY;
ALTER TABLE skill_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_mappings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS read_catalog_skill_aliases ON skill_aliases;
CREATE POLICY read_catalog_skill_aliases ON skill_aliases FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS read_catalog_skill_mappings ON skill_mappings;
CREATE POLICY read_catalog_skill_mappings ON skill_mappings FOR SELECT USING (TRUE);
GRANT SELECT ON skill_aliases, skill_mappings TO app_api, ai_worker;

-- §3.2: Proof Levels on student skills ------------------------------------------
ALTER TABLE student_skills ADD COLUMN IF NOT EXISTS proof_level VARCHAR(20);
ALTER TABLE student_skills ADD COLUMN IF NOT EXISTS level INT NOT NULL DEFAULT 1;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_student_skills_proof_level') THEN
    ALTER TABLE student_skills ADD CONSTRAINT chk_student_skills_proof_level
      CHECK (proof_level IS NULL OR proof_level IN ('L1_code_backed', 'L2_assessed', 'L3_defended', 'L3_attested'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_student_skills_level') THEN
    ALTER TABLE student_skills ADD CONSTRAINT chk_student_skills_level CHECK (level BETWEEN 1 AND 3);
  END IF;
END $$;

ALTER TABLE skill_state_events ADD COLUMN IF NOT EXISTS proof_level VARCHAR(20);

-- Verification modalities that map to each proof level.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
     WHERE con.conrelid = 'verification_sessions'::regclass AND con.contype = 'c' AND att.attname = 'modality'
  LOOP
    EXECUTE format('ALTER TABLE verification_sessions DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE verification_sessions ADD CONSTRAINT verification_sessions_modality_check CHECK (modality IN (
  'code_backed', 'issuer_verified', 'test_score', 'probe', 'defence', 'mentor'
));
