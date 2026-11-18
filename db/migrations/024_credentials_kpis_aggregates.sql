-- ==============================================================================
-- PRAMAAN MIGRATION 024: SKILL PASSPORT CREDENTIALS, KPI SNAPSHOTS, INTERVENTIONS & AGGREGATE-ONLY VIEWS
-- ==============================================================================
-- Aggregate functions are SECURITY DEFINER so they can count across protected data, but each one checks
-- the caller's role and tenant itself and returns only group-level counts with small cells suppressed.
-- No app role is granted row-level access to demographics or to other colleges.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS issuer_keys (
    id VARCHAR(80) PRIMARY KEY,               -- key id used in credential proofs (did:web#key-1 style)
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    public_key_pem TEXT NOT NULL,             -- private keys are never stored in the database
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    retired_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    student_skill_id UUID NOT NULL REFERENCES student_skills(id) ON DELETE CASCADE,
    skill_id UUID NOT NULL REFERENCES skills(id),
    proof_level VARCHAR(20) NOT NULL,
    payload JSONB NOT NULL,                   -- Open Badges 3.0 / W3C VC 2.0 credential, without proof
    proof_value TEXT NOT NULL,                -- Ed25519 signature over the canonical payload, base64url
    issuer_key_id VARCHAR(80) NOT NULL REFERENCES issuer_keys(id),
    status VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    revoked_reason TEXT,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    valid_until TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS kpi_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    label VARCHAR(120) NOT NULL,
    taken_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    metrics JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS interventions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    skill_id UUID REFERENCES skills(id),
    department_id UUID REFERENCES departments(id),
    starts_on DATE NOT NULL,
    ends_on DATE NOT NULL,
    before_snapshot_id UUID REFERENCES kpi_snapshots(id),
    created_by UUID REFERENCES memberships(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE issuer_keys ENABLE ROW LEVEL SECURITY;   ALTER TABLE issuer_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE credentials ENABLE ROW LEVEL SECURITY;   ALTER TABLE credentials FORCE ROW LEVEL SECURITY;
ALTER TABLE kpi_snapshots ENABLE ROW LEVEL SECURITY; ALTER TABLE kpi_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE interventions ENABLE ROW LEVEL SECURITY; ALTER TABLE interventions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_issuer_keys ON issuer_keys;
CREATE POLICY tenant_isolation_issuer_keys ON issuer_keys FOR ALL USING (org_id = current_app_org_id()) WITH CHECK (org_id = current_app_org_id());
DROP POLICY IF EXISTS tenant_isolation_credentials ON credentials;
CREATE POLICY tenant_isolation_credentials ON credentials FOR ALL USING (org_id = current_app_org_id()) WITH CHECK (org_id = current_app_org_id());
DROP POLICY IF EXISTS tenant_isolation_kpi_snapshots ON kpi_snapshots;
CREATE POLICY tenant_isolation_kpi_snapshots ON kpi_snapshots FOR ALL USING (org_id = current_app_org_id()) WITH CHECK (org_id = current_app_org_id());
DROP POLICY IF EXISTS tenant_isolation_interventions ON interventions;
CREATE POLICY tenant_isolation_interventions ON interventions FOR ALL USING (org_id = current_app_org_id()) WITH CHECK (org_id = current_app_org_id());
GRANT SELECT, INSERT ON issuer_keys, kpi_snapshots, interventions TO app_api;
GRANT SELECT, INSERT, UPDATE ON credentials TO app_api;

-- Public credential verification: anyone holding the credential id may check it. Returns only what the
-- credential itself already discloses (it is shared by the student), plus its status.
CREATE OR REPLACE FUNCTION public_credential(p_id UUID)
RETURNS TABLE (id UUID, payload JSONB, proof_value TEXT, issuer_key_id VARCHAR, public_key_pem TEXT, status VARCHAR, valid_until TIMESTAMPTZ, revoked_reason TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT c.id, c.payload, c.proof_value, c.issuer_key_id, k.public_key_pem, c.status, c.valid_until, c.revoked_reason
    FROM public.credentials c JOIN public.issuer_keys k ON k.id = c.issuer_key_id
   WHERE c.id = p_id;
$$;
REVOKE ALL ON FUNCTION public_credential(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_credential(UUID) TO app_api;

-- Fairness funnel for one drive, as group counts only (AD-10). Callable by officer-equivalent roles of the
-- drive's college. Groups smaller than p_min_group come back with NULL counts.
CREATE OR REPLACE FUNCTION fairness_funnel_counts(p_drive_id UUID, p_dimension TEXT, p_min_group INT DEFAULT 5)
RETURNS TABLE (group_value TEXT, eligible INT, shortlisted INT, offered INT, total INT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_app_user_role() NOT IN ('officer', 'platform_admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: fairness analysis is limited to placement officers.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.drives d WHERE d.id = p_drive_id AND d.org_id = current_app_org_id()) THEN
    RAISE EXCEPTION 'FORBIDDEN: drive is not in the current college.';
  END IF;
  IF p_dimension NOT IN ('gender', 'category', 'branch', 'college_tier') THEN
    RAISE EXCEPTION 'Unknown fairness dimension %', p_dimension;
  END IF;

  RETURN QUERY
  WITH pop AS (
    SELECT s.id AS student_id,
           CASE p_dimension
             WHEN 'gender' THEN COALESCE(g.gender, 'Prefer not to say')
             WHEN 'category' THEN COALESCE(g.category, 'Prefer not to say')
             WHEN 'branch' THEN dep.code
             ELSE COALESCE(o.tier, 'Unspecified')
           END AS grp,
           COALESCE(ed.result = 'eligible', a.id IS NOT NULL) AS is_eligible,
           COALESCE(a.stage IN ('shortlisted', 'interview_scheduled', 'offered', 'offer_accepted', 'offer_declined'), FALSE) AS is_shortlisted,
           COALESCE(a.stage IN ('offered', 'offer_accepted', 'offer_declined'), FALSE) AS is_offered
      FROM public.students s
      JOIN public.departments dep ON dep.id = s.department_id
      JOIN public.organizations o ON o.id = s.org_id
      LEFT JOIN public.student_group_attributes g ON g.student_id = s.id
      LEFT JOIN LATERAL (SELECT e.result FROM public.eligibility_decisions e WHERE e.drive_id = p_drive_id AND e.student_id = s.id ORDER BY e.created_at DESC LIMIT 1) ed ON TRUE
      LEFT JOIN public.applications a ON a.drive_id = p_drive_id AND a.student_id = s.id
     WHERE s.org_id = current_app_org_id() AND (ed.result IS NOT NULL OR a.id IS NOT NULL)
  ), agg AS (
    SELECT grp,
           count(*) FILTER (WHERE is_eligible)::int AS e,
           count(*) FILTER (WHERE is_shortlisted)::int AS sl,
           count(*) FILTER (WHERE is_offered)::int AS o,
           count(*)::int AS t
      FROM pop GROUP BY grp
  )
  SELECT grp::text,
         CASE WHEN t < p_min_group THEN NULL ELSE e END,
         CASE WHEN t < p_min_group THEN NULL ELSE sl END,
         CASE WHEN t < p_min_group THEN NULL ELSE o END,
         CASE WHEN t < p_min_group THEN NULL ELSE t END
    FROM agg ORDER BY grp;
END;
$$;
REVOKE ALL ON FUNCTION fairness_funnel_counts(UUID, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fairness_funnel_counts(UUID, TEXT, INT) TO app_api;

-- What-if fairness for a draft rule (publish-time simulator). The API evaluates the draft rule and passes
-- which students would be selected; this returns per-group counts only. A minimum population blocks
-- difference attacks on tiny selections.
CREATE OR REPLACE FUNCTION fairness_selection_counts(p_population UUID[], p_selected UUID[], p_dimension TEXT, p_min_group INT DEFAULT 5)
RETURNS TABLE (group_value TEXT, selected INT, total INT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_app_user_role() NOT IN ('officer', 'platform_admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: fairness analysis is limited to placement officers.';
  END IF;
  IF COALESCE(array_length(p_population, 1), 0) < 20 THEN
    RAISE EXCEPTION 'Population too small for fairness analysis (minimum 20).';
  END IF;
  IF p_dimension NOT IN ('gender', 'category', 'branch', 'college_tier') THEN
    RAISE EXCEPTION 'Unknown fairness dimension %', p_dimension;
  END IF;

  RETURN QUERY
  WITH pop AS (
    SELECT s.id,
           CASE p_dimension
             WHEN 'gender' THEN COALESCE(g.gender, 'Prefer not to say')
             WHEN 'category' THEN COALESCE(g.category, 'Prefer not to say')
             WHEN 'branch' THEN dep.code
             ELSE COALESCE(o.tier, 'Unspecified')
           END AS grp,
           s.id = ANY (p_selected) AS sel
      FROM public.students s
      JOIN public.departments dep ON dep.id = s.department_id
      JOIN public.organizations o ON o.id = s.org_id
      LEFT JOIN public.student_group_attributes g ON g.student_id = s.id
     WHERE s.id = ANY (p_population) AND s.org_id = current_app_org_id()
  ), agg AS (
    SELECT grp, count(*) FILTER (WHERE sel)::int AS sl, count(*)::int AS t FROM pop GROUP BY grp
  )
  SELECT grp::text, CASE WHEN t < p_min_group THEN NULL ELSE sl END, CASE WHEN t < p_min_group THEN NULL ELSE t END
    FROM agg ORDER BY grp;
END;
$$;
REVOKE ALL ON FUNCTION fairness_selection_counts(UUID[], UUID[], TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fairness_selection_counts(UUID[], UUID[], TEXT, INT) TO app_api;

-- University roll-up (PS p3: university sees aggregates, never student rows). Only a university_admin of
-- the university may call it, and only for its own colleges.
CREATE OR REPLACE FUNCTION university_college_outcomes()
RETURNS TABLE (college_id UUID, college_name VARCHAR, tier VARCHAR, students INT, placed INT, median_ctc_inr NUMERIC,
               verified_skills INT, students_with_verified_skill INT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_app_user_role_exact() <> 'university_admin' THEN
    RAISE EXCEPTION 'FORBIDDEN: university roll-up is limited to university administrators.';
  END IF;
  RETURN QUERY
  SELECT o.id, o.name::varchar, o.tier::varchar,
         (SELECT count(*)::int FROM public.students s WHERE s.org_id = o.id),
         (SELECT count(DISTINCT so.student_id)::int FROM public.student_outcomes so JOIN public.students s ON s.id = so.student_id WHERE s.org_id = o.id AND so.outcome_type = 'placed'),
         (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY so.ctc_inr)::numeric FROM public.student_outcomes so JOIN public.students s ON s.id = so.student_id WHERE s.org_id = o.id AND so.outcome_type = 'placed'),
         (SELECT count(*)::int FROM public.student_skills ss JOIN public.students s ON s.id = ss.student_id WHERE s.org_id = o.id AND ss.state = 'verified'),
         (SELECT count(DISTINCT ss.student_id)::int FROM public.student_skills ss JOIN public.students s ON s.id = ss.student_id WHERE s.org_id = o.id AND ss.state = 'verified')
    FROM public.organizations o
   WHERE o.parent_id = current_app_org_id() AND o.kind = 'college'
   ORDER BY o.name;
END;
$$;
REVOKE ALL ON FUNCTION university_college_outcomes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION university_college_outcomes() TO app_api;

-- Officers record fairness reviews (flags and clearances) on drives in their own college.
GRANT SELECT, INSERT ON fairness_reviews TO app_api;
