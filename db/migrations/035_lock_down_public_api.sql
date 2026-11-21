-- Supabase gives its public roles `anon` and `authenticated` access to everything created in `public`, and exposes that schema through its
-- REST interface to anyone holding the public anon key. PRAMAAN never uses that interface: the API connects directly as the restricted
-- `app_api` role and the web app uses Supabase only to sign in. So these roles get nothing here, including the SECURITY DEFINER
-- functions (claim_invitation, erase_student_data, resolve_user_identity and others) that must only be reached through our API.
-- Guarded so it does nothing on a plain PostgreSQL that has no such roles (local tests, self-hosting).
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      -- New objects created by the migration role must not be granted to them either.
      EXECUTE format('ALTER DEFAULT PRIVILEGES REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES REVOKE ALL ON FUNCTIONS FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END $$;

-- Functions are executable by PUBLIC unless revoked, and anon/authenticated are members of PUBLIC. Definer functions that were left open to
-- PUBLIC are given explicitly to PRAMAAN's own roles first, so nothing they rely on stops working, and then closed to everyone else.
DO $$
DECLARE f RECORD; r TEXT;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig, p.oid AS oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prosecdef
              AND has_function_privilege('public', p.oid, 'EXECUTE') LOOP
    FOREACH r IN ARRAY ARRAY['app_api', 'fairness_job', 'ai_worker'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', f.sig, r); END IF;
    END LOOP;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
  END LOOP;
END $$;
