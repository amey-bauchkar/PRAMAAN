# PRAMAAN — Solo Developer Execution Backlog v1.0

**Source:** Pre-Implementation Package §10 & Master Blueprint QUASAR 5.0  
**Structure:**
- **Deliverable H (P0 Backlog):** Core vertical slice (17 tickets) — Must be 100% testable and operational.
- **Deliverable P1 (P1 Backlog):** Mandatory breadth (17 tickets) — Functional, narrow, but real slices covering the entire problem statement.

---

## 1. Deliverable H: Core Vertical Slice Backlog (P0)

| Ticket ID | Item Name | Testable Acceptance Criteria | Mapped Req | Target Milestone |
| :--- | :--- | :--- | :--- | :--- |
| **P0-01** | Tenancy, Auth & RLS Foundation | RLS tests pass in CI; two synthetic tenants seeded; no bypass role exists; queries across tenants return 0 rows. | BR-17a, AD-12 | M1 |
| **P0-02** | Cryptographic Audit Chain | Every write to domain tables inserts an `audit_events` row; SHA-256 hash chaining detects any tampered row. | BR-16 | M1 |
| **P0-03** | Consent Ledger & Instant Revocation | Active grant permits repo import; calling revoke deletes stored tokens immediately and blocks further indexing. | BR-03, BR-13, ST-02, ST-08 | M1 |
| **P0-04** | Selected-Repo Static Ingestion | Student-selected repositories only; tree metadata and commits fetched via API; zero build/install scripts executed. | ST-02 | M2 |
| **P0-05** | Exact Code Anchor Resolver | Given commit SHA, path, and line range, resolver returns exact code span and hash; content mismatch returns `ANCHOR_INVALID`. | BR-12, TM-06 | M2 |
| **P0-06** | Non-Repo Evidence & Mentor Attestation | Student uploads lab artifact; assigned faculty mentor attests against rubric; unassigned mentor is rejected; moves to `Evidence-linked`. | BR-03, BR-15, ST-02 | M2 |
| **P0-07** | Five-State Skill State Machine | State machine enforces allowed transitions (`Claimed` -> `Observed` -> `Evidence-linked` -> `Verified` -> `Expired`); events logged. | BR-02, ST-03 | M3 |
| **P0-08** | Grounded Defence Question Generator | Questions anchored to resolved code spans pass 5 safety & relevance gates; missing/unresolved anchor blocks question generation. | BR-15 | M3 |
| **P0-09** | Sandboxed Probe Runner | Isolated execution container runs pure function against test harness; zero network; 3s timeout fails closed. | BR-15, TM-03 | M3 |
| **P0-10** | Rubric Evaluator & State Transition Service | Evaluator consumes test runner results and updates `student_skills` to `Verified`; AI worker role cannot modify `student_skills`. | BR-02, BR-12 | M3 |
| **P0-11** | Skill Evidence Passport & Verifier | Cryptographic credential payload shows rubric version, dates, code references; tampered payload fails signature check. | BR-04, ST-03 | M4 |
| **P0-12** | Recruiter Evidence Card & Access Grants | Recruiter with active grant views verified skills; card links directly to code anchors in $\le 4$ clicks; unshared fields hidden. | BR-10, AD-08 | M4 |
| **P0-13** | Role Skill Gap & Reason-Coded Match | Compares job role skill requirements against verified student skills; match breakdown displays exact evidence references. | BR-10, ST-04 | M4 |
| **P0-14** | Deterministic Eligibility Engine | Identical `(rule_version, student_snapshot)` always outputs identical result; provisional status hidden from students until published. | BR-08, ST-07, AD-07 | M5 |
| **P0-15** | AI Proposal Queue & Officer Approval | AI agents insert exclusively into `proposals`; officer approval applies change; rejected or stale proposals expire gracefully. | BR-11, AD-09 | M5 |
| **P0-16** | Mock Drive Single-Round Slice | Aptitude set generated per-student using stored random seed; report displays round score, weak topics, and marks lost. | ST-05, ST-06 | M6 |
| **P0-17** | TPO Cohort Gap & Weak Topics View | Aggregates verified skill coverage across department; displays heatmaps and identifies top weak topics for workshop planning. | AD-01 | M6 |

---

## 2. Deliverable P1: Mandatory Breadth Backlog (P1)

| Ticket ID | Item Name | Testable Acceptance Criteria | Mapped Req | Target Milestone |
| :--- | :--- | :--- | :--- | :--- |
| **P1-01** | Full Three-Round Mock Drive | R1: 30 aptitude Qs; R2: 2 coding questions on runner; R3: Practice interview with 0-10 rubric; final report only after all 3 rounds. | ST-05, AD-04 | M6 |
| **P1-02** | One-Click Resume Generator | Button generates structured PDF from verified profile data; no resume file upload input exists. | BR-01, ST-01 | M6 |
| **P1-03** | Bulk Company Mailing | Reusable template; bulk dispatch with rate limiting (max 10/sec); delivery & reply tracking; sandbox transport in demo. | AD-05, TM-08 | M6 |
| **P1-04** | Placement Calendar & Clash Detection | Exclusion constraint prevents overlapping drive bookings; inbound message parsing creates proposal, never auto-booking. | BR-09, AD-06 | M5 |
| **P1-05** | Fairness View & What-If Simulator | Live calculation of selection rates & impact ratios; demographic group suppression ($N < 5$); simulation logged. | BR-14, AD-10 | M5 |
| **P1-06** | Accreditation Reporting Suite | Generates NAAC/NIRF-ready tabular exports; placement counts deduplicated by student; watermarked as "Draft for review". | AD-11 | M6 |
| **P1-07** | Institutional Six-KPI Executive Screen | Single view displaying Placement Rate, Verified Coverage, Skill-Gap Closure Rate, etc., with numerator and denominator popovers. | BR-18 | M6 |
| **P1-08** | JD Ingestion & Market Demand Profiler | Parses company JDs, extracts required skills, maps to canonical taxonomy; displays sample size and retrieval dates. | BR-05, AD-02 | M6 |
| **P1-09** | Predictive Placement Scenario Analytics | Forecasts cohort placement bands; labels outputs as "provisional estimates"; routes flagged students to mentor review. | AD-03, AD-09 | M6 |
| **P1-10** | Open Badges 3.0 Conformance | Passport payload conforms to Open Badges 3.0 / W3C VC JSON-LD schema; signature verifies against college public key. | BR-04 | M4 |
| **P1-11** | University Aggregate Multi-College View | University admin role views aggregated cross-college placement metrics; student-level queries return 0 rows. | BR-17b, AD-12 | M6 |
| **P1-12** | Per-Tenant Rate Limits & Siloed Config | Enforces tenant-specific rate limits; configuration supports external key reference pointers. | BR-17b | M6 |
| **P1-13** | DPDP Data Rights Request Workflow | Student can submit access, correction, or erasure requests; status tracking with due date and completion audit. | BR-13 | M6 |
| **P1-14** | Pre/Post Intervention Tracking | Links intervention workshop to cohort; measures verified skill gain and shortlisting rate change post-intervention. | BR-07 | M6 |
| **P1-15** | Recruiter Candidate Pipeline Board | Shortlist, Interview, Offer, and Feedback workflows with append-only status transitions. | BR-19 | M6 |
| **P1-16** | Canonical Skill Taxonomy Master | Seeded master taxonomy with 50+ industry skills mapped to standard frameworks (ESCO/O*NET/NSQF). | BR-04 | M6 |
| **P1-17** | LeetCode Evidence Pathway | Ingests public profile stats; marks evidence as `external_profile` (Observed status only, never Verified without defense). | ST-01, ST-02 | M6 |

