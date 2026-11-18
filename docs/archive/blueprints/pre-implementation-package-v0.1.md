# PRAMAAN — Pre-Implementation Package v0.1

*QUASAR 5.0 · EdTech · Agentic Placement Intelligence Platform · prepared 6 Nov 2026*

**Status:** proposal for team agreement. No implementation starts until the gates in Part 10 are signed off.

## 0. How to read this document

**Labels used throughout**

- **\[FACT\]** is read directly from the supplied PDF or master blueprint.
- **\[ASSUMPTION\]** is something we are choosing to believe and must validate.
- **\[REC\]** is my recommendation.
- **\[OPEN\]** is an unresolved question that needs an owner.
- **\[UNVERIFIED\]** is an external claim (law, API, standard, vendor) that I did not check against a primary source in this session.

**Evidence base**

- The master blueprint (.md) was read in full. It is treated as the working source of truth, subordinate to the PDF.
- The QUASAR PDF was read as rendered page images (22 pages). EdTech wording below is taken from pages 13–18.
- The Gemini report (.docx, about 14.7k words) was text-extracted and skimmed. It is treated as non-authoritative. Where it conflicts with the PDF, the PDF wins. Specific Gemini problems are listed in §1.2.
- I did no web research. Every statement about DPDP timing, NYC LL144, EU AI Act, NAAC/NIRF templates, LeetCode access, Open Badges conformance or CVEs is **\[UNVERIFIED\]** until someone checks the primary source.

---

## 1. Official PDF page map (pre-code check 1)

### 1.1 Confirmed

**\[FACT\]** The supplied PDF has 22 pages and four domains. The EdTech section is **pages 13–18**.

| PDF pages | Domain |
| --- | --- |
| 1–5 | FinTech (RecoverIQ) |
| 6–12 | Waste Management (CompostIQ) |
| **13–18** | **EdTech (our problem statement)** |
| 19–22 | Vibration Energy Harvesting |

| Page | EdTech content (verified against the page images) |
| --- | --- |
| 13 | Definition, short description, four core features |
| 14 | Business requirements: Core Competency Profiling (4 bullets), Skill-Gap Bridging (3), Automated Campus Hiring Workflows (4), Trust/Privacy/Explainability/Compliance (5) |
| 15 | Multi-Tenancy/Scalability/Administration (3 bullets), Streamlined Student & Recruiter Experience (1), Expected Outcome |
| 16 | Student Dashboard, 8 modules |
| 17 | Admin Dashboard, first 9 modules |
| 18 | Admin Dashboard, last 3 modules (Fairness Check, Accreditation Reporting Suite, Roles + College-Separate Data) |

The master blueprint's §0.3 map is correct. The original brief's "14–19" and Gemini's "10–14" are both wrong for this file.

### 1.2 Problems in the Gemini report that should not be inherited

- It cites pages 10–14 and 11–12 throughout. It also says "PDF Page 13" for the company-email auto-allocation, which is actually page 17. It claims its extraction is "verified verbatim" while using these wrong pages, so its "verbatim" label cannot be trusted.
- It states as settled facts several things I cannot verify. Examples: CVE numbers and affected versions, an RLS policy in which `UNIVERSITY_ADMIN` bypasses tenant filtering, NAAC Criterion 5.2.1 / DVV deduplication rules, and NIRF median-salary rules. These are **\[UNVERIFIED\]**. Do not put them in a deck as fact.
- It proposes a `students` table holding `gender` and `category` columns next to placement data, and an RLS bypass role. Both conflict with DPDP minimisation and with the PDF's tenant-isolation requirement (see T-04, T-07).
- It proposes a LeetCode "bio token" verification flow. That is a plausible idea, but its claim that LeetCode has no official API is **\[UNVERIFIED\]**.
- It reads "Observed" as "unused Redis import in package.json". The PDF never defines Observed (see O-01).

---

## 2. Requirement traceability check (pre-code check 2)

### 2.1 Method

I compared every row of master blueprint §2.1–2.3 (BR-01–19, ST-01–08, AD-01–12) against the PDF wording on pages 14–18.

- **\[FACT\]** The IDs are our decomposition, not official IDs.
- The PDF has **20** business-requirement bullets (pages 14–15). We have 19 BR rows because the page-15 "Scalable rollout" bullet is merged into BR-17. **\[REC\]** Split it into **BR-17a** (tenant isolation) and **BR-17b** (scalable rollout, hierarchy, per-tenant config, keys, rate limits) so it cannot be silently dropped.
- The 8 Student and 12 Admin modules map one-to-one. The counts are correct.
- The page-13 core features and the page-15 Expected Outcome have no IDs. **\[REC\]** Add cross-check rows **X-01–X-08** (listed in §2.4).

### 2.2 Missed or weakened wording

| # | ID | Official wording (paraphrased closely) | Blueprint gap | Fix |
| --- | --- | --- | --- | --- |
| M-01 | BR-07 | Cohort gap heatmaps **plus recommended interventions** pre-season; measure post-intervention gain in verified skills **and shortlisting rates** | Row says only "intervention measurement"; no shortlisting-rate outcome | Add an interventions entity and a shortlisting-rate before/after view |
| M-02 | BR-11 | Any candidacy-affecting action needs T&P officer **review/override**; eligibility is listed as an agent task | Row says "approval gate" only; override right is missing | Officer can approve, reject and override after the fact, with a reason. See T-03 |
| M-03 | BR-12 | Show evidence, contributing factors **and confidence**; plain language for **students, officers and recruiters** | Row omits confidence and the three-audience requirement | Three explanation renderings; confidence is ordinal (see T-05) |
| M-04 | BR-13 | Includes **breach notification** | Missing from the row (present only in §6.3 prose) | Add to row; add incident-response test |
| M-05 | BR-14 | Follow the direction of **NYC LL144 and EU AI Act high-risk rules** | Row drops the EU AI Act reference; §6.4 only notes LL144 does not automatically apply | Add a "high-risk-style controls" checklist (logging, human oversight, transparency, data governance). **\[UNVERIFIED\]** Counsel to confirm what applies |
| M-06 | BR-16 | Audit covers profile changes, verification events, eligibility decisions, agent actions **and data access** | Row lists none of the coverage; read-access logging is the usual miss | Log reads of student data (recruiter views, exports), not only writes |
| M-07 | BR-17 | **Optional siloed storage** for strict universities; **automated** cross-tenant leak tests; per-tenant config, **rate limits and encryption keys** | Row has isolation and hierarchy only | Per-tenant key reference and rate-limit config in schema; leak tests run in CI; siloed storage = documented option with a thin demo slice |
| M-08 | BR-19 | Recruiters get requirements, shortlists, **feedback**; **structured submission** of evidence, applications, offers | Feedback and structured submissions not named | Add recruiter feedback and structured application/offer submission to the P0 recruiter journey |
| M-09 | ST-01 | Fills from **GitHub, LeetCode**, projects, certificates; "Student never uploads PDF" | Blueprint says "LeetCode/assessment where integration allows"; PDF names LeetCode explicitly | See O-02. Read "never uploads PDF" as "never uploads a **resume** PDF"; evidence uploads are required by BR-03/ST-02 |
| M-10 | ST-03 | No proof = Claimed; **proof found = Verified**; proof = GitHub code, test score or mentor sign-off; **1-year-old proof → Expired** (example) | Blueprint's five-state design is stricter than this page-16 simplification; the 1-year example is not carried into a freshness policy | See T-01. Default freshness window 12 months, configurable |
| M-11 | ST-04 | Student **sees best-fit target companies** and the per-company skill gap | Row says the student *selects* a company | System must also recommend best-fit companies, with reason codes (no hidden score) |
| M-12 | ST-05 | Aptitude is a **different set for every student**; report comes **after all three rounds**; example includes "weak topics" | "Different set per student" missing; interview scoring undefined | Seeded per-student sampling from a bank. See O-04 on scoring. The Machine Test executes arbitrary code (T-08) |
| M-13 | AD-01 | Reports: mock-drive score **per round**, top weak topics, **students needing help**, before-vs-after; officer **books** a workshop | Row lacks per-round mock scores, the needing-help list and intervention booking | Add them. The needing-help list must be human-reviewed (T-02) |
| M-14 | AD-03 | **Forecasts batch placement rate**; **flags at-risk students 6 months before** season; uses skills, mock scores, learning progress; officer assigns mentors | Row is conditional ("only when validated historical data exists"), which effectively removes the requirement | See T-02. Ship a labelled scenario estimate plus a human-review queue; do not claim validation |
| M-15 | AD-05 | Template set once; sends to **all companies in the company database in one click**; **replies tracked** | "Where integration supports it" softens it | Demo against a mail sandbox with real send, delivery and reply tracking; disclose it is sandboxed |
| M-16 | AD-06 | System **reads company's email**, auto-picks a slot and allocates the drive; officer confirms | Blueprint puts inbound email under P2 | Build a narrow slice: inbound-email webhook or paste-in. Email body is untrusted input (see §C) |
| M-17 | AD-08 | Recruiters have **officer-approved access** | Row says only "authorized recruiter" | Recruiter access is an approval record issued by an officer, scoped and expiring |
| M-18 | AD-11 | "NAAC/NIRF-**ready**"; includes salary, higher studies, branch outcomes | Blueprint says "-oriented", which is honest, but the schema has no outcome entity for higher studies or salary | Add `student_outcomes`. **\[OPEN\]** Current NAAC/NIRF templates need checking. Do not claim "compliant" |
| M-19 | p13/p15 | Named components: **Verified Skill Graph, Gap-Bridging Engine, Placement Orchestrator**; "tenant = college" | Blueprint uses its own names | Use the PDF names in the architecture and deck so judges can map them instantly |
| M-20 | AD-04 | Officer **sees all student reports** | Not stated; conflicts with department-scoped roles if unscoped | Define scope: officer sees reports within their department/tenant, subject to RLS |

Everything not listed above matches the PDF wording closely enough to proceed.

### 2.3 Tensions inside the official text (not bugs in our blueprint)

| # | Tension | Why it matters | \[REC\] |
| --- | --- | --- | --- |
| T-01 | p16 says "proof found = Verified" (e.g. Python code in GitHub). p14 says evidence-gated with five states, and p14 also says integrity is checked via walkthroughs, live modification and attestation. | A judge testing the p16 example will see our system say *Evidence-linked*, not *Verified*. | Keep five states. Rule: **Verified = ≥1 accepted evidence item AND a completed verification path** (defence, probe, qualifying test score, or mentor sign-off). Say in the pitch: "GitHub code is the evidence; the check is the proof." **\[OPEN\]** Ask the organizers whether code presence alone is intended to count |
| T-02 | AD-03 requires at-risk flags 6 months ahead; AD-09 forbids labelling any student at-risk or failing without a human check. | An automated flag stored on a student record violates AD-09. | Output is a **proposal in a review queue** titled "candidates for officer review", never stored as a student status until an officer confirms. Students never see a machine-assigned label. Cohort forecast is shown as a **scenario range** marked "not validated" |
| T-03 | BR-11 says candidacy-affecting actions need review, yet the engine decides eligibility. | If deterministic eligibility publishes straight to students, that arguably is an unreviewed action. | Officer approves **publication of each rule version and each drive's eligibility list** (batch-level), can override any student with a reason, and students see results as "provisional until published" |
| T-04 | Hierarchy university → college → department → officer, but tenant = college with DB-level isolation. | A university role needs *some* cross-college view. A blanket bypass breaks isolation. | University roles see **aggregate views only**, plus explicit per-tenant membership grants. No application database role may bypass RLS |
| T-05 | BR-02/BR-12 require "confidence"; the blueprint forbids unsupported probabilities. | A decimal "87% confidence" would be invented. | Confidence = **ordinal evidence strength** (e.g. Low/Medium/High) derived from stated rules (modalities passed, evidence age, reviewer agreement), never a probability |
| T-06 | BR-15 lists commit-history coherence as a signal; the blueprint says commit history is not authorship proof. | A weak signal could be used against students. | Coherence may only **add context or trigger human review**; it can never lower a status or cause a failure alone |
| T-07 | AD-10/BR-14 need gender and category; BR-13 needs minimisation and under-18 safeguards. | Collecting sensitive attributes without a purpose is a DPDP risk. **\[UNVERIFIED\]** | Store group attributes in a separate restricted table with a dedicated consent purpose. Fairness jobs read it; nothing else does. Use synthetic attributes in the demo |
| T-08 | ST-05 Machine Test runs arbitrary code typed by the student. | The sandbox design in the blueprint covers only the Mutation Probe. | One runner, two job types (probe, machine test), same isolation. Machine Test uses fixed harnesses, stdlib only, no repo content |

### 2.4 Cross-check rows to add

| ID | Source | Check |
| --- | --- | --- |
| X-01 | p13 | Placement Orchestrator covers eligibility, drives, shortlists, interviews and offers |
| X-02 | p13 | Pilot → university → multi-college path is documented |
| X-03 | p13 | Human oversight of AI decisions is demonstrable |
| X-04 | p15 outcome | One officer dashboard shows Placement Rate, Verified Skill Coverage, Skill-Gap Closure Rate |
| X-05 | p15 outcome | No skill appears as verified without proof anywhere in the product, including exports |
| X-06 | p15 outcome | Learning paths create new verifiable evidence |
| X-07 | p15 outcome | Spreadsheet filtering replaced by versioned rules and one drive workflow |
| X-08 | p15 outcome | Each college's data isolation is demonstrable |

### 2.5 Open questions raised by the traceability pass

- **O-01 \[OPEN\]** The PDF never defines **Observed**. **\[ASSUMPTION\]** Observed = a skill signal detected by static analysis or an integration (e.g. a language used in a repo) but not yet linked to a specific accepted evidence item. The team must agree this and write it down.
- **O-02 \[OPEN\]** LeetCode ingestion method and terms. Options: student-pasted public profile with a profile-bio token check, or signed screenshot upload. **\[UNVERIFIED\]** whether an official API exists. Until checked, label LeetCode data **Observed/Claimed**, not Verified.
- **O-03 \[OPEN\]** Whether the officer approval in T-03 is per-student or per-rule-version-and-drive. I recommend the latter with per-student override.
- **O-04 \[OPEN\]** How the interview round in ST-05 is scored. The PDF gives marks for rounds 1–2 only. **\[REC\]** Rubric-based 0–10 per question with a human-readable rubric, labelled "AI-assisted, practice only".
- **O-05 \[OPEN\]** Whether the final demo may use pre-loaded data. The blueprint says label it. Confirm with organizers.

---

## 3. Novelty thesis: skeptical review (pre-code check 3)

### 3.1 What we will not claim

None of these may appear as a novelty claim in the deck or Q&A: AI viva; AI coding interview; campus placement portal; resume generation; GitHub analysis; "first" anything; "detects AI-written code"; "commit history proves authorship"; "blockchain trust"; a single accuracy number. **\[FACT\]** The master blueprint already agrees. Vendor comparisons must be limited to publicly documented features. Nobody on the team has tested the competitors, so no absence claims.

### 3.2 Candidate differentiators, ranked by how well they survive attack

| Rank | Mechanism | Strongest objection | What survives | Test that would change my mind |
| --- | --- | --- | --- | --- |
| 1 | **Eligibility what-if + fairness simulation** | "It's just a rules preview." It could be used to tune rules until the 0.80 ratio passes. | Campus-specific, deterministic, cheap to build, easy to demo, and directly serves BR-08/BR-14/AD-07/AD-10. Add governance: every simulation is logged, and publishing a rule version needs a stated reason | Two TPOs try it. Do they find a rule effect they did not expect, in under 10 minutes? |
| 2 | **Evidence-to-decision chain** | "This is integration, not invention." It only exists if skill-based rules actually consume verified skills. | A real click-through from a drive decision to the rule version, the skill state, the evidence item and the exact commit line. No competitor claim is needed, since it is a product-level hypothesis | Demo test: from any eligibility or match reason, reach the source artifact in ≤4 clicks, every time |
| 3 | **Multi-modal proof pathway** | "It becomes an upload form plus a faculty click." It is only as fair as the rubric parity between a repo and a lab artifact | Equity link to the PDF's own p13 figures (CS/IT vs polytechnic employability, as the PDF states them; **\[UNVERIFIED\]** by me). Must be demonstrated end-to-end with one non-repo case | Same rubric dimensions applied to one repo and one hardware/lab artifact; two reviewers agree the levels are comparable |
| 4 | **Live Mutation Probe** | Highest risk: sandbox security, fragile harness generation, live-demo failure, and timed live editing can falsely fail genuine authors. Vendors already run modify-code and repo-based assessments | The *narrow* version: a question anchored to a validated code span, then a pre-authored edge-case test on an extracted pure function in an isolated runner, with fail-closed behaviour and a human fallback | Genuine-author false-failure rate on the benchmark (§F). If above the stop rule, demote to text viva plus faculty review |
| 5 | **Freshness-aware credential** | Expiry and status are standard features of Open Badges / VC. **\[UNVERIFIED\]** | Table stakes executed properly. The product contribution is the *policy* (expiry tied to evidence age, re-verify prompts) | Not a headline; do not spend pitch time here |

### 3.3 \[REC\] How to position

- **Headline:** a traceable chain from student evidence to a versioned campus decision, built so that no AI output can change status or candidacy.
- **Proof points in order:** the chain click-through, then the what-if/fairness simulator, then the Mutation Probe as the live technical moment, then the non-repo path.
- **If the Mutation Probe fails on stage,** failing closed ("Sandbox timeout — skill not verified") is a feature to show, not an embarrassment. Plan the script around that.
- **Do not call the product agentic** in the sense of autonomous. The PDF title says agentic, so show visible agent runs (plan, tool calls, proposal) but with bounded authority (§C).

---

## 4. Rules I am holding to (pre-code checks 4–8)

| # | Rule | Where enforced |
| --- | --- | --- |
| 4 | Deterministic rules and AI suggestions are separate services. No model writes skill status or rejects a candidate | ADR-03, schema grants (§D), API (§E) |
| 5 | No LLM fine-tuning for the hackathon. Build a consented, versioned evaluation corpus first; revisit only after a held-out gain over prompting/RAG + validation | §F |
| 6 | Never execute full student repositories. Only extracted modules in a separate disposable runner; otherwise viva + human review | ADR-05, threat model (§C) |
| 7 | Repo contents, READMEs, comments, commit messages, JDs and emails are untrusted input: allowlisted tools, strict schemas, no model write credentials, independent evidence validation | ADR-04, threat model (§C) |
| 8 | Build P0 first, then narrow real slices of every mandatory requirement. Synthetic, cached and demo data are visibly marked | §H, §I |

*Continued: Parts 5–10 cover deliverables B through I.*

---

## 5. Deliverable B: Role-based user journeys and page map

### 5.1 Roles

| Role | Scope | Notes |
| --- | --- | --- |
| Student | Own data in one tenant | Owns profile and consents. Never sees other students' data |
| Faculty mentor | Assigned students' non-repo evidence | Can attest and review. Cannot change eligibility |
| TPO officer (department / college) | One tenant; department-scoped rows where configured | Approves candidacy-affecting proposals. Configures rules. Sees reports (M-20) |
| University admin | Aggregates across member colleges only | No row-level student data by default (T-04) |
| Recruiter | Only students who consented to sharing, only for officer-approved drives/roles | Access is an approval record that is scoped and expiring (M-17) |
| Platform admin | Operations only | No access to student content; break-glass access is logged and time-boxed |

### 5.2 Journeys (each maps to PDF IDs and to P0/P1)

| ID | Journey | Steps | Covers | Tier |
| --- | --- | --- | --- | --- |
| J1 | Student: evidence to passport | Sign in → age check and notice → grant consent per purpose → connect GitHub (select repos) or upload non-repo evidence → see skills as Claimed/Observed/Evidence-linked → open Verification Arena → defence + probe (or mentor path) → skill becomes Verified or stays with a reason → passport and one-click resume | BR-01–04, BR-15, ST-01–03, ST-08 | P0 |
| J2 | Student: target to retake | Pick target role → see best-fit companies with reason codes and gaps → mock drive (30 aptitude, 2 coding × 10, role interview) → report → learning path → submit evidence-producing task → retake unlocked | BR-06, ST-04–06 | P0 slice, P1 full |
| J3 | Student: drives and appeals | See drives → eligibility with failed rule → appeal → see outcome. Revoke GitHub; see why each score was given | ST-07, ST-08 | P0 |
| J4 | Mentor: attestation | Open assigned artifact → review against rubric → attest with scope and date → skill moves per state machine | BR-03, BR-15 | P0 |
| J5 | TPO: rules to publication | Import roster CSV → draft rule version → what-if preview (who flips, cohort impact ratio) → record rationale → publish version → approve drive eligibility list → handle overrides and appeals | BR-08, BR-11, AD-07, AD-09 | P0 |
| J6 | TPO: gaps and interventions | Cohort heatmap → JD-derived demand alert (with source, date, sample size) → create intervention → later before/after view | BR-05, BR-07, AD-01–03 | P0 slice |
| J7 | TPO and recruiter: drive workflow | Onboard company → bulk invitation → inbound email parsed to a proposal → clash check → officer confirms → recruiter access approved → search by verified skill → Evidence Card → shortlist → interview → offer | BR-09, BR-10, BR-19, AD-05, 06, 08 | P0 card, P1 rest |
| J8 | TPO: governance | Fairness review queue → audit explorer → six-KPI view → accreditation export | BR-14, 16, 18, AD-10, 11 | P1 |
| J9 | University admin | Select member college → aggregate-only dashboard → no student rows | BR-17b, AD-12 | P1 |

### 5.3 Page map

| Route | Page | Role | Key components |
| --- | --- | --- | --- |
| /student | Home / readiness | Student | Next best action, consent status |
| /student/profile | Profile and academics | Student | One-click resume button |
| /student/evidence | Evidence library and imports | Student | Repo picker, upload, import status, revoke |
| /student/skills | Skill graph | Student | State badge, evidence panel, expiry date, ordinal confidence |
| /student/verify/:skillId | Verification Arena | Student | Anchored question, probe editor, result with rubric |
| /student/passport | Passport and credentials | Student | Share toggle, verifier link |
| /student/targets | Target roles and companies | Student | Reason-coded fit, gap list |
| /student/mock | Mock drive | Student | Three rounds, timer, per-student set |
| /student/report | Personal report and learning path | Student | Score per round, weak topics, marks lost, tasks |
| /student/drives | Drives and eligibility | Student | Rule-level reason, appeal form |
| /student/privacy | Privacy and consent | Student | Per-purpose toggles, data requests, plain-language score explanations |
| /mentor/queue | Attestation queue | Mentor | Evidence viewer, rubric form |
| /tpo | Overview | Officer | Approval queue count, six KPIs |
| /tpo/cohorts | Cohort heatmap and reports | Officer | Heatmap, per-round mock scores, before/after, PDF/XLSX export |
| /tpo/demand | Industry demand profiler | Officer | JD sources, date range, sample size |
| /tpo/forecast | Support-need review | Officer | Scenario range (labelled not validated), review queue |
| /tpo/mock-setup | Question bank and role questions | Officer | Bank editor, AI-drafted interview questions to review |
| /tpo/companies | Companies and bulk mail | Officer | Template, send, delivery/reply status |
| /tpo/drives | Drive calendar and allocations | Officer | Single calendar, clash banner, proposal inbox |
| /tpo/rules | Eligibility rules | Officer | Version list, what-if simulator, publish with rationale |
| /tpo/approvals | Approval queue | Officer | Agent proposals with inputs and diffs |
| /tpo/recruiters | Recruiter access | Officer | Approve, scope, expire |
| /tpo/fairness | Fairness review | Officer | Selection rate, impact ratio, group sizes, suppression |
| /tpo/reports | Accreditation exports | Officer | Configurable export, dedup report |
| /tpo/audit | Audit explorer | Officer | Filters, integrity check |
| /tpo/settings | Roles and tenant settings | Officer | Hierarchy, retention, keys reference |
| /recruiter/roles | Role and JD setup | Recruiter | Required skills and levels |
| /recruiter/search | Candidate search | Recruiter | Reason codes, no score-only rows |
| /recruiter/candidate/:id | Evidence Card | Recruiter | See §5.4 |
| /recruiter/pipeline | Shortlist, interviews, offers | Recruiter | Stage board, feedback |
| /university | Aggregate dashboard | University admin | Aggregates only |
| /verify/:credentialId | Public credential verifier | Anyone | Issuer, scope, dates, status; no student PII beyond what the student shared |

**Global component \[REC\]:** a persistent `DEMO / SYNTHETIC / CACHED` banner driven by an `is_synthetic` or `source` flag on every record shown. It is never hidden in demo mode.

### 5.4 Evidence Card (recruiter, one screen)

Shows only consented fields. Contents: target role and reason-coded match; each matched skill with state, method, rubric version, date, expiry and ordinal confidence; one or two exact anchors (repo, commit SHA, file, lines) or mentor artifact; probe result with its limits; credential verifier link; resume button; "request re-probe" (needs student consent). There is **no** single hireability score.

---

## 6. Deliverable C: Architecture decisions and threat model

### 6.1 Trust boundaries

```text
TB1  Browser  ───►  API (authn, tenant context, RBAC, consent check)
TB2  API      ───►  PostgreSQL (RLS; app role cannot bypass)
TB3  API      ───►  Workers (ingestion, parsing, JD parsing, reports)
TB4  Workers  ───►  Model gateway (untrusted text in, schema-checked JSON out; no DB write creds)
TB5  Workers  ───►  Probe runner (separate host/VM; no secrets; no egress; disposable)
TB6  Platform ───►  External: GitHub, mail provider, LLM provider
```

Everything crossing TB3–TB6 from user or third-party content (repos, READMEs, comments, commit messages, JDs, emails, uploads) is **untrusted data**, never instructions.

### 6.2 Architecture decision records (all status: Proposed)

| ADR | Decision | Alternatives rejected | Why | Consequence / risk |
| --- | --- | --- | --- | --- |
| 01 | Modular monolith plus isolated async workers; the probe runner is a separate service | Microservices; serverless-only | Four-person team; the only boundary that must be hard is code execution | Module boundaries must be enforced by lint rules or the monolith will blur |
| 02 | Tenant = college. Every request runs in a transaction that sets tenant, role and user context (`SET LOCAL`). The app DB role has `NOBYPASSRLS`. Managed auth for identity; authorization is ours | Per-tenant databases (kept as the *siloed storage option* for M-07); app-layer filtering only | PDF requires DB-level enforcement. Transaction-scoped settings avoid context leaking across pooled connections | Needs migration tests and a pooler configuration that preserves transaction scope **\[ASSUMPTION\]** |
| 03 | **Propose / approve pattern.** AI components can only insert rows into `proposals`. A deterministic service validates a proposal, and an officer or student action applies it. AI services hold no write grants on `student_skills`, `eligibility_decisions`, `applications`, `offers` | LLM with direct tool access to domain tables | Makes BR-11 and AD-09 structural rather than procedural | More tables and UI (approval queue). Worth it |
| 04 | Prompt-injection posture: allowlisted tools per agent, strict JSON schemas, minimal personal data in prompts, output re-validated by independent resolvers (anchor resolver, taxonomy lookup, calendar rules). Delimiters are hygiene, not defence | Trusting delimiters or comment stripping | The blueprint already says delimiters alone are insufficient | Residual risk: a model can still produce a *plausible but wrong* proposal. Mitigation is human review of consequential ones |
| 05 | Code execution only for (a) pre-authored probes on extracted pure functions and (b) Machine Test with fixed harnesses. Separate host or microVM-class isolation for pilot; rootless container is a **demo-only** baseline. Fail closed | Judge0 as shipped; booting repos | Untrusted code risk is the project's highest severity | If we cannot show the boundary tests pass, disable executable probes and use viva plus faculty review |
| 06 | Skill lifecycle is a database state machine: allowed transitions table, a check that Verified needs an accepted evidence item and a completed verification record, and expiry via a scheduled job | State kept in application code only | Invariants survive bugs in app code | Triggers need tests; migrations must preserve them |
| 07 | Credentials: **internal signed evidence passport first**, plus an export shaped like an Open Badges 3.0 / VC credential. Claim "conformant" only after a validator and signature check pass | Full OB3/VC issuance on day one; blockchain | PDF says *support* OB3/VC (BR-04), so a visible export slice is required | Must not label as conformant before testing. **\[UNVERIFIED\]** exact OB3 profile requirements |
| 08 | Audit: append-only table, hash chain, insert-only grants, verification job. Reads of student data are logged (M-06) | Application logs only | BR-16 | Hash chain proves tampering *after the fact*; it does not prevent a DB superuser. Say so |
| 09 | Taxonomy: internal canonical skill IDs, plus a mapping table to ESCO / O\*NET / NSQF holding external code, source version, method, reviewer, confidence | Using one external taxonomy as the primary key | Mappings are not one-to-one (blueprint §4.2A) | Mappings need human review before they influence decisions |
| 10 | Model gateway with provider abstraction. **No fine-tuning.** No raw student code is sent to any provider without the student's per-purpose consent and a provider-terms check | Direct provider calls scattered in code | Swappable models; central redaction and logging | Provider terms and data-residency are **\[OPEN\]** |
| 11 | Eligibility engine is a pure function: `(rule_version, input_snapshot) → decision + per-rule reasons`. Rules are versioned JSON, immutable once published. No LLM involvement | Rules as free-text; ad hoc SQL | Reproducibility and appeals (BR-08, AD-07) | Rule DSL must stay small: academics, backlogs, skill-state thresholds, policy limits |
| 12 | Explanations are generated from **templated reason codes** first; an LLM may only paraphrase for readability and the paraphrase is stored beside the codes | LLM-written explanations as the source of truth | Keeps explanations auditable | Slightly stiffer wording |
| 13 | All demo, seed and cached records carry `source` in {`real`, `synthetic`, `cached`}. Real KPI views exclude non-real rows | Separate demo database only | A single schema keeps demo code paths honest | Reports must filter on `source`; tested |

### 6.3 Agent authority matrix

| Agent (blueprint §5.2) | May read | May propose | Cannot |
| --- | --- | --- | --- |
| Repository Profiling | Approved evidence for consented repos | Candidate skills with anchors | Mark Verified, fetch beyond approved repos, run code |
| Grounded Defence | Selected evidence span | Questions, rubric-based scoring suggestions | Write skill state, call the network, invoke anything but the probe runner |
| Industry Skill-Gap | Permitted JDs with source metadata | Demand items, cohort gap alerts | Contact companies, change cohort data |
| Personal Learning Path | Student's gaps and consented evidence | Tasks with objective acceptance tests | Award badges or credit |
| Placement Coordination | Inbound schedule data, calendar | Slot and message drafts | Send notifications or allocate without officer confirmation |
| Predictive Analytics | Aggregates and consented features | Scenario ranges, review-queue entries | Label a student, store a risk status (T-02) |

### 6.4 Threat model (first cut)

| ID | Threat | Asset | Mitigations | Residual risk | Test |
| --- | --- | --- | --- | --- | --- |
| TM-01 | Prompt injection in README, comments or commit messages | Skill state, question integrity | ADR-03/04; anchor and rubric resolvers; no write creds | Plausible-but-wrong proposal | Corpus of injection fixtures; assert no state change and flagged output |
| TM-02 | Injection via JD or inbound email causing a slot, notification or mail | Calendar, outbound mail | Agent proposes only; officer confirms; sender allowlist; rate limits | Social engineering of the officer | Hostile-email fixtures; assert zero sends without confirmation |
| TM-03 | Probe escape, resource abuse, egress, metadata access | Host, secrets, other tenants | ADR-05: no secrets, no egress, limits, unprivileged, ephemeral | Unknown isolation bug | Independent test pack: fork bomb, huge output, symlink, path traversal, DNS/egress, metadata IP |
| TM-04 | Malicious archive or symlink during static import | Worker host | Static parsing only; no install or hooks; safe extraction; size and file-count caps | Parser bugs | Fixture archives; fuzz parser |
| TM-05 | GitHub token theft or over-scope | Student repos | Selected-repo read-only; server-side encrypted tokens; never in prompts or browser; revoke path | Provider-side compromise | Scope assertion test; revoke test |
| TM-06 | Cross-tenant leakage via API, search, exports, jobs, cache, logs | All tenant data | RLS; tenant in job payloads; tenant-prefixed cache keys; log redaction | Misconfigured new table | CI test that fails if any tenant table lacks a policy; cross-tenant negative suite |
| TM-07 | RLS context bleed through connection pooling | Tenant data | Transaction-scoped context; no session-level settings | Pooler change | Concurrency test with alternating tenants |
| TM-08 | Hallucinated or stale code anchors | Trust in evidence | Resolve anchors against exact commit SHA and line range before display | None if enforced | Anchor resolution must be 100% on displayed items |
| TM-09 | Recruiter reads non-consented or out-of-scope students | Student privacy | Consent check in the query plus RLS; approval records scoped and expiring; read-access audit | Screenshotting | Negative tests per consent state |
| TM-10 | Audit tampering | Accountability | Insert-only grants; hash chain; periodic verification job | DB superuser | Mutation attempts fail; tamper detected |
| TM-11 | Credential forgery or signing-key compromise | Credential trust | Key outside DB; rotation; status check; short test-signing key in demo | Compromise | Verify-fail on altered payload; revoked status honoured |
| TM-12 | Personal data in logs, prompts or error trackers | Privacy | Redaction; prompt data minimisation; no raw source in logs | Developer mistakes | Log scan test |
| TM-13 | Minor's data processed incorrectly | Under-18 students | Age gate; no behavioural monitoring; restricted purposes; legal review before real pilot. **\[UNVERIFIED\]** exact legal steps | Legal interpretation | Age-gate tests; feature flags assert monitoring off |
| TM-14 | Small-cell re-identification in fairness and cohort views | Group privacy | Minimum group size; suppression; no individual drill-down from fairness view | Inference by differencing | Suppression unit tests |
| TM-15 | Someone else answers the student's defence | Verification validity | Authenticated session; no proctoring claim; mentor path; state "inconclusive" rather than accuse | Real, unsolved | Document as a limitation. Do not claim cheat detection |
| TM-16 | Bulk-mail abuse or spam | Reputation, recruiter personal data | Sandbox sender in demo; per-tenant rate limit; recruiter contact data purpose-limited | Misuse by a compromised officer | Rate-limit test; unsubscribe record |
| TM-17 | Supply-chain compromise in runner images or harness dependencies | Runner | Pinned images and hashes; minimal base; scan | Zero-day | Image digest check at start |
| TM-18 | LLM cost or availability exhaustion | Demo reliability | Per-tenant quota; pre-generated, validated question set; cached fallback labelled as cached | Provider outage | Fallback drill |

---

## 7. Deliverable D: Normalized database schema and RLS test plan

**\[REC\]** PostgreSQL 16+. Every tenant-owned table has `org_id uuid NOT NULL`, `source` in (`real`,`synthetic`,`cached`), `created_at`, and an RLS policy. Names below are logical; column lists show what matters for invariants, not every field.

### 7.1 Identity and tenancy

| Table | Key columns | Notable constraints |
| --- | --- | --- |
| organizations | id, parent\_id, kind (university/college), name, config jsonb, key\_ref, rate\_limit\_config | tenant = college. `key_ref` is a pointer to an external key, never key material (M-07) |
| departments | id, org\_id, name |  |
| users | id, auth\_subject, email | No tenant column; tenancy comes from memberships |
| memberships | id, user\_id, org\_id, department\_id?, role (student, mentor, officer, university\_admin, recruiter, platform\_admin), status | Unique (user, org, department, role). This table drives every policy |
| students | id, org\_id, user\_id, department\_id, enrollment\_no, graduating\_year, program\_level, is\_minor, age\_verified\_at | Store an age band or minor flag, not a full date of birth, unless required **\[OPEN\]** |
| academic\_records | student\_id, cgpa, active\_backlogs, as\_of, source\_ref | Append new rows; keep history for decision snapshots |
| student\_group\_attributes | student\_id, gender, category, consent\_grant\_id | **Separate restricted table (T-07).** Readable only by the fairness job role. No joins from product queries |

### 7.2 Consent and rights

| Table | Key columns | Notable constraints |
| --- | --- | --- |
| consent\_purposes | code, description, version, requires\_guardian\_for\_minor | Purposes: placement operations, repo verification, recruiter sharing, analytics, model improvement (opt-in, separate) |
| consent\_grants | id, student\_id, purpose, notice\_version, scope jsonb, granted\_at, revoked\_at | Revocation is a new state, never a delete. Every ingestion and share path checks an active grant |
| guardian\_consents | student\_id, verification\_ref, status, verified\_at | Store outcome and reference, not source documents **\[OPEN\]** |
| data\_requests | id, student\_id, type (access/correction/erasure/grievance), status, due\_at, completed\_at, exception\_note |  |

### 7.3 Evidence and skills (Verified Skill Graph)

| Table | Key columns | Notable constraints |
| --- | --- | --- |
| connected\_accounts | id, student\_id, provider, installation\_ref, token\_ref, scope, status | Token held server-side and encrypted; never returned by any API |
| repositories | id, student\_id, provider\_repo\_id, url, license, consent\_grant\_id | Only repos the student selected |
| repo\_snapshots | id, repository\_id, commit\_sha, parser\_version, imported\_at | Anchors always point at a snapshot, so they are stable |
| projects | id, student\_id, title, team\_context (solo/team), role\_note | Team context recorded because a shared repo does not show individual contribution |
| evidence\_items | id, student\_id, project\_id?, kind (code\_span, commit, test\_result, lab, competition, certificate, mentor\_attestation, external\_profile), repo\_snapshot\_id?, path?, line\_start?, line\_end?, content\_hash, object\_key?, status (submitted, accepted, rejected, withdrawn, expired), accepted\_by?, accepted\_at?, valid\_until | Check: code\_span rows need snapshot, path and lines. `accepted_*` only set via the acceptance service. Evidence from external profiles (e.g. LeetCode, O-02) is `external_profile` and can support Observed only until a verification path completes |
| attestations | id, evidence\_id, mentor\_membership\_id, rubric\_version\_id, scope\_text, valid\_until | Mentor must be assigned to that student |
| skills | id, canonical\_name, description, level\_definitions jsonb, taxonomy\_version |  |
| skill\_mappings | skill\_id, framework (ESCO/ONET/NSQF), external\_code, framework\_version, method, reviewer, confidence\_note | Unique (skill, framework, external\_code). Reviewer required before a mapping may be used in a rule |
| student\_skills | id, student\_id, skill\_id, state (claimed, observed, evidence\_linked, verified, expired), state\_since, valid\_until, evidence\_strength (low/medium/high), last\_verification\_id | **CHECK:** state = verified requires `last_verification_id` not null and `valid_until` not null. A trigger additionally requires at least one accepted `skill_evidence` row and a verification with a qualifying outcome |
| skill\_state\_transitions | from\_state, to\_state | Seed table of allowed transitions. A trigger rejects anything not listed |
| skill\_state\_events | id, student\_skill\_id, from\_state, to\_state, reason\_code, actor\_type, actor\_id, verification\_id? | Append-only |
| skill\_evidence | student\_skill\_id, evidence\_id, role (supports, context) | Unique pair |

### 7.4 Verification

| Table | Key columns | Notable constraints |
| --- | --- | --- |
| rubric\_versions | id, skill\_id, version\_no, dimensions jsonb, levels jsonb, published\_at | Immutable once published |
| verification\_sessions | id, student\_skill\_id, rubric\_version\_id, modality (defence, probe, mentor, test\_score), started\_at, completed\_at, outcome | `outcome` is an assessment result: demonstrated\_at\_rubric\_level, demonstrated\_below\_rubric, inconclusive\_review\_required, evidence\_linked\_not\_assessed. The blueprint's `NO_EVIDENCE_FOUND` and `CLAIMED_ONLY` describe skill-level conditions, so they live in `student_skills`, not here |
| verification\_questions | id, session\_id, anchor\_evidence\_id, text, model\_version, prompt\_version, anchor\_validated\_at, answerability\_reviewed | A question cannot be shown unless `anchor_validated_at` is set |
| verification\_responses | id, question\_id, response\_text, submitted\_at | Transcript stored only under consent |
| probe\_definitions | id, skill\_id, language, unit\_signature, test\_suite\_version, harness\_hash, reviewed\_by | Authored and reviewed by humans, not generated at run time **\[REC\]** |
| probe\_runs | id, session\_id, probe\_definition\_id, runner\_image\_digest, exit\_status, tests\_passed, tests\_total, duration\_ms, output\_hash | Result written by the runner-result ingestion service only |
| human\_reviews | id, session\_id, reviewer\_membership\_id, ratings jsonb, disposition, appeal\_ref? | Second reviewer allowed; disagreements preserved |
| credentials | id, student\_skill\_id, payload jsonb, proof, valid\_from, valid\_until, status, revoked\_at | Payload contains scope, rubric version, evidence references, dates. No hidden score |

### 7.5 Demand, eligibility, drives and outcomes

| Table | Key columns | Notable constraints |
| --- | --- | --- |
| companies | id, org\_id, name, contact\_ref | Contact personal data purpose-limited |
| job\_roles, job\_role\_skills | role\_id, skill\_id, min\_level |  |
| jd\_documents | id, source\_type, source\_url?, permission\_note, retrieved\_at, text\_hash, dedupe\_key, review\_status | Unique dedupe\_key per tenant. Raw text hash retained |
| jd\_skill\_extractions | jd\_id, skill\_id, model\_version, reviewed\_by? | Insights without review are labelled "unreviewed" |
| eligibility\_rule\_sets / eligibility\_rule\_versions | rule\_set\_id, version\_no, rules jsonb, rationale, published\_by, published\_at | Versions immutable. Publishing requires `rationale` |
| drives, drive\_rounds | drive\_id, kind, starts\_at, ends\_at, resource | **Exclusion constraint** on (resource, time range) so clashes cannot be inserted |
| eligibility\_decisions | id, drive\_id, student\_id, rule\_version\_id, input\_snapshot jsonb, input\_hash, result, reasons jsonb, status (provisional, published, overridden) | Student can only see rows with status published or overridden (T-03) |
| eligibility\_overrides, appeals | decision\_id, actor, reason, status, resolution |  |
| recruiter\_access\_grants | id, recruiter\_membership\_id, drive\_id?, role\_id?, scope jsonb, approved\_by, expires\_at | Required for any recruiter read (M-17) |
| student\_shares | student\_id, grant\_id, skills shared, consent\_grant\_id | Student-controlled |
| applications, shortlists, interviews, offers | status history rows; offers hold ctc\_inr | Status history append-only |
| student\_outcomes | student\_id, outcome\_type (placed, higher\_studies, other), institution\_or\_company, evidence\_ref, ctc\_inr?, as\_of | Needed for AD-11 (M-18). Dedup by student for placement counts |
| interventions | id, scope jsonb, type, planned\_for, created\_by | Needed for BR-07 (M-01) |
| mock\_attempts, mock\_round\_results, question\_bank\_items, learning\_paths, learning\_tasks | per-student seed, round scores, acceptance test reference | Aptitude set sampled by seed (M-12); sampled item ids stored for audit |
| communications, inbound\_messages | status events; raw body, sender, parse\_status | Raw inbound stored as inert data |

### 7.6 AI, audit and fairness

| Table | Key columns | Notable constraints |
| --- | --- | --- |
| agent\_runs | id, agent, org\_id, input\_refs, model\_version, prompt\_version, status |  |
| proposals | id, agent\_run\_id, kind, payload jsonb, validation\_result jsonb, status (pending, approved, rejected, applied, expired), decided\_by, decided\_at | **Only table AI roles can insert into** |
| model\_calls | id, agent\_run\_id, redacted\_request\_hash, response\_hash, tokens, latency | No raw source or personal data |
| audit\_events | id, seq, org\_id, actor\_type, actor\_id, action, object\_type, object\_id, metadata, prev\_hash, hash, at | Insert-only grant; hash chain; includes reads of student data |
| fairness\_reviews | id, drive\_id, outcome\_measured, dimension, window, group\_counts jsonb, min\_group\_size, suppressed\_groups, min\_impact\_ratio, flagged, status, reviewed\_by, notes | Counts below the minimum are suppressed before storage |
| fairness\_simulations | id, candidate\_rule\_version, summary jsonb, created\_by | Logged so what-if use is reviewable |

### 7.7 Database roles

| Role | Grants |
| --- | --- |
| app\_api | CRUD on domain tables under RLS; `NOBYPASSRLS`; no DDL; insert-only on audit\_events; no update on student\_skills.state except through the transition function |
| ai\_worker | SELECT on narrowly scoped views of evidence; INSERT on proposals, agent\_runs, model\_calls only |
| runner\_result\_ingest | INSERT on probe\_runs only |
| fairness\_job | SELECT on student\_group\_attributes and decision tables; INSERT on fairness\_reviews |
| report\_job | SELECT on reporting views |
| migrator | DDL only; not used at run time |

### 7.8 RLS test plan (run in CI, fail the build on any miss)

| ID | Test | Expected |
| --- | --- | --- |
| RLS-01 | Catalogue scan: every table with `org_id` has RLS enabled and forced, with at least one policy | Build fails if any table is missing |
| RLS-02 | Tenant A student queries each tenant table for tenant B rows | Zero rows |
| RLS-03 | Tenant A officer attempts INSERT/UPDATE/DELETE with tenant B `org_id` | Rejected |
| RLS-04 | Alternate tenant contexts on the same pooled connection in a tight loop (50 concurrent) | No cross-contamination (TM-07) |
| RLS-05 | App role attempts `SET row_security = off` or `SET ROLE` to a bypass role | Fails; no bypass role exists |
| RLS-06 | University admin queries student-level tables for a member college | Zero rows; aggregate views succeed |
| RLS-07 | Student A reads Student B in same tenant | Zero rows |
| RLS-08 | Recruiter query with no grant, expired grant, wrong drive, or student who has not shared | Zero rows in each case |
| RLS-09 | Student reads own eligibility decision with status `provisional` | Not visible until published |
| RLS-10 | Revoke repo consent, then run ingestion | Job refuses; audit event written; cached artifacts queued for deletion |
| RLS-11 | `ai_worker` attempts UPDATE on `student_skills`, `eligibility_decisions`, `applications`, `offers` | Permission denied |
| RLS-12 | Any role attempts UPDATE/DELETE on `audit_events` or `skill_state_events` | Fails. Tamper test: alter one row as superuser; verification job reports a break |
| RLS-13 | INSERT `student_skills` with state `verified` and no verification or evidence | Rejected by CHECK/trigger |
| RLS-14 | Direct SQL transition not in the allowed-transitions table | Rejected |
| RLS-15 | Non-fairness roles SELECT `student_group_attributes` | Permission denied |
| RLS-16 | Export, cache, search index and job-queue payloads for tenant A inspected after a tenant B request | No tenant A identifiers present |
| RLS-17 | Overlapping `drive_rounds` for the same resource | Exclusion constraint rejects |
| RLS-18 | Real-KPI views with synthetic rows present | Synthetic rows excluded |

---

## 8. Deliverable E: API contracts

### 8.1 Conventions

- Base path `/v1`. JSON over HTTPS. Request and response schemas are defined once (Zod/TypeBox) and used to generate OpenAPI.
- **Tenant is derived from the authenticated membership, never from a client-supplied field.** A user with several memberships selects one via a signed session claim.
- Mutating `POST` endpoints take an `Idempotency-Key` header. Replays return the original result.
- Errors use one shape: `{ "type", "title", "status", "detail", "code", "request_id" }`. Stable `code` values include `CONSENT_REQUIRED`, `EVIDENCE_REQUIRED`, `ANCHOR_INVALID`, `APPROVAL_REQUIRED`, `CLASH`, `FORBIDDEN_TENANT`, `RATE_LIMITED`.
- Every endpoint writes an audit event. Reads of student data by anyone other than the student write one too (M-06).
- Responses that contain AI-originated text carry `generated_by: { model_version, prompt_version }` and `is_estimate: true` where relevant.

### 8.2 Endpoints

| Area | Method and path | Roles | Notes |
| --- | --- | --- | --- |
| Profile | GET /students/me/profile | student |  |
| Profile | POST /students/me/resume | student | Generates PDF from profile; returns file link. No upload endpoint exists for resumes |
| Consent | POST /consents; POST /consents/{id}/revoke | student | Per purpose. Revoke triggers disconnect and deletion workflow |
| Rights | POST /data-requests; GET /data-requests/{id} | student |  |
| GitHub | POST /integrations/github/install-callback; GET /integrations/github/repos; POST /repositories/import | student | Selected repos only; read-only scope asserted |
| Evidence | POST /evidence (non-repo upload); GET /evidence/{id}; POST /evidence/{id}/withdraw | student | Evidence acceptance is a separate service call |
| Mentor | GET /mentor/queue; POST /evidence/{id}/attest | mentor | Only assigned students |
| Skills | GET /skills; GET /students/me/skill-graph | student | Returns state, evidence, expiry, ordinal confidence, reasons |
| Verification | POST /verification-sessions; POST /verification-sessions/{id}/answers; POST /verification-sessions/{id}/probe-submissions | student | Probe submission queues a runner job. Result arrives via the ingest service |
| Credentials | GET /credentials/{id}; POST /credentials/{id}/share; GET /verify/{id} (public) | student; anyone | Public verifier exposes only student-shared fields |
| Targets | GET /students/me/targets | student | Reason-coded, no hidden score |
| Mock drive | POST /mock-attempts; POST /mock-attempts/{id}/rounds/{n}/submit; GET /mock-attempts/{id}/report | student | Machine-test submissions use the shared runner |
| Learning | GET /students/me/learning-path; POST /learning-tasks/{id}/evidence | student | Submitting evidence creates a pending evidence item; it does not change skill state |
| Drives (student) | GET /students/me/drives; POST /eligibility-decisions/{id}/appeal | student | Only published decisions |
| Roster | POST /org/students/import | officer | CSV with validation report |
| Rules | POST /eligibility-rule-sets; POST /eligibility-rule-sets/{id}/versions; POST /eligibility-rule-versions/{id}/simulate; POST /eligibility-rule-versions/{id}/publish | officer | `simulate` writes a fairness\_simulations row. `publish` requires `rationale` |
| Eligibility | POST /drives/{id}/evaluate-eligibility; POST /drives/{id}/eligibility/publish; POST /eligibility-decisions/{id}/override | officer | Evaluate creates **provisional** decisions only |
| Proposals | GET /proposals; POST /proposals/{id}/approve; POST /proposals/{id}/reject | officer | Approval applies the proposal through a deterministic service |
| Drives | POST /drives; GET /calendar; POST /drives/{id}/allocations/propose; POST /allocations/{id}/approve | officer | Clash returns `CLASH` with the conflicting item |
| Inbound | POST /inbound/email (signed webhook) | system | Stores raw body inert; creates an agent run and at most a proposal |
| Mail | POST /companies/bulk-invite | officer | Sandbox sender in demo. Per-tenant rate limit |
| Recruiter access | POST /recruiter-access-grants | officer | Scope and expiry required |
| Roles/JDs | POST /job-roles; POST /job-roles/{id}/parse | recruiter, officer | Parse creates proposals for skill mapping |
| Matching | GET /job-roles/{id}/candidates | recruiter, officer | Verified-skill search; each row has reason codes. Filters by grants and shares |
| Pipeline | POST /applications; POST /shortlists; POST /interviews; POST /offers | recruiter, officer | Status history append-only |
| Analytics | GET /analytics/cohorts/{id}; GET /analytics/kpis; GET /analytics/fairness/{driveId} | officer, university (aggregate) | KPI definitions in §10.3 |
| Outcomes | POST /student-outcomes | officer | Supports AD-11 |
| Reports | POST /reports/accreditation; GET /reports/{id} | officer | Includes dedup summary and `source` filter |
| Audit | GET /audit-events; POST /audit/verify | officer | `verify` runs the chain check |

### 8.3 Sample contracts

**POST /consents**

```json
{
  "purpose": "repo_verification",
  "notice_version": "2026-11-draft-1",
  "scope": { "provider": "github", "repositories": ["<provider_repo_id>"] }
}
```

Response `201`: `{ "id", "purpose", "granted_at", "scope", "revoke_url" }`. Errors: `409 CONSENT_EXISTS`; `403 GUARDIAN_CONSENT_REQUIRED` for minors.

**POST /verification-sessions/{id}/probe-submissions**

```json
{ "probe_definition_id": "<uuid>", "submitted_unit": "<source text of the edited function only>" }
```

Response `202`: `{ "run_id", "status": "queued" }`. Final state is read from `GET /verification-sessions/{id}` and includes `tests_passed`, `tests_total`, `exit_status`, `runner_image_digest`. The endpoint never returns a skill state change. A state change occurs only when the deterministic rubric evaluator records a qualifying outcome. Errors: `422 ANCHOR_INVALID`; `403 CONSENT_REQUIRED`; `429 RATE_LIMITED`.

**POST /drives/{id}/evaluate-eligibility**

```json
{ "rule_version_id": "<uuid>", "as_of": "2026-12-01" }
```

Response `200`: `{ "drive_id", "rule_version_id", "status": "provisional", "decisions": [ { "student_ref", "result", "reasons": [ { "rule_id", "rule_text", "input", "threshold", "passed" } ], "input_hash" } ] }`. Reasons are produced by the engine, not by a model. Publishing is a separate call: `POST /drives/{id}/eligibility/publish`, which fails with `APPROVAL_REQUIRED` unless an officer holds the session.

**POST /proposals/{id}/approve**

```json
{ "note": "optional officer note" }
```

The server re-validates the proposal against current data, applies it through the owning deterministic service, and writes one audit event containing the proposal's inputs, the actor and the result. If validation now fails it returns `409 PROPOSAL_STALE` and applies nothing.

---

## 9. Deliverables F and G: Verification rubric, benchmark, and data rights

### 9.1 Deliverable F: Skill-state rules

**\[REC\]** Five states from PDF p14. Transitions are performed only by deterministic services (ADR-06).

| State | Entry condition | Triggered by | Exits |
| --- | --- | --- | --- |
| Claimed | Student declares the skill, no accepted evidence | Student action | → Observed, Evidence-linked |
| Observed | A signal exists from a consented source (e.g. language detected in an imported repo, an external profile statistic) but no accepted evidence item is linked to this skill **\[ASSUMPTION per O-01\]** | Ingestion service | → Evidence-linked, Claimed (if source withdrawn) |
| Evidence-linked | ≥1 accepted evidence item linked to this skill. Acceptance rules: the anchor resolves to a stored snapshot **or** a mentor accepted the artifact; the source is within the student's active consent | Acceptance service | → Verified, Claimed (if all evidence withdrawn) |
| Verified | Evidence-linked **and** a completed verification path with a qualifying outcome (see below) | Rubric evaluator or mentor attestation | → Expired |
| Expired | `valid_until` passed, **or** all qualifying evidence withdrawn | Scheduled job or withdrawal | → Evidence-linked, Verified (after re-verification) |

**Verification paths.** Which paths apply is set per skill family and recorded in the rubric version.

| Path | For | Required |
| --- | --- | --- |
| A. Repository | Software skills with a consented repo | Anchored defence **and** either a passed probe (if a reviewed harness exists) or a faculty review |
| B. Non-repository | Lab, hardware, competition, project work | Mentor attestation against the same rubric dimensions **plus** a recorded practical or oral demonstration |
| C. Assessed test | Skills covered by an authorised assessment | Score at or above the rubric threshold in a test the officer configured |

**Failure handling (the label "fail" does not exist on a skill).**

- *Demonstrated below rubric:* the skill stays Evidence-linked, with a plain-language reason and a link to learning tasks. Retry is allowed.
- *Inconclusive:* goes to a human review queue. The student sees "under review", not a negative result.
- *Sandbox or model failure:* no state change; the session is marked `evidence_linked_not_assessed` with the reason.
- **\[OPEN\]** Whether failed attempts are visible to recruiters. **\[REC\]** Recruiters see only current state, method and date. Attempt history is visible to the student and, for appeals, the officer.

**Freshness.** Default `valid_until` = verification date + 12 months, based on the PDF's p16 example, configurable per skill family and tenant. **\[ASSUMPTION\]** 12 months is not evidence-based for every skill.

**Evidence strength (ordinal, T-05).** Derived by fixed rules, shown as Low / Medium / High:

- *High:* two or more independent modalities passed (e.g. defence + probe, or mentor + test), evidence age under the freshness window.
- *Medium:* one modality passed, or two modalities with reviewer disagreement resolved.
- *Low:* one modality at the lower rubric level, or evidence older than half the freshness window.

These rules are a starting proposal. The benchmark may show that they do not track anything useful, in which case they should be removed rather than defended.

### 9.2 Rubric template

One rubric version per skill family. Four dimensions, each scored 0–3 with behavioural anchors written by faculty before any labelling.

| Dimension | 0 | 1 | 2 | 3 |
| --- | --- | --- | --- | --- |
| Comprehension of the cited work | Cannot describe what the cited span or artifact does | Describes surface actions only | Correctly describes behaviour and inputs/outputs | Also explains why it is structured this way |
| Reasoning about behaviour | Wrong prediction on the edge case | Partially right | Correct prediction with a reason | Correct, with additional failure modes identified |
| Design rationale | None | Generic statement | Names a real trade-off relevant to this work | Compares alternatives with constraints |
| Modification | No attempt or breaks other tests | Partially works | Passes the edge-case test | Passes and keeps the unit clean and tested |

**Excluded from scoring:** accent, speech fluency, typing speed, language of response, webcam or behavioural signals. Responses may be in English, Hindi or Marathi; support must be tested in the benchmark before being claimed **\[ASSUMPTION\]**.

**Qualifying-outcome rule (deterministic).** The model may *suggest* per-dimension scores with quoted evidence spans. The evaluator applies thresholds. A starting rule, flagged **\[ASSUMPTION, arbitrary until calibrated\]**: no dimension at 0, at least two dimensions at 2 or higher, and Modification ≥ 2 where a probe exists. Any model-vs-reviewer disagreement or a span that cannot be resolved produces `inconclusive_review_required`.

**Parity example (software vs hardware).** Same four dimensions, different artifact.

| Dimension | Software repo | EXTC / hardware lab |
| --- | --- | --- |
| Comprehension | Explain a cited async handler | Explain the cited sensor-interface schematic and firmware loop |
| Reasoning | Predict behaviour on empty input | Predict behaviour when the sensor returns out-of-range values |
| Rationale | Why this query or retry design | Why this pull-up value or sampling interval |
| Modification | Edit the function to pass a new test | Change a firmware parameter or propose a circuit change; mentor confirms against a rubric checklist |

**\[REC\]** Two reviewers must agree the levels are comparable before the demo claims "same rubric, different evidence".

### 9.3 Question validation gates

A question is shown only if all pass:

1. The anchor resolves to the stored snapshot, line range and content hash (TM-08).
2. The question text references only content inside the anchored span plus declared context.
3. A separate pass confirms answerability from that span; a human samples a fixed share of these.
4. No personal data, secrets or third-party licensed text beyond the span appear in the prompt or question.
5. The question is stored with model and prompt versions.

### 9.4 Benchmark design

**\[FACT\]** The master blueprint's targets: 10–20 permissioned repos and 30–60 probes for the engineering benchmark; 40–60 volunteers for an early pilot. **\[REC\]** Treat the hackathon benchmark as a **smoke test**, and report counts, not rates, when n is small. With 10 genuine authors one failure is 10%, so a percentage stop rule is not meaningful at that size.

**Corpus (versioned, consented, separate from raw code).** Skill/evidence anchors; questions with model and prompt versions; answerability review; responses (only with consent); rubric version; probe definition and test suite version; run results; two independent ratings where possible; disagreements; appeal and final disposition; context (language, framework, solo/team, evidence mode, accommodations).

**Splits.** By student and project, never by question rows. Forks and near-duplicates stay together. The final demo repositories are held out from prompt and rubric tuning as far as practical.

**Test sets.**

| Set | Purpose | Size target (smoke) |
| --- | --- | --- |
| Genuine-author set | False-failure measurement | As many consenting authors as we can recruit; report n |
| Unfamiliar-attempt set | Non-demonstration rejection (not "fraud detection") | Consenting volunteers given an unfamiliar repo |
| Injection set | TM-01, TM-02 | 15–20 hostile fixtures: README, comment, commit message, JD, email |
| Harness determinism | Probe reliability | Each probe run 20×; results identical. Known-good fix passes; known-bad fix fails |
| Non-repo set | Rubric parity | 3–5 lab/hardware artifacts with mentor and two reviewers |
| Boundary tests | TM-03, TM-04 | Fork bomb, huge output, symlink, traversal, egress, metadata address |

**Metrics (definitions from the master blueprint §4.7).** Anchor resolution (must be 100% *by construction* for displayed items, and measured for raw model output); question grounding; answerability; human-rubric agreement (weighted kappa with interval, plus label distribution); genuine-author false-failure; non-demonstration rejection; calibration only if probabilities are emitted (they are not, so omit); recruiter utility; student outcome; TPO efficiency.

**Baselines to compare.** (1) Prompt only; (2) retrieval of the anchored span + prompt; (3) retrieval + validators + deterministic evaluator. Two models, same prompts. Report each metric separately by language and by evidence pathway.

**Pre-registration.** The team writes its pass/fail thresholds *before* seeing results. I am not proposing numeric thresholds; none have been validated. The blueprint's 20% false-failure stop rule comes from Gemini and is unvalidated.

**Fine-tuning gate (blueprint §4.6).** No fine-tuning for the hackathon. Reconsider only when a held-out benchmark shows a stable, material weakness in baseline (3) that fine-tuning plausibly addresses, with no worse false-failure, subgroup gaps, hallucinated anchors or ungrounded questions, and with data-rights and provider-term approval. Never fine-tune a model to mark Verified, reject candidates or rank students.

### 9.5 Deliverable G: Data rights, consent and retention plan

**\[REC\]** This is an engineering plan, not legal advice. Items marked \[COUNSEL\] need review before any real-student pilot. Retention periods are **\[ASSUMPTION\]** proposals.

#### 9.5.1 Data inventory

| Data class | Purpose | Visible to | Proposed retention | Notes |
| --- | --- | --- | --- | --- |
| Account and identity | Authentication | Student, platform ops | Life of account + defined window | Minimise identifiers |
| Academic records (CGPA, backlogs) | Eligibility | Student, officer | Per college policy \[COUNSEL\] | History kept for decision snapshots |
| Group attributes (gender, category) | Fairness analysis only | Fairness job; aggregates to officer | Shortest period compatible with reporting | Separate table (T-07). Collect only with a stated purpose |
| GitHub tokens | Read-only import | Server only | Deleted on revoke | Never in logs or prompts |
| Repo snapshots and code spans | Verification | Student; verifier services | Deleted within a short fixed window after revoke or erasure \[COUNSEL on window\] | Raw source never in logs |
| Evidence uploads | Verification | Student, mentor, officer (as scoped) | Life of evidence + window |  |
| Verification responses | Assessment, appeals | Student, reviewer | Appeal period + window | Stored only with consent |
| Probe runs | Audit of result | Student, reviewer | Same as responses | No code stored beyond the submitted unit |
| Credentials | Portable proof | Student; verifier per share | Until expiry/revocation, then status record | Contains references and scope, no code |
| Eligibility decisions + snapshots | Reproducibility, appeals | Student, officer | Per college audit policy \[COUNSEL\] |  |
| Mock-drive results | Practice reports | Student, officer | Cohort-analysis window, then aggregate |  |
| Communications | Drive operations | Officer, recipient | Operational window |  |
| Recruiter contact data | Invitations | Officer | While relationship is active | Purpose-limited |
| Audit events | Accountability | Officer, platform auditors | Longer than domain data | Pseudonymise subject on erasure where law allows \[COUNSEL\] |
| Model-call logs | Debugging, cost | Engineers | Short | Hashes and counts only |
| Aggregates for analytics | Cohort reports | Officer, university | Indefinite if de-identified and small cells suppressed |  |
| Improvement corpus | Evaluation | Researchers | Until withdrawal | **Separate opt-in only** |

**\[OPEN\]** What happens to a Verified skill when its repo evidence is deleted? **\[REC\]** The credential remains valid until expiry unless the student asks otherwise, but the evidence panel shows "underlying evidence no longer available", and re-verification is required at expiry. \[COUNSEL\] to confirm this is acceptable.

#### 9.5.2 Consent design

- **Separate purposes**, each with its own notice version and toggle: placement operations; repo verification; recruiter sharing; analytics; model improvement (never bundled).
- Plain-language notice in English, Hindi and Marathi (translation reviewed by a human) **\[ASSUMPTION\]** for the first pilot.
- Withdrawal is as easy as granting: one control per purpose, immediate effect on access, with a visible deletion status.
- Recruiter sharing is per recruiter grant and per skill set, not blanket.
- **Minors.** Age gate at onboarding. Under-18 accounts follow a verifiable parental-consent route \[COUNSEL\]. **\[ASSUMPTION\]** Polytechnic diploma students may include under-18s, so this is not a corner case.
- **No behavioural monitoring (PDF p14).** **\[REC\]** Apply it to everyone: collect no keystroke dynamics, tab or focus tracking, webcam, screen capture or engagement telemetry from students. Assessment submissions and timestamps needed for fairness (e.g. time limits) are not monitoring. Document this list, because the boundary will be questioned.

#### 9.5.3 Data-principal rights workflow

Access, correction, erasure and grievance requests are created in the app (`data_requests`), assigned an owner and due date, and closed with evidence of completion or a recorded exception (legal or audit retention). Erasure cascades to repo snapshots, evidence uploads and responses; credentials and audit follow §9.5.1.

#### 9.5.4 Roles, vendors and breach

- **\[OPEN, COUNSEL\]** Who is controller and who is processor for each purpose (college vs PRAMAAN). Do not assume one relationship covers recruiter sharing, analytics and model improvement.
- Vendors to list with data-processing terms: hosting, database, object storage, LLM provider, mail provider, error tracker. **\[OPEN\]** whether the LLM provider retains prompts; until answered, send only the anchored span and no personal data.
- **Breach (M-04).** A one-page runbook: detection sources, triage owner, containment steps, who must be told and by when \[COUNSEL\], message templates, and a tabletop exercise before pilot.

#### 9.5.5 Demo and volunteer data

- Real repositories only from volunteers who gave **written or recorded** consent that names the repo, the purposes and the deletion date.
- All other data is synthetic and flagged `source = synthetic`, visible in the UI.
- Delete volunteer snapshots and responses after the event on the stated date; log the deletion.

#### 9.5.6 Items for counsel before any real pilot

Commencement and applicability of the data-protection rules to this deployment; minors and parental-consent mechanics; controller/processor roles; retention periods; erasure vs audit; cross-border transfer for LLM providers; whether group attributes may be collected for fairness analysis and on what basis; what NYC LL144 and EU AI Act references in the PDF require of an Indian campus deployment, if anything. None of these are concluded here.

---

## 10. Deliverables H and I, KPI dictionary, and sign-off gates

### 10.1 Deliverable H: P0 backlog (must work end to end)

Every item has an automated test. "Real" means the demo shows it running on real code paths, not a fixture.

| ID | Item | Acceptance criteria (testable) | Maps to |
| --- | --- | --- | --- |
| P0-01 | Tenancy, auth and RLS foundation | RLS-01 to RLS-08 and RLS-16 pass in CI; two synthetic tenants seeded; no bypass role exists | BR-17a, AD-12 |
| P0-02 | Audit chain | RLS-12 passes; every write in P0 items produces one event; a tampered row is detected by the verifier | BR-16 |
| P0-03 | Consent ledger and revoke | Given an active repo grant, import succeeds; after revoke, import is refused and token deleted within the same request; audit written | BR-03, BR-13, ST-02, ST-08 |
| P0-04 | Selected-repo static import (one language first) | Only repos the student selected are fetched; no build/install/hook is executed (asserted by process-spawn test); snapshot row stores commit SHA and parser version | ST-02 |
| P0-05 | Anchor resolver | Given a path, SHA and line range, resolver returns the exact span and hash; a wrong SHA or range returns `ANCHOR_INVALID`; 100% of displayed anchors resolve | BR-12, TM-08 |
| P0-06 | Non-repo evidence + mentor attestation | Student uploads lab artifact; assigned mentor attests against rubric; unassigned mentor is refused; evidence reaches Evidence-linked only after acceptance | BR-03, BR-15, ST-02 |
| P0-07 | Skill state machine | RLS-13 and RLS-14 pass; expiry job moves an overdue Verified skill to Expired; state events recorded | BR-02, ST-03 |
| P0-08 | Grounded defence | Every shown question passes the five gates in §9.3; a question with an unresolved anchor is never shown (test with an injected bad anchor) | BR-15 |
| P0-09 | Probe runner and one reviewed probe | Boundary test pack (TM-03, TM-04) passes on the runner host; probe is deterministic over 20 runs; known-good passes, known-bad fails; runner fails closed on timeout and writes no state change | BR-15 |
| P0-10 | Rubric evaluator and review queue | Given suggested scores, evaluator applies the rule and outputs a transition request or `inconclusive_review_required`; no model call can write `student_skills` (RLS-11) | BR-02, BR-12 |
| P0-11 | Passport, verifier page | Credential payload shows scope, rubric version, dates, evidence references; altered payload fails verification; no Verified badge appears without a verification record (X-05) | BR-04 (internal slice), ST-03 |
| P0-12 | Recruiter Evidence Card and access grant | RLS-08 passes; card shows only shared fields; there is no score-only row; each reason code links to a skill and evidence item | BR-10, AD-08, M-17 |
| P0-13 | Role gap and reason-coded match | For a seeded role, each match reason resolves to a student\_skill and evidence item; unmatched skills listed as gaps | BR-10, ST-04 |
| P0-14 | Eligibility engine with provisional/publish | Same `(rule_version, snapshot)` always yields the same result; student cannot see a provisional decision (RLS-09); publish needs officer and rationale; appeal creates a record | BR-08, ST-07, AD-07, T-03 |
| P0-15 | Proposals and approval queue | AI role can only insert proposals (RLS-11); approving applies via the owning service; a stale proposal returns `PROPOSAL_STALE`; audit shows inputs, actor, result | BR-11, AD-09 |
| P0-16 | Mock-drive and learning-path slice | One round runs end to end with a seeded per-student set; report shows score, weak topics, marks lost; learning task submission creates a pending evidence item and no state change | ST-05, ST-06 |
| P0-17 | TPO cohort gap view | Heatmap on synthetic cohort with `SYNTHETIC` banner; shows denominator and date; real KPI views exclude synthetic rows (RLS-18) | AD-01, BR-07 |
| P0-18 | Demo data flag and reset | Reset script restores a known seed in under a defined time; every record shown in demo mode carries `source`; banner cannot be disabled | ADR-13 |

### 10.2 P1 backlog (mandatory breadth, narrow but real)

None of these may be dropped silently. If a slice is not done by the demo, the doc and deck say so (blueprint implementation rule).

| ID | Item | Acceptance criteria (testable) | Maps to |
| --- | --- | --- | --- |
| P1-01 | Full three-round mock drive | Aptitude: 30 items, sampled per student by stored seed, sampled ids stored; Machine Test: 2 coding items of 10 marks run on the shared runner with fixed harnesses; interview: role-based questions with rubric 0–10, labelled "AI-assisted, practice"; report only after round 3 | ST-05, AD-04, T-08 |
| P1-02 | One-click resume | Button produces a PDF from profile data only; no resume upload field exists; every skill shows its state | BR-01, ST-01 |
| P1-03 | Bulk mailing | Template stored once; one click sends to all companies in the tenant list via a sandbox sender; delivery and reply events recorded; rate limit enforced | AD-05, TM-16 |
| P1-04 | Calendar, inbound email, allocation proposal | Overlapping booking rejected (RLS-17); inbound email creates a proposal, never a booking; hostile-email fixtures produce zero sends; officer confirms to book | BR-09, AD-06 |
| P1-05 | Fairness view and what-if simulator | Selection rate and impact ratio per gender, category, branch, shown with group sizes; groups below the minimum are suppressed; flagged results enter a review queue; each simulation is logged | BR-14, AD-10 |
| P1-06 | Accreditation export | Export includes placement counts deduplicated by student, salary, higher studies, branch outcomes from `student_outcomes`; a dedup summary is included; labelled "draft for review" | AD-11, M-18 |
| P1-07 | Six KPIs on one view | All six show definition link, numerator, denominator, window and `source` filter | BR-18 |
| P1-08 | JD ingestion and demand profiler | Each JD has source, permission note, date and hash; every insight shows sample size and date range; unreviewed extractions are labelled | BR-05, AD-02 |
| P1-09 | Support-need scenario and review queue | Scenario range labelled "not validated"; entries go to a review queue; no student-level status is stored until an officer confirms (T-02) | AD-03, AD-09 |
| P1-10 | Open Badges 3.0-shaped export | Export validates against the relevant schema/validator the team chooses; signature verifies; "conformant" is stated only after both pass | BR-04 |
| P1-11 | University aggregate view | RLS-06 passes; no student-level data returned | BR-17b, AD-12 |
| P1-12 | Per-tenant keys, rate limits, siloed option | Key reference and rate-limit config exist and are enforced; siloed storage documented with a thin runnable example | BR-17b, M-07 |
| P1-13 | Data-request workflow | Access and erasure requests created, owned, dated, closed with evidence | BR-13 |
| P1-14 | Interventions and before/after | Intervention linked to cohort scope; before/after uses the same skill definition and denominator; shortlisting-rate change shown | BR-07, M-01 |
| P1-15 | Recruiter pipeline | Shortlist, interview, offer and feedback records with append-only history; student sees status | BR-19, M-08 |
| P1-16 | Taxonomy seed and mapping review | 30–50 seed skills with mappings reviewed by a named reviewer; unreviewed mappings cannot be used in rules | BR-04 |
| P1-17 | LeetCode path | Method chosen per O-02; imported data enters as `external_profile` evidence and never directly yields Verified | M-09 |

### 10.3 KPI dictionary (proposed; needs TPO sign-off)

The six names are from PDF p15. **The PDF does not define them.** Every definition below is **\[ASSUMPTION\]** until a TPO accepts it. All KPIs exclude non-real rows by default.

| KPI | Numerator | Denominator | Window and rules | Missing-data rule |
| --- | --- | --- | --- | --- |
| Placement Rate | Distinct students with at least one accepted offer | Students registered for placement in the cohort (opted-out students excluded and shown separately; higher-studies students shown separately) | Per graduating cohort, as of a stated date | Students with unknown status counted as unknown, not unplaced |
| Verified Skill Coverage | Count of (student, required skill) pairs currently Verified and not expired | Count of (student, required skill) pairs for each student's chosen target role | Snapshot date | Students with no target role excluded and counted |
| Skill-Gap Closure Rate | Gaps present at baseline date that are Verified by end date, with new evidence | Gaps present at baseline date | Baseline and end date stated | Gaps without a baseline snapshot are excluded |
| Shortlist-to-Offer Ratio | Offers (distinct student-company offers) | Shortlist entries (distinct student-drive) | Per drive and aggregate | Counts offers, not students; label it so it is not confused with Placement Rate |
| Time-to-Shortlist | Median days (also show 90th percentile) | Drives with a shortlist | From application close to shortlist publication | Drives without both timestamps excluded and counted |
| Recruiter Engagement Score | Equal-weight average of four rates: invited companies that replied; approved recruiters who opened an Evidence Card; shortlist requests answered with feedback; interviews with feedback recorded | Each component's own denominator | Per drive or period | Always shown **with** its four components. **\[OPEN\]** The PDF gives no definition; the team and TPO must accept or replace it |

### 10.4 Deliverable I: 5-minute QUASAR pitch outline

**\[FACT\]** The master blueprint reports that the Unstop listing describes a 5-minute online PPT round and that no judging weights were found. I did not re-check the listing. **\[OPEN\]** Reconfirm the deadline, slide format, and any rubric with organizers.

| Time | Slide | Claim | Proof shown | Label required |
| --- | --- | --- | --- | --- |
| 0:00–0:25 | 1. Problem | A skill on a resume is a claim; a placement decision needs evidence | Problem statement p13 framing; cite the PDF's own figures as "stated in the problem statement" | None |
| 0:25–0:55 | 2. Thesis | PRAMAAN traces evidence to verified skill to versioned decision, and AI cannot change either | One chain diagram | None |
| 0:55–1:40 | 3. What is different (honest) | Chain click-through, what-if/fairness simulator, anchored probe, multi-modal proof. We do not claim AI viva or GitHub analysis is new | Screenshot of rule decision → skill → evidence → commit line | State that peers offer overlapping features |
| 1:40–2:35 | 4. Prototype | Real volunteer repo, anchored question, probe result, fail-closed state | Short clip or live flow | `REAL` / `CACHED` tag on each element |
| 2:35–3:25 | 5. Mandatory breadth | Each PDF module has a screen, rule or slice | One slide mapping ST-01–08, AD-01–12 to done / slice / planned | Honest status per module |
| 3:25–4:10 | 6. Trust | Deterministic eligibility, officer approval, tenant isolation tests, runner boundary, consent | Test pass summary, not adjectives | Say what is not claimed (no cheat detection, no legal certification) |
| 4:10–4:45 | 7. Validation | What we measure and the benchmark size actually achieved; pilot design | Counts, not percentages, if n is small | State n |
| 4:45–5:00 | 8. Close | "Skills you can defend. Evidence recruiters can trust." |  |  |

**Do not say:** first, unique, accurate to a number, compliant with any law, detects AI code, proves authorship, secure "against everything", or any statement that a competitor lacks a feature.

### 10.5 36-hour final: demo script and run of show

**\[ASSUMPTION\]** I read "36-hour demo script" as (a) the compressible live demo and (b) how to use the 36 hours around it. **\[OPEN\]** The sources I have do not state when judging happens within the 36 hours or how long the slot is. Build the schedule backward from that.

#### 10.5.1 Five-minute live demo (expandable to eight)

| Time | Screen | Action | Real / cached / synthetic | Fallback |
| --- | --- | --- | --- | --- |
| 0:00–0:45 | Student evidence | Show consent screen and selected-repo scope; import the volunteer repo; show skills as Claimed, Observed, Evidence-linked | Real import; if network fails, local bundle tagged `PRELOADED` | Local Git bundle and cached snapshot |
| 0:45–2:15 | Verification Arena | Show the anchored question with commit and lines; student answers; run the edge-case probe; show one failing run, then the fix passing; skill moves via the state machine | Real runner; question set pre-generated and validated, tagged `CACHED` if used | If sandbox fails, show `fails closed`, then text viva and review queue. Do not mint Verified |
| 2:15–2:50 | Passport and Evidence Card | Open the recruiter card; click a reason code back to the commit line | Real data | None needed |
| 2:50–3:40 | TPO rules | Open what-if on a draft rule; show who flips and the impact ratio with group sizes; publish with rationale; officer approves list; switch to student view to show failed rule and appeal | Synthetic cohort, banner visible | Pre-seeded second rule version |
| 3:40–4:25 | Governance | Show approval queue (agent proposal with inputs), run the audit verifier, attempt a cross-tenant read and show denial | Real tests | Recorded test run |
| 4:25–5:00 | Limits and close | State what was real, cached and synthetic; state what we do not claim |  |  |

**Eight-minute additions:** mock-drive report and learning path; calendar clash and inbound-email proposal; accreditation export; non-repo mentor path.

**If a volunteer cannot answer:** show `inconclusive` or `evidence-linked, not assessed`. Never describe it as cheating.

#### 10.5.2 Use of the 36 hours (relative; adjust once judging time is known)

| Block | Goal |
| --- | --- |
| H0–H2 | Verify environment, venue network, local fallbacks, reset script; run boundary and RLS suites once |
| H2–H10 | Close any P1 slice gaps flagged in written feedback; no new modules without a requirement, novelty or validation reason |
| H10–H16 | Rehearsal 1 under time; fix reliability only |
| H16–H20 | Re-run RLS, injection and boundary suites; update the real/cached/synthetic checklist |
| Before judging (T-minus window to be set) | Code freeze; bug fixes only; final rehearsal; backup recording ready |
| After feedback | Implement the highest-value judge-requested improvement, not a new feature set |

### 10.6 Sign-off gates (nothing is built until G1–G4 are closed)

| Gate | Decision needed | Owner | Closed? |
| --- | --- | --- | --- |
| G1 Scope | Accept or reject each of M-01–M-20 and T-01–T-08; adopt BR-17a/b and X-01–X-08 | Team | ☐ |
| G2 Trust boundaries | Accept ADR-02, 03, 04, 05, 06; choose the runner host for the demo; confirm no LLM or runner has write grants beyond §7.7 | Technical lead | ☐ |
| G3 Acceptance tests | Accept P0 criteria in §10.1 and the RLS and boundary suites as the definition of done | Team | ☐ |
| G4 Data in hand | Two real volunteer repos with written consent; one non-repo artifact and a willing mentor; probe functions chosen and harness reviewed | Backend/AI owner | ☐ |
| G5 KPI sign-off | A TPO or faculty reviewer accepts §10.3 | Product owner | ☐ |
| G6 Organizer facts | Final PPT deadline and format; demo slot length; judging rubric; whether pre-loaded data is allowed | Team lead | ☐ |
| G7 Counsel list | Items in §9.5.6 scheduled. Not blocking the hackathon, blocking any real-student pilot | Team lead | ☐ |

### 10.7 Decisions I need from you

1. **T-01:** Accept "Verified = accepted evidence + completed verification path", and the "evidence vs proof" pitch line?
2. **T-03:** Officer approves each drive's eligibility list and rule version, with per-student override, rather than per-student approval?
3. **T-02:** Ship AD-03 as a labelled scenario range plus review queue, with no stored student labels?
4. **O-01:** Agree the working definition of Observed?
5. **O-02:** Choose the LeetCode method (bio-token check on a public profile, or signed upload), after someone verifies the platform's terms.
6. **Fairness minimum group size:** I suggest starting at 10 and treat it as adjustable; this number is arbitrary and the team must choose it (master §16 item 8).
7. **Which two repos, and who can consent** (master §16 items 1–2), plus which functions are safe to extract.
8. **Credential scope for the demo:** internal passport only, or the OB3-shaped export too (master §16 item 4)? My recommendation: both, with "conformant" withheld until validated.
9. **Interview round scoring (O-04):** accept the 0–10 rubric with a practice-only label?
10. **Runner for the demo:** a rootless container on a separate VM (demo baseline) versus microVM-class isolation (needs more setup time)?
