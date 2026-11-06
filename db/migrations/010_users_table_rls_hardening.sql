-- ==============================================================================
-- PRAMAAN MIGRATION 010: USERS TABLE ROW LEVEL SECURITY HARDENING
-- ==============================================================================
-- 1. Enables and forces Row-Level Security on the users table.
-- 2. Defines tenant/user scoped SELECT policy under app_api:
--    A user can only read their own user record or users affiliated with
--    the currently scoped college tenant via active memberships.
-- 3. Grants explicit SELECT privilege on users to app_api.
-- ==============================================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_users ON users;

CREATE POLICY tenant_isolation_users ON users
    FOR SELECT TO app_api
    USING (
        id = current_app_user_id()
        OR id IN (
            SELECT user_id FROM public.memberships WHERE org_id = current_app_org_id()
        )
    );

GRANT SELECT ON users TO app_api;
