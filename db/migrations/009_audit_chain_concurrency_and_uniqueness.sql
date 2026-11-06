-- ==============================================================================
-- PRAMAAN MIGRATION 009: AUDIT CHAIN CONCURRENCY & UNIQUENESS CONSTRAINT
-- ==============================================================================
-- 1. Validates that no duplicate (org_id, seq) pairs exist in audit_events.
-- 2. Cleans up non-deterministic test artifacts if present.
-- 3. Adds strict UNIQUE constraint on (org_id, seq) to prevent sequence collision
--    and cryptographic chain forks at the database engine level.
-- ==============================================================================

DO $$
DECLARE
    dup_count INTEGER;
BEGIN
    -- 1. Clean up legacy test artifacts if present (disabling trigger only for administrative cleanup)
    IF EXISTS (
        SELECT 1 FROM audit_events WHERE action = 'TEST_EVENT' AND seq = 99999
    ) THEN
        ALTER TABLE audit_events DISABLE TRIGGER trg_audit_events_immutable;
        DELETE FROM audit_events WHERE action = 'TEST_EVENT' AND seq = 99999;
        ALTER TABLE audit_events ENABLE TRIGGER trg_audit_events_immutable;
    END IF;

    -- 2. Validate existing records for any remaining duplicate (org_id, seq)
    SELECT COUNT(*) INTO dup_count
    FROM (
        SELECT org_id, seq, COUNT(*)
        FROM audit_events
        GROUP BY org_id, seq
        HAVING COUNT(*) > 1
    ) dups;

    IF dup_count > 0 THEN
        RAISE EXCEPTION 'FATAL: Cannot apply unique constraint on audit_events(org_id, seq). % duplicate sequence groups detected.', dup_count;
    END IF;

    -- 3. Add uniqueness constraint idempotently
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_audit_events_org_seq'
    ) THEN
        ALTER TABLE audit_events
        ADD CONSTRAINT uq_audit_events_org_seq UNIQUE (org_id, seq);
    END IF;
END $$;
