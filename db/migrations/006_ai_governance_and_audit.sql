-- ==============================================================================
-- PRAMAAN MIGRATION 006: AI GOVERNANCE, PROPOSALS AND CRYPTOGRAPHIC AUDIT
-- ==============================================================================

-- Agent Runs Log
CREATE TABLE IF NOT EXISTS agent_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    agent_name VARCHAR(50) NOT NULL,
    model_version VARCHAR(50) NOT NULL,
    prompt_version VARCHAR(30) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'completed',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Inert Proposals (The ONLY table AI workers may insert into)
CREATE TABLE IF NOT EXISTS proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    kind VARCHAR(50) NOT NULL CHECK (kind IN ('slot_allocation', 'jd_skills', 'intervention_recommendation', 'support_candidate')),
    payload JSONB NOT NULL,
    validation_result JSONB NOT NULL DEFAULT '{"valid": true}'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'applied', 'expired')),
    decided_by UUID REFERENCES memberships(id),
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Cryptographically Hash-Chained Audit Ledger
CREATE TABLE IF NOT EXISTS audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seq BIGSERIAL,
    org_id UUID NOT NULL REFERENCES organizations(id),
    actor_type VARCHAR(30) NOT NULL,
    actor_id UUID,
    action VARCHAR(100) NOT NULL,
    object_type VARCHAR(50) NOT NULL,
    object_id UUID,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    prev_hash VARCHAR(64) NOT NULL,
    hash VARCHAR(64) NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_events_seq ON audit_events (seq);
CREATE INDEX IF NOT EXISTS idx_audit_events_org ON audit_events (org_id);

-- Fairness Reviews & Audits
CREATE TABLE IF NOT EXISTS fairness_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    drive_id UUID NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
    dimension VARCHAR(30) NOT NULL CHECK (dimension IN ('gender', 'category', 'branch')),
    rule_version_id UUID NOT NULL REFERENCES eligibility_rule_versions(id),
    highest_selection_rate NUMERIC(5,4) NOT NULL,
    group_metrics JSONB NOT NULL,
    adverse_impact_detected BOOLEAN NOT NULL DEFAULT FALSE,
    reviewed_by UUID REFERENCES memberships(id),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cleared', 'flagged_for_hearing')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Fairness Simulations (Logged What-If previews)
CREATE TABLE IF NOT EXISTS fairness_simulations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    candidate_rules JSONB NOT NULL,
    summary JSONB NOT NULL,
    created_by UUID NOT NULL REFERENCES memberships(id),
    simulated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

