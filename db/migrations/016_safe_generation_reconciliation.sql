-- ==============================================================================
-- PRAMAAN MIGRATION 016: SAFE CONSENT GENERATION RECONCILIATION & DATA PRESERVATION
-- ==============================================================================
-- Forward-compatible safe reconciliation executed AFTER Migration 015.
-- 1. Populates/resolves historical consent-generation identity for any legacy records.
-- 2. Preserves distinct consent generations and historical revoked records.
-- 3. Reconciles repository duplicates with full consent-generation awareness.
-- 4. Verifies snapshot cryptographic equivalence per generation and propagates quarantine conservatively.
-- 5. Fails closed with descriptive error if ambiguous generation ownership or divergent data is detected.

-- 0. Temporarily disable immutability trigger during reconciliation to allow canonical re-parenting
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
    t_unresolved RECORD;
    v_resolved_grant_id UUID;
    v_grant_count INT;
    rec RECORD;
    v_canonical_id UUID;
    v_dup_id UUID;
    v_dup_ids UUID[];
    t_dup RECORD;
    t_canon RECORD;
    s_dup RECORD;
    s_canon RECORD;
    r_snap RECORD;
BEGIN
    -- 1. Resolve and verify consent-generation relationship for any trusted_ingestion_records
    --    where consent_grant_id is NULL. Fail closed if ambiguous!
    FOR t_unresolved IN
        SELECT tir.id, tir.student_id, tir.repository_id
        FROM trusted_ingestion_records tir
        WHERE tir.consent_grant_id IS NULL
    LOOP
        -- Check candidate consent grants for this student
        SELECT COUNT(*) INTO v_grant_count
        FROM consent_grants
        WHERE student_id = t_unresolved.student_id
          AND purpose = 'repo_verification';

        IF v_grant_count = 1 THEN
            -- Exactly one candidate: resolve deterministically
            SELECT id INTO v_resolved_grant_id
            FROM consent_grants
            WHERE student_id = t_unresolved.student_id
              AND purpose = 'repo_verification'
            LIMIT 1;

            UPDATE trusted_ingestion_records
            SET consent_grant_id = v_resolved_grant_id
            WHERE id = t_unresolved.id;
        ELSE
            -- 0 or >1 candidates: Ambiguous historical generation ownership! Fail closed!
            RAISE EXCEPTION '[DATA_LOSS_PREVENTION] Ambiguous consent generation: trusted_ingestion_record % (student %) has no determinable consent_grant_id (found % candidates)', 
                t_unresolved.id, t_unresolved.student_id, v_grant_count;
        END IF;
    END LOOP;

    -- 2. Find duplicate repository groups on (student_id, provider, provider_repo_id)
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

                    -- Delete redundant duplicate repo_snapshot
                    DELETE FROM repo_snapshots WHERE id = r_snap.dup_id;
                END LOOP;

                -- Re-parent remaining non-colliding repo_snapshots
                UPDATE repo_snapshots
                SET repository_id = v_canonical_id
                WHERE repository_id = v_dup_id;

                -- B. Cross-generation cryptographic equivalence pre-check for the same commit
                IF EXISTS (
                    SELECT 1
                    FROM trusted_ingestion_records dup
                    JOIN trusted_ingestion_records canon
                      ON canon.repository_id = v_canonical_id
                     AND canon.org_id = dup.org_id
                     AND canon.student_id = dup.student_id
                     AND LOWER(canon.commit_sha) = LOWER(dup.commit_sha)
                     AND LOWER(canon.tree_sha) <> LOWER(dup.tree_sha)
                    WHERE dup.repository_id = v_dup_id
                ) THEN
                    RAISE EXCEPTION '[DATA_LOSS_PREVENTION] Divergent trusted_ingestion_records tree_sha detected across generations!';
                END IF;

                IF EXISTS (
                    SELECT 1
                    FROM source_snapshots dup
                    JOIN source_snapshots canon
                      ON canon.repository_id = v_canonical_id
                     AND canon.org_id = dup.org_id
                     AND canon.student_id = dup.student_id
                     AND LOWER(canon.commit_sha) = LOWER(dup.commit_sha)
                     AND canon.file_path = dup.file_path
                     AND (
                         LOWER(canon.raw_file_hash) <> LOWER(dup.raw_file_hash) OR
                         LOWER(COALESCE(canon.blob_sha, '')) <> LOWER(COALESCE(dup.blob_sha, '')) OR
                         canon.raw_bytes <> dup.raw_bytes
                     )
                    WHERE dup.repository_id = v_dup_id
                ) THEN
                    RAISE EXCEPTION '[DATA_LOSS_PREVENTION] Divergent source_snapshots detected for commit and file across generations!';
                END IF;

                -- C. Reconcile trusted_ingestion_records & child source_snapshots with full consent-generation awareness
                FOR t_dup IN
                    SELECT * FROM trusted_ingestion_records
                    WHERE repository_id = v_dup_id
                LOOP
                    -- Check if canonical repository ALREADY has a record for the SAME commit AND SAME consent_grant_id
                    SELECT * INTO t_canon
                    FROM trusted_ingestion_records
                    WHERE repository_id = v_canonical_id
                      AND org_id = t_dup.org_id
                      AND student_id = t_dup.student_id
                      AND LOWER(commit_sha) = LOWER(t_dup.commit_sha)
                      AND (consent_grant_id = t_dup.consent_grant_id OR (consent_grant_id IS NULL AND t_dup.consent_grant_id IS NULL));

                    IF t_canon.id IS NOT NULL THEN
                        -- Case B1: Exact same generation collision. Verify cryptographic equivalence!
                        IF LOWER(t_dup.tree_sha) <> LOWER(t_canon.tree_sha) OR
                           t_dup.manifest::jsonb <> t_canon.manifest::jsonb OR
                           t_dup.provenance <> t_canon.provenance THEN
                            RAISE EXCEPTION '[DATA_LOSS_PREVENTION] Divergent trusted_ingestion_records detected for commit %! dup_id=% canon_id=%', 
                                t_dup.commit_sha, t_dup.id, t_canon.id;
                        END IF;

                        -- Compare status: if status conflicts (e.g. revoked vs persisted), fail closed
                        IF t_dup.status <> t_canon.status THEN
                            RAISE EXCEPTION '[DATA_LOSS_PREVENTION] Conflicting trusted_ingestion_records status detected (revoked vs persisted)! dup_id=% canon_id=%', 
                                t_dup.id, t_canon.id;
                        END IF;

                        -- Reconcile source_snapshots belonging to t_dup.ingestion_id
                        FOR s_dup IN
                            SELECT * FROM source_snapshots
                            WHERE repository_id = v_dup_id
                              AND ingestion_id = t_dup.ingestion_id
                        LOOP
                            -- Check if canonical repository already has a snapshot for this file in t_canon.ingestion_id
                            SELECT * INTO s_canon
                            FROM source_snapshots
                            WHERE repository_id = v_canonical_id
                              AND org_id = s_dup.org_id
                              AND student_id = s_dup.student_id
                              AND LOWER(commit_sha) = LOWER(s_dup.commit_sha)
                              AND file_path = s_dup.file_path
                              AND (ingestion_id = t_canon.ingestion_id OR ingestion_id = s_dup.ingestion_id);

                            IF s_canon.id IS NOT NULL THEN
                                -- Verify snapshot cryptographic & provenance equivalence
                                IF LOWER(s_dup.raw_file_hash) <> LOWER(s_canon.raw_file_hash) OR
                                   LOWER(COALESCE(s_dup.blob_sha, '')) <> LOWER(COALESCE(s_canon.blob_sha, '')) OR
                                   s_dup.raw_bytes <> s_canon.raw_bytes THEN
                                    RAISE EXCEPTION '[DATA_LOSS_PREVENTION] Divergent source_snapshots detected for file %! dup_id=% canon_id=%', 
                                        s_dup.file_path, s_dup.id, s_canon.id;
                                END IF;

                                IF s_dup.provenance <> s_canon.provenance THEN
                                    RAISE EXCEPTION '[DATA_LOSS_PREVENTION] Divergent source_snapshots provenance detected for file %! dup_id=% canon_id=%', 
                                        s_dup.file_path, s_dup.id, s_canon.id;
                                END IF;

                                -- Lifecycle state comparison: if either is quarantined, ensure canonical is quarantined
                                IF s_dup.registration_state = 'quarantined' OR s_canon.registration_state = 'quarantined' THEN
                                    UPDATE source_snapshots
                                    SET registration_state = 'quarantined'
                                    WHERE id = s_canon.id;
                                ELSIF s_dup.registration_state <> s_canon.registration_state THEN
                                    RAISE EXCEPTION '[DATA_LOSS_PREVENTION] Conflicting registration_state on duplicate source_snapshots for file %! dup_id=% canon_id=%', 
                                        s_dup.file_path, s_dup.id, s_canon.id;
                                END IF;

                                -- Safe to delete redundant duplicate snapshot in same generation
                                DELETE FROM source_snapshots WHERE id = s_dup.id;
                            ELSE
                                -- Re-link snapshot to surviving canonical ingestion_id and canonical repository
                                UPDATE source_snapshots
                                SET repository_id = v_canonical_id,
                                    ingestion_id = t_canon.ingestion_id
                                WHERE id = s_dup.id;
                            END IF;
                        END LOOP;

                        -- Delete redundant duplicate ingestion record in same generation
                        DELETE FROM trusted_ingestion_records WHERE id = t_dup.id;
                    ELSE
                        -- Case B2: Distinct consent generation!
                        -- Re-parent record and all its child snapshots to canonical repository WITHOUT deleting!
                        UPDATE trusted_ingestion_records
                        SET repository_id = v_canonical_id
                        WHERE id = t_dup.id;

                        UPDATE source_snapshots
                        SET repository_id = v_canonical_id
                        WHERE repository_id = v_dup_id
                          AND ingestion_id = t_dup.ingestion_id;
                    END IF;
                END LOOP;

                -- Re-parent any remaining source_snapshots (deduplicating any identical records first)
                FOR s_dup IN
                    SELECT * FROM source_snapshots
                    WHERE repository_id = v_dup_id
                LOOP
                    SELECT * INTO s_canon
                    FROM source_snapshots
                    WHERE repository_id = v_canonical_id
                      AND org_id = s_dup.org_id
                      AND student_id = s_dup.student_id
                      AND LOWER(commit_sha) = LOWER(s_dup.commit_sha)
                      AND file_path = s_dup.file_path;

                    IF s_canon.id IS NOT NULL THEN
                        IF LOWER(s_dup.raw_file_hash) <> LOWER(s_canon.raw_file_hash) OR
                           LOWER(COALESCE(s_dup.blob_sha, '')) <> LOWER(COALESCE(s_canon.blob_sha, '')) OR
                           s_dup.raw_bytes <> s_canon.raw_bytes THEN
                            RAISE EXCEPTION '[DATA_LOSS_PREVENTION] Divergent source_snapshots detected for file %! dup_id=% canon_id=%', 
                                s_dup.file_path, s_dup.id, s_canon.id;
                        END IF;

                        IF s_dup.provenance <> s_canon.provenance THEN
                            RAISE EXCEPTION '[DATA_LOSS_PREVENTION] Divergent source_snapshots provenance detected for file %! dup_id=% canon_id=%', 
                                s_dup.file_path, s_dup.id, s_canon.id;
                        END IF;

                        IF s_dup.registration_state = 'quarantined' OR s_canon.registration_state = 'quarantined' THEN
                            UPDATE source_snapshots
                            SET registration_state = 'quarantined'
                            WHERE id = s_canon.id;
                        ELSIF s_dup.registration_state <> s_canon.registration_state THEN
                            RAISE EXCEPTION '[DATA_LOSS_PREVENTION] Conflicting registration_state on duplicate source_snapshots for file %! dup_id=% canon_id=%', 
                                s_dup.file_path, s_dup.id, s_canon.id;
                        END IF;

                        DELETE FROM source_snapshots WHERE id = s_dup.id;
                    END IF;
                END LOOP;

                UPDATE source_snapshots
                SET repository_id = v_canonical_id
                WHERE repository_id = v_dup_id;

                -- C. Re-parent ingestion_jobs
                UPDATE ingestion_jobs
                SET repository_id = v_canonical_id
                WHERE repository_id = v_dup_id;

                -- D. Delete redundant repository row
                DELETE FROM repositories
                WHERE id = v_dup_id;
            END LOOP;
        END IF;
    END LOOP;

    -- 3. Final Verification Assertion: Fail closed if any duplicate groups remain
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
