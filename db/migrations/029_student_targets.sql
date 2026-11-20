-- Roles a student has chosen to work towards. Used to order the skill-gap view.
CREATE TABLE IF NOT EXISTS student_targets (
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES job_roles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (student_id, role_id)
);
ALTER TABLE student_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_targets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_student_targets ON student_targets;
CREATE POLICY tenant_isolation_student_targets ON student_targets FOR ALL
    USING (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()))
    WITH CHECK (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()));
GRANT SELECT, INSERT, DELETE ON student_targets TO app_api;
