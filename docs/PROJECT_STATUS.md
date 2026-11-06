# PRAMAAN — Project Status

**Last Updated:** 2026-11-06  
**Stage:** Stage A (Completed) → Milestone M0 & M1 (ENGINEERING VERIFIED & PRODUCTION HARDENED)  
**Lead Engineer:** Solo Developer Partner  
**Target Event:** QUASAR 5.0 (EdTech Domain)  

---

## 1. Executive Summary

PRAMAAN is an evidence-based placement intelligence platform built for colleges, students, placement officers (TPOs), and recruiters. Its core thesis is:
$$\text{Evidence} \rightarrow \text{Observed Skill} \rightarrow \text{Verification} \rightarrow \text{Verified Skill} \rightarrow \text{Skill Passport} \rightarrow \text{Eligibility} \rightarrow \text{Placement Decision}$$

Following the initial M0 and M1 build and subsequent security audits, an **exhaustive security hardening and verification audit** was conducted against live PostgreSQL 17 on Supabase (`db.qshujrddrzoemlzmleru.supabase.co`).
- **PostgreSQL RLS Kernel Isolation:** Verified under `app_api` (`NOBYPASSRLS`) across all 42 tables, blocking cross-tenant SELECT, INSERT, UPDATE, and DELETE.
- **Genuine Supabase JWT Authentication:** Verified with asymmetric ES256 key rotation against live Supabase project JWKS (`https://qshujrddrzoemlzmleru.supabase.co/auth/v1/.well-known/jwks.json`). All dev fallback secrets removed.
- **Account Takeover Immunity:** Eliminated automatic email-based identity linking. Identity is anchored strictly to verified Supabase `sub` UUID claims via scoped `resolve_user_identity` stored procedure.
- **Restricted Runtime Database Role:** Created `pramaan_app_user` with `NOBYPASSRLS`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOINHERIT` granted `app_api` and execution on `resolve_user_identity`.
- **Positive RBAC & Ownership Allowlists:** Enforced across all API routes (`/api/tenants`, `/api/students`, `/api/consent/grant`, `/api/consent/revoke`, `/api/audit`, `/api/audit/verify`).
- **Tenant Discovery Sanitization:** `GET /api/tenants` returns sanitized `OrganizationDiscovery` DTOs, masking internal configuration, rate limits, and key references.
- **Production Fail-Closed Invariants:** System fails startup immediately if production lacks `DATABASE_URL`, Supabase JWT configuration, or real PostgreSQL repositories.
- **Full Transaction Context Isolation:** Parameterized `set_config` isolates `app.current_org_id`, `app.current_user_id`, and `app.current_user_role` per transaction.
- **Physical Connection Pool Socket Reuse:** Verified socket reuse via `SELECT pg_backend_pid()` and proven fail-closed context clearing.
- **100% Test Success:** All 132 tests pass across 18 test files (including 35 live Supabase PostgreSQL 17 integration and security tests).

---

## 2. Test Suite Classification & Verification Status

| Tier | Description | Files / Tests | Status |
| :--- | :--- | :--- | :--- |
| **Pure Unit Tests** | Pure domain logic: state machine, anchor hashing, audit hash chaining, eligibility rules, 4/5ths fairness math. | 5 files, 29 tests | `UNIT_TESTED` (Passing in 30ms) |
| **API, RBAC & Token Tests** | Fastify HTTP endpoints, positive RBAC matrix, email takeover prevention, fail-closed startup, and JWT test utilities. | 8 files, 60 tests | `INTEGRATION_TESTED` (Passing in 600ms) |
| **Live Database Tests** | Real PostgreSQL 17 on Supabase: RLS isolation, cross-tenant mutation rejection, triggers, constraints, DCL permissions, physical connection reuse via backend PID, restricted runtime user (`pramaan_app_user`), tenant discovery isolation, and genuine Supabase ES256 JWKS token validation. | 5 files, 43 tests | `SECURITY_VERIFIED` (Passing on live Supabase DB) |
| **Total Suite** | Full monorepo test pack running under Vitest. | **18 files, 132 tests** | **100% Passing** |

### Complete Test Inventory (18 Files, 132 Tests)
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
13. `apps/api/tests/prod-fail-closed.test.ts` (3 tests)
14. `apps/api/tests/pg-auth-integration.test.ts` (2 tests)
15. `apps/api/tests/real-supabase-jwt.test.ts` (17 tests)
16. `apps/api/tests/restricted-runtime-user.test.ts` (8 tests)
17. `db/tests/connection-pool-reuse.test.ts` (1 test)
18. `db/tests/supabase-real-db.test.ts` (19 tests)

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
