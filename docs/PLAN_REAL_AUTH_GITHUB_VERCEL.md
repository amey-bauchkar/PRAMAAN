# Plan: real sign-in, GitHub scanning and a Vercel-only deployment

Written 22 Nov 2026. It covers what leading platforms do in the browser, how to make sign-in and roles real, how GitHub sign-in and project scanning should work, and a Vercel-only deployment. Decisions taken are in section 3. Items marked **(verify)** come from memory or from sources that disagreed, and need a check against current vendor docs before we rely on them.

---

## 1. Why a student can see the coordinator's screens today

That is the **demo persona picker**, not a hole in the real system.

| | Demo (`npm run demo`) | Real (`apps/api/src/server.ts`) |
|---|---|---|
| Sign in | Buttons for every persona (`/api/demo/login`) | Supabase email and password, token verified by the API |
| Who you are | Whoever you clicked | Looked up by the verified token subject, **not by email** (stops email takeover) |
| Role | Persona | Taken from your active `memberships` row on every request |
| College | Persona | Must be one of your memberships; `x-org-id` is checked against them |
| Data | One in-memory database | PostgreSQL with forced row-level security as the `app_api` role |

What is already enforced in the real path: signature and expiry check, membership status (suspended or revoked is refused), a role list on every route, and row-level security in the database. Added now:

- `apps/api/tests/real-auth-no-persona-switch.test.ts`: the real API has no `/api/demo/*` routes, and rejects missing, forged and plain-user-id credentials.
- `apps/web/next.config.mjs`: a Vercel **production** build now throws if `NEXT_PUBLIC_DEMO_MODE=true`.

**What is missing before real users can sign in.** The API answers `403 UNREGISTERED_IDENTITY` to anyone who has no `users` row, and nothing in the code creates that row. `users.auth_subject` is meant to be filled "out of band" by a database administrator. There is no way for a college to add students, and no way for a student to claim a record. This is the real blocker, and it is Phase 1 below.

---

## 2. What leading platforms do in the browser, and where we stand

| Technique | Who does it | Works in a browser? | PRAMAAN today |
|---|---|---|---|
| Full-screen requirement, leaving it is logged | HackerRank Secure Mode, HackerEarth | Yes | Done |
| Tab and window focus tracking (count and duration) | HackerRank tab proctoring, HackerEarth, Codility | Yes | Done |
| Copy and paste restrictions or tracking | HackerRank, Codility | Yes | Done |
| Webcam face and object checks (face anomalies, objects, gaze) | HackerRank Proctor Mode | Yes (we run it on the device) | Done, 18 and over only |
| Paste behaviour, typing rhythm, retyping detection | Codility | Yes | Done as numbers only, review only |
| Code similarity across candidates, including renamed variables | HackerEarth, HackerRank | Server side | Done (limited on short answers) |
| Question design that resists AI answers | HackerEarth | Content | Partly: per-student aptitude sets, follow-up on own code |
| Reviewers see flags in a report, nothing auto-fails | Codility | Yes | Student sees flags; **officer screen not built** |
| Random webcam snapshots (HackerEarth lists two per minute, one source) | HackerEarth, others | Yes | **Not built** and in tension with "video never leaves the device" |
| Baseline photo or ID check, liveness | CodeSignal, HackerEarth | Yes | Not built |
| Second camera by phone: QR code opens a page in the phone's browser | Honorlock, Talview, Respondus, ProctorU, Mettl | Yes | Not built |
| Screen sharing (recording) | CodeSignal, Respondus | Yes, but the user picks the surface | Not built |

### Worth building next, in this order

1. **Officer review screen.** Without it flags help nobody. Codility's model (integrity report, human decides) matches the problem statement.
2. **Phone as second camera, with no video leaving the laptop.** The phone opens a page from a QR code and streams to the laptop over WebRTC peer to peer. The laptop runs the same on-device checks on both views, so no video reaches our servers. Our servers only pass the connection handshake, which fits Vercel Functions. Some networks need a relay server (TURN), which is a small third-party service **(verify)**. Honorlock says the QR code only opens a temporary web page and gives no access to the phone's files.
3. **Evidence stills only when a flag fires**, adults only, private storage, short retention, never continuous snapshots. This needs the retention rule (decision D5 in the build plan) and consent text first.
4. **Multi-monitor hint** through the browser's screen-extended flag **(verify, from memory: Chromium only)**. A weak signal, so review level only.

### Not worth building in a browser

- **Forcing "entire screen" sharing.** The W3C Screen Capture draft says the user agent must let the person choose the surface every time, and must not let a page constrain that choice. `displaySurface` is only a hint, and permission is not persisted. A page can only notice a poor choice and re-ask.
- **Virtual camera or virtual machine detection.** Only weak heuristics are possible in a page (device names, timing).

---

## 3. Decisions taken (22 Nov 2026)

| # | Question | Decision |
|---|---|---|
| 1 | Onboarding | **Invitation by the college**, claimed with a one-time link sent to the college email. No open self-registration. |
| 2 | Private repositories | **Public and private**, chosen per repository through a GitHub App. |
| 3 | Database | The existing **Supabase project, Singapore region**. Run Vercel functions in Singapore (`sin1`) so each request's database transaction stays close. |
| 4 | Locked browser | **Dropped completely.** No desktop app, no Safe Exam Browser, no kiosk mode. Integrity stays in the web checks and the server-side evidence checks. |
| 5 | Evidence stills | **Not now.** No images are stored. Revisit only with a retention rule (decision D5) and consent text. |
| 6 | Database and demo | The Supabase database already exists, so the hosted site uses it. The offline demo stays local on PGlite (it cannot work on serverless, see section 4). Migrations 032 to 034 must be applied to the existing database with `npm run migrate` before the new features work there. |

## 4. Vercel-only: what fits and what needs work

| Part | Fit | What has to change |
|---|---|---|
| Web app (Next.js 15) | Native | Remove `output: 'standalone'` for Vercel if needed. MediaPipe runtime (29 MB) is copied by `prebuild`, which Vercel runs. Models (8 MB) are committed. |
| API (Fastify) | Supported with zero config as one function on Fluid compute | Entry point must export the app instead of calling `listen`; build `packages/*` first (`@pramaan/domain` points at `dist`); keep PGlite and demo code out of the bundle. |
| Database | Needs a real Postgres | Use The existing Supabase project (Singapore), which the code already supports with its CA certificate; **not** PGlite. Row-level security uses `SET LOCAL` inside a transaction, so pooled **transaction mode** works. Use a pooled connection string and a small pool per function **(verify: Vercel's helper for closing pools)**. |
| Hosted demo | **Does not fit** | The demo runs on PGlite in memory. Each serverless instance would have its own database, so state would diverge and reset. The demo stays local; the hosted site runs in real mode on Supabase. |
| Code judge | **Does not fit as is** | The local runner (worker threads and `vm`) is not a security boundary, and production correctly disables it without `JUDGE0_URL`. Judge0 needs a server. The Vercel-only option is **Vercel Sandbox**, which runs code in a Firecracker microVM with its own filesystem and network. Needs a prototype for start-up time, cost per run, and a quota that pauses sandbox creation when exceeded. |
| GitHub scan and other long jobs | Needs a queue | A function can run for a few minutes (one Vercel page says 300 s, or 800 s on Pro; other sources disagree: **verify**). Use the existing `ingestion_jobs` table processed in steps by a cron route (`CRON_SECRET` header check; cron only on production deployments), or Vercel Queues/Workflow **(verify)**. |
| File uploads | Needs direct upload | Request bodies are limited to 4.5 MB. Certificates and lab files must go straight to storage (Vercel Blob or Supabase Storage). |
| Email | Needs a provider | `SMTP_HOST` works with any SMTP provider; nothing to host. |
| Secrets | Fine | Vercel environment variables for the issuer seed, token key, GitHub App key, LLM keys. |
| Two projects | Fine | `apps/web` and `apps/api` as two projects. Put the API behind a Next.js rewrite (`/api/*`) so the browser sees one origin and there are no cross-site cookie problems. |
| Region | Matters | Put the functions in Singapore (`sin1`), next to the Supabase database, to keep per-request transactions fast. Users in India will see roughly one extra network hop to Singapore, which is acceptable for this app. |
| Next.js middleware auth bug (CVE-2025-29927) | Not exploitable on Vercel, but a lesson | Never gate anything only in middleware. We already enforce in the API and the database. |

---

## 5. Making authentication real

Target: nobody reaches anything outside their college and role, and nobody can become someone else.

### Phase 1: sign-in with invitations (no GitHub yet) — built 22 Nov 2026

Built and tested offline: migration `034_invitations_and_claim.sql` (`pending_invites` and the `claim_invitation` function), officer routes to invite, list, revoke and reissue, `POST /api/auth/claim`, an identity-only token check, an invitations panel in the Team screen, the `/claim` page, and `npm run bootstrap:college`. Not built yet in this phase: cookie sessions and two-factor sign-in for officers. Not tested against your real Supabase project, because I cannot reach it.

To try it on your Supabase project: apply the migrations (`npm run migrate`, which needs `DATABASE_URL_ADMIN`), then create the first college and admin with `npm run bootstrap:college -- --college "..." --departments "CSE:Computer Engineering" --admin-name "..." --admin-email ...`, open the printed link, create an account with that email, and press Join.


- **Bootstrap.** A script creates a college, its first `college_admin`, and sends that person an invitation. Replaces "a DBA edits the database".
- **Invitations.** New table `pending_invites` (college, email, role, department, enrolment number, expiry, status, one-time token hash). An officer imports a student list (CSV) or adds one person. Recruiters keep their domain-proof flow.
- **Claim.** `POST /api/auth/claim` accepts a **verified** token that has no `users` row yet, plus the one-time invitation token (sent to the college email, so owning that inbox proves who you are). It creates the `users` row with `auth_subject` = the token subject, the membership, and the student record. It rejects replay, expiry, wrong college and revoked invitations. It never trusts an email claim by itself.
- **Web.** Cookie-based session (`@supabase/ssr`) so server components can redirect; the API stays the real gate. Sign out clears the cookie. Officers and admins get TOTP two-factor.
- **Tests.** A matrix of every route against every role (the existing route-safety test), plus claim attacks: replay, expired, wrong email, unverified email, token for another college, two people claiming one invitation.

### Phase 2: GitHub sign-in as identity

- Use the Supabase GitHub provider with **identity-only scopes** (`read:user`, `user:email`).
- GitHub gives **no role and no college**. A GitHub identity with no claimed invitation gets the same `403` as today.
- GitHub emails are often private or not the college address, so we do **not** match by email. The student opens the invitation link from their college inbox while signed in with GitHub, and that binds the GitHub identity to their record (Phase 1 claim).
- Allow adding GitHub to an existing email account later with Supabase identity linking.

---

## 6. GitHub scanning and the repo-based interview draft

### Two different things, keep them separate

| | Sign in with GitHub | Repo access for scanning |
|---|---|---|
| Purpose | Prove who you are | Read the student's code |
| Mechanism | Supabase GitHub provider | **GitHub App**, installed by the student |
| Access | Profile and email | **Read-only** Contents and Metadata, only on the repositories the student picks, private ones included |
| Token | Supabase session | PRAMAAN stores it itself, encrypted |

Why a GitHub App and not the current OAuth app: today's code allows only `public_repo`, which GitHub documents as read **and write** on public repositories (our comment in `github-account-service.ts` says as much), and rejects private repositories. A GitHub App's permissions are fine-grained and per repository. Its user token expires after 8 hours and is refreshed with a refresh token valid for 6 months; each refresh returns a new pair and kills the old one. Supabase does not store or refresh the provider token (its docs say the provider token is deliberately not kept), so scanning must not depend on the Supabase session. PRAMAAN stores the refresh token with the existing token cipher and rotates it.

### Pipeline (what the scan does)

1. **Install and choose.** The student installs the GitHub App and selects repositories. This is also the consent record. A webhook (signature checked) tells us when they uninstall, which revokes consent and demotes proof, as the current revocation already does.
2. **Pin.** Fetch the tree at one commit SHA, with file hashes (the existing trusted-ingestion snapshot).
3. **Scrub.** Skip secrets and junk before anything is analysed or sent to a model (`.env`, keys, `node_modules`, large and binary files). Cap file count and size.
4. **Analyse.** Existing static analysis and anchors (repo SHA, path, lines, content hash). Extend beyond TypeScript.
5. **Choose talking points.** Non-trivial functions, route handlers, queries, configuration and the student's own commits.
6. **Draft with a model.** The existing failover model client returns strict JSON (question, what a good answer covers, the anchor). The output is validated like `validateDrafts`, every anchor is re-checked against its hash, and the repository text is treated as data, never as instructions (decision ADR-04).
7. **Approve.** Drafts are inert proposals. A person (mentor or placement officer) approves before they are used. Questions are scored on content by the existing coverage judge, and the Live Mutation Probe can run on the same anchor.
8. **Coherence checks** (the problem statement names commit-history coherence): authorship against the student's commits, fork or copied-history signals, timeline sanity. Shown as facts for a person, never as an "AI-written" score, because the problem statement says never to penalise on AI-generated-code detection scores.

### Limits to plan for

- GitHub API rate limits (per token and per installation) and the function time limit, so the scan runs as resumable steps from the job table.
- Large repositories: sample, do not read everything.
- Privacy: private code must not be kept longer than needed; keep hashes and short anchored excerpts, with a retention period (decision D5).

---

## 6b. What was changed on the live Supabase project (22 Nov 2026)

Project `qshujrddrzoemlzmleru`, Singapore, Postgres 17. It held only seeded and synthetic data (5 colleges, 317 users), and had no backups (no point-in-time recovery).

| Change | Detail | How to undo |
|---|---|---|
| Migrations 031 to 035 applied | Each in its own transaction with its ledger row, exactly as `npm run migrate` does. 031 to 034 only add objects. | Drop the new objects; remove the ledger rows. |
| Public roles locked out (035) | `anon` and `authenticated` had access to all 89 tables and dozens of `SECURITY DEFINER` functions in `public`, reachable by anyone with the public anon key through Supabase's REST interface. They now have none. PRAMAAN never used that interface. | `GRANT` back (not recommended). |
| New login role `pramaan_runtime` | Same direct privileges as `pramaan_app_user` (two functions and schema usage), cannot bypass row-level security. Its password is only in the local `.env`. The existing `pramaan_app_user` was not touched. | `DROP ROLE pramaan_runtime`. |
| Auth: redirect allow-list | `uri_allow_list` from empty to `http://localhost:3000/**`. Add the production address when it exists. | Set it back to empty. |
| Auth: password length | `password_min_length` from 6 to 8, to match the form. | Set it back to 6. |
| Two test colleges | `[TEST] Setup check A` and `B`, used by the end-to-end test. They cannot be deleted because the audit log is append-only. Their test logins and invitations were deleted. | Leave them, or rename. |

**Rule for any new database login role for the API.** Giving it `app_api` with no inheritance is not enough: the API also calls two functions directly as the login role (`resolve_user_identity` and `current_app_parent_org_id`), as migrations 007 and 008 grant by name. Copy `pramaan_app_user`'s direct grants to it.

**Not changed:** site URL, open sign-up, email confirmation, the GitHub provider, custom email (SMTP).

**Known limit.** Supabase's built-in email sender allows about 2 emails per hour on this project. Password sign-up needs a confirmation email, so more than two new people an hour will be blocked until a real email provider (SMTP) is set in Supabase. Auto-confirming emails is not an option here, because the claim step relies on the email being verified.

## 6c. Project interview kit and VPPCOE (22 Nov 2026)

**VPPCOE on the live project.** The college "Vasantdada Patil Pratishthan's College of Engineering and Visual Arts (VPPCOE)" exists with three departments (`CSE` Computer Engineering, `IT` Information Technology, `ENTC` Electronics and Telecommunication; the codes match the app's branch-to-skill map). Sources disagree on its other branches, so others can be added by running `npm run bootstrap:college` again. 19 generic Practice Drive interview questions were copied in as **drafts** for the college admin to approve (the database requires a named approver). No students, drives or offers were invented for a real college: invite real students with the invitation screen. Migration 036 (kits, recruiter invitations) is applied.

**What recruiters get.** Recruiter workspace, "Project Interview Kit": pick a drive and a candidate who chose to share with recruiters, paste the GitHub profile and the resume (text or a text PDF). PRAMAAN reads the public repositories, finds each highlighted resume project among them with visible reasons, and drafts easy, medium and hard questions per project with Groq, then Gemini.

| Step | How | Limit or safeguard |
|---|---|---|
| Resume projects | Groq or Gemini reads only the Projects section, with emails, phone numbers and links removed; fixed rules if no model answers | Resume text is never stored, only its hash |
| GitHub | Public profile and repositories (200 newest), then up to 10 repositories in depth: languages, README, file list, dependency files, up to 4 central source files, 30 recent commits | Fixed host; `.env`, key and credential files are never read; secrets are scrubbed from README and code before storage or any model call; rate-limit headers decide how deep to go |
| Matching | Name, technology and description words, deterministic, with reasons. Forks are labelled | A project with no repository is reported neutrally ("ask them to show it") |
| Questions | One model call per project; every code question must cite a file that was really read, else it is dropped; template questions fill gaps and are labelled | A model only proposes. Nothing scores the candidate or claims code was written by an AI |
| Access | Same rule as candidate search (approved grant for the drive, shareable candidate); a kit belongs to the recruiter who made it | Withdrawing recruiter-sharing consent, or an erasure request, deletes the student's kits |

**How companies ask about projects (the basis for the levels).** Interviewers use a project deep dive to test ownership, judgement and reflection: what you personally built versus the team, alternatives you rejected, a hard technical problem and how you found its cause, what breaks at ten times the load, and what you would reverse and why (community interview reports from PracHub and Exponent; indicative, not official). Campus rounds at TCS, Infosys and Wipro are shorter and ask "tell me about your project", your role, the technologies and the problems faced (Naukri campus guides). So: **easy** = what and why, role, stack; **medium** = how it works through a real file, the data, testing, a problem solved; **hard** = trade-offs, scale, security, hindsight. The problem statement's own integrity method fits too: repo-specific walkthroughs and live modification, never an AI-detection score.

**GitHub sign-in setup (needs you, about 3 minutes).**
1. GitHub, Settings, Developer settings, OAuth Apps, New OAuth App. Homepage URL: your site (for now `http://localhost:3000`). Authorization callback URL: `https://qshujrddrzoemlzmleru.supabase.co/auth/v1/callback`.
2. Generate a client secret.
3. Run `GITHUB_CLIENT_ID=... GITHUB_CLIENT_SECRET=... npm run enable:github-login`, then set `NEXT_PUBLIC_GITHUB_SIGNIN=true` in `apps/web/.env.local`.
The sign-in asks only for `read:user`. Recruiters who sign in with GitHub use their own GitHub request limit (5,000 an hour instead of 60 shared) for scans; Supabase hands over that token only at sign-in, so it is kept in the browser tab only and never stored on our servers. Without it, set `GITHUB_TOKEN` (a token with no scopes) on the API.

**AI keys.** Set `GROQ_API_KEY` and `GEMINI_API_KEY` for the API (Groq is tried first, then Gemini). Without them the kit still works with fixed rules and templates and says so on screen.

## 7. Build order

| Phase | Work | Needs from you | Done when |
|---|---|---|---|
| 0 | Decisions and accounts below | Supabase, Vercel, GitHub App, model keys, email provider | Accounts exist |
| 1 | Bootstrap script, invitations, claim, tests (cookie session and two-factor follow) | Your Supabase project | A new student can claim a record; every cross-role and cross-college request is refused in tests |
| 2 | GitHub sign-in as identity | GitHub OAuth app for Supabase | GitHub identity with no invitation gets 403; with invitation it binds |
| 3 | GitHub App for repo access, token store, uninstall webhook | GitHub App | Private and public repo read works with per-repo choice; uninstall revokes |
| 4 | Scan as resumable jobs, secret scrub, anchors | Phase 3 | A 300-file repo scans without a function timeout |
| 5 | Repo walkthrough drafts, approval, scoring, coherence facts | Model keys | Approved questions cite verified anchors; a tampered anchor is rejected |
| 6 | Vercel deployment: two projects in `sin1`, rewrite, pooled database, cron, uploads, sandbox judge, preview protection | Vercel team | Whole system runs on Vercel with demo mode impossible in production |
| 7 | Officer flag review, second-camera pairing | None | Officers can review and override flags |

### Still open

- **Judge.** Prototype Vercel Sandbox (the only Vercel-only option for running student code safely). Until then production keeps code running switched off (it fails closed without an isolated runner).
- **Existing database state.** I cannot see your Supabase project. Check which migrations it already has before applying 032 to 034.

### Unverified items

Screen-extended flag; Vercel's helper for pooled database connections; function size limit; cron limits per plan; Queues and Workflow suitability; Vercel Sandbox start-up time and per-run cost; the exact function duration limits; whether WebRTC will need a relay on college networks.

---

## Sources

- Vercel: [Fastify on Vercel](https://vercel.com/docs/frameworks/backend/fastify), [Fluid compute](https://vercel.com/docs/fluid-compute), [Function limits](https://vercel.com/docs/functions/limitations), [Sandbox pricing and limits](https://vercel.com/docs/vercel-sandbox/pricing), [Sandbox GA](https://vercel.com/blog/vercel-sandbox-is-now-generally-available), [bypassing the body size limit](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions.md)
- Proctoring vendors: [HackerRank Proctor Mode](https://hackerrank-knowledge-base.help.usepylon.com/articles/5663779659-proctor-mode), [HackerRank Secure Mode guide](https://www.hackerrank.com/writing/blocking-chatgpt-hackerrank-proctoring-secure-mode-guide), [Codility Proctoring and Integrity](https://www.codility.com/1p/codility-proctoring-integrity/), [HackerEarth Smart Browser](https://www.hackerearth.com/blog/hackerearth-smart-browser), [HackerEarth proctoring](https://www.hackerearth.com/recruit/features/proctoring), [CodeSignal ID verification](https://discover.codesignal.com/rs/659-AFH-023/images/CodeSignal-Proctoring-ID-Verification-One-Pager.pdf)
- Second camera: [Talview](https://www.talview.com/blog/improving-online-proctoring-with-talviews-secondary-camera-feature), [Mettl](https://support.mettl.com/portal/en/kb/articles/dual-camera-proctoring-mobile-pairing-guide), [Honorlock workplace scan](https://tdx.umsystem.edu/TDClient/66/MOOnline/KB/Article/2738/Completing-an-Honorlock-Workplace-Scan-Photo-for-students)
- Screen capture limits: [W3C Screen Capture](https://www.w3.org/TR/screen-capture)
- GitHub and sign-in: [Supabase social sign-in](https://supabase.com/docs/guides/auth/social-sign-in), [Supabase provider token issue](https://github.com/supabase/auth/issues/1418), [GitHub App user token refresh](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens), [generating a GitHub App user token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
- Auth lesson: [CVE-2025-29927](https://nvd.nist.gov/vuln/detail/CVE-2025-29927)
