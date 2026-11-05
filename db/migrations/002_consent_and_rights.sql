-- ==============================================================================
-- PRAMAAN MIGRATION 002: CONSENT AND RIGHTS (DPDP ACT COMPLIANT)
-- ==============================================================================

-- Consent Purposes Catalog
CREATE TABLE IF NOT EXISTS consent_purposes (
    code VARCHAR(50) PRIMARY KEY,
    description TEXT NOT NULL,
    version INT NOT NULL DEFAULT 1,
    requires_guardian_for_minor BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO consent_purposes (code, description, version, requires_guardian_for_minor) VALUES
    ('placement_operations', 'Processing student academic data and verified skills for campus recruitment drives.', 1, TRUE),
    ('repo_verification', 'Read-only static parsing of student-consented code repositories to extract skill evidence.', 1, TRUE),
    ('recruiter_sharing', 'Displaying student skill evidence cards and passport verification records to verified recruiters.', 1, TRUE),
    ('analytics_research', 'Aggregating anonymized cohort performance and institutional outcome statistics.', 1, FALSE),
    ('model_evaluation', 'Opt-in evaluation of grounded question quality using anonymized repository code spans.', 1, FALSE)
ON CONFLICT (code) DO NOTHING;

-- Consent Grants Ledger (Append-only state history)
CREATE TABLE IF NOT EXISTS consent_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    purpose VARCHAR(50) NOT NULL REFERENCES consent_purposes(code),
    notice_version INT NOT NULL,
    scope JSONB NOT NULL DEFAULT '{}'::jsonb,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_consent_grants_active ON consent_grants (student_id, purpose) WHERE revoked_at IS NULL;

-- Guardian Consents for Minors
CREATE TABLE IF NOT EXISTS guardian_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    guardian_name VARCHAR(255) NOT NULL,
    relationship VARCHAR(50) NOT NULL,
    verification_ref VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'verified' CHECK (status IN ('pending', 'verified', 'rejected')),
    verified_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Data Subject Rights Requests (DPDP / Access / Erasure)
CREATE TABLE IF NOT EXISTS data_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    type VARCHAR(30) NOT NULL CHECK (type IN ('access', 'correction', 'erasure', 'grievance')),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'rejected')),
    due_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    exception_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

