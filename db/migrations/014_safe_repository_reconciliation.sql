-- ==============================================================================
-- PRAMAAN MIGRATION 014: SAFE CANONICAL REPOSITORY RECONCILIATION & DATA PRESERVATION
-- ==============================================================================

DO $$
DECLARE
    rec RECORD;
    v_canonical_id UUID;
    v_dup_id UUID;
    v_dup_ids UUID[];
BEGIN
    -- 1. Preflight: Find all duplicate repository groups (student_id, provider, provider_repo_id)
    FOR rec IN 
        SELECT student_id, provider, provider_repo_id, COUNT(*) as cnt
        FROM repositories
        GROUP BY student_id, provider, provider_repo_id
        HAVING COUNT(*) > 1
    LOOP
        -- Determine canonical repository row: earliest imported_at, then lowest id (deterministic)
        SELECT id INTO v_canonical_id
        FROM repositories
        WHERE student_id = rec.student_id
          AND provider = rec.provider
          AND provider_repo_id = rec.provider_repo_id
        ORDER BY imported_at ASC, id ASC
        LIMIT 1;

        -- Collect all non-canonical duplicate repository IDs in this group
        SELECT ARRAY_AGG(id) INTO v_dup_ids
        FROM repositories
        WHERE student_id = rec.student_id
          AND provider = rec.provider
          AND provider_repo_id = rec.provider_repo_id
          AND id <> v_canonical_id;

        IF v_dup_ids IS NOT NULL AND array_length(v_dup_ids, 1) > 0 THEN
            -- A. Re-parent repo_snapshots & evidence_items
            FOR v_dup_id IN SELECT UNNEST(v_dup_ids)
            LOOP
                -- Re-parent evidence pointing to duplicate snapshots to the corresponding canonical snapshot
                UPDATE evidence_items ei
                SET repo_snapshot_id = canon_snap.id
                FROM repo_snapshots dup_snap
                JOIN repo_snapshots canon_snap 
                  ON canon_snap.repository_id = v_canonical_id 
                 AND canon_snap.commit_sha = dup_snap.commit_sha
                WHERE ei.repo_snapshot_id = dup_snap.id
                  AND dup_snap.repository_id = v_dup_id;

                -- Delete duplicate repo_snapshots that collide on (repository_id, commit_sha)
                DELETE FROM repo_snapshots
                WHERE repository_id = v_dup_id
                  AND commit_sha IN (
                      SELECT commit_sha FROM repo_snapshots WHERE repository_id = v_canonical_id
                  );

                -- Re-parent remaining non-colliding repo_snapshots
                UPDATE repo_snapshots
                SET repository_id = v_canonical_id
                WHERE repository_id = v_dup_id;

                -- B. Re-parent source_snapshots
                -- Remove duplicates colliding on (org_id, student_id, repository_id, commit_sha, file_path)
                DELETE FROM source_snapshots ss_dup
                USING source_snapshots ss_canon
                WHERE ss_dup.repository_id = v_dup_id
                  AND ss_canon.repository_id = v_canonical_id
                  AND ss_dup.org_id = ss_canon.org_id
                  AND ss_dup.student_id = ss_canon.student_id
                  AND ss_dup.commit_sha = ss_canon.commit_sha
                  AND ss_dup.file_path = ss_canon.file_path;

                -- Re-parent remaining source_snapshots
                UPDATE source_snapshots
                SET repository_id = v_canonical_id
                WHERE repository_id = v_dup_id;

                -- C. Re-parent trusted_ingestion_records
                -- Temporarily disable immutability trigger for safe data preservation
                ALTER TABLE trusted_ingestion_records DISABLE TRIGGER trg_trusted_ingestion_immutable;

                -- Remove duplicate records colliding on (org_id, repository_id, commit_sha, student_id)
                DELETE FROM trusted_ingestion_records tir_dup
                USING trusted_ingestion_records tir_canon
                WHERE tir_dup.repository_id = v_dup_id
                  AND tir_canon.repository_id = v_canonical_id
                  AND tir_dup.org_id = tir_canon.org_id
                  AND tir_dup.student_id = tir_canon.student_id
                  AND tir_dup.commit_sha = tir_canon.commit_sha;

                -- Re-parent remaining trusted_ingestion_records
                UPDATE trusted_ingestion_records
                SET repository_id = v_canonical_id
                WHERE repository_id = v_dup_id;

                ALTER TABLE trusted_ingestion_records ENABLE TRIGGER trg_trusted_ingestion_immutable;

                -- D. Re-parent ingestion_jobs
                UPDATE ingestion_jobs
                SET repository_id = v_canonical_id
                WHERE repository_id = v_dup_id;

                -- E. Delete the duplicate repository row safely now that all child records are re-parented
                DELETE FROM repositories
                WHERE id = v_dup_id;
            END LOOP;
        END IF;
    END LOOP;

    -- 2. Verification Assertions: Fail closed if any duplicate groups remain
    IF EXISTS (
        SELECT 1
        FROM repositories
        GROUP BY student_id, provider, provider_repo_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION '[DATA_LOSS_PREVENTION] Duplicate repository groups still exist after reconciliation!';
    END IF;
END $$;
