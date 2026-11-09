-- ==============================================================================
-- PRAMAAN MIGRATION 011a: SAFE CANONICAL REPOSITORY PREFLIGHT & RECONCILIATION
-- ==============================================================================
-- Forward-compatible safe reconciliation executed BEFORE Migration 012.
-- Verifies cryptographic equivalence before deduplication to prevent silent data loss.
-- Idempotent on fresh installations and databases where Migration 012 has already run.

-- 0. Temporarily disable immutable trigger during preflight to allow canonical re-parenting
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_trusted_ingestion_immutable'
    ) THEN
        EXECUTE 'ALTER TABLE trusted_ingestion_records DISABLE TRIGGER trg_trusted_ingestion_immutable;';
    END IF;
END $$;

DO $$
DECLARE
    rec RECORD;
    v_canonical_id UUID;
    v_dup_id UUID;
    v_dup_ids UUID[];
    r_snap RECORD;
    s_snap RECORD;
    t_rec RECORD;
BEGIN
    -- 1. Preflight: Find all duplicate repository groups on (student_id, provider, provider_repo_id)
    FOR rec IN 
        SELECT student_id, provider, provider_repo_id, COUNT(*) as cnt
        FROM repositories
        GROUP BY student_id, provider, provider_repo_id
        HAVING COUNT(*) > 1
    LOOP
        -- Determine canonical repository row deterministically: earliest imported_at, then lowest id
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
            FOR v_dup_id IN SELECT UNNEST(v_dup_ids)
            LOOP
                -- A. Validate & Re-parent repo_snapshots & evidence_items
                FOR r_snap IN 
                    SELECT dup.id as dup_id, canon.id as canon_id,
                           dup.parser_version as dup_pv, canon.parser_version as canon_pv,
                           dup.tree_summary as dup_ts, canon.tree_summary as canon_ts
                    FROM repo_snapshots dup
                    JOIN repo_snapshots canon 
                      ON canon.repository_id = v_canonical_id 
                     AND canon.commit_sha = dup.commit_sha
                    WHERE dup.repository_id = v_dup_id
                LOOP
                    -- Verify equivalence of parser_version and tree_summary
                    IF r_snap.dup_pv IS DISTINCT FROM r_snap.canon_pv OR
                       r_snap.dup_ts::text IS DISTINCT FROM r_snap.canon_ts::text THEN
                        RAISE EXCEPTION '[DATA_LOSS_PREVENTION] Divergent repo_snapshots detected for commit! dup_id=% canon_id=%', r_snap.dup_id, r_snap.canon_id;
                    END IF;

                    -- Re-parent evidence pointing to duplicate snapshot to the corresponding canonical snapshot
                    UPDATE evidence_items
                    SET repo_snapshot_id = r_snap.canon_id
                    WHERE repo_snapshot_id = r_snap.dup_id;

                    -- Delete the redundant duplicate repo_snapshot
                    DELETE FROM repo_snapshots WHERE id = r_snap.dup_id;
                END LOOP;

                -- Re-parent remaining non-colliding repo_snapshots
                UPDATE repo_snapshots
                SET repository_id = v_canonical_id
                WHERE repository_id = v_dup_id;

                -- B. Validate & Re-parent source_snapshots
                FOR s_snap IN
                    SELECT dup.id as dup_id, canon.id as canon_id,
                           dup.raw_file_hash as dup_hash, canon.raw_file_hash as canon_hash,
                           dup.blob_sha as dup_blob, canon.blob_sha as canon_blob,
                           dup.raw_bytes as dup_bytes, canon.raw_bytes as canon_bytes,
                           dup.file_path as f_path
                    FROM source_snapshots dup
                    JOIN source_snapshots canon
                      ON canon.repository_id = v_canonical_id
                     AND canon.org_id = dup.org_id
                     AND canon.student_id = dup.student_id
                     AND LOWER(canon.commit_sha) = LOWER(dup.commit_sha)
                     AND canon.file_path = dup.file_path
                    WHERE dup.repository_id = v_dup_id
                LOOP
                    -- Verify exact equivalence of raw_file_hash, blob_sha, and raw_bytes
                    IF LOWER(s_snap.dup_hash) <> LOWER(s_snap.canon_hash) OR
                       LOWER(COALESCE(s_snap.dup_blob, '')) <> LOWER(COALESCE(s_snap.canon_blob, '')) OR
                       s_snap.dup_bytes <> s_snap.canon_bytes THEN
                        RAISE EXCEPTION '[DATA_LOSS_PREVENTION] Divergent source_snapshots detected for file %! dup_id=% canon_id=%', s_snap.f_path, s_snap.dup_id, s_snap.canon_id;
                    END IF;

                    -- Delete the redundant duplicate source_snapshot
                    DELETE FROM source_snapshots WHERE id = s_snap.dup_id;
                END LOOP;

                -- Re-parent remaining non-colliding source_snapshots
                UPDATE source_snapshots
                SET repository_id = v_canonical_id
                WHERE repository_id = v_dup_id;

                -- C. Validate & Re-parent trusted_ingestion_records
                FOR t_rec IN
                    SELECT dup.id as dup_id, canon.id as canon_id,
                           dup.ingestion_id as dup_ing_id, canon.ingestion_id as canon_ing_id,
                           dup.tree_sha as dup_tree, canon.tree_sha as canon_tree,
                           dup.manifest as dup_manifest, canon.manifest as canon_manifest,
                           dup.provenance as dup_prov, canon.provenance as canon_prov
                    FROM trusted_ingestion_records dup
                    JOIN trusted_ingestion_records canon
                      ON canon.repository_id = v_canonical_id
                     AND canon.org_id = dup.org_id
                     AND canon.student_id = dup.student_id
                     AND LOWER(canon.commit_sha) = LOWER(dup.commit_sha)
                    WHERE dup.repository_id = v_dup_id
                LOOP
                    -- Verify exact equivalence of tree_sha, manifest, and provenance
                    IF LOWER(t_rec.dup_tree) <> LOWER(t_rec.canon_tree) OR
                       t_rec.dup_manifest::jsonb <> t_rec.canon_manifest::jsonb OR
                       t_rec.dup_prov <> t_rec.canon_prov THEN
                        RAISE EXCEPTION '[DATA_LOSS_PREVENTION] Divergent trusted_ingestion_records detected! dup_id=% canon_id=%', t_rec.dup_id, t_rec.canon_id;
                    END IF;

                    -- Identify canonical surviving ingestion record and reconcile source_snapshots.ingestion_id
                    UPDATE source_snapshots
                    SET ingestion_id = t_rec.canon_ing_id
                    WHERE ingestion_id = t_rec.dup_ing_id;

                    -- Verify no snapshot retains the duplicate ingestion_id
                    IF EXISTS (SELECT 1 FROM source_snapshots WHERE ingestion_id = t_rec.dup_ing_id) THEN
                        RAISE EXCEPTION '[DATA_LOSS_PREVENTION] Snapshot still retains deleted duplicate ingestion_id %!', t_rec.dup_ing_id;
                    END IF;

                    -- Delete redundant duplicate record
                    DELETE FROM trusted_ingestion_records WHERE id = t_rec.dup_id;
                END LOOP;

                -- Re-parent remaining non-colliding trusted_ingestion_records
                UPDATE trusted_ingestion_records
                SET repository_id = v_canonical_id
                WHERE repository_id = v_dup_id;

                -- D. Re-parent ingestion_jobs
                UPDATE ingestion_jobs
                SET repository_id = v_canonical_id
                WHERE repository_id = v_dup_id;

                -- E. Delete redundant repository row
                DELETE FROM repositories
                WHERE id = v_dup_id;
            END LOOP;
        END IF;
    END LOOP;

    -- 2. Final Verification Assertion: Fail closed if any duplicate groups remain
    IF EXISTS (
        SELECT 1
        FROM repositories
        GROUP BY student_id, provider, provider_repo_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION '[DATA_LOSS_PREVENTION] Duplicate repository groups still exist after reconciliation!';
    END IF;
END $$;

-- Re-enable immutable trigger
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_trusted_ingestion_immutable'
    ) THEN
        EXECUTE 'ALTER TABLE trusted_ingestion_records ENABLE TRIGGER trg_trusted_ingestion_immutable;';
    END IF;
END $$;

-- 3. Grant runtime role UPDATE permission on trusted_ingestion_records for status transitions (e.g. revocation)
GRANT UPDATE ON trusted_ingestion_records TO app_api;
