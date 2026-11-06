# PRAMAAN — Database Design & Security Specification

**Database Engine:** PostgreSQL 16+  
**Tenancy Pattern:** Shared database, Row-Level Security (RLS) partition per College  
**Security Posture:** `NOBYPASSRLS` on application role, Transaction-scoped session context  

---

## 1. Domain Entities & Schema Overview

```
┌────────────────────────────────────────────────────────┐
│                   1. Identity & Tenancy                │
│  organizations ──< departments ──< memberships >── users
│        │                               │
│        └──< students ──────────────────┘
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│                   2. Consent Ledger                    │
│  consent_purposes ──< consent_grants                   │
│  guardian_consents    data_requests                    │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│             3. Evidence & Skill Graph                  │
│  repositories ──< repo_snapshots                       │
│  projects ──────< evidence_items ──< attestations      │
│  skills ────────< student_skills ──< skill_evidence    │
│  skill_mappings   skill_state_events                   │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│                 4. Verification Arena                  │
│  rubric_versions ──< verification_sessions             │
│  verification_questions                                │
│  probe_definitions ─< probe_runs ──< human_reviews     │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│         5. Placement, Eligibility & Drives             │
│  companies ─────< job_roles ─────< job_role_skills     │
│  jd_documents ──< jd_skill_extractions                 │
│  eligibility_rule_sets ──< eligibility_rule_versions   │
│  drives ────────< drive_rounds                         │
│  eligibility_decisions ──< eligibility_overrides       │
│  appeals          applications ──< offers              │
│  student_outcomes interventions                        │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│          6. AI Governance, Audit & Fairness            │
│  agent_runs ─────< proposals                           │
│  model_calls      audit_events (Hash-chained)          │
│  fairness_reviews fairness_simulations                 │
└────────────────────────────────────────────────────────┘
```

---

## 2. Table Specifications

### 2.1 Identity and Tenancy

```sql
-- Organizations (University or College)
CREATE TABLE organizations (
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

-- Departments within a College
CREATE TABLE departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (org_id, code)
);

-- Users (Global identities authenticated via Managed Auth)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_subject VARCHAR(255) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    full_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Memberships (Connects Users to Colleges with specific Roles)
CREATE TABLE memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    department_id UUID REFERENCES departments(id),
    role VARCHAR(30) NOT NULL CHECK (role IN ('student', 'mentor', 'officer', 'university_admin', 'recruiter', 'platform_admin')),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, org_id, role)
);

-- Students (Student-specific profile details)
CREATE TABLE students (
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

-- Student Academic Records (Historical snapshot of CGPA & Backlogs)
CREATE TABLE academic_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    cgpa NUMERIC(4,2) NOT NULL CHECK (cgpa >= 0.0 AND cgpa <= 10.0),
    active_backlogs INT NOT NULL DEFAULT 0 CHECK (active_backlogs >= 0),
    as_of TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    source_ref VARCHAR(255) NOT NULL DEFAULT 'institutional_import'
);

-- Student Protected Demographics (Strictly segregated table for Fairness Audits)
CREATE TABLE student_group_attributes (
    student_id UUID PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
    gender VARCHAR(30),
    category VARCHAR(50),
    consent_grant_id UUID NOT NULL
);
```

### 2.2 Consent & Privacy Ledger

```sql
-- Consent Purposes
CREATE TABLE consent_purposes (
    code VARCHAR(50) PRIMARY KEY,
    description TEXT NOT NULL,
    version INT NOT NULL DEFAULT 1,
    requires_guardian_for_minor BOOLEAN NOT NULL DEFAULT TRUE
);

-- Consent Grants
CREATE TABLE consent_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    purpose VARCHAR(50) NOT NULL REFERENCES consent_purposes(code),
    notice_version INT NOT NULL,
    scope JSONB NOT NULL DEFAULT '{}'::jsonb,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMPTZ
);

-- Data Requests (DPDP Subject Rights)
CREATE TABLE data_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    type VARCHAR(30) NOT NULL CHECK (type IN ('access', 'correction', 'erasure', 'grievance')),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'rejected')),
    due_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    exception_note TEXT
);
```

### 2.3 Evidence & Skill Graph

```sql
-- Repositories (Only consented repositories)
CREATE TABLE repositories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    provider VARCHAR(30) NOT NULL DEFAULT 'github',
    provider_repo_id VARCHAR(100) NOT NULL,
    url VARCHAR(500) NOT NULL,
    default_branch VARCHAR(100) NOT NULL DEFAULT 'main',
    consent_grant_id UUID NOT NULL REFERENCES consent_grants(id),
    imported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Immutable Repo Snapshots
CREATE TABLE repo_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    commit_sha VARCHAR(64) NOT NULL,
    parser_version VARCHAR(30) NOT NULL,
    tree_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (repository_id, commit_sha)
);

-- Skills Master
CREATE TABLE skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_name VARCHAR(100) NOT NULL UNIQUE,
    category VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    level_definitions JSONB NOT NULL DEFAULT '{"1": "Novice", "2": "Competent", "3": "Proficient"}'::jsonb,
    taxonomy_version VARCHAR(20) NOT NULL DEFAULT '1.0'
);

-- Evidence Items
CREATE TABLE evidence_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    kind VARCHAR(30) NOT NULL CHECK (kind IN ('code_span', 'commit', 'test_result', 'lab', 'competition', 'certificate', 'mentor_attestation', 'external_profile')),
    repo_snapshot_id UUID REFERENCES repo_snapshots(id),
    path VARCHAR(500),
    line_start INT,
    line_end INT,
    content_hash VARCHAR(64) NOT NULL,
    object_key VARCHAR(500),
    status VARCHAR(20) NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'accepted', 'rejected', 'withdrawn', 'expired')),
    accepted_by UUID REFERENCES memberships(id),
    accepted_at TIMESTAMPTZ,
    valid_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Student Skills (With deterministic state invariants)
CREATE TABLE student_skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    state VARCHAR(20) NOT NULL DEFAULT 'claimed' CHECK (state IN ('claimed', 'observed', 'evidence_linked', 'verified', 'expired')),
    state_since TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    valid_until TIMESTAMPTZ,
    evidence_strength VARCHAR(10) NOT NULL DEFAULT 'low' CHECK (evidence_strength IN ('low', 'medium', 'high')),
    last_verification_id UUID,
    UNIQUE (student_id, skill_id),
    CONSTRAINT chk_verified_skill_requirements CHECK (state != 'verified' OR (last_verification_id IS NOT NULL AND valid_until IS NOT NULL))
);

-- Skill Evidence Validation Trigger (Kernel-level enforcement)
CREATE OR REPLACE FUNCTION verify_skill_evidence_before_verified() RETURNS TRIGGER AS $$
DECLARE
  accepted_count INT;
BEGIN
  IF NEW.state = 'verified' THEN
    SELECT COUNT(*) INTO accepted_count
    FROM skill_evidence se
    JOIN evidence_items ei ON ei.id = se.evidence_id
    WHERE se.student_skill_id = NEW.id AND ei.status = 'accepted';

    IF accepted_count = 0 THEN
      RAISE EXCEPTION 'Database invariant violation: Cannot set skill state to verified without at least one accepted evidence item linked.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_verify_skill_evidence
BEFORE INSERT OR UPDATE ON student_skills
FOR EACH ROW EXECUTE FUNCTION verify_skill_evidence_before_verified();

-- Skill Evidence Link
CREATE TABLE skill_evidence (
    student_skill_id UUID NOT NULL REFERENCES student_skills(id) ON DELETE CASCADE,
    evidence_id UUID NOT NULL REFERENCES evidence_items(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'supports' CHECK (role IN ('supports', 'context')),
    PRIMARY KEY (student_skill_id, evidence_id)
);

-- State Transition Events (Immutable Audit Log of Skill States)
CREATE TABLE skill_state_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_skill_id UUID NOT NULL REFERENCES student_skills(id) ON DELETE CASCADE,
    from_state VARCHAR(20) NOT NULL,
    to_state VARCHAR(20) NOT NULL,
    reason_code VARCHAR(50) NOT NULL,
    actor_type VARCHAR(20) NOT NULL CHECK (actor_type IN ('student', 'mentor', 'officer', 'evaluator_service', 'expiry_cron')),
    actor_id UUID,
    verification_id UUID,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### 2.4 Placement, Eligibility & Drives

```sql
-- Drives (Placement Events)
CREATE TABLE drives (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    company_name VARCHAR(255) NOT NULL,
    title VARCHAR(255) NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    venue_resource VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'in_progress', 'completed', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Eligibility Rule Sets and Versions
CREATE TABLE eligibility_rule_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL
);

CREATE TABLE eligibility_rule_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_set_id UUID NOT NULL REFERENCES eligibility_rule_sets(id) ON DELETE CASCADE,
    version_no INT NOT NULL,
    rules JSONB NOT NULL, -- { min_cgpa: 7.5, max_backlogs: 0, required_skills: ["Python", "SQL"] }
    rationale TEXT NOT NULL,
    published_by UUID NOT NULL REFERENCES memberships(id),
    published_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (rule_set_id, version_no)
);

-- Eligibility Decisions
CREATE TABLE eligibility_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    drive_id UUID NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    rule_version_id UUID NOT NULL REFERENCES eligibility_rule_versions(id),
    input_snapshot JSONB NOT NULL,
    input_hash VARCHAR(64) NOT NULL,
    result VARCHAR(20) NOT NULL CHECK (result IN ('eligible', 'ineligible', 'conditionally_eligible')),
    reasons JSONB NOT NULL, -- Array of reason codes and missing skill list
    status VARCHAR(20) NOT NULL DEFAULT 'provisional' CHECK (status IN ('provisional', 'published', 'overridden')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (drive_id, student_id, rule_version_id)
);
```

### 2.5 AI Governance, Proposals & Hash-Chained Audit

```sql
-- Agent Runs
CREATE TABLE agent_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    agent VARCHAR(50) NOT NULL,
    model_version VARCHAR(50) NOT NULL,
    prompt_version VARCHAR(30) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'completed',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Inert Proposals (The ONLY table AI workers may insert into)
CREATE TABLE proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    kind VARCHAR(50) NOT NULL CHECK (kind IN ('slot_allocation', 'jd_skills', 'intervention_recommendation', 'support_candidate')),
    payload JSONB NOT NULL,
    validation_result JSONB NOT NULL DEFAULT '{"valid": true}'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'applied', 'expired')),
    decided_by UUID REFERENCES memberships(id),
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Cryptographically Hash-Chained Audit Events
CREATE TABLE audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seq BIGSERIAL,
    org_id UUID NOT NULL REFERENCES organizations(id),
    actor_type VARCHAR(30) NOT NULL,
    actor_id UUID,
    action VARCHAR(100) NOT NULL,
    object_type VARCHAR(50) NOT NULL,
    object_id UUID,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    prev_hash VARCHAR(64) NOT NULL,
    hash VARCHAR(64) NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

---

## 3. Row-Level Security (RLS) Policy Blueprint

Every table associated with an institution has RLS enabled with `FORCE ROW LEVEL SECURITY`.

```sql
-- Enable RLS
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE students FORCE ROW LEVEL SECURITY;

-- Tenant Isolation Policy
CREATE POLICY tenant_isolation_policy ON students
    FOR ALL
    TO app_api
    USING (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
    WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
```

### RLS Verification Rules Matrix
- **RLS-01:** Every table containing `org_id` has RLS enabled and forced (All 42 tables verified via `scripts/audit-rls-inventory.mjs`).
- **RLS-02:** A student/user of College A receives 0 rows when attempting to query College B records.
- **RLS-03:** A user of College A receives a permission denial on cross-tenant INSERT, and 0 rows affected on UPDATE/DELETE targeting College B.
- **RLS-04:** Context isolation is maintained under concurrent connection pooling without bleed (`SET LOCAL "app.current_org_id"` automatically resets on transaction commit/abort; queries fail-closed when context is absent).
- **RLS-05:** Application roles (`app_api`, `ai_worker`, `fairness_job`) have `NOBYPASSRLS`.
- **RLS-06:** University Admin can only access aggregate views; direct student row queries return 0 rows.
- **RLS-09:** Students cannot query `eligibility_decisions` where `status = 'provisional'`.
- **RLS-11:** AI worker role has `SELECT` only on authorized views and `INSERT` exclusively on `proposals` and `agent_runs`.
- **RLS-12:** `audit_events` is strictly append-only; `UPDATE` and `DELETE` grants are omitted at DCL level, and `trg_audit_events_immutable` denies UPDATE and DELETE.
- **RLS-13:** Evidence grafting is prohibited at the database kernel level: `trg_check_skill_evidence_owner` rejects linking foreign student evidence to student skills.
- **RLS-14:** Skill state promotion to `verified` requires qualifying accepted evidence and passing verification session via `trg_verify_skill_evidence`.

---

## 4. Connection Pooling Architecture & Safe Migrations

### 4.1 Node.js PostgreSQL Pool & `withTenantTransaction` Pattern
To maintain strict tenant isolation across pooled physical connections without bleed:
1. Connections are acquired from `pg.Pool` (`max: 10`, `connectionTimeoutMillis: 5000`).
2. Every request is wrapped in an explicit transaction (`BEGIN; ... COMMIT;`).
3. Inside the transaction, the role and tenant context are injected using `SET LOCAL`:
   ```sql
   SET LOCAL ROLE app_api;
   SET LOCAL "app.current_org_id" = $1;
   ```
4. All queries within the callback use parameterized values.
5. In the `finally` block, the client connection is released back to the pool. When the transaction finishes, PostgreSQL automatically resets all `SET LOCAL` variables to their initial state.
6. If a subsequent query on the same connection omits `SET LOCAL "app.current_org_id"`, `current_app_org_id()` returns `NULL`, causing `org_id = NULL` to evaluate to falsy and returning **0 rows** (fail-closed behavior verified via `db/tests/connection-pool-reuse.test.ts` with `SELECT pg_backend_pid()`).

### 4.2 Safe, Versioned Migration Design (`002_comprehensive_rls_hardening.sql`)
Dynamic `DO $$ ... DROP POLICY ... LOOP` constructs were replaced with explicit, scoped, idempotent drops:
```sql
DROP POLICY IF EXISTS tenant_isolation_organizations ON organizations;
DROP POLICY IF EXISTS tenant_isolation_students ON students;
...
```
This ensures:
1. Re-running migrations never drops policies created by other extensions or future migrations.
2. Changes are auditable in git diffs.
3. Zero silent policy deletions occur.

### 4.3 Restricted Runtime Application User & Pre-Tenant Identity Resolution (`007_restricted_runtime_role.sql`)
To eliminate the use of administrative credentials for normal application runtime:
1. **Dedicated Application Role:** `pramaan_app_user` created with `NOBYPASSRLS`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOINHERIT`.
2. **Membership in `app_api`:** Role is granted `app_api`, restricting all queries to RLS policies. It assumes `app_api` within transaction boundaries using `SET LOCAL ROLE app_api;`.
3. **Pre-Tenant Identity Resolution Stored Procedure:** Before tenant context is known, looking up user memberships is handled by a narrowly scoped `SECURITY DEFINER` function:
   ```sql
   CREATE OR REPLACE FUNCTION resolve_user_identity(p_auth_subject TEXT)
   RETURNS TABLE (...)
   SECURITY DEFINER
   SET search_path = pg_catalog, public
   LANGUAGE plpgsql AS $$
   BEGIN
       RETURN QUERY
       SELECT u.id, u.auth_subject, u.email, u.full_name, u.created_at,
              m.id, m.org_id, m.department_id, m.role, m.status, m.created_at
       FROM public.users u
       LEFT JOIN public.memberships m ON m.user_id = u.id
       WHERE u.auth_subject = p_auth_subject;
   END;
   $$;
   ```
4. **Account Takeover Immunity:** The procedure queries strictly by verified `auth_subject`. It never accepts or links accounts by email, immunizing the system against OAuth email collision / takeover attacks.
5. **Least Privilege Execution:** Execution is revoked from `PUBLIC` and granted strictly to `pramaan_app_user` and `app_api`.
6. **Secure Provisioning & Rotation Procedure:**
   - Literal passwords are NEVER committed to migrations or SQL source code.
   - When provisioning or rotating the runtime user password, the administrator executes an out-of-band administrative command via the secure Supabase console or management API:
     ```sql
     ALTER ROLE pramaan_app_user WITH PASSWORD '<HIGH_ENTROPY_RANDOM_SECRET>';
     ```
   - The password is saved strictly in the runtime environment secrets manager (or untracked `.env`), and re-running migration 007 alters role attributes without resetting or exposing the password.

### 4.4 Parameterized Transaction Context Isolation (`withTenantTransaction`)
PostgreSQL does not permit `$1` parameters in `SET LOCAL` statements directly. Parameterization is achieved via `set_config` with `is_local = true`:
```sql
SELECT 
  set_config('app.current_org_id', $1, true),
  set_config('app.current_user_id', $2, true),
  set_config('app.current_user_role', $3, true);
```
This guarantees:
1. Zero SQL injection risk when binding tenant or user context variables.
2. Transaction-scoped lifetime: variables reset automatically upon transaction commit or rollback.
3. Fail-closed defense: connections returned to the pool clear their local settings immediately.

### 4.5 Strict TLS CA Certificate Pinning & SNI Verification
Direct and pooled connections to the remote database use strict TLS encryption:
- CA root bundle is stored in `certs/supabase-ca.crt` (including the Supabase Root CA and intermediate chain).
- `rejectUnauthorized: true` prevents untrusted or self-signed man-in-the-middle certificates.
- SNI hostname verification (`servername: new URL(connectionString).hostname`) prevents MITM attacks routing to unauthorized hostnames.

### 4.6 Tenant Discovery RLS Isolation
To protect organizational privacy:
- The `organizations` table is governed by kernel policy `tenant_isolation_organizations`:
  ```sql
  CREATE POLICY tenant_isolation_organizations ON organizations
    FOR SELECT TO app_api
    USING (id = current_app_org_id() OR kind = 'university');
  ```
- All discovery queries (`PgTenantRepository.listOrganizations` and `getOrganization`) execute strictly inside `withTenantTransaction` under `app_api`.
- As verified on live PostgreSQL 17 (`apps/api/tests/restricted-runtime-user.test.ts`), College A querying organizations returns strictly College A; College B's record is completely invisible (filtered by RLS). Calling `getOrganization` with another college's ID returns `null`. Sensitive configuration and key references are never exposed.

