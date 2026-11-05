# PRAMAAN — Requirement Traceability Matrix (RTM)

**Source Baseline:** Official QUASAR 5.0 EdTech Problem Statement (Pages 13–18)  
**Standard Statuses:** `NOT_STARTED` | `IN_PROGRESS` | `IMPLEMENTED` | `TESTED` | `BLOCKED` | `DEFERRED`  
**Rule:** No requirement may be silently dropped. Any unverified or deferred feature must be explicitly recorded.

---

## 1. Core Business Requirements (PDF Pages 14–15)

| Req ID | Module | Status | Official Requirement & Acceptance Criteria | Automated Test Target | Demo Evidence Target |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **BR-01** | Student Platform / Profile | `NOT_STARTED` | Dynamic skill profile updated continuously; one-click PDF resume generated strictly from profile without PDF upload. | `test/profile-resume.test.ts` | Student profile screen; export button creates PDF with verified states. |
| **BR-02** | Student Platform / Verification | `SECURITY_VERIFIED` | Five skill states (Claimed, Observed, Evidence-linked, Verified, Expired). Database constraint and trigger prohibit transition to Verified without qualifying verification record and accepted evidence. | `packages/domain/tests/skill-state-machine.test.ts`, `db/tests/supabase-real-db.test.ts` | State badge indicators with transition timeline and verification timestamps. |
| **BR-03** | Evidence Ingestion | `INTEGRATION_TESTED` | Safe code & evidence import; explicit consent ledger; selected repos only (read-only); non-repo uploads with faculty attestation. Consent verified before import. | `apps/api/tests/m1-consent-ledger.test.ts` | Consent modal; repo picker; lab submission form with faculty review queue. |
| **BR-04** | Passport & Taxonomy | `NOT_STARTED` | Portable Skill Evidence Passport (Open Badges 3.0 / verifiable credential schema) mapped to standard skills taxonomy (ESCO/O*NET/NSQF). | `test/passport-schema.test.ts` | Public verification URL; tamper-evident credential verification display. |
| **BR-05** | Admin / Demand Profiler | `NOT_STARTED` | Industry Skill-Gap Profiler Agent ingesting permitted JDs, mapping demand against canonical taxonomy, displaying sample size and retrieval dates. | `test/jd-demand-agent.test.ts` | TPO demand dashboard showing top required skills from ingested company JDs. |
| **BR-06** | Student / Learning Path | `NOT_STARTED` | Personalized, role-specific learning paths recommending practice tasks that produce new verifiable evidence. | `test/learning-path.test.ts` | Student gap view linking directly to recommended coding/lab assignments. |
| **BR-07** | Admin / Interventions | `NOT_STARTED` | Cohort gap heatmaps plus recommended interventions; measure pre/post intervention gain in verified skills and shortlisting rates. | `test/intervention-cohort.test.ts` | TPO intervention planning screen showing cohort delta before/after workshop. |
| **BR-08** | Placement Orchestrator | `UNIT_TESTED` | Declarative eligibility engine: CGPA, backlogs, branch, verified skill prerequisites, policy limits. Deterministic, versioned, explainable. | `packages/domain/tests/eligibility-evaluator.test.ts` | Eligibility decision view with reason codes and diff between rule versions. |
| **BR-09** | Admin / Drive Scheduling | `NOT_STARTED` | Single calendar management; conflict detection; automated interview slot proposals requiring officer confirmation. | `test/calendar-clash.test.ts` | TPO placement calendar with clash alerts and one-click slot proposal confirmation. |
| **BR-10** | Recruiter Platform | `NOT_STARTED` | Consent-scoped candidate discovery; verified-skill filters; Evidence Cards showing source anchors; candidate pipeline. | `test/recruiter-evidence-card.test.ts` | Recruiter search portal; interactive Evidence Card linking to code spans. |
| **BR-11** | Governance / AI Boundaries | `NOT_STARTED` | AI Helps, Human Decides: Agent outputs are stored as proposals; TPO retains override authority for all candidacy-affecting decisions. | `test/proposal-approval.test.ts` | TPO approval queue for drive allocations and student eligibility overrides. |
| **BR-12** | Explainability | `UNIT_TESTED` | Evidence-to-decision chain: Every decision traceable to rule version, skill state, evidence item, and exact code anchor in ≤ 4 clicks. Anchor hash verified. | `packages/domain/tests/anchor-resolver.test.ts` | Interactive audit drawer tracing decision backwards to commit SHA and line number. |
| **BR-13** | Privacy & DPDP | `SECURITY_VERIFIED` | Purpose-specific consent, instant token purge, derived artifact withdrawal, data request workflow. Auditable deletion workflow. | `apps/api/tests/m1-consent-ledger.test.ts` | Student privacy dashboard; immediate token deletion upon revoke. |
| **BR-14** | Fairness & Compliance | `UNIT_TESTED` | Selection-rate and impact-ratio analysis across gender, category, branch; group suppression for small N; configurable institutional policy. | `packages/domain/tests/fairness-calculator.test.ts` | TPO fairness simulator previewing impact ratios before publishing rules. |
| **BR-15** | Code Defence & Probes | `UNIT_TESTED` | Code-grounded viva and isolated Live Mutation Probes on extracted pure functions; deterministic unit testing; human fallback. | `packages/domain/tests/anchor-resolver.test.ts` | Live code modification editor running edge-case test in isolated sandbox. |
| **BR-16** | Audit Integrity | `SECURITY_VERIFIED` | Tamper-evident, hash-chained audit logging covering all profile edits, verifications, decisions. Append-only database trigger blocks UPDATE/DELETE. | `apps/api/tests/m1-audit-chain.test.ts`, `db/tests/supabase-real-db.test.ts` | System audit ledger view; cryptographic verification of log integrity. |
| **BR-17a** | Multi-Tenancy / RLS | `SECURITY_VERIFIED` | Strict college-level tenant isolation enforced via PostgreSQL Row-Level Security (RLS) with `NOBYPASSRLS`. Real database test on Supabase. | `db/tests/supabase-real-db.test.ts` | Cross-tenant query tests asserting 0 rows returned for foreign tenant. |
| **BR-17b** | Scalable Hierarchy | `NOT_STARTED` | University hierarchy with college tenants, per-tenant key references, and rate limits; aggregate-only university views. | `test/tenant-hierarchy.test.ts` | University dashboard showing aggregated statistics without student PII. |
| **BR-18** | Institutional KPIs | `NOT_STARTED` | Single screen displaying Placement Rate, Verified Skill Coverage, Skill-Gap Closure Rate, and 3 operational metrics with numerator/denominator. | `test/kpi-calculations.test.ts` | TPO executive dashboard with drill-down formula popovers for all 6 KPIs. |
| **BR-19** | Structured Pipeline | `NOT_STARTED` | Recruiter recruitment stages: Shortlist, Interview, Offer, and structured feedback with immutable status history. | `test/recruiter-pipeline.test.ts` | Candidate management board with stage transitions and offer tracking. |

---

## 2. Student Dashboard Mandatory Modules (PDF Page 16)

| Req ID | Module Name | Status | Acceptance Criteria | Automated Test |
| :--- | :--- | :--- | :--- | :--- |
| **ST-01** | Dynamic Student Skill Profile | `NOT_STARTED` | Dynamic skill graph, confidence metrics, academic history, one-click PDF resume without file upload. | `test/st-01-profile.test.ts` |
| **ST-02** | Safe Code & Evidence Import | `NOT_STARTED` | Read-only repo connection, static code parsing, non-repo lab uploads, mentor attestation, consent revocation. | `test/st-02-import.test.ts` |
| **ST-03** | Skill Proof Verification | `NOT_STARTED` | Code-grounded questions, Live Mutation Probes, rubric-based score, human review escalation. | `test/st-03-verification.test.ts` |
| **ST-04** | Target Companies & Skill Gap | `NOT_STARTED` | Role recommendations, match explanation breakdown, required vs verified skill delta, gap prioritization. | `test/st-04-skill-gap.test.ts` |
| **ST-05** | Three-Round Mock Drive | `NOT_STARTED` | R1: 30 aptitude Qs (seeded per student); R2: 2 coding Qs (10 marks each); R3: AI-assisted interview; combined report. | `test/st-05-mock-drive.test.ts` |
| **ST-06** | Personalized Learning Path | `NOT_STARTED` | Tailored learning units, practice tasks generating fresh evidence, objective acceptance tests, retake eligibility. | `test/st-06-learning-path.test.ts` |
| **ST-07** | My Drives & Eligibility | `NOT_STARTED` | Placement drive listings, pass/fail status with explicit rule reason codes, student appeal submission. | `test/st-07-drives.test.ts` |
| **ST-08** | My Privacy & Consent | `NOT_STARTED` | Purpose-specific granular toggles, active integration list, immediate revoke button, data export/delete requests. | `test/st-08-privacy.test.ts` |

---

## 3. Admin / TPO Dashboard Mandatory Modules (PDF Pages 17–18)

| Req ID | Module Name | Status | Acceptance Criteria | Automated Test |
| :--- | :--- | :--- | :--- | :--- |
| **AD-01** | Cohort Skill Dashboard | `NOT_STARTED` | Interactive skill heatmaps, verified coverage %, weak topic aggregations, intervention planning drawer. | `test/ad-01-cohort.test.ts` |
| **AD-02** | Industry Skill-Gap Profiler | `NOT_STARTED` | JD ingestion, market demand extraction, canonical taxonomy mapping, intervention recommendations. | `test/ad-02-jd-profiler.test.ts` |
| **AD-03** | Predictive Placement Analytics | `NOT_STARTED` | Cohort placement forecasts with scenario ranges, support recommendations, explicit "unvalidated" tags. | `test/ad-03-predictive.test.ts` |
| **AD-04** | Mock Drive Setup | `NOT_STARTED` | Question bank repository, aptitude pool config, coding test cases, interview rubric definitions. | `test/ad-04-mock-setup.test.ts` |
| **AD-05** | Bulk Mailing | `NOT_STARTED` | Company database, reusable templates, rate-limited bulk dispatch, delivery/reply status tracking. | `test/ad-05-bulk-mail.test.ts` |
| **AD-06** | Drive Management & Allocation | `NOT_STARTED` | Unified placement calendar, inbound company email parsing, slot clash detection, proposal approval. | `test/ad-06-drive-allocation.test.ts` |
| **AD-07** | Eligibility Rules Engine | `NOT_STARTED` | Declarative criteria builder, rule versioning, what-if preview, deterministic execution, officer override. | `test/ad-07-rules-engine.test.ts` |
| **AD-08** | Recruiter Candidate Search | `NOT_STARTED` | Verified skill query filters, explainable match scores, Evidence Cards, recruiter access grants. | `test/ad-08-recruiter-search.test.ts` |
| **AD-09** | AI Helps, Human Decides | `NOT_STARTED` | Proposal inbox for all agent recommendations; audit logging of officer decisions and overrides. | `test/ad-09-human-decides.test.ts` |
| **AD-10** | Fairness Check | `NOT_STARTED` | Impact ratio calculations (4/5ths rule), demographic breakdown, small group suppression, simulation logs. | `test/ad-10-fairness-check.test.ts` |
| **AD-11** | Accreditation Reporting Suite | `NOT_STARTED` | NAAC/NIRF-ready tabular exports, placement counts deduplicated by student, higher-studies data, PDF/XLSX. | `test/ad-11-accreditation.test.ts` |
| **AD-12** | Roles & College-Separate Data | `NOT_STARTED` | Multi-tenant hierarchy (Univ → College → Dept), RBAC enforcement, strict tenant isolation across all endpoints. | `test/ad-12-roles-tenancy.test.ts` |

---

## 4. Cross-Check Invariants (X-01 to X-08)

| ID | Origin | Invariant & Acceptance Check | Status | Test |
| :--- | :--- | :--- | :--- | :--- |
| **X-01** | PDF p13 | Placement Orchestrator covers full lifecycle: eligibility, drives, shortlists, interviews, offers. | `NOT_STARTED` | `test/invariant-orchestrator.test.ts` |
| **X-02** | PDF p13 | Multi-tenant hierarchy supports college isolation with university aggregate roll-up. | `NOT_STARTED` | `test/invariant-tenancy.test.ts` |
| **X-03** | PDF p13 | Human oversight: No AI proposal can directly alter eligibility, skill states, or offers. | `NOT_STARTED` | `test/invariant-oversight.test.ts` |
| **X-04** | PDF p15 | Single officer dashboard displays Placement Rate, Verified Skill Coverage, Skill-Gap Closure Rate. | `NOT_STARTED` | `test/invariant-dashboard-kpis.test.ts` |
| **X-05** | PDF p15 | Zero unevidenced skills: No skill may show as Verified without linked accepted evidence and verification record. | `NOT_STARTED` | `test/invariant-verified-proof.test.ts` |
| **X-06** | PDF p15 | Learning paths yield verifiable artifact submissions, not merely completion checkmarks. | `NOT_STARTED` | `test/invariant-learning-evidence.test.ts` |
| **X-07** | PDF p15 | Replacement of spreadsheet filtering with versioned rule sets and reproducible snapshots. | `NOT_STARTED` | `test/invariant-deterministic-rules.test.ts` |
| **X-08** | PDF p15 | Cross-tenant data isolation is mathematically enforced at the PostgreSQL RLS layer. | `NOT_STARTED` | `test/invariant-rls.test.ts` |
