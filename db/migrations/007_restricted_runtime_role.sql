-- ==============================================================================
-- PRAMAAN MIGRATION 007: RESTRICTED RUNTIME ROLE & SCOPED IDENTITY RESOLUTION
-- ==============================================================================

-- 1. Create dedicated restricted runtime application login (No superuser, NOBYPASSRLS)
-- NOTE: Passwords must NEVER be embedded in migrations or version control.
-- Production credentials are provisioned out-of-band via secure DBA channels.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pramaan_app_user') THEN
    CREATE ROLE pramaan_app_user WITH LOGIN NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  ELSE
    ALTER ROLE pramaan_app_user NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO pramaan_app_user;
GRANT app_api TO pramaan_app_user;

-- 2. Narrowly scoped pre-tenant identity resolution function (SECURITY DEFINER)
-- Hardened:
-- - Explicit search_path = pg_catalog, public to prevent search-path hijacking / object shadowing
-- - Fully qualified object names (public.users, public.memberships)
-- - Strictly queries by verified auth_subject UUID (NEVER by email, preventing account takeover)
-- - Returns strictly the minimal metadata required for session context initialization
CREATE OR REPLACE FUNCTION resolve_user_identity(p_auth_subject TEXT)
RETURNS TABLE (
    user_id UUID,
    auth_subject VARCHAR,
    email VARCHAR,
    full_name VARCHAR,
    user_created_at TIMESTAMPTZ,
    membership_id UUID,
    org_id UUID,
    department_id UUID,
    role VARCHAR,
    status VARCHAR,
    membership_created_at TIMESTAMPTZ
)
SECURITY DEFINER
SET search_path = pg_catalog, public
LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT 
        u.id as user_id,
        u.auth_subject,
        u.email,
        u.full_name,
        u.created_at as user_created_at,
        m.id as membership_id,
        m.org_id,
        m.department_id,
        m.role,
        m.status,
        m.created_at as membership_created_at
    FROM public.users u
    LEFT JOIN public.memberships m ON m.user_id = u.id
    WHERE u.auth_subject = p_auth_subject;
END;
$$;

-- 3. Lock down permissions: Execute revoked from PUBLIC, granted strictly to runtime roles
REVOKE ALL ON FUNCTION resolve_user_identity(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_user_identity(TEXT) TO pramaan_app_user, app_api;
