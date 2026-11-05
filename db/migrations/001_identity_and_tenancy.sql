-- ==============================================================================
-- PRAMAAN MIGRATION 001: IDENTITY AND TENANCY
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Organizations (College Tenants & Universities)
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id UUID REFERENCES organizations(id),
    kind VARCHAR(20) NOT NULL CHECK (kind IN ('university', 'college')),
    name VARCHAR(255) NOT NULL,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    key_ref VARCHAR(255),
    rate_limit_config JSONB NOT NULL DEFAULT '{"max_requests_per_min": 60}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Departments
CREATE TABLE IF NOT EXISTS departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (org_id, code)
);

-- Users (Global Managed Auth Identities)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_subject VARCHAR(255) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    full_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Memberships (Tenancy Binding + RBAC)
CREATE TABLE IF NOT EXISTS memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    department_id UUID REFERENCES departments(id),
    role VARCHAR(30) NOT NULL CHECK (role IN ('student', 'mentor', 'officer', 'university_admin', 'recruiter', 'platform_admin')),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, org_id, role)
);

-- Students
CREATE TABLE IF NOT EXISTS students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    department_id UUID NOT NULL REFERENCES departments(id),
    enrollment_no VARCHAR(50) NOT NULL,
    graduating_year INT NOT NULL,
    program_level VARCHAR(20) NOT NULL DEFAULT 'undergraduate',
    is_minor BOOLEAN NOT NULL DEFAULT FALSE,
    age_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (org_id, enrollment_no),
    UNIQUE (org_id, user_id)
);

-- Academic Records (Snapshot History)
CREATE TABLE IF NOT EXISTS academic_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    cgpa NUMERIC(4,2) NOT NULL CHECK (cgpa >= 0.0 AND cgpa <= 10.0),
    active_backlogs INT NOT NULL DEFAULT 0 CHECK (active_backlogs >= 0),
    as_of TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    source_ref VARCHAR(255) NOT NULL DEFAULT 'institutional_import'
);

-- Protected Demographics (Strictly isolated from general querying)
CREATE TABLE IF NOT EXISTS student_group_attributes (
    student_id UUID PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
    gender VARCHAR(30),
    category VARCHAR(50),
    consent_grant_id UUID NOT NULL
);

