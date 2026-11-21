-- A recruiter key can prove that its holder controls a company domain, by publishing a file on that domain.
-- This shows control of the domain at one moment. It does not show that the company authorised the recruiter.

ALTER TABLE signing_keys ADD COLUMN IF NOT EXISTS domain VARCHAR(253);
ALTER TABLE signing_keys ADD COLUMN IF NOT EXISTS domain_challenge VARCHAR(64);
ALTER TABLE signing_keys ADD COLUMN IF NOT EXISTS domain_verified_at TIMESTAMPTZ;

GRANT UPDATE (domain, domain_challenge, domain_verified_at) ON signing_keys TO app_api;

-- The university's audit now also sees the verified domain of each recruiter key.
DROP FUNCTION IF EXISTS witness_college_offers(UUID);
CREATE FUNCTION witness_college_offers(p_college UUID)
RETURNS TABLE (seq BIGINT, payload JSONB, key_registered_at TIMESTAMPTZ, key_domain TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = p_college AND o.parent_id = current_app_org_id()) THEN RAISE EXCEPTION 'NOT_YOUR_COLLEGE'; END IF;
    RETURN QUERY SELECT e.seq, e.payload,
        (SELECT min(s.registered_at) FROM signing_keys s WHERE s.org_id = p_college AND s.owner_kind = 'recruiter' AND s.key_id = e.payload -> 'offer' ->> 'recruiterKeyId'),
        (SELECT s.domain::text FROM signing_keys s WHERE s.org_id = p_college AND s.owner_kind = 'recruiter' AND s.key_id = e.payload -> 'offer' ->> 'recruiterKeyId' AND s.domain_verified_at IS NOT NULL ORDER BY s.registered_at LIMIT 1)
      FROM ledger_entries e WHERE e.org_id = p_college AND e.kind = 'offer_accepted' ORDER BY e.seq;
END;
$$;
REVOKE ALL ON FUNCTION witness_college_offers(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION witness_college_offers(UUID) TO app_api;
