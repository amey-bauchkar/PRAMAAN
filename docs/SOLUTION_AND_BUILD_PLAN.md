# PRAMAAN v2 — Audit, Redesigned Solution & Build Plan

**Date:** 16 Nov 2026 · **Status:** DRAFT for team review · **Supersedes (for scope and product decisions):** `docs/archive/blueprints/master-blueprint.md` §2–§10, `docs/archive/status/IMPLEMENTATION_PLAN.md`
**Source of truth for requirements:** QUASAR 5.0 EdTech problem statement (`EDTECH.pdf`, 6 pages; referred to below as **PS p1–p6**).

---

## 0. Verdict in one paragraph

The **core thesis is right and stays**: evidence → verified skill graph → gap-bridging → placement orchestration, with AI that proposes and humans who decide. What is wrong is **(1) the verification model**, which is stricter than the problem statement and would leave almost every skill un-Verified; **(2) the build order**, which spent ~6 weeks hardening one ingestion path while 20 of 20 mandatory dashboard modules are unbuilt and the web app is a placeholder; **(3) the data model**, which has no tables for mock drives, learning paths, job-demand data, appeals, interviews, offers, mailing or KPIs; and **(4) a handful of real logic and privacy bugs**. v2 keeps the backend trust core you built, fixes the bugs, replaces the verification model with **Proof Levels**, and reorganises every module around one idea: **every activity on the platform emits evidence**.

---

## 1. Audit — mistakes found

Severity: **S1** = would fail a requirement or a judge's question outright · **S2** = weakens a criterion noticeably · **S3** = cleanup.

### 1A. Strategy and scope

| # | Sev | Mistake | Evidence | Fix in v2 |
|---|---|---|---|---|
| A1 | S1 | **No product surface.** 0/8 student and 0/12 admin modules started; web app is one placeholder page. Judges score *User experience* and *Project implementation* on screens. | `apps/web/app/page.tsx` (10 lines); `docs/REQUIREMENT_TRACEABILITY.md` §2–§3 all `NOT_STARTED` | Freeze backend hardening. Build vertical slices of all 20 modules (§5). |
| A2 | S2 | **Hardening past the point of value.** Migrations 011a, 014, 015, 016 (~800 SQL lines) reconcile duplicate repositories and consent generations in data that does not exist yet. | `db/migrations/011a…016` | Keep them (they pass), but no new hardening tickets until the prototype is demo-complete. |
| A3 | S2 | **Docs are huge and contradict each other.** ~586 KB of docs. RTM marks ST-02 `NOT_STARTED` while BR-03 is `INTEGRATION_TESTED`; X-08 (RLS) `NOT_STARTED` though RLS is security-verified. Page refs say "PDF pages 13–18"; the PS file is 6 pages. | `docs/REQUIREMENT_TRACEABILITY.md`, `docs/PROJECT_STATUS.md` | One RTM regenerated from §4.4 of this doc; old blueprints archived. |
| A4 | S2 | **Novelty is buried under caveats.** The blueprint spends more words on what it won't claim than on what is new. | Master Blueprint §3.4, §9.3 | Five named innovations (§3.3), caveats moved to an FAQ. |

### 1B. Requirement fit vs. the problem statement

| # | Sev | Mistake | PS reference | Fix in v2 |
|---|---|---|---|---|
| B1 | S1 | **Verified is stricter than the PS defines it.** PS: "Proof = code on GitHub, test score, or mentor sign-off… System finds Python code in GitHub → Verified." Our design requires a viva or mutation probe for *every* Verified skill, and the probe only works on pure TypeScript functions. Result: Verified Skill Coverage near 0, heavy friction, and our own KPI looks bad. | PS p4 "Skill Proof Check" | **Proof Levels** (§3.2): Verified needs one qualifying proof, and carries a *level* (Code-backed → Assessed → Defended / Attested). Rules and recruiters filter by level. |
| B2 | S1 | **LeetCode is effectively excluded.** Our limitation says LeetCode never supports more than Observed. PS example: "System pulls his 200 solved problems." | PS p4 "Student Skill Profile"; `KNOWN_LIMITATIONS.md` §1.4 | **Ownership-token linking** (§3.3 #5): student puts a one-time code in their public profile bio; we then read the public stats. Counts as Observed; our own machine test lifts the skill to Assessed. Codeforces has an official public API and is supported the same way. |
| B3 | S1 | **Mock Drive has no design or schema.** 30 per-student aptitude questions, 2 coding questions × 10 marks, role-based interview, per-round report with weak topics and "where marks were lost". | PS p4 | New `mock_*` tables (§4.8) and one sandboxed **Judge** service used by the machine test, probes and learning tasks (§3.1). |
| B4 | S1 | **Machine test needs a full code judge**, but the architecture only plans a pure-function probe runner. | PS p4 | One Judge (self-hosted Judge0 CE or isolate-based runner) with C, C++, Java, Python, JS. |
| B5 | S1 | **Predictive analytics would show nothing.** Blueprint: forecast "only when validated historical data exists". A new college has none, so AD-03 fails the demo. PS wants "Batch placement likely 68%. 45 students at risk." | PS p5 | **Readiness Radar** (§3.3 #6): transparent, rule-based readiness score with visible factors, plus a cohort forecast *range*; the at-risk list goes to the officer only, labelled "needs support", never shown to the student as "at-risk". Swappable for a trained model once history exists. |
| B6 | S1 | **Eligibility ignores real Indian drive criteria.** Only CGPA, active backlogs, branch, year, skills. Missing: 10th/12th/diploma %, backlog *history*, gap years, and **policy limits** (one-student-one-offer, dream/super-dream tiers, already-placed block). PS says "academics, backlogs, skills, policy limits". | PS p2, p5 | Rule DSL v2 (§4.5) with these fields and a `policy` block. |
| B7 | S1 | **No appeals.** PS: "If not eligible, sees which rule failed. Can appeal." No appeal table, state or queue. | PS p4, p2 | `eligibility_appeals` with SLA, officer decision and audit. |
| B8 | S1 | **Fairness only covers eligibility.** PS asks for selection/shortlisting across gender, category, branch **and college tier**. Calculator has 3 dimensions and runs on eligibility only. | PS p2 "Fairness monitoring"; `fairness-calculator.ts:23`; `006_…sql:52` | Compute per funnel stage (eligible → shortlisted → offered); add `college_tier` (university view). |
| B9 | S1 | **Drive orchestration is a single row.** `drives` has one `venue_resource` string and one time window. No rounds, slots, panels, per-student clash detection, offer acceptance. Bulk mailing and "read company email → propose slot" have no tables. | PS p5 "Drive Management", "Bulk Mailing"; `005_…sql:38` | `drive_rounds`, `slots`, `interviews`, `offers`, `outreach_*`, `inbound_messages` (§4.8). |
| B10 | S2 | **Application history isn't immutable.** One `stage` column, overwritten. No `assessment` stage, no offer accepted/declined. | `005_…sql:105`; BR-19 | Append-only `application_events`; stage derived. |
| B11 | S2 | **Role hierarchy is incomplete.** PS roles: university, college, department, officer. We have no college-admin or department-coordinator role. | PS p3, p6; `001_…sql:45` | Add `college_admin`, `dept_coordinator`; scope permissions by department. |
| B12 | S2 | **Taxonomy mapping missing.** `skills` has a unique name only: no ESCO / O\*NET / NSQF IDs, aliases or hierarchy. Eligibility matches skills by lower-cased *name strings*. | PS p2; `003_…sql:44`; `eligibility-evaluator.ts:66` | `skill_mappings`, `skill_aliases`; rules reference skill IDs + minimum level + minimum proof level. |
| B13 | S2 | **No industry-demand data model** (JD corpus, extracted skills, sample size, dates). | PS p2, p5 | `jd_documents`, `jd_skill_mentions`, `demand_snapshots`. |
| B14 | S2 | **No learning-path model**, so "tasks that create new proof" cannot be shown. | PS p2, p4 | `learning_paths`, `learning_tasks` with Judge acceptance tests that emit evidence. |
| B15 | S2 | **Agent actions are logged per run, not per action.** PS: "Log every agent action." `proposals.kind` lacks interview questions, mail drafts, learning paths, at-risk lists, candidate skills. | PS p2; `006_…sql:20` | `agent_actions` (one row per tool call, chained into audit); broaden proposal kinds. |
| B16 | S2 | **No one-click resume, no Open Badges / VC issuer, no KPI definitions, no NAAC/NIRF export.** | PS p4, p6, p3 | Built in Phases 2–3 (§5). |
| B17 | S3 | **AST parser supports TypeScript only.** Indian student repos are mostly Java, Python, C++, JS. | `packages/domain/src/ast/` | Add Python and Java parsers (tree-sitter) behind the existing registry. |

### 1C. Domain logic bugs

| # | Sev | Bug | Location | Fix |
|---|---|---|---|---|
| C1 | S1 | **No way out of Verified except Expired.** Revoking repo consent, withdrawing evidence, a mentor retracting an attestation, or an upheld dispute cannot demote a Verified skill. DPDP withdrawal must stop the derived use. | `skill-state-machine.ts:43` | Add `verified → evidence_linked / claimed` with reason codes `CONSENT_WITHDRAWN`, `EVIDENCE_WITHDRAWN`, `ATTESTATION_RETRACTED`, `DISPUTE_UPHELD`; consent-revocation job runs them. |
| C2 | S1 | **Expired → Verified can reuse stale proof.** Nothing checks evidence `valid_until` or that the verification is newer than the expiry. Also `evidence.status = 'expired'` is not excluded by name in the domain check. | `skill-state-machine.ts:44`, `:150` | Require a verification with `completed_at > state_since` and evidence where `valid_until > now()`. Same check in the DB trigger. |
| C3 | S1 | **Ownership check is optional.** It only runs `if (context.studentId)`, so a caller that omits `studentId` skips it. | `skill-state-machine.ts:98`, `:141` | Make `studentId` required in `StateTransitionContext`. |
| C4 | S1 | **Attestation path skips the rubric.** With `type: 'attestation'` and no `outcome`, any attestation with a mentor ID verifies, whatever `rubricScores` say and even past its own `validUntil`. | `skill-state-machine.ts:162`, `:183` | Require `outcome === 'passed'` always; check rubric threshold and `attestation.validUntil > now`; the mentor must belong to the student's college and must not be the student. |
| C5 | S2 | **Evidence-linked accepts mixed evidence.** Uses `some(accepted)` while the error says "all must be accepted"; rejected and withdrawn items pass if one is accepted. | `skill-state-machine.ts:~90` | Link only accepted items and ignore the rest explicitly; fix the message. |
| C6 | S2 | **Eligibility can't express `conditionally_eligible` or missing data.** The enum value exists but is never produced. A missing CGPA would crash or mis-evaluate. `DISCIPLINARY_HOLD` exists but is never checked. | `eligibility-evaluator.ts` | Three-valued result: eligible / ineligible / **needs_review** (missing data, pending appeal, skill expiring before the drive date). |
| C7 | S2 | **Skill validity isn't checked at drive time.** A skill that expires before the drive date still counts. | `eligibility-evaluator.ts` | Evaluate `valid_until >= drive.starts_at`. |
| C8 | S2 | **Fairness edge cases.** If the top selection rate is 0 nothing is flagged (fine), but a group of size ≥ N with a 0 rate next to a suppressed top group gives `highestSelectionRate` from unsuppressed groups only, which can hide disparity. "Unspecified" is treated as a real group. | `fairness-calculator.ts` | Report "Unspecified / Prefer not to say" separately; show a confidence note when the reference group is small; add Fisher's exact test p-value next to the 4/5ths ratio. |

### 1D. Privacy and compliance bugs

| # | Sev | Bug | Location | Fix |
|---|---|---|---|---|
| D1 | S1 | **Guardian consent defaults to `verified`, timestamped now.** Any insert without a status creates a *verified* parental consent. That defeats "verifiable parental consent". | `002_consent_and_rights.sql:41-42` | Default `pending`, `verified_at NULL`; CHECK that `verified` requires a verifier and method. |
| D2 | S1 | **`is_minor` is a static boolean**, so it goes stale and is set by whoever imports. Polytechnic first-years (the PS's 32.92% group) are often 16–17. | `001_identity_and_tenancy.sql:60` | Store `date_of_birth` (or an age-band attestation) and derive minor status at query time. Under-18: no recruiter sharing, no behavioural signals, no AI interview recording, guardian consent required. |
| D3 | S1 | **Fairness attributes have no consent purpose.** `student_group_attributes.consent_grant_id` is NOT NULL, but `consent_purposes` has no fairness-monitoring purpose. | `001_…sql:82`; `002_…sql` seeds | Add `fairness_monitoring` purpose (voluntary self-ID with "prefer not to say", aggregate-only use). |
| D4 | S2 | **No "no behavioural monitoring" guard** for the AI interview (webcam, emotion, keystroke analytics). | PS p2 | Interview is text/voice answers scored on content rubric only. No webcam proctoring for minors; no emotion or keystroke analytics for anyone. |
| D5 | S2 | **Retention isn't modelled.** No per-purpose retention period or deletion job. | PS p2 | `consent_purposes.retention_days`; nightly purge job with audit event. |
| D6 | S3 | **Per-tenant keys unused.** `organizations.key_ref` exists, but tokens are encrypted with one global key ring. | `001_…sql`; `token-cipher.ts` | Envelope encryption: per-tenant data key wrapped by a master key. Phase 3. |

---

## 2. Keep, fix, or drop?

**Keep the backbone; don't start over.** The thesis matches the PS almost word for word, and the hardest-to-retrofit parts are done and tested: tenant isolation (RLS), consent ledger, hash-chained audit, trusted ingestion and code anchors. Starting over would throw away the strongest *Feasibility* evidence we have.

**Redesign four things:**

1. **Verification model → Proof Levels** (fixes B1, B2, C1–C4).
2. **Module architecture → Evidence Bus**: mock drives, learning tasks, probes, mentor sign-offs and imports all write the same `evidence_items` + `skill_events`. This fixes B3, B14 and gives the "closed loop" for free.
3. **One Judge for everything executable**: machine test, mutation probe, learning-task acceptance tests (fixes B4).
4. **Explainable analytics first, ML later**: readiness factors, counterfactual eligibility and demand gaps are deterministic math the officer can read (fixes B5).

**Drop or demote:**

- Drop: "probe every skill before Verified". The probe becomes the *top* proof level, not the gate.
- Drop: further migration-reconciliation work for now.
- Demote: blockchain-free, AI-detector-free and authorship caveats go to the FAQ and speaker notes, not the main story.

---

## 3. PRAMAAN v2 — the solution

### 3.1 One sentence

> **PRAMAAN turns everything a student does (code, labs, contests, mock drives, learning tasks) into graded proof, uses that proof to close gaps before the season, and runs every drive with versioned rules, a clash-free calendar and AI that only proposes.**

Core design principle: **Evidence Bus.** Every module writes evidence; nothing writes skill state directly.

```
 Sources                       Evidence Bus                     Consumers
 ───────                       ────────────                     ─────────
 GitHub (consented) ─┐                                       ┌─ Skill Graph (state + proof level)
 LeetCode/Codeforces ┤                                       ├─ Resume / Recruiter Evidence Card
 Lab / cert / contest├──► evidence_items ──► skill_events ──►├─ Eligibility engine (rules v1..vn)
 Mock drive rounds  ─┤     (hash, source,    (deterministic   ├─ Gap engine (vs. JD demand)
 Learning tasks     ─┤      owner, expiry)    state machine)  ├─ Readiness Radar / Cohort heatmap
 Probe / viva       ─┤                                       ├─ Fairness monitor (per stage)
 Mentor sign-off    ─┘                                       └─ Skill Passport (OB 3.0 / W3C VC)
                         ▲
                         └─ The Judge (sandbox) emits test_result evidence for mock, probe, tasks
```

### 3.2 Proof Levels — the new verification model

The PS's five states are kept exactly. **Verified** now carries a **proof level** that says *how* it was verified:

| State | Meaning | Entered when |
|---|---|---|
| **Claimed** | Student says so; no proof | Self-declared, or resume line |
| **Observed** | System saw a signal it cannot pin to a specific artifact | Ownership-verified LeetCode/Codeforces stats; language share in a repo; unverified certificate upload |
| **Evidence-linked** | Specific artifact pinned to the skill | Code anchor at a commit (hash-verified), issuer-verifiable certificate, lab record awaiting sign-off |
| **Verified** · level | One qualifying proof passed | See levels below |
| **Expired** | Proof older than the skill's half-life | Expiry job (default 12 months, per-skill configurable) |

| Proof level | Qualifying proof | PS wording it satisfies | Typical use |
|---|---|---|---|
| **L1 Code-backed** | Substantial code in a consented repo (anchors in ≥2 files, ≥N lines, coherent commit history over ≥2 weeks) **or** an issuer-verified certificate | "code on GitHub" | Default profile badge |
| **L2 Assessed** | Platform test score: mock machine test, aptitude section, or learning-task acceptance tests run by the Judge | "test score" | Most eligibility rules |
| **L3 Defended** | Live Mutation Probe or code-grounded viva on the student's own code | "repo-specific walkthroughs, live modification tasks" (PS p2) | Recruiter shortlists for critical skills |
| **L3 Attested** | Faculty mentor sign-off against a rubric (labs, hardware, non-code) | "mentor sign-off" / "mentor attestations" | Core and polytechnic branches |

Rules:

- No state is ever set by an LLM.
- A Verified skill always shows its level, evidence, confidence, the date verified and the re-verify date.
- Eligibility rules and recruiter filters can demand a minimum level (`SQL ≥ L2`).
- Consent withdrawal demotes any skill whose only proof came from that source (C1).

### 3.3 Five signature innovations (the novelty story)

1. **Proof Levels with half-life.** Not a single "verified" tick: *how* it was proven, and *how fresh* that proof is. Recruiters see "SQL · Assessed · 3 months old". Expired is an explicit state, never a silent stale badge.
2. **Live Mutation Probe (L3).** A question about the student's *own* code at an exact commit and line range, then a small change in the sandbox checked by hidden tests. Tests understanding without AI detectors or authorship claims.
3. **Proof Path (counterfactual eligibility).** The eligibility engine is re-run on "what-if" profiles, so it can show the smallest proof that unlocks the most drives: *"Get SQL to L2 → +4 drives: 2 practice sets + 1 mini-project."* The officer sees the same at cohort level as ranked interventions: *"SQL workshop for 38 students → +112 eligibilities."* Deterministic and explainable.
4. **Publish-time fairness simulator.** Before rule v3 is published, the officer sees who gains or loses eligibility and the impact ratio per group and per funnel stage. Fairness is checked *before* students are excluded, not after.
5. **Ownership-token profile linking.** For platforms without OAuth (LeetCode), the student pastes a one-time code into their public bio; we confirm ownership, read public stats, then remove the requirement. No passwords, no scraping of private data. Codeforces uses its official API.

#### 3.3a What is new, checked against prior art (research, 17 Nov 2026)

Full sourced report: `docs/research/campus-placement-novelty-landscape.md` (notes in `research_notes/Campus placement novelty landscape/`). "No public prior art found" means our searches of vendors, standards and research did not find it; it is not a claim that nobody has ever built it.

| Innovation | Closest existing work | Prior art found | Built |
|---|---|---|---|
| Live Mutation Probe on the student's own repo | AI interviewers probing vendor repos; take-home walkthroughs | None for the combination | Yes (L3 Defended) |
| Publish-time fairness simulation + **rule repair** (less-discriminatory alternative search) | Annual NYC LL144 audits; fair-ranking papers | None in placement tools | Yes (`/tpo/rules`) |
| Proof Path with **deadline-aware recourse** (in time / tight / later drives) | Met/missed criteria lists; generic skill-gap tools | None for drive-unlock recourse | Yes (`/student/drives`) |
| **Eligibility Pass**: college-signed SD-JWT (RFC 9901), predicate claims, holder key binding, one-time verifier nonce | DigiLocker / NAD share whole documents; EU age-over-18 pilots | None for placement eligibility | Yes (`/student/passes`, `/verify-pass`) |
| Versioned rules with reason codes and appeals | Criteria display; manual re-evaluation | Versioning and appeals not found | Yes |
| Reasons in the student's language from the same decision record (Hindi, Marathi) | Translated UI strings | Not differentiating alone | Yes (drafts, need native review) |
| Contribution-scoped probes on team repos | Contribution summaries in CS-education research | None, but niche | **Not built** |

Not pitched as new (commodity): AI mock interviews, NAAC/NIRF exports, basic eligibility filters, generic skill-gap dashboards.

Supporting (not headline): **Readiness Radar**, a transparent readiness score (verified coverage for target role, mock round scores, learning progress, attendance of interventions) shown as factors, not a black-box number. It gives a cohort forecast range and an officer-only "needs support" list.

### 3.4 Module design mapped to the PS

**Student dashboard (PS p4)**

| ID | Module | v2 design | Deterministic vs AI |
|---|---|---|---|
| ST-01 | Skill Profile + one-click resume | Profile = skill graph + academics + projects. Resume PDF and recruiter view generated from it; each line links to proof. Never uploads a PDF. | Deterministic render; AI may polish wording, never adds a skill |
| ST-02 | Safe Code Import | Built (GitHub OAuth, read-only, selected repos, revocable). Add: lab/cert/contest upload, LeetCode/Codeforces linking. | Deterministic |
| ST-03 | Skill Proof Check | State + proof level + evidence list + confidence + re-verify date; "Prove it" buttons per level. | AI drafts candidate skills from repos (proposal); state machine decides |
| ST-04 | Target Companies + Gap | Pick a role or company → required skills (from JDs) vs your proof levels → gap list sorted by drives unlocked (Proof Path). | Deterministic match; AI extracts JD skills (validated) |
| ST-05 | Mock Drive + Report | R1 aptitude: 30 Qs sampled per student from a tagged bank (seeded, no two students share a set). R2 machine test: 2 problems × 10 marks, partial marks per hidden test, run by the Judge. R3 interview: role-based questions, content-scored with a rubric. Report: per-round score, weak topics, "marks lost on…" per test case. | R1/R2 deterministic; R3 AI-scored with rubric, shown as draft, student can request human review |
| ST-06 | Learning Path | Generated from mock report + gaps: tasks with Judge acceptance tests or mentor rubric; passing emits evidence → skill moves up; unlocks a mock retake. | AI drafts the path (from a curated task bank); completion is deterministic |
| ST-07 | My Drives + Eligibility | Every drive: eligible / not / needs review, with each rule and pass/fail reason in plain words; "Appeal" button. | Deterministic |
| ST-08 | Privacy + Consent | Per-purpose toggles, connected accounts, revoke, export my data, delete request, "why this score" explanations. | Deterministic |

**Admin / TPO dashboard (PS p5–p6)**

| ID | Module | v2 design |
|---|---|---|
| AD-01 | Cohort Dashboard + Reports | Heatmap skill × batch/branch (share at ≥L2); 6 KPIs; before/after compare by intervention; PDF/XLSX export. |
| AD-02 | Industry Skill-Gap Profiler | Ingest recruiter JDs (from drives) + an uploaded public JD dataset; extract skills → map to taxonomy; demand % vs cohort verified %; alerts like "Docker: 40% of JDs vs 10% of batch". Always shows sample size and dates. |
| AD-03 | Predictive Placement Analytics | Readiness Radar: cohort forecast as a range + officer-only "needs support" list with factors; mentor-assignment proposals. Labelled "provisional" until there is history. |
| AD-04 | Mock Drive Setup | Question bank CRUD with topic tags and difficulty; machine-test problems with hidden tests; review/approve AI-drafted interview questions per role. |
| AD-05 | Bulk Mailing | Company DB, template with merge fields, rate-limited send, delivery/open/reply status (reply via inbound mailbox). |
| AD-06 | Drive Management + Auto Allocation | One calendar; rounds, slots, rooms, panels; clash checks for room, panel and *student*; inbound company email → AI proposes slot → officer confirms. |
| AD-07 | Eligibility Rules | Rule builder (academics, backlogs, gap, skills + min level, policy limits); versions immutable; what-if preview; each decision stores rule version + input snapshot + hash. |
| AD-08 | Recruiter Candidate Search | Officer-approved, time-boxed access; filter by skill + level + freshness; each result lists matched rules/skills with evidence links; sorted by explicit criteria the recruiter picks, no hidden score. |
| AD-09 | AI Helps, Human Decides | Proposal inbox (all agents); approve / edit / reject with reason; nothing touching candidacy applies without approval; every agent action logged. |
| AD-10 | Fairness Check | Impact ratio per group per stage (eligible, shortlisted, offered) for gender, category, branch, college tier; small-group suppression; flags → review queue. |
| AD-11 | Accreditation Reporting | NAAC (5.2.1, 5.2.2) and NIRF-style tables: placed, median salary, higher studies, entrepreneurship, branch-wise; deduplicated per student; formula shown; export. |
| AD-12 | Roles + Separate Data | RLS per college (built); roles university_admin, college_admin, dept_coordinator, officer, mentor, recruiter, student; university sees aggregates only. |

### 3.5 Bounded agents

| Agent | Reads | Writes (proposal kind only) | Approval |
|---|---|---|---|
| Repo Profiler | Consented snapshots, anchors | `candidate_skills` | Auto-applies only to Claimed/Observed; never Verified |
| Interview & Viva Drafter | Role, JD skills, code anchors | `interview_questions`, `viva_questions` | Officer approves question banks |
| Demand Scout | JDs | `jd_skills`, `gap_alert` | Officer acknowledges alert |
| Path Planner | Mock report, gaps, task bank | `learning_path` | Auto for student-facing practice (no candidacy effect) |
| Drive Coordinator | Inbound emails, calendar | `slot_allocation`, `mail_draft` | Officer confirms |
| Readiness Analyst | Aggregates | `support_candidate`, `intervention_recommendation` | Officer reviews; student never sees "at-risk" |

Controls:

- Tool allowlists.
- Schema-validated outputs.
- Repo, JD and email text treated as untrusted data.
- The DB role for agents has no write grants on `student_skills`, `eligibility_decisions`, `applications` or `offers`.
- One `agent_actions` row per tool call, hash-chained into audit.

LLM provider sits behind an adapter. Default is Claude: `claude-sonnet-5-5` for drafting, `claude-haiku-5-5` for extraction. Questions are generated at import time and cached, so the demo never waits on a model.

### 3.6 Architecture and stack (unchanged where already built)

- **Web:** Next.js (App Router) + Tailwind + shadcn/ui; three workspaces (student, TPO, recruiter); mobile-first student UI.
- **API:** Fastify + TypeScript (built); domain logic in `packages/domain` (pure, unit-tested).
- **DB:** Supabase PostgreSQL with forced RLS (built); `pg-boss` for jobs (expiry, retention purge, JD processing, mail).
- **Judge:** self-hosted Judge0 CE (Docker), no network, CPU/memory/time caps. Used for machine test, probes and learning-task tests. Never boots student repos.
- **Files:** Supabase Storage (certificates, lab evidence) with per-tenant prefixes.
- **Mail:** Resend or SES for outbound; inbound mailbox webhook for replies and company emails.
- **Credentials:** Open Badges 3.0 / W3C VC 2.0 JSON-LD signed with Ed25519 (`did:web` per college); public verify page.
- **Reports:** server-side PDF (Playwright print) and XLSX (`exceljs`).

### 3.7 KPI dictionary (shown with numerator and denominator everywhere)

| KPI | Formula |
|---|---|
| Placement Rate | students with ≥1 accepted offer ÷ students opted in for placement (batch) |
| Verified Skill Coverage | Σ target-role skills at ≥L1 Verified ÷ Σ target-role skills required (opted-in students) |
| Skill-Gap Closure Rate | gaps closed (skill reached required level) since season start ÷ gaps open at season start |
| Shortlist-to-Offer Ratio | offers ÷ shortlisted applications (per drive and overall) |
| Time-to-Shortlist | median days from drive publish to shortlist published |
| Recruiter Engagement Score | weighted: evidence cards opened, feedback submitted, re-probes requested, per active recruiter (weights shown) |

### 3.8 Sustainability and scale (for the deck)

- **Buyer:** college placement office; annual fee per graduating student (price to validate with ≥5 TPO interviews). A recruiter discovery tier comes later.
- **Retention:** accreditation exports and rule history create switching cost; each season adds evidence and outcome data.
- **Cost:** one shared Postgres with RLS; LLM only for drafts (cached); Judge runs small, bounded jobs.
- **Scale path:** single college (pilot) → university roll-up (aggregate-only views, already supported by `parent_id`) → multi-college; optional siloed DB per strict university.

---

## 4. Data-model and code changes

### 4.1 Fix migrations (Phase 0)

| Migration | Change | Fixes |
|---|---|---|
| `017_privacy_fixes.sql` | `guardian_consents.status` default `pending`, `verified_at` NULL, CHECK that verified requires `verified_by` + `method`; add `students.date_of_birth`, view `student_age_status`; add purposes `fairness_monitoring`, retention days per purpose | D1, D2, D3, D5 |
| `018_roles_and_taxonomy.sql` | Roles `college_admin`, `dept_coordinator`; `skill_aliases`, `skill_mappings(framework ESCO/ONET/NSQF, code, version)`; `student_skills.proof_level`; skill `half_life_days` | B11, B12, §3.2 |
| `019_skill_state_v2.sql` | Update `trg_verify_skill_evidence`: require evidence `valid_until > now()`, verification newer than `state_since` when coming from expired, and a proof level; allow demotion transitions | C1, C2 |
| `020_academics_and_rules.sql` | `academic_records`: tenth_pct, twelfth_pct, diploma_pct, backlog_history, gap_years; `placement_policies` (one-offer, tiers); `eligibility_appeals` | B6, B7 |
| `021_drives_v2.sql` | `drive_rounds`, `rooms`, `panels`, `slots` (with exclusion constraints for room, panel and student overlap), `interviews`, `offers`, `application_events` | B9, B10 |
| `022_assessment_and_learning.sql` | `question_bank`, `mock_drives`, `mock_attempts`, `mock_round_results`, `coding_problems`, `judge_runs`; `learning_paths`, `learning_tasks`, `task_attempts` | B3, B14 |
| `023_demand_outreach_ai.sql` | `jd_documents`, `jd_skill_mentions`, `demand_snapshots`; `outreach_templates`, `outreach_messages`, `inbound_messages`; `agent_actions`; broadened `proposals.kind`; `fairness_reviews.stage` + `college_tier` | B8, B13, B15, AD-05 |
| `024_credentials_kpi.sql` | `credentials` (OB3/VC JSON, status, revocation); `kpi_snapshots` | B16 |

Clash detection for slots uses PostgreSQL `tstzrange` + `EXCLUDE USING gist`, so the database itself rejects a double-booked student, room or panel. That is a strong, cheap and demo-able guarantee.

### 4.2 Domain code changes

- `skill-state-machine.ts`: C1–C5; required `studentId`; proof-level computation `computeProofLevel(evidence[], verification?)`.
- `eligibility-evaluator.ts`: rule DSL v2 (§4.5), skill IDs + min level + min proof level + validity at drive date, `needs_review`, policy limits, `explain()` returning plain-language lines, and `counterfactual(snapshot, rules[], candidateProofs[])` for Proof Path.
- `fairness-calculator.ts`: stage parameter, `college_tier`, separate "Unspecified", Fisher's exact p-value, reference-group size note.
- New pure modules: `readiness.ts`, `gap-engine.ts`, `mock-scoring.ts`, `calendar-clash.ts`, `kpi.ts`, `accreditation.ts`.

### 4.3 Rule DSL v2 (example)

```json
{
  "academics": { "minCgpa": 6.5, "minTenthPct": 60, "minTwelfthOrDiplomaPct": 60, "maxGapYears": 1 },
  "backlogs":  { "maxActive": 0, "maxHistory": 2 },
  "branches":  ["CSE", "IT", "ENTC"],
  "graduatingYears": [2027],
  "skills": [
    { "skillId": "…sql",  "minLevel": 2, "minProof": "L2" },
    { "skillId": "…java", "minLevel": 2, "minProof": "L1" }
  ],
  "policy": { "blockIfPlacedAboveCtcInr": 600000, "maxOffers": 1, "dreamTierAllowed": true }
}
```

---

## 5. Build plan

Assumes 2–4 people. Dates: PPT round opens **15 Dec 2026**; finale **23–24 Jan 2027** (re-check the Unstop listing).

### Phase 0 — Fixes and foundations (16–22 Nov)

- Migrations 017–019, domain fixes C1–C8, tests for each. **Exit:** all old tests plus new ones green.
- Taxonomy seed: ~150 skills with ESCO/O\*NET/NSQF codes and aliases.
- **Demo tenant seed:** 1 university, 2 colleges, 6 branches, ~300 synthetic students with academics, skills at mixed levels, consents (incl. 10 minors), 12 companies, 15 JDs, 8 drives. Visibly marked synthetic.
- Web shell: Supabase auth, role-based routing, layout for the three workspaces, design tokens.

#### Phase 0 status: DONE (16 Nov 2026), not yet committed

| Item | Result |
|---|---|
| C1–C5 skill state machine | Proof Levels, demotion with reason codes, no stale re-verification, mandatory `studentId`, attestation rubric/expiry/evidence checks. Consent revocation now really demotes repo-derived skills (it was silently rejected before). |
| C6–C7 eligibility | Rule DSL v2 (10th/12th/diploma, gap, backlog history, skill id + level + proof, policy limits), `needs_review`, validity at drive date, plain-language checks. **Proof Path** (`packages/domain/src/proof-path.ts`) added. |
| C8 / B8 fairness | Per-stage funnel, `college_tier`, undisclosed groups excluded, Fisher's exact p-value, small-reference warning. |
| Migrations | `017_privacy_fixes` (D1, D2, D3, D5), `018_roles_and_taxonomy` (B11, B12), `019_skill_state_v2`. 019 also fixes a NULL-outcome bypass in the old verified-skill trigger. |
| Seeds | `010_skill_taxonomy.sql` (145 skills; ESCO / O\*NET labels seeded as `pending_review` with no codes) and `020_synthetic_demo_tenant.sql` (300 students, 10 minors by date of birth, ~1,000 verified skills, 10 drives with v2 rules, one completed drive funnel). Regenerate with `npm run seed:generate`. |
| Offline DB tests | PGlite (in-process Postgres) runs every migration and seed with no Docker and no live DB: `db/tests/v2-schema-invariants.test.ts`, `db/tests/demo-seed.test.ts`. |
| Web shell | Supabase sign-in, `/api/me` routing to Student / Placement Office / Recruiter / University workspaces, all 25 module routes, light/dark, mobile. `NEXT_PUBLIC_PREVIEW_SHELL=true` renders it without sign-in for design review. |
| Gates | Typecheck (incl. web), lint and monorepo build pass. 432 offline tests pass. The 15 live-Supabase tests fail on connection (`tenant/user … not found`), not on assertions. |

Still open from Phase 0: migrations 017–019 are **not applied** to the Supabase project; the ESCO / O\*NET mappings need confirming against the official sources before they are shown as aligned; LeetCode ownership-token linking (B2) moves to Phase 1 item 1.

### Phase 1 — Round 1 vertical slice (23 Nov – 13 Dec), screenshots and video for the PPT

1. **ST-01/02/03:** profile with states and proof levels; GitHub import (built) wired to UI; certificate upload; LeetCode ownership-token link; one-click resume PDF.
2. **Judge + ST-05:** Judge0 in Docker; aptitude R1 (per-student sampled set); machine test R2 (2 problems, partial marks); report page with weak topics and marks lost.
3. **L3 probe:** one Live Mutation Probe end-to-end on a volunteer TS/Python repo (anchor → question → predict → mutate → tests → Verified L3).
4. **AD-07 + ST-07:** rule builder v2, publish version, student eligibility with reasons, appeal submission and officer queue.
5. **Proof Path:** student "next best proof" card and officer intervention ranking.
6. **AD-01:** heatmap + 6 KPIs on seed data.

**Exit (demo-able by 13 Dec):** a recorded 3-minute walkthrough (Rahul's journey); 8–10 real screenshots replace mock-ups in the deck.

### Phase 2 — Breadth to all 20 modules (14 Dec – 12 Jan)

- ST-04 target companies + gap; ST-06 learning path with Judge-tested tasks → evidence → retake; ST-05 R3 interview (text answers, rubric scoring, human review option); ST-08 privacy centre (export, delete request, per-purpose toggles).
- AD-02 JD ingestion + Demand Scout + gap alerts; AD-03 Readiness Radar; AD-04 question bank and interview approval; AD-05 bulk mail with reply tracking; AD-06 calendar with rounds/slots, DB-enforced clashes, inbound email → slot proposal; AD-08 recruiter portal + Evidence Card; AD-09 proposal inbox; AD-10 fairness per stage + publish-time simulator; AD-11 NAAC/NIRF export; AD-12 role management and university aggregate view.
- Skill Passport: OB3/VC issue + public verify page.

**Exit:** every RTM row has a screen, a rule and a test; full demo script runs on seed data in under 8 minutes.

### Phase 3 — Hardening and finale prep (13–22 Jan)

- Cross-tenant leak tests across all new endpoints, exports and jobs.
- Judge isolation test (no network, resource caps).
- Offline demo mode: pre-imported repo bundle, cached LLM outputs, labelled as preloaded.
- Load test with 5k synthetic students.
- Per-tenant envelope keys (D6) if time allows.
- Rehearse the 5- and 8-minute demos; prepare failure fallbacks.

#### Phases 1–3 status: BUILT (16 Nov 2026), not yet committed

Runs end to end with `npm run demo` (offline, PGlite, synthetic data). Where each requirement lives:

| Req | Screen | API (apps/api/src/v2) | Tested in |
|---|---|---|---|
| ST-01 Profile + resume | `/student/profile`, `/resume` | `routes-student.ts` profile, resume, credentials | `v2-demo-flow` |
| ST-02 Import | `/student/import`; mentor `/tpo/reviews` | evidence upload, external-profiles (ownership token), reviews/decide | `v2-demo-flow` (LeetCode) |
| ST-03 Proof check + L3 probe | `/student/proofs` | skills/:id, probes predict/mutate | `v2-demo-flow` (probe) |
| ST-04 Targets | `/student/targets` | targets | — (read-only view) |
| ST-05 Mock drive | `/student/mock-drive` | mock attempts, aptitude, machine run/submit, interview | `engines`, `v2-demo-flow` |
| ST-06 Learning path | `/student/learning-path` | generate, items submit (judge or mentor) | `v2-demo-flow` |
| ST-07 Drives + appeal | `/student/drives` | drives, apply, appeals, offers respond | `v2-demo-flow` |
| ST-08 Privacy | `/student/privacy` | privacy, consents, data-requests, export | `v2-demo-flow` (minor block) |
| AD-01 Cohort | `/tpo/cohort` | cohort, export.csv, interventions | `v2-demo-flow` |
| AD-02 Demand | `/tpo/demand` | demand, scan (agent), jds | `engines`, `v2-demo-flow` |
| AD-03 Readiness | `/tpo/readiness` | readiness, propose-support (agent) | `engines`, `v2-demo-flow` |
| AD-04 Mock setup | `/tpo/mock-setup` | banks, draft (agent), approve | — |
| AD-05 Bulk mail | `/tpo/outreach` | templates, send (outbox without SMTP), reply | — |
| AD-06 Drives + calendar | `/tpo/drives` | drives, rounds (DB exclusion), inbound → propose (agent) | `engines`, `v2-demo-flow` (clash 409) |
| AD-07 Rules | `/tpo/rules` | rules, preview (what-if + fairness), publish, decisions/publish, appeals | `v2-demo-flow` |
| AD-08 Recruiter search | `/recruiter/search` | search, candidates (Evidence Card), shortlist, reprobe | `v2-demo-flow` |
| AD-09 AI proposals | `/tpo/proposals` | proposals, decide (applies effect) | `v2-demo-flow` |
| AD-10 Fairness | `/tpo/fairness` | fairness (SECURITY DEFINER group counts), flag | `fairness-*`, `v2-demo-flow` |
| AD-11 Accreditation | `/tpo/accreditation` | accreditation, export.csv | `engines`, `v2-demo-flow` |
| AD-12 Roles + separate data | `/tpo/roles`, `/university/outcomes` | members, audit, university outcomes | `v2-demo-flow` (isolation) |
| BR-19 Pipeline + offers | `/tpo/applications`, `/recruiter/pipeline` | applications stage, feedback | `v2-demo-flow` |

Phase 3 done: cross-college, cross-role and demographics isolation tests; judge isolation tests (`v2-judge`); 5,000-student load test (`load`); offline demo mode with preloaded, labelled data.
Gates: typecheck (incl. web), lint and build pass; 480 offline tests pass; the same 15 live-Supabase tests fail on connection only.

Not done or deliberately limited:
- **Agents are deterministic rules, not LLM calls.** Demand Scout, Readiness Analyst, Drive Coordinator and Interview Drafter all record `deterministic-rules-v1` as their model. An LLM adapter (Claude) is the next step and must stay proposal-only.
- **Local judge is not a security boundary.** Production must set `JUDGE0_URL`.
- **No real GitHub OAuth in the demo.** The existing P0-04 flow needs a GitHub app; the demo probe uses a preloaded snapshot, labelled as such.
- **Tenant data keys are not split.** Per-tenant envelope keys (D6) are not implemented.
- ~~Migrations 017–024 are not applied to the Supabase project.~~ **Superseded 17 Nov 2026:** see below.

#### Novelty additions status: BUILT (17 Nov 2026), not yet committed

| Feature | Screen | Code | Tested in |
|---|---|---|---|
| Eligibility Pass (SD-JWT, key-bound, one-time verifier request) | `/student/passes`, `/verify-pass` | `packages/domain/src/sd-jwt.ts`, `v2/routes-passes.ts`, migration 025, `apps/web/lib/wallet.ts` | `sd-jwt`, `v2-eligibility-pass` |
| Fairness simulation within allowed branches + rule repair | `/tpo/rules` ("Find a fairer alternative", "Use this") | `packages/domain/src/rule-repair.ts`, `v2/routes-tpo.ts` `/rules/repair` | `rule-repair`, `v2-fairness-repair` |
| Deadline-aware recourse | `/student/drives` | `recourseTiming` in `proof-path.ts` | `proof-path-timing`, `v2-demo-flow` |
| Reasons in Hindi and Marathi | `/student/drives` language switch | `EligibilityCheck.t` template keys, `apps/web/lib/i18n.ts` | `reason-i18n` |
| Ship hardening (helmet, rate limit, CORS fail-closed, body limit, CSP, Docker, CI) | — | `app.ts`, `v2/rate-limit.ts`, `next.config.mjs`, `Dockerfile`, `docker-compose.yml` | `ship-hardening` |

Rule repair ranks options that clear the four-fifths benchmark by smallest change, non-skill edits first. If none clears it, options are ranked by how much they shrink the total gap below 0.80 across groups. Head-count shortfall grows as more students qualify, so it is shown but never used to rank. Required skills are never removed.

The synthetic seed now shifts 10th/12th/diploma marks by category (SC −9, ST −11, OBC −3, EWS −4), so the fairness tools have a realistic pattern to find. This is a labelled modelling choice in the demo data, not a statistic. CGPA and skills are not shifted.

Gates (17 Nov): typecheck, lint and web build pass. With database URLs pointed offline, 514 tests pass and 125 are skipped; the 10 failures are all "database unreachable" or the production-target guard.

**Live Supabase, 17 Nov 2026:** running the full suite with `DATABASE_URL_ADMIN` set applied migrations **017–025** to the Supabase project. `db/tests/migration-runner.test.ts` test 2 calls `runMigrations()` with no guard. Effects:
- Migration 017 cleared `guardian_consents.verified_at` where status is not `verified`, and filled in empty `consent_purposes.retention_days`.
- No tables or columns were dropped.
- The live database now enforces v2 skill rules, so v1 live tests 11–16 in `supabase-real-db` fail. A Verified skill now needs a proof level.

Decision needed: keep v2 on the live project, or restore it from a backup.

### Phase 4 — Pilot (post-QUASAR)

One college, CSE + one non-CS cohort, 40–60 volunteers, 2 mentors, 1–2 recruiters.

Measure:
- false-failure rate on L3;
- Verified Skill Coverage and gap closure before/after;
- TPO time saved;
- recruiter evidence-card usage.

Stop or pivot criteria as in Master Blueprint §13.2.

---

## 6. Prototype demo script (target 6 minutes)

1. **Student Rahul** links GitHub (consent screen) and LeetCode (ownership token). Python shows *Verified · L1 Code-backed*; SQL shows *Claimed*. (45 s)
2. Takes the **Backend Developer mock drive**: aptitude 21/30, machine 12/20 (one hidden test failed on empty input), interview weak on joins. Report shows weak topics and marks lost. (60 s)
3. **Proof Path:** "SQL to L2 → +4 drives". Learning path: 2 SQL sets + mini-project; tasks pass in the Judge → SQL *Verified · L2 Assessed*. (45 s)
4. **Live Mutation Probe** on his own repo → Python *L3 Defended*. (60 s)
5. **Drive:** rule v3 makes him eligible, with reasons. A classmate is ineligible, appeals, and the officer resolves it. (30 s)
6. **TPO:** heatmap (SQL weak 60% → 25% after workshop); Demand Scout alert for Docker; fairness simulator flags rule v4 for one branch before publish; inbound company email → slot proposal → confirm; calendar refuses a student clash. (60 s)
7. **Recruiter:** search "SQL ≥ L2, fresh < 6 months" → Evidence Card with anchors → shortlist → offer; NAAC export in one click. (30 s)

---

## 7. Top risks

| Risk | Mitigation |
|---|---|
| Scope too large for the team | Phase 1 is the must-have; Phase 2 modules are "narrow but real" slices, each ≤2 days |
| Judge security | Judge0 in an isolated container with no network or secrets; never boot student repos; probes only on extracted functions |
| L1 Code-backed gamed by copied repos | L1 is the lowest level; rules for important skills need L2/L3; commit-coherence checks; recruiters see the level |
| LeetCode access breaks | Ownership-token + public stats is Observed only; our own machine test is the real proof |
| LLM latency or outage in demo | Pre-generated, cached, labelled |
| Fairness data sparse | Voluntary self-ID, suppression, show sample sizes; never auto-act on flags |

---

## 8. Decisions needed from the team

1. **Team size and owners** for web, API/domain, Judge/assessment, data/seed.
2. **Judge choice:** Judge0 CE (fast to stand up, recommended) or a custom isolate runner.
3. **L1 threshold** (min files, lines, commit span) and default skill half-life (12 months recommended).
4. **Sign-off on Proof Levels** replacing "probe before Verified".
5. **Archive** the three old blueprint files into `docs/archive/` once this plan is accepted.

## Synthetic data realism pass (17 Nov 2026)

The demo data stays synthetic (labelled, `.invalid` emails, no real person), but is now modelled to behave like a real campus:

- **Names** are drawn from regional and community pools (Marathi, Hindi-belt, Gujarati/Marwari, South Indian, Muslim, Sikh/Punjabi, Bengali/Odia, Goan Christian) in proportions that differ by college, so given names and surnames go together, with no repeated full name.
- **Marks** come from one latent ability, so 10th, 12th and CGPA correlate (seed: 10th to 12th about 0.75, CGPA to 12th about 0.4). SSC marks move in steps of 0.2 (out of 500) and HSC in steps of 1/6 (out of 600). About 12% of degree students are lateral-entry diploma holders with no 12th. Backlogs and gap years depend on CGPA.
- **Gender mix** differs by branch (for example Mechanical 8%, IT 40% women).
- **Skills** cluster in real stacks (web, backend, data, systems, cloud) instead of random picks, with plausible file paths on code evidence.
- **Timelines** cluster proofs in the current season and the summer break; consents arrive in an onboarding wave.
- **Placement funnel** for the completed drive: only eligible students apply (about 70%), and shortlist and offers follow a noisy score of CGPA and verified skills (about 12% offered), with offers from 4.2 to 5.8 LPA.
- Category-linked school-marks gap is kept on purpose so the fairness tools have a pattern to find, and stays labelled as a modelling choice.

Generator: `scripts/generate-demo-seed.mjs`, name pools in `scripts/seed-data/people.mjs`. Streams for the new model are separate from the original ones. The fairness-repair test now uses a 75/75 cutoff because realistic marks make 80/80 leave almost no one eligible.
