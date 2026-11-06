# PRAMAAN — Project Status

**Last Updated:** 2026-11-06  
**Stage:** Stage A (Completed) → Milestone M0 & M1 (ENGINEERING VERIFIED & PRODUCTION HARDENED)  
**Lead Engineer:** Solo Developer Partner  
**Target Event:** QUASAR 5.0 (EdTech Domain)  

---

## 1. Executive Summary

PRAMAAN is an evidence-based placement intelligence platform built for colleges, students, placement officers (TPOs), and recruiters. Its core thesis is:
$$\text{Evidence} \rightarrow \text{Observed Skill} \rightarrow \text{Verification} \rightarrow \text{Verified Skill} \rightarrow \text{Skill Passport} \rightarrow \text{Eligibility} \rightarrow \text{Placement Decision}$$

Following the initial M0 and M1 build and subsequent security audits, an **exhaustive security hardening, migration reproducibility, and M1 final closure audit** was conducted against live PostgreSQL 17 on Supabase (`db.qshujrddrzoemlzmleru.supabase.co`).
- **PostgreSQL RLS Kernel Isolation:** Verified under `app_api` (`NOBYPASSRLS`) across all 42 domain tables, blocking cross-tenant SELECT, INSERT, UPDATE, and DELETE.
- **Migration Reproducibility & Ledger Engine (P0):** Engineered a fully idempotent, version-controlled migration engine (`scripts/migrate-supabase.mjs`) tracked via an explicit `schema_migrations` ledger with SHA-256 checksums. Verified clean ordered application of migrations 001 through 008 (including 006b, 007, 008) and proven rerun idempotency (0 statements re-executed, zero drift). Administrative credentials (`DATABASE_URL_ADMIN`) are strictly separated from application runtime credentials (`DATABASE_URL`).
- **Production TLS Verification & Strict CA Pinning (P0):** Enforced `rejectUnauthorized: true` with zero production bypass. Unconditionally validates `DATABASE_CA_PATH`, failing fast at startup if explicitly configured but inaccessible. Verified live TLS connections under `pramaan_app_user`.
- **Explicit Persistence Selection & Fail-Closed Invariants (P1):** Configured explicit persistence selection (`persistenceMode: 'postgres' | 'in-memory'`). Production unconditionally prohibits all in-memory repository classes (`InMemoryTenantRepository`, `InMemoryAuditRepository`, `InMemoryConsentRepository`, `InMemoryUserRepository`) and mock stores, failing closed immediately.
- **Consent Security & Adversarial Boundaries (P1):** Added exhaustive adversarial test coverage (`apps/api/tests/consent-adversarial.test.ts`): proven blocking of cross-student revocation (403 `FORBIDDEN_OWNERSHIP`), unknown grant revocation (404), officer mandatory documented reason (400 `OFFICER_REASON_REQUIRED`), instant OAuth credential purge, derived repository evidence withdrawal (`status = 'withdrawn'`), skill downgrade to `'claimed'`, immutable audit trail, and idempotent re-revocation handling.
- **CI / CD Automated Quality Gate (P1):** Created `.github/workflows/ci.yml` incorporating frozen lockfile installation (`npm ci`), strict TypeScript static analysis (`tsc --noEmit`), full monorepo production build (`npm run build`), unit & Fastify route testing, and isolated PostgreSQL 17 service container integration tests. Zero production credentials in CI.
- **Clean Monorepo Build:** Resolved monorepo TypeScript path bindings and scaffolded initial web client shell; `npm run build` cleanly succeeds across `@pramaan/contracts`, `@pramaan/domain`, `@pramaan/api`, and `@pramaan/web`.
- **Quality Gates & Security Hygiene (P2):** Replaced placeholder root lint script with strict `tsc --noEmit`, audited `.gitignore` to block `.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, and `*.secret`.
- **Accurate Credential Audit Status:** Historical git commits (`21fa9a7` / `25cd045`) contained a previously committed password. That credential was immediately rotated out-of-band via Supabase management channels. Current migration 007 contains zero password literals, and rerunning it cannot reset credentials.
- **100% Test Success:** All 156 tests pass across 20 test files (including 44 live Supabase PostgreSQL 17 integration and security tests).

---

## 2. Test Suite Classification & Verification Status

| Tier | Description | Files / Tests | Status |
| :--- | :--- | :--- | :--- |
| **Pure Unit Tests** | Pure domain logic: state machine, anchor hashing, audit hash chaining, eligibility rules, 4/5ths fairness math. | 5 files, 29 tests | `UNIT_TESTED` (Passing in 30ms) |
| **API, RBAC & Adversarial Tests** | Fastify HTTP endpoints, positive RBAC matrix, email takeover prevention, fail-closed startup, strict claims validation, JWT test utilities, and consent adversarial boundaries. | 10 files, 83 tests | `INTEGRATION_TESTED` (Passing in ~1s) |
| **Live Database Tests** | Real PostgreSQL 17 on Supabase: RLS isolation, cross-tenant mutation rejection, triggers, constraints, DCL permissions, physical connection reuse via backend PID, restricted runtime user (`pramaan_app_user`), parent university discovery isolation, migration ledger idempotency, and genuine Supabase ES256 JWKS token validation. | 5 files, 44 tests | `SECURITY_VERIFIED` (Passing on live Supabase DB) |
| **Total Suite** | Full monorepo test pack running under Vitest. | **20 files, 156 tests** | **100% Passing** |

### Complete Test Inventory (20 Files, 156 Tests)
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
13. `apps/api/tests/prod-fail-closed.test.ts` (11 tests)
14. `apps/api/tests/consent-adversarial.test.ts` (7 tests)
15. `apps/api/tests/pg-auth-integration.test.ts` (2 tests)
16. `apps/api/tests/real-supabase-jwt.test.ts` (21 tests)
17. `apps/api/tests/restricted-runtime-user.test.ts` (9 tests)
18. `db/tests/connection-pool-reuse.test.ts` (1 test)
19. `db/tests/supabase-real-db.test.ts` (19 tests)
20. `db/tests/migration-runner.test.ts` (4 tests)

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
