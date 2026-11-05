-- ==============================================================================
-- PRAMAAN ROW-LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================

-- 1. Enable and Force RLS on all Multi-Tenant Tables
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments FORCE ROW LEVEL SECURITY;

ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE students FORCE ROW LEVEL SECURITY;

ALTER TABLE academic_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE academic_records FORCE ROW LEVEL SECURITY;

ALTER TABLE repositories ENABLE ROW LEVEL SECURITY;
ALTER TABLE repositories FORCE ROW LEVEL SECURITY;

ALTER TABLE evidence_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_items FORCE ROW LEVEL SECURITY;

ALTER TABLE student_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_skills FORCE ROW LEVEL SECURITY;

ALTER TABLE drives ENABLE ROW LEVEL SECURITY;
ALTER TABLE drives FORCE ROW LEVEL SECURITY;

ALTER TABLE eligibility_rule_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE eligibility_rule_sets FORCE ROW LEVEL SECURITY;

ALTER TABLE eligibility_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE eligibility_decisions FORCE ROW LEVEL SECURITY;

ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposals FORCE ROW LEVEL SECURITY;

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;

-- 2. Tenant Context Helper Function
CREATE OR REPLACE FUNCTION current_app_org_id() RETURNS UUID AS $$
BEGIN
    RETURN NULLIF(current_setting('app.current_org_id', true), '')::UUID;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION current_app_user_id() RETURNS UUID AS $$
BEGIN
    RETURN NULLIF(current_setting('app.current_user_id', true), '')::UUID;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION current_app_user_role() RETURNS VARCHAR AS $$
BEGIN
    RETURN NULLIF(current_setting('app.current_user_role', true), '');
END;
$$ LANGUAGE plpgsql STABLE;

-- 3. Tenant Isolation Policies

-- Departments
CREATE POLICY tenant_isolation_departments ON departments
    FOR ALL
    USING (org_id = current_app_org_id())
    WITH CHECK (org_id = current_app_org_id());

-- Students
CREATE POLICY tenant_isolation_students ON students
    FOR ALL
    USING (org_id = current_app_org_id())
    WITH CHECK (org_id = current_app_org_id());

-- Academic Records (Inherits tenancy through student)
CREATE POLICY tenant_isolation_academic_records ON academic_records
    FOR ALL
    USING (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()));

-- Repositories (Inherits tenancy through student)
CREATE POLICY tenant_isolation_repositories ON repositories
    FOR ALL
    USING (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()));

-- Evidence Items
CREATE POLICY tenant_isolation_evidence_items ON evidence_items
    FOR ALL
    USING (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()));

-- Student Skills
CREATE POLICY tenant_isolation_student_skills ON student_skills
    FOR ALL
    USING (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()));

-- Drives
CREATE POLICY tenant_isolation_drives ON drives
    FOR ALL
    USING (org_id = current_app_org_id())
    WITH CHECK (org_id = current_app_org_id());

-- Eligibility Rule Sets
CREATE POLICY tenant_isolation_eligibility_rule_sets ON eligibility_rule_sets
    FOR ALL
    USING (org_id = current_app_org_id())
    WITH CHECK (org_id = current_app_org_id());

-- Eligibility Decisions: Tenant isolation + Provisional Visibility Restriction (RLS-09)
-- Students can ONLY see decisions that are 'published' or 'overridden', NEVER 'provisional'.
CREATE POLICY tenant_isolation_eligibility_decisions ON eligibility_decisions
    FOR ALL
    USING (
        drive_id IN (SELECT id FROM drives WHERE org_id = current_app_org_id())
        AND (
            current_app_user_role() IN ('officer', 'platform_admin', 'mentor')
            OR (
                current_app_user_role() = 'student'
                AND student_id IN (SELECT id FROM students WHERE user_id = current_app_user_id())
                AND status IN ('published', 'overridden')
            )
        )
    );

-- Proposals (AI Output Governance)
CREATE POLICY tenant_isolation_proposals ON proposals
    FOR ALL
    USING (agent_run_id IN (SELECT id FROM agent_runs WHERE org_id = current_app_org_id()));

-- Audit Events: Insert and Select only; update and delete barred
CREATE POLICY tenant_isolation_audit_events ON audit_events
    FOR SELECT
    USING (org_id = current_app_org_id());

CREATE POLICY tenant_insert_audit_events ON audit_events
    FOR INSERT
    WITH CHECK (org_id = current_app_org_id());

