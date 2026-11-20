-- Placement ledger: recruiter-signed offers, student-signed acceptances, and an append-only Merkle log with signed checkpoints.
-- Anyone can recompute the tree from the public leaf hashes; nothing personal is published.

-- Public keys people sign with (the private keys never leave their browsers).
CREATE TABLE IF NOT EXISTS signing_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    owner_kind VARCHAR(20) NOT NULL CHECK (owner_kind IN ('recruiter', 'student', 'witness')),
    owner_id UUID NOT NULL,                       -- memberships.id for a recruiter or a witness, students.id for a student
    key_id VARCHAR(32) NOT NULL,
    public_jwk JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    registered_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (org_id, owner_kind, owner_id, key_id)
);

-- The offer a recruiter signed. The offers row keeps the workflow state; this keeps the proof.
CREATE TABLE IF NOT EXISTS signed_offers (
    offer_id UUID PRIMARY KEY REFERENCES offers(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    statement JSONB NOT NULL,
    offer_hash VARCHAR(64) NOT NULL,
    recruiter_sig TEXT NOT NULL,
    recruiter_key JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE offers ADD COLUMN IF NOT EXISTS signed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS ledger_seq BIGINT;

CREATE TABLE IF NOT EXISTS ledger_entries (
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    seq BIGINT NOT NULL CHECK (seq >= 1),
    kind VARCHAR(30) NOT NULL CHECK (kind IN ('offer_accepted', 'rule_published', 'decisions_published')),
    payload JSONB NOT NULL,
    leaf_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (org_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_leaf ON ledger_entries (org_id, leaf_hash);

CREATE TABLE IF NOT EXISTS ledger_checkpoints (
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    tree_size BIGINT NOT NULL CHECK (tree_size >= 1),
    root_hash VARCHAR(64) NOT NULL,
    signed_at TIMESTAMPTZ NOT NULL,
    signature TEXT NOT NULL,
    key_id VARCHAR(64) NOT NULL,
    PRIMARY KEY (org_id, tree_size)
);

-- Entries and checkpoints can be added but never changed or removed.
CREATE OR REPLACE FUNCTION ledger_append_only() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION '% is append-only: UPDATE and DELETE are not allowed.', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_ledger_entries_immutable ON ledger_entries;
CREATE TRIGGER trg_ledger_entries_immutable BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION ledger_append_only();
DROP TRIGGER IF EXISTS trg_ledger_checkpoints_immutable ON ledger_checkpoints;
CREATE TRIGGER trg_ledger_checkpoints_immutable BEFORE UPDATE OR DELETE ON ledger_checkpoints FOR EACH ROW EXECUTE FUNCTION ledger_append_only();

ALTER TABLE signing_keys ENABLE ROW LEVEL SECURITY;      ALTER TABLE signing_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE signed_offers ENABLE ROW LEVEL SECURITY;     ALTER TABLE signed_offers FORCE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;    ALTER TABLE ledger_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE ledger_checkpoints ENABLE ROW LEVEL SECURITY; ALTER TABLE ledger_checkpoints FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_signing_keys ON signing_keys;
CREATE POLICY tenant_isolation_signing_keys ON signing_keys FOR ALL USING (org_id = current_app_org_id()) WITH CHECK (org_id = current_app_org_id());
DROP POLICY IF EXISTS tenant_isolation_signed_offers ON signed_offers;
CREATE POLICY tenant_isolation_signed_offers ON signed_offers FOR ALL USING (org_id = current_app_org_id()) WITH CHECK (org_id = current_app_org_id());
DROP POLICY IF EXISTS tenant_isolation_ledger_entries ON ledger_entries;
CREATE POLICY tenant_isolation_ledger_entries ON ledger_entries FOR ALL USING (org_id = current_app_org_id()) WITH CHECK (org_id = current_app_org_id());
DROP POLICY IF EXISTS tenant_isolation_ledger_checkpoints ON ledger_checkpoints;
CREATE POLICY tenant_isolation_ledger_checkpoints ON ledger_checkpoints FOR ALL USING (org_id = current_app_org_id()) WITH CHECK (org_id = current_app_org_id());

GRANT SELECT, INSERT ON signing_keys, signed_offers, ledger_entries, ledger_checkpoints TO app_api;
GRANT UPDATE (status) ON signing_keys TO app_api;
GRANT UPDATE (signed, ledger_seq) ON offers TO app_api;

-- Public reads for the verifier page. They return hashes and signed checkpoints only, never entry contents.
CREATE OR REPLACE FUNCTION public_ledger_head(p_org UUID)
RETURNS TABLE (org_name TEXT, tree_size BIGINT, root_hash TEXT, signed_at TIMESTAMPTZ, signature TEXT, key_id TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT o.name::text, c.tree_size, c.root_hash::text, c.signed_at, c.signature, c.key_id::text
      FROM ledger_checkpoints c JOIN organizations o ON o.id = c.org_id
     WHERE c.org_id = p_org ORDER BY c.tree_size DESC LIMIT 1;
$$;
CREATE OR REPLACE FUNCTION public_ledger_leaves(p_org UUID)
RETURNS TABLE (seq BIGINT, kind TEXT, leaf_hash TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT e.seq, e.kind::text, e.leaf_hash::text, e.created_at FROM ledger_entries e WHERE e.org_id = p_org ORDER BY e.seq;
$$;
CREATE OR REPLACE FUNCTION public_ledger_checkpoints(p_org UUID)
RETURNS TABLE (tree_size BIGINT, root_hash TEXT, signed_at TIMESTAMPTZ, signature TEXT, key_id TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT c.tree_size, c.root_hash::text, c.signed_at, c.signature, c.key_id::text FROM ledger_checkpoints c WHERE c.org_id = p_org ORDER BY c.tree_size;
$$;
REVOKE ALL ON FUNCTION public_ledger_head(UUID), public_ledger_leaves(UUID), public_ledger_checkpoints(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_ledger_head(UUID), public_ledger_leaves(UUID), public_ledger_checkpoints(UUID) TO app_api;

-- Witnessing: the university signs the college's checkpoints with a key the college does not hold. Once a state has been
-- witnessed, the college cannot rewrite history and re-sign it without the mismatch showing.
CREATE TABLE IF NOT EXISTS ledger_witness_cosignatures (
    college_org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    tree_size BIGINT NOT NULL CHECK (tree_size >= 1),
    root_hash VARCHAR(64) NOT NULL,
    witness_org_id UUID NOT NULL REFERENCES organizations(id),
    witness_key_id VARCHAR(32) NOT NULL,
    signature TEXT NOT NULL,
    cosigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (college_org_id, tree_size, witness_key_id)
);
ALTER TABLE ledger_witness_cosignatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_witness_cosignatures FORCE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS trg_ledger_witness_immutable ON ledger_witness_cosignatures;
CREATE TRIGGER trg_ledger_witness_immutable BEFORE UPDATE OR DELETE ON ledger_witness_cosignatures FOR EACH ROW EXECUTE FUNCTION ledger_append_only();

-- Colleges under the caller's university, with their newest checkpoint and the newest state this university witnessed.
CREATE OR REPLACE FUNCTION witness_colleges()
RETURNS TABLE (college_id UUID, college_name TEXT, tree_size BIGINT, root_hash TEXT, signed_at TIMESTAMPTZ, witnessed_size BIGINT, witnessed_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT o.id, o.name::text, c.tree_size, c.root_hash::text, c.signed_at,
           (SELECT max(w.tree_size) FROM ledger_witness_cosignatures w WHERE w.college_org_id = o.id AND w.witness_org_id = current_app_org_id()),
           (SELECT max(w.cosigned_at) FROM ledger_witness_cosignatures w WHERE w.college_org_id = o.id AND w.witness_org_id = current_app_org_id())
      FROM organizations o
      JOIN LATERAL (SELECT * FROM ledger_checkpoints k WHERE k.org_id = o.id ORDER BY k.tree_size DESC LIMIT 1) c ON TRUE
     WHERE o.parent_id = current_app_org_id() AND o.kind = 'college' ORDER BY o.name;
$$;

-- p_at is the witness's own signed time, checked by the API to be close to the server clock.
CREATE OR REPLACE FUNCTION witness_cosign(p_college UUID, p_size BIGINT, p_root TEXT, p_key_id TEXT, p_sig TEXT, p_at TIMESTAMPTZ) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = p_college AND o.parent_id = current_app_org_id()) THEN RAISE EXCEPTION 'NOT_YOUR_COLLEGE'; END IF;
    IF NOT EXISTS (SELECT 1 FROM ledger_checkpoints c WHERE c.org_id = p_college AND c.tree_size = p_size AND c.root_hash = p_root) THEN RAISE EXCEPTION 'NO_SUCH_CHECKPOINT'; END IF;
    IF NOT EXISTS (SELECT 1 FROM signing_keys k WHERE k.org_id = current_app_org_id() AND k.owner_kind = 'witness' AND k.key_id = p_key_id AND k.status = 'active') THEN RAISE EXCEPTION 'UNKNOWN_WITNESS_KEY'; END IF;
    INSERT INTO ledger_witness_cosignatures (college_org_id, tree_size, root_hash, witness_org_id, witness_key_id, signature, cosigned_at) VALUES (p_college, p_size, p_root, current_app_org_id(), p_key_id, p_sig, p_at) ON CONFLICT DO NOTHING;
END;
$$;

-- The accepted offers of a college under the caller's university, so the witnessing university can audit a sample itself
-- instead of relying on the college to audit itself. Only entries of kind offer_accepted, and only for the parent university.
CREATE OR REPLACE FUNCTION witness_college_offers(p_college UUID)
RETURNS TABLE (seq BIGINT, payload JSONB, key_registered_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = p_college AND o.parent_id = current_app_org_id()) THEN RAISE EXCEPTION 'NOT_YOUR_COLLEGE'; END IF;
    RETURN QUERY SELECT e.seq, e.payload,
        (SELECT min(s.registered_at) FROM signing_keys s WHERE s.org_id = p_college AND s.owner_kind = 'recruiter' AND s.key_id = e.payload -> 'offer' ->> 'recruiterKeyId')
      FROM ledger_entries e WHERE e.org_id = p_college AND e.kind = 'offer_accepted' ORDER BY e.seq;
END;
$$;

CREATE OR REPLACE FUNCTION public_ledger_witnesses(p_org UUID)
RETURNS TABLE (tree_size BIGINT, root_hash TEXT, witness_name TEXT, witness_key_id TEXT, public_jwk JSONB, signature TEXT, cosigned_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT w.tree_size, w.root_hash::text, o.name::text, w.witness_key_id::text, k.public_jwk, w.signature, w.cosigned_at
      FROM ledger_witness_cosignatures w JOIN organizations o ON o.id = w.witness_org_id
      LEFT JOIN signing_keys k ON k.org_id = w.witness_org_id AND k.owner_kind = 'witness' AND k.key_id = w.witness_key_id
     WHERE w.college_org_id = p_org ORDER BY w.tree_size;
$$;
REVOKE ALL ON FUNCTION witness_colleges(), witness_cosign(UUID, BIGINT, TEXT, TEXT, TEXT, TIMESTAMPTZ), witness_college_offers(UUID), public_ledger_witnesses(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION witness_colleges(), witness_cosign(UUID, BIGINT, TEXT, TEXT, TEXT, TIMESTAMPTZ), witness_college_offers(UUID), public_ledger_witnesses(UUID) TO app_api;
