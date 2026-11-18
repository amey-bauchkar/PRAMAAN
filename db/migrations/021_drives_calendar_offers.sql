-- ==============================================================================
-- PRAMAAN MIGRATION 021: DRIVE ROUNDS, CLASH-FREE CALENDAR, OFFERS & IMMUTABLE STAGE HISTORY (v2 B9, B10)
-- ==============================================================================
-- The database itself rejects a double-booked room, interview panel or student (exclusion constraints).
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    capacity INT NOT NULL CHECK (capacity > 0),
    UNIQUE (org_id, name)
);

CREATE TABLE IF NOT EXISTS drive_rounds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    drive_id UUID NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
    kind VARCHAR(30) NOT NULL CHECK (kind IN ('pre_placement_talk', 'aptitude', 'technical_test', 'group_discussion', 'interview', 'hr')),
    title VARCHAR(200) NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    room_id UUID REFERENCES rooms(id),
    status VARCHAR(20) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('proposed', 'scheduled', 'completed', 'cancelled')),
    CHECK (ends_at > starts_at),
    CONSTRAINT excl_room_double_booking EXCLUDE USING gist (room_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
        WHERE (room_id IS NOT NULL AND status IN ('scheduled', 'completed'))
);

CREATE TABLE IF NOT EXISTS interview_slots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    round_id UUID NOT NULL REFERENCES drive_rounds(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    panel VARCHAR(100) NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'no_show', 'cancelled')),
    CHECK (ends_at > starts_at),
    CONSTRAINT excl_student_double_booking EXCLUDE USING gist (student_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
        WHERE (status <> 'cancelled'),
    CONSTRAINT excl_panel_double_booking EXCLUDE USING gist (panel WITH =, tstzrange(starts_at, ends_at) WITH &&)
        WHERE (status <> 'cancelled')
);

-- Application stages: add assessment and offer responses; keep the history append-only.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname FROM pg_constraint con
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
     WHERE con.conrelid = 'applications'::regclass AND con.contype = 'c' AND att.attname = 'stage'
  LOOP
    EXECUTE format('ALTER TABLE applications DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE applications ADD CONSTRAINT applications_stage_check CHECK (stage IN (
  'applied', 'assessment', 'shortlisted', 'interview_scheduled', 'offered', 'offer_accepted', 'offer_declined', 'rejected', 'withdrawn'
));

CREATE TABLE IF NOT EXISTS application_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    from_stage VARCHAR(30),
    to_stage VARCHAR(30) NOT NULL,
    actor_membership_id UUID REFERENCES memberships(id),
    note TEXT,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE FUNCTION prevent_append_only_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is append-only.', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_application_events_append_only ON application_events;
CREATE TRIGGER trg_application_events_append_only BEFORE UPDATE OR DELETE ON application_events
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();

CREATE TABLE IF NOT EXISTS offers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL UNIQUE REFERENCES applications(id) ON DELETE CASCADE,
    ctc_inr NUMERIC(12,2) NOT NULL CHECK (ctc_inr > 0),
    joining_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'extended' CHECK (status IN ('extended', 'accepted', 'declined', 'revoked')),
    extended_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    responded_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS recruiter_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    round_kind VARCHAR(30) NOT NULL,
    recruiter_membership_id UUID NOT NULL REFERENCES memberships(id),
    rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    strengths TEXT,
    concerns TEXT,
    recommendation VARCHAR(10) NOT NULL CHECK (recommendation IN ('advance', 'hold', 'reject')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RLS ---------------------------------------------------------------------------
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;              ALTER TABLE rooms FORCE ROW LEVEL SECURITY;
ALTER TABLE drive_rounds ENABLE ROW LEVEL SECURITY;       ALTER TABLE drive_rounds FORCE ROW LEVEL SECURITY;
ALTER TABLE interview_slots ENABLE ROW LEVEL SECURITY;    ALTER TABLE interview_slots FORCE ROW LEVEL SECURITY;
ALTER TABLE application_events ENABLE ROW LEVEL SECURITY; ALTER TABLE application_events FORCE ROW LEVEL SECURITY;
ALTER TABLE offers ENABLE ROW LEVEL SECURITY;             ALTER TABLE offers FORCE ROW LEVEL SECURITY;
ALTER TABLE recruiter_feedback ENABLE ROW LEVEL SECURITY; ALTER TABLE recruiter_feedback FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_rooms ON rooms;
CREATE POLICY tenant_isolation_rooms ON rooms FOR ALL
    USING (org_id = current_app_org_id()) WITH CHECK (org_id = current_app_org_id());
DROP POLICY IF EXISTS tenant_isolation_drive_rounds ON drive_rounds;
CREATE POLICY tenant_isolation_drive_rounds ON drive_rounds FOR ALL
    USING (drive_id IN (SELECT id FROM drives WHERE org_id = current_app_org_id()))
    WITH CHECK (drive_id IN (SELECT id FROM drives WHERE org_id = current_app_org_id()));
DROP POLICY IF EXISTS tenant_isolation_interview_slots ON interview_slots;
CREATE POLICY tenant_isolation_interview_slots ON interview_slots FOR ALL
    USING (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()))
    WITH CHECK (student_id IN (SELECT id FROM students WHERE org_id = current_app_org_id()));
DROP POLICY IF EXISTS tenant_isolation_application_events ON application_events;
CREATE POLICY tenant_isolation_application_events ON application_events FOR ALL
    USING (application_id IN (SELECT a.id FROM applications a JOIN drives d ON d.id = a.drive_id WHERE d.org_id = current_app_org_id()))
    WITH CHECK (application_id IN (SELECT a.id FROM applications a JOIN drives d ON d.id = a.drive_id WHERE d.org_id = current_app_org_id()));
DROP POLICY IF EXISTS tenant_isolation_offers ON offers;
CREATE POLICY tenant_isolation_offers ON offers FOR ALL
    USING (application_id IN (SELECT a.id FROM applications a JOIN drives d ON d.id = a.drive_id WHERE d.org_id = current_app_org_id()))
    WITH CHECK (application_id IN (SELECT a.id FROM applications a JOIN drives d ON d.id = a.drive_id WHERE d.org_id = current_app_org_id()));
DROP POLICY IF EXISTS tenant_isolation_recruiter_feedback ON recruiter_feedback;
CREATE POLICY tenant_isolation_recruiter_feedback ON recruiter_feedback FOR ALL
    USING (application_id IN (SELECT a.id FROM applications a JOIN drives d ON d.id = a.drive_id WHERE d.org_id = current_app_org_id()))
    WITH CHECK (application_id IN (SELECT a.id FROM applications a JOIN drives d ON d.id = a.drive_id WHERE d.org_id = current_app_org_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON rooms, drive_rounds, interview_slots, offers TO app_api;
GRANT SELECT, INSERT ON application_events, recruiter_feedback TO app_api;
