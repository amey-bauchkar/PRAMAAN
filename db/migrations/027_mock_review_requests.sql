-- A student can ask a person to review an interview score; a placement officer or mentor decides, with a note.
CREATE TABLE IF NOT EXISTS mock_review_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID NOT NULL REFERENCES mock_attempts(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'revised', 'kept')),
    previous_score NUMERIC(5,1),
    revised_score NUMERIC(5,1),
    decision_note TEXT,
    decided_by UUID REFERENCES memberships(id),
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mock_review_pending ON mock_review_requests (attempt_id) WHERE status = 'pending';

ALTER TABLE mock_review_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE mock_review_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_mock_review_requests ON mock_review_requests;
CREATE POLICY tenant_isolation_mock_review_requests ON mock_review_requests FOR ALL
    USING (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()))
    WITH CHECK (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()));
GRANT SELECT, INSERT, UPDATE ON mock_review_requests TO app_api;
