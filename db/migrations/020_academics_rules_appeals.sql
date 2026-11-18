-- ==============================================================================
-- PRAMAAN MIGRATION 020: ACADEMICS, DRIVE RULES & APPEALS (v2 audit B6, B7)
-- ==============================================================================
-- B6  Indian drive criteria: 10th / 12th / diploma marks, gap years, backlog history, disciplinary hold.
-- B7  Students can appeal an eligibility decision; officers resolve it with a recorded reason.
-- Drives point at the rule version they are evaluated with.
-- ==============================================================================

ALTER TABLE academic_records ADD COLUMN IF NOT EXISTS tenth_pct NUMERIC(5,2) CHECK (tenth_pct BETWEEN 0 AND 100);
ALTER TABLE academic_records ADD COLUMN IF NOT EXISTS twelfth_pct NUMERIC(5,2) CHECK (twelfth_pct BETWEEN 0 AND 100);
ALTER TABLE academic_records ADD COLUMN IF NOT EXISTS diploma_pct NUMERIC(5,2) CHECK (diploma_pct BETWEEN 0 AND 100);
ALTER TABLE academic_records ADD COLUMN IF NOT EXISTS gap_years INT CHECK (gap_years >= 0);
ALTER TABLE academic_records ADD COLUMN IF NOT EXISTS backlog_history INT CHECK (backlog_history >= 0);
ALTER TABLE students ADD COLUMN IF NOT EXISTS disciplinary_hold BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE drives ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES job_roles(id);
ALTER TABLE drives ADD COLUMN IF NOT EXISTS rule_set_id UUID REFERENCES eligibility_rule_sets(id);
ALTER TABLE drives ADD COLUMN IF NOT EXISTS rule_version_id UUID REFERENCES eligibility_rule_versions(id);
ALTER TABLE drives ADD COLUMN IF NOT EXISTS ctc_inr NUMERIC(12,2);
ALTER TABLE drives ADD COLUMN IF NOT EXISTS decisions_published_at TIMESTAMPTZ;

-- Rule versions are immutable once written: a change is a new version.
CREATE OR REPLACE FUNCTION prevent_rule_version_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Eligibility rule versions are immutable; publish a new version instead.';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_rule_versions_immutable ON eligibility_rule_versions;
CREATE TRIGGER trg_rule_versions_immutable BEFORE UPDATE OR DELETE ON eligibility_rule_versions
FOR EACH ROW EXECUTE FUNCTION prevent_rule_version_mutation();

CREATE TABLE IF NOT EXISTS eligibility_appeals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    decision_id UUID NOT NULL REFERENCES eligibility_decisions(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    reason TEXT NOT NULL CHECK (length(trim(reason)) >= 10),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'upheld', 'overturned', 'withdrawn')),
    decided_by UUID REFERENCES memberships(id),
    decision_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    due_at TIMESTAMPTZ NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '3 days'),
    decided_at TIMESTAMPTZ,
    CONSTRAINT chk_appeal_decided CHECK (status IN ('pending', 'withdrawn') OR (decided_by IS NOT NULL AND decision_note IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_open_appeal_per_decision ON eligibility_appeals (decision_id) WHERE status = 'pending';

ALTER TABLE eligibility_appeals ENABLE ROW LEVEL SECURITY;
ALTER TABLE eligibility_appeals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_eligibility_appeals ON eligibility_appeals;
CREATE POLICY tenant_isolation_eligibility_appeals ON eligibility_appeals FOR ALL
    USING (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()))
    WITH CHECK (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()));
GRANT SELECT, INSERT, UPDATE ON eligibility_appeals TO app_api;
