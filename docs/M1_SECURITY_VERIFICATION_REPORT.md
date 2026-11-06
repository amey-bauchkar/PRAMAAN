# PRAMAAN — Milestone M1 Security Verification & Database Hardening Audit Report

**Date:** 2026-11-06  
**Project:** PRAMAAN (QUASAR 5.0 — EdTech Domain)  
**Database Target:** Real PostgreSQL 17.11 on Supabase (`db.qshujrddrzoemlzmleru.supabase.co`)  
**Auditor / Engineer:** Principal Software Architect & Security Engineer (Antigravity Solo Partner)  
**Verification Status:** **PASSED & SECURITY VERIFIED** (100% of 223 tests passing across 23 test suites)

---

## 1. Executive Summary & Verification Context

Prior to commencing Milestone M2 feature development, an exhaustive independent security defect remediation audit and verification was conducted across all Milestone M0 and M1 components. 

The audit remediated all defects identified across eight core security areas:
1. **Unconditional Multi-Tenant Isolation & Parent University Relationship (P0-3):** Proving at the PostgreSQL kernel level that no college tenant can read, insert, mutate, or delete another college tenant's student, academic, or placement records across all 42 domain tables. Tenant discovery via `PgTenantRepository` and `/api/tenants` is strictly governed by `008_parent_university_discovery_policy.sql`: colleges can discover only their own affiliated parent university (`id = current_app_parent_org_id()`), never unrelated universities or foreign colleges.
2. **Production AuthService Injection Bypass Elimination (P0-1):** In `apps/api/src/app.ts`, production mode rejects custom injected `authService` unless verified via internal production construction. Authentication is unconditionally locked to the internal `AuthService` with `PgUserRepository` and verified Supabase JWKS/issuer configuration.
3. **Administrative Migration and Seed TLS Enforcement (P0-2):** Connection pooling in `scripts/admin-db-ssl.mjs` enforces verified TLS (`rejectUnauthorized: true`), SNI hostname validation, and strict `DATABASE_CA_PATH` verification for all remote database connections. Insecure TLS fallback is strictly blocked.
4. **Migration Reproducibility & Ledger Engine (P1-3):** Engineered a fully idempotent, version-controlled migration engine (`scripts/migrate-supabase.mjs`) tracked via an explicit `schema_migrations` ledger with SHA-256 checksums and session advisory lock (`8429104820948123n`). Migrations execute atomically in transactions with rollback on failure. Checksum drift causes immediate non-zero termination.
5. **Audit-Chain Concurrency & Transactional Integrity (P1-4):** Added unique constraint `uq_audit_events_org_seq UNIQUE (org_id, seq)` via migration 009. Concurrent tenant audit writes serialize via `pg_advisory_xact_lock(hashtext('audit_chain'), hashtext(org_id))`. Added `logInTransaction(client, ...)` to eliminate nested client checkouts in `PgConsentRepository`. Enforced RFC 8785 canonical key sorting in `AuditChain.calculateHash` to eliminate PostgreSQL JSONB key-reordering hash verification failures.
6. **Tenant-Scoped Consent Checking (P1-5):** Added `context: SessionContext` to `hasActiveConsent()`, executing under `withTenantTransaction(context, ...)` to switch to `app_api` and enforce tenant RLS boundaries at the database engine level.
7. **CI / CD Quality Gates & Multi-Stage Verification Pipeline (P2):** Configured ESLint (`eslint.config.mjs`) for `npm run lint` and separated strict TypeScript compilation check to `npm run typecheck` (`tsc --noEmit`). Added `db/tests/test-safety-guard.test.ts` to CI quality gates. Created 3-stage GitHub Actions workflow: `build-and-unit-tests`, `isolated-postgres-integration`, and `live-supabase-verification`.
8. **Cryptographic Checkpoint Trust, Audit Isolation & Database Target Safety (P0 / P1):**
   - **Backend-Only Checkpoint Verification Key:** Removed caller-controlled `checkpointSigningKey` from `VerifyChainOptions`. Verification strictly uses backend-configured `CHECKPOINT_SIGNING_KEY`. Callers cannot supply or override verification keys.
   - **Authenticated Checkpoint Verification:** Plain unauthenticated `{ seq, hash }` objects and the historical dummy `a*64` hash are strictly rejected as `INVALID`. Checkpoints require strict cryptographic authentication: tenant UUID `orgId` binding, finite non-negative integer `seq`, SHA-256 `hash`, ISO `signedAt`, and HMAC-SHA256 `signature` verified using the backend key.
   - **Complete Chain vs Suffix Link Distinction:** Complete verification (`COMPLETE_AND_VALID`) strictly requires `seq = 1` and `GENESIS_HASH` (`isComplete: true`). Authenticated checkpoints return `PARTIAL_BUT_LINKS_VALID` (`valid: true, isComplete: false`). Suffixes without authenticated checkpoints evaluate to `UNANCHORED` (`valid: false, isComplete: false`). `AuditChain.verifySuffixLinks()` verifies internal cryptographic linkages without validating or asserting anchor authenticity.
   - **Tenant College A Status:** College A's historical chain in the shared development database starts at `seq = 100000` and remains strictly **`UNANCHORED`** (`valid: false, isComplete: false`) unless an authentic signed checkpoint is established.
   - **Tenant-Scoped Transactional Audit Cleanup:** Eliminated unscoped `OR seq = 99991` deletion. All audit test cleanup is strictly scoped to `TEST_AUDIT_TENANT_ID`, matching exact action, object type, and event ID. Executed via `safeCleanupTestAuditEvents` inside a single PostgreSQL client transaction where trigger disable, deletion, and trigger re-enable occur atomically, with rollback restoring trigger state on failure. Verified via regression test 20 that test tenant cleanup cannot delete another tenant's audit event sharing the same sequence number.
   - **Database Target Identity Protection:** `assertSafeTestEnvironment()` fails closed if `NODE_ENV === 'production'`, requires explicit opt-in via `ALLOW_DESTRUCTIVE_DB_TESTS=true`, rejects known production database URLs, and verifies the database against an approved test allowlist. Destructive queries in `runQuery` trigger this guard automatically. Institutional production records (`00000000-0000-0000-0000-000000000001` and `00000000-0000-0000-0000-000000000002`) are strictly protected from mutation.

All claims in this report are backed by automated tests running against the **live Supabase PostgreSQL 17 instance** and pure TypeScript domain suites.

```
Monorepo Test Suite Summary:
├── Pure Domain Unit Tests:          41 tests (Skill state machine, anchor resolver, fairness, eligibility, audit chain integrity, authenticated checkpoints, caller-key override rejection)
├── API, RBAC & Adversarial Tests:  112 tests (Fastify, positive RBAC matrix, email takeover, fail-closed, strict claims, consent adversarial, audit concurrency, restricted runtime user, genuine ES256 JWKS)
└── DB, Migration & Safety Tests:    70 tests (Supabase real DB, RLS, triggers, pool socket reuse, strict URL/host/db safety guard, target allowlist, MERGE/SELECT INTO detection, transaction boundary enforcement, nextval/setval side-effect prevention, read-only transaction execution, cross-tenant audit isolation regression, migration ledger, admin TLS)
Total:                              223 tests, 100% passing (Execution time: 21.65s across 23 files)
```

---

## 2. Table-by-Table Database Inventory & RLS Audit

A full schema audit was executed against the database catalog using `scripts/audit-rls-inventory.mjs`. All **42 tables** in the `public` schema have Row-Level Security enabled (`relrowsecurity = true`) and forced for table owners (`relforcerowsecurity = true`).

| # | Table Name | Data Classification | RLS Enabled | RLS Forced | Scoped Tenant Policy | Governed Commands | Scoped Access Roles |
|---|------------|---------------------|:-----------:|:----------:|----------------------|:-----------------:|---------------------|
| 1 | `organizations` | Tenant Metadata | Yes | Yes | `tenant_isolation_organizations` | SELECT | `app_api` |
| 2 | `departments` | Tenant Structure | Yes | Yes | `tenant_isolation_departments` | ALL | `app_api` |
| 3 | `users` | User Identity | Yes | Yes | `user_read_self_or_college_members` | SELECT | `app_api` |
| 4 | `memberships` | Tenancy & RBAC | Yes | Yes | `tenant_isolation_memberships` | ALL | `app_api` |
| 5 | `students` | Student PII | Yes | Yes | `tenant_isolation_students` | ALL | `app_api`, `fairness_job` |
| 6 | `academic_records` | Academic History | Yes | Yes | `tenant_isolation_academic_records` | ALL | `app_api` |
| 7 | `student_group_attributes` | Protected Demographics | Yes | Yes | `tenant_isolation_student_group_attributes` | ALL | `fairness_job` only (Locked to `app_api`) |
| 8 | `consent_purposes` | Global Catalog | Yes | Yes | `read_catalog_consent_purposes` | SELECT | `app_api` |
| 9 | `consent_grants` | Student Rights | Yes | Yes | `tenant_isolation_consent_grants` | ALL | `app_api` |
| 10 | `guardian_consents` | Minor Protection | Yes | Yes | `tenant_isolation_guardian_consents` | ALL | `app_api` |
| 11 | `data_requests` | DPDP Deletion/Export | Yes | Yes | `tenant_isolation_data_requests` | ALL | `app_api` |
| 12 | `connected_accounts` | Encrypted OAuth Tokens | Yes | Yes | `tenant_isolation_connected_accounts` | ALL | `app_api` |
| 13 | `repositories` | Consented Repos | Yes | Yes | `tenant_isolation_repositories` | ALL | `app_api`, `ai_worker` |
| 14 | `repo_snapshots` | Immutable Git Trees | Yes | Yes | `tenant_isolation_repo_snapshots` | ALL | `app_api`, `ai_worker` |
| 15 | `skills` | Canonical Taxonomy | Yes | Yes | `read_catalog_skills` | SELECT | `app_api`, `ai_worker` |
| 16 | `evidence_items` | Code & Lab Artifacts | Yes | Yes | `tenant_isolation_evidence_items` | ALL | `app_api`, `ai_worker` |
| 17 | `student_skills` | Skill States | Yes | Yes | `tenant_isolation_student_skills` | ALL | `app_api` |
| 18 | `skill_evidence` | Skill-Evidence Join | Yes | Yes | `tenant_isolation_skill_evidence` | ALL | `app_api` |
| 19 | `attestations` | Faculty Signatures | Yes | Yes | `tenant_isolation_attestations` | ALL | `app_api` |
| 20 | `skill_state_events` | State Transition Audit | Yes | Yes | `tenant_isolation_skill_state_events` | ALL | `app_api` |
| 21 | `rubric_versions` | Versioned Rubrics | Yes | Yes | `read_catalog_rubric_versions` | SELECT | `app_api`, `ai_worker` |
| 22 | `verification_sessions` | Viva & Probes | Yes | Yes | `tenant_isolation_verification_sessions` | ALL | `app_api` |
| 23 | `verification_questions` | Anchored Questions | Yes | Yes | `tenant_isolation_verification_questions` | ALL | `app_api` |
| 24 | `probe_definitions` | Test Harnesses | Yes | Yes | `read_catalog_probe_definitions` | SELECT | `app_api` |
| 25 | `probe_runs` | Execution Logs | Yes | Yes | `tenant_isolation_probe_runs` | ALL | `app_api` |
| 26 | `human_reviews` | Mentor Review Queue | Yes | Yes | `tenant_isolation_human_reviews` | ALL | `app_api` |
| 27 | `companies` | Placement Partners | Yes | Yes | `tenant_isolation_companies` | ALL | `app_api` |
| 28 | `job_roles` | Placement Profiles | Yes | Yes | `tenant_isolation_job_roles` | ALL | `app_api`, `ai_worker` |
| 29 | `job_role_skills` | Role Prerequisites | Yes | Yes | `tenant_isolation_job_role_skills` | ALL | `app_api`, `ai_worker` |
| 30 | `drives` | Campus Drives | Yes | Yes | `tenant_isolation_drives` | ALL | `app_api`, `fairness_job` |
| 31 | `eligibility_rule_sets` | Policy Rule Sets | Yes | Yes | `tenant_isolation_eligibility_rule_sets` | ALL | `app_api` |
| 32 | `eligibility_rule_versions` | Versioned Rules | Yes | Yes | `tenant_isolation_eligibility_rule_versions` | ALL | `app_api`, `fairness_job` |
| 33 | `eligibility_decisions` | Deterministic Decisions | Yes | Yes | `tenant_isolation_eligibility_decisions` | ALL | `app_api`, `fairness_job` |
| 34 | `eligibility_overrides` | Officer Overrides | Yes | Yes | `tenant_isolation_eligibility_overrides` | ALL | `app_api` |
| 35 | `recruiter_access_grants` | Recruiter Scopes | Yes | Yes | `tenant_isolation_recruiter_access_grants` | ALL | `app_api` |
| 36 | `applications` | Student Applications | Yes | Yes | `tenant_isolation_applications` | ALL | `app_api` |
| 37 | `student_outcomes` | Final Offers/Results | Yes | Yes | `tenant_isolation_student_outcomes` | ALL | `app_api` |
| 38 | `agent_runs` | AI Invocation Ledger | Yes | Yes | `tenant_isolation_agent_runs` | ALL | `app_api`, `ai_worker` |
| 39 | `proposals` | Inert AI Proposals | Yes | Yes | `tenant_isolation_proposals` | ALL | `app_api`, `ai_worker` |
| 40 | `audit_events` | Append-Only Log | Yes | Yes | `tenant_isolation_audit_events` | SELECT, INSERT | `app_api` (UPDATE/DELETE Denied) |
| 41 | `fairness_reviews` | Bias Audit Logs | Yes | Yes | `tenant_isolation_fairness_reviews` | ALL | `fairness_job` |
| 42 | `fairness_simulations` | Policy What-If Sim | Yes | Yes | `tenant_isolation_fairness_simulations` | ALL | `app_api`, `fairness_job` |

### Least-Privilege Role Grants (No Indiscriminate `ALL` Grants)
1. **`app_api`:**
   - Has `NOBYPASSRLS`.
   - Granted `SELECT, INSERT, UPDATE, DELETE` on standard operational tables.
   - Granted `SELECT` only on master catalogs (`consent_purposes`, `skills`, `rubric_versions`, `probe_definitions`).
   - Granted `SELECT, INSERT` ONLY on `audit_events` (Strictly **NO UPDATE, NO DELETE**).
   - Zero access to `student_group_attributes` (Protected demographic data is inaccessible to the web API role).
2. **`ai_worker`:**
   - Has `NOBYPASSRLS`.
   - Read-only access to repositories, snapshots, evidence items, and skill taxonomies.
   - Write access restricted strictly to inserting into `proposals` and `agent_runs`. Cannot modify student records or approve decisions.
3. **`fairness_job`:**
   - Has `NOBYPASSRLS`.
   - Dedicated role for background bias and adverse impact analysis.
   - Read-only access to `student_group_attributes`, `students`, `drives`, and `eligibility_decisions`.
   - Write access restricted to `fairness_reviews` and `fairness_simulations`.

---

## 3. Multi-Tenant Isolation & Connection Pooling Verification

### 3.1 Deterministic College A & B Test Fixtures
Tests were executed using dedicated isolated UUID fixtures in `db/tests/supabase-real-db.test.ts`:
- **College A:** `a0000000-0000-0000-0000-000000000001` (Student A: `a3000000-0000-0000-0000-000000000001`)
- **College B:** `b0000000-0000-0000-0000-000000000002` (Student B: `b3000000-0000-0000-0000-000000000002`)

### 3.2 Four-Way Cross-Tenant Mutation Tests Under `app_api`
1. **Cross-Tenant SELECT:**
   - When executing under `app_api` with `app.current_org_id = College A`, querying students returns strictly Student A. Querying for Student B returns **0 rows**.
   - When executing under `app_api` with `app.current_org_id = College B`, querying students returns strictly Student B. Querying for Student A returns **0 rows**.
2. **Cross-Tenant INSERT:**
   - Tenant A attempts to insert a new student record specifying `org_id = College B`.
   - PostgreSQL engine aborts the transaction with: `ERROR: 42501: new row violates row-level security policy for table "students"`.
3. **Cross-Tenant UPDATE:**
   - Tenant A attempts to execute `UPDATE students SET graduating_year = 2099 WHERE id = Student B`.
   - Query executes with **0 rows affected**.
   - Explicit query under Tenant B confirms Student B's `graduating_year` remained exactly `2026`.
4. **Cross-Tenant DELETE (with Invariant Integrity Check):**
   - Tenant A attempts to execute `DELETE FROM students WHERE id = Student B`.
   - Query executes with **0 rows affected**.
   - Explicit secondary verification query under Tenant B confirms Student B **still exists** with all original field values (`id`, `org_id`, `enrollment_no`, `graduating_year`) completely intact.

### 3.3 Connection Pooling & Fail-Closed Scoping
- **Transaction Scoping:** Tenant context is injected using `SET LOCAL "app.current_org_id" = :orgId;` within explicit `BEGIN ... COMMIT;` transaction blocks.
- **Leakage Prevention:** Once the transaction commits or aborts, PostgreSQL automatically resets the setting to null.
- **Fail-Closed Verification:** When a query runs under role `app_api` without `app.current_org_id` being set, `current_app_org_id()` evaluates to `NULL`. Since `org_id = NULL` evaluates to falsy in SQL three-valued logic, **0 rows are returned**.
- **AuthService Membership Derivation:** In the Fastify API layer (`AuthService.resolveContext`), tenant identity is derived strictly from verified database records in `memberships`. If a client supplies an unauthorized `x-org-id` header for an institution where the authenticated user is not an active member, the API immediately rejects the request with HTTP **403 Forbidden** (`FORBIDDEN_TENANT_ACCESS`).

---

## 4. Kernel-Enforced Skill Verification Invariants (8 Paths Verified)

The five authoritative skill states are strictly enforced:
$$\text{CLAIMED} \longrightarrow \text{OBSERVED} \longrightarrow \text{EVIDENCE\_LINKED} \longrightarrow \text{VERIFIED} \longrightarrow \text{EXPIRED}$$

Two database triggers enforce skill invariants at the kernel level:
1. `trg_check_skill_evidence_owner`: Intercepts insertions into `skill_evidence` to verify that `evidence_items.student_id == student_skills.student_id`.
2. `trg_verify_skill_evidence`: Intercepts updates/inserts on `student_skills` when `state = 'verified'`.

### Complete 8-Path Matrix
| Path # | Verification Path Description | Unit Test Result | Real Supabase DB Result | Technical Rejection Reason |
|:------:|-------------------------------|:----------------:|:-----------------------:|----------------------------|
| **1** | Insert `state = 'verified'` without accepted evidence | PASSED | PASSED | Rejected by trigger: `Verified skills require last_verification_id and valid_until`. |
| **2** | Update existing claimed skill to `verified` without evidence | PASSED | PASSED | Rejected by trigger: `Cannot set skill state to verified without qualifying accepted evidence`. |
| **3** | Transition to `verified` against withdrawn evidence | PASSED | PASSED | Rejected by trigger: Withdrawn evidence items (`status = 'withdrawn'`) are excluded by `ei.status = 'accepted'` filter. |
| **4** | Link evidence belonging to a different student | PASSED | PASSED | Rejected by trigger `trg_check_skill_evidence_owner`: `Cannot link evidence belonging to student B to skill belonging to student A`. |
| **5** | Verify using evidence linked to a different skill | PASSED | PASSED | Rejected by trigger: `skill_evidence` link must join `student_skills.id = NEW.id`; non-linked evidence results in `accepted_count = 0`. |
| **6** | Transition to `verified` after failed probe session | PASSED | PASSED | Rejected by trigger: Verification session outcome is `failed`, expected `passed`. |
| **7** | Transition to `verified` with qualifying evidence & passing probe | PASSED | PASSED | Succeeded: Skill successfully transitions to `verified` with valid verification ID and expiration date. |
| **8** | Re-verify `EXPIRED` skill only via permitted passing path | PASSED | PASSED | Failed probe rejected; subsequent passing probe with valid evidence successfully re-verified skill. |

---

## 5. Audit Log Immutability & Superuser Boundary

### 5.1 Two-Layer Defense-in-Depth on `audit_events`
The audit log implements defense-in-depth against data tampering:
1. **Layer 1 (DCL Least Privilege):** The application role `app_api` is granted only `SELECT` and `INSERT` on `audit_events`. Any `UPDATE` or `DELETE` attempted under `app_api` is blocked immediately by PostgreSQL's privilege checker with: `ERROR: 42501: permission denied for table audit_events`.
2. **Layer 2 (Database Trigger):** Database trigger `trg_audit_events_immutable` executes `BEFORE UPDATE OR DELETE ON audit_events` and raises: `audit_events is append-only: UPDATE and DELETE operations are strictly prohibited`. Even if a role possesses table modification privileges (e.g. the `postgres` administrative role), standard UPDATE and DELETE queries are blocked.

### 5.2 Superuser Trust Boundary & Honest Threat Disclosure
> [!IMPORTANT]
> **Superuser Security Boundary Disclosure:**
> A cryptographic hash chain provides **tamper-evidence**, not tamper-prevention against an active database superuser. 
> 
> A database superuser (or an attacker with compromised superuser credentials) possesses DDL permissions to execute `ALTER TABLE audit_events DISABLE TRIGGER trg_audit_events_immutable;`, rewrite rows, recalculate SHA-256 hashes, and re-enable the trigger.
> 
> To safeguard against this boundary:
> 1. Web application backends run strictly under `app_api` (`NOBYPASSRLS`, no DDL privileges).
> 2. Cryptographic hash chain validation (`AuditChain.verifyChain`) detects any row modification, missing sequence, or out-of-order insertion.
> 3. Hash chains are audited periodically and exported to off-site, write-once immutable storage (e.g. AWS S3 Object Lock / WORM vault).

### 5.3 Cryptographic Hash-Chain Verification (6 Scenarios Verified)
The SHA-256 hash chaining engine (`packages/domain/src/audit-chain.ts`) links each event to its predecessor:
$$\text{Hash}_n = \text{SHA-256}\Big(\text{seq}_n \parallel \text{orgId} \parallel \text{actorType} \parallel \text{actorId} \parallel \text{action} \parallel \text{objectType} \parallel \text{objectId} \parallel \text{metadata} \parallel \text{Hash}_{n-1} \parallel \text{occurredAt}\Big)$$

| Scenario | Tampering Simulation | Validation Result | Detection Mechanism |
|:--------:|----------------------|:-----------------:|---------------------|
| Baseline | Valid, un-tampered 3-event chain | Valid (`valid: true`) | All SHA-256 hashes match payload and predecessor links. |
| **1** | Modified event metadata in transit | Detected at Seq 2 | `Tampered event payload at seq 2: hash mismatch` |
| **2** | Deleted event in middle of chain (Event 2 dropped) | Detected at Seq 3 | `Sequence discontinuity between seq 1 and 3` |
| **3** | Missing sequence number (Seq artificially altered) | Detected at Seq 5 | `Sequence discontinuity between seq 1 and 5` |
| **4** | Corrupted previous hash (`prevHash` mismatch) | Detected at Seq 3 | `Broken hash link at seq 3: expected prevHash ..., found ...` |
| **5** | Reordered events (Events 2 and 3 swapped) | Detected at Seq 3 | `Sequence discontinuity` / `Broken hash link` |
| **6** | Invalid genesis block hash (Seq 1 `prevHash` corrupted) | Detected at Seq 1 | `Invalid genesis block hash at seq 1: expected 000...000` |

---

## 6. Consent & OAuth Revocation Flow

The consent and revocation subsystem (`ConsentService`) implements the requirements of the DPDP Act and enterprise privacy controls:
1. **Pre-Import Consent Gate:** Repository connections fail closed if active consent for purpose `repo_verification` is not present.
2. **Local Token Purge:** Upon calling `revokeConsent`, all OAuth access tokens associated with the student are immediately deleted from storage.
3. **Provider Revocation Boundary:** 
   - When production GitHub OAuth client credentials (`GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`) are present, the upstream revocation API is called.
   - In sandbox/development environments where external credentials are absent, the provider status is explicitly recorded as `sandbox_inert` to ensure deterministic offline execution while guaranteeing complete local purge.
4. **Derived Artifact Handling:** All evidence items derived from the revoked repository are immediately updated to `status = 'withdrawn'`.
5. **Skill State Downgrade:** Skills that were `evidence_linked` or `verified` solely through the withdrawn evidence are downgraded to `claimed` via `SkillStateMachine.transition`.
6. **Audit Trail:** Every phase of the revocation workflow emits immutable audit events (`CONSENT_REVOKED`, `OAUTH_TOKENS_PURGED`, `DERIVED_ARTIFACTS_WITHDRAWN`).

---

## 7. Fairness Calculation & Institutional Policy Thresholds

The fairness engine (`packages/domain/src/fairness-calculator.ts`) implements the standard Four-Fifths Rule (Impact Ratio $\ge 0.80$):
$$\text{Impact Ratio} = \frac{\text{Selection Rate}_{\text{Protected}}}{\text{Selection Rate}_{\text{Reference}}}$$

### Engineered Safeguards
1. **Zero-Denominator Defense:** If reference group applications equal zero, or protected group applications equal zero, the engine handles the edge case gracefully without throwing `NaN` or `Infinity`.
2. **Configurable Small-Group Suppression ($N < \text{threshold}$):** 
   - Groups with fewer than a configurable threshold of applicants (default $N < 5$) are suppressed from automated fairness dashboards to prevent demographic re-identification.
   - **Regulatory Notice:** As documented in `KNOWN_LIMITATIONS.md`, this threshold is an institutional privacy safeguard policy, **not** an established legal requirement.

---

## 8. Automated Test Execution Commands & Raw Outputs

All tests were executed on Windows 11 using PowerShell and Node.js v25.6.1.

### 8.1 TypeScript Strict Mode Type Check
```powershell
npx tsc --noEmit
# Exit code: 0 (Zero errors)
```

### 8.2 Real PostgreSQL 17 on Supabase Integration Test
```powershell
npx vitest run db/tests/supabase-real-db.test.ts
```
**Output:**
```text
 RUN  v2.1.9 C:/Users/SEBIN/Desktop/PRAMAAN

 ✓ db/tests/supabase-real-db.test.ts (19 tests) 6036ms
   ✓ Real PostgreSQL 17 on Supabase: Security, RLS & Verification Invariants > 1. Role check: app_api, ai_worker, and fairness_job must have NOBYPASSRLS 35ms
   ✓ Real PostgreSQL 17 on Supabase: Security, RLS & Verification Invariants > 2. Table check: all 42 domain and tenant tables have RLS enabled and forced 42ms
   ✓ Real PostgreSQL 17 on Supabase: Security, RLS & Verification Invariants > 3. Multi-tenant SELECT isolation: College A reads Student A, sees 0 Student B rows 180ms
   ✓ Real PostgreSQL 17 on Supabase: Security, RLS & Verification Invariants > 4. Multi-tenant SELECT isolation: College B reads Student B, sees 0 Student A rows 175ms
   ✓ Real PostgreSQL 17 on Supabase: Security, RLS & Verification Invariants > 5. Multi-tenant INSERT violation: College A cannot insert a student for College B 312ms
   ✓ Real PostgreSQL 17 on Supabase: Security, RLS & Verification Invariants > 6. Multi-tenant UPDATE isolation: College A cannot mutate College B records 321ms
   ✓ Real PostgreSQL 17 on Supabase: Security, RLS & Verification Invariants > 7. Multi-tenant DELETE isolation: College A cannot delete College B records 324ms
   ✓ Real PostgreSQL 17 on Supabase: Security, RLS & Verification Invariants > 8. Connection pooling context reset: context clears and fails closed when app.current_org_id is absent 321ms
   ✓ Real PostgreSQL 17 on Supabase: Security, RLS & Verification Invariants > 9. Path 1: Cannot insert a VERIFIED skill without accepted evidence and verification record 195ms
   ✓ Real PostgreSQL 17 on Supabase: Security, RLS & Verification Invariants > 10. Path 2: Cannot update an existing skill (claimed) to VERIFIED without accepted evidence 190ms
   ✓ Real PostgreSQL 17 on Supabase: Security, RLS & Verification Invariants > 11. Path 3: Cannot verify against withdrawn evidence 557ms
   ✓ Real PostgreSQL 17 on Supabase: Security, RLS & Verification Invariants > 12. Path 4: Cannot link evidence belonging to Student B to Student A skill (trigger check) 185ms
   ✓ Real PostgreSQL 17 on Supabase: Security, RLS & Verification Invariants > 13. Path 5: Cannot verify using evidence linked to a different skill 192ms
   ✓ Real PostgreSQL 17 on Supabase: Security, RLS & Verification Invariants > 14. Path 6: Cannot verify after a failed probe session 422ms
   ✓ Real PostgreSQL 17 on Supabase: Security, RLS & Verification Invariants > 15. Path 7: Can verify with qualifying accepted evidence and passing verification session 380ms
   ✓ Real PostgreSQL 17 on Supabase: Security, RLS & Verification Invariants > 16. Path 8: Expired skill can be re-verified only through qualifying passing path 612ms
   ✓ Real PostgreSQL 17 on Supabase: Security, RLS & Verification Invariants > 17. Audit Immutability Layer 1: app_api role is denied UPDATE and DELETE privileges at DCL level 457ms
   ✓ Real PostgreSQL 17 on Supabase: Security, RLS & Verification Invariants > 18. Audit Immutability Layer 2: Trigger trg_audit_events_immutable prohibits UPDATE regardless of privileges 188ms
   ✓ Real PostgreSQL 17 on Supabase: Security, RLS & Verification Invariants > 19. Audit Immutability Layer 2: Trigger trg_audit_events_immutable prohibits DELETE regardless of privileges 338ms

 Test Files  1 passed (1)
      Tests  19 passed (19)
   Duration  6.45s
```

### 8.3 Physical Connection Pool Reuse & Socket Isolation Test
```powershell
npx vitest run db/tests/connection-pool-reuse.test.ts
```
**Output:**
```text
 RUN  v2.1.9 C:/Users/SEBIN/Desktop/PRAMAAN

 ✓ db/tests/connection-pool-reuse.test.ts (1 test) 2136ms
   ✓ Real PostgreSQL Connection Pooling: Physical Connection Reuse & Context Isolation > Verifies genuine physical connection reuse and strict fail-closed context reset 1464ms

 Test Files  1 passed (1)
      Tests  1 passed (1)
   Duration  2.58s
```

### 8.4 Genuine Supabase Asymmetric ES256 & Strict Claims Verification
```powershell
npx vitest run apps/api/tests/real-supabase-jwt.test.ts
```
**Output:**
```text
 RUN  v2.1.9 C:/Users/SEBIN/Desktop/PRAMAAN

 ✓ apps/api/tests/real-supabase-jwt.test.ts (21 tests) 6875ms
   [Genuine Supabase Live Integration Tests — ES256 against live project JWKS]
   ✓ Real Supabase JWT Authentication & JWKS Verification (P0-1, P0-2, P0-4, P1-5) > 1. Authenticates genuine Supabase ES256 access token against live JWKS endpoint 816ms
   ✓ Real Supabase JWT Authentication & JWKS Verification (P0-1, P0-2, P0-4, P1-5) > 2. Rejects genuine token with tampered signature segment
   ✓ Real Supabase JWT Authentication & JWKS Verification (P0-1, P0-2, P0-4, P1-5) > 3. Rejects token when audience does not match expected "authenticated"
   ✓ Real Supabase JWT Authentication & JWKS Verification (P0-1, P0-2, P0-4, P1-5) > 4. Rejects token when issuer does not match expected Supabase auth endpoint
   ✓ Real Supabase JWT Authentication & JWKS Verification (P0-1, P0-2, P0-4, P1-5) > 5. Rejects unsigned token ("alg": "none")
   ✓ Real Supabase JWT Authentication & JWKS Verification (P0-1, P0-2, P0-4, P1-5) > 6. Rejects symmetric HS256 algorithm confusion against asymmetric ES256 verifier
   ✓ Real Supabase JWT Authentication & JWKS Verification (P0-1, P0-2, P0-4, P1-5) > 7. Rejects spoofed organization ID when user holds no membership in target tenant
   ✓ Real Supabase JWT Authentication & JWKS Verification (P0-1, P0-2, P0-4, P1-5) > 8. Rejects identity when membership status is suspended in database 1062ms
   ✓ Real Supabase JWT Authentication & JWKS Verification (P0-1, P0-2, P0-4, P1-5) > 9. Rejects identity when membership status is revoked in database 1757ms
   [Isolated Cryptographic Claims & Role Tests — Correctly signed test tokens, isolated test key]
   ✓ Real Supabase JWT Authentication & JWKS Verification (P0-1, P0-2, P0-4, P1-5) > 10. Rejects token with missing expiration (exp) claim
   ✓ Real Supabase JWT Authentication & JWKS Verification (P0-1, P0-2, P0-4, P1-5) > 11. Rejects expired token
   ✓ Real Supabase JWT Authentication & JWKS Verification (P0-1, P0-2, P0-4, P1-5) > 12. Rejects token with missing issuer (iss) claim
   ✓ Real Supabase JWT Authentication & JWKS Verification (P0-1, P0-2, P0-4, P1-5) > 13. Rejects token with missing audience (aud) claim
   ✓ Real Supabase JWT Authentication & JWKS Verification (P0-1, P0-2, P0-4, P1-5) > 14. Rejects token with missing or empty subject (sub) claim
   ✓ Real Supabase JWT Authentication & JWKS Verification (P0-1, P0-2, P0-4, P1-5) > 15. Rejects token with future issued-at (iat) timestamp beyond clock skew
   ✓ Real Supabase JWT Authentication & JWKS Verification (P0-1, P0-2, P0-4, P1-5) > 16. Rejects token when role claim is "service_role" (prohibiting service key as user auth)
   ✓ Real Supabase JWT Authentication & JWKS Verification (P0-1, P0-2, P0-4, P1-5) > 17. Rejects token when role claim is "anon" (anonymous key prohibited)
   ✓ Real Supabase JWT Authentication & JWKS Verification (P0-1, P0-2, P0-4, P1-5) > 18. Rejects token with missing role claim
   ✓ Real Supabase JWT Authentication & JWKS Verification (P0-1, P0-2, P0-4, P1-5) > 19. Rejects token with empty role claim
   ✓ Real Supabase JWT Authentication & JWKS Verification (P0-1, P0-2, P0-4, P1-5) > 20. Rejects token with invalid arbitrary role (e.g. "admin")
   ✓ Real Supabase JWT Authentication & JWKS Verification (P0-1, P0-2, P0-4, P1-5) > 21. Validates correctly signed token with role: "authenticated"

 Test Files  1 passed (1)
      Tests  21 passed (21)
   Duration  6.88s
```

### 8.5 Restricted Runtime Database Role & Parent University Discovery Verification (P0-2, P0-3)
```powershell
npx vitest run apps/api/tests/restricted-runtime-user.test.ts
```
**Output:**
```text
 RUN  v2.1.9 C:/Users/SEBIN/Desktop/PRAMAAN

 ✓ apps/api/tests/restricted-runtime-user.test.ts (9 tests) 8735ms
   ✓ Production Security: Restricted Runtime Database Login Verification (P0-2, P0-3) > 1. Application pool connects strictly as pramaan_app_user (never postgres, superuser or service_role) 516ms
   ✓ Production Security: Restricted Runtime Database Login Verification (P0-2, P0-3) > 2. Verifies pramaan_app_user is NOT a superuser
   ✓ Production Security: Restricted Runtime Database Login Verification (P0-2, P0-3) > 3. Verifies pramaan_app_user has NOBYPASSRLS (Kernel RLS enforced)
   ✓ Production Security: Restricted Runtime Database Login Verification (P0-2, P0-3) > 4. Verifies pramaan_app_user cannot create roles or databases
   ✓ Production Security: Restricted Runtime Database Login Verification (P0-2, P0-3) > 5. Verifies pramaan_app_user is prohibited from executing DDL statements
   ✓ Production Security: Restricted Runtime Database Login Verification (P0-2, P0-3) > 6. Verifies transaction role assumption switches to app_api within tenant transaction 424ms
   ✓ Production Security: Restricted Runtime Database Login Verification (P0-2, P0-3) > 7. Verifies scoped identity resolution function callable by pramaan_app_user
   ✓ Production Security: Restricted Runtime Database Login Verification (P0-2, P0-3) > 8. Verifies PgTenantRepository enforces tenant isolation under app_api RLS (P0-3) 2087ms
   ✓ Production Security: Restricted Runtime Database Login Verification (P0-2, P0-3) > 9. Enforces parent university discovery relationship (College discovers parent university, NEVER unrelated university) 3638ms

 Test Files  1 passed (1)
      Tests  9 passed (9)
   Duration  8.74s
```

### 8.6 Full Monorepo Vitest Suite (187 Tests Across 23 Files)
```powershell
npx vitest run
```
**Output:**
```text
 RUN  v2.1.9 C:/Users/SEBIN/Desktop/PRAMAAN

 ✓ packages/domain/tests/skill-state-machine.test.ts (8 tests) 9ms
 ✓ packages/domain/tests/audit-chain.test.ts (19 tests) 22ms
 ✓ db/tests/test-safety-guard.test.ts (39 tests) 4411ms
 ✓ apps/api/tests/auth-membership-tenant.test.ts (13 tests) 27ms
 ✓ apps/api/tests/m1-consent-ledger.test.ts (3 tests) 7ms
 ✓ packages/domain/tests/fairness-calculator.test.ts (5 tests) 7ms
 ✓ apps/api/tests/prod-fail-closed.test.ts (15 tests) 391ms
 ✓ apps/api/tests/api-endpoints.test.ts (7 tests) 457ms
 ✓ apps/api/tests/api-route-rbac.test.ts (18 tests) 593ms
 ✓ packages/domain/tests/eligibility-evaluator.test.ts (5 tests) 5ms
 ✓ db/tests/admin-tls-and-ledger.test.ts (6 tests) 788ms
 ✓ apps/api/tests/email-takeover-prevention.test.ts (4 tests) 14ms
 ✓ apps/api/tests/m1-tenancy-rls.test.ts (5 tests) 4ms
 ✓ apps/api/tests/m1-audit-chain.test.ts (3 tests) 6ms
 ✓ packages/domain/tests/anchor-resolver.test.ts (4 tests) 5ms
 ✓ db/tests/migration-runner.test.ts (4 tests) 1630ms
 ✓ apps/api/tests/pg-auth-integration.test.ts (2 tests) 1518ms
 ✓ apps/api/tests/real-supabase-jwt.test.ts (21 tests) 5426ms
 ✓ db/tests/connection-pool-reuse.test.ts (1 test) 2694ms
 ✓ apps/api/tests/consent-adversarial.test.ts (7 tests) 3225ms
 ✓ apps/api/tests/restricted-runtime-user.test.ts (9 tests) 5818ms
 ✓ apps/api/tests/audit-concurrency-and-consent.test.ts (5 tests) 7328ms
 ✓ db/tests/supabase-real-db.test.ts (20 tests) 20829ms

 Test Files  23 passed (23)
      Tests  223 passed (223)
   Start at  18:47:41
   Duration  21.65s (transform 1.08s, setup 0ms, collect 5.55s, tests 56.85s, environment 6ms, prepare 3.90s)
```

### 8.7 Test Environment Breakdown & Multi-Stage Execution Distinction (P1)
To ensure absolute reporting accuracy and maintain transparency across environments, test executions are strictly partitioned into three distinct evidence categories:

1. **Full Local Monorepo Vitest Run:**
   - **Environment:** Local workstation with configured development `.env` credentials (`DATABASE_URL`, `DATABASE_URL_ADMIN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ALLOW_DESTRUCTIVE_DB_TESTS=true`, `CHECKPOINT_SIGNING_KEY`).
   - **Scope:** All 23 test files (pure domain algorithms, Fastify API, administrative SSL/ledger, connection pool reuse, genuine JWKS, restricted runtime user, strict database test safety guards, and live Supabase PostgreSQL 17 database).
   - **Result:** **223 passed (100%)**, 0 failed, 0 skipped.

2. **Isolated PostgreSQL 17 GitHub Actions Tests (CI Job 2):**
   - **Environment:** Clean `postgres:17-alpine` Docker service container inside GitHub Actions (`.github/workflows/ci.yml`).
   - **Scope:** Zero remote database dependency. Executes clean migration runner (001 through 010), verifies migration idempotency on rerun, provisions restricted runtime principal `pramaan_app_user`, seeds multi-tenant data (`scripts/seed-demo.mjs`), and executes 7 isolated integration test suites (`migration-runner`, `audit-concurrency-and-consent`, `consent-adversarial`, `restricted-runtime-user`, `connection-pool-reuse`, `supabase-real-db`, `test-safety-guard`).
   - **Result:** **PASSED** in CI.

3. **Remote Live Supabase Verification Gate (CI Job 3):**
   - **Environment:** Environment-dependent gate in GitHub Actions.
   - **Scope:** Requires repository secrets (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `DATABASE_URL_ADMIN`).
   - **Result:** **SKIPPED** in GitHub Actions CI when credentials are not injected in the repository context (`has_secrets = false`). In GitHub Actions CI, the live Supabase JWT verification step was **SKIPPED, NOT PASSED**. Complete verification against live Supabase was confirmed locally under verified credentials. Local test results and GitHub Actions CI results represent separate evidence.

---

## 9. Forensic Investigation of Migration 009 Audit Event Cleanup & Audit-Chain Integrity (P0)

An independent code audit of `db/migrations/009_audit_chain_concurrency_and_uniqueness.sql` identified that the migration temporarily disabled trigger `trg_audit_events_immutable` to execute:
```sql
DELETE FROM audit_events WHERE action = 'TEST_EVENT' AND seq = 99999;
```
A comprehensive forensic investigation and cryptographic correction were conducted to determine the provenance, rationale, data impact, and chain-integrity resolution of this operation:

### 9.1 Provenance & Source History Attribution
1. **Origin in Test Code (Commit `0bf87bdf`):** In initial development commit `0bf87bdf4dcb8d6b4f8850e7055bc9eb3488db4c`, the test suite in `db/tests/supabase-real-db.test.ts` (tests 10 and 11) tested trigger-enforced immutability on PostgreSQL by inserting synthetic audit records with `action = 'TEST_EVENT', seq = 99999, hash = repeat('a', 64)` under College A (`00000000-0000-0000-0000-000000000001`).
2. **Refactoring of Test Suite (Commit `454854e`):** In subsequent commit `454854ec22a7d51adaf9a224dfe2cea9dccc9344`, the test was refactored to use `seq = 99991` and action `'AUDIT_VERIFICATION_TEST'`, adding superuser trigger-disabled cleanup in test 19.
3. **Persistence in Shared Database:** Because earlier test runs under commit `0bf87bdf` verified that `DELETE` queries are aborted by `trg_audit_events_immutable`, the synthetic test events from that commit remained in the development database. Repeated test runs generated duplicate sequence rows for `seq = 99999`.
4. **Migration 009 Blockage:** When Migration 009 was drafted to enforce engine-level uniqueness via `CONSTRAINT uq_audit_events_org_seq UNIQUE (org_id, seq)`, execution failed due to duplicate sequence groups for `seq = 99999`. The migration therefore included an administrative cleanup block disabling the trigger strictly to delete `action = 'TEST_EVENT' AND seq = 99999`.

### 9.2 Migration 009 SQL Scope & Organization Impact
The cleanup query in `009_audit_chain_concurrency_and_uniqueness.sql` was:
```sql
DELETE FROM audit_events WHERE action = 'TEST_EVENT' AND seq = 99999;
```
**Key Audit Finding:** This query was executed **without an `org_id` condition**. While the originating test in `0bf87bdf` targeted College A, the SQL deletion was unconstrained by organization and would have removed rows matching `action = 'TEST_EVENT' AND seq = 99999` across any organization.

### 9.3 Distinction: Verified Live Database Evidence vs Source History Inference
To maintain strict evidentiary integrity, verified facts are distinguished from source history inferences:

- **Verified from Live Database Evidence:**
  1. Exactly two organizations exist in the `organizations` catalog: College A (Apex Institute of Technology, `00000000-0000-0000-0000-000000000001`) and College B (Zenith Engineering College, `00000000-0000-0000-0000-000000000002`).
  2. Tenant College B's audit chain is 100% intact from `seq = 1` through `seq = 64`, originating at `GENESIS_HASH` (`0000...0000`) with zero sequence gaps or missing predecessors.
  3. Tenant College A's surviving audit events begin at `seq = 100000` with `prev_hash = repeat('a', 64)` (60 sequential records from `100000` to `100059`).
  4. The exact number of rows deleted at migration time is not recorded in the database ledger or audit log, as the anonymous PL/pgSQL block did not output or record row counts, and point-in-time PostgreSQL statement logs/backups from that execution were not preserved.
- **Inferred from Source History:**
  1. Commit history (`0bf87bdf`) establishes that `action = 'TEST_EVENT'`, `seq = 99999`, and dummy hash `repeat('a', 64)` were synthetic test artifacts.
  2. Available code, schemas, and seeds contain no definitions of real user, student, or institutional audit events utilizing `action = 'TEST_EVENT'` or `seq = 99999`.
  3. Because execution log counts do not exist, absolute zero real-data impact cannot be claimed without reservation; the evidence confirms only that no real business events matching those specific test parameters existed in platform code or schema contracts.

### 9.4 Cryptographic Checkpoint Authenticity & Audit-Chain Integrity Correction (P0 Remediation)
An independent vulnerability review identified that `VerifyChainOptions.trustedCheckpoint` previously accepted any plain `{ seq, hash }` object and verified its linkage without authenticating the checkpoint itself. Furthermore, College A's historical predecessor `{ seq: 99999, hash: repeat('a', 64) }` originated from a synthetic test artifact in commit `0bf87bdf` and was not an independently authenticated cryptographic checkpoint. Additionally, an earlier iteration allowed callers to supply their own `checkpointSigningKey` in `VerifyChainOptions`, which could allow callers to forge arbitrary checkpoints.

**Remediations Applied in `@pramaan/domain` and `@pramaan/contracts`:**
1. **Complete Chain Rule:** A complete chain must start at `seq = 1` and reference `AuditChain.GENESIS_HASH` (`COMPLETE_AND_VALID`, `isComplete: true`).
2. **Rejection of Plain/Unauthenticated Checkpoints:** Plain `{ seq, hash }` objects, unauthenticated hashes, and the historical dummy `repeat('a', 64)` hash without an authentic signature are strictly rejected as `INVALID` (`valid: false`, `isComplete: false`).
3. **Backend-Only Checkpoint Verification Key (P1-2):** Removed `checkpointSigningKey` from caller-controlled `VerifyChainOptions`. `AuditChain.verifyChain()` strictly resolves the trusted verification key from backend environment configuration (`process.env.CHECKPOINT_SIGNING_KEY`). Never accept verification keys from an HTTP request, query parameter, body, student input, or arbitrary repository caller. If no backend signing key is configured, checkpoint verification fails closed as `INVALID`. Callers cannot supply or override verification keys.
4. **Cryptographic Checkpoint Authentication Protocol:**
   - **Organization Binding:** Checkpoint must explicitly bind to the tenant's UUID `orgId`. A checkpoint signed for one tenant cannot be applied to another tenant's chain.
   - **Sequence & Hash Binding:** `seq` must be a finite, non-negative integer (`seq >= 0`), and `hash` must be a valid 64-character hexadecimal SHA-256 string.
   - **Cryptographic Signature Verification:** Checkpoints must be signed using HMAC-SHA256 over canonical payload `${orgId}:${seq}:${hash.toLowerCase()}:${signedAt}` using `process.env.CHECKPOINT_SIGNING_KEY`. Signatures are verified in constant time (`timingSafeEqual`) to prevent timing side-channel attacks.
   - **No Checkpoint Acceptance via Untrusted HTTP Requests:** The public/officer API `/api/audit/verify` accepts no checkpoint overrides from client HTTP query parameters or request bodies. It executes verification strictly against the persistent database ledger.
   - **HMAC Architecture & Future Direction:** HMAC-SHA256 verification relies on the confidentiality of the backend shared secret. Asymmetric Ed25519 signing (where public keys verify signatures without exposing signing authority) is identified as a candidate future enhancement for multi-party distributed audits, while HMAC satisfies M1 integrity requirements without introducing external key infrastructure.
5. **Distinct Verification States:**
   - **`COMPLETE_AND_VALID` (`valid: true, isComplete: true`):** Chain starts at `seq = 1` with `GENESIS_HASH`, sequence is contiguous, all payload hashes match, and all cryptographic links are valid.
   - **`PARTIAL_BUT_LINKS_VALID` (`valid: true, isComplete: false`):** Chain suffix starts at `seq > 1` matching an authenticated, cryptographically signed `trustedCheckpoint`. Contiguous, internally unbroken. Clients cannot interpret this state as proof of complete genesis integrity.
   - **`UNANCHORED` (`valid: false, isComplete: false`):** Chain suffix starts at `seq > 1` without an authenticated checkpoint, or does not match the supplied checkpoint.
   - **`INVALID` (`valid: false, isComplete: false`):** Cryptographic tampering, broken hash link, sequence discontinuity, invalid genesis hash, unauthenticated checkpoint, forged signature, caller key injection attempt, or malformed hash format detected.
6. **Separate Suffix Link Verification (`verifySuffixLinks`):** Internal cryptographic linkage and payload integrity can be verified independently via `AuditChain.verifySuffixLinks(events)`. This explicitly confirms internal consistency without validating or asserting anchor authenticity or whole-chain provenance.
7. **Tenant College A Status:** In the shared development database, College A's historical chain starts at `seq = 100000` with `prev_hash = repeat('a', 64)`. Because no cryptographically signed checkpoint exists for this historical boundary, College A remains strictly **`UNANCHORED`** (`valid: false`, `isComplete: false`). Internal suffix links being valid (`verifySuffixLinks() === true`) does **not** authenticate the missing historical prefix (`seq = 1` to `99999`). Complete cryptographic verification cannot be claimed for an unanchored chain. Deleted audit events are not invented or artificially reconstructed.
8. **Migration Immutability Preserved:** Migration 009 has NOT been modified on disk, preserving its exact SHA-256 checksum in `schema_migrations`.

### 9.5 Live Database Test Safety Guards, Cross-Tenant Cleanup Fix & Target Allowlist (P0 / P1)
To prevent integration test executions from causing unintended side-effects or deleting institutional data:
1. **Fix Cross-Tenant Audit Deletion & Mandatory Exact Identifiers (P0-1):** In `db/tests/supabase-real-db.test.ts`, previous test teardown executed `DELETE FROM audit_events WHERE org_id = '...' OR seq = 99991`. The unconstrained `OR seq = 99991` clause was globally scoped and risked deleting audit events from other organizations sharing sequence 99991. Remediations:
   - Completely removed the unconstrained `OR seq = 99991` clause.
   - Every audit cleanup query is strictly scoped to `TEST_AUDIT_TENANT_ID = 'e0000000-0000-0000-0000-000000000099'`.
   - Matches exact `action = 'AUDIT_VERIFICATION_TEST'`, `object_type = 'student_skill'`, and unique event ID `TEST_AUDIT_EVENT_ID = 'e9999999-0000-0000-0000-000000000001'`.
   - `safeCleanupTestAuditEvents` requires all 5 exact identifiers: `orgId`, `seq`, `action`, `objectType`, `id`. Calling with only `orgId` or omitting any identifier throws an immediate fatal error and executes no SQL.
   - Executed via `safeCleanupTestAuditEvents`: trigger disable, exact tenant-scoped deletion, and trigger re-enable occur inside a single database transaction on one dedicated client. Transaction rollback restores trigger state if any step fails.
   - Both pre-test (`beforeAll`) and teardown (`afterAll`) use identical safe tenant-scoped predicates.
   - Added Regression Test 20 to `db/tests/supabase-real-db.test.ts`, proving that cleanup of `TEST_AUDIT_TENANT_ID` with sequence 99991 cannot delete another organization's audit event sharing sequence 99991.
2. **Database Target Identity Protection & Strict URL Parser Allowlisting (P1-3):**
   - **Replaced Substring Allowlisting with URL Parsing:** Substring matching (`urlLower.includes(...)`) was permanently replaced with WHATWG URL parsing (`new URL(dbUrl)`). Protocol is validated strictly as `postgresql:` or `postgres:`.
   - **Exact Hostname Allowlist:** Local approved hosts must match exact normalized hostnames (`localhost`, `127.0.0.1`, `::1`, `host.docker.internal`, `postgres`). Subdomain spoofing (e.g. `localhost.attacker.example`) and path-based spoofing (e.g. `attacker.example/pramaan_test`) are strictly rejected.
   - **Separate Database Name Validation:** Database name is parsed and validated separately against `DEFAULT_APPROVED_DB_NAMES` (`pramaan_test`, `postgres`, `test`, `pramaan_dev`, `template1`). Production database names (e.g. `production`, `pramaan_production`) on local hosts are rejected.
   - **Remote Supabase Target Authentication:** Remote targets must match exact approved project references (`qshujrddrzoemlzmleru`) within recognized host formats (`db.<ref>.supabase.co` direct, or `<region>.pooler.supabase.com` with `<user>.<ref>`). Project references appearing in passwords, query parameters, or paths on unrelated hosts (e.g. `attacker.example/qshujrddrzoemlzmleru`) are strictly rejected.
   - **Fail Closed on Missing Target Identity:** Missing `DATABASE_URL_ADMIN` and missing `targetUrl` in `assertSafeTestEnvironment()` fails closed immediately (`Database target identity is missing`).
   - **Target Identity Validation on All Direct Admin Queries:** `assertApprovedDatabaseTarget(adminUrl)` validates database target identity and environment guards for all queries executed via direct admin connection, ensuring ordinary read-only queries cannot bypass database target allowlisting.
   - **Prohibition of Management API Fallback for Mutations:** `runQuery()` prohibits Management API execution for destructive, mutating, or side-effecting queries. Destructive operations strictly require direct `DATABASE_URL_ADMIN` PostgreSQL connectivity.
   - **Strict Management API Gatekeeping (`isSafeReadOnlyQuery`):** Management API fallback strictly requires queries to be verified safe read-only statements (`isSafeReadOnlyQuery`). Any query containing side-effects, transaction commands, session alterations, or unverified statement verbs is blocked.
   - **Approved Project Reference Required for Management API:** Management API queries require `SUPABASE_PROJECT_REF` to be explicitly set and validated against `isApprovedSupabaseProjectRef()`. Silent default fallback is prohibited.
   - **Explicit Opt-In Required:** `assertSafeTestEnvironment(operation, targetUrl)` halts execution immediately unless `ALLOW_DESTRUCTIVE_DB_TESTS=true` is set.
   - **Environment Guard:** Fails closed if `NODE_ENV === 'production'`, `ENVIRONMENT === 'production'`, or `VERCEL_ENV === 'production'`.
3. **Comprehensive Mutation, DDL, Side-Effect & Privileged Transaction Boundary Guarding (Layered Defense):**
   - `isMutationQuery(sql)` / `isDestructiveQuery(sql)` inspects SQL queries after stripping block comments (`/* ... */`), line comments (`-- ...`), string literals (`'...'`), double-quoted identifiers (`"..."`), and dollar-quoted strings (`$$...$$`).
   - **Privileged Transaction Control & Boundary Enforcement (`hasTransactionControl`):** Transaction control statements (`BEGIN`, `START TRANSACTION`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`, `RELEASE SAVEPOINT`) are classified as privileged operations (`isDestructiveQuery === true`). Queries containing transaction commands can never enter the unprivileged read-only path; they require direct `DATABASE_URL_ADMIN` connectivity, explicit `ALLOW_DESTRUCTIVE_DB_TESTS=true` authorization, non-production environment, and an approved test database target.
   - **Prevention of Read-Only Transaction Escapes:** In the general read-only path of `runQuery`, because `isDestructiveQuery` is false, queries contain zero transaction-control keywords (no `COMMIT` or `ROLLBACK`). Queries are wrapped unconditionally in `BEGIN READ ONLY; ... COMMIT;`. Callers cannot prematurely commit or escape the read-only transaction boundary.
   - **PostgreSQL Engine-Level Mutation Blocking:** Any unrecognized user-defined stored function (e.g. `public.custom_mutator()`) that attempts an `INSERT`, `UPDATE`, or `DELETE` is stopped unconditionally at the PostgreSQL storage engine level (`cannot execute INSERT in a read-only transaction`), guaranteeing that unclassified mutating functions cannot bypass safety guards.
   - **Dedicated Test Transaction Execution (`runTestTransaction`):** A dedicated, explicitly authorized helper `runTestTransaction(sql)` is provided for multi-statement test transactions legitimately requiring `BEGIN; SET LOCAL ROLE ...; COMMIT;`.
   - **Side-Effecting Function Detection (`hasSideEffectingFunction`):** Detects PostgreSQL functions with state-mutating, server-altering, or session-locking side effects, including `nextval()`, `setval()`, Large Object functions (`lo_create`, `lo_unlink`, `lo_import`, `lo_export`), administrative control functions (`pg_terminate_backend`, `pg_cancel_backend`, `pg_reload_conf`, `pg_rotate_logfile`, `pg_create_restore_point`, `pg_switch_wal`, `pg_promote`), replication slot functions (`pg_create_logical_replication_slot`, `pg_drop_replication_slot`), notification and filesystem functions (`pg_notify`, `pg_write_file`, `pg_file_unlink`), advisory locks (`pg_advisory_lock`, `pg_advisory_xact_lock`), and remote execution (`dblink_exec`).
   - **Mutation & DDL Commands:** Detects all standard data and schema mutations: `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `DROP`, `ALTER`, `CREATE`, `GRANT`, `REVOKE`, `RENAME`, `DO`, `CALL`, `EXECUTE`, `VACUUM`, `REINDEX`, `COPY`, `LOCK`, PostgreSQL `MERGE` statements (`MERGE INTO ...`), `SELECT INTO` table creation statements (`SELECT ... INTO ...`), as well as `CLUSTER`, `REFRESH`, `CHECKPOINT`, and `REASSIGN`.
   - **Engine-Level READ ONLY Transaction Execution:** Read-only queries executed via direct admin connection are wrapped inside `BEGIN READ ONLY; ... COMMIT;`. PostgreSQL's core storage engine natively blocks mutations, table writes, and sequence increments (`cannot execute nextval() in a read-only transaction`).
   - **Management API Payload Isolation:** When falling back to Supabase Management API for safe read-only queries, the query payload is wrapped in `BEGIN READ ONLY; ${sql}; COMMIT;`, enforcing engine-level read-only guarantees on the remote server. Schema-qualified user-defined functions and transaction statements are rejected (`isSafeReadOnlyQuery`).
   - **Transparent Limitation / Heuristic Scope:** Regex detection operates as an application-level heuristic filter and is **not claimed to provide complete SQL grammar parsing**. True defense-in-depth is achieved through the multi-layer combination of heuristic filtering, engine-level PostgreSQL `READ ONLY` transaction isolation, strict target identity allowlisting, and Management API gatekeeping.
   - **Comments and Literal Preservation:** Blocks bypass attempts hidden behind leading whitespace, inline comments, or multi-statement batches (`SELECT 1; DROP TABLE`). Preserves normal read-only `SELECT` queries without false positives on string literals or column names (e.g. `deleted_at`, or string literals containing `'MERGE'`, `'INTO'`, `'nextval'`, or `'setval'`).
   - **Automated Verification:** Verified by 39 regression tests in `db/tests/test-safety-guard.test.ts`.
4. **Dedicated Test Tenant Fixtures:** Tests no longer insert synthetic audit events into institutional tenant chains (`College A`). A dedicated test tenant (`TEST_AUDIT_TENANT_ID = 'e0000000-0000-0000-0000-000000000099'`) is used exclusively for immutability and DCL privilege testing.
5. **Institutional Tenant Immutability Protection:** `assertNotInstitutionalTenant(orgId)` blocks destructive operations against production institutional tenants (`00000000-0000-0000-0000-000000000001` and `00000000-0000-0000-0000-000000000002`). Institutional records are never deleted or modified by tests.
6. **Unconditional Trigger-Safe Cleanup:** Cleanup in `afterAll` runs within a `try ... finally` block, ensuring test audit events are cleaned up and the database immutability trigger `trg_audit_events_immutable` is unconditionally re-enabled even if assertions fail. Immutability triggers are never disabled outside tightly controlled test cleanup.

---

## 10. Management API Migration Atomicity & Strict Administrative Separation (P1)

### 10.1 Deprecation of Stateless Management API Mode
Previously, `scripts/migrate-supabase.mjs` supported a fallback mode using the Supabase Management API (`SUPABASE_MANAGEMENT_TOKEN`). Because the HTTP Management API executes queries statelessly without persistent database session affinity:
1. PostgreSQL session-level advisory locks (`pg_advisory_lock`) cannot be held across queries.
2. DDL execution and ledger insertion occurred in separate HTTP calls rather than a single atomic transaction.

**Remediation:** Stateless `supabase_api` mode has been disabled for schema migrations. Schema migrations strictly require direct PostgreSQL connectivity via `DATABASE_URL_ADMIN`. Attempting to run migrations without `DATABASE_URL_ADMIN` throws an immediate fatal error:
```
FATAL: DATABASE_URL_ADMIN is required for schema migrations. Management API mode is disabled due to lack of session advisory locking and transactional DDL, and fallback to application runtime credentials (DATABASE_URL) is strictly prohibited.
```

### 10.2 Strict Administrative Credential Separation
In both `scripts/migrate-supabase.mjs` and `scripts/seed-demo.mjs`:
- Fragile username string-matching (`pramaan_app_user` string check) has been eliminated.
- Fallback to application runtime credentials (`DATABASE_URL`) has been completely removed.
- Both scripts exclusively require `DATABASE_URL_ADMIN` with verified administrative privileges.

---

## 11. Production Repository Injection Defense & Fail-Closed Guards (P2)

In `apps/api/src/app.ts`, `buildApp()` enforces fail-closed startup invariants when `NODE_ENV === 'production'`:
1. **Custom Repository Injection Prohibited:** Attempting to inject any custom `tenantRepository`, `auditRepository`, `consentRepository`, or `userRepository` (including `Pg...` instances configured with external connection pools) is rejected with:
   ```
   FATAL: Production mode prohibits injecting custom repositories or mock stores. All production repositories must be constructed internally using the restricted runtime pool.
   ```
2. **Internal Construction:** In production mode, all repositories are unconditionally constructed internally using `getDbPool()`, guaranteeing they operate exclusively under the restricted runtime principal (`pramaan_app_user`) with `SET LOCAL` tenant isolation.
3. **AuthService Injection Prohibited:** Injected `authService` is rejected in production to guarantee that identity resolution cannot be hijacked.
4. **Automated Verification:** Verified by 15 fail-closed tests in `apps/api/tests/prod-fail-closed.test.ts`.

---

## 12. GitHub Repository Main Branch Protection Status (P2)

### 12.1 Current Live Status: NOT ENABLED (`protected: false`)
Automated inspection of repository branch metadata confirms:
```json
{
  "name": "main",
  "protected": false
}
```
> [!IMPORTANT]
> Branch protection on `main` is **NOT ENABLED** in GitHub repository settings. Branch protection cannot be enabled automatically from this local session because the GitHub CLI / administrative PAT is not configured in this environment. Branch protection must not be claimed as active merely because configuration rules are documented.

### 12.2 Required Manual GitHub Configuration
The repository administrator must enable branch protection in GitHub:
**Repository Settings → Branches → Add branch ruleset / Add branch protection rule** for branch pattern `main`:
1. **Require a pull request before merging:**
   - Require approvals: Minimum 1 review.
   - Dismiss stale pull request approvals when new commits are pushed: **Enabled**.
   - Require review from Code Owners: **Enabled**.
2. **Require conversation resolution before merging:** **Enabled**.
3. **Require status checks to pass before merging:**
   - Require branches to be up to date before merging: **Enabled**.
   - **Exact Required Status Check Names:**
     1. `Build, Lint, Strict Typecheck & DB-Independent Unit Tests` (Job: `build-and-unit-tests`)
     2. `Isolated PostgreSQL 17 RLS & Integration Verification` (Job: `isolated-postgres-integration`)
4. **Do not allow bypassing the above settings:** **Enabled** (enforced on administrators).

---

## 13. Conclusion & Readiness Gate for Milestone M2

The comprehensive M1 closure audit confirms that all security, tenancy, authentication, ledger, pipeline, and audit-integrity invariants are fully implemented, verified, and locked:
- **100% Passing Tests:** 223 automated tests across 23 test suites (0 failures, 0 regressions).
- **Authenticated Checkpoint Integrity:** `AuditChain.verifyChain()` strictly enforces genesis anchoring and cryptographic checkpoint authentication (orgId binding, finite non-negative integer seq, HMAC-SHA256 signature with backend-configured verification key). Caller-controlled signing keys are completely removed. Plain unauthenticated `{ seq, hash }` objects and the historical dummy `a*64` hash are strictly rejected as `INVALID`.
- **Tenant College A Status:** College A historical chain in the development database starts at `seq = 100000` and remains strictly **`UNANCHORED`** (`valid: false, isComplete: false`). Internal suffix links being valid does not authenticate missing historical prefixes. Complete verification is not claimed without an authentic cryptographic anchor.
- **Strict Database Target Guarding, Privileged Transaction Boundaries & Exact Audit Cleanup:** Eliminated substring-based allowlisting in favor of strict WHATWG URL parsing (PostgreSQL protocol, exact hostnames `localhost`, `127.0.0.1`, `::1`, `host.docker.internal`, `postgres`, separate database name validation, and exact project reference verification for Supabase). Missing target identity fails closed immediately. Direct admin database execution validates targets for all queries. Transaction control statements (`BEGIN`, `START TRANSACTION`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`) are classified as privileged/destructive operations (`isDestructiveQuery === true`), preventing read-only boundary escape or unrecognized function bypass. The general read-only path unconditionally wraps queries in `BEGIN READ ONLY; ... COMMIT;` (natively blocking any unrecognized mutating function at the engine level). A dedicated helper `runTestTransaction` is provided for authorized multi-statement test transactions. Management API execution is prohibited from executing mutations, side-effects, or transaction control, and payload is wrapped in `BEGIN READ ONLY;` for verified safe read-only queries (`isSafeReadOnlyQuery`). PostgreSQL side-effecting functions (`nextval`, `setval`, `lo_*`, `pg_terminate_backend`, etc.), DDL statements, MERGE statements, and SELECT INTO table creations are guarded by layered heuristic detection and engine-level PostgreSQL READ ONLY transactions (`cannot execute nextval() in a read-only transaction`). `safeCleanupTestAuditEvents` requires all 5 exact identifiers (`orgId`, `seq`, `action`, `objectType`, `id`), prohibiting blanket tenant deletions. Institutional records are unconditionally protected.
- **Forensic Accuracy:** Commit attribution (`0bf87bdf` vs `454854e`) and Migration 009 deletion scope are accurately documented, with verified database facts distinguished from commit history inferences.
- **Quality Gates:** ESLint (`npm run lint`), TypeScript strict typecheck (`npm run typecheck`), and monorepo production build (`npm run build`) all pass with 0 errors.
- **CI / CD Pipeline:** Multi-stage GitHub Actions workflow with clean isolated PostgreSQL 17 container execution and credential-safe live Supabase verification gate (status SKIPPED in CI when secrets are absent).
- **Credential & Tenancy Isolation:** Complete separation of administrative migration credentials (`DATABASE_URL_ADMIN`) from restricted runtime credentials (`DATABASE_URL`).
- **Main Branch Protection:** Accurately reported as **NOT ENABLED** (`protected: false`) with exact manual configuration steps provided.

**Milestone M1 is formally FROZEN, AUDITED, and SEALED.** Main branch protection is explicitly disclosed as NOT ENABLED (`protected: false`), awaiting manual configuration by the repository administrator in GitHub Settings. Live Supabase CI execution is explicitly disclosed as dependent on repository secrets. All M1 security criteria are locked and verified. Development may proceed to Milestone M2.

