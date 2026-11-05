-- ==============================================================================
-- PRAMAAN MIGRATION 005: PLACEMENT DRIVES, ELIGIBILITY AND RECRUITER PIPELINE
-- ==============================================================================

-- Companies
CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    industry VARCHAR(100) NOT NULL,
    contact_email VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Job Roles
CREATE TABLE IF NOT EXISTS job_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Job Role Required Skills
CREATE TABLE IF NOT EXISTS job_role_skills (
    role_id UUID NOT NULL REFERENCES job_roles(id) ON DELETE CASCADE,
    skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    min_level INT NOT NULL DEFAULT 1,
    PRIMARY KEY (role_id, skill_id)
);

-- Placement Drives (Calendar Events)
CREATE TABLE IF NOT EXISTS drives (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    venue_resource VARCHAR(100) NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'in_progress', 'completed', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Eligibility Rule Sets and Immutable Versions
CREATE TABLE IF NOT EXISTS eligibility_rule_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS eligibility_rule_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_set_id UUID NOT NULL REFERENCES eligibility_rule_sets(id) ON DELETE CASCADE,
    version_no INT NOT NULL,
    rules JSONB NOT NULL,
    rationale TEXT NOT NULL,
    published_by UUID NOT NULL REFERENCES memberships(id),
    published_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (rule_set_id, version_no)
);

-- Eligibility Decisions
CREATE TABLE IF NOT EXISTS eligibility_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    drive_id UUID NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    rule_version_id UUID NOT NULL REFERENCES eligibility_rule_versions(id),
    input_snapshot JSONB NOT NULL,
    input_hash VARCHAR(64) NOT NULL,
    result VARCHAR(20) NOT NULL CHECK (result IN ('eligible', 'ineligible', 'conditionally_eligible')),
    reasons JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'provisional' CHECK (status IN ('provisional', 'published', 'overridden')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (drive_id, student_id, rule_version_id)
);

-- Officer Overrides
CREATE TABLE IF NOT EXISTS eligibility_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    decision_id UUID NOT NULL REFERENCES eligibility_decisions(id) ON DELETE CASCADE,
    officer_membership_id UUID NOT NULL REFERENCES memberships(id),
    previous_result VARCHAR(20) NOT NULL,
    new_result VARCHAR(20) NOT NULL,
    justification TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Recruiter Access Grants
CREATE TABLE IF NOT EXISTS recruiter_access_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recruiter_membership_id UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
    drive_id UUID REFERENCES drives(id) ON DELETE CASCADE,
    scope JSONB NOT NULL DEFAULT '{"fields": ["verified_skills", "evidence_cards"]}'::jsonb,
    approved_by UUID NOT NULL REFERENCES memberships(id),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Recruiter Pipeline (Shortlist, Interview, Offer)
CREATE TABLE IF NOT EXISTS applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    drive_id UUID NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    stage VARCHAR(30) NOT NULL DEFAULT 'applied' CHECK (stage IN ('applied', 'shortlisted', 'interview_scheduled', 'offered', 'rejected', 'withdrawn')),
    ctc_inr NUMERIC(12,2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (drive_id, student_id)
);

-- Institutional Student Outcomes (For NAAC / NIRF accreditation)
CREATE TABLE IF NOT EXISTS student_outcomes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    outcome_type VARCHAR(30) NOT NULL CHECK (outcome_type IN ('placed', 'higher_studies', 'entrepreneurship', 'unplaced')),
    organization_name VARCHAR(255),
    ctc_inr NUMERIC(12,2),
    evidence_ref VARCHAR(255),
    as_of TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

