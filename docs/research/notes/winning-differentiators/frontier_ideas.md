# Frontier additions beyond PRAMAAN's current feature set (AI-era hiring, placement and skill verification, 2024-2026)

Scope and method. This builds on `docs/research/campus-placement-novelty-landscape.md`, which I read first. I did not repeat its findings (Superset, Unstop, HackerRank Chakra, Karat, LL144 audits, NAD/DigiLocker, SD-JWT RFC 9901 and so on). About 45 web searches and fetches were run across arXiv, ACM/AAAI proceedings, vendor and engineering blogs, and GitHub. Search-tool answers were mostly snippets; the few full-page fetches are noted. Every "not found" below means "not found in public web search". It is not proof of absence. I did not search patents, and I could not see vendor docs behind demos. Statements labelled **[Inference]** are mine. Build-effort numbers are my estimates for a 2 to 3 person student team who already have the PRAMAAN rule DSL, probe runner, SD-JWT and consent ledger.

Shortlist at a glance (details and evidence in the sections below):

| # | Candidate | Novelty confidence | Effort (days) |
|---|---|---|---|
| 1 | Verifiable Offer Ledger (employer-signed offers, committed placement statistics) | Medium-high | 5-6 |
| 2 | Placement Season Twin (policy wind-tunnel: one-offer, tiers, upgrade rules, drive scheduling) | Medium-high | 8-10 |
| 3 | Decision-Rights Proof (solver proves no agent can ever finalise or publish) | Medium-high | 6-8 |
| 4 | Signed Approval Receipts plus public transparency log | Medium | 5-6 |
| 5 | Decision-Invariance Red-Team Arena (attacks fail, replay shows decisions unchanged) | Medium-high | 5-6 |
| 6 | Fair Allocation Audit (stable/fair benchmark, envy graph, price of fairness) | Medium-high | 8-10 |
| 7 | Verifiable Lottery that doubles as a randomised experiment | Medium-high | 5-7 |
| 8 | Intervention Truth Meter (staggered DiD/SDID with power and "not enough evidence" verdicts) | Medium | 6-8 |
| 9 | Disclose-then-Defend (AI-provenance notes steer the probe) | Medium-high | 6-8 |
| 10 | Contribution Court (blame-surviving lines, co-signed splits, scoped probes) | Medium-high | 7-9 |
| 11 | Shortlist Fragility and requirement elasticity for recruiters | Medium | 4-6 |
| 12 | Rater-severity calibration for interview panels | Medium-high | 5-7 |
| 13 | Canary-and-Twist text interview (webcam-free relay detection as a routing signal) | Low-medium | 4-5 |
| 14 | Proof Freshness half-life fitted from re-probe data, plus re-probe scheduler | Low-medium | 4-5 |
| 15 | Conformal readiness intervals with live coverage check | Low-medium | 3 |

Dropped or demoted because it already exists (see the last section): JD-based skill-demand forecasting, keystroke/ZK process attestation, AI voice oral exams as such, generic "stable matching for placements" as an automatic assigner, plain recruiter-side counterfactual ML explainers, spaced-repetition-style skill expiry as a standalone idea.

---

## (a) Can a placement officer test policies before running a season (digital twin)?

### Takeaway
No product or open-source tool was found that lets a placement officer edit eligibility rules, one-student-one-offer, dream/super-dream tiers and upgrade thresholds, then see season-level outcomes with uncertainty. The research ingredients (agent-based hiring simulations, counterfactual policy simulation) exist outside campus settings. Indian tier and upgrade rules are real, college-specific and codifiable, which makes them a good simulator target.

### Cited Findings
- Searches for "placement season simulator / digital twin" returned only candidate-facing job simulations and vendor career-fair simulations (Forage, Finsimco, Edumundo), not officer-facing policy simulators. No digital-twin placement tool surfaced. — [Search sample: Finsimco campus recruitment](https://finsimco.com/recruitment/campus-recruitment), [Edumundo](https://www.edumundo.com/en/business-simulations/catalogue/virtual-placement)
- GitHub search for "placement simulator / what-if policy / eligibility simulation" returned only placement-management apps and per-student ML placement predictors (decision trees, Flask, Brain.JS), none with editable policy scenarios. — [example: Placement Prediction and Management System](https://www.github.com/27px/Placement-Prediction-and-Management-System)
- Dream/super-dream tiers and one-offer limits are set per college and differ a lot. Sathyabama treats 5.5 to 10 LPA as Dream and over 10 LPA as Super Dream, and requires a minimum CTC jump (1.5 LPA for Dream, 3 LPA for Super Dream) before a student with an offer may apply up. An IIIT policy page requires the second CTC to be at least 1.5 times the first, allows one offer per category, and a 15 LPA offer makes a student ineligible for further jobs (institution name per search summary; verify before citing). A student guide describes a commonly seen "2x" upgrade rule and says to check each college's policy. — [Sathyabama](https://www.sathyabama.ac.in/node/225), [IIIT policy page](https://placements.iiitdm.ac.in/students), [PapersAdda slotting guide](https://papersadda.com/article/dream-super-dream-day-1-company-slotting-2026/)
- Slotting is negotiated, and day-1 slots are scarce. At IIT Bombay, companies are allotted days by agreement with the placement cell. IIT group placement guidelines (AIPC) fix Day 1 as 1 December for large Group-1 IITs. — [InsideIITB](https://insightiitb.org/placements-part-1/), [AIPC Guidelines](https://research.iitmandi.ac.in/main/placements/files/AIPC_Guidelines_Updated.pdf)
- Closest research. Cerrato, Dawid and Kramer (AIES 2026) build an agent-based hiring-and-promotion simulation comparing a status-quo policy with an oracle policy, and argue stage-wise individual fairness does not control group inequality over time. Parasurama et al. use counterfactual policy simulation on a two-stage pipeline. "Fair Pipelines" shows fairness composes across stages. A SIMIO simulation of student-to-company allocation (Celik and Alpaslan, 2023) exists, but I only saw search-tool snippets of it, not the paper. — [Cerrato et al.](https://ojs.aaai.org/index.php/AIES/article/view/43166), [Parasurama](https://parasurama.github.io/jmp/hiring_with_fairness_constraints.pdf), [Fair Pipelines](https://arxiv.org/pdf/1707.00391), [Celik and Alpaslan (link attribution uncertain)](https://dergipark.org.tr/en/download/article-cite-file/1406738/type/2)
- Market-design evidence that reneging and exploding offers matter: markets with exploding offers and binding acceptance are less efficient, and allowing cheap reneging helps. — [Niederle and Roth](https://stanford.edu/~alroth/papers/MarketCultureAEJMicro.pdf)

### Inferences
**Candidate 1: Placement Season Twin (policy wind-tunnel).** [Inference throughout this block.]
- Description: The officer edits a "season policy" (one-offer or multi-offer, tier thresholds, upgrade rule such as 1.5x CTC, hard ceiling, drive calendar, rule changes that PRAMAAN's DSL already versions). The twin runs a few hundred Monte Carlo seasons over a cohort. The cohort is real PRAMAAN data where consent allows, otherwise a synthetic cohort seeded from the college's past drive sheets. Output is a fan chart of placed share by week, who is stranded (never eligible, or locked out by the one-offer rule), seat utilisation per tier, a "queue-jumping" index for top students holding offers while others have none, and per-group rates with intervals. Two policies can be compared side by side. This extends the existing publish-time fairness check from one rule to the dynamics of a whole season (cross-drive interactions, offer capacity, upgrades).
- Closest existing: Cerrato et al. agent-based hiring simulation (research, firm-side, no campus tiers); Parasurama et al. counterfactual pipeline simulation. No product found.
- What is new: officer-facing, bound to the real versioned rule DSL, encodes Indian tier and upgrade norms as first-class policy objects, reports intervals rather than a single "forecast".
- 30-second demo: split screen with two policy cards ("One offer, no upgrade" versus "Tiered upgrade at 1.5x"). Press Run. Two fan charts animate week by week, a red "stranded students" counter diverges, and one click shows the 12 students who would be locked out.
- Effort: 8-10 days (simulator core 3-4, policy objects 2, UI 3). Reuse the rule evaluator.
- Main risk: behavioural parameters (acceptance, reneging, recruiter selectivity) are assumed, so outputs can be mistaken for predictions. Mitigate by labelling it "scenario analysis", showing parameter sensitivity, and calibrating to last year's outcome if the college has it.
- Novelty confidence: **Medium-high.** Searched: "placement season simulator digital twin", "campus placement what-if policy simulation github", "multi-stage hiring pipeline simulation fairness". Found only career-simulation vendors, management apps, and generic hiring-pipeline research. Not seen: vendor documentation behind demos (Superset, Unstop analytics).

### Gaps
- No institution-level data on real acceptance and reneging rates in Indian campus drives was found, so calibration would rely on the college's own history.

---

## (b) Fair matching of students to capacity-limited, tiered drives, and what two-sided fairness research says

### Takeaway
The matching literature is mature and directly relevant (reservations in India, capacity, envy-freeness, correlated evaluations), but I found no placement tool that uses it. Campuses do not centrally assign students, so the realistic product is an audit and advisory benchmark, not an automatic assigner. That framing is also the safer and more novel one.

### Cited Findings
- Sonmez and Yenmez analyse India's vertical, horizontal and overlapping reservations and propose the 2SMG mechanism, which they report a High Court rediscovered and the Supreme Court endorsed in 2020 (Saurav Yadav v. State of UP). It is about admissions and jobs allocation, not campus recruitment. — [arXiv 2102.03186](https://arxiv.org/abs/2102.03186v2), [Econometrica 2022 listing](https://profiles.wustl.edu/en/publications/affirmative-action-in-india-via-vertical-horizontal-and-overlappi/)
- A companion paper designs a direct matching mechanism for India with comprehensive affirmative action. — [arXiv 2004.13264](https://arxiv.org/pdf/2004.13264)
- Kumar and Vishnoi (2025) model two institutions with capacity and two groups, with biased scores (factor beta) and correlation between institutions' evaluations (gamma). Representation falls sharply when evaluations are weakly correlated and biased, and reserving capacity in proportion to group size gives a ratio of 1 for any beta and gamma in their model. Results rest on stylised assumptions (uniform attributes, two groups, one shared preference order). — [arXiv 2510.23628](https://arxiv.org/html/2510.23628v2)
- Tomita and Yokoyama (2026) show that maximising matches (social welfare) in reciprocal recommenders is unfair in recommendation opportunities, and a Nash-social-welfare method achieves nearly envy-free recommendations. Job recommendation is a listed application, but no employer-capacity model was found. — [arXiv 2601.13609](https://arxiv.org/pdf/2601.13609)
- Do et al. give a Lorenz-dominance framework for two-sided fairness in rankings. — [arXiv 2110.15781](https://arxiv.org/pdf/2110.15781v1.pdf)
- Kleinberg and Raghavan show a Rooney-style requirement can raise both representation and the employer's payoff, depending on bias size and quality distribution. Emelianov et al. show group-specific noise ("implicit variance") can make fairness constraints raise utility. — [Kleinberg and Raghavan](https://drops.dagstuhl.de/opus/volltexte/2018/8323), [Emelianov et al.](https://arxiv.org/abs/2006.13699)
- Stable matching under distributional constraints can lack a stable solution, and existence can be NP-hard; an integer-programming student-to-company allocation was well received in one project course. — [AAMAS 2024 snippet](https://ifaamas.csc.liv.ac.uk/Proceedings/aamas2024/pdfs/p372.pdf), [arXiv 1711.04484](https://arxiv.org/pdf/1711.04484)
- Sequential offers: multi-round mechanisms help students learn preferences, but off-platform options create justified envy. — [NBER w34105](https://www.nber.org/papers/w34105)
- No arXiv or industry source on formal mechanism design for IIT-style day-1 slotting was found; only descriptive accounts. — [Search: IIT placement mechanism](https://insightiitb.org/placements-part-1/)

### Inferences
**Candidate 6: Fair Allocation Audit.** [Inference.]
- Description: For a finished or simulated season, compute benchmarks the officer can see: the outcome of a student-optimal deferred-acceptance run, a capacity-reserved variant, and a Nash-welfare envy-minimising variant, all on the same consented data and the same eligibility rules. Then show the gap between what happened and the benchmarks as an envy graph ("34 eligible students had higher-tier seats go to students ranked below them on the company's own stated criterion"), and a price-of-fairness curve (total tier-weighted offers versus minimum group placement rate). Used as a pre-season advisor: "capped drive, 40 seats, 180 eligible, here is the expected competition and where each student's portfolio of applications is most likely to leave them with no offer."
- Closest existing: academic only (Sonmez and Yenmez; Kumar and Vishnoi; Tomita and Yokoyama). No product found.
- What is new: a placement-officer benchmark that shows how far actual allocation is from stable/envy-free, uses Indian reservation structure where relevant, and quantifies correlated screening ("monoculture") when all recruiters rely on one shared test.
- 30-second demo: a Sankey of students to drives (actual versus fair benchmark), a toggle that animates which students' outcomes change, and a single number: "Envy pairs: 34 versus 6."
- Effort: 8-10 days (solver with OR-tools or a hand-rolled DA 3, envy metric 2, UI 3).
- Main risk: employers rank in their own opaque process, so "company preference" must be a proxy (assessment score). Never use it to auto-assign students. Group-specific rules in private recruitment are legally sensitive; keep category data at college level and aggregate-only.
- Novelty confidence: **Medium-high.** Searched: "campus placement stable matching fairness capacity", "Sonmez Yenmez India reservations", "two-sided fairness job matching exposure capacity". Found strong theory, zero campus-placement products. Not seen: any private ERP or TPO tool internals.

### Gaps
- No empirical data was found on how correlated Indian recruiters' evaluations actually are, so Kumar and Vishnoi's gamma would have to be estimated from the college's own shared-test usage.

---

## (c) Causal measurement of interventions (workshops, learning paths) with honest uncertainty

### Takeaway
Standard methods exist (staggered DiD, synthetic DiD, lottery-based identification, causal forests) and are used in education and labour programmes. No placement platform was found automating them with power analysis and refusal-to-conclude behaviour. Small single-college cohorts are the main danger, so honesty about power is the differentiator.

### Cited Findings
- Synthetic difference-in-differences (Arkhangelsky, Athey, Hirshberg, Imbens, Wager) is in the AER 2021; Callaway and Sant'Anna give group-time effects for staggered adoption. — [AER](https://www.aeaweb.org/doi/10.1257/aer.20190159), [Callaway and Sant'Anna](https://arxiv.org/pdf/1803.09015v3)
- Campus-based placement-service evaluation with DiD exists (American Job Centers co-located on community-college campuses, Rutgers). — [Rutgers EERC](https://www.smlr.rutgers.edu/sites/smlr/files/Documents/Centers/EERC/capsee-american-job-centers.pdf)
- A causal-forest field experiment on student financial-aid renewal found forest rankings can be non-monotonic and differ from unbiased estimates; a Dutch thesis reports causal forests cannot produce correct effect estimates with few observations; a 2026 EDM paper estimates heterogeneous tutoring effects from learning logs. — [arXiv 2310.08672](https://arxiv.org/pdf/2310.08672), [EUR thesis](https://thesis.eur.nl/pub/49844/), [EDM 2026](https://educationaldatamining.org/wp-content/uploads/2026/proceedings/2026.EDM.full-papers/2026.EDM.full-papers.85.pdf)
- When seats are oversubscribed and rationed by lottery, the lottery is an identification source; with imperfect take-up, LATE and propensity-score approaches apply. — [Abdulkadiroglu et al.](https://cowles.yale.edu/sites/default/files/2022-09/d2080.pdf), [IZA DP 10429](https://docs.iza.org/dp10429.pdf)
- No lottery-assigned training-workshop evaluation turned up in my search; school-choice lotteries dominate. — [same sources](https://cowles.yale.edu/sites/default/files/2022-09/d2080.pdf)
- A drand beacon gives publicly verifiable randomness every minute, run by the League of Entropy; commit-before-draw is the key protocol rule (RandHound); a vendor (Public House) uses a published drand round to seed housing lotteries. — [Cloudflare](https://blog.cloudflare.com/inside-the-entropy/), [RandHound paper](https://ieee-security.org/TC/SP2017/papers/413.pdf), [Public House](https://public-house-support.super.site/lotteries-waitlists/how-the-public-house-lottery-draw-works)

### Inferences
**Candidate 7: Verifiable Lottery that doubles as a randomised experiment.** [Inference.]
- Description: Oversubscribed resources (workshop seats, mock-interview slots, mentor hours, capped-drive application seats) are allocated by a lottery seeded from a pre-announced drand round. Rankings are `hash(round_randomness, student_id)`, so any student can re-derive the result in the browser. Because the draw is random among eligible applicants, PRAMAAN can later report the effect on drives unlocked or offers with an honest interval (intent-to-treat, plus complier effect when take-up is imperfect). Waitlisted students get the resource next cycle (stepped-wedge), which answers the "withholding help" ethics objection.
- Closest existing: Public House drand lotteries (housing); Angrist-style lottery evaluations (schools). Not found: any placement or training platform doing either.
- What is new: the pairing of public verifiability for fairness with an automatic causal readout.
- 30-second demo: a draw screen showing "drand round 12345 (committed 10 minutes ago)", a Verify button that recomputes the order client-side and turns green, then a later effect panel with a forest plot and a wide interval and the words "not enough students yet to say".
- Effort: 5-7 days (beacon fetch and verify 2, draw plus ledger 2, ITT/LATE with bootstrap 2, UI 1).
- Main risk: tiny N gives wide intervals (this is honest, but judges may find it anticlimactic); drand availability, so cache and fall back to a delayed round. Check any scheme against college policy on discretionary allocation.
- Novelty confidence: **Medium-high.** Searched "publicly verifiable lottery drand fair allocation", "oversubscribed lottery workshop causal". The components exist; the combination in this setting was not found.

**Candidate 8: Intervention Truth Meter.** [Inference.]
- Description: For non-randomised interventions (a cohort-wide Python bootcamp, a new mock-interview programme), run staggered DiD or synthetic DiD against comparison cohorts or sections, with a pre-trend check, a permutation or bootstrap interval, and a minimum detectable effect calculator. The dashboard answers "did it work" in three possible verdicts: "supported", "no detectable effect", or "cannot say: need about N more students". It ranks interventions by estimated effect only when intervals support it. Deliberately avoids causal forests at single-college N.
- Closest existing: causal-forest targeting for student nudges (arXiv 2310.08672); SDID software; Rutgers AJC DiD. No placement product found; vendor dashboards (e.g., skill-gap tools such as FacePrep Pulse listed in the existing landscape report) appear descriptive. **[Inference]** that they do not do causal estimation, since none of their public pages claim it.
- What is new: a refusal-to-overclaim UI plus power-aware verdicts, wired to PRAMAAN's own verified outcomes.
- 30-second demo: two interventions side by side, one with a tight interval ("+9 points, 95% interval 2 to 16, pre-trends flat") and one greyed out with "cannot say".
- Effort: 6-8 days (estimator and placebo tests 4, power calc 1, UI 2).
- Main risk: parallel-trends assumption is untestable in short histories; a bad verdict damages trust. Always show the assumption in plain words.
- Novelty confidence: **Medium** (method standard; product application not found, evidence limited to public pages).

### Gaps
- Typical Indian single-college cohort sizes versus the minimum detectable effects of these designs were not quantified; the team should compute them from its own pilot data.

---

## (d) Skill decay, half-life and proof freshness

### Takeaway
Half-life regression and forgetting curves are well established in language learning, but I found no hiring or placement product that fits a per-skill decay from re-test data and uses it in eligibility. The widely quoted "2.5-year half-life" figures are secondhand heuristics, so any decay model must be fitted from the platform's own re-probe results.

### Cited Findings
- Settles and Meeder's half-life regression (Duolingo, ACL 2016) predicts memory half-life from practice history; it reduced prediction error to about half that of the earlier Leitner scheduler per Duolingo. Zaidi et al. (2020) extend it per user and knowledge component. — [ACL 2016](https://preview.aclanthology.org/fix_video/P16-1174.pdf), [Duolingo blog](https://blog.duolingo.com/how-we-learn-how-you-learn)
- Industry "skill half-life" numbers (2.5 to 5 years, about 4 years, under 2.5 years for digital fields) are secondhand reports without published derivations. — [The Interview Guys](https://blog.theinterviewguys.com/your-resume-has-a-half-life-now-why-the-skill-that-got-you-hired/), [Workera](https://www.workera.ai/blog/measurable-too-late-the-hidden-cost-of-waiting-for-a-skill-to-settle)
- A "trust decay" agent-skill listing applies configurable decay curves to verification age; its own page says real security impact cannot be fully quantified. This is the only tool-level decay product seen and it concerns agent skills, not human skills. — [ClawHub trust-decay-monitor](https://clawhub.ai/andyxinweiminicloud/trust-decay-monitor)
- No source applied HLR or spaced-repetition modelling to professional certification renewal or hiring eligibility. — [Search: half-life regression certification](https://blog.duolingo.com/how-we-learn-how-you-learn)

### Inferences
**Candidate 14: Proof Freshness half-life plus re-probe scheduler.** [Inference.]
- Description: Treat each verified proof as a memory trace. Fit a half-life per skill family from re-probe outcomes (even 5-minute micro-probes) with a Bayesian prior that starts wide. Eligibility checks consume a freshness probability, not a binary expiry date. A scheduler picks the cheapest micro-probe set that restores the most drive eligibility before the next drive deadline.
- Closest existing: Duolingo HLR (vocabulary), trust-decay for agent skills. PRAMAAN already has an Expired state, so the new part is fitted decay and scheduling.
- 30-second demo: freshness rings on a skills page shrinking day by day via a time slider, then "Refresh 2 skills in 14 minutes to keep 5 drives".
- Effort: 4-5 days.
- Main risk: no data to fit in six weeks, so half-lives will be priors; claim that honestly. Differentiation over the existing expiry state is modest.
- Novelty confidence: **Low-medium.** Searched "skill half-life decay proof freshness credentials" and "HLR certification renewal". Not searched in depth: vendor certification-renewal programmes.

**Candidate 15: Conformal readiness intervals.** [Inference.]
- Description: Replace the point readiness forecast with split-conformal prediction sets that carry a stated coverage and a live coverage check on held-out students. Sets widen automatically for small cohorts and early in the semester.
- Closest existing: Morsomme and Smirnov 2019 (grades, course recommender); an FAU dissertation on conformal sets for student performance. — [Morsomme](https://proceedings.mlr.press/v105/morsomme19a.html), [FAU](https://digitalcommons.fau.edu/etd_general/269/)
- 30-second demo: forecast band that visibly narrows as proofs accrue, with a "Coverage on last season: 88% (target 90%)" chip.
- Effort: 3 days. Risk: coverage can drop under distribution shift (seen in a QA-domain conformal study). Novelty: **Low-medium**, since precedent exists in education and only the placement application is new.

### Gaps
- No peer-reviewed estimate of software-skill depreciation for entry-level engineers was found.

---

## (e) Team-contribution verification

### Takeaway
Existing work estimates contribution from git logs, blame and LLM summaries, and its own authors call these proxies. No system combines blame-surviving authorship, per-member understanding probes on claimed files, and co-signed contribution splits.

### Cited Findings
- LLM contribution summarisation using PyDriller reports in large proportion what students actually did but sometimes misses contributions; it cites GitCanary for productivity metrics. — [arXiv 2505.17710](https://arxiv.org/html/2505.17710v1)
- TRACE (Oct 2025, revised Jan 2026) mines repositories, communication analytics and ML for individual effort; its authors caution these are proxies. — [arXiv 2510.03998](https://arxiv.org/pdf/2510.03998v3)
- A 2026 study of three course cohorts found AI involvement appears in prose, not structured commit metadata, and only 29.5% used explicit disclosure per one summary. — [arXiv 2606.14054](https://arxiv.org/pdf/2606.14054)
- No search hit addressed detection of AI-generated code in student repositories for team attribution. — [arXiv 2505.17710 search](https://arxiv.org/html/2505.17710v1)

### Inferences
**Candidate 10: Contribution Court.** [Inference.]
- Description: Three layers. (1) Authorship by surviving lines, using `git blame` on HEAD with whitespace and move detection, so commit padding does not count. (2) Each member gets a scoped mutation probe limited to the files and modules they claim, so the credential reads "Backend, auth module, probe-verified" not "contributed to project". (3) Members co-sign the contribution split; disagreement over a threshold flags the project for officer review. Output is a role-scoped credential claim.
- Closest existing: TRACE, LLM contribution summarisation, GitCanary. All activity-based.
- What is new: converts activity into verified understanding per member and adds co-signed claims. The prior landscape report ranked this "high novelty but niche"; the delta here is the co-signing and blame-surviving metric.
- 30-second demo: a repo treemap coloured by surviving-line author, four avatars each launching a 3-minute probe on their own region, then a split donut that turns from "claimed 40/30/20/10" to "verified 55/25/20/0" with a flagged member.
- Effort: 7-9 days; depends on the existing probe runner.
- Main risk: needs four live participants for the demo (use seeded repo plus two live testers); a sceptical judge may ask about pair programming, so allow a "paired" tag.
- Novelty confidence: **Medium-high.** Searched "team project contribution verification git AI-generated 2025 arXiv"; found only activity-based approaches.

### Gaps
- No evidence on how blame-based authorship behaves on AI-heavy student repositories; needs a small internal test.

---

## (f) Agent-safety designs for hiring agents

### Takeaway
Strong security primitives exist for agents in general (capability-based interpreters, information-flow control, formally analysable authorization, signed mandates, Merkle logs), and hiring-specific blog posts discuss tamper-evident trails. No hiring or placement product was found that provides a machine-checkable proof that an agent cannot finalise a decision, nor a public red-team scoreboard. These can be built from open components in a few days each.

### Cited Findings
- CaMeL (Google DeepMind, ETH) separates control and data flow and attaches capabilities to values via a custom interpreter. The paper reports 77% of AgentDojo tasks with provable security versus 84% undefended; that 77% is a utility figure, not an attack-block rate. Code is open-sourced. — [arXiv 2503.18813](https://arxiv.org/pdf/2503.18813)
- FIDES (Microsoft) tracks confidentiality and integrity labels, applies policy deterministically, and defines policies so prompt-injected inputs cannot trigger consequential actions. A related critique notes deterministic defences can lower task completion. — [arXiv 2505.23643](https://arxiv.org/pdf/2505.23643v2), [Microsoft Research](https://www.microsoft.com/en-us/research/publication/securing-ai-agents-with-information-flow-control/)
- Cedar policies can be compiled to SMT (cvc5) so analyses such as equivalence and deny-all return counterexamples; `cedar-policy-symcc` is a Rust crate; SymCert verifies the analyses in Lean. I did not find an explicit "never allows" query documented, though it follows the same pattern **[Inference]**. — [Cedar paper](https://arxiv.org/pdf/2407.01688), [symcc crate](https://rust-digger.code-maven.com/crates/cedar-policy-symcc), [SymCert](https://cdn.amazon.science/9f/c9/5d18658a41c48628b686493aa327/scipub-approval152134-46496997-symcert-verifying-smtbased-policy-analyses.pdf)
- Google's AP2 models user authorisation as signed mandates carried as verifiable credentials, with SD-JWT per some sources (sources disagree on mandate names and encoding; the spec itself was not read). — [Spark summary](https://www.spark.money/research/google-ap2-agent-payment-protocol), [Affinidi docs](https://docs.affinidi.com/products/affinidi-trust-fabric/agent-gateway/concepts/protocols/ap2/)
- Rekor-style transparency logs provide Merkle inclusion proofs verifiable offline, signed tree heads and witnesses, with a 1-of-n honest-witness assumption; monitoring is needed for detection. — [Chainguard Rekor intro](https://edu.chainguard.dev/open-source/sigstore/rekor/an-introduction-to-rekor/), [transparency.dev](https://transparency.dev/articles/logs-a-verifiable-transport-layer/)
- Practitioner post describes tamper-evident audit trails for hiring AI (signatures, per-agent hash chains, external anchors, human approval signed into the receipt). It is a DEV blog, not validated; treat as a design reference. — [DEV: VAP/PAP](https://dev.to/veritaschain/building-tamper-evident-audit-trails-for-hiring-ai-a-technical-deep-dive-into-vap-pap-1fbm)
- Resume prompt injection is measurable: about 200,000 real resumes analysed, roughly 1% had hidden injected content, more than 90% of detected injections without explicit instructions (the study did not test whether they succeeded, for ethical reasons); ACL 2026 controlled experiments found injection helps when few candidates use it and collapses when widespread; a separate benchmark tests LLM vulnerability. — [arXiv 2605.28999](https://arxiv.org/html/2605.28999v1), [Duke](https://pratt.duke.edu/news/thwarting-prompt-injection/), [LetsDataScience on Baxi et al.](https://letsdatascience.com/news/researchers-measure-resume-screening-prompt-injections-7032c127), [arXiv 2512.20164](https://arxiv.org/pdf/2512.20164v2)
- Search for invariance or metamorphic tests of LLM resume screening returned only the injection papers above. — [same sources](https://arxiv.org/html/2605.28999v1)

### Inferences
**Candidate 3: Decision-Rights Proof.** [Inference.]
- Description: Express "who may do what" as policies (agent role, officer role, student, recruiter). A solver proves properties over every possible request, for example "no request exists in which an agent principal is allowed to `finalise_eligibility`, `publish_rule`, `override_decision`, or `export_to_recruiter`", and prints a counterexample when a policy edit breaks it. CI runs the proof on every commit. Pair with FIDES/CaMeL-style integrity labels in code: any value derived from agent output carries an "untrusted-proposal" label and the decision store rejects it without an officer signature.
- Closest existing: Cedar SymCC, FIDES, CaMeL as general tools; vendor claims of "human decisions" (HireVue) per the prior report. No hiring product with a machine-checked decision-rights proof was found.
- What is new: formal, checkable decision-rights for a placement system, shown live.
- 30-second demo: a "Prove" button runs and shows green "UNSAT: no request lets any agent finalise a decision (checked 1,842 policy paths)". A dev toggle adds a bad permission and the solver prints the exact offending request in red.
- Effort: 6-8 days (Cedar symcc via a small Rust service or Z3-wasm over a simplified authorization model, 4; wiring and CI, 2; UI, 1).
- Main risk: the proof covers the policy model, not the implementation or the LLM. State it explicitly ("proves the permissions, not the model"). Cedar-symcc may be hard to embed; fall back to Z3.
- Novelty confidence: **Medium-high.** Searched "tamper-evident audit AI hiring agent human-in-the-loop", "FIDES information flow", "Cedar formal verification". No hiring-specific formal proof found.

**Candidate 4: Signed Approval Receipts plus a public transparency log.** [Inference.]
- Description: When an officer approves an agent proposal (drive schedule, rule edit, override), a passkey-signed receipt binds the officer identity, the proposal hash and the diff shown. Receipts and every agent action are appended to a Merkle log with public signed checkpoints that an external witness (for example a GitHub repository or a transparency service) co-publishes. A "Verify decision" page lets an auditor check inclusion, consistency and that a human signature exists for each consequential change.
- Closest existing: AP2 mandates (payments); Rekor (software supply chain); the VAP/PAP blog (hiring). No product found for placement.
- What is new: end-to-end verifiable human approval for hiring agents, usable as NAAC/DPDP evidence of oversight.
- 30-second demo: click any admitted or rejected student, see the chain "agent proposed 10:02, Officer Rao approved 10:07 (signature OK), included in log checkpoint #88"; press "Tamper" to flip one byte and watch verification fail red.
- Effort: 5-6 days.
- Main risk: overlaps with the existing consent ledger and agent-proposal design, so scope it as the cryptographic layer on top. A log only helps if someone monitors it; ship a simple monitor script.
- Novelty confidence: **Medium** (components well known; the placement application not found; the prior report already scored proposal-only agents "low-medium").

**Candidate 5: Decision-Invariance Red-Team Arena.** [Inference.]
- Description: A harness that replays N real or synthetic decisions with adversarial inputs and asserts the decision hash is unchanged. Attack library: hidden resume text (white-on-white, zero-width), README and docstring injections in student repos, malicious company emails to the scheduling agent, rubric-leak prompts in interview transcripts, and unicode lookalike tricks. Counts: attacks attempted, attacks that changed the agent's proposal, attacks that changed any final decision (target 0 by construction because the agent has no write path). Publish the results table with attack seeds.
- Closest existing: resume-injection measurement and benchmarks (arXiv 2605.28999, 2512.20164), AgentDojo-style evaluation in CaMeL and FIDES. No placement-specific public arena found.
- What is new: a decision-level invariance metric (not just a model-level injection success rate) and a public scoreboard.
- 30-second demo: scoreboard "412 attacks, 37 changed an agent's proposal, 0 changed a final decision", with a live button where a judge pastes their own injection and watches the proposal change but the decision hash stay put.
- Effort: 5-6 days (attack corpus 2, harness 2, UI 1-2).
- Main risk: "0 by construction" can seem trivial to a sceptic; the honest value is showing proposals do get fooled (so the human gate matters) and that no path to a decision exists. Pair with Candidate 3 for credibility.
- Novelty confidence: **Medium-high.** Searched "hidden prompt injection resumes metamorphic invariance"; only measurement papers and benchmarks found.

### Gaps
- I could not confirm whether any Indian placement vendor offers signed approvals or agent audit logs; vendor product docs were not visible.
- The exact Cedar "never allows" query syntax was not checked against Cedar's own documentation.

---

## (g) Explainability beyond reason codes (counterfactuals, "what would change this decision")

### Takeaway
Student-side recourse is already in PRAMAAN. The research on counterfactual explanations is large, but recruiter-side "how close is each shortlist decision to flipping" with exact computation on verified evidence was not found as a product. For rule-based eligibility, exact analysis is possible without black-box counterfactual generation.

### Cited Findings
- Recourse literature favours minimal interventions over nearest counterfactuals because feature independence rarely holds; hiring examples ("if your CV included Python, you would be invited") exist; a 2020 marketplace paper lists realism, sparsity and efficacy as criteria (attribution via search summary). — [arXiv 2010.02419](https://arxiv.org/pdf/2010.02419), [MC3G](https://aitopics.org/doc/arxivorg:046ADAF2)
- A patent describes ranking candidates with an ML classifier and generating counterfactuals in a hiring marketplace. — [US11836633B2](https://patents.google.com/patent/US11836633)
- "Ranking Facts" provides fairness, stability and diversity widgets for rankings; its stability widget exposes sensitivity to small input changes. — [arXiv 1804.07890](https://arxiv.org/pdf/1804.07890)
- No 2025 recruiter-facing "what would change this shortlist" product or paper was found. — [Search results above](https://arxiv.org/pdf/1804.07890)

### Inferences
**Candidate 11: Shortlist Fragility and requirement elasticity.** [Inference.]
- Description: For a recruiter's shortlist built from evidence-based criteria and scorecard marks, compute exactly (a) the candidates who would drop out under a plausible perturbation (threshold plus or minus delta, one rater swapped, one proof expiring) and the ones who would enter ("one verified proof away"), (b) an elasticity curve of eligible-pool size versus each requirement, flagging thin pools ("raise the CGPA bar to 7.5 and the pool falls from 62 to 9"), and (c) a stable-core shortlist of candidates who stay in under all tested perturbations.
- Closest existing: Ranking Facts stability widget (general); student-side recourse (PRAMAAN). No recruiter-facing product found.
- What is new: recruiter-side counterfactuals computed exactly on verified evidence, designed to prevent arbitrary cut-offs. Distinguish from the existing rule-repair feature: this is about the recruiter's shortlist and scorecards, not the fairness of the published rule.
- 30-second demo: a shortlist with fragile rows highlighted amber, a slider for the cut-off that live-redraws the pool curve, and a chip on each row "Out if one rater scores 1 lower".
- Effort: 4-6 days.
- Main risk: recruiters may game cut-offs knowing sensitivity; show the information to the placement officer and the recruiter at publish time only.
- Novelty confidence: **Medium** (stability widgets and counterfactual literature exist; a recruiter-side evidence product not found).

### Gaps
- I could not verify the content of arXiv 2010.02419 and the cited patent beyond search-tool summaries.

---

## (h) Interview integrity against AI assistance without webcam surveillance

### Takeaway
The evidence base is weak: vendor blogs, anecdotes and a few preprints. Detection heuristics lack validated error rates, and keystroke or behavioural-biometric approaches raise privacy objections. Any webcam-free design should be a routing signal into a verification step, never a verdict. Process-based assessment research (2026) supports shifting to competence verification.

### Cited Findings
- April 2026 preprint argues for shifting from authorship policing to competence verification from accumulated evidence (not peer reviewed). — [Preprints.org 202604.0989](https://www.preprints.org/manuscript/202604.0989)
- Condrey (Feb 2026, arXiv) proposes zero-knowledge process attestation over keystroke-dynamics evidence; the author is tied to a company (WritersLogic) and results are self-described. — [arXiv 2603.00179](https://arxiv.org/html/2603.00179v1), [arXiv 2603.00177](https://arxiv.org/pdf/2603.00177)
- Writing teachers object to document-history checks as surveillance. — [EdSurge](https://edsurge.com/news/2024-12-20-should-instructors-ask-students-to-show-document-histories-to-guard-against-ai-cheating)
- "Trojan horse" hidden-text prompts: one lecturer hides an instruction in the prompt and treats a hit as a conversation starter, not proof; reported counts come from forum reposts, and screen-reader users may trigger false hits. — [Newsweek](https://mag.newsweek.com/teacher-clever-hack-catching-students-using-chatgpt-essay-1893623)
- AI voice oral exams: an NYU Stern professor ran 36 oral finals with an ElevenLabs agent at about $15 total; reports on student stress disagree (83% versus 93%). — [The Decoder](https://the-decoder.com/nyu-professor-fights-ai-cheating-with-ai-powered-oral-exams-that-cost-42-cents-per-student/)
- Vendor guidance recommends process-over-output questions and combining AI-resistant questions with proctoring; there is a small chance an AI solves them. — [TestDome](https://support.testdome.com/support/solutions/articles/44002458427-ai-resistant-questions)
- No arXiv 2025 paper on webcam-free interview integrity was surfaced. — [Search: softwareseni et al.](https://www.softwareseni.com/navigating-the-ai-interview-crisis-a-strategic-framework-for-technical-hiring-leaders)

### Inferences
**Candidate 13: Canary-and-Twist text interview.** [Inference.]
- Description: Two webcam-free layers for text or chat interviews. (1) Per-session canary tokens: a short hidden-from-view instruction embedded in the question payload (inside an accessibility-safe channel, flagged for screen readers via aria-hidden handling and an accessible alternative) that an LLM relay would obey, producing a marker phrase. A hit does not fail the candidate; it schedules a **twist** follow-up: the same concept re-asked with a changed constraint on the candidate's own project, which an unprepared relay answers poorly. (2) The same twist route is triggered by response-time and verbosity anomalies, again as routing only. All thresholds and false-positive rates measured on the team's own volunteer testers and published.
- Closest existing: Trojan-horse prompt (single teacher, anecdote), NYU voice orals, Fabric-style probability flags in the prior report.
- What is new: using the canary as a routing signal into a follow-up probe plus an accessibility-safe design plus a published error audit; none of the pieces is new alone.
- 30-second demo: judge plays "cheater", pastes the question into a chatbot and pastes back the answer; the screen shows "marker detected: routed to twist question, no penalty" and the cheater then fails to answer the twist.
- Effort: 4-5 days.
- Main risk: trivially defeated by a candidate who retypes or strips hidden text; accessibility false positives; weak evidence base. Do not present as a detector.
- Novelty confidence: **Low-medium.** Searched "interview integrity AI assistance without webcam", "Trojan horse hidden prompt"; found only anecdotal and vendor material.

**Related add-on, not a standalone candidate:** Candidate 9 (below) is the stronger webcam-free integrity story because it uses disclosed process metadata, not behavioural biometrics.

### Gaps
- No validated false-positive rate for any webcam-free detection heuristic was found.

---

## (j) 2025-26 work on verifiable skills, proof of competence and process-based assessment that could be productised

### Takeaway
The strongest productisable thread is provenance metadata for AI-assisted code (Agent Trace, git-ai) plus course-level evidence that disclosure is rare. It lets a platform capture process evidence without keystroke logging or webcams. Pure keystroke or ZK-process attestation exists and is privacy-heavy.

### Cited Findings
- Agent Trace is a draft, vendor-neutral spec (proposed by Cursor, CC BY 4.0) for recording which lines came from AI, humans, mixed or unknown contributors; storage is unspecified; legal ownership is a non-goal. — [github.com/cursor/agent-trace](https://github.com/cursor/agent-trace), [InfoQ](https://www.infoq.com/news/2026/02/agent-trace-cursor)
- Git AI is an open-source Git extension storing line-level AI attribution in Git Notes (`refs/notes/ai`) that survives rebases, squashes and cherry-picks; sources disagree on how closely it implements Agent Trace. — [usegitai.com](https://usegitai.com/track-ai-code)
- Editrail visualises student-AI interaction in edit histories for instructors. An HCI-course study found tool disclosure rose from 0% to 66% of repositories across three cohorts, but attribution of what the tool did remained a minority practice. — [Editrail arXiv 2601.20085](https://arxiv.org/html/2601.20085v1), [arXiv 2606.14054](https://arxiv.org/pdf/2606.14054)
- Mutation-based behaviour-change probes are used mainly to test LLMs (49.3% accuracy in the prior report), supporting the strength of PRAMAAN's own probe. — [arXiv 2602.17838](https://arxiv.org/abs/2602.17838) (from the prior report)

### Inferences
**Candidate 9: Disclose-then-Defend (AI provenance steers the probe).** [Inference.]
- Description: Students may attach AI-provenance notes (git-ai or Agent Trace records) to a consented repository. PRAMAAN shows per-file disclosed AI share, then aims the Live Mutation Probe at the AI-attributed regions and at undisclosed regions with stylistic or churn anomalies. The credential says "AI-assisted (disclosed 62%), understanding verified". Disclosure is rewarded, not punished, because the verifier is comprehension. Notes are forgeable, so they are a routing hint, not proof.
- Closest existing: Agent Trace spec, git-ai, Editrail (instructor visualisation), course studies of disclosure. None feeds a verification probe or a credential, to my search.
- What is new: provenance as input to probe targeting and credential wording, keystroke-free by design; also a policy norm ("disclose and defend") that works with AI-heavy students.
- 30-second demo: a repo heat-map with disclosed AI lines in blue; click "Defend this" and the probe opens on exactly those functions; the finished credential shows the AI-share chip and the green verified badge.
- Effort: 6-8 days (notes ingest 2, heat-map 2, probe targeting 2-3, credential field 1). Add a small CLI helper that wraps git-ai for students without tooling.
- Main risk: most students will not have provenance tooling in the next six weeks; provide a retro-tagging flow ("I used AI on these files") and treat as self-declared; spoofing means it can never raise proof level alone.
- Novelty confidence: **Medium-high** for the placement application; underlying tech is new but open. Searched "Agent Trace git-ai", "students AI usage disclosure git provenance". Not seen: vendor roadmaps.

### Gaps
- No 2025-26 source reported a hiring platform consuming Agent Trace or git-ai.

---

## (i) Recruiter-side tools: demand forecasting, evidence cards, scorecard calibration

### Takeaway
Skill-demand forecasting from job postings is an established research line (Job-SDF and others), so it is not a differentiator. Rater-severity modelling for interview panels is well known in measurement theory but I found no product or paper applying it to campus panels. Evidence cards in the style of "nutrition labels" have precedent in the ranking-label literature.

### Cited Findings
- Job-SDF (NeurIPS 2024 datasets track) forecasts monthly demand for about 2,300 skills using 10.35M Chinese job ads (counts vary slightly across versions); IBM's earlier work forecasts IT skill demand; an NCAER piece says India-relevant signals come from portals like Naukri and cautions AI methods may not fit network-hiring sectors. — [Job-SDF arXiv 2406.11920](https://arxiv.org/pdf/2406.11920v1), [IBM arXiv 2205.09508](https://arxiv.org/pdf/2205.09508), [NCAER](https://ncaer.org/publication/ai-signals-offer-new-roadmap-for-indias-future-skills/)
- Interview scoring: severity and leniency do not change validity but do change who is hired; normative feedback to interviewers can reduce differences, with effects fading. Practitioner guides recommend independent scoring, quarterly per-interviewer reviews and anchored scales. No source applied many-facet Rasch or an IRT rater-severity parameter to hiring scores. — [SHRM](https://www.shrm.org/topics-tools/news/talent-acquisition/build-consistent-hiring-decisions-with-job-interview-rating-scal), [Yardstick](https://yardstick.team/interview-questions/interview-calibration)
- Ranking Facts is the closest "label" precedent for ranked outputs. — [arXiv 1804.07890](https://arxiv.org/pdf/1804.07890)
- Kumar and Vishnoi show shared rubrics and calibration (higher evaluator alignment) can raise representation in their stylised model. — [arXiv 2510.23628](https://arxiv.org/html/2510.23628v2)

### Inferences
**Candidate 12: Rater-Severity Calibration.** [Inference.]
- Description: Panels score a shared set of anonymised calibration answers (gold anchors) and live candidates. A many-facet Rasch or ordinal mixed model estimates each interviewer's severity and each rubric item's difficulty, with intervals. The scorecard view shows a candidate's raw score and a severity-adjusted score with uncertainty ("3.4 from a harsh rater is about 4.0 on the panel scale, interval 3.5 to 4.5"). The adjusted score is used to flag, not to auto-reject, and a private mirror shows each interviewer their own drift.
- Closest existing: normative feedback (Purdue study), practitioner calibration guides. No product or paper with rater-severity parameters in hiring found.
- What is new: statistical rater calibration for campus panels, with linking through shared anchors since raters see different candidates.
- 30-second demo: a bar chart of five interviewers' severity with intervals; selecting a candidate shows raw versus adjusted scores and a flip indicator if the ranking would change.
- Effort: 5-7 days (model in Python/Stan or a simple ordinal regression, 3; anchor-answer workflow, 2; UI, 1-2).
- Main risk: needs overlapping ratings to identify severity, which real panels may not provide; anchors partly fix this. Risk of adjustment seen as opaque; keep it as a transparent audit.
- Novelty confidence: **Medium-high.** Searched "structured interview scorecard calibration interviewer severity IRT"; found only practitioner and general guidance.

**Dropped as standalone: JD-based skill-demand forecasting.** Job-SDF and IBM work already do the forecasting; campus JD volumes are tiny (hundreds), which makes forecasts weak. **[Inference]** If a judge wants a demand story, reuse the existing proposal-only agent to compile JD text into evidence requirements and show the cohort-supply gap as a nowcast, not a forecast.

### Gaps
- No evidence on how many Indian recruiters score campus interviews in a structured way, which bounds the usefulness of Candidate 12.

---

## Candidate with a different angle: verifiable placement outcomes (not in the original (a)-(j) list)

### Takeaway
Inflated or fabricated placement numbers are a documented problem and accreditation data is largely self-reported. PRAMAAN already exports NAAC/NIRF evidence; no source showed employer-signed offers, committed statistics or one-offer enforcement that a third party can verify.

### Cited Findings
- Careers360 reports testimony that colleges issue fake offer letters, sometimes using real recruiters' names via shell firms, and that students locked a college gate over allegedly fake placement figures. — [Careers360](https://news.careers360.com/placement-trap-students-share-bitter-truth-about-job-drives)
- The Leaflet's RTI-based investigation concluded AMU misrepresented law placement data and NIRF accepted it at face value; an Avanti Fellows analysis says NIRF data is self-submitted and unaudited and compares claimed well-paid graduates with national survey data (different populations, so an indicator only). — [The Leaflet](https://theleaflet.in/leaflet-reports/ctrlaltdeceive-amu-fudged-its-law-placement-data-for-years-nirf-looked-the-other-way), [Avanti Fellows](https://docs.avantifellows.org/analyses/employability/)
- No source described an official way to verify employer-signed offer letters, or an audit process for NIRF placement data. — [Careers360 search](https://news.careers360.com/placement-trap-students-share-bitter-truth-about-job-drives)

### Inferences
**Candidate 1: Verifiable Offer Ledger.** [Inference.]
- Description: The recruiter (or the officer on the recruiter's behalf, with a domain-verified email confirmation) signs an offer attestation containing company, role, CTC band, tier, joining date, and a salted commitment to the student. Attestations form a Merkle tree; the college publishes the root before NAAC/NIRF submission. The platform enforces one-offer and upgrade rules at signing time, so double offers and below-threshold "upgrades" cannot be recorded. Published statistics (median CTC, count placed) come with inclusion proofs; an external auditor samples offers and checks them without seeing student names, and the student can reveal their own offer using SD-JWT disclosure.
- Closest existing: none found for placement. Adjacent: PRAMAAN's own NAAC/NIRF exports (not verifiable by a third party) and Rekor-style logs.
- What is new: statistics that a third party can recompute and spot-check, plus policy enforcement at signing.
- 30-second demo: click the "median CTC 6.2 LPA" figure, see its Merkle proof and a sample of three offers verified; press "Inject a fake offer" and the verification and the root mismatch turn red.
- Effort: 5-6 days (offer schema and signing 2, Merkle and proofs 1-2, enforcement and UI 2). Reuse SD-JWT and the log from Candidate 4.
- Main risk: recruiter adoption; fall back to officer-attested offers with offer-letter hash and email confirmation, which weakens but does not remove the benefit. Avoid defamation: never name colleges in the pitch.
- Novelty confidence: **Medium-high.** Searched "fake offer letters placement statistics NIRF verification employer-signed"; found the problem (investigations) but no verification mechanism.

### Gaps
- No evidence on whether NAAC or NIRF assessors would accept cryptographic proofs; treat acceptance as an adoption question to ask them, not a claim.

---

## Which candidates to build, and which ideas to drop

### Takeaway
Best demo-per-day and strongest evidence of novelty: Candidate 1 (Offer Ledger), 2 (Season Twin), 5 (Red-Team Arena) with 3 (Decision-Rights Proof) as its credibility layer, 7 (Verifiable Lottery) and 9 (Disclose-then-Defend). Treat 14, 15 and 13 as small garnish or skip them. Drop ideas that exist.

### Cited Findings
- All sources and evidence are listed under the preceding sections; the dropped items below are supported by:
  - Skill-demand forecasting: [Job-SDF](https://arxiv.org/pdf/2406.11920v1), [IBM](https://arxiv.org/pdf/2205.09508).
  - Keystroke and ZK process attestation: [Condrey](https://arxiv.org/html/2603.00179v1) and [EdSurge objections](https://edsurge.com/news/2024-12-20-should-instructors-ask-students-to-show-document-histories-to-guard-against-ai-cheating).
  - AI voice oral exams: [NYU Stern case](https://the-decoder.com/nyu-professor-fights-ai-cheating-with-ai-powered-oral-exams-that-cost-42-cents-per-student/).
  - Stable matching as theory and for admissions: [Sonmez and Yenmez](https://arxiv.org/abs/2102.03186v2), [arXiv 2004.13264](https://arxiv.org/pdf/2004.13264).
  - Student-side counterfactual recourse and plain-language explanations: already in PRAMAAN and well covered in [arXiv 2010.02419](https://arxiv.org/pdf/2010.02419).
  - Skill expiry and decay as general idea: [Duolingo HLR](https://preview.aclanthology.org/fix_video/P16-1174.pdf).

### Inferences
**Suggested six-week sequencing** [Inference]:
1. Weeks 1-2: Candidate 1 (reuse SD-JWT) and Candidate 5 (attack corpus is reusable), because both are visible in under 30 seconds and share the log from Candidate 4.
2. Weeks 2-4: Candidate 2 (Season Twin), the headline differentiator for placement officers, using the existing rule DSL and fairness simulator as its core.
3. Weeks 3-5: Candidate 3 (Decision-Rights Proof) as the safety credibility layer; Candidate 7 (Verifiable Lottery) to bring the causal story at low cost; Candidate 9 once the probe API is stable.
4. If time remains: 6 (Fair Allocation Audit, which plugs into the Twin), 10 (Contribution Court), 12, 11.

**Drops and why:**
- JD-based skill-demand forecasting (exists; thin data).
- Keystroke dynamics and ZK process attestation (exists, privacy-heavy, company-tied evidence, and conflicts with a "no surveillance" stance).
- AI voice oral exam as a product (exists; PRAMAAN's "why" follow-up already covers the idea).
- Stable matching as an automatic assigner (campuses do not centrally assign; harms student autonomy; keep only as an audit benchmark in Candidate 6).
- Student-side "what would change this decision" counterfactuals (already in PRAMAAN as Proof Path).
- "Skill half-life" as a headline (figures unverified; modest delta over the Expired state; keep only as small add-on 14).

**Cross-cutting honesty notes:**
- Do not describe any candidate as "first ever". The accurate claim is "no public prior art found in a time-boxed search".
- Candidates 2, 6, 7 and 8 rely on assumptions or small samples; the UI should show uncertainty and refuse to over-claim, which is itself a demonstrable differentiator.
- Candidate 3's proof covers permissions, not model behaviour; Candidate 9's provenance is forgeable; Candidate 13 is a heuristic. State these limits on the slide.

### Gaps
- Patent search not done (largest open risk, same as in the prior report).
- Vendor documentation behind demos (Superset, Unstop, Eightfold, HireVue, Handshake) was not accessible, so some "not found" results could be wrong on specific products.
- No pilot data from Indian colleges was available to size effects or calibrate simulators.
- Full-text verification was done only for the Kumar and Vishnoi paper (first 100k characters read). Other papers are cited from search-tool summaries or abstracts and should be re-read before quoting.
