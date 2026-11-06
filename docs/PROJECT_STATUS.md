# PRAMAAN — Project Status

**Last Updated:** 2026-11-07  
**Stage:** Stage A (Completed) → Milestone M0, M1 & M2 Phase 1 (P0-05 Anchor Resolver) (ENGINEERING VERIFIED & PRODUCTION HARDENED)  
**Lead Engineer:** Solo Developer Partner  
**Target Event:** QUASAR 5.0 (EdTech Domain)  

---

## 1. Executive Summary

PRAMAAN is an evidence-based placement intelligence platform built for colleges, students, placement officers (TPOs), and recruiters. Its core thesis is:
$$\text{Evidence} \rightarrow \text{Observed Skill} \rightarrow \text{Verification} \rightarrow \text{Verified Skill} \rightarrow \text{Skill Passport} \rightarrow \text{Eligibility} \rightarrow \text{Placement Decision}$$

Following the M0 monorepo foundation and M1 multi-tenancy/security hardening, **Milestone M2 Phase 1: Exact Code Anchor Resolver (P0-05)** has been implemented and verified:
- **Exact Code Anchor Contract:** Added `ExactCodeAnchor`, `SourceSnapshot`, `CodeSymbolLocation`, `ResolutionResult`, and `AnchorResolutionStatus` contracts in `@pramaan/contracts` with strict SHA-256 hash validation, UTF-8 byte offsets, and snapshot metadata.
- **Deterministic Offline Anchor Resolver:** Built `AnchorResolver` in `@pramaan/domain` enforcing authoritative raw-byte integrity (`hashRawBytes`), content-addressed snapshot matching, commit SHA verification, file path verification, and line/byte-boundary span hashing. Normalized hashing is computed purely as a diagnostic indicator (e.g., detecting CRLF/LF line-ending drift) and never overrides raw integrity failure.
- **Offline AST Symbol Parsing:** Implemented `TypeScriptAstParser` using the pinned `typescript` compiler API (`ts.createSourceFile`). Handles syntax errors gracefully, extracts functions, methods, classes, and interfaces with exact UTF-8 byte ranges (converting from UTF-16 character indices), with zero untrusted code execution. Extensible via singleton `ParserRegistry`.
- **Immutable Content-Addressed Snapshot Storage:** Created `ISourceSnapshotStore` and `InMemorySourceSnapshotStore` rejecting conflicting snapshot overwrites (`IMMUTABLE_SNAPSHOT_MUTATION_REJECTED`).
- **Tenant-Isolated API Service:** Built `AnchorService` and mounted authenticated Fastify routes (`POST /api/evidence/anchors/resolve`, `POST /api/evidence/snapshots`, `POST /api/evidence/parse`) enforcing tenant isolation, student ownership isolation, DPDP purpose consent (`repo_verification`), and SHA-256 audit chaining.
- **100% Test Success Across Full Suite:** All 262 tests pass across 25 test files (including 22 pure domain anchor resolver tests, 9 API & RBAC tests, and 44 live Supabase PostgreSQL 17 security tests).

---

## 2. Test Suite Classification & Verification Status

| Tier | Description | Files / Tests | Status |
| :--- | :--- | :--- | :--- |
| **Pure Unit Tests** | Pure domain logic: state machine, anchor hashing, exact code anchor resolver, offline AST parsing, audit hash chaining, eligibility rules, 4/5ths fairness math. | 6 files, 63 tests | `UNIT_TESTED` (Passing in ~1s) |
| **API, RBAC & Adversarial Tests** | Fastify HTTP endpoints, positive RBAC matrix, anchor resolution API, snapshot registration, email takeover prevention, fail-closed startup, strict claims validation, JWT test utilities, consent adversarial boundaries, audit concurrency & tenant consent, and administrative TLS/ledger integrity. | 14 files, 121 tests | `INTEGRATION_TESTED` (Passing in ~60s) |
| **Live Database Tests** | Real PostgreSQL 17 on Supabase: RLS isolation, cross-tenant mutation rejection, triggers, constraints, DCL permissions, physical connection reuse via backend PID, restricted runtime user (`pramaan_app_user`), parent university discovery isolation, migration ledger idempotency, test safety guards, and genuine Supabase ES256 JWKS token validation. | 5 files, 78 tests | `SECURITY_VERIFIED` (Passing on live Supabase DB) |
| **Total Suite** | Full monorepo test pack running under Vitest. | **25 files, 262 tests** | **100% Passing** |

### Complete Test Inventory (25 Files, 262 Tests)
1. `packages/domain/tests/exact-anchor-resolver.test.ts` (22 tests)
2. `packages/domain/tests/skill-state-machine.test.ts` (8 tests)
3. `packages/domain/tests/anchor-resolver.test.ts` (4 tests)
4. `packages/domain/tests/audit-chain.test.ts` (19 tests)
5. `packages/domain/tests/eligibility-evaluator.test.ts` (5 tests)
6. `packages/domain/tests/fairness-calculator.test.ts` (5 tests)
7. `apps/api/tests/anchor-service-and-api.test.ts` (9 tests)
8. `apps/api/tests/m1-tenancy-rls.test.ts` (5 tests)
9. `apps/api/tests/m1-audit-chain.test.ts` (3 tests)
10. `apps/api/tests/m1-consent-ledger.test.ts` (3 tests)
11. `apps/api/tests/auth-membership-tenant.test.ts` (13 tests)
12. `apps/api/tests/api-endpoints.test.ts` (7 tests)
13. `apps/api/tests/api-route-rbac.test.ts` (18 tests)
14. `apps/api/tests/email-takeover-prevention.test.ts` (4 tests)
15. `apps/api/tests/prod-fail-closed.test.ts` (15 tests)
16. `apps/api/tests/consent-adversarial.test.ts` (7 tests)
17. `apps/api/tests/audit-concurrency-and-consent.test.ts` (5 tests)
18. `apps/api/tests/pg-auth-integration.test.ts` (2 tests)
19. `apps/api/tests/real-supabase-jwt.test.ts` (21 tests)
20. `apps/api/tests/restricted-runtime-user.test.ts` (9 tests)
21. `db/tests/admin-tls-and-ledger.test.ts` (6 tests)
22. `db/tests/connection-pool-reuse.test.ts` (1 test)
23. `db/tests/test-safety-guard.test.ts` (47 tests)
24. `db/tests/supabase-real-db.test.ts` (20 tests)
25. `db/tests/migration-runner.test.ts` (4 tests)

---

## 3. Milestones Overview

| Milestone | Description | Target Tickets | Status |
| :--- | :--- | :--- | :--- |
| **M0** | Workspace & Foundation Setup | Monorepo layout, TS configs, linting, test runner, core domain types | `IMPLEMENTED` / `UNIT_TESTED` |
| **M1** | Tenancy, Auth & Consent Ledger | P0-01, P0-02, P0-03 (RLS, audit chain, purpose consent, real Supabase auth, RBAC) | `IMPLEMENTED` / `SECURITY_VERIFIED` |
| **M2** | Code Archaeology & Evidence Graph | P0-04, P0-05, P0-06 (P0-05 Anchor resolver completed; P0-04 static ingest and P0-06 lab queue pending) | `IN_PROGRESS` (P0-05 VERIFIED) |
| **M3** | Skill Verification Arena & Probe | P0-07, P0-08, P0-09, P0-10 (Skill state machine, grounded viva, runner, rubric) | `NOT_STARTED` |
| **M4** | Skill Passport & Recruiter Discovery | P0-11, P0-12, P0-13, P1-10 (Evidence card, passport verifier, role gap matcher) | `NOT_STARTED` |
| **M5** | Placement Engine & Fairness Simulator | P0-14, P0-15, P1-04, P1-05 (Deterministic eligibility, what-if simulator, drive allocations) | `NOT_STARTED` |
| **M6** | Breadth, Accreditation & Hardening | P0-16, P0-17, P1-01 to P1-17 (Mock drives, learning paths, JD profiler, analytics, export) | `NOT_STARTED` |

---

## 4. Current Blockers & Next Immediate Steps

- **Blockers:** None. Milestone M2 Phase 1 (P0-05) is 100% verified and locked.
- **Immediate Steps for M2:**
  - Proceed with P0-04: Selected GitHub Repository Static Ingestion (offline tree fetching, rate limiting, and snapshot generation linking directly to `AnchorService`).
  - Proceed with P0-06: Non-Repository Evidence Workflow & Faculty Mentor Attestation Queue.
