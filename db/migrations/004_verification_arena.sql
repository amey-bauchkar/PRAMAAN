-- ==============================================================================
-- PRAMAAN MIGRATION 004: VERIFICATION ARENA AND LIVE PROBES
-- ==============================================================================

-- Rubric Versions
CREATE TABLE IF NOT EXISTS rubric_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    version_no INT NOT NULL,
    dimensions JSONB NOT NULL,
    levels JSONB NOT NULL,
    published_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (skill_id, version_no)
);

-- Verification Sessions
CREATE TABLE IF NOT EXISTS verification_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_skill_id UUID NOT NULL REFERENCES student_skills(id) ON DELETE CASCADE,
    rubric_version_id UUID NOT NULL REFERENCES rubric_versions(id),
    modality VARCHAR(30) NOT NULL CHECK (modality IN ('defence', 'probe', 'mentor', 'test_score')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ,
    outcome VARCHAR(30) CHECK (outcome IN ('passed', 'failed', 'inconclusive_review_required'))
);

-- Verification Grounded Questions
CREATE TABLE IF NOT EXISTS verification_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES verification_sessions(id) ON DELETE CASCADE,
    evidence_id UUID NOT NULL REFERENCES evidence_items(id),
    anchor_snapshot_id UUID REFERENCES repo_snapshots(id),
    question_text TEXT NOT NULL,
    expected_criteria JSONB NOT NULL DEFAULT '[]'::jsonb,
    student_response TEXT,
    evaluator_score NUMERIC(4,2),
    rubric_evaluation JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Probe Definitions (Pre-authored unit test harnesses for pure functions)
CREATE TABLE IF NOT EXISTS probe_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    language VARCHAR(50) NOT NULL,
    entry_function_name VARCHAR(100) NOT NULL,
    test_harness_code TEXT NOT NULL,
    timeout_ms INT NOT NULL DEFAULT 3000,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Probe Runs (Executed in Isolated Runner)
CREATE TABLE IF NOT EXISTS probe_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES verification_sessions(id) ON DELETE CASCADE,
    probe_id UUID NOT NULL REFERENCES probe_definitions(id),
    submitted_code TEXT NOT NULL,
    passed BOOLEAN NOT NULL,
    exit_code INT NOT NULL,
    execution_time_ms INT NOT NULL,
    stdout TEXT,
    stderr TEXT,
    test_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Human Review Escalation Queue
CREATE TABLE IF NOT EXISTS human_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES verification_sessions(id) ON DELETE CASCADE,
    assigned_reviewer_id UUID REFERENCES memberships(id),
    reason VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_review', 'resolved')),
    decision VARCHAR(20) CHECK (decision IN ('approved', 'rejected')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMPTZ
);

