-- ==============================================================================
-- PRAMAAN MIGRATION 013: ACTIVE CONSENT UNIQUENESS & RECONCILIATION
-- ==============================================================================

-- 1. Deterministically reconcile existing duplicate active consent grants.
--    For each (student_id, purpose) with multiple active grants (revoked_at IS NULL),
--    preserve the latest active grant (highest granted_at, then highest id)
--    and transition all older duplicates to revoked_at = CURRENT_TIMESTAMP.
WITH ranked_active_grants AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY student_id, purpose 
               ORDER BY granted_at DESC, id DESC
           ) as rank
    FROM consent_grants
    WHERE revoked_at IS NULL
)
UPDATE consent_grants
SET revoked_at = CURRENT_TIMESTAMP
WHERE id IN (
    SELECT id FROM ranked_active_grants WHERE rank > 1
);

-- 2. Enforce invariant: At most ONE active grant per (student_id, purpose).
--    Create a partial unique index on (student_id, purpose) for rows where revoked_at IS NULL.
CREATE UNIQUE INDEX IF NOT EXISTS uq_consent_grants_active_student_purpose
    ON consent_grants (student_id, purpose)
    WHERE revoked_at IS NULL;
