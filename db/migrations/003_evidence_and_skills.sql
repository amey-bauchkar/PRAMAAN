-- ==============================================================================
-- PRAMAAN MIGRATION 003: EVIDENCE AND SKILLS GRAPH
-- ==============================================================================

-- Connected Accounts (Encrypted Tokens at rest)
CREATE TABLE IF NOT EXISTS connected_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    provider VARCHAR(30) NOT NULL DEFAULT 'github',
    installation_ref VARCHAR(255) NOT NULL,
    token_ref VARCHAR(255) NOT NULL, -- Pointer to secure key vault / encrypted blob
    scope JSONB NOT NULL DEFAULT '["repo:read"]'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    connected_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (student_id, provider)
);

-- Repositories (Only consented selected repos)
CREATE TABLE IF NOT EXISTS repositories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    provider VARCHAR(30) NOT NULL DEFAULT 'github',
    provider_repo_id VARCHAR(100) NOT NULL,
    url VARCHAR(500) NOT NULL,
    default_branch VARCHAR(100) NOT NULL DEFAULT 'main',
    consent_grant_id UUID NOT NULL REFERENCES consent_grants(id),
    imported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Immutable Repo Snapshots
CREATE TABLE IF NOT EXISTS repo_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    commit_sha VARCHAR(64) NOT NULL,
    parser_version VARCHAR(30) NOT NULL,
    tree_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (repository_id, commit_sha)
);

-- Canonical Skills
CREATE TABLE IF NOT EXISTS skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_name VARCHAR(100) NOT NULL UNIQUE,
    category VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    level_definitions JSONB NOT NULL DEFAULT '{"1": "Novice", "2": "Competent", "3": "Proficient"}'::jsonb,
    taxonomy_version VARCHAR(20) NOT NULL DEFAULT '1.0'
);

-- Evidence Items
CREATE TABLE IF NOT EXISTS evidence_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    kind VARCHAR(30) NOT NULL CHECK (kind IN ('code_span', 'commit', 'test_result', 'lab', 'competition', 'certificate', 'mentor_attestation', 'external_profile')),
    repo_snapshot_id UUID REFERENCES repo_snapshots(id),
    path VARCHAR(500),
    line_start INT,
    line_end INT,
    content_hash VARCHAR(64) NOT NULL,
    object_key VARCHAR(500),
    status VARCHAR(20) NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'accepted', 'rejected', 'withdrawn', 'expired')),
    accepted_by UUID REFERENCES memberships(id),
    accepted_at TIMESTAMPTZ,
    valid_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Student Skills
CREATE TABLE IF NOT EXISTS student_skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    state VARCHAR(20) NOT NULL DEFAULT 'claimed' CHECK (state IN ('claimed', 'observed', 'evidence_linked', 'verified', 'expired')),
    state_since TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    valid_until TIMESTAMPTZ,
    evidence_strength VARCHAR(10) NOT NULL DEFAULT 'low' CHECK (evidence_strength IN ('low', 'medium', 'high')),
    last_verification_id UUID,
    UNIQUE (student_id, skill_id)
);

-- Skill Evidence Link
CREATE TABLE IF NOT EXISTS skill_evidence (
    student_skill_id UUID NOT NULL REFERENCES student_skills(id) ON DELETE CASCADE,
    evidence_id UUID NOT NULL REFERENCES evidence_items(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'supports' CHECK (role IN ('supports', 'context')),
    PRIMARY KEY (student_skill_id, evidence_id)
);

-- Faculty Mentor Attestations
CREATE TABLE IF NOT EXISTS attestations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    evidence_id UUID NOT NULL REFERENCES evidence_items(id) ON DELETE CASCADE,
    mentor_membership_id UUID NOT NULL REFERENCES memberships(id),
    rubric_version_id UUID NOT NULL,
    scope_text TEXT NOT NULL,
    rubric_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
    valid_until TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- State Transition Events
CREATE TABLE IF NOT EXISTS skill_state_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_skill_id UUID NOT NULL REFERENCES student_skills(id) ON DELETE CASCADE,
    from_state VARCHAR(20) NOT NULL,
    to_state VARCHAR(20) NOT NULL,
    reason_code VARCHAR(50) NOT NULL,
    actor_type VARCHAR(20) NOT NULL CHECK (actor_type IN ('student', 'mentor', 'officer', 'evaluator_service', 'expiry_cron')),
    actor_id UUID,
    verification_id UUID,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

