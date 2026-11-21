-- Practice-drive code checks that judge the work, not the student's behaviour, so they apply to every student:
--  1. similarity to other students' submissions (needs the problem on each saved judge run), and
--  2. a short "defend your answer" follow-up: what does your own code do on a test input you never saw?
ALTER TABLE judge_runs ADD COLUMN IF NOT EXISTS problem_id UUID;
CREATE INDEX IF NOT EXISTS idx_judge_runs_mock_problem ON judge_runs (problem_id, created_at DESC) WHERE purpose = 'mock';

CREATE TABLE IF NOT EXISTS mock_defence_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID NOT NULL REFERENCES mock_attempts(id) ON DELETE CASCADE,
    problem_id UUID NOT NULL,
    kind VARCHAR(4) NOT NULL CHECK (kind IN ('js', 'sql')),
    entry VARCHAR(80),
    code TEXT NOT NULL,                 -- the student's own submitted code, shown back to them
    args JSONB,                         -- JavaScript: the call to trace
    setup TEXT,                         -- SQL: the data the query runs on
    expected JSONB NOT NULL,            -- never sent to the browser
    deadline_at TIMESTAMPTZ,            -- set when the last round ends, so the clock starts then
    answer TEXT,
    correct BOOLEAN,
    answered_at TIMESTAMPTZ,
    UNIQUE (attempt_id, problem_id)
);

ALTER TABLE mock_defence_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE mock_defence_checks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_mock_defence_checks ON mock_defence_checks;
CREATE POLICY tenant_isolation_mock_defence_checks ON mock_defence_checks FOR ALL
    USING (attempt_id IN (SELECT m.id FROM mock_attempts m JOIN students s ON s.id = m.student_id WHERE s.org_id = current_app_org_id()))
    WITH CHECK (attempt_id IN (SELECT m.id FROM mock_attempts m JOIN students s ON s.id = m.student_id WHERE s.org_id = current_app_org_id()));
GRANT SELECT, INSERT, UPDATE ON mock_defence_checks TO app_api;
