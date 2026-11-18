# PRAMAAN: Real-Data Plan

Goal: the shipped website shows and stores only real data. No synthetic students, colleges, companies, drives, marks, statistics or testimonials anywhere a user can reach.

> Superseded for now: the decision is to keep synthetic data and make it highly realistic (see the realism pass in SOLUTION_AND_BUILD_PLAN.md). This plan stays as the route to real data later.

Date: 17 Nov 2026. Status: plan only, nothing in this file is built yet.

## 1. What "real" means here

| Allowed | Not allowed |
|---|---|
| Real people who joined with their own consent | Invented personas ("Rahul", "Nimbus Analytics") |
| Real colleges and companies that agreed to take part | Generated rosters, marks, drives, offers |
| Real evidence: their GitHub, LeetCode, Codeforces, assessments, defences | Fixture profile responses ("demo fixture") |
| Reference content with a stated source (skill taxonomy, question banks) | Numbers on the site that were not measured |
| Empty states when there is no data yet | Filler content to make a page look full |

Test fixtures stay, but only inside the test suite and a local developer harness. They never ship in the production build and never touch the production database.

## 2. What is synthetic today (audit)

| Where | What | Action |
|---|---|---|
| `db/seeds/001_demo_seed.sql`, `020_synthetic_demo_tenant.sql`, `scripts/generate-demo-seed.mjs`, `seed-demo.mjs` | Fake tenants, students, marks, drives | Never run against production. Move out of `db/seeds` into `db/fixtures` (tests only). |
| `apps/api/src/demo-server.ts`, `v2/demo.ts` | PGlite database, persona sign-in, demo issuer seed | Developer and test only. Excluded from the production image. |
| `apps/web/lib/session.ts`, `app/login/page.tsx`, `WorkspaceShell.tsx` | `DEMO_MODE`, persona login, "synthetic data" banner | Delete the demo path from the web app. Real sign-in only. |
| `v2/config.ts` `DemoFixtureProfiles`, `v2/judge.ts` `LocalJudge` | Simulated LeetCode/Codeforces checks, local code runner | Production already refuses them; make the code unreachable instead of config-guarded. |
| `apps/web/app/page.tsx` and landing components | "Rahul", "Nimbus Analytics", "SQL to L2 unlocks 2 drives", orbit and flow examples | Rewrite with product-neutral copy (see 4.2). |
| Seed category school-marks shift (SC −9, ST −11 …) | Invented bias pattern | Delete with the seed. |
| `db/seeds/010_skill_taxonomy.sql`, `015_assessment_banks.sql` | Generated reference data | Keep as reference content, but audit provenance (see 5). |

## 3. Principles

1. **Real data needs real participants.** The code can be perfect and the site is still empty until a college or volunteers join. The plan therefore includes a pilot, not just code.
2. **Consent before data.** No student record is created or shown until the student has accepted a notice. Under-18 students need verifiable parental consent.
3. **Empty is honest.** Every page has a designed empty state and a "what to do next" action.
4. **Small numbers are not statistics.** Cohort and fairness views hide or caveat groups below a minimum size.
5. **Nothing is shown that was not measured.** Landing-page claims come from the pilot or are removed.
6. **Production is built, not seeded.** Production starts from migrations plus reference data only.

## 4. Workstreams

### 4.1 Environments and safety (do first)

- Three environments: local (fixtures, tests), staging (test accounts you create, never public), production (real only). Separate Supabase projects, separate keys, separate issuer seeds.
- Fix the unguarded `migration-runner` test so it can never apply migrations to a project it was not pointed at on purpose. Require an explicit opt-in variable.
- Decide the fate of the current Supabase project (migrations 017-025 were applied by mistake). Recommended: treat it as staging, create a fresh production project, apply migrations from a clean state, enable point-in-time recovery.
- Production guard script, run in CI and at deploy: fail if the DB contains any seed tenant id or name, if `NEXT_PUBLIC_DEMO_MODE` is set, or if the web bundle contains the demo login path.
- Secrets in a secret store (issuer seed, GitHub client secret, LLM keys, SMTP). Rotate anything that has appeared in a log or chat.

### 4.2 Website content

- Landing page: replace named personas and invented drives with neutral, true statements about how the product works. Use real screenshots only from the pilot, with written permission and no personal data visible.
- Remove "Try the demo". Replace with "Request access for your college" (a real form that creates a lead, with consent text).
- No customer logos, testimonials or statistics until they exist. A "How the pilot is going" section may be added later with measured numbers and dates.
- Login: real email and password plus magic-link and password reset. The "no college has added you yet" message becomes a proper request-access page.
- Footer: privacy notice, terms, grievance officer contact, data protection contact.

### 4.3 Real onboarding (new product surface)

Findings: staff invites exist (`/api/v2/tpo/members`); there is no college signup, no student roster import, no academics import, no company onboarding, no drive creation route. Build:

1. **College tenant creation** by a platform admin after manual verification (institution code, affiliation letter). Self-serve signup is out of scope.
2. **Staff invites** with email verification and role assignment (admin, placement officer, coordinator, mentor).
3. **Student roster import**: placement officer uploads a CSV (name, college email, enrolment number, branch, year). Rows are validated, deduplicated and previewed before commit; the import is audit-logged with a file hash.
4. **Student claim**: student receives an invite, verifies the college email, reads the notice, gives consent. Under-18: guardian consent flow (the guardian consent tables exist).
5. **Academic records import**: registrar or officer uploads marks; each student must confirm their own record before it is used for eligibility. Disagreements go to the existing appeals path. DigiLocker, APAAR and Academic Bank of Credits are a later phase, only if API access is granted.
6. **Company and recruiter onboarding**: the placement officer invites a recruiter against a verified company email domain. No open recruiter signup.
7. **Drive creation** from a real job description and the college's real eligibility policy, with the existing versioned rules.
8. **Outcome recording**: officers record offers and joins; the university view aggregates them.

### 4.4 Real evidence and integrations

| Capability | Needs from you | Notes |
|---|---|---|
| GitHub import | A GitHub OAuth app, production callback URL | Read-only scope, tokens encrypted (cipher exists). |
| LeetCode and Codeforces ownership checks | Nothing, set `EXTERNAL_PROFILES_LIVE` | Public endpoints with rate limits and a failure mode that says "could not check", never a fake pass. Review each site's terms. |
| Code execution for assessments and the probe | A self-hosted Judge0 server | Needs isolation, resource limits, no network from sandboxes. Without it, code assessments stay disabled. |
| AI interviews and drafts | An LLM key with a spend cap | AI proposes only. Log prompts without personal data. |
| Email | A sending domain with SPF, DKIM, DMARC | Needed for invites, magic links and notices. |
| Eligibility Pass | A production issuer seed in the secret store | Publish the issuer public key at a stable URL. |

### 4.5 Fairness and analytics on real data

- Category data is sensitive. Collect it only if the college already holds it lawfully and needs it for the fairness audit. It is used only for aggregate audits, never for ranking or visible to recruiters.
- Four-fifths checks on small groups are noisy. Set a minimum group size, show counts, and label results as indicative below it. Never auto-flag a group of a handful of students.
- University and cross-college views use small-cell suppression (hide groups below the threshold).
- Remove every number on analytics pages that does not come from a query.

### 4.6 Privacy, legal and trust (gate for going live)

These need a lawyer or your institution's counsel; I can draft documents but not give legal sign-off.

- Roles: the college is the data fiduciary, PRAMAAN is the processor. Written data processing agreement with each college.
- Privacy notice and consent text in English, Hindi and Marathi, reviewed by native speakers.
- Minors: verifiable parental consent before processing.
- Retention schedule and automated deletion; student export and erasure (routes exist, test them with real accounts).
- Breach response runbook and a named contact.
- Check obligations and timelines against the DPDP Act 2023 and the notified Rules as they apply on your launch date.
- Security review before go-live: RLS inventory on the production project, dependency audit, a restore drill from backup, rate limits, log scrubbing.

### 4.7 Pilot (what makes the data real)

- Option A, preferred: one college with a placement officer who agrees to a pilot. Scope: roster import, one real drive run in **shadow mode** (PRAMAAN decides in parallel; the officer's usual process stays authoritative).
- Option B, if no college is available in time: a volunteer pilot of real students you know (their own GitHub and coding profiles, their own consent). Honest label: "volunteer pilot", not "college deployment".
- Measure from day one: time from drive posting to shortlist, number of appeals and outcomes, proof level progression, rule changes after fairness checks. These real numbers replace every assumption in the pitch deck.

## 5. Reference data provenance

Skill taxonomy and assessment question banks were generated by a script. Before production:

- Record the source of each taxonomy entry. Map to public frameworks where licences allow (NSQF/NCVET qualification packs, O*NET, ESCO). Do not copy text that is not openly licensed.
- Question banks: replace generated questions with ones written or reviewed by faculty, or licensed. Keep an author and review date per question. Never reuse a question that is public in a way that makes the probe answerable by lookup.

## 6. Phases and exit criteria

| Phase | Work | Exit criteria |
|---|---|---|
| 0. Safety | 4.1, decision on current Supabase project, secrets | Production project exists and is empty; guard script passes in CI; restore drill done |
| 1. Remove synthetic | Sections 2 and 4.2 | Production web bundle has no demo path; no persona text on any public page; seeds moved to test fixtures |
| 2. Onboarding | 4.3 items 1-5 | A new college can be created, staff invited, roster imported, a student can claim and consent end to end with real email |
| 3. Evidence | 4.4 | One real student can import GitHub, verify a coding profile, take a probe, and receive a real pass |
| 4. Drives and outcomes | 4.3 items 6-8, 4.5 | A real drive runs through rules, fairness check, decisions, and offers |
| 5. Trust | 4.6, section 5 | DPA and notices signed off, security review closed, native-speaker review done |
| 6. Pilot | 4.7 | One shadow-mode drive completed, real metrics recorded |
| 7. Release | Gates below | All gates green |

## 7. Release gates (automated where possible)

- No demo code in the production bundle or image.
- No seed tenant ids or names in the production database.
- Every page renders a designed empty state with an empty database (tested).
- Every number on the site traces to a query, a cited source, or is removed (checked by review).
- RLS inventory passes on the production project.
- Consent required before any student data is stored or shown.
- Backup restore tested.

## 8. What I can do and what needs you

I can build: removal of the demo path, landing and login rewrite, the onboarding surfaces, CSV imports, empty states, guard scripts, drafts of notices and the processing agreement, the pilot metrics.

Only you can provide: a college or volunteers, a production Supabase project, a GitHub OAuth app, a Judge0 host, LLM and email credentials, legal review, and written permission from anyone whose data appears.

## 9. Decisions needed

1. Pilot route: college (A) or volunteer pilot (B)?
2. Current Supabase project: keep as staging and create a fresh production project (recommended), or use it as production?
3. Should the offline demo stay for developers only, or be deleted entirely?
4. Do you hold, or can you get, college marks and category data, or do we start with student-entered and officer-confirmed data only?
