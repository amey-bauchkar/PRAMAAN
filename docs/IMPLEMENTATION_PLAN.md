# PRAMAAN — Implementation Plan & Milestone Roadmap

**Execution Model:** Solo Developer with Google Antigravity  
**Methodology:** Test-Driven Development (TDD), Incremental Verifiable Milestones  
**Target Completion:** Comprehensive QUASAR 5.0 EdTech Solution  

---

## 1. Milestone Roadmap

```
 M0: Monorepo Foundation & Shared Types
  │
  ▼
 M1: Multi-Tenancy, RLS, Auth & Consent Ledger (P0-01, P0-02, P0-03)
  │
  ▼
 M2: Code Archaeology & Evidence Graph (P0-04, P0-05, P0-06)
  │
  ▼
 M3: Skill Verification Arena & Live Mutation Probe (P0-07, P0-08, P0-09, P0-10)
  │
  ▼
 M4: Skill Passport, Recruiter Evidence Card & Matching (P0-11, P0-12, P0-13, P1-10)
  │
  ▼
 M5: Placement Orchestration, Eligibility & Fairness Simulator (P0-14, P0-15, P1-04, P1-05)
  │
  ▼
 M6: Mandatory Breadth, Accreditation Suite & Hardening (P0-16, P0-17, P1-01 to P1-17)
```

---

## 2. Milestone Details & Verification Criteria

### Milestone M0: Monorepo Foundation & Shared Types
- **Goal:** Establish a working multi-package TypeScript workspace with common linting, test runners, and pure domain types.
- **Tasks:**
  - Initialize root `package.json` with npm workspaces (`apps/*`, `packages/*`).
  - Configure `tsconfig.json` base and workspace package references.
  - Set up Vitest as the shared fast test harness.
  - Implement `packages/contracts` with core Zod schemas (User, Org, SkillState, ConsentPurpose, EligibilityRule).
  - Implement `packages/domain` with pure domain invariants and interfaces.
- **Acceptance Criteria:** `npm test` runs across all packages and passes in <2 seconds.

---

### Milestone M1: Multi-Tenancy, RLS, Auth & Consent Ledger
- **Backlog Tickets:** `P0-01`, `P0-02`, `P0-03`
- **Goal:** Guarantee multi-tenant database isolation, tamper-evident audit logging, and purpose-specific consent before any user data enters the system.
- **Tasks:**
  - Implement PostgreSQL migrations for Organizations, Departments, Users, Memberships, Students.
  - Implement RLS policies on all tenant tables with `NOBYPASSRLS`.
  - Create the append-only `audit_events` ledger with SHA-256 hash chaining.
  - Implement the `consent_grants` service: granular purpose grants and immediate revocation.
  - Build automated RLS test pack verifying cross-tenant queries return 0 rows.
- **Acceptance Criteria:** Tests verify that Tenant A cannot see Tenant B data under any role, and token revocation instantly purges credentials.

---

### Milestone M2: Code Archaeology & Evidence Graph
- **Backlog Tickets:** `P0-04`, `P0-05` (Implemented, Hardened, Corrective-Patched & Formally Frozen), `P0-06`
- **Goal:** Ingest consented repositories, extract verifiable code anchors, and accept non-repo lab/hardware artifacts with faculty attestation.
- **Tasks:**
  - Build static repository import parser (fetches tree and commits without executing any repo build scripts) (`P0-04`).
  - Implement AST symbol extractor (TypeScript / JavaScript vertical slice) to identify exact skill spans and UTF-8 byte ranges (`P0-05` — Completed & Hardened).
  - Implement exact Anchor Resolver with raw-byte SHA-256 integrity verification, defensive snapshot store, multi-byte UTF-8 character boundary validation, line/byte metadata consistency enforcement, and diagnostic normalized diffing (`P0-05` — Completed & Hardened).
  - Implement strict tenant partitioning in snapshot store (removal of unscoped fallbacks), universal student ownership & DPDP consent enforcement across all caller roles, server-controlled trusted ingestion records (`ITrustedIngestionStore`), and compensating rollback for failure-safe snapshot audit logging (`P0-05` — Corrective Patch Completed).
  - Implement student-level snapshot partitioning, mutex-serialized concurrent registrations with leak-free cleanup, conditional rollback by snapshot ID, mandatory Git blob SHA enforcement, write-once immutable ingestion records, and file-level manifest binding (`TrustedFileManifestEntry`) (`P0-05` — Final Sign-Off Completed & Core Frozen).
  - Separate trusted record creation from snapshot registration (requiring pre-persisted records, rejecting unpersisted records), enforce student consent prior to repository data persistence, and guarantee audit-failure safety via compensating rollback with pre-existing snapshot preservation (`P0-05` — Final Trusted Ingestion Boundary Corrected).
  - Enforce explicit registration commit state (`pending_audit` -> `audit_committed` / `quarantined`) and fail-closed audit quarantine: authoritative resolution strictly requires an audit-committed state (`REGISTRATION_NOT_AUDIT_COMMITTED`), ensuring failed rollbacks never leave unaudited snapshots eligible for authoritative verification (`P0-05` — Final Audit-Failure Fail-Closed Correction).
  - Implement non-repository evidence workflow (lab reports, hardware builds) and faculty mentor review queue (`P0-06`).
- **Acceptance Criteria:** 100% of displayed code anchors resolve to exact file lines and raw byte spans; tampered code yields `ANCHOR_INVALID`; mentor attestation moves lab evidence to `Evidence-linked`.
- **Status (P0-04 & P0-05):** Fully implemented, hardened, and verified end-to-end.
  - **P0-05 (Exact Anchor Resolver & AST Analysis):** Fully implemented, hardened, corrective-patched, and formally frozen with 139 dedicated tests (59 domain, 80 API/RBAC), achieving 100% pass rate. Cross-tenant and intra-tenant cross-student isolation, fail-closed consent enforcement across all roles prior to repository data retention, buffer mutation immunity, path traversal prevention, mutex-serialized registration with safe conditional rollback and leak-free queue draining, mandatory Git blob SHA validation, write-once ingestion record immutability, separation of ingestion record creation from snapshot registration, explicit registration commit state lifecycle, and Git file-level manifest provenance boundaries verified. Zero untrusted code execution.
  - **P0-04 (Trusted Static GitHub Repository Ingestion):** Fully implemented, independently security-reviewed, backend reliability & consent lifecycle hardened, and verified end-to-end. Includes:
    1. GitHub OAuth 2.0 with PKCE S256 challenge, single-use state verification, and authenticated AES-256-GCM versioned key ring (`GITHUB_TOKEN_ENCRYPTION_KEY`) with format `version:iv:tag:ciphertext` and zero-downtime key rotation.
    2. GitHub Authorization Scope Hardening & Transparency: Accurately documents that GitHub OAuth `public_repo` scope provides read and write access per GitHub's specification, with application-level code strictly restricted to read-only API calls (commits, trees, blobs). Callback verifies both `read:user` and `public_repo` (or GitHub App permissions) are present, failing closed on missing scopes (`INSUFFICIENT_GITHUB_PERMISSIONS`, 403). Private repositories are rejected fail-closed with 400 `PRIVATE_REPOSITORY_NOT_SUPPORTED`.
    3. Genuine GitHub OAuth Grant Revocation (Non-Blocking Outside DB Locks): Abstraction `revokeOAuthGrant(accessToken, signal)` on `IGitHubClient`, `DefaultGitHubClient`, and `MockGitHubClient` issuing HTTP Basic-authenticated `DELETE /applications/{client_id}/grant` requests. External network calls execute strictly outside PostgreSQL transactions and row locks. Local credentials and tokens are purged fail-closed with zero token leakage.
    4. Active Consent Semantics & Partial Unique Index Invariants (Migration 013): Migration `013_active_consent_uniqueness.sql` creates partial unique index `uq_consent_grants_active_student_purpose ON consent_grants (student_id, purpose) WHERE revoked_at IS NULL`. `PgConsentRepository.grantConsent()` utilizes transaction-level PostgreSQL advisory locks (`pg_advisory_xact_lock`) to serialize concurrent grants, automatically transitioning prior active grants to revoked state before inserting the new active grant. `revokeConsent()` guarantees strictly zero active grants remain.
    5. Safe Canonical Repository Reconciliation & Data Loss Prevention (Migration 014): Schema migration `014_safe_repository_reconciliation.sql` pre-flights and reconciles duplicate repositories on `(student_id, provider, provider_repo_id)`, safely re-parenting all dependent child records (`repo_snapshots`, `evidence_items`, `source_snapshots`, `trusted_ingestion_records`, `ingestion_jobs`) to the canonical repository (`imported_at ASC, id ASC`) while temporarily managing trigger `trg_trusted_ingestion_immutable`. Verifies zero duplicates remain before deleting redundant repository rows.
    6. Bounded GitHub Tree Traversal & Rate-Limit Handling: Enforces strict limits (`maxTreeEntries = 5000`, `maxDirectoryTraversals = 100`, `maxTreeApiRequests = 30`, `maxFiles = 200`, `maxWallClockMs = 30000ms` with `AbortSignal`). Implements early termination: immediately terminates traversal upon detecting more than 200 eligible files (`FILE_COUNT_LIMIT_EXCEEDED`). Detects GitHub rate limits (HTTP 403/429) fail-closed (`GITHUB_RATE_LIMIT_EXCEEDED`). Zero manifests or snapshots are persisted upon limit breach.
    7. Ingestion Job Transitions on Revocation: `cancelJobsForStudentOnRevocation()` cancels all in-progress jobs (`queued`, `resolving`, `fetching`, `verifying`, `persisted`) to `status = 'failed'` with `error = 'CONSENT_REVOKED'` and `completed_at` set. Completed and already-failed jobs are strictly preserved for historical audit trails.
    8. Tenant-Safe OAuth State Consumption: Executed within `withTenantTransaction(context, ...)` under restricted `app_api` role, enforcing PostgreSQL RLS isolation, atomic single-use locking (`FOR UPDATE`), and replay rejection.
    9. Strict fail-closed Consent-Before-Fetch boundary: queries `repo_verification` consent before initiating ANY GitHub API call (0 API calls if consent missing/revoked); re-checks consent prior to durable persistence.
    10. Exact Git object verification: canonical Git blob formatting (`blob ${byteLength}\0${rawBytes}`), Git blob SHA-1 computation matching remote tree SHA, and raw SHA-256 content hashing.
    11. Canonical manifest generation (`TrustedIngestionRecordSchema`) and durable write-once storage.
    12. Durable PostgreSQL repositories: `PgSourceSnapshotStore`, `PgTrustedIngestionStore`, `PgGitHubCredentialRepository`, `PgIngestionJobRepository`, and `PgRepositoryRepository` backed by Migrations 011, 012, 013, and 014 with RLS enabled and forced across all tables.
    13. Fixed OAuth callback URI & Host header protection: server-configured canonical `GITHUB_OAUTH_REDIRECT_URI` and strict allowlist validation; host headers and client parameters are never trusted.
    14. Dedicated Frontend OAuth Callback Route (`apps/web/app/integrations/github/callback/page.tsx`) with 302 redirect, React StrictMode `useRef` guard, temporary query parameter scrubbing, and authenticated Bearer POST callback (`POST /api/integrations/github/callback`).
    15. User ID vs Student ID Disambiguation & Audit Actor Preservation: server-side resolution via `tenantRepo.getStudentByUserId()` and foreign key binding to `students.id`. Audit events record authenticated `users.id` via `actorUserId`, preserving audit actor attribution across student and officer roles while snapshots belong to `students.id`.
    16. Prohibition of Delegated Connection: officer/admin connection attempts rejected with 403 `FORBIDDEN_DELEGATED_CONNECTION`.
    17. Fastify API route endpoints with documented synchronous request lifecycle and durable relational progress tracking in `ingestion_jobs`.
    18. Production fail-closed application composition in `buildApp()`.
    19. 100% passing test coverage: 56 comprehensive unit/integration tests in `apps/api/tests/p0-04-github-ingestion.test.ts` and 28 real PostgreSQL tests in `db/tests/p0-04-pg-durable-repositories.test.ts` (472 tests total across monorepo). Zero untrusted code execution.

---

### Milestone M3: Skill Verification Arena & Live Mutation Probe
- **Backlog Tickets:** `P0-07`, `P0-08`, `P0-09`, `P0-10`
- **Goal:** Technical flagship — Code-grounded viva and isolated Live Mutation Probes driving deterministic skill state promotions.
- **Tasks:**
  - Implement the 5-state skill state machine in `packages/domain`.
  - Implement grounded defence question generator with 5 validation gates (code span, syntax validity, grounded context, question safety, rubric mapping).
  - Implement isolated runner service executing pure function modifications against pinned test harnesses in a sandboxed container.
  - Build deterministic rubric evaluator: state transitions require passing test runs; inconclusive or failed runs preserve state and route to human review.
- **Acceptance Criteria:** An injected wrong answer fails the test; a correct answer promotes skill to `Verified`; sandbox timeout fails closed without state mutation.

---

### Milestone M4: Skill Passport, Recruiter Evidence Card & Matching
- **Backlog Tickets:** `P0-11`, `P0-12`, `P0-13`, `P1-10`
- **Goal:** Publicly verifiable skill credentials and explainable candidate discovery for recruiters.
- **Tasks:**
  - Build portable Skill Evidence Passport schema (Open Badges 3.0 / W3C VC compliant).
  - Create the Recruiter Evidence Card displaying verified skills with direct links to code anchors.
  - Implement role-based skill gap analyzer comparing candidate verified skills with company requirements.
  - Build public verification page validating cryptographic passport signatures.
- **Acceptance Criteria:** Recruiter can click from a candidate's skill directly to the exact source commit in $\le 4$ clicks; untrusted/tampered passports fail validation.

---

### Milestone M5: Placement Orchestration, Eligibility & Fairness Simulator
- **Backlog Tickets:** `P0-14`, `P0-15`, `P1-04`, `P1-05`
- **Goal:** Declarative eligibility rules engine with What-If fairness simulation and conflict-free placement calendar.
- **Tasks:**
  - Implement deterministic eligibility evaluator based on immutable rule versions and student snapshots.
  - Implement What-If simulation calculating eligibility rates, demographic impact ratios ($4/5\text{ths}$ rule), and small group suppression ($N < 5$).
  - Build AI Proposal Inbox: placement drive slot allocations and email parsing create proposals requiring TPO confirmation (`AI Helps, Human Decides`).
  - Implement placement drive calendar with database exclusion constraints preventing venue/time clashes.
- **Acceptance Criteria:** Changing a rule dynamically recalculates cohort eligibility and impact ratios in real-time; overlapping drive bookings are rejected at the DB layer.

---

### Milestone M6: Mandatory Breadth, Accreditation Suite & Hardening
- **Backlog Tickets:** `P0-16`, `P0-17`, `P1-01` to `P1-17`
- **Goal:** Fulfill the remaining breadth requirements of the QUASAR problem statement.
- **Tasks:**
  - Three-round mock drive (30 aptitude questions with per-student random seed, 2 coding problems, practice interview with rubric).
  - Personalized learning path generating verifiable assignment tasks.
  - Industry skill-gap profiler ingesting job descriptions and mapping to canonical taxonomy.
  - Accreditation export suite (NAAC/NIRF format with student-deduplicated placement counts).
  - Bulk email dispatch with rate limiting and sandbox transport.
  - End-to-end integration and rehearsable demo reset scripts.
- **Acceptance Criteria:** All 20 Core Business Requirements, 8 Student Modules, and 12 Admin Modules are verified and operational.

