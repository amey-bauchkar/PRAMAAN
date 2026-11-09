# PRAMAAN — Project Status

**Last Updated:** 2026-11-09  
**Stage:** Stage A (Completed) → Milestone M0, M1 & M2 Phase 1 (P0-05 Anchor Resolver) & Phase 2 (P0-04 Trusted Static Repository Ingestion) (COMPLETED, SECURITY REMEDIATED, BACKEND HARDENED & VERIFIED)  
**Lead Engineer:** Solo Developer Partner  
**Target Event:** QUASAR 5.0 (EdTech Domain)  

---

## 1. Executive Summary

PRAMAAN is an evidence-based placement intelligence platform built for colleges, students, placement officers (TPOs), and recruiters. Its core thesis is:
$$\text{Evidence} \rightarrow \text{Observed Skill} \rightarrow \text{Verification} \rightarrow \text{Verified Skill} \rightarrow \text{Skill Passport} \rightarrow \text{Eligibility} \rightarrow \text{Placement Decision}$$

Following the M0 monorepo foundation, M1 multi-tenancy/security hardening, and M2 Phase 1 (P0-05 Exact Anchor Resolver), **Milestone M2 Phase 2: Trusted Static GitHub Repository Ingestion Pipeline (P0-04)** has been implemented end-to-end, subjected to independent security review and backend reliability/consent review, fully remediated, integrated with authoritative P0-05 resolution, and verified across all quality gates:
- **Genuine GitHub OAuth Grant Revocation (Non-Blocking Outside DB Locks):** Implemented `revokeOAuthGrant(accessToken, signal)` on `IGitHubClient`, `DefaultGitHubClient`, and `MockGitHubClient`, issuing HTTP Basic-authenticated `DELETE /applications/{client_id}/grant` requests to the GitHub REST API. Provider-side revocation runs **strictly outside PostgreSQL transactions and row locks**, preventing connection pool exhaustion and database latency degradation. Local credentials, session tokens, and cached accounts are purged fail-closed with zero token leakage regardless of upstream HTTP network status.
- **Active Consent Uniqueness & Partial Unique Index Invariants (Migration 013):** Migration `013_active_consent_uniqueness.sql` reconciles legacy active duplicate grants and establishes the partial unique index `uq_consent_grants_active_student_purpose ON consent_grants (student_id, purpose) WHERE revoked_at IS NULL`. `PgConsentRepository.grantConsent()` utilizes transaction-level PostgreSQL advisory locks (`pg_advisory_xact_lock(hashtext(student_id || ':' || purpose))`) to serialize concurrent requests, automatically transitioning prior active grants to revoked state before inserting the new active grant. `revokeConsent()` guarantees strictly zero active grants remain.
- **Safe Canonical Repository Reconciliation & Data Loss Prevention (Migration 014):** Schema migration `014_safe_repository_reconciliation.sql` pre-flights and reconciles duplicate repositories on `(student_id, provider, provider_repo_id)`, safely re-parenting all dependent child records (`repo_snapshots`, `evidence_items`, `source_snapshots`, `trusted_ingestion_records`, `ingestion_jobs`) to the canonical repository (`imported_at ASC, id ASC`) while temporarily managing trigger `trg_trusted_ingestion_immutable`. Verifies zero duplicates remain before deleting redundant repository rows.
- **Bounded GitHub Tree Traversal & Fail-Closed Rate Limiting:** Enforces strict execution bounds: `maxTreeEntries = 5000`, `maxDirectoryTraversals = 100`, `maxTreeApiRequests = 30`, `maxFiles = 200`, and `maxWallClockMs = 30000ms` with `AbortSignal`. Implements early termination: immediately terminates traversal upon detecting more than 200 eligible files (`FILE_COUNT_LIMIT_EXCEEDED`). Detects GitHub rate limits (HTTP 403/429) fail-closed (`GITHUB_RATE_LIMIT_EXCEEDED`). Zero manifests or snapshots are persisted upon limit breach.
- **Ingestion Job Transitions on Revocation:** In `PgConsentRepository.revokeConsent()` and `cancelJobsForStudentOnRevocation()`, all in-progress jobs (`queued`, `resolving`, `fetching`, `verifying`, `persisted`) are transitioned to `status = 'failed'` with `error = 'CONSENT_REVOKED'` and `completed_at` set. Completed and already-failed jobs are strictly preserved for historical audit trails.
- **Audit Actor Identity Preservation:** Disambiguated authenticated actor identity (`users.id`) from student owner identity (`students.id`). Augmented `SessionContext` with optional `actorUserId`. Audit events record `actorId = context.actorUserId ?? context.userId` (`users.id`) whether student- or officer-initiated, while snapshots and ingestion records are owned by `students.id`. Preserves all frozen P0-05 resolver invariants without modifying frozen files.
- **Full Test Suite Success:** 503 tests pass across 29 test files (including 56 P0-04 ingestion integration tests, 59 durable PostgreSQL tests, and 8 CI safety tests), with 0 ESLint errors, 0 TypeScript errors, and successful monorepo production build.
- **Third Backend Hardening Pass (Revocation-Safe Re-Ingestion & Deterministic Gates):**
  - *Quarantined Snapshot Write Bypass Eliminated:* `PgSourceSnapshotStore.saveSnapshot()` requires active consent under `FOR SHARE` row lock for all newly written snapshots; quarantined snapshots cannot be newly persisted following consent revocation. Quarantining existing records is restricted to `updateRegistrationState()`, which forbids promoting quarantined snapshots back to `audit_committed`.
  - *Fresh Ingestion Under Re-Consent (Migration 015):* Implemented schema migration `015_consent_generation_and_fresh_reingestion.sql`, introducing `consent_grant_id` binding on `trusted_ingestion_records` and partial unique indexes `uq_trusted_ingestion_active_commit` (`WHERE status != 'revoked'`) and `uq_source_snapshots_active_commit_path` (`WHERE registration_state != 'quarantined'`). Preserves historical revoked records while allowing full re-ingestion of the same or new Git commit after re-consent.
  - *Migration 011a Preflight Lifecycle Reconciliation:* Expanded preflight conflict assertions to include provenance equality, conservative quarantine propagation on duplicate snapshots, and fail-closed abortion on conflicting record statuses or consent grants.
  - *Genuine Deterministic Concurrency Tests:* Zero `setTimeout` race manufacturing; Section 9 utilizes PostgreSQL lock detection via `pg_stat_activity` and explicit promise latches to verify lock contention, fail-closed ordering, audit promotion race, and cancellation races.
  - *Strict State Machine Graph:* `createJob` rejects initial states other than `queued`. Exact transition graph (`queued -> resolving -> fetching -> verifying -> persisted -> completed`) enforced across both In-Memory and PostgreSQL repositories.

---

## 2. Test Suite Classification & Verification Status

| Tier | Description | Files / Tests | Status |
| :--- | :--- | :--- | :--- |
| **Pure Unit Tests** | Pure domain logic: state machine, anchor hashing, exact code anchor resolver, student isolation, offline AST parsing, Git object byte/SHA verification, audit hash chaining, eligibility rules, 4/5ths fairness math. | 7 files, 110 tests | `UNIT_TESTED` (Passing in ~3s) |
| **API, RBAC & Adversarial Tests** | Fastify HTTP endpoints, positive RBAC matrix, anchor resolution API, snapshot registration mutex with leak-free cleanup, conditional audit rollback, registration commit state lifecycle, quarantined fail-closed checks, file manifest provenance, mandatory Git blob SHA, pre-persisted trusted ingestion record separation, prior consent enforcement, audit-failure safety, student ownership/consent gates, email takeover prevention, fail-closed startup, strict claims validation, JWT test utilities, consent adversarial boundaries, audit concurrency & tenant consent, GitHub OAuth PKCE S256, AES-256-GCM token cipher, static repository ingestion engine, bounded traversal, provider revocation, file filtering, limits, and administrative TLS/ledger integrity. | 15 files, 228 tests | `INTEGRATION_TESTED` (Passing in ~40s) |
| **Live Database Tests** | Real PostgreSQL 17 on Supabase: RLS isolation (46 tables enabled and forced), cross-tenant mutation rejection, triggers, constraints, DCL permissions, physical connection reuse via backend PID, restricted runtime user (`pramaan_app_user`), parent university discovery isolation, migration ledger idempotency, test safety guards, durable PostgreSQL repository adapters (`PgSourceSnapshotStore`, `PgTrustedIngestionStore`, `PgGitHubCredentialRepository`, `PgIngestionJobRepository`, `PgRepositoryRepository`, active consent uniqueness via Migration 013, safe repository preflight via Migration 011a, safe repository reconciliation via Migration 014, consent generation and fresh re-ingestion via Migration 015, atomic database consent gates, and job terminal state machines), and genuine Supabase ES256 JWKS token validation. | 7 files, 165 tests | `SECURITY_VERIFIED` (Passing on live Supabase DB) |
| **Total Suite** | Full monorepo test pack running under Vitest. | **29 files, 503 tests** | **100% Passing** |

### Complete Test Inventory (29 Files, 503 Tests)
1. `packages/domain/tests/exact-anchor-resolver.test.ts` (59 tests)
2. `packages/domain/tests/skill-state-machine.test.ts` (8 tests)
3. `packages/domain/tests/anchor-resolver.test.ts` (4 tests)
4. `packages/domain/tests/audit-chain.test.ts` (19 tests)
5. `packages/domain/tests/eligibility-evaluator.test.ts` (5 tests)
6. `packages/domain/tests/fairness-calculator.test.ts` (5 tests)
7. `packages/domain/tests/git-object.test.ts` (10 tests)
8. `apps/api/tests/anchor-service-and-api.test.ts` (80 tests)
9. `apps/api/tests/p0-04-github-ingestion.test.ts` (56 tests)
10. `apps/api/tests/m1-tenancy-rls.test.ts` (5 tests)
11. `apps/api/tests/m1-audit-chain.test.ts` (3 tests)
12. `apps/api/tests/m1-consent-ledger.test.ts` (3 tests)
13. `apps/api/tests/auth-membership-tenant.test.ts` (13 tests)
14. `apps/api/tests/api-endpoints.test.ts` (7 tests)
15. `apps/api/tests/api-route-rbac.test.ts` (18 tests)
16. `apps/api/tests/email-takeover-prevention.test.ts` (4 tests)
17. `apps/api/tests/prod-fail-closed.test.ts` (15 tests)
18. `apps/api/tests/consent-adversarial.test.ts` (7 tests)
19. `apps/api/tests/audit-concurrency-and-consent.test.ts` (5 tests)
20. `apps/api/tests/pg-auth-integration.test.ts` (2 tests)
21. `apps/api/tests/real-supabase-jwt.test.ts` (21 tests)
22. `apps/api/tests/restricted-runtime-user.test.ts` (9 tests)
23. `db/tests/admin-tls-and-ledger.test.ts` (6 tests)
24. `db/tests/connection-pool-reuse.test.ts` (1 test)
25. `db/tests/test-safety-guard.test.ts` (47 tests)
26. `db/tests/supabase-real-db.test.ts` (20 tests)
27. `db/tests/migration-runner.test.ts` (4 tests)
28. `db/tests/p0-04-pg-durable-repositories.test.ts` (59 tests)
29. `db/tests/workflow-ci-safety.test.ts` (8 tests)

---

## 3. Milestones Overview

| Milestone | Description | Target Tickets | Status |
| :--- | :--- | :--- | :--- |
| **M0** | Workspace & Foundation Setup | Monorepo layout, TS configs, linting, test runner, core domain types | `IMPLEMENTED` / `UNIT_TESTED` |
| **M1** | Tenancy, Auth & Consent Ledger | P0-01, P0-02, P0-03 (RLS, audit chain, purpose consent, real Supabase auth, RBAC) | `IMPLEMENTED` / `SECURITY_VERIFIED` |
| **M2** | Code Archaeology & Evidence Graph | P0-04, P0-05, P0-06 (P0-04 Static Ingestion & P0-05 Anchor Resolver completed & hardened; P0-06 lab queue next) | `IN_PROGRESS` (P0-04 & P0-05 COMPLETED) |
| **M3** | Skill Verification Arena & Probe | P0-07, P0-08, P0-09, P0-10 (Skill state machine, grounded viva, runner, rubric) | `NOT_STARTED` |
| **M4** | Skill Passport & Recruiter Discovery | P0-11, P0-12, P1-10 (Evidence card, passport verifier, role gap matcher) | `NOT_STARTED` |
| **M5** | Placement Engine & Fairness Simulator | P0-14, P0-15, P1-04, P1-05 (Deterministic eligibility, what-if simulator, drive allocations) | `NOT_STARTED` |
| **M6** | Breadth, Accreditation & Hardening | P0-16, P0-17, P1-01 to P1-17 (Mock drives, learning paths, JD profiler, analytics, export) | `NOT_STARTED` |

---

## 4. Current Blockers & Next Immediate Steps

- **Blockers:** None. Milestone M2 Phase 1 (P0-05) is 100% verified, security-hardened, and formally core frozen.
- **Explicit P0-04 Architectural Boundary:**
  - P0-05 deterministic code anchor resolution is completely implemented and tested.
  - To activate authoritative verification in production, Milestone M2 Ticket P0-04 must provide:
    1. Durable snapshot storage.
    2. Durable, write-once trusted ingestion record storage.
    3. Secure production wiring for both adapters through the application composition root (`buildApp()`).
    4. Verified Git commit/tree/blob fetching without executing repository code.
    5. Purpose-specific student consent (`repo_verification`) before repository ingestion.
    6. A server-generated canonical file manifest with Git blob SHA, SHA-256 raw file hash, and byteSize.
  - The current `buildApp()` production configuration must NOT be described as supporting durable authoritative ingestion until that wiring actually exists.
- **Immediate Next Steps for M2:**
  - Proceed with P0-04: Selected GitHub Repository Static Ingestion.
  - Proceed with P0-06: Non-Repository Evidence Workflow & Faculty Mentor Attestation Queue.
