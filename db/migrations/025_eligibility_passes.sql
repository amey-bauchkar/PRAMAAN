-- ==============================================================================
-- PRAMAAN MIGRATION 025: PRIVACY-PRESERVING ELIGIBILITY PASSES (SD-JWT, RFC 9901)
-- ==============================================================================
-- The college signs facts about a student's eligibility for one drive as an SD-JWT bound to a key that
-- lives in the student's browser. The student shows a verifier only the facts they choose (e.g. "CGPA ≥ 7.5:
-- met" instead of the CGPA), bound to the verifier's one-time request so it cannot be replayed. The
-- signed token itself is never stored server-side.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS eligibility_passes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    drive_id UUID NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
    decision_id UUID NOT NULL REFERENCES eligibility_decisions(id) ON DELETE CASCADE,
    issuer_key_id VARCHAR(80) NOT NULL REFERENCES issuer_keys(id),
    holder_key_thumbprint VARCHAR(64) NOT NULL,
    selective_claims TEXT[] NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    issued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);

-- One-time verifier requests (nonce + audience). Created and consumed only through the functions below.
CREATE TABLE IF NOT EXISTS pass_requests (
    nonce VARCHAR(64) PRIMARY KEY,
    audience VARCHAR(120) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    consumed_at TIMESTAMPTZ
);

ALTER TABLE eligibility_passes ENABLE ROW LEVEL SECURITY; ALTER TABLE eligibility_passes FORCE ROW LEVEL SECURITY;
ALTER TABLE pass_requests ENABLE ROW LEVEL SECURITY;      ALTER TABLE pass_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_eligibility_passes ON eligibility_passes;
CREATE POLICY tenant_isolation_eligibility_passes ON eligibility_passes FOR ALL
    USING (org_id = current_app_org_id()) WITH CHECK (org_id = current_app_org_id());
-- pass_requests has no policy for app roles: only the SECURITY DEFINER functions touch it.
GRANT SELECT, INSERT, UPDATE ON eligibility_passes TO app_api;

CREATE OR REPLACE FUNCTION create_pass_request(p_audience TEXT) RETURNS TABLE (nonce VARCHAR, audience VARCHAR, created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_nonce VARCHAR := encode(gen_random_bytes(18), 'hex');
BEGIN
  IF p_audience IS NULL OR length(p_audience) < 3 OR length(p_audience) > 120 THEN
    RAISE EXCEPTION 'Invalid verifier name.';
  END IF;
  DELETE FROM public.pass_requests r WHERE r.created_at < now() - interval '1 day';
  INSERT INTO public.pass_requests (nonce, audience) VALUES (v_nonce, p_audience);
  RETURN QUERY SELECT r.nonce, r.audience, r.created_at FROM public.pass_requests r WHERE r.nonce = v_nonce;
END;
$$;

-- Marks a request used; returns its audience only if it existed, was unused and is under 15 minutes old.
CREATE OR REPLACE FUNCTION consume_pass_request(p_nonce TEXT) RETURNS VARCHAR
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_aud VARCHAR;
BEGIN
  UPDATE public.pass_requests r SET consumed_at = now()
   WHERE r.nonce = p_nonce AND r.consumed_at IS NULL AND r.created_at > now() - interval '15 minutes'
  RETURNING r.audience INTO v_aud;
  RETURN v_aud;
END;
$$;

CREATE OR REPLACE FUNCTION public_pass_status(p_pass_id UUID)
RETURNS TABLE (status VARCHAR, expires_at TIMESTAMPTZ, issuer_key_id VARCHAR, public_key_pem TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p.status, p.expires_at, p.issuer_key_id, k.public_key_pem
    FROM public.eligibility_passes p JOIN public.issuer_keys k ON k.id = p.issuer_key_id WHERE p.id = p_pass_id;
$$;

REVOKE ALL ON FUNCTION create_pass_request(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION consume_pass_request(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public_pass_status(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_pass_request(TEXT), consume_pass_request(TEXT), public_pass_status(UUID) TO app_api;
