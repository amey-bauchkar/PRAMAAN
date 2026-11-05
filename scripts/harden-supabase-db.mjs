import { runQuery } from './supabase-runner.mjs';

async function hardenDatabase() {
  console.log('[HARDENING] Hardening Supabase PostgreSQL database...');

  const sql = `
    -- 1. Ensure RLS on all remaining tables
    ALTER TABLE connected_accounts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE connected_accounts FORCE ROW LEVEL SECURITY;

    ALTER TABLE consent_grants ENABLE ROW LEVEL SECURITY;
    ALTER TABLE consent_grants FORCE ROW LEVEL SECURITY;

    ALTER TABLE guardian_consents ENABLE ROW LEVEL SECURITY;
    ALTER TABLE guardian_consents FORCE ROW LEVEL SECURITY;

    ALTER TABLE data_requests ENABLE ROW LEVEL SECURITY;
    ALTER TABLE data_requests FORCE ROW LEVEL SECURITY;

    ALTER TABLE student_group_attributes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE student_group_attributes FORCE ROW LEVEL SECURITY;

    ALTER TABLE student_outcomes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE student_outcomes FORCE ROW LEVEL SECURITY;

    ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
    ALTER TABLE applications FORCE ROW LEVEL SECURITY;

    ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
    ALTER TABLE companies FORCE ROW LEVEL SECURITY;

    ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE agent_runs FORCE ROW LEVEL SECURITY;

    ALTER TABLE fairness_reviews ENABLE ROW LEVEL SECURITY;
    ALTER TABLE fairness_reviews FORCE ROW LEVEL SECURITY;

    ALTER TABLE fairness_simulations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE fairness_simulations FORCE ROW LEVEL SECURITY;

    ALTER TABLE recruiter_access_grants ENABLE ROW LEVEL SECURITY;
    ALTER TABLE recruiter_access_grants FORCE ROW LEVEL SECURITY;

    -- Add isolation policies for new tables
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tenant_isolation_companies') THEN
        CREATE POLICY tenant_isolation_companies ON companies
          FOR ALL USING (org_id = current_app_org_id()) WITH CHECK (org_id = current_app_org_id());
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tenant_isolation_consent_grants') THEN
        CREATE POLICY tenant_isolation_consent_grants ON consent_grants
          FOR ALL USING (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()));
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tenant_isolation_connected_accounts') THEN
        CREATE POLICY tenant_isolation_connected_accounts ON connected_accounts
          FOR ALL USING (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()));
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tenant_isolation_student_group_attributes') THEN
        CREATE POLICY tenant_isolation_student_group_attributes ON student_group_attributes
          FOR ALL USING (
            student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id())
            AND current_app_user_role() IN ('fairness_job', 'platform_admin')
          );
      END IF;
    END $$;

    -- 2. Audit Immutability Trigger
    CREATE OR REPLACE FUNCTION prevent_audit_tampering() RETURNS TRIGGER AS $$
    BEGIN
        RAISE EXCEPTION 'audit_events is append-only: UPDATE and DELETE operations are strictly prohibited.';
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_audit_events_immutable ON audit_events;
    CREATE TRIGGER trg_audit_events_immutable
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_tampering();

    -- 3. Skill State Database-Level Check Constraint
    ALTER TABLE student_skills DROP CONSTRAINT IF EXISTS chk_verified_skill_requirements;
    ALTER TABLE student_skills ADD CONSTRAINT chk_verified_skill_requirements
      CHECK (state != 'verified' OR (last_verification_id IS NOT NULL AND valid_until IS NOT NULL));

    -- 4. Skill State Database-Level Verification Trigger
    CREATE OR REPLACE FUNCTION verify_skill_evidence_before_verified() RETURNS TRIGGER AS $$
    DECLARE
      accepted_count INT;
    BEGIN
      IF NEW.state = 'verified' THEN
        SELECT COUNT(*) INTO accepted_count
        FROM skill_evidence se
        JOIN evidence_items ei ON ei.id = se.evidence_id
        WHERE se.student_skill_id = NEW.id AND ei.status = 'accepted';

        IF accepted_count = 0 THEN
          RAISE EXCEPTION 'Database invariant violation: Cannot set skill state to verified without at least one accepted evidence item linked.';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_verify_skill_evidence ON student_skills;
    CREATE TRIGGER trg_verify_skill_evidence
    BEFORE INSERT OR UPDATE ON student_skills
    FOR EACH ROW EXECUTE FUNCTION verify_skill_evidence_before_verified();
  `;

  await runQuery(sql);
  console.log('[HARDENING] Database hardened successfully!');
}

hardenDatabase().catch(err => {
  console.error('[HARDENING FAILED]', err);
  process.exit(1);
});

