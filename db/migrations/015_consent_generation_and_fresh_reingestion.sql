-- ==============================================================================
-- PRAMAAN MIGRATION 015: CONSENT GENERATION & FRESH RE-INGESTION (P0-04)
-- ==============================================================================
-- Enables append-only, consent-generation-aware trusted ingestion records and source snapshots.
-- Preserves immutable historical quarantined/revoked records while allowing fresh re-ingestion
-- of the same repository and Git commit under a newly granted active consent grant.

-- 1. trusted_ingestion_records: add consent_grant_id column and backfill from repositories
ALTER TABLE trusted_ingestion_records 
    ADD COLUMN IF NOT EXISTS consent_grant_id UUID REFERENCES consent_grants(id) ON DELETE CASCADE;

UPDATE trusted_ingestion_records t
SET consent_grant_id = r.consent_grant_id
FROM repositories r
WHERE t.repository_id = r.id AND t.consent_grant_id IS NULL;

-- 2. trusted_ingestion_records: drop legacy unique constraint and establish generation-aware uniqueness
ALTER TABLE trusted_ingestion_records 
    DROP CONSTRAINT IF EXISTS trusted_ingestion_records_org_id_repository_id_commit_sha_s_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_trusted_ingestion_commit_consent
    ON trusted_ingestion_records (org_id, repository_id, commit_sha, student_id, consent_grant_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_trusted_ingestion_active_commit
    ON trusted_ingestion_records (org_id, repository_id, commit_sha, student_id)
    WHERE status != 'revoked';

-- 3. source_snapshots: drop legacy unique constraint and establish generation-aware uniqueness
ALTER TABLE source_snapshots
    DROP CONSTRAINT IF EXISTS source_snapshots_org_id_student_id_repository_id_commit_sha_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_source_snapshots_commit_path_ingestion
    ON source_snapshots (org_id, student_id, repository_id, commit_sha, file_path, ingestion_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_source_snapshots_active_commit_path
    ON source_snapshots (org_id, student_id, repository_id, commit_sha, file_path)
    WHERE registration_state != 'quarantined';

-- 4. Update immutable trigger function to guard consent_grant_id once set
CREATE OR REPLACE FUNCTION trg_trusted_ingestion_records_immutable()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.ingestion_id <> NEW.ingestion_id OR
       OLD.org_id <> NEW.org_id OR
       OLD.student_id <> NEW.student_id OR
       OLD.repository_id <> NEW.repository_id OR
       LOWER(OLD.commit_sha) <> LOWER(NEW.commit_sha) OR
       LOWER(OLD.tree_sha) <> LOWER(NEW.tree_sha) OR
       OLD.manifest <> NEW.manifest OR
       (OLD.consent_grant_id IS NOT NULL AND OLD.consent_grant_id IS DISTINCT FROM NEW.consent_grant_id) THEN
        RAISE EXCEPTION '[SECURITY_GUARD] IMMUTABLE_INGESTION_RECORD_MUTATION_REJECTED: Trusted ingestion records are write-once and cannot be modified';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Permissions
GRANT SELECT, INSERT, UPDATE ON trusted_ingestion_records TO app_api;
GRANT SELECT, INSERT, UPDATE ON source_snapshots TO app_api;
