# PRAMAAN — Project Status

**Last Updated:** 2026-11-07  
**Stage:** Stage A (Completed) → Milestone M0, M1 & M2 Phase 1 (P0-05 Anchor Resolver) (FINAL SIGN-OFF COMPLETED, HARDENED & CORE FROZEN)  
**Lead Engineer:** Solo Developer Partner  
**Target Event:** QUASAR 5.0 (EdTech Domain)  

---

## 1. Executive Summary

PRAMAAN is an evidence-based placement intelligence platform built for colleges, students, placement officers (TPOs), and recruiters. Its core thesis is:
$$\text{Evidence} \rightarrow \text{Observed Skill} \rightarrow \text{Verification} \rightarrow \text{Verified Skill} \rightarrow \text{Skill Passport} \rightarrow \text{Eligibility} \rightarrow \text{Placement Decision}$$

Following the M0 monorepo foundation and M1 multi-tenancy/security hardening, **Milestone M2 Phase 1: Exact Code Anchor Resolver (P0-05)** has been implemented, hardened against adversarial attacks, corrective-patched, and formally signed off with complete closure of all independent source review findings:
- **Exact Code Anchor Contract:** Standardized `ExactCodeAnchor`, `SourceSnapshot`, `CodeSymbolLocation`, `ResolutionResult`, `AnchorResolutionStatus`, and `TrustedIngestionRecord` contracts in `@pramaan/contracts` with strict SHA-256 hash validation, UTF-8 byte offsets, blob identity, authoritative provenance flags, and snapshot metadata.
- **Deterministic Offline Anchor Resolver:** Built `AnchorResolver` in `@pramaan/domain` enforcing authoritative raw-byte integrity (`hashRawBytes`), content-addressed snapshot matching, commit SHA verification, canonical file path verification, and line/byte-boundary span hashing. Validates UTF-8 character boundaries (rejecting offsets splitting multi-byte runes), enforces line/byte metadata consistency, detects line-ending drift (`\r\n` vs `\n`) separately from whitespace alterations, and verifies Git `blobSha` when present. Normalized hashing is computed purely as a diagnostic indicator and never overrides raw integrity failure.
- **Student-Level Snapshot Partitioning & Cross-Student Isolation:** Extended snapshot lookup keys in `ISourceSnapshotStore` and `InMemorySourceSnapshotStore` to include `studentId`: `${orgId}:${studentId}:${repositoryId}:${commitSha}:${canonicalPath}` and content-hash keys to `${orgId}:${studentId}:${hash}`. `AnchorResolver.resolve()` verifies that student anchors require a matching `snapshot.studentId` (`STUDENT_OWNERSHIP_REQUIRED`), and cross-student mismatches fail closed with `STUDENT_OWNERSHIP_MISMATCH`. Cross-tenant mismatches fail closed with `CROSS_TENANT_ACCESS_REJECTED`. Intra-tenant student evidence substitution is physically impossible.
- **Mutex-Serialized Registrations & Safe Audit Rollback:** `AnchorService` serializes concurrent registration attempts for identical snapshot keys using an in-memory promise-queue mutex (`runWithLock`). `deleteSnapshot` accepts `expectedSnapshotId` and executes conditional rollback: it only purges the stored snapshot if its stored ID matches the failed request's ID. Pre-existing snapshots (`wasAlreadyPresent === true`) are never rolled back. Rollback failures surface with cause preserved (`SNAPSHOT_REGISTRATION_FAILED_WITH_ROLLBACK_ERROR`).
- **File-Level Trusted Ingestion Manifest Binding:** Extended `TrustedIngestionRecord` to include `treeSha: string` (40-char Git tree SHA) and `manifest: TrustedFileManifestEntry[]` (`filePath`, `blobSha`, `rawFileHash`, `byteSize`). Client registrations are permanently marked `provenance: 'unverified_client_input'` and `ingestionId: undefined`. Server-controlled P0-04 static ingestion calls `registerTrustedSnapshot()`. Authoritative resolution strictly requires that the target file exists in the server-verified ingestion manifest, matches the Git `blobSha`, and matches the `rawFileHash`.
- **Offline AST Symbol Parsing:** Implemented `TypeScriptAstParser` using the pinned `typescript` compiler API (`ts.createSourceFile`). Handles syntax errors gracefully, validates UTF-8 decoding strictly, extracts functions, methods, classes, and interfaces with exact UTF-8 byte ranges (converting from UTF-16 character indices), with zero untrusted code execution. Extensible via singleton `ParserRegistry` keyed on `(parserName, language, parserVersion)` to prevent historical parser replacement.
- **Universal Student Ownership & DPDP Consent Enforcement:** Universal enforcement of trusted student ownership and active DPDP `repo_verification` consent across ALL caller roles (student, placement officer, system administrator) before storing snapshots or executing AST parsing. Parse endpoint `/api/evidence/parse` is strictly diagnostic (`diagnosticOnly: true, authoritative: false, provenance: 'diagnostic_parser'`).
- **100% Test Success Across Full Suite:** All 338 tests pass across 25 test files (including 51 pure domain anchor resolver tests, 56 API & RBAC tests, and 78 live Supabase PostgreSQL 17 security tests).

---

## 2. Test Suite Classification & Verification Status

| Tier | Description | Files / Tests | Status |
| :--- | :--- | :--- | :--- |
| **Pure Unit Tests** | Pure domain logic: state machine, anchor hashing, exact code anchor resolver, student isolation, offline AST parsing, audit hash chaining, eligibility rules, 4/5ths fairness math. | 6 files, 92 tests | `UNIT_TESTED` (Passing in ~3s) |
| **API, RBAC & Adversarial Tests** | Fastify HTTP endpoints, positive RBAC matrix, anchor resolution API, snapshot registration mutex, conditional audit rollback, file manifest provenance, student ownership/consent gates, email takeover prevention, fail-closed startup, strict claims validation, JWT test utilities, consent adversarial boundaries, audit concurrency & tenant consent, and administrative TLS/ledger integrity. | 14 files, 168 tests | `INTEGRATION_TESTED` (Passing in ~43s) |
| **Live Database Tests** | Real PostgreSQL 17 on Supabase: RLS isolation, cross-tenant mutation rejection, triggers, constraints, DCL permissions, physical connection reuse via backend PID, restricted runtime user (`pramaan_app_user`), parent university discovery isolation, migration ledger idempotency, test safety guards, and genuine Supabase ES256 JWKS token validation. | 5 files, 78 tests | `SECURITY_VERIFIED` (Passing on live Supabase DB) |
| **Total Suite** | Full monorepo test pack running under Vitest. | **25 files, 338 tests** | **100% Passing** |

### Complete Test Inventory (25 Files, 338 Tests)
1. `packages/domain/tests/exact-anchor-resolver.test.ts` (51 tests)
2. `packages/domain/tests/skill-state-machine.test.ts` (8 tests)
3. `packages/domain/tests/anchor-resolver.test.ts` (4 tests)
4. `packages/domain/tests/audit-chain.test.ts` (19 tests)
5. `packages/domain/tests/eligibility-evaluator.test.ts` (5 tests)
6. `packages/domain/tests/fairness-calculator.test.ts` (5 tests)
7. `apps/api/tests/anchor-service-and-api.test.ts` (56 tests)
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
| **M2** | Code Archaeology & Evidence Graph | P0-04, P0-05, P0-06 (P0-05 Anchor resolver completed, hardened & core frozen; P0-04 static ingest and P0-06 lab queue pending) | `IN_PROGRESS` (P0-05 FROZEN) |
| **M3** | Skill Verification Arena & Probe | P0-07, P0-08, P0-09, P0-10 (Skill state machine, grounded viva, runner, rubric) | `NOT_STARTED` |
| **M4** | Skill Passport & Recruiter Discovery | P0-11, P0-12, P1-10 (Evidence card, passport verifier, role gap matcher) | `NOT_STARTED` |
| **M5** | Placement Engine & Fairness Simulator | P0-14, P0-15, P1-04, P1-05 (Deterministic eligibility, what-if simulator, drive allocations) | `NOT_STARTED` |
| **M6** | Breadth, Accreditation & Hardening | P0-16, P0-17, P1-01 to P1-17 (Mock drives, learning paths, JD profiler, analytics, export) | `NOT_STARTED` |

---

## 4. Current Blockers & Next Immediate Steps

- **Blockers:** None. Milestone M2 Phase 1 (P0-05) is 100% verified, security-hardened, and core frozen.
- **Immediate Steps for M2:**
  - Proceed with P0-04: Selected GitHub Repository Static Ingestion (offline tree fetching, rate limiting, and snapshot generation linking directly to `AnchorService`).
  - Proceed with P0-06: Non-Repository Evidence Workflow & Faculty Mentor Attestation Queue.
| **M3** | Skill Verification Arena & Probe | P0-07, P0-08, P0-09, P0-10 (Skill state machine, grounded viva, runner, rubric) | `NOT_STARTED` |
| **M4** | Skill Passport & Recruiter Discovery | P0-11, P0-12, P0-13, P1-10 (Evidence card, passport verifier, role gap matcher) | `NOT_STARTED` |
| **M5** | Placement Engine & Fairness Simulator | P0-14, P0-15, P1-04, P1-05 (Deterministic eligibility, what-if simulator, drive allocations) | `NOT_STARTED` |
| **M6** | Breadth, Accreditation & Hardening | P0-16, P0-17, P1-01 to P1-17 (Mock drives, learning paths, JD profiler, analytics, export) | `NOT_STARTED` |

---

## 4. Current Blockers & Next Immediate Steps

- **Blockers:** None. Milestone M2 Phase 1 (P0-05) is 100% verified, security-hardened, and locked.
- **Immediate Steps for M2:**
  - Proceed with P0-04: Selected GitHub Repository Static Ingestion (offline tree fetching, rate limiting, and snapshot generation linking directly to `AnchorService`).
  - Proceed with P0-06: Non-Repository Evidence Workflow & Faculty Mentor Attestation Queue.
