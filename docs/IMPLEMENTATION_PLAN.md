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
  - Implement non-repository evidence workflow (lab reports, hardware builds) and faculty mentor review queue (`P0-06`).
- **Acceptance Criteria:** 100% of displayed code anchors resolve to exact file lines and raw byte spans; tampered code yields `ANCHOR_INVALID`; mentor attestation moves lab evidence to `Evidence-linked`.
- **Status (P0-05):** Fully implemented, hardened, corrective-patched, and formally frozen with 132 dedicated tests (59 domain, 73 API/RBAC), achieving 100% pass rate. Cross-tenant and intra-tenant cross-student isolation, fail-closed consent enforcement across all roles prior to repository data retention, buffer mutation immunity, path traversal prevention, mutex-serialized registration with safe conditional rollback and leak-free queue draining, mandatory Git blob SHA validation, write-once ingestion record immutability, separation of ingestion record creation from snapshot registration, and Git file-level manifest provenance boundaries verified. Zero untrusted code execution. Total monorepo suite: 363 passing tests across 25 files.
- **Explicit P0-04 Boundary:** P0-04 must provide durable snapshot storage, durable write-once trusted ingestion record storage, secure production wiring for both adapters through the application composition root (`buildApp()`), verified Git commit/tree/blob fetching without executing repository code, purpose-specific student consent before repository ingestion, and a server-generated canonical file manifest. The current `buildApp()` production configuration must not be described as supporting durable authoritative ingestion until that wiring actually exists.

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

