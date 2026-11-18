# Fix honesty gaps before adding novelty

**PRAMAAN meets the problem statement only in part, and four on-screen claims are not true yet.** An audit of the repo against its 48 requirement rows found **16 done, 31 partial, 1 fake and 0 missing**. (The audit's own summary says 47 rows and 30 partial. My recount of its table gives 48 and 31, because BR-17 is split in two.) The fake item is bulk email. The most dangerous overclaims are "AI" scoring that is keyword matching, a calendar page that says students and panels cannot be double-booked, a GitHub import that never creates a skill, and a consent-revoke button that is weaker than the docs say. Most of these cost hours to fix with honest wording. Once they are fixed, the best additions are trust features: a public log with receipts anyone can verify, an employer-signed offer ledger, and a placement-season simulator. A fourth, agent-safety proofs, makes sense only if one real LLM call is added first. No search found public prior art for these in campus placement, but that is a time-boxed search, not proof, and nobody can promise selection among roughly 500 submissions.

## Limits of this report

- **Organiser and judging rules are unverified.** There is a public QUASAR series run by VPPCOE in Mumbai (editions 1.0 to 4.0). I found no public page for QUASAR 5.0 and no published scoring weights for any edition ([QUASAR 2.0 page](https://quasar-2.devfolio.co/)). The team must confirm from its own PDF that this is the same organiser.
- **The "about 500 submissions" figure comes from the team.** QUASAR 3.0 had 56 teams on site ([Free Press Journal](https://www.freepressjournal.in/amp/mumbai/quasar-30-national-level-hackathon-kicks-off-with-56-teams-competing-to-solve-real-world-challenges-at-mumbais-vasantdada-patil-pratishthan-college)). If 5.0 is similar, the cut is about 10 to 1. That ratio is my inference.
- **The original problem-statement PDF was not readable.** "Requirement" below means the wording in the repo's traceability matrix.
- **Many external claims rest on search summaries.** Pages that returned errors, and claims I could not check in the original, are marked "(search summary)". Items from memory are marked "(from memory)".
- **Effort numbers are estimates** for a team of 2 to 3 that already has the rule engine, probe runner, signing code and consent ledger. Nobody timed them.

## 1. Compliance verdict: strong core, five claims that will not survive a judge's question

### What the tests show

The offline suite ran 502 tests. Three failed on the first run because the auditor had blanked a database setting. They passed on re-run (5 of 5 in that file). Two test files (9 tests) are outside the offline list. The old live-database suite is stale: it still expects 46 tables, there are now 78, and it fails to connect. So live-database evidence cannot be reproduced today. Tenant isolation is proven only in the offline in-memory database. Static checking found forced row-level security on all 78 tables.

The 16 done rows are the skill state machine and its database trigger, eligibility rules with immutable versions, the proposal gate (agents only propose), the fairness calculator, row-level security, KPIs computed from data, reason codes in three languages, the officer dashboard, the rule builder with what-if, the proposal inbox, the fairness funnel, and the cross-checks that depend on them. These are the real strengths.

### The fake and partial items a judge can expose

| What the screen or slide says | What the code does | Honest fix |
|---|---|---|
| **Bulk email to companies** (AD-05, the one fake) | No mail library exists. "Send to all" writes `queued` rows. If `SMTP_HOST` is set, the code only sets status `sent`; nothing is transmitted. Replies are pasted by hand. No tests. | Rename the screen "Outbox preview" and stop writing `sent`. Or wire one real sender with recipient selection and a test. |
| **Calendar: panels and students cannot be double-booked** (BR-09, AD-06) | Only room clashes are blocked by the database. Student clashes show a warning. The `interview_slots` table is never written. Drives cannot be created in the product. Email parsing is regex. | Fix the sentence on the Drives page. Demo only what exists. |
| **"AI" interview, agents, probe prediction** (ST-05, BR-15, BR-11) | There is **no LLM anywhere**. Interview scoring counts keyword substrings, so pasting key terms scores 10 of 10. Every agent records `deterministic-rules-v1`. | Say "rubric-scored, no LLM" on every screen and slide. Optionally add one cached LLM call behind the proposal gate. |
| **GitHub import turns into proof** (BR-03, ST-02) | Real, hardened ingestion (56 tests, mocked GitHub only, never run against real GitHub) stops at snapshots. Nothing creates evidence, skills or probes. The demo uses a seeded repo. There is no repo picker. The demo LeetCode ownership check always passes. | Either connect ingestion to candidate evidence, or say plainly that the repo is a preloaded snapshot. |
| **Consent revoke demotes skills** (BR-13, ST-08) | **It does demote.** The auditor verified it by hand: four skills dropped and two audit events were written. But the route the UI uses does not quarantine snapshots, cancel ingestion jobs or revoke the GitHub grant. The only demotion test covers the older in-memory path. Data requests are logged but never processed. | Make the UI route match the older one and add one test for revoke, then demotion, then recruiter visibility. |

Other items a judge can reach in a minute. The "Download Excel file" button delivers CSV, and it is not the real NAAC or NIRF template. The UI says a student can "ask a person to review" an interview score, but no such button or endpoint exists. The "placement forecast" is a share of students above a threshold, with a Wilson interval, not a trained model. It is honestly captioned. Eleven mutating routes write no audit event, and the audit page has no verify button. Mock code judging runs JavaScript and SQL only. Hindi and Marathi reason text is unreviewed draft. The `[SYNTHETIC]` label is stripped from some screens, so only the banner marks the data. There are no screens to create a drive, add a company, grant a recruiter access or enter a placement outcome.

### Demo-path risks

| Risk | Detail | Mitigation |
|---|---|---|
| Restart resets the demo | The offline demo is an in-memory database. Cold start applies 25 migrations and a 13,000-line seed. Passing a problem, revoking consent or approving a proposal cannot be undone without a restart. | One-click reset, pre-warm before judging, record a backup video. |
| Slow SQL judging | SQL tests take 1.7 to 3.7 seconds each. A mock submission with several hidden tests can stall on screen. | Pre-warm. Use one small SQL problem in the demo. |
| Judge service off in production | Without `JUDGE0_URL`, code-running features switch off. The adapter handles JavaScript only. | Rehearse with it set and unset. |
| Real services untested | GitHub OAuth, LeetCode's unofficial endpoint and Codeforces were never tested live. The live Supabase project had migrations 017 to 025 applied and its keep-or-restore decision is open. | Demo on the offline path, which needs no network or keys. |

One tactical rule from judges: do not make them sign in with a personal account that asks for broad permissions ([Gleb Bahmutov](https://glebbahmutov.com/blog/winning-hackathons/)). Use a demo login or none.

### Close these first, in this order

1. **Make the AI claims true.** Wording fix: hours. A real cached LLM call is optional (my estimate: 2 to 3 days). Add a "request human review" endpoint, since the UI already promises one.
2. **Fix the mail screen and the Drives page claim.** Hours.
3. **Align the UI revoke route with the legacy route, with a test.** 1 to 2 days.
4. **Audit the 11 unlogged routes and add a "verify chain" button.** 1 to 2 days. This is a prerequisite for the log in section 2.
5. **Add outcome entry, drive creation and recruiter grants, or demo only what exists.** Outcome entry is needed by the offer ledger.
6. **Connect ingestion to evidence, or label the demo repo as preloaded.**
7. **Harden the demo:** reset button, pre-warm, `[SYNTHETIC]` labels, CSV label fixed, offline test that checks forced row-level security on every table.

Judges and guides agree on the reason. A judge account says "either it runs in front of the judges or it doesn't" and distrusts fluent agent output presented as proof of action ([Outlook India](https://www.outlookindia.com/hub4business/does-it-actually-work-rahul-taraks-decade-at-the-judging-table), possibly sponsored content). Another judge trusts entries that list known limitations ([dev.to judge](https://dev.to/amising6/what-i-learned-after-reviewing-many-ai-and-developer-projects-as-a-hackathon-judge-2g06)). Hard-coded data and "AI" that is a thin wrapper are named losing patterns (Reskilll blog, uncited, third-party).

## 2. Ranked additions: trust you can verify beats more features

### What is already built (so it is not repeated)

The earlier landscape report ranked and PRAMAAN already has: the Live Mutation Probe, publish-time fairness simulation with rule repair, drive-unlock recourse, predicate-only SD-JWT eligibility passes, versioned rules with appeals, a proof ladder with Open Badges 3.0 credentials, proposal-only agents, a consent ledger and a hash-chained audit log. Note two audit corrections. The probe runs on seeded repos and JavaScript only. The agents are rules, and they run inside the officer's own database transaction, so the planned "agent role with no write grants" is not implemented.

Why trust features: the incumbents are racing on automation. Superset claims 1,400+ institutions and Unstop launched seven hiring agents in July 2026 ([Superset](https://joinsuperset.com/); [Tribune](https://www.tribuneindia.com/news/business/unstop-launches-seven-ai-agents-to-automate-end-to-end-enterprise-hiring/)). The weak spot is trust. Vendors flagged 48% of technical AI interviews, but with no disclosed false-positive rate ([Fabric](https://fabrichq.ai/blogs/state-of-ai-interview-cheating-in-2026-insights-from-19-368-interviews)). Only 9% of corporates call freshers job-ready on day one, against 68% of students ([HirePro](https://hirepro.in/resources/news/only-9-of-corporates-say-fresh-college-graduates-are-job-ready-on-day-1-while-68-of-students-believe-they-are-hirepro-report)). Fake placement offers are reported ([Careers360](https://news.careers360.com/placement-trap-students-share-bitter-truth-about-job-drives)). The Leaflet's RTI-based investigation says NIRF accepted misreported placement data ([The Leaflet](https://theleaflet.in/leaflet-reports/ctrlaltdeceive-amu-fudged-its-law-placement-data-for-years-nirf-looked-the-other-way)).

### Summary table

"Novelty confidence" means how strongly my searches suggest no public prior art. It is never "first ever". "Effort" is in person-days (estimate). The search depth behind each rating was one to three queries.

| Rank | Addition | Closest existing thing | Novelty confidence | Effort | Demo impact | Main risk |
|---|---|---|---|---|---|---|
| 1 | **Verify-us spine:** public log with witness-signed checkpoints, student-held receipts, "Replay this decision", signed fairness certificate | Certificate Transparency and Rekor for software; one research-phase hiring proposal; one patent application | High for placement, medium-high for hiring | 10 to 14 | Very high: tamper, then verify fails | Proves consistency, not truth of the data |
| 2 | **Verifiable Offer Ledger:** employer or officer signed offers, one-offer and upgrade rules enforced at signing, published statistics with proofs | None found for placement; adjacent to the log | Medium-high | 5 to 6 | High: click median CTC, see proof, inject fake offer | Recruiter adoption; needs outcome entry first |
| 3 | **Placement Season Twin:** officer edits one-offer, tier and upgrade rules and sees season outcomes with ranges | Hiring-simulation research; career-simulation vendors | Medium-high | 8 to 10 (MVP 6) | High: two fan charts, stranded-student counter | Assumed behaviour numbers read as predictions |
| 4 (conditional) | **Agent proof and red-team scoreboard:** solver-checked "agents cannot finalise or publish" and a live injection scoreboard | Cedar, CaMeL and FIDES for general agents; resume-injection studies | Medium-high (proof), medium (scoreboard) | 8 to 10 incl. real agent role | High if an LLM exists; hollow if not | Proves permissions, not the model |
| Garnish | DPDP erasure receipts (per-student keys), Bhashini voice and audio reasons, status-list revocation | Crypto-shredding is common; Bhashini is public | Medium; medium; low-medium | 4 to 6; 3 to 4; 2 to 3 | Medium | Regulator acceptance unknown |

### 1. The verify-us spine

**What it is.** PRAMAAN's hash chain is checkable only by someone holding the whole chain, and the operator can show different histories to different people. A transparency log uses a Merkle tree, so a student can check one receipt with a short proof. Independent witnesses cosign checkpoints so the log cannot be split ([Russ Cox on transparent logs](https://research.swtch.com/tlog); [C2SP cosignature spec](https://github.com/C2SP/C2SP/blob/main/tlog-cosignature.md)). Sigstore's Rekor v2 reached general availability in October 2025 on a tile-based design ([Sigstore blog](https://blog.sigstore.dev/rekor-v2-ga/)). Three thin layers sit on top. The student's "why not eligible" screen gets a Replay button that re-runs the pure rule evaluator on the stored inputs and compares hashes (the notes' own estimate: 3 to 4 days if the evaluator is pure, which I did not confirm in code). Each published rule gets a signed fairness certificate carrying the impact ratio, the Fisher p-value, the shortfall in students, the rule hash and the code version. A verifier page recomputes it.

**Novelty evidence.** Existing fairness evidence is retrospective: Eightfold publishes an annual New York audit ([Eightfold](https://eightfold.ai/trust/bias-audit-results/)). I found no per-rule, machine-verifiable certificate before publication. The closest hiring prior art is a research-phase proposal that its author calls an illustrative sketch, not a library ([VeritasChain post](https://dev.to/veritaschain/building-tamper-evident-audit-trails-for-hiring-ai-a-technical-deep-dive-into-vap-pap-1fbm)), and a patent application that mentions Merkle roots with no candidate-facing proofs ([USPTO 11876916](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11876916)). The honest pitch is "Certificate Transparency for eligibility rules".

**Risks and limits.** Say on screen that a certificate proves the calculation, not that the group labels were right. Keep personal data out of log entries (salted commitments only), or the log fights DPDP erasure. The notes did not find a browser-side tile verifier library, so the verifier may need writing (from the notes, unconfirmed). The IETF SCITT standard is now RFC 9943, but mirrors disagree on its date.

### 2. Verifiable Offer Ledger

**What it is.** The recruiter, or the officer after an email confirmation from the company's domain, signs an offer record: company, role, pay band, tier, joining date, and a salted commitment to the student. Records form a Merkle tree. The college publishes the root before NAAC or NIRF filing. The rule engine enforces one-offer and upgrade limits at signing. The headline statistic, such as median CTC, links to a proof and a sample of verified offers. Students can reveal their own offer with SD-JWT disclosure.

**Novelty evidence.** Placement fraud is documented. I found no way to verify employer-signed offers and no audit process for self-submitted NIRF data. The Avanti Fellows analysis says NIRF data is self-submitted and unaudited ([Avanti Fellows](https://docs.avantifellows.org/analyses/employability/)). It also closes a real gap: the audit found no screen to enter outcomes, and the NAAC export is only CSV.

**Risks.** Recruiters may not sign. The fallback is officer-attested offers with an offer-letter hash and email confirmation. That is weaker, so label it. Do not name real colleges in the pitch. Nobody has checked whether NAAC or NIRF assessors would accept proofs. Treat that as a question to ask, not a claim.

### 3. Placement Season Twin

**What it is.** The officer edits a season policy: one offer or many, Dream and Super Dream thresholds, upgrade rule, hard ceiling, drive calendar. A few hundred simulated seasons run over the cohort. The output is a range of placed share by week, stranded students, tier seat use, and per-group rates with intervals. Two policies compare side by side. Real colleges differ widely. Sathyabama requires a pay jump of 1.5 LPA for Dream and 3 LPA for Super Dream before a student may apply up ([Sathyabama](https://www.sathyabama.ac.in/node/225)). That variety is what makes policy testing useful.

**Novelty evidence.** Searches found only student-facing career simulations and per-student prediction apps. Research simulates hiring pipelines outside campus settings ([Cerrato et al., AIES 2026](https://ojs.aaai.org/index.php/AIES/article/view/43166)). I found no officer-facing policy simulator tied to a versioned rule engine. The rule evaluator and fairness simulator already exist, so this extends them from one rule to a whole season.

**Why it matters for the brief.** The audit rates predictive analytics (AD-03) as a formula, not a model. The Twin turns that into honest scenario analysis with ranges, which is a stronger answer than a fake "prediction".

**Risks.** Acceptance and reneging rates are assumed. No data on them was found. Call the output "scenario analysis", show a sensitivity table, and never show a single forecast number. Build the MVP first: two policies, one tier rule, one cohort (my cut, about 6 days).

### 4. Agent proof and red-team scoreboard (build only with a real LLM)

**What it is.** Write "who may do what" as policies. A solver then proves that no request exists in which an agent can finalise, publish or export. A scoreboard replays about 100 attacks (hidden resume text, repo comments, hostile company emails) and shows two numbers: how often the agent's proposal changed, and how often a final decision changed. Cedar's symbolic analysis supports this kind of check ([Cedar paper](https://arxiv.org/pdf/2407.01688)). Resume injection is real: about 1% of 200,000 real resumes carried hidden injected text, though the study did not test whether it worked ([arXiv 2605.28999](https://arxiv.org/abs/2605.28999)).

**Why it is conditional.** Today the agents are regex rules. A scoreboard that tests regexes is hollow, and a sharp judge will say so. The "AI can only propose" claim is also enforced in code, not by database grants. So first add a real LLM call behind the proposal gate, and create the restricted agent database role (about 2 extra days). Then the proof and scoreboard mean something. The notes also warn that "0 by construction" can look trivial. The value is showing that proposals do get fooled while no path to a decision exists. Say "this proves the permissions, not the model". Whether Cedar's solver runs cleanly from TypeScript on Windows CI was not verified.

**If the LLM call is not added,** swap slot 4 for the garnish items below.

### Garnish, in value order

- **DPDP erasure receipts.** Per-student keys, destroy the key on erasure, signed receipt in the log. It closes the audit's "data requests never processed" gap. Most DPDP duties start 13 May 2027 ([PIB explainer](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf); the Rules PDF itself returned an error, so dates rest on secondary sources). Say "verifiable key destruction", never "proof of erasure". No regulator was found saying key destruction counts as deletion.
- **Bhashini audio and voice.** Public APIs are proof-of-concept only; production or paid use needs a Bhashini agreement ([Bhashini docs](https://bhashini.gitbook.io/bhashini-apis)). Use it for Hindi and Marathi spoken reasons. Show transcripts for correction and promise no accuracy figure.
- **Revocation by status list.** The IETF Token Status List was in the RFC Editor queue in the notes (a draft, not yet an RFC). Revocation is standard in credential stacks, so do not call it new.

### Considered and not recommended now

| Idea | Reason |
|---|---|
| Disclose-then-Defend (AI-provenance notes steer the probe) | Depends on ingestion feeding the probe, which is not connected. Agent Trace is a draft spec ([Cursor](https://github.com/cursor/agent-trace)), and notes are forgeable. |
| Contribution Court, Verifiable Lottery, Fair Allocation Audit, Intervention Truth Meter | Each is 5 to 10 days, niche, or limited by tiny samples. Good roadmap slides. |
| Zero-knowledge fairness proof | Heavy and risky (10 to 14 days). Real zero-knowledge in credentials is still draft-stage. |
| Skill half-life, conformal bands, canary text interviews | Small delta over what exists, or weak evidence. |
| JD-based demand forecasting, keystroke tracking, AI voice orals as products | They already exist, or conflict with a no-surveillance stance. |
| Live DigiLocker or NAD access | Needs partner approval, a digital signature and an audit. The SOP says no temporary test access ([DigiLocker SOP](https://cf-media.api-setu.in/resources/Partners-SOP.pdf)). Show a spec-faithful adapter on the API Setu sample-data sandbox, labelled "simulated". |

## 3. Recommended plan: gaps first, then one shared spine

**Assumption.** The submission deadline is unknown to me. This plan assumes about four build weeks and a team of 2 to 3. If you have two weeks, do weeks 1 and 2 only. If you have two people, drop slot 4. Total estimate for all four additions plus gap closing is about 50 person-days. That is tight even for three people.

| Week | Build | Done when |
|---|---|---|
| **1: Make it true** | Wording fixes (AI, mail, Drives page, CSV). Revoke route aligned and tested. 11 routes audited and a verify button added. Outcome entry. Reset button, pre-warm, `[SYNTHETIC]` labels. Decide the LLM question. Collect 3 user comments from a TPO or faculty member. | A rehearsed demo path in which every on-screen claim is true. |
| **2: Spine** | Log with checkpoints and a witness (a public repo plus a second follower is enough). Receipts. Replay button. Fairness certificate and verifier page. | Tamper with one database row and the student's receipt turns red. |
| **3: Ledger, then Twin** | Offer Ledger on the same log (5 to 6 days). Start the Twin MVP. | Click median CTC, see a proof, inject a fake offer, see it fail. |
| **4: Twin finish, slot 4, polish** | Finish the Twin. If the LLM call exists: agent role, permission proof, scoreboard. Otherwise add erasure receipts. Write the deck, record backup video, test every link. | Deck, video, repo and demo agree line by line. |

**Rules for the build.**
- Build the shared signing and canonical-hash code once, then reuse it.
- Freeze features at the end of week 3. Judges can only evaluate what they can see, and broken links lose points ([DoraHacks guide](https://dev.to/dorahacks/what-does-a-good-hackathon-submission-look-like-5398)).
- Keep the 24-hour on-site format in mind. In earlier editions judges suggested changes at the start of the build ([QUASAR 2.0](https://quasar-2.devfolio.co/)), so keep modules small and easy to change. This format is not confirmed for 5.0.
- The probe stays the hero, but connect ingestion to at least one real repo, or say it is preloaded.

## 4. How to present it

### What published guidance suggests (not tested on QUASAR)

Where weights are published, working execution and completeness score highest. Google's 2026 India round weights Technical Merit 40%, Innovation 25%, Alignment 25% and UX 10% ([promptwars.in](https://promptwars.in/solutionchallenge2026.html), semi-official). SIH lists novelty as one of about nine factors and publishes no weights ([SIH guidelines](https://sih.gov.in/letters/Guidelines-College-SPOC.pdf)). Google's 2024 rubric rewards three real-user feedback points, what changed, and a demo of a "working application (not a mockup)" ([participant guide, SlideShare mirror](https://www.slideshare.net/slideshow/2024-solution-challenge-participant-guidepptx/265566208)). Judges see dozens or hundreds of entries, so open with something specific they can check. These are practitioner heuristics, not QUASAR rules. A first-person SIH winner account suggests a 3-minute script and a recorded backup, but it is unverifiable. I found no documented case of a "try to break it" demo winning. Treat it as a hypothesis, though it fits what judges say they want.

### Deck order (about 10 slides)

1. **Problem and one checkable claim.** One named user (a placement officer or a fresher), one number with its source (HirePro 9% versus 68%), one line: "PRAMAAN lets anyone check why a student was or was not eligible." Put the live link and repo here.
2. **Who is hurt, with three real comments** from a TPO or faculty member. The notes mention no such evidence. Get it in week 1.
3. **What exists today and what it misses.** Commodity loop (Superset, Unstop) versus trust gap.
4. **Hero: proof ladder and Live Mutation Probe**, with the honest line about what runs live.
5. **Verify-us spine,** with a tamper-then-fail picture.
6. **Offer Ledger,** with the fake-offer injection picture.
7. **Season Twin,** two ranges, one stranded-student counter.
8. **Evidence tags.** Mark each claim "measured", "simulated", "cited" or "projected".
9. **Architecture and one real engineering problem you solved,** plus **known limits** (no LLM or one LLM call, JavaScript and SQL only, simulated DigiLocker, draft standards).
10. **Business idea:** who pays, cost per college, 2027 dates (DPDP in May, EU high-risk duties in December, Colorado in January; the notes cite Gibson Dunn and McDermott for the last two). The finale was described as a business-idea pitch in earlier editions, so do not save this for later.

Avoid: "first ever", "revolutionary", "tamper-proof" (say tamper-evident), "bias-free" or "compliant" (say "evidence for"), "proof of erasure", and any "X% accuracy" for Bhashini. Do not present the readiness formula as a trained model.

### First 30 seconds of the live demo

| Seconds | On screen | Say |
|---|---|---|
| 0 to 8 | Demo banner "synthetic data" visible. Officer publishes a drive rule. | "A placement officer publishes a rule. Before it goes live, it gets a fairness certificate." |
| 8 to 18 | Certificate with log number. Student phone: "Why am I not eligible?" in Marathi, Replay button, hash matches. | "The student can re-run the decision in their own browser." |
| 18 to 30 | Presenter edits one database row. Verify turns red. | "Change one number and verification fails. This proves the record was not altered. It does not prove the original data was right." |

Then, in the next 60 seconds, show the Offer Ledger fake-offer injection and the Season Twin. Hand the judge the tamper button. The offline path needs no sign-in or network.

## Conclusion

The audit changes the plan. The riskiest thing in the submission is not a missing feature. It is five sentences on screen that a curious judge can disprove in under a minute. A team that states its limits (no LLM, simulated DigiLocker, scenario ranges, not a forecast) and then lets the judge break the system looks more credible than one that claims everything. Judges who value known-limitations lists and visible verification are the audience for this approach, though no one has published QUASAR's rubric.

The additions have one thing in common. Each one turns "trust us" into "check this": a receipt, a signed offer, a range with its assumptions, a proof about permissions. They share one signing and logging base, which is why they fit in four weeks when built in order. Selection cannot be guaranteed. What the plan does is make sure that if the deck gets through, the demo holds up.
