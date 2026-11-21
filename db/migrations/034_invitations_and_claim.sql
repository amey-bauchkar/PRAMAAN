-- Real onboarding. Nobody can create their own college record: a college officer invites a person, the person receives a
-- one-time link at their college email, and signs in and opens the link to claim it. Until then a verified login that has no
-- record gets 403 (UNREGISTERED_IDENTITY).
--
-- Only a SHA-256 hash of the link token is stored, so a leaked database cannot be used to claim anything.
CREATE TABLE IF NOT EXISTS pending_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,                 -- the college address the link was sent to, lower case
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(30) NOT NULL CHECK (role IN ('student', 'mentor', 'dept_coordinator', 'officer', 'college_admin')),
    department_id UUID REFERENCES departments(id),
    enrollment_no VARCHAR(50),
    graduating_year INT,
    program_level VARCHAR(20) NOT NULL DEFAULT 'undergraduate',
    date_of_birth DATE,                          -- required for students: age decides which checks apply (no behavioural checks under 18)
    token_hash CHAR(64) NOT NULL UNIQUE,
    status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'revoked')),
    invited_by UUID REFERENCES memberships(id),
    expires_at TIMESTAMPTZ NOT NULL,
    claimed_at TIMESTAMPTZ,
    claimed_user_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_invite_student_fields CHECK (role <> 'student' OR (enrollment_no IS NOT NULL AND graduating_year IS NOT NULL AND department_id IS NOT NULL AND date_of_birth IS NOT NULL)),
    CONSTRAINT chk_invite_coordinator_department CHECK (role <> 'dept_coordinator' OR department_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_invite_person ON pending_invites (org_id, lower(email), role) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_pending_invites_org ON pending_invites (org_id, created_at DESC);

ALTER TABLE pending_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_invites FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_pending_invites ON pending_invites;
CREATE POLICY tenant_isolation_pending_invites ON pending_invites FOR ALL
    USING (org_id = current_app_org_id()) WITH CHECK (org_id = current_app_org_id());
GRANT SELECT, INSERT, UPDATE ON pending_invites TO app_api;

-- The claim. The person has no record yet, so there is no college to scope to: this runs with definer rights, checks everything
-- itself, and is the only way a users row, membership or student record is created from a login.
--   p_email_verified: the login's email if the identity provider verified it, else NULL.
--   p_provider: 'email' (password or magic link) or another provider such as 'github'. With 'email' the verified email must equal the
--   invited address. With another provider the one-time token alone proves the inbox, because GitHub emails are often private or not
--   the college address.
CREATE OR REPLACE FUNCTION claim_invitation(p_token_hash TEXT, p_auth_subject TEXT, p_email_verified TEXT, p_provider TEXT)
RETURNS TABLE (out_org_id UUID, out_role TEXT, out_user_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v pending_invites%ROWTYPE;
  v_user UUID;
BEGIN
  IF p_auth_subject IS NULL OR length(p_auth_subject) < 3 THEN RAISE EXCEPTION 'INVITE_INVALID'; END IF;

  SELECT * INTO v FROM pending_invites WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVITE_INVALID'; END IF;
  IF v.status = 'claimed' THEN RAISE EXCEPTION 'INVITE_USED'; END IF;
  IF v.status = 'revoked' THEN RAISE EXCEPTION 'INVITE_REVOKED'; END IF;
  IF v.expires_at < now() THEN RAISE EXCEPTION 'INVITE_EXPIRED'; END IF;

  IF coalesce(p_provider, 'email') = 'email' THEN
    IF p_email_verified IS NULL THEN RAISE EXCEPTION 'EMAIL_NOT_VERIFIED'; END IF;
    IF lower(p_email_verified) <> lower(v.email) THEN RAISE EXCEPTION 'INVITE_EMAIL_MISMATCH'; END IF;
  END IF;

  SELECT u.id INTO v_user FROM users u WHERE u.auth_subject = p_auth_subject;
  IF v_user IS NULL THEN
    -- The college address is already used by a different login: refuse rather than merge two people.
    IF EXISTS (SELECT 1 FROM users u WHERE lower(u.email) = lower(v.email)) THEN RAISE EXCEPTION 'EMAIL_IN_USE'; END IF;
    INSERT INTO users (auth_subject, email, full_name) VALUES (p_auth_subject, lower(v.email), v.full_name) RETURNING id INTO v_user;
  END IF;

  -- One role per person per college keeps "who is this request acting as" unambiguous. A second role needs an officer's decision, not a link.
  IF EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = v_user AND m.org_id = v.org_id AND m.role <> v.role AND m.status = 'active') THEN
    RAISE EXCEPTION 'ALREADY_MEMBER_OTHER_ROLE';
  END IF;

  INSERT INTO memberships (user_id, org_id, department_id, role) VALUES (v_user, v.org_id, v.department_id, v.role)
    ON CONFLICT (user_id, org_id, role) DO UPDATE SET status = 'active', department_id = EXCLUDED.department_id;

  IF v.role = 'student' THEN
    INSERT INTO students (org_id, user_id, department_id, enrollment_no, graduating_year, program_level, date_of_birth, is_minor)
      VALUES (v.org_id, v_user, v.department_id, v.enrollment_no, v.graduating_year, v.program_level, v.date_of_birth, v.date_of_birth > (CURRENT_DATE - INTERVAL '18 years')::date)
      ON CONFLICT (org_id, user_id) DO NOTHING;
  END IF;

  UPDATE pending_invites SET status = 'claimed', claimed_at = now(), claimed_user_id = v_user WHERE id = v.id;
  RETURN QUERY SELECT v.org_id, v.role::text, v_user;
END $$;
REVOKE ALL ON FUNCTION claim_invitation(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_invitation(TEXT, TEXT, TEXT, TEXT) TO app_api;
