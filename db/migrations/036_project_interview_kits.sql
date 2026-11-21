-- Project interview kits: a recruiter pastes a candidate's GitHub profile and resume, PRAMAAN scans the public repositories, finds the
-- resume's highlighted projects among them, and drafts easy, medium and hard questions for the interviewer.
--  - Only derived data is stored (matches, scan facts, questions). The resume text itself is never stored, only a hash of it.
--  - A kit is visible only to the recruiter who made it, and is deleted when the student withdraws recruiter-sharing consent.
CREATE TABLE IF NOT EXISTS project_kits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    drive_id UUID REFERENCES drives(id) ON DELETE SET NULL,
    recruiter_membership_id UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
    github_login VARCHAR(39) NOT NULL,
    resume_sha256 CHAR(64) NOT NULL,
    resume_source VARCHAR(10) NOT NULL CHECK (resume_source IN ('paste', 'pdf')),
    repos_total INT NOT NULL DEFAULT 0,
    repos_deep INT NOT NULL DEFAULT 0,
    rate_limited BOOLEAN NOT NULL DEFAULT FALSE,
    token_used VARCHAR(10) NOT NULL DEFAULT 'none' CHECK (token_used IN ('none', 'server', 'recruiter')),
    profile JSONB NOT NULL DEFAULT '{}'::jsonb,
    projects JSONB NOT NULL DEFAULT '[]'::jsonb,
    models JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_project_kits_owner ON project_kits (org_id, recruiter_membership_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_kits_student ON project_kits (student_id);

ALTER TABLE project_kits ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_kits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_project_kits ON project_kits;
CREATE POLICY tenant_isolation_project_kits ON project_kits FOR ALL
    USING (org_id = current_app_org_id()) WITH CHECK (org_id = current_app_org_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON project_kits TO app_api;

-- Recruiters can be invited like everyone else (they previously had no way to get an account).
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN SELECT con.conname FROM pg_constraint con JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
            WHERE con.conrelid = 'pending_invites'::regclass AND con.contype = 'c' AND att.attname = 'role' LOOP
    EXECUTE format('ALTER TABLE pending_invites DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE pending_invites ADD CONSTRAINT pending_invites_role_check CHECK (role IN ('student', 'mentor', 'dept_coordinator', 'officer', 'college_admin', 'recruiter'));
