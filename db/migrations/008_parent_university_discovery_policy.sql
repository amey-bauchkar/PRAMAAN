-- ==============================================================================
-- PRAMAAN MIGRATION 008: PARENT UNIVERSITY DISCOVERY RELATIONSHIP POLICY
-- ==============================================================================
-- Restricts university discovery so that colleges only discover their own
-- direct parent university, rather than all global universities.
-- ==============================================================================

-- 1. Helper function to look up the parent_id of the currently scoped tenant
CREATE OR REPLACE FUNCTION current_app_parent_org_id()
RETURNS UUID
SECURITY DEFINER
SET search_path = pg_catalog, public
LANGUAGE sql STABLE AS $$
  SELECT parent_id FROM public.organizations WHERE id = current_app_org_id();
$$;

-- Grant execution to application runtime roles
REVOKE ALL ON FUNCTION current_app_parent_org_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION current_app_parent_org_id() TO app_api, pramaan_app_user;

-- 2. Update Row-Level Security policy on organizations table
DROP POLICY IF EXISTS tenant_isolation_organizations ON organizations;

CREATE POLICY tenant_isolation_organizations ON organizations
    FOR SELECT TO app_api
    USING (
      id = current_app_org_id()
      OR id = current_app_parent_org_id()
      OR parent_id = current_app_org_id()
    );

