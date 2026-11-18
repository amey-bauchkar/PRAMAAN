-- ==============================================================================
-- PRAMAAN MIGRATION 022: MOCK DRIVES, JUDGE RUNS, LIVE PROBES & LEARNING PATHS (v2 B3, B4, B14)
-- ==============================================================================
-- Question banks may be global (org_id NULL, read-only to tenants) or college-owned.
-- Hidden test cases of coding problems are never returned to students by the API.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS aptitude_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    topic VARCHAR(30) NOT NULL CHECK (topic IN ('quantitative', 'logical', 'verbal')),
    subtopic VARCHAR(60) NOT NULL,
    difficulty INT NOT NULL CHECK (difficulty BETWEEN 1 AND 3),
    stem TEXT NOT NULL,
    options JSONB NOT NULL,
    answer_index INT NOT NULL CHECK (answer_index BETWEEN 0 AND 4),
    explanation TEXT NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS coding_problems (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    slug VARCHAR(80) NOT NULL,
    title VARCHAR(200) NOT NULL,
    statement TEXT NOT NULL,
    entry_function VARCHAR(80) NOT NULL,
    starter_code JSONB NOT NULL DEFAULT '{}'::jsonb,
    public_tests JSONB NOT NULL DEFAULT '[]'::jsonb,
    hidden_tests JSONB NOT NULL DEFAULT '[]'::jsonb,
    language VARCHAR(20) NOT NULL DEFAULT 'javascript' CHECK (language IN ('javascript', 'sql')),
    -- Used by the judge to compute expected results for hidden tests (never returned to students).
    reference_solution TEXT,
    -- For SQL problems: schema created before each test's own setup statements.
    sql_schema TEXT,
    marks INT NOT NULL DEFAULT 10 CHECK (marks > 0),
    topics TEXT[] NOT NULL DEFAULT '{}',
    skill_slugs TEXT[] NOT NULL DEFAULT '{}',
    difficulty INT NOT NULL DEFAULT 2 CHECK (difficulty BETWEEN 1 AND 3),
    status VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_coding_problems_slug ON coding_problems (COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);

CREATE TABLE IF NOT EXISTS interview_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role_title VARCHAR(120) NOT NULL,
    topic VARCHAR(80) NOT NULL,
    question TEXT NOT NULL,
    key_points JSONB NOT NULL DEFAULT '[]'::jsonb,
    status VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'retired')),
    drafted_by VARCHAR(10) NOT NULL DEFAULT 'officer' CHECK (drafted_by IN ('agent', 'officer')),
    approved_by UUID REFERENCES memberships(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_interview_question_approved CHECK (status <> 'approved' OR approved_by IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS mock_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    role_title VARCHAR(120) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
    aptitude_question_ids UUID[] NOT NULL,
    coding_problem_ids UUID[] NOT NULL,
    interview_question_ids UUID[] NOT NULL,
    report JSONB,
    started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS mock_round_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID NOT NULL REFERENCES mock_attempts(id) ON DELETE CASCADE,
    round VARCHAR(20) NOT NULL CHECK (round IN ('aptitude', 'machine_test', 'interview')),
    score NUMERIC(6,2) NOT NULL,
    max_score NUMERIC(6,2) NOT NULL CHECK (max_score > 0),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (attempt_id, round)
);

CREATE TABLE IF NOT EXISTS judge_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    purpose VARCHAR(20) NOT NULL CHECK (purpose IN ('mock', 'probe', 'learning_task')),
    ref_id UUID,
    language VARCHAR(20) NOT NULL,
    code TEXT NOT NULL,
    passed INT NOT NULL,
    total INT NOT NULL,
    results JSONB NOT NULL,
    runner VARCHAR(30) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Live Mutation Probe: a challenge anchored to an exact span of the student's own code.
ALTER TABLE probe_definitions ADD COLUMN IF NOT EXISTS student_id UUID REFERENCES students(id) ON DELETE CASCADE;
ALTER TABLE probe_definitions ADD COLUMN IF NOT EXISTS commit_sha VARCHAR(40);
ALTER TABLE probe_definitions ADD COLUMN IF NOT EXISTS file_path VARCHAR(500);
ALTER TABLE probe_definitions ADD COLUMN IF NOT EXISTS line_start INT;
ALTER TABLE probe_definitions ADD COLUMN IF NOT EXISTS line_end INT;
ALTER TABLE probe_definitions ADD COLUMN IF NOT EXISTS code_span TEXT;
ALTER TABLE probe_definitions ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64);
ALTER TABLE probe_definitions ADD COLUMN IF NOT EXISTS predict_question TEXT;
ALTER TABLE probe_definitions ADD COLUMN IF NOT EXISTS predict_key_points JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE probe_definitions ADD COLUMN IF NOT EXISTS mutation_task TEXT;
ALTER TABLE probe_definitions ADD COLUMN IF NOT EXISTS provenance VARCHAR(30) NOT NULL DEFAULT 'trusted_ingestion_pipeline'
    CHECK (provenance IN ('trusted_ingestion_pipeline', 'preloaded_demo_snapshot'));

CREATE TABLE IF NOT EXISTS learning_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    slug VARCHAR(80) NOT NULL,
    skill_id UUID NOT NULL REFERENCES skills(id),
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    kind VARCHAR(20) NOT NULL CHECK (kind IN ('coding', 'project', 'mentor_review')),
    coding_problem_id UUID REFERENCES coding_problems(id),
    target_proof VARCHAR(2) NOT NULL CHECK (target_proof IN ('L1', 'L2', 'L3')),
    est_hours NUMERIC(4,1) NOT NULL DEFAULT 2,
    weak_topics TEXT[] NOT NULL DEFAULT '{}',
    CONSTRAINT chk_coding_task_has_problem CHECK (kind <> 'coding' OR coding_problem_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_learning_tasks_slug ON learning_tasks (COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);

CREATE TABLE IF NOT EXISTS learning_paths (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    target_role VARCHAR(120) NOT NULL,
    rationale JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_learning_path ON learning_paths (student_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS learning_path_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    path_id UUID NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES learning_tasks(id),
    position INT NOT NULL,
    reason TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'submitted', 'passed', 'failed')),
    evidence_id UUID REFERENCES evidence_items(id),
    completed_at TIMESTAMPTZ,
    UNIQUE (path_id, task_id)
);

-- RLS ---------------------------------------------------------------------------
ALTER TABLE aptitude_questions ENABLE ROW LEVEL SECURITY;  ALTER TABLE aptitude_questions FORCE ROW LEVEL SECURITY;
ALTER TABLE coding_problems ENABLE ROW LEVEL SECURITY;     ALTER TABLE coding_problems FORCE ROW LEVEL SECURITY;
ALTER TABLE interview_questions ENABLE ROW LEVEL SECURITY; ALTER TABLE interview_questions FORCE ROW LEVEL SECURITY;
ALTER TABLE mock_attempts ENABLE ROW LEVEL SECURITY;       ALTER TABLE mock_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE mock_round_results ENABLE ROW LEVEL SECURITY;  ALTER TABLE mock_round_results FORCE ROW LEVEL SECURITY;
ALTER TABLE judge_runs ENABLE ROW LEVEL SECURITY;          ALTER TABLE judge_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE learning_tasks ENABLE ROW LEVEL SECURITY;      ALTER TABLE learning_tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE learning_paths ENABLE ROW LEVEL SECURITY;      ALTER TABLE learning_paths FORCE ROW LEVEL SECURITY;
ALTER TABLE learning_path_items ENABLE ROW LEVEL SECURITY; ALTER TABLE learning_path_items FORCE ROW LEVEL SECURITY;

-- Shared banks: tenants read global + own rows, write only their own.
DROP POLICY IF EXISTS bank_read_aptitude ON aptitude_questions;
CREATE POLICY bank_read_aptitude ON aptitude_questions FOR SELECT USING (org_id IS NULL OR org_id = current_app_org_id());
DROP POLICY IF EXISTS bank_write_aptitude ON aptitude_questions;
CREATE POLICY bank_write_aptitude ON aptitude_questions FOR ALL USING (org_id = current_app_org_id()) WITH CHECK (org_id = current_app_org_id());
DROP POLICY IF EXISTS bank_read_coding ON coding_problems;
CREATE POLICY bank_read_coding ON coding_problems FOR SELECT USING (org_id IS NULL OR org_id = current_app_org_id());
DROP POLICY IF EXISTS bank_write_coding ON coding_problems;
CREATE POLICY bank_write_coding ON coding_problems FOR ALL USING (org_id = current_app_org_id()) WITH CHECK (org_id = current_app_org_id());
DROP POLICY IF EXISTS bank_read_tasks ON learning_tasks;
CREATE POLICY bank_read_tasks ON learning_tasks FOR SELECT USING (org_id IS NULL OR org_id = current_app_org_id());
DROP POLICY IF EXISTS bank_write_tasks ON learning_tasks;
CREATE POLICY bank_write_tasks ON learning_tasks FOR ALL USING (org_id = current_app_org_id()) WITH CHECK (org_id = current_app_org_id());

DROP POLICY IF EXISTS tenant_isolation_interview_questions ON interview_questions;
CREATE POLICY tenant_isolation_interview_questions ON interview_questions FOR ALL
    USING (org_id = current_app_org_id()) WITH CHECK (org_id = current_app_org_id());

DROP POLICY IF EXISTS tenant_isolation_mock_attempts ON mock_attempts;
CREATE POLICY tenant_isolation_mock_attempts ON mock_attempts FOR ALL
    USING (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()))
    WITH CHECK (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()));
DROP POLICY IF EXISTS tenant_isolation_mock_round_results ON mock_round_results;
CREATE POLICY tenant_isolation_mock_round_results ON mock_round_results FOR ALL
    USING (attempt_id IN (SELECT m.id FROM mock_attempts m JOIN students s ON s.id = m.student_id WHERE s.org_id = current_app_org_id()))
    WITH CHECK (attempt_id IN (SELECT m.id FROM mock_attempts m JOIN students s ON s.id = m.student_id WHERE s.org_id = current_app_org_id()));
DROP POLICY IF EXISTS tenant_isolation_judge_runs ON judge_runs;
CREATE POLICY tenant_isolation_judge_runs ON judge_runs FOR ALL
    USING (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()))
    WITH CHECK (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()));
DROP POLICY IF EXISTS tenant_isolation_learning_paths ON learning_paths;
CREATE POLICY tenant_isolation_learning_paths ON learning_paths FOR ALL
    USING (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()))
    WITH CHECK (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()));
DROP POLICY IF EXISTS tenant_isolation_learning_path_items ON learning_path_items;
CREATE POLICY tenant_isolation_learning_path_items ON learning_path_items FOR ALL
    USING (path_id IN (SELECT p.id FROM learning_paths p JOIN students s ON s.id = p.student_id WHERE s.org_id = current_app_org_id()))
    WITH CHECK (path_id IN (SELECT p.id FROM learning_paths p JOIN students s ON s.id = p.student_id WHERE s.org_id = current_app_org_id()));

-- probe_definitions was a global catalog (006b); student-specific probes are now tenant-scoped.
DROP POLICY IF EXISTS read_catalog_probe_definitions ON probe_definitions;
CREATE POLICY read_catalog_probe_definitions ON probe_definitions FOR SELECT
    USING (student_id IS NULL OR student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()));

GRANT SELECT, INSERT, UPDATE ON aptitude_questions, coding_problems, interview_questions, learning_tasks TO app_api;
GRANT SELECT, INSERT, UPDATE ON mock_attempts, mock_round_results, learning_paths, learning_path_items TO app_api;
GRANT SELECT, INSERT ON judge_runs TO app_api;

-- Every evidence item says what it is and where it came from (shown on the profile and Evidence Card).
ALTER TABLE evidence_items ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE evidence_items ADD COLUMN IF NOT EXISTS source VARCHAR(30);
-- Students upload lab work, certificates and contest results for mentor review (status 'submitted').
ALTER TABLE evidence_items ADD COLUMN IF NOT EXISTS claimed_skill_id UUID REFERENCES skills(id);
ALTER TABLE evidence_items ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES memberships(id);
ALTER TABLE evidence_items ADD COLUMN IF NOT EXISTS review_note TEXT;
