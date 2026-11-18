# PRAMAAN compliance audit against the QUASAR 5.0 EdTech problem statement

Audit date: 18 Nov 2026. Branch `feat/p0-04-static-repository-ingestion`. Read-only audit; no repo file modified, `.env` not read, no DB or network used.

Baseline: `docs/archive/status/REQUIREMENT_TRACEABILITY.md` (IDs only; its status column is stale) and `docs/SOLUTION_AND_BUILD_PLAN.md`. The original PDF was not available, so "requirement" means the RTM wording.

Status key: DONE = UI + API + data + a test that exercises the core behaviour. PARTIAL = works but something named below is missing. STUB/FAKE = text or UI exists, behaviour simulated or absent. MISSING = nothing.

## 0. Test evidence

- `npm run test:offline`: 34 files, 502 tests. 499 passed, 3 failed on the first run. The 3 failures (`ship-hardening.test.ts`) were caused by my own blanking of `SUPABASE_URL` ("JWT verification configuration missing"). Re-running that file with a dummy `SUPABASE_JWT_SECRET` and empty DB URLs: 5/5 pass. Effective total: 502/502.
- Not in the `test:offline` list (so not in the 502): `v2-eligibility-pass` (7 tests) and `v2-fairness-repair` (2 tests), though both use the offline PGlite demo app; all live-Supabase and Docker-Postgres files.
- Offline proof of tenant isolation for the v2 tables is PGlite with role `app_api` (NOBYPASSRLS): `apps/api/tests/v2-demo-flow.test.ts` "Isolation (Phase 3)". The live-DB suite (`db/tests/supabase-real-db.test.ts`) still asserts "all 46 tables" (there are now 78) and, per the plan, fails to connect and fails tests 11-16 after migrations 017-025 were applied to the live project. Treat live-DB evidence as not currently reproducible.
- I also ran one throw-away script (in the scratchpad, not the repo) against the offline demo app: revoking `repo_verification` for Rahul through the route the UI uses (`POST /api/v2/student/consents`) returned `skillsDemoted: 4`, Git and Python dropped out of Verified, and audit events `CONSENT_REVOKED` and `ELIGIBILITY_REEVALUATED` were written.

## 1. Answers to the specific scepticism questions

| Question | Finding |
|---|---|
| Does the AI interview use an LLM? | No. `scoreInterviewAnswer` (`packages/domain/src/mock-drive.ts:168`) counts a question's key points whose keywords appear as substrings. Keyword-stuffing an answer scores 10/10. There is no LLM, SDK or API key anywhere in `apps/api/src` or `packages/domain/src`. Every "agent" records `model_version = 'deterministic-rules-v1'` (`apps/api/src/v2/audit.ts:54`). Interview questions come from seed (`interview_questions`) or a template drafter (`routes-tpo.ts:244`) that builds one generic question per skill. |
| Is JD ingestion real parsing or fixtures? | Real but narrow. `extractSkills` (`analytics.ts:145`) is regex whole-word matching of skill names and aliases against JD text. Corpus: 10 JDs tied to drives plus 36 rows labelled `[SYNTHETIC sample n]` in `db/seeds/020_synthetic_demo_tenant.sql`. Officers can paste more JDs (`POST /api/v2/tpo/demand/jds`, form in `Demand.tsx`). No fetcher, no connector, no file upload, no LLM. Sample size and dates are shown, and the UI says "no AI guessing". |
| Are bulk mails really sent? | No. There is no mail library in the repo. `routes-tpo.ts:292-306` inserts one `outreach_messages` row per company with status `queued` (outbox). If `SMTP_HOST` is set, the code only sets `status='sent'` and `sent_at=now()`; nothing is transmitted. No rate limiting, no delivery tracking, no inbound mailbox; replies are pasted by hand (`/outreach/messages/:id/reply`). No UI to create templates (API exists). Sends to every company in the table, with no recipient selection. |
| Is "predictive analytics" a model or a formula? | A formula. `readiness()` = 0.45 core-skill coverage + 0.30 latest mock + 0.15 learning tasks + 0.10 backlogs; "forecast" = share of students scoring at least 55, with a Wilson interval (`analytics.ts:73-123`). Not trained, not validated, and the "estimate" is a share of students above a threshold, not a placement probability. It is honestly captioned ("early estimate... not compared with real past placement results") and the support list is officer-only. No scenario ranges. |
| Does the university hierarchy roll up? | Partly. `organizations.parent_id` exists. `university_college_outcomes()` is a SECURITY DEFINER aggregate (students, placed, median CTC, verified coverage per college), role-gated to `university_admin`, tested (`v2-demo-flow` "the university sees per-college aggregates only"). Seed has 1 university and 2 colleges. Nothing rolls up to department level for the university, there is no API to create a college or university, and `organizations.key_ref` is never used (per-tenant keys not implemented, declared in the plan). Rate limiting is per IP, not per tenant (`v2/rate-limit.ts`). |
| Are KPIs computed from data or constants? | Computed from DB rows (`routes-tpo.ts:42-118` -> `computeKpis`), each with numerator, denominator and formula. Caveats: "opted in" = all students (no opt-in flag); Verified Skill Coverage uses the hard-coded `BRANCH_CORE_SKILLS` map in `v2/config.ts`, not target-role skills; the gap-closure denominator is reconstructed as `required - verified + closed`, and the baseline falls back to "60 days ago" if no `kpi_snapshots` row exists. The before/after "SQL workshop 60% -> 25%" is built into the seed (`scripts/generate-demo-seed.mjs:577`) and the test only asserts before > after. |
| Is the NAAC/NIRF export real? | A deduplicated per-branch table (each student counted once at their best outcome) as CSV plus the browser's print dialog for PDF. The button is labelled "Download Excel file" but delivers `.csv`; no XLSX. It is not the actual NAAC 5.2.1 or NIRF template. Higher-studies and entrepreneurship counts come from seeded `student_outcomes`; there is no screen to enter outcomes. It carries a "Draft for institutional verification" note. |
| Does revoking consent really demote skills? | Yes, in both code paths. Legacy `PgConsentRepository.revokeConsent` also quarantines snapshots, revokes ingestion records, cancels jobs and (per KNOWN_LIMITATIONS) revokes the GitHub grant. The UI calls the v2 route (`routes-student.ts:574-596`), which deletes the local `connected_accounts` row, withdraws code evidence, and demotes to `evidence_linked` or `claimed` with reason `EVIDENCE_WITHDRAWN_CONSENT_REVOKED`. The v2 route does not quarantine `source_snapshots` or `trusted_ingestion_records`, does not cancel ingestion jobs, and does not call GitHub's grant-revocation endpoint. The only test for demotion (`consent-revocation-skill-demotion.test.ts`) targets the in-memory legacy `ConsentService`, not the v2 SQL path. I verified the v2 path by hand (section 0). |
| Is every agent action logged? | Agent runs: yes. `recordAgentRun` writes `agent_runs`, one `agent_actions` row per tool call, inert `proposals`, and an `AGENT_RUN` audit event. Proposal approve/reject is audited. Not every mutation is audited: 11 POST handlers have no audit call (skills/claim, external-profiles link, mock aptitude/machine run/machine submit/interview, probe predict, demand/jds, outreach/templates, tpo/inbound, rules/preview). The plan's "agent DB role has no write grants" is not implemented: agents run inside the officer's own transaction (an `ai_worker` role is created in PGlite but nothing uses it). |
| Is RLS forced on every table? | Yes, by static analysis: 78 `CREATE TABLE` statements across migrations 001-025 and 78 `FORCE ROW LEVEL SECURITY` statements, no table missing. All have tenant policies except `pass_requests` (deliberately policy-less deny-all; only SECURITY DEFINER functions touch it). Four catalog tables use `USING (TRUE)` for SELECT (consent_purposes, skills, rubric_versions, probe_definitions) plus `skill_aliases` and `skill_mappings`. `student_group_attributes` is unreadable by `app_api` (tested). Gap: no offline test enumerates `pg_class.relforcerowsecurity` over all 78 tables; the only such test is the stale live-DB one. |
| Is the demo data labelled synthetic? | Yes. Org and company names carry `[SYNTHETIC]` (stripped in some views, so the label disappears on screen), `organizations.config.synthetic=true`, emails use `.invalid`, the generated seed header says so, and `WorkspaceShell.tsx:50` shows a "Demo mode: sample data and a simulated sign-in" banner. JD rows say "[SYNTHETIC sample n]". Fixture LeetCode/Codeforces results say "Demo only" and are tagged `demo_fixture`. Residual: the landing page (`apps/web/app/page.tsx`) uses "Nimbus Analytics" and "SQL test" examples as marketing copy with no synthetic label; the seed deliberately shifts school marks by category to give fairness tools something to find (labelled in docs, not in the UI). |

## 2. Requirement-by-requirement

### Core business requirements

| ID | Status | Evidence and gaps |
|---|---|---|
| BR-01 | PARTIAL | Profile, skills, academics and resume are generated from DB (`routes-student.ts:28,142`, `Profile.tsx`, `app/resume/page.tsx`). Missing: PDF is `window.print()` only (no server PDF); no per-skill confidence metric; resume endpoint untested. Profile covered by `v2-demo-flow` "profile: SQL is only Claimed...". |
| BR-02 | DONE | State machine `skill-state-machine.ts`; DB trigger `trg_verify_skill_evidence` (migration 019) checks session, outcome, proof level, expiry. Tests: `skill-state-machine(.v2).test.ts` (26), `db/tests/v2-schema-invariants.test.ts` (16, offline PGlite). Caveat: no runtime job moves skills to `expired`; Expired exists only in seed data. |
| BR-03 | PARTIAL | Real, hardened GitHub read-only ingestion with consent gate (`p0-04-github-ingestion.test.ts`, 56 tests against a mocked GitHub; never exercised against real GitHub). Non-repo upload -> mentor review -> attestation exists (`routes-student.ts:84`, `routes-tpo.ts:630`), but "upload" is a text description plus URL, not a file, and the review path has no API test. Missing: no repo picker in the UI (one "Connect GitHub" button); ingestion output is never turned into evidence, skills or probes (no "Repo Profiler", nothing creates `candidate_skills`). Demo uses seeded evidence. |
| BR-04 | PARTIAL | OB 3.0-shaped credential, Ed25519 signature, public verify page `/verify/[id]`, tamper/expiry/revocation tests (`engines.test.ts`; `v2-demo-flow` passport verifies publicly). `credentials.ts` states it is not a JSON-LD Data Integrity proof. Taxonomy: 145 skills, ESCO/O*NET labels seeded `pending_review` with no codes, zero NSQF; the credential only embeds an ESCO alignment if a mapping is `confirmed`, so in practice none. |
| BR-05 | PARTIAL | `extractSkills` + `demandVsSupply` + `Demand.tsx`; sample size and dates shown; tests in `engines.test.ts` and `v2-demo-flow`. Not an LLM or crawler agent; corpus is 46 seed JDs plus manual paste; dates are `posted_on`, not retrieval dates. |
| BR-06 | PARTIAL | `planLearningPath`, `/learning-path/generate` and `/items/:id/submit`; coding tasks run through the judge and emit `test_result` evidence + L2 award; other tasks go to mentor. 16 seeded tasks (6 coding). Path generation tested; the submit/evidence path is not tested directly. Retake "unlock" is computed but not enforced. |
| BR-07 | PARTIAL | Heatmap (branch x hard-coded core skills), `ProofPath.rankInterventions` what-if ranking, approved gap alerts create `interventions`. Before/after measures only the share of mock attempts with the topic weak, before vs after one intervention; it does not measure verified-skill gain or shortlisting rate. |
| BR-08 | DONE | `eligibility-evaluator.ts` (Rule DSL v2, three-valued, reason codes, plain-language checks, input hash), immutable rule versions (trigger `trg_rule_versions_immutable`), what-if. Tests: `eligibility-evaluator.test.ts` (11), `v2-demo-flow` "rule what-if... immutable new version". Override is only via appeal overturn. |
| BR-09 | PARTIAL | Room double-booking is DB-enforced (`excl_room_double_booking` on `drive_rounds`); student clashes across drives are detected in app code and shown as a warning only; email -> slot proposal -> officer approval works (`calendar.ts`, test "double-booked room is refused by the database"). Missing: `interview_slots` (with student and panel exclusion constraints) is never written by any API, UI or seed; there is no API to create a drive; the email parser is regexes. The Drives page header claims panels and students cannot be double-booked, which is not true. |
| BR-10 | PARTIAL | Consent-scoped search (live `recruiter_sharing` consent check, minors need guardian consent), skill + proof-level + freshness filters, per-match reasons, Evidence Card (`routes-recruiter.ts`; test "recruiter finds Rahul..."). The "source anchor" is file path + 12-char hash, not a code span or line range; no code viewer. Access grants cannot be created via API or UI (seed only). |
| BR-11 | DONE | Proposal inbox; approval applies the effect and is audited; recruiter shortlist is a proposal. Tests: `v2-demo-flow` (shortlist approve, slot approve). Caveats: agents are deterministic rules, not LLMs; separation is by code path rather than DB grants; `reevaluateStudent` re-runs published rules automatically (rule engine, not AI). |
| BR-12 | PARTIAL | The pieces exist (decision stores reasons, rule version, input snapshot and hash; probe view shows `hashVerified`; legacy anchor resolver, `anchor-resolver` and `exact-anchor-resolver` tests, 63 tests). No single "decision -> rule version -> skill -> evidence -> commit/line" drawer; ≤4-click chain is not demonstrable. |
| BR-13 | PARTIAL | Purpose toggles, minor/guardian gate (migration 017, tested), revoke with skill demotion (verified by hand on the v2 path), data export JSON. Missing: data-request workflow (`data_requests` rows are created with a 30-day due date but there is no officer queue and no deletion); no retention purge job (`retention_days` stored only); v2 revoke does not quarantine snapshots or revoke upstream (see section 1); tests of revoke cover the legacy path. |
| BR-14 | DONE | `fairness-calculator.ts` (four-fifths ratio, Fisher exact, suppression N<5, per stage, gender/category/branch/college_tier), SECURITY DEFINER count functions, publish-time simulator. Tests: `fairness-calculator(.v2).test.ts` (11), `rule-repair.test.ts`, `v2-fairness-repair.test.ts`, `v2-demo-flow`. Funnel view only has data for the one seeded completed drive. |
| BR-15 | PARTIAL | Live Mutation Probe works end to end on seeded `probe_definitions` (hash-verified anchor, keyword-scored prediction, sandboxed JS mutation, hidden tests, L3). Test: `v2-demo-flow` probe; `v2-judge.test.ts` (7). Missing: probes are not generated from real ingested repos; JavaScript only (Judge0 adapter is language 63 only); no LLM-generated viva; no human fallback; local judge is `vm` in a worker (not a security boundary; in production without `JUDGE0_URL` the `DisabledJudge` turns off every code-running feature). |
| BR-16 | PARTIAL | Hash-chained audit, advisory lock, `(org_id, seq)` unique, append-only trigger; `audit-chain.test.ts` (19), `m1-audit-chain.test.ts`. Gaps: 11 mutating routes unaudited (list in section 1); `/api/audit/verify` exists but the UI never calls it (Roles page lists 60 rows with truncated hashes, no verify button); live college-A chain is `UNANCHORED` per KNOWN_LIMITATIONS. |
| BR-17a | DONE | 78/78 tables forced RLS, `app_api` NOBYPASSRLS, `SET LOCAL` tenant context per request (`v2/db.ts`). Offline: `v2-demo-flow` isolation tests. Live: stale (see section 0). |
| BR-17b | PARTIAL | See "university hierarchy" above. No per-tenant keys, no per-tenant rate limits, no onboarding of colleges. |
| BR-18 | DONE | Six KPIs, each with numerator, denominator, formula (`computeKpis`, `Cohort.tsx`). Test: `engines.test.ts` + `v2-demo-flow` (length 6, formulas present). Definitional caveats in section 1. |
| BR-19 | PARTIAL | `application_events` is append-only (trigger), stages applied -> offer_accepted/declined, recruiter feedback, offers with accept/decline (`routes-recruiter.ts`). Tests cover only the shortlist-approval step; officer stage changes, offers, accept/decline and feedback are untested. Applications exist only if the seed or the student "apply" call creates them. |

### Student modules

| ID | Status | Evidence and gaps |
|---|---|---|
| ST-01 | PARTIAL | As BR-01. |
| ST-02 | PARTIAL | As BR-03. LeetCode/Codeforces ownership-token linking is implemented and tested in demo mode, but `DemoFixtureProfiles` returns `ownershipConfirmed: true` for any handle and token (labelled "Demo only"). Live mode uses Codeforces' official API and LeetCode's unofficial GraphQL endpoint; neither is tested. |
| ST-03 | PARTIAL | State, proof level, evidence list, history, explanation (`/skills/:id`, `Proofs.tsx`); probe as in BR-15. Missing: LLM or code-grounded question generation, human-review escalation (no endpoint). |
| ST-04 | PARTIAL | `/student/targets` ranks seeded `job_roles` by fit, shows required vs proven skills and an eligibility preview. No test; the student cannot save a target; gap prioritisation lives in My Drives (Proof Path). |
| ST-05 | PARTIAL | R1: 30 questions (10 per topic) sampled per student by seed from 96 bank questions; R2: two problems, per-hidden-test partial marks, but JavaScript and SQL only; R3: keyword rubric, not AI. Combined report with weak topics and marks lost. Tests: `engines.test.ts`, `v2-demo-flow` "mock drive: three rounds...". The UI says a student "can ask a person to review" the interview score; there is no such endpoint or button. |
| ST-06 | PARTIAL | As BR-06. |
| ST-07 | DONE | Per-rule reasons, in English/Hindi/Marathi (drafts, unreviewed), apply, appeal -> officer decision. Tests: `v2-demo-flow` (drives, appeal), `reason-i18n.test.ts`, `proof-path-timing.test.ts`. |
| ST-08 | PARTIAL | Toggles, revoke, JSON export, data requests, "how scores work" text. Data requests are recorded but never processed; export is JSON, not a deletion workflow. Revoke tested only on the legacy path (see BR-13). |

### Admin / TPO modules

| ID | Status | Evidence and gaps |
|---|---|---|
| AD-01 | DONE | Heatmap, verified coverage %, weak-topic counts, intervention ranking, CSV export, department-coordinator scoping. Test: `v2-demo-flow` officer dashboards, coordinator scope. Core-skill map is a constant; before/after is seed-built. |
| AD-02 | PARTIAL | As BR-05. |
| AD-03 | PARTIAL | As in section 1: transparent formula, caveated, officer-only; not a trained or validated predictor; `propose-support` creates mentor proposals (untested). |
| AD-04 | PARTIAL | Add aptitude questions; draft/approve interview questions; coding problems are list-only (no API to author problems or hidden tests). No test for `mock-setup`. |
| AD-05 | STUB/FAKE | See section 1. Outbox only; with SMTP configured it falsely records "sent". No tests (`outreach` appears in no test file). |
| AD-06 | PARTIAL | As BR-09. |
| AD-07 | DONE | `Rules.tsx` builder, versions, what-if with gained/lost and fairness, publish with rationale, appeals queue, rule repair. Tests: `v2-demo-flow`, `rule-repair`, `v2-fairness-repair`. |
| AD-08 | PARTIAL | As BR-10. No way to grant recruiter access. |
| AD-09 | DONE | Proposal inbox, approve/reject with note, `agent_actions` log. Test: `v2-demo-flow`. "Agents" are deterministic rules. |
| AD-10 | DONE | As BR-14; `Fairness.tsx` with flag/clear review. |
| AD-11 | PARTIAL | As section 1; CSV only; not the NAAC/NIRF template; outcomes not editable in-product. |
| AD-12 | PARTIAL | RBAC for 8 roles and tenant isolation tested on sampled endpoints (not every endpoint); member add requires an existing user account; no college/department management; university sees colleges only. |

### Cross-check invariants

| ID | Status | Evidence and gaps |
|---|---|---|
| X-01 | PARTIAL | Lifecycle stages exist, but drives cannot be created in-product, `interview_scheduled` is a flag with no slots, and offers/stages are untested. |
| X-02 | PARTIAL | As BR-17b. |
| X-03 | DONE | Agents write only `proposals`; effects apply on officer approval; recruiter shortlist needs an officer. Enforced in code, not by DB grants. Auto re-evaluation of published rules is deterministic policy, not an AI proposal. |
| X-04 | DONE | One Cohort screen shows Placement Rate, Verified Skill Coverage, Gap Closure plus 3 operational KPIs. |
| X-05 | DONE | State machine plus DB trigger, tested offline (`v2-schema-invariants` incl. NULL-outcome bypass fix). |
| X-06 | PARTIAL | Coding tasks emit evidence and move skills; project tasks need mentor approval; submit path untested; completion alone does not tick anything. |
| X-07 | DONE | Immutable rule versions; every decision stores `input_snapshot`, `input_hash`, rule version. No replay endpoint, but the hash is reproducible (`computeInputHash`). |
| X-08 | DONE | RLS forced and policied on all 78 tables; offline PGlite isolation tests pass. Live-DB suite stale and unrunnable (see section 0). |

## 3. (a) Things the problem statement seems to demand that were never addressed (or only declared)

1. A real LLM anywhere: AI interview, AI question generation from code, JD extraction, mail drafting, slot parsing. The plan declares agents are deterministic and "an LLM adapter is the next step"; nothing is wired. A judge reading "AI-assisted interview" and "agents" will look for a model.
2. Languages: plan §3.6/B4 promised C, C++, Java, Python judging and Python/Java parsing; only JavaScript and SQL execute, and the AST parser is TypeScript only.
3. Institutional data onboarding: no way to import students, marks, outcomes, companies, rooms or drives, or to create drives or recruiter grants. Every list the officer sees comes from the seed.
4. Real outbound/inbound email (AD-05, AD-06 "inbound company email parsing" from a mailbox).
5. Actual NAAC/NIRF templates and XLSX/PDF generation (PDF via browser print only).
6. Data-subject request fulfilment, retention purge, nightly skill-expiry job (jobs plan used `pg-boss`; none present).
7. Per-tenant keys and rate limits (BR-17b).
8. Human review/escalation for AI-scored work (promised in plan and UI text, no endpoint).
9. A model-based placement forecast (AD-03) or any backtest; scenario ranges.
10. Accessibility, mobile and load claims: a 5,000-student load test exists (`load.test.ts`) at domain level only; no web tests of any kind (no component, e2e or accessibility tests in `apps/web`).

## 4. (b) Five weakest spots a judge could expose live

1. **"AI" is keyword matching.** Open the mock interview or the probe's prediction step, paste the key terms ("trade-off", "tested", "problem") without a coherent answer, and get 10/10. Asking "which model?" has the answer "none". Same for Demand Scout, Readiness Analyst, Drive Coordinator, Interview Drafter. Fix by wording ("rubric-scored, no LLM") or by wiring one cached LLM call behind the existing proposal gate.
2. **Bulk mailing does nothing.** Click "Send to all companies": rows appear as "In outbox" and nothing leaves. With `SMTP_HOST` set it would show "sent" with no send code behind it. Replies are typed in by the officer. There is no create-template UI.
3. **Calendar and drive claims overreach.** The page says panels and students cannot be double-booked; only rooms are DB-enforced, student clashes just warn, `interview_slots` is dead schema. A judge asking "create a new drive / add a company / grant this recruiter access / enter a student's placement outcome" finds no screen or endpoint for any of them.
4. **The headline GitHub-to-proof loop is not connected.** The real ingestion pipeline (consent gate, size limits, AST anchors) stops at snapshots. Skills, evidence and probes shown in the demo are seeded ("Rahul's canteen app"); the Import page itself says GitHub is not connected in demo. Ask "import my repo now" and nothing produces a skill. Also, the LeetCode "ownership check" in demo mode always succeeds, whatever token you put in.
5. **Demo fragility and state.** The offline demo is in-process PGlite: a restart resets everything, cold start applies 25 migrations plus a 13k-line seed, and the SQL judge boots a fresh PGlite per hidden test (test timings: 1.7 s to 3.7 s per SQL judge test; the `v2-demo-flow` file takes 22 s). A SQL mock submission with several hidden tests can take noticeably long on screen. Passing the SQL problem, revoking consent or approving a proposal cannot be undone without a restart.

Also exposable: Excel button delivers CSV; "ask a person to review" does nothing; Hindi/Marathi are unreviewed drafts; KPI gap-closure denominator is reconstructed; predictive "forecast" is a share-above-threshold; `[SYNTHETIC]` is stripped from names on several screens so only the banner labels the data; the UI revoke path is weaker than the legacy one (no snapshot quarantine, no GitHub-side grant revocation) while `KNOWN_LIMITATIONS §2.5` describes the stronger behaviour.

## 5. (c) Demo-path risks (external services and environment)

| Need | Risk |
|---|---|
| GitHub OAuth app (client id/secret, redirect URI, `FRONTEND_URL`, token key ring) | Needed for real ingestion; never tested against live GitHub; demo bypasses it. Production start fails closed without it. |
| Supabase Auth (JWKS) and Postgres | Migrations 017-025 were applied to the live project during a test run; v1 live tests 11-16 now fail; the plan lists "keep v2 or restore backup" as an unresolved decision. Live tests error on connection. |
| Judge0 (`JUDGE0_URL`) | In production mode, without it `DisabledJudge` turns off mock machine test, probes and learning tasks. Judge0 adapter handles JavaScript only; SQL still uses local PGlite workers. |
| `PRAMAAN_ISSUER_SEED` | Credential issuing returns 501 without it (the demo has a public seed). |
| LeetCode GraphQL (unofficial), Codeforces API | `EXTERNAL_PROFILES_LIVE=true` or production; rate limits and schema changes can break; 8 s timeout. |
| SMTP | Not implemented. |
| LLM provider | Not implemented. |
| Node >= 22, `npm run demo` + web with `NEXT_PUBLIC_DEMO_MODE=true` | The safest path; needs no network or credentials. |

## 6. One-table summary

| ID | Status | Evidence |
|---|---|---|
| BR-01 | PARTIAL | Resume via browser print; no confidence metric; resume untested |
| BR-02 | DONE | `skill-state-machine*.test.ts`, `v2-schema-invariants` (trigger); no expiry job |
| BR-03 | PARTIAL | Real ingestion (56 tests) but not linked to skills; no repo picker; uploads are text+URL |
| BR-04 | PARTIAL | OB3-shaped, Ed25519, public verify; no ESCO/O*NET/NSQF codes; not Data Integrity |
| BR-05 | PARTIAL | Regex alias match over 46 seed/pasted JDs; no connector |
| BR-06 | PARTIAL | Path + judge-tested tasks; submit untested; retake not enforced |
| BR-07 | PARTIAL | Heatmap and ranking; before/after = mock weak-topic share (seed-built) |
| BR-08 | DONE | `eligibility-evaluator.test.ts`, rule-version immutability, what-if |
| BR-09 | PARTIAL | Room DB exclusion only; student clash = warning; `interview_slots` unused |
| BR-10 | PARTIAL | Evidence Card = path + hash; grants seed-only |
| BR-11 | DONE | Proposal gate; agents are rules not LLMs |
| BR-12 | PARTIAL | No single evidence-to-decision drawer |
| BR-13 | PARTIAL | Revoke demotes (verified); v2 path skips snapshot quarantine/upstream revoke; no data-request processing |
| BR-14 | DONE | 4/5ths, Fisher, N<5, per stage; 11+ tests |
| BR-15 | PARTIAL | Seeded probe, JS only, keyword prediction; no human fallback |
| BR-16 | PARTIAL | Chain + triggers tested; 11 routes unaudited; no verify UI |
| BR-17a | DONE | 78/78 forced RLS; PGlite isolation tests; live suite stale |
| BR-17b | PARTIAL | Aggregate view only; no per-tenant keys or limits |
| BR-18 | DONE | `computeKpis` from DB with formulas; constants for core skills |
| BR-19 | PARTIAL | Append-only events; officer stage/offer paths untested |
| ST-01 | PARTIAL | As BR-01 |
| ST-02 | PARTIAL | As BR-03; demo LeetCode check always true |
| ST-03 | PARTIAL | Probe seeded; no human escalation |
| ST-04 | PARTIAL | Read-only fit ranking; no test; no target selection |
| ST-05 | PARTIAL | R1/R2 solid (JS+SQL only); R3 keyword rubric; review button absent |
| ST-06 | PARTIAL | As BR-06 |
| ST-07 | DONE | `v2-demo-flow`, `reason-i18n` |
| ST-08 | PARTIAL | Toggles/export done; requests unprocessed |
| AD-01 | DONE | Cohort dashboard; `v2-demo-flow` |
| AD-02 | PARTIAL | As BR-05 |
| AD-03 | PARTIAL | Weighted formula + Wilson interval; not a model |
| AD-04 | PARTIAL | No coding-problem authoring; no tests |
| AD-05 | STUB/FAKE | No mail code; SMTP flag only relabels status; untested |
| AD-06 | PARTIAL | As BR-09; no drive creation; regex email parse |
| AD-07 | DONE | `Rules.tsx`, versions, what-if, appeals; tests |
| AD-08 | PARTIAL | Search works; access grants cannot be created |
| AD-09 | DONE | Proposal inbox + `agent_actions`; tested |
| AD-10 | DONE | Fairness funnel + simulator + flag review |
| AD-11 | PARTIAL | CSV and print only; not NAAC/NIRF templates |
| AD-12 | PARTIAL | RBAC/isolation tested on samples; no college/dept management |
| X-01 | PARTIAL | Lifecycle stages present; no drive creation, no slots |
| X-02 | PARTIAL | As BR-17b |
| X-03 | DONE | Proposals inert; officer approval applies |
| X-04 | DONE | One Cohort screen |
| X-05 | DONE | Trigger + state machine tests |
| X-06 | PARTIAL | Coding tasks emit evidence; submit untested |
| X-07 | DONE | Immutable versions + input hash per decision |
| X-08 | DONE | Forced RLS everywhere; offline proof; live suite stale |

Count (47 IDs): DONE 16 (BR-02, 08, 11, 14, 17a, 18; ST-07; AD-01, 07, 09, 10; X-03, 04, 05, 07, 08), PARTIAL 30, STUB/FAKE 1 (AD-05), MISSING 0 (no ID is wholly absent, but see section 3 for sub-features that are).

## 7. Gaps to close before judging, ranked

1. Make the AI claims truthful or real: relabel interview/probe scoring and the "agents" as rule-based on every screen and slide, or add one cached LLM call (interview scoring, probe question) that only drafts and sits behind the proposal gate. Add a "request human review" endpoint and button for interview scores, since the UI already promises it.
2. Fix AD-05: either send through a real transport (Resend/SES/SMTP with a rate limit, delivery status, an inbound webhook for replies) or stop setting `sent` when `SMTP_HOST` is set and rename the screen "Outbox preview". Add template create UI and recipient selection. Add a test.
3. Correct the Drives page claim and either write `interview_slots` (student and panel exclusion) or soften the text. Add "create drive", "grant recruiter access", and "enter outcomes" endpoints and screens, or demo only what exists.
4. Connect ingestion to proof: after a consented ingest, create candidate evidence/skills (Claimed/Observed) and generate probes from anchors, or state plainly in the demo script that the repo is a preloaded snapshot.
5. Align the UI revoke route with the legacy one (quarantine snapshots, revoke ingestion records, cancel jobs, GitHub-side grant revocation) and add a v2-path test for revoke -> demotion -> recruiter visibility.
6. Add an offline test enumerating `relforcerowsecurity` for all tables; update or retire the stale 46-table live test; decide keep-or-restore for the live Supabase project; add `v2-eligibility-pass` and `v2-fairness-repair` to `test:offline`.
7. Add audit calls to the 11 unaudited mutating routes (at minimum skills/claim and external-profiles link), plus a "verify chain" button wired to `/api/audit/verify`.
8. Honest export: rename "Download Excel file" to CSV or generate real XLSX; use the actual NAAC/NIRF column layouts; add outcome entry for higher studies and entrepreneurship.
9. Add a skill-expiry job so the Expired state occurs at runtime, and tests for officer stage changes, offers, accept/decline, mock-setup and recruiter feedback.
10. Demo hardening: pre-warm PGlite and the SQL judge, add a one-click reset, label `[SYNTHETIC]` consistently on screen, and rehearse with `JUDGE0_URL` unset and set.
