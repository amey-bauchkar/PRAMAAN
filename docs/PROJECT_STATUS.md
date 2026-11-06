# PRAMAAN — Project Status

**Last Updated:** 2026-11-06  
**Stage:** Stage A (Completed) → Milestone M0 & M1 (ENGINEERING VERIFIED & PRODUCTION HARDENED)  
**Lead Engineer:** Solo Developer Partner  
**Target Event:** QUASAR 5.0 (EdTech Domain)  

---

## 1. Executive Summary

PRAMAAN is an evidence-based placement intelligence platform built for colleges, students, placement officers (TPOs), and recruiters. Its core thesis is:
$$\text{Evidence} \rightarrow \text{Observed Skill} \rightarrow \text{Verification} \rightarrow \text{Verified Skill} \rightarrow \text{Skill Passport} \rightarrow \text{Eligibility} \rightarrow \text{Placement Decision}$$

Following the initial M0 and M1 build and subsequent security audits, an **exhaustive security defect remediation and M1 final closure audit** was conducted against live PostgreSQL 17 on Supabase (`db.qshujrddrzoemlzmleru.supabase.co`).
- **PostgreSQL RLS Kernel Isolation:** Verified under `app_api` (`NOBYPASSRLS`) across all 42 domain tables, blocking cross-tenant SELECT, INSERT, UPDATE, and DELETE.
- **Production AuthService Injection Bypass Closed (P0-1):** In `apps/api/src/app.ts`, production mode unconditionally rejects custom injected `authService`, enforcing the internally constructed `AuthService` backed by `PgUserRepository` and verified Supabase JWKS/issuer configuration. Weak symmetric test JWT verifiers are strictly rejected in production.
- **Administrative Migration and Seed TLS Enforcement (P0-2):** Engineered `scripts/admin-db-ssl.mjs` requiring verified TLS (`rejectUnauthorized: true`), SNI hostname validation, and strict `DATABASE_CA_PATH` verification for all remote database connections. Insecure TLS fallback is strictly blocked.
- **Migration Reproducibility & Ledger Integrity (P1-3):** Engineered `scripts/migrate-supabase.mjs` with PostgreSQL advisory locks (`8429104820948123n`) to prevent concurrent runner collisions, atomic transactional DDL + ledger commit/rollback, and fatal non-zero termination upon checksum drift.
- **Audit-Chain Concurrency & Transactional Integrity (P1-4):** Added unique constraint `uq_audit_events_org_seq UNIQUE (org_id, seq)` via migration 009. Serialized concurrent tenant audit writes using `pg_advisory_xact_lock(hashtext('audit_chain'), hashtext(org_id))`. Added `logInTransaction(client, ...)` to eliminate nested client checkouts in `PgConsentRepository`. Enforced RFC 8785 canonical key sorting in `AuditChain.calculateHash` to eliminate PostgreSQL JSONB key-reordering hash verification failures.
- **Tenant-Scoped Consent Checking (P1-5):** Added `context: SessionContext` to `hasActiveConsent()`, executing under `withTenantTransaction(context, ...)` to switch to `app_api` and enforce tenant RLS boundaries at the database engine level.
- **Quality Gates & Quality Hygiene (P2):** Configured real ESLint (`eslint.config.mjs`) for `npm run lint` and separated strict TypeScript compilation check to `npm run typecheck` (`tsc --noEmit`).
- **CI / CD Multi-Stage Verification Pipeline:** Configured `.github/workflows/ci.yml` with three explicit decoupled jobs:
  1. `build-and-unit-tests`: Build, ESLint, TypeScript check & DB-independent unit tests.
  2. `isolated-postgres-integration`: Clean PostgreSQL 17 Alpine container running migrations, rerun, runtime user password provisioning, seed, migration tests, audit concurrency tests, consent adversarial tests, restricted runtime tests, connection pool reuse tests, and RLS suite.
  3. `live-supabase-verification`: Remote live Supabase verification (runs only when secrets configured).
- **100% Test Success:** All 170 tests pass across 22 test files (including 44 live Supabase PostgreSQL 17 integration and security tests).

---

## 2. Test Suite Classification & Verification Status

| Tier | Description | Files / Tests | Status |
| :--- | :--- | :--- | :--- |
| **Pure Unit Tests** | Pure domain logic: state machine, anchor hashing, audit hash chaining, eligibility rules, 4/5ths fairness math. | 5 files, 29 tests | `UNIT_TESTED` (Passing in 30ms) |
| **API, RBAC & Adversarial Tests** | Fastify HTTP endpoints, positive RBAC matrix, email takeover prevention, fail-closed startup, strict claims validation, JWT test utilities, consent adversarial boundaries, audit concurrency & tenant consent, and administrative TLS/ledger integrity. | 12 files, 97 tests | `INTEGRATION_TESTED` (Passing in ~2s) |
| **Live Database Tests** | Real PostgreSQL 17 on Supabase: RLS isolation, cross-tenant mutation rejection, triggers, constraints, DCL permissions, physical connection reuse via backend PID, restricted runtime user (`pramaan_app_user`), parent university discovery isolation, migration ledger idempotency, and genuine Supabase ES256 JWKS token validation. | 5 files, 44 tests | `SECURITY_VERIFIED` (Passing on live Supabase DB) |
| **Total Suite** | Full monorepo test pack running under Vitest. | **22 files, 170 tests** | **100% Passing** |

### Complete Test Inventory (22 Files, 170 Tests)
1. `packages/domain/tests/skill-state-machine.test.ts` (8 tests)
2. `packages/domain/tests/anchor-resolver.test.ts` (4 tests)
3. `packages/domain/tests/audit-chain.test.ts` (7 tests)
4. `packages/domain/tests/eligibility-evaluator.test.ts` (5 tests)
5. `packages/domain/tests/fairness-calculator.test.ts` (5 tests)
6. `apps/api/tests/m1-tenancy-rls.test.ts` (5 tests)
7. `apps/api/tests/m1-audit-chain.test.ts` (3 tests)
8. `apps/api/tests/m1-consent-ledger.test.ts` (3 tests)
9. `apps/api/tests/auth-membership-tenant.test.ts` (13 tests)
10. `apps/api/tests/api-endpoints.test.ts` (7 tests)
11. `apps/api/tests/api-route-rbac.test.ts` (18 tests)
12. `apps/api/tests/email-takeover-prevention.test.ts` (4 tests)
13. `apps/api/tests/prod-fail-closed.test.ts` (14 tests)
14. `apps/api/tests/consent-adversarial.test.ts` (7 tests)
15. `apps/api/tests/audit-concurrency-and-consent.test.ts` (5 tests)
16. `apps/api/tests/pg-auth-integration.test.ts` (2 tests)
17. `apps/api/tests/real-supabase-jwt.test.ts` (21 tests)
18. `apps/api/tests/restricted-runtime-user.test.ts` (9 tests)
19. `db/tests/admin-tls-and-ledger.test.ts` (6 tests)
20. `db/tests/connection-pool-reuse.test.ts` (1 test)
21. `db/tests/supabase-real-db.test.ts` (19 tests)
22. `db/tests/migration-runner.test.ts` (4 tests)

---

## 3. Milestones Overview

| Milestone | Description | Target Tickets | Status |
| :--- | :--- | :--- | :--- |
| **M0** | Workspace & Foundation Setup | Monorepo layout, TS configs, linting, test runner, core domain types | `IMPLEMENTED` / `UNIT_TESTED` |
| **M1** | Tenancy, Auth & Consent Ledger | P0-01, P0-02, P0-03 (RLS, audit chain, purpose consent, real Supabase auth, RBAC) | `IMPLEMENTED` / `SECURITY_VERIFIED` |
| **M2** | Code Archaeology & Evidence Graph | P0-04, P0-05, P0-06 (Repo static import, tree-sitter anchors, non-repo lab evidence) | `NOT_STARTED` |
| **M3** | Skill Verification Arena & Probe | P0-07, P0-08, P0-09, P0-10 (Skill state machine, grounded viva, runner, rubric) | `NOT_STARTED` |
| **M4** | Skill Passport & Recruiter Discovery | P0-11, P0-12, P0-13, P1-10 (Evidence card, passport verifier, role gap matcher) | `NOT_STARTED` |
| **M5** | Placement Engine & Fairness Simulator | P0-14, P0-15, P1-04, P1-05 (Deterministic eligibility, what-if simulator, drive allocations) | `NOT_STARTED` |
| **M6** | Breadth, Accreditation & Hardening | P0-16, P0-17, P1-01 to P1-17 (Mock drives, learning paths, JD profiler, analytics, export) | `NOT_STARTED` |

---

## 4. Current Blockers & Next Immediate Steps

- **Blockers:** None. Milestone M1 is 100% verified, hardened, and locked.
- **Immediate Steps for M2:**
  - Proceed with Milestone M2: Selected GitHub repo static ingestion (P0-04), Tree-sitter / AST anchor resolver integration (P0-05), and Non-repo lab artifact mentor attestation queue (P0-06).
