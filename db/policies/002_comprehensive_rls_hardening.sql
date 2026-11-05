-- ==============================================================================
-- PRAMAAN COMPREHENSIVE RLS HARDENING & AUDIT (POSTGRESQL 17)
-- ==============================================================================

-- 1. Ensure RLS is enabled and forced on EVERY table holding tenant/student data
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments FORCE ROW LEVEL SECURITY;

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;

ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE students FORCE ROW LEVEL SECURITY;

ALTER TABLE academic_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE academic_records FORCE ROW LEVEL SECURITY;

ALTER TABLE student_group_attributes ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_group_attributes FORCE ROW LEVEL SECURITY;

ALTER TABLE consent_purposes ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_purposes FORCE ROW LEVEL SECURITY;

ALTER TABLE consent_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_grants FORCE ROW LEVEL SECURITY;

ALTER TABLE guardian_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardian_consents FORCE ROW LEVEL SECURITY;

ALTER TABLE data_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_requests FORCE ROW LEVEL SECURITY;

ALTER TABLE connected_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE connected_accounts FORCE ROW LEVEL SECURITY;

ALTER TABLE repositories ENABLE ROW LEVEL SECURITY;
ALTER TABLE repositories FORCE ROW LEVEL SECURITY;

ALTER TABLE repo_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE repo_snapshots FORCE ROW LEVEL SECURITY;

ALTER TABLE skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE skills FORCE ROW LEVEL SECURITY;

ALTER TABLE evidence_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_items FORCE ROW LEVEL SECURITY;

ALTER TABLE student_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_skills FORCE ROW LEVEL SECURITY;

ALTER TABLE skill_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_evidence FORCE ROW LEVEL SECURITY;

ALTER TABLE attestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE attestations FORCE ROW LEVEL SECURITY;

ALTER TABLE skill_state_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_state_events FORCE ROW LEVEL SECURITY;

ALTER TABLE rubric_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rubric_versions FORCE ROW LEVEL SECURITY;

ALTER TABLE verification_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_sessions FORCE ROW LEVEL SECURITY;

ALTER TABLE verification_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_questions FORCE ROW LEVEL SECURITY;

ALTER TABLE probe_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE probe_definitions FORCE ROW LEVEL SECURITY;

ALTER TABLE probe_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE probe_runs FORCE ROW LEVEL SECURITY;

ALTER TABLE human_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE human_reviews FORCE ROW LEVEL SECURITY;

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies FORCE ROW LEVEL SECURITY;

ALTER TABLE job_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_roles FORCE ROW LEVEL SECURITY;

ALTER TABLE job_role_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_role_skills FORCE ROW LEVEL SECURITY;

ALTER TABLE drives ENABLE ROW LEVEL SECURITY;
ALTER TABLE drives FORCE ROW LEVEL SECURITY;

ALTER TABLE eligibility_rule_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE eligibility_rule_sets FORCE ROW LEVEL SECURITY;

ALTER TABLE eligibility_rule_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE eligibility_rule_versions FORCE ROW LEVEL SECURITY;

ALTER TABLE eligibility_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE eligibility_decisions FORCE ROW LEVEL SECURITY;

ALTER TABLE eligibility_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE eligibility_overrides FORCE ROW LEVEL SECURITY;

ALTER TABLE recruiter_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruiter_access_grants FORCE ROW LEVEL SECURITY;

ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications FORCE ROW LEVEL SECURITY;

ALTER TABLE student_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_outcomes FORCE ROW LEVEL SECURITY;

ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs FORCE ROW LEVEL SECURITY;

ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposals FORCE ROW LEVEL SECURITY;

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;

ALTER TABLE fairness_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE fairness_reviews FORCE ROW LEVEL SECURITY;

ALTER TABLE fairness_simulations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fairness_simulations FORCE ROW LEVEL SECURITY;

-- 2. Drop existing policies to ensure clean, comprehensive re-creation
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public') LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
    END LOOP;
END $$;

-- 3. Define Clean, Scoped Tenant Policies with Explicit USING and WITH CHECK clauses

-- Organizations
CREATE POLICY tenant_isolation_organizations ON organizations
    FOR SELECT
    USING (id = current_app_org_id() OR kind = 'university');

-- Departments
CREATE POLICY tenant_isolation_departments ON departments
    FOR ALL
    USING (org_id = current_app_org_id())
    WITH CHECK (org_id = current_app_org_id());

-- Memberships
CREATE POLICY tenant_isolation_memberships ON memberships
    FOR ALL
    USING (org_id = current_app_org_id() OR user_id = current_app_user_id())
    WITH CHECK (org_id = current_app_org_id());

-- Students
CREATE POLICY tenant_isolation_students ON students
    FOR ALL
    USING (org_id = current_app_org_id())
    WITH CHECK (org_id = current_app_org_id());

-- Academic Records
CREATE POLICY tenant_isolation_academic_records ON academic_records
    FOR ALL
    USING (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()))
    WITH CHECK (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()));

-- Student Protected Demographics (Restricted exclusively to fairness_job and platform_admin)
CREATE POLICY tenant_isolation_student_group_attributes ON student_group_attributes
    FOR ALL
    USING (
        student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id())
        AND current_app_user_role() IN ('fairness_job', 'platform_admin')
    )
    WITH CHECK (
        student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id())
        AND current_app_user_role() IN ('fairness_job', 'platform_admin')
    );

-- Master Catalogs (Read-only for app roles)
CREATE POLICY read_catalog_consent_purposes ON consent_purposes FOR SELECT USING (TRUE);
CREATE POLICY read_catalog_skills ON skills FOR SELECT USING (TRUE);
CREATE POLICY read_catalog_rubric_versions ON rubric_versions FOR SELECT USING (TRUE);
CREATE POLICY read_catalog_probe_definitions ON probe_definitions FOR SELECT USING (TRUE);

-- Consent Grants
CREATE POLICY tenant_isolation_consent_grants ON consent_grants
    FOR ALL
    USING (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()))
    WITH CHECK (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()));

-- Guardian Consents
CREATE POLICY tenant_isolation_guardian_consents ON guardian_consents
    FOR ALL
    USING (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()))
    WITH CHECK (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()));

-- Data Requests
CREATE POLICY tenant_isolation_data_requests ON data_requests
    FOR ALL
    USING (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()))
    WITH CHECK (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()));

-- Connected Accounts
CREATE POLICY tenant_isolation_connected_accounts ON connected_accounts
    FOR ALL
    USING (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()))
    WITH CHECK (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()));

-- Repositories
CREATE POLICY tenant_isolation_repositories ON repositories
    FOR ALL
    USING (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()))
    WITH CHECK (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()));

-- Repo Snapshots
CREATE POLICY tenant_isolation_repo_snapshots ON repo_snapshots
    FOR ALL
    USING (repository_id IN (SELECT r.id FROM repositories r JOIN students s ON s.id = r.student_id WHERE s.org_id = current_app_org_id()))
    WITH CHECK (repository_id IN (SELECT r.id FROM repositories r JOIN students s ON s.id = r.student_id WHERE s.org_id = current_app_org_id()));

-- Evidence Items
CREATE POLICY tenant_isolation_evidence_items ON evidence_items
    FOR ALL
    USING (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()))
    WITH CHECK (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()));

-- Student Skills
CREATE POLICY tenant_isolation_student_skills ON student_skills
    FOR ALL
    USING (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()))
    WITH CHECK (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()));

-- Skill Evidence (Link Table)
CREATE POLICY tenant_isolation_skill_evidence ON skill_evidence
    FOR ALL
    USING (student_skill_id IN (SELECT sk.id FROM student_skills sk JOIN students s ON s.id = sk.student_id WHERE s.org_id = current_app_org_id()))
    WITH CHECK (student_skill_id IN (SELECT sk.id FROM student_skills sk JOIN students s ON s.id = sk.student_id WHERE s.org_id = current_app_org_id()));

-- Attestations
CREATE POLICY tenant_isolation_attestations ON attestations
    FOR ALL
    USING (evidence_id IN (SELECT e.id FROM evidence_items e JOIN students s ON s.id = e.student_id WHERE s.org_id = current_app_org_id()))
    WITH CHECK (evidence_id IN (SELECT e.id FROM evidence_items e JOIN students s ON s.id = e.student_id WHERE s.org_id = current_app_org_id()));

-- Skill State Events
CREATE POLICY tenant_isolation_skill_state_events ON skill_state_events
    FOR ALL
    USING (student_skill_id IN (SELECT sk.id FROM student_skills sk JOIN students s ON s.id = sk.student_id WHERE s.org_id = current_app_org_id()))
    WITH CHECK (student_skill_id IN (SELECT sk.id FROM student_skills sk JOIN students s ON s.id = sk.student_id WHERE s.org_id = current_app_org_id()));

-- Verification Sessions
CREATE POLICY tenant_isolation_verification_sessions ON verification_sessions
    FOR ALL
    USING (student_skill_id IN (SELECT sk.id FROM student_skills sk JOIN students s ON s.id = sk.student_id WHERE s.org_id = current_app_org_id()))
    WITH CHECK (student_skill_id IN (SELECT sk.id FROM student_skills sk JOIN students s ON s.id = sk.student_id WHERE s.org_id = current_app_org_id()));

-- Verification Questions
CREATE POLICY tenant_isolation_verification_questions ON verification_questions
    FOR ALL
    USING (session_id IN (SELECT vs.id FROM verification_sessions vs JOIN student_skills sk ON sk.id = vs.student_skill_id JOIN students s ON s.id = sk.student_id WHERE s.org_id = current_app_org_id()))
    WITH CHECK (session_id IN (SELECT vs.id FROM verification_sessions vs JOIN student_skills sk ON sk.id = vs.student_skill_id JOIN students s ON s.id = sk.student_id WHERE s.org_id = current_app_org_id()));

-- Probe Runs
CREATE POLICY tenant_isolation_probe_runs ON probe_runs
    FOR ALL
    USING (session_id IN (SELECT vs.id FROM verification_sessions vs JOIN student_skills sk ON sk.id = vs.student_skill_id JOIN students s ON s.id = sk.student_id WHERE s.org_id = current_app_org_id()))
    WITH CHECK (session_id IN (SELECT vs.id FROM verification_sessions vs JOIN student_skills sk ON sk.id = vs.student_skill_id JOIN students s ON s.id = sk.student_id WHERE s.org_id = current_app_org_id()));

-- Human Reviews
CREATE POLICY tenant_isolation_human_reviews ON human_reviews
    FOR ALL
    USING (session_id IN (SELECT vs.id FROM verification_sessions vs JOIN student_skills sk ON sk.id = vs.student_skill_id JOIN students s ON s.id = sk.student_id WHERE s.org_id = current_app_org_id()))
    WITH CHECK (session_id IN (SELECT vs.id FROM verification_sessions vs JOIN student_skills sk ON sk.id = vs.student_skill_id JOIN students s ON s.id = sk.student_id WHERE s.org_id = current_app_org_id()));

-- Companies
CREATE POLICY tenant_isolation_companies ON companies
    FOR ALL
    USING (org_id = current_app_org_id())
    WITH CHECK (org_id = current_app_org_id());

-- Job Roles
CREATE POLICY tenant_isolation_job_roles ON job_roles
    FOR ALL
    USING (company_id IN (SELECT id FROM companies WHERE org_id = current_app_org_id()))
    WITH CHECK (company_id IN (SELECT id FROM companies WHERE org_id = current_app_org_id()));

-- Job Role Skills
CREATE POLICY tenant_isolation_job_role_skills ON job_role_skills
    FOR ALL
    USING (role_id IN (SELECT jr.id FROM job_roles jr JOIN companies c ON c.id = jr.company_id WHERE c.org_id = current_app_org_id()))
    WITH CHECK (role_id IN (SELECT jr.id FROM job_roles jr JOIN companies c ON c.id = jr.company_id WHERE c.org_id = current_app_org_id()));

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

-- Eligibility Rule Versions
CREATE POLICY tenant_isolation_eligibility_rule_versions ON eligibility_rule_versions
    FOR ALL
    USING (rule_set_id IN (SELECT id FROM eligibility_rule_sets WHERE org_id = current_app_org_id()))
    WITH CHECK (rule_set_id IN (SELECT id FROM eligibility_rule_sets WHERE org_id = current_app_org_id()));

-- Eligibility Decisions: Tenant Isolation + Student Provisional Visibility Rule
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
    )
    WITH CHECK (
        drive_id IN (SELECT id FROM drives WHERE org_id = current_app_org_id())
        AND current_app_user_role() IN ('officer', 'platform_admin')
    );

-- Eligibility Overrides
CREATE POLICY tenant_isolation_eligibility_overrides ON eligibility_overrides
    FOR ALL
    USING (decision_id IN (SELECT ed.id FROM eligibility_decisions ed JOIN drives d ON d.id = ed.drive_id WHERE d.org_id = current_app_org_id()))
    WITH CHECK (decision_id IN (SELECT ed.id FROM eligibility_decisions ed JOIN drives d ON d.id = ed.drive_id WHERE d.org_id = current_app_org_id()));

-- Recruiter Access Grants
CREATE POLICY tenant_isolation_recruiter_access_grants ON recruiter_access_grants
    FOR ALL
    USING (drive_id IS NULL OR drive_id IN (SELECT id FROM drives WHERE org_id = current_app_org_id()))
    WITH CHECK (drive_id IS NULL OR drive_id IN (SELECT id FROM drives WHERE org_id = current_app_org_id()));

-- Applications
CREATE POLICY tenant_isolation_applications ON applications
    FOR ALL
    USING (drive_id IN (SELECT id FROM drives WHERE org_id = current_app_org_id()))
    WITH CHECK (drive_id IN (SELECT id FROM drives WHERE org_id = current_app_org_id()));

-- Student Outcomes
CREATE POLICY tenant_isolation_student_outcomes ON student_outcomes
    FOR ALL
    USING (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()))
    WITH CHECK (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()));

-- Agent Runs
CREATE POLICY tenant_isolation_agent_runs ON agent_runs
    FOR ALL
    USING (org_id = current_app_org_id())
    WITH CHECK (org_id = current_app_org_id());

-- Proposals (Inert AI proposals)
CREATE POLICY tenant_isolation_proposals ON proposals
    FOR ALL
    USING (agent_run_id IN (SELECT id FROM agent_runs WHERE org_id = current_app_org_id()))
    WITH CHECK (agent_run_id IN (SELECT id FROM agent_runs WHERE org_id = current_app_org_id()));

-- Audit Events (Append-only; zero update or delete)
CREATE POLICY tenant_isolation_audit_events ON audit_events
    FOR SELECT
    USING (org_id = current_app_org_id());

CREATE POLICY tenant_insert_audit_events ON audit_events
    FOR INSERT
    WITH CHECK (org_id = current_app_org_id());

-- Fairness Reviews
CREATE POLICY tenant_isolation_fairness_reviews ON fairness_reviews
    FOR ALL
    USING (drive_id IN (SELECT id FROM drives WHERE org_id = current_app_org_id()))
    WITH CHECK (drive_id IN (SELECT id FROM drives WHERE org_id = current_app_org_id()));

-- Fairness Simulations
CREATE POLICY tenant_isolation_fairness_simulations ON fairness_simulations
    FOR ALL
    USING (org_id = current_app_org_id())
    WITH CHECK (org_id = current_app_org_id());

-- 4. Kernel-Enforced Skill Verification Triggers

-- Trigger 4A: Strict evidence ownership check on skill_evidence
CREATE OR REPLACE FUNCTION verify_skill_evidence_owner() RETURNS TRIGGER AS $$
DECLARE
  v_skill_student_id UUID;
  v_evidence_student_id UUID;
BEGIN
  SELECT student_id INTO v_skill_student_id FROM student_skills WHERE id = NEW.student_skill_id;
  SELECT student_id INTO v_evidence_student_id FROM evidence_items WHERE id = NEW.evidence_id;

  IF v_skill_student_id IS DISTINCT FROM v_evidence_student_id THEN
    RAISE EXCEPTION 'Database invariant violation: Cannot link evidence belonging to student % to skill belonging to student %', 
      v_evidence_student_id, v_skill_student_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_skill_evidence_owner ON skill_evidence;
CREATE TRIGGER trg_check_skill_evidence_owner
BEFORE INSERT OR UPDATE ON skill_evidence
FOR EACH ROW EXECUTE FUNCTION verify_skill_evidence_owner();

-- Trigger 4B: Comprehensive evidence-to-student-to-session verification before state = 'verified'
CREATE OR REPLACE FUNCTION verify_skill_evidence_before_verified() RETURNS TRIGGER AS $$
DECLARE
  v_session RECORD;
  accepted_count INT;
BEGIN
  IF NEW.state = 'verified' THEN
    -- Check 1: Must have last_verification_id and valid_until
    IF NEW.last_verification_id IS NULL OR NEW.valid_until IS NULL THEN
      RAISE EXCEPTION 'Database invariant violation: Verified skills require last_verification_id and valid_until.';
    END IF;

    -- Check 2: Verification session must exist, belong to this student_skill, and have outcome = 'passed'
    SELECT * INTO v_session
    FROM verification_sessions
    WHERE id = NEW.last_verification_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Database invariant violation: Verification session % does not exist.', NEW.last_verification_id;
    END IF;

    IF v_session.student_skill_id != NEW.id THEN
      RAISE EXCEPTION 'Database invariant violation: Verification session % belongs to student_skill %, not %.', 
        NEW.last_verification_id, v_session.student_skill_id, NEW.id;
    END IF;

    IF v_session.outcome != 'passed' THEN
      RAISE EXCEPTION 'Database invariant violation: Verification session % outcome is %, expected passed.', 
        NEW.last_verification_id, v_session.outcome;
    END IF;

    -- Check 3: Must have at least one accepted evidence item belonging to the SAME student and linked to THIS student_skill
    SELECT COUNT(*) INTO accepted_count
    FROM skill_evidence se
    JOIN evidence_items ei ON ei.id = se.evidence_id
    WHERE se.student_skill_id = NEW.id
      AND ei.student_id = NEW.student_id
      AND ei.status = 'accepted';

    IF accepted_count = 0 THEN
      RAISE EXCEPTION 'Database invariant violation: Cannot set skill state to verified without qualifying accepted evidence belonging to the student.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_verify_skill_evidence ON student_skills;
CREATE TRIGGER trg_verify_skill_evidence
BEFORE INSERT OR UPDATE ON student_skills
FOR EACH ROW EXECUTE FUNCTION verify_skill_evidence_before_verified();

-- Trigger 4C: Audit immutability trigger
CREATE OR REPLACE FUNCTION prevent_audit_tampering() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_events is append-only: UPDATE and DELETE operations are strictly prohibited.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_events_immutable ON audit_events;
CREATE TRIGGER trg_audit_events_immutable
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_audit_tampering();

-- 5. Least-Privilege Role Grants (No indiscriminate ALL grants)
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_api, ai_worker, fairness_job;

-- app_api grants:
GRANT USAGE ON SCHEMA public TO app_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON 
    organizations, departments, memberships, students, academic_records,
    consent_grants, guardian_consents, data_requests, connected_accounts,
    repositories, repo_snapshots, evidence_items, student_skills, skill_evidence,
    attestations, skill_state_events, verification_sessions, verification_questions,
    probe_runs, human_reviews, companies, job_roles, job_role_skills, drives,
    eligibility_rule_sets, eligibility_rule_versions, eligibility_decisions,
    eligibility_overrides, recruiter_access_grants, applications, student_outcomes,
    proposals, fairness_simulations
TO app_api;

GRANT SELECT ON consent_purposes, skills, rubric_versions, probe_definitions TO app_api;
GRANT SELECT, INSERT ON audit_events TO app_api; -- Strictly NO UPDATE, NO DELETE
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_api;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_api;

-- ai_worker grants (Least Privilege: Read evidence/taxonomy, insert proposals/agent_runs ONLY):
GRANT USAGE ON SCHEMA public TO ai_worker;
GRANT SELECT ON repositories, repo_snapshots, evidence_items, skills, rubric_versions, job_roles, job_role_skills TO ai_worker;
GRANT INSERT ON proposals, agent_runs TO ai_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ai_worker;

-- fairness_job grants:
GRANT USAGE ON SCHEMA public TO fairness_job;
GRANT SELECT ON students, student_group_attributes, drives, eligibility_decisions, eligibility_rule_versions TO fairness_job;
GRANT SELECT, INSERT, UPDATE ON fairness_reviews, fairness_simulations TO fairness_job;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fairness_job;
