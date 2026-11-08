# PRAMAAN — Project Status

**Last Updated:** 2026-11-08  
**Stage:** Stage A (Completed) → Milestone M0, M1 & M2 Phase 1 (P0-05 Anchor Resolver) & Phase 2 (P0-04 Trusted Static Repository Ingestion) (COMPLETED, REMEDIATED & VERIFIED)  
**Lead Engineer:** Solo Developer Partner  
**Target Event:** QUASAR 5.0 (EdTech Domain)  

---

## 1. Executive Summary

PRAMAAN is an evidence-based placement intelligence platform built for colleges, students, placement officers (TPOs), and recruiters. Its core thesis is:
$$\text{Evidence} \rightarrow \text{Observed Skill} \rightarrow \text{Verification} \rightarrow \text{Verified Skill} \rightarrow \text{Skill Passport} \rightarrow \text{Eligibility} \rightarrow \text{Placement Decision}$$

Following the M0 monorepo foundation, M1 multi-tenancy/security hardening, and M2 Phase 1 (P0-05 Exact Anchor Resolver), **Milestone M2 Phase 2: Trusted Static GitHub Repository Ingestion Pipeline (P0-04)** has been implemented end-to-end, subjected to independent security review, fully remediated, integrated with authoritative P0-05 resolution, and verified across all quality gates:
- **GitHub OAuth Scope Transparency & Hardening:** Accurately documented that GitHub OAuth `public_repo` scope grants read and write access to public repositories under GitHub's OAuth specification; PRAMAAN implements code-level enforcement to ensure only read operations (commits, trees, blobs) are performed. Configured fine-grained GitHub App permissions (`contents:read`, `metadata:read`) as production standard and minimal OAuth App scopes (`read:user`, `public_repo`). Callback verifies that both `read:user` and `public_repo` (or GitHub App permissions) are present, failing closed on missing scopes (`INSUFFICIENT_GITHUB_PERMISSIONS`, 403). Private repositories are rejected fail-closed with 400 `PRIVATE_REPOSITORY_NOT_SUPPORTED`.
- **Concurrency-Safe Canonical Repositories & Migration 012:** Schema migration `012_canonical_repository_unique_constraint.sql` deduplicates existing rows and establishes a unique constraint `uq_repositories_student_provider_repo` on `(student_id, provider, provider_repo_id)`. `PgRepositoryRepository.getOrCreateRepository()` performs atomic upsert (`ON CONFLICT (student_id, provider, provider_repo_id) DO UPDATE SET url = EXCLUDED.url, default_branch = EXCLUDED.default_branch, consent_grant_id = EXCLUDED.consent_grant_id RETURNING ...`), preventing race conditions under concurrent requests and re-linking active consent grants. `StaticRepoIngestionService` fails closed if `repositoryRepo` is not configured (`REPOSITORY_REPOSITORY_REQUIRED`).
- **Audit Actor Identity Preservation:** Disambiguated authenticated actor identity (`users.id`) from student owner identity (`students.id`). Augmented `SessionContext` with optional `actorUserId`. Audit events record `actorId = context.actorUserId ?? context.userId` (`users.id`) whether student- or officer-initiated, while snapshots and ingestion records are owned by `students.id`. Preserves all frozen P0-05 resolver invariants without modifying frozen files.
- **Consent Revocation Retention & Quarantine Policy:** When `repo_verification` consent is revoked in `PgConsentRepository.revokeConsent()`, all student snapshots are atomically updated to `registration_state = 'quarantined'`, rendering them immediately inaccessible for authoritative anchor resolution (`REGISTRATION_NOT_AUDIT_COMMITTED` / `CONSENT_REQUIRED_OR_REVOKED`). Pending ingestion jobs are marked failed (`CONSENT_REVOKED`), tokens purged, evidence withdrawn, and skills downgraded. Subsequent re-consent updates the canonical repository without resurrecting old quarantined snapshots.
- **Browser Callback Deployment Safeguards:** Configured production fail-closed validation on `FRONTEND_URL` to reject localhost/placeholder URLs. Next.js callback page (`/integrations/github/callback`) includes a `useRef` guard to eliminate duplicate invocations under React StrictMode, sanitizes temporary `code` and `state` parameters from browser history upon success via `window.history.replaceState`, and explicitly handles GitHub authorization denial errors (`error=access_denied`).
- **Full Test Suite Success:** 426 tests pass across 28 test files (including 45 P0-04 ingestion integration tests and 21 durable PostgreSQL tests), with 0 ESLint errors, 0 TypeScript errors, and successful monorepo production build.

---

## 2. Test Suite Classification & Verification Status

| Tier | Description | Files / Tests | Status |
| :--- | :--- | :--- | :--- |
| **Pure Unit Tests** | Pure domain logic: state machine, anchor hashing, exact code anchor resolver, student isolation, offline AST parsing, Git object byte/SHA verification, audit hash chaining, eligibility rules, 4/5ths fairness math. | 7 files, 110 tests | `UNIT_TESTED` (Passing in ~3s) |
| **API, RBAC & Adversarial Tests** | Fastify HTTP endpoints, positive RBAC matrix, anchor resolution API, snapshot registration mutex with leak-free cleanup, conditional audit rollback, registration commit state lifecycle, quarantined fail-closed checks, file manifest provenance, mandatory Git blob SHA, pre-persisted trusted ingestion record separation, prior consent enforcement, audit-failure safety, student ownership/consent gates, email takeover prevention, fail-closed startup, strict claims validation, JWT test utilities, consent adversarial boundaries, audit concurrency & tenant consent, GitHub OAuth PKCE S256, AES-256-GCM token cipher, static repository ingestion engine, file filtering, limits, and administrative TLS/ledger integrity. | 15 files, 217 tests | `INTEGRATION_TESTED` (Passing in ~40s) |
| **Live Database Tests** | Real PostgreSQL 17 on Supabase: RLS isolation (46 tables enabled and forced), cross-tenant mutation rejection, triggers, constraints, DCL permissions, physical connection reuse via backend PID, restricted runtime user (`pramaan_app_user`), parent university discovery isolation, migration ledger idempotency, test safety guards, durable PostgreSQL repository adapters (`PgSourceSnapshotStore`, `PgTrustedIngestionStore`, `PgGitHubCredentialRepository`, `PgIngestionJobRepository`, `PgRepositoryRepository`), and genuine Supabase ES256 JWKS token validation. | 6 files, 107 tests | `SECURITY_VERIFIED` (Passing on live Supabase DB) |
| **Total Suite** | Full monorepo test pack running under Vitest. | **28 files, 434 tests** | **100% Passing** |

### Complete Test Inventory (28 Files, 434 Tests)
1. `packages/domain/tests/exact-anchor-resolver.test.ts` (59 tests)
2. `packages/domain/tests/skill-state-machine.test.ts` (8 tests)
3. `packages/domain/tests/anchor-resolver.test.ts` (4 tests)
4. `packages/domain/tests/audit-chain.test.ts` (19 tests)
5. `packages/domain/tests/eligibility-evaluator.test.ts` (5 tests)
6. `packages/domain/tests/fairness-calculator.test.ts` (5 tests)
7. `packages/domain/tests/git-object.test.ts` (10 tests)
8. `apps/api/tests/anchor-service-and-api.test.ts` (80 tests)
9. `apps/api/tests/p0-04-github-ingestion.test.ts` (45 tests)
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
28. `db/tests/p0-04-pg-durable-repositories.test.ts` (21 tests)

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
