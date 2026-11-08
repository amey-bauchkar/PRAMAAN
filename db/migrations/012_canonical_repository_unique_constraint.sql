-- ==============================================================================
-- PRAMAAN MIGRATION 012: CANONICAL REPOSITORY UNIQUE CONSTRAINT (P0-04)
-- ==============================================================================

-- 1. Deduplicate any existing duplicate repositories rows, preserving the earliest created row
DELETE FROM repositories r1
USING repositories r2
WHERE r1.student_id = r2.student_id
  AND r1.provider = r2.provider
  AND r1.provider_repo_id = r2.provider_repo_id
  AND r1.id > r2.id;

-- 2. Add unique constraint on (student_id, provider, provider_repo_id)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'uq_repositories_student_provider_repo'
    ) THEN
        ALTER TABLE repositories
        ADD CONSTRAINT uq_repositories_student_provider_repo
        UNIQUE (student_id, provider, provider_repo_id);
    END IF;
END $$;

-- 3. Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_repositories_student_provider_repo
    ON repositories(student_id, provider, provider_repo_id);

