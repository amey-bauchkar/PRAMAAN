-- ==============================================================================
-- PRAMAAN MIGRATION 011: TRUSTED STATIC REPOSITORY INGESTION & DURABLE SNAPSHOTS (P0-04)
-- ==============================================================================

-- 1. GitHub OAuth States (Single-use, time-limited PKCE flow)
CREATE TABLE IF NOT EXISTS github_oauth_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    state VARCHAR(255) UNIQUE NOT NULL,
    code_verifier VARCHAR(255) NOT NULL,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    redirect_uri VARCHAR(1000) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_github_oauth_states_lookup
    ON github_oauth_states (state, org_id);

ALTER TABLE github_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE github_oauth_states FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_github_oauth_states ON github_oauth_states;
CREATE POLICY tenant_isolation_github_oauth_states ON github_oauth_states
    FOR ALL
    USING (org_id = current_app_org_id())
    WITH CHECK (org_id = current_app_org_id());

-- 2. Augment connected_accounts with encrypted tokens and GitHub identity metadata
ALTER TABLE connected_accounts
    ADD COLUMN IF NOT EXISTS github_user_id VARCHAR(100),
    ADD COLUMN IF NOT EXISTS github_username VARCHAR(100),
    ADD COLUMN IF NOT EXISTS encrypted_access_token TEXT,
    ADD COLUMN IF NOT EXISTS encrypted_refresh_token TEXT,
    ADD COLUMN IF NOT EXISTS key_version VARCHAR(20) DEFAULT 'v1',
    ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

-- 3. Durable File-Level Source Snapshots (Immutable, Content-Addressed, Tenant- & Student-Scoped)
CREATE TABLE IF NOT EXISTS source_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id UUID NOT NULL,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    commit_sha VARCHAR(40) NOT NULL,
    file_path VARCHAR(1000) NOT NULL,
    raw_bytes BYTEA NOT NULL,
    raw_file_hash VARCHAR(64) NOT NULL,
    blob_sha VARCHAR(40) NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    provenance VARCHAR(50) NOT NULL DEFAULT 'trusted_ingestion_pipeline'
        CHECK (provenance IN ('unverified_client_input', 'trusted_ingestion_pipeline')),
    ingestion_id UUID NOT NULL,
    registration_state VARCHAR(30) NOT NULL DEFAULT 'pending_audit'
        CHECK (registration_state IN ('pending_audit', 'audit_committed', 'quarantined')),
    UNIQUE (org_id, student_id, repository_id, commit_sha, file_path)
);

CREATE INDEX IF NOT EXISTS idx_source_snapshots_hash
    ON source_snapshots (raw_file_hash, org_id, student_id);

CREATE INDEX IF NOT EXISTS idx_source_snapshots_lookup
    ON source_snapshots (repository_id, commit_sha, org_id, student_id);

ALTER TABLE source_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_snapshots FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_source_snapshots ON source_snapshots;
CREATE POLICY tenant_isolation_source_snapshots ON source_snapshots
    FOR ALL
    USING (org_id = current_app_org_id())
    WITH CHECK (org_id = current_app_org_id());

-- 4. Durable Trusted Ingestion Records (Write-Once Canonical Ingestion Manifests)
CREATE TABLE IF NOT EXISTS trusted_ingestion_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ingestion_id UUID UNIQUE NOT NULL,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    commit_sha VARCHAR(40) NOT NULL,
    tree_sha VARCHAR(40) NOT NULL,
    verified_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    provenance VARCHAR(50) NOT NULL DEFAULT 'trusted_ingestion_pipeline',
    manifest JSONB NOT NULL DEFAULT '[]'::jsonb,
    status VARCHAR(30) NOT NULL DEFAULT 'persisted',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (org_id, repository_id, commit_sha, student_id)
);

CREATE INDEX IF NOT EXISTS idx_trusted_ingestion_lookup
    ON trusted_ingestion_records (org_id, repository_id, commit_sha, student_id);

ALTER TABLE trusted_ingestion_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE trusted_ingestion_records FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_trusted_ingestion_records ON trusted_ingestion_records;
CREATE POLICY tenant_isolation_trusted_ingestion_records ON trusted_ingestion_records
    FOR ALL
    USING (org_id = current_app_org_id())
    WITH CHECK (org_id = current_app_org_id());

-- Trigger: Prohibit modification of immutable trusted ingestion records
CREATE OR REPLACE FUNCTION trg_trusted_ingestion_records_immutable()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.ingestion_id <> NEW.ingestion_id OR
       OLD.org_id <> NEW.org_id OR
       OLD.student_id <> NEW.student_id OR
       OLD.repository_id <> NEW.repository_id OR
       LOWER(OLD.commit_sha) <> LOWER(NEW.commit_sha) OR
       LOWER(OLD.tree_sha) <> LOWER(NEW.tree_sha) OR
       OLD.manifest <> NEW.manifest THEN
        RAISE EXCEPTION '[SECURITY_GUARD] IMMUTABLE_INGESTION_RECORD_MUTATION_REJECTED: Trusted ingestion records are write-once and cannot be modified';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_trusted_ingestion_immutable ON trusted_ingestion_records;
CREATE TRIGGER trg_trusted_ingestion_immutable
    BEFORE UPDATE ON trusted_ingestion_records
    FOR EACH ROW
    EXECUTE FUNCTION trg_trusted_ingestion_records_immutable();

-- 5. Ingestion Jobs (Durable progress tracking, retry and reconciliation outbox)
CREATE TABLE IF NOT EXISTS ingestion_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ingestion_id UUID UNIQUE NOT NULL,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    owner VARCHAR(100) NOT NULL,
    repo VARCHAR(100) NOT NULL,
    ref VARCHAR(100) NOT NULL DEFAULT 'main',
    commit_sha VARCHAR(40),
    tree_sha VARCHAR(40),
    status VARCHAR(30) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'resolving', 'fetching', 'verifying', 'persisted', 'completed', 'failed')),
    file_count INT NOT NULL DEFAULT 0,
    retained_bytes BIGINT NOT NULL DEFAULT 0,
    registered_snapshots_count INT NOT NULL DEFAULT 0,
    error TEXT,
    diagnostics JSONB NOT NULL DEFAULT '{}'::jsonb,
    started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_tenant
    ON ingestion_jobs (org_id, student_id, status);

ALTER TABLE ingestion_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingestion_jobs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_ingestion_jobs ON ingestion_jobs;
CREATE POLICY tenant_isolation_ingestion_jobs ON ingestion_jobs
    FOR ALL
    USING (org_id = current_app_org_id())
    WITH CHECK (org_id = current_app_org_id());

-- 6. Grant restricted permissions to runtime roles
GRANT SELECT, INSERT, UPDATE, DELETE ON github_oauth_states TO app_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON connected_accounts TO app_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON source_snapshots TO app_api;
GRANT SELECT, INSERT ON trusted_ingestion_records TO app_api;
GRANT SELECT, INSERT, UPDATE ON ingestion_jobs TO app_api;

GRANT SELECT ON source_snapshots, trusted_ingestion_records, ingestion_jobs TO ai_worker;
