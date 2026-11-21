-- Practice-drive test integrity: the browser sends rule events (left the tab, left full screen, face not visible,
-- looked away, phone visible). Only events are stored. Camera video is analysed on the student's device and is never uploaded.
CREATE TABLE IF NOT EXISTS mock_proctor_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID NOT NULL REFERENCES mock_attempts(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    kind VARCHAR(40) NOT NULL,
    seconds INT CHECK (seconds IS NULL OR seconds BETWEEN 0 AND 86400),
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mock_proctor_events_attempt ON mock_proctor_events (attempt_id, occurred_at);

ALTER TABLE mock_proctor_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE mock_proctor_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_mock_proctor_events ON mock_proctor_events;
CREATE POLICY tenant_isolation_mock_proctor_events ON mock_proctor_events FOR ALL
    USING (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()))
    WITH CHECK (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()));
GRANT SELECT, INSERT ON mock_proctor_events TO app_api;
