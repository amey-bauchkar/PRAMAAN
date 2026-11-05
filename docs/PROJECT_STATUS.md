# PRAMAAN — Project Status

**Last Updated:** 2026-11-06  
**Stage:** Stage A (Completed) → Milestone M0 & M1 (ENGINEERING VERIFIED & HARDENED)  
**Lead Engineer:** Solo Developer Partner  
**Target Event:** QUASAR 5.0 (EdTech Domain)  

---

## 1. Executive Summary

PRAMAAN is an evidence-based placement intelligence platform built for colleges, students, placement officers (TPOs), and recruiters. Its core thesis is:
$$\text{Evidence} \rightarrow \text{Observed Skill} \rightarrow \text{Verification} \rightarrow \text{Verified Skill} \rightarrow \text{Skill Passport} \rightarrow \text{Eligibility} \rightarrow \text{Placement Decision}$$

Following the initial M0 and M1 build, an **independent engineering verification audit** was conducted against live PostgreSQL 17 on Supabase (`db.qshujrddrzoemlzmleru.supabase.co`).
- Real database RLS isolation was proven at the database kernel level under `app_api` (`NOBYPASSRLS`) across all 42 tables.
- Skill state database constraints and verification triggers (`trg_check_skill_evidence_owner`, `trg_verify_skill_evidence`) were deployed and verified across all 8 verification paths.
- The 5-state skill lifecycle was expanded to cover all authoritative transitions.
- The consent revocation workflow was enhanced to handle local token purge, derived artifact withdrawal, and skill downgrades.
- The audit log was hardened with two-layer defense-in-depth (least privilege DCL + BEFORE trigger immutability) and SHA-256 hash chaining across 6 tampering scenarios.
- All 68 tests pass in CI across unit, mocked API, and genuine PostgreSQL 17 integration layers.

---

## 2. Test Suite Classification & Verification Status

| Tier | Description | Files / Tests | Status |
| :--- | :--- | :--- | :--- |
| **Pure Unit Tests** | Pure domain logic: state machine, anchor hashing, audit hash chaining, eligibility rules, 4/5ths fairness math. | 5 files, 29 tests | `UNIT_TESTED` (Passing in 30ms) |
| **API & Membership Mock Tests** | Fastify HTTP endpoints, session derivation strictly from user memberships, tenant isolation, and consent ledger. | 5 files, 20 tests | `INTEGRATION_TESTED` (Passing in 290ms) |
| **Live Database Tests** | Real PostgreSQL 17 on Supabase: RLS isolation, cross-tenant mutation rejection, triggers, constraints, DCL permissions. | 1 file, 19 tests | `SECURITY_VERIFIED` (Passing on live Supabase DB) |
| **Total Suite** | Full monorepo test pack running under Vitest. | **11 files, 68 tests** | **100% Passing** |

---

## 3. Milestones Overview

| Milestone | Description | Target Tickets | Status |
| :--- | :--- | :--- | :--- |
| **M0** | Workspace & Foundation Setup | Monorepo layout, TS configs, linting, test runner, core domain types | `IMPLEMENTED` / `UNIT_TESTED` |
| **M1** | Tenancy, Auth & Consent Ledger | P0-01, P0-02, P0-03 (RLS, audit chain, purpose consent & revoke) | `IMPLEMENTED` / `SECURITY_VERIFIED` |
| **M2** | Code Archaeology & Evidence Graph | P0-04, P0-05, P0-06 (Repo static import, tree-sitter anchors, non-repo lab evidence) | `NOT_STARTED` |
| **M3** | Skill Verification Arena & Probe | P0-07, P0-08, P0-09, P0-10 (Skill state machine, grounded viva, runner, rubric) | `NOT_STARTED` |
| **M4** | Skill Passport & Recruiter Discovery | P0-11, P0-12, P0-13, P1-10 (Evidence card, passport verifier, role gap matcher) | `NOT_STARTED` |
| **M5** | Placement Engine & Fairness Simulator | P0-14, P0-15, P1-04, P1-05 (Deterministic eligibility, what-if simulator, drive allocations) | `NOT_STARTED` |
| **M6** | Breadth, Accreditation & Hardening | P0-16, P0-17, P1-01 to P1-17 (Mock drives, learning paths, JD profiler, analytics, export) | `NOT_STARTED` |

---

## 4. Current Blockers & Next Immediate Steps

- **Blockers:** None. Live PostgreSQL 17 connection on Supabase is fully configured, migrated, and verified.
- **Immediate Steps Before M2:**
  - Proceed with Milestone M2: Selected GitHub repo static ingestion (P0-04), Tree-sitter / AST anchor resolver integration (P0-05), and Non-repo lab artifact mentor attestation queue (P0-06).
