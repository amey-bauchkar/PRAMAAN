-- ==============================================================================
-- PRAMAAN MIGRATION 011a: SAFE CANONICAL REPOSITORY PREFLIGHT & RECONCILIATION
-- ==============================================================================
-- Forward-compatible safe reconciliation executed BEFORE Migration 012.
-- 1. Establishes consent-generation schema and partial indexes prior to reconciliation.
-- 2. Detects ambiguous historical consent grants and fails closed before destructive changes.
-- 3. Verifies cryptographic equivalence per Git commit across distinct generations.
-- 4. Preserves distinct consent generations and historical revoked/quarantined records.
-- 5. Deduplicates identical records within the same generation while propagating quarantine conservatively.
-- 6. Leaves exactly zero duplicate repository groups so Migration 012 performs zero deletes.

-- 0. Ensure consent_grant_id exists on trusted_ingestion_records
ALTER TABLE trusted_ingestion_records 
    ADD COLUMN IF NOT EXISTS consent_grant_id UUID REFERENCES consent_grants(id) ON DELETE CASCADE;

-- 1. Detect and resolve ambiguous historical generation ownership
DO $$
DECLARE
    t_unresolved RECORD;
    v_resolved_grant_id UUID;
    v_grant_count INT;
BEGIN
    FOR t_unresolved IN
        SELECT tir.id, tir.student_id, tir.repository_id
        FROM trusted_ingestion_records tir
        WHERE tir.consent_grant_id IS NULL
    LOOP
        SELECT COUNT(*) INTO v_grant_count
        FROM consent_grants
        WHERE student_id = t_unresolved.student_id
          AND purpose = 'repo_verification';

        IF v_grant_count = 1 THEN
            SELECT id INTO v_resolved_grant_id
            FROM consent_grants
            WHERE student_id = t_unresolved.student_id
              AND purpose = 'repo_verification'
            LIMIT 1;

            UPDATE trusted_ingestion_records
            SET consent_grant_id = v_resolved_grant_id
            WHERE id = t_unresolved.id;
        ELSE
            RAISE EXCEPTION '[DATA_LOSS_PREVENTION] Ambiguous consent generation: trusted_ingestion_record % (student %) has no determinable consent_grant_id (found % candidates)', 
                t_unresolved.id, t_unresolved.student_id, v_grant_count;
        END IF;
    END LOOP;
END $$;

-- 2. Establish generation-aware partial unique indexes and drop single-commit rigid constraints
ALTER TABLE trusted_ingestion_records 
    DROP CONSTRAINT IF EXISTS trusted_ingestion_records_org_id_repository_id_commit_sha_s_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_trusted_ingestion_commit_consent
    ON trusted_ingestion_records (org_id, repository_id, commit_sha, student_id, consent_grant_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_trusted_ingestion_active_commit
    ON trusted_ingestion_records (org_id, repository_id, commit_sha, student_id)
    WHERE status != 'revoked';

ALTER TABLE source_snapshots
    DROP CONSTRAINT IF EXISTS source_snapshots_org_id_student_id_repository_id_commit_sha_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_source_snapshots_commit_path_ingestion
    ON source_snapshots (org_id, student_id, repository_id, commit_sha, file_path, ingestion_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_source_snapshots_active_commit_path
    ON source_snapshots (org_id, student_id, repository_id, commit_sha, file_path)
    WHERE registration_state != 'quarantined';

-- 3. Temporarily disable immutable trigger during preflight to allow canonical re-parenting
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_trusted_ingestion_immutable'
    ) THEN
        EXECUTE 'ALTER TABLE trusted_ingestion_records DISABLE TRIGGER trg_trusted_ingestion_immutable;';
    END IF;
END $$;

-- 4. Preflight Reconciliation of Duplicate Repositories
DO $$
DECLARE
    rec RECORD;
    v_canonical_id UUID;
    v_dup_id UUID;
    v_dup_ids UUID[];
    r_snap RECORD;
    t_dup RECORD;
    t_canon RECORD;
    s_dup RECORD;
    s_canon RECORD;
BEGIN
    FOR rec IN 
        SELECT student_id, provider, provider_repo_id, COUNT(*) as cnt
        FROM repositories
        GROUP BY student_id, provider, provider_repo_id
        HAVING COUNT(*) > 1
    LOOP
        -- Determine canonical repository row: earliest imported_at, then lowest id
        SELECT id INTO v_canonical_id
        FROM repositories
        WHERE student_id = rec.student_id
          AND provider = rec.provider
          AND provider_repo_id = rec.provider_repo_id
        ORDER BY imported_at ASC, id ASC
        LIMIT 1;

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
                    IF r_snap.dup_pv IS DISTINCT FROM r_snap.canon_pv OR
                       r_snap.dup_ts::text IS DISTINCT FROM r_snap.canon_ts::text THEN
                        RAISE EXCEPTION '[DATA_LOSS_PREVENTION] Divergent repo_snapshots detected for commit! dup_id=% canon_id=%', r_snap.dup_id, r_snap.canon_id;
                    END IF;

                    UPDATE evidence_items
                    SET repo_snapshot_id = r_snap.canon_id
                    WHERE repo_snapshot_id = r_snap.dup_id;

                    DELETE FROM repo_snapshots WHERE id = r_snap.dup_id;
                END LOOP;

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
                    SELECT * INTO t_canon
                    FROM trusted_ingestion_records
                    WHERE repository_id = v_canonical_id
                      AND org_id = t_dup.org_id
                      AND student_id = t_dup.student_id
                      AND LOWER(commit_sha) = LOWER(t_dup.commit_sha)
                      AND (consent_grant_id = t_dup.consent_grant_id OR (consent_grant_id IS NULL AND t_dup.consent_grant_id IS NULL));

                    IF t_canon.id IS NOT NULL THEN
                        -- Same generation collision
                        IF LOWER(t_dup.tree_sha) <> LOWER(t_canon.tree_sha) OR
                           t_dup.manifest::jsonb <> t_canon.manifest::jsonb OR
                           t_dup.provenance <> t_canon.provenance THEN
                            RAISE EXCEPTION '[DATA_LOSS_PREVENTION] Divergent trusted_ingestion_records detected for commit %! dup_id=% canon_id=%', 
                                t_dup.commit_sha, t_dup.id, t_canon.id;
                        END IF;

                        IF t_dup.status <> t_canon.status THEN
                            RAISE EXCEPTION '[DATA_LOSS_PREVENTION] Conflicting trusted_ingestion_records status detected within same generation (revoked vs persisted)! dup_id=% canon_id=%', 
                                t_dup.id, t_canon.id;
                        END IF;

                        FOR s_dup IN
                            SELECT * FROM source_snapshots
                            WHERE repository_id = v_dup_id
                              AND ingestion_id = t_dup.ingestion_id
                        LOOP
                            SELECT * INTO s_canon
                            FROM source_snapshots
                            WHERE repository_id = v_canonical_id
                              AND org_id = s_dup.org_id
                              AND student_id = s_dup.student_id
                              AND LOWER(commit_sha) = LOWER(s_dup.commit_sha)
                              AND file_path = s_dup.file_path
                              AND (ingestion_id = t_canon.ingestion_id OR ingestion_id = s_dup.ingestion_id);

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
                            ELSE
                                UPDATE source_snapshots
                                SET repository_id = v_canonical_id,
                                    ingestion_id = t_canon.ingestion_id
                                WHERE id = s_dup.id;
                            END IF;
                        END LOOP;

                        DELETE FROM trusted_ingestion_records WHERE id = t_dup.id;
                    ELSE
                        -- Distinct consent generation: re-parent without deletion!
                        UPDATE trusted_ingestion_records
                        SET repository_id = v_canonical_id
                        WHERE id = t_dup.id;

                        UPDATE source_snapshots
                        SET repository_id = v_canonical_id
                        WHERE repository_id = v_dup_id
                          AND ingestion_id = t_dup.ingestion_id;
                    END IF;
                END LOOP;

                -- D. Re-parent remaining unlinked source_snapshots
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

                -- E. Re-parent ingestion_jobs
                UPDATE ingestion_jobs
                SET repository_id = v_canonical_id
                WHERE repository_id = v_dup_id;

                -- F. Delete redundant repository row
                DELETE FROM repositories
                WHERE id = v_dup_id;
            END LOOP;
        END IF;
    END LOOP;

    -- 5. Final Verification Assertion: Fail closed if any duplicate groups remain
    IF EXISTS (
        SELECT 1
        FROM repositories
        GROUP BY student_id, provider, provider_repo_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION '[DATA_LOSS_PREVENTION] Duplicate repository groups still exist after reconciliation!';
    END IF;
END $$;

-- 6. Re-enable immutable trigger
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_trusted_ingestion_immutable'
    ) THEN
        EXECUTE 'ALTER TABLE trusted_ingestion_records ENABLE TRIGGER trg_trusted_ingestion_immutable;';
    END IF;
END $$;

-- 7. Grant runtime role UPDATE permission on trusted_ingestion_records for status transitions (e.g. revocation)
GRANT UPDATE ON trusted_ingestion_records TO app_api;
