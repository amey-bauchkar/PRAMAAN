-- ==============================================================================
-- PRAMAAN MIGRATION 023: JOB DEMAND, OUTREACH, EXTERNAL PROFILES & AGENT GOVERNANCE (v2 B2, B13, B15, AD-05)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS jd_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    source VARCHAR(20) NOT NULL CHECK (source IN ('drive', 'upload', 'dataset')),
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    posted_on DATE NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS jd_skill_mentions (
    jd_id UUID NOT NULL REFERENCES jd_documents(id) ON DELETE CASCADE,
    skill_id UUID NOT NULL REFERENCES skills(id),
    method VARCHAR(20) NOT NULL DEFAULT 'alias_match' CHECK (method IN ('alias_match', 'llm', 'officer')),
    matched_text VARCHAR(120),
    PRIMARY KEY (jd_id, skill_id)
);

CREATE TABLE IF NOT EXISTS outreach_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    created_by UUID REFERENCES memberships(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS outreach_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    template_id UUID NOT NULL REFERENCES outreach_templates(id),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    to_email VARCHAR(255) NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    transport VARCHAR(10) NOT NULL CHECK (transport IN ('smtp', 'outbox')),
    status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'replied')),
    sent_at TIMESTAMPTZ,
    replied_at TIMESTAMPTZ,
    reply_excerpt TEXT,
    created_by UUID REFERENCES memberships(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inbound_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    from_email VARCHAR(255) NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    parsed JSONB,
    proposal_id UUID REFERENCES proposals(id),
    received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- B2: ownership-token linking for platforms without OAuth (LeetCode) or with a public API (Codeforces).
CREATE TABLE IF NOT EXISTS external_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    provider VARCHAR(20) NOT NULL CHECK (provider IN ('leetcode', 'codeforces')),
    handle VARCHAR(100) NOT NULL,
    verification_token VARCHAR(40) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'failed')),
    stats JSONB,
    source VARCHAR(20) NOT NULL DEFAULT 'live' CHECK (source IN ('live', 'demo_fixture')),
    verified_at TIMESTAMPTZ,
    fetched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (student_id, provider)
);

-- B15: one row per agent tool call, alongside the hash-chained audit trail.
CREATE TABLE IF NOT EXISTS agent_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    agent_run_id UUID REFERENCES agent_runs(id) ON DELETE CASCADE,
    agent_name VARCHAR(50) NOT NULL,
    tool VARCHAR(60) NOT NULL,
    input_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    output_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
DROP TRIGGER IF EXISTS trg_agent_actions_append_only ON agent_actions;
CREATE TRIGGER trg_agent_actions_append_only BEFORE UPDATE OR DELETE ON agent_actions
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();

ALTER TABLE proposals ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS rationale TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS target_student_id UUID REFERENCES students(id) ON DELETE CASCADE;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS decision_note TEXT;
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname FROM pg_constraint con
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
     WHERE con.conrelid = 'proposals'::regclass AND con.contype = 'c' AND att.attname = 'kind'
  LOOP
    EXECUTE format('ALTER TABLE proposals DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE proposals ADD CONSTRAINT proposals_kind_check CHECK (kind IN (
  'slot_allocation', 'jd_skills', 'gap_alert', 'intervention_recommendation', 'support_candidate',
  'interview_questions', 'learning_path', 'mail_draft', 'candidate_skills', 'shortlist'
));

CREATE TABLE IF NOT EXISTS mentor_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    mentor_membership_id UUID NOT NULL REFERENCES memberships(id),
    reason TEXT NOT NULL,
    assigned_by UUID NOT NULL REFERENCES memberships(id),
    proposal_id UUID REFERENCES proposals(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RLS ---------------------------------------------------------------------------
ALTER TABLE jd_documents ENABLE ROW LEVEL SECURITY;       ALTER TABLE jd_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE jd_skill_mentions ENABLE ROW LEVEL SECURITY;  ALTER TABLE jd_skill_mentions FORCE ROW LEVEL SECURITY;
ALTER TABLE outreach_templates ENABLE ROW LEVEL SECURITY; ALTER TABLE outreach_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE outreach_messages ENABLE ROW LEVEL SECURITY;  ALTER TABLE outreach_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE inbound_messages ENABLE ROW LEVEL SECURITY;   ALTER TABLE inbound_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE external_profiles ENABLE ROW LEVEL SECURITY;  ALTER TABLE external_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE agent_actions ENABLE ROW LEVEL SECURITY;      ALTER TABLE agent_actions FORCE ROW LEVEL SECURITY;
ALTER TABLE mentor_assignments ENABLE ROW LEVEL SECURITY; ALTER TABLE mentor_assignments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_jd_documents ON jd_documents;
CREATE POLICY tenant_isolation_jd_documents ON jd_documents FOR ALL USING (org_id = current_app_org_id()) WITH CHECK (org_id = current_app_org_id());
DROP POLICY IF EXISTS tenant_isolation_jd_skill_mentions ON jd_skill_mentions;
CREATE POLICY tenant_isolation_jd_skill_mentions ON jd_skill_mentions FOR ALL
    USING (jd_id IN (SELECT id FROM jd_documents WHERE org_id = current_app_org_id()))
    WITH CHECK (jd_id IN (SELECT id FROM jd_documents WHERE org_id = current_app_org_id()));
DROP POLICY IF EXISTS tenant_isolation_outreach_templates ON outreach_templates;
CREATE POLICY tenant_isolation_outreach_templates ON outreach_templates FOR ALL USING (org_id = current_app_org_id()) WITH CHECK (org_id = current_app_org_id());
DROP POLICY IF EXISTS tenant_isolation_outreach_messages ON outreach_messages;
CREATE POLICY tenant_isolation_outreach_messages ON outreach_messages FOR ALL USING (org_id = current_app_org_id()) WITH CHECK (org_id = current_app_org_id());
DROP POLICY IF EXISTS tenant_isolation_inbound_messages ON inbound_messages;
CREATE POLICY tenant_isolation_inbound_messages ON inbound_messages FOR ALL USING (org_id = current_app_org_id()) WITH CHECK (org_id = current_app_org_id());
DROP POLICY IF EXISTS tenant_isolation_external_profiles ON external_profiles;
CREATE POLICY tenant_isolation_external_profiles ON external_profiles FOR ALL
    USING (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()))
    WITH CHECK (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()));
DROP POLICY IF EXISTS tenant_isolation_agent_actions ON agent_actions;
CREATE POLICY tenant_isolation_agent_actions ON agent_actions FOR ALL USING (org_id = current_app_org_id()) WITH CHECK (org_id = current_app_org_id());
DROP POLICY IF EXISTS tenant_isolation_mentor_assignments ON mentor_assignments;
CREATE POLICY tenant_isolation_mentor_assignments ON mentor_assignments FOR ALL
    USING (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()))
    WITH CHECK (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON jd_documents, jd_skill_mentions, outreach_templates, outreach_messages, inbound_messages, external_profiles TO app_api;
GRANT SELECT, INSERT ON agent_actions, mentor_assignments, agent_runs TO app_api;
GRANT SELECT, INSERT ON agent_actions, agent_runs TO ai_worker;
