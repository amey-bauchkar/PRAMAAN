# Trust, Verification and Privacy-Engineering Techniques That Make a Placement Platform's Claims Provable (research as of 18 Nov 2026)

Method note: about 40 search/fetch calls, all through a US-only web search tool plus page fetches. Primary sources were fetched for Rekor v2 GA, IETF Token Status List status, the resume-injection paper (arXiv abstract) and the Vap-Pap post. Everything else comes from search-result summaries, so treat it as medium confidence. "Not found" means 1-3 targeted searches turned up nothing. It does NOT mean nothing exists, and it cannot see product docs behind demos, patents or sales calls. Claims should read "no public prior art found", never "first ever".

Items tagged **[from memory]** are my background knowledge and were not re-verified this session. Earlier PRAMAAN notes (`docs/research/campus-placement-novelty-landscape.md` and `docs/research/notes/*`) were read first. Nothing here repeats the Live Mutation Probe, publish-time fairness simulation, recourse engine, SD-JWT predicate passes, proof ladder, DEPA-style consent or proposal-only-agent ideas. Where a technique builds on them, the text says so.

Already in PRAMAAN and deliberately not proposed: hash-chained audit log, SD-JWT eligibility passes, OB 3.0 credentials, forced RLS, consent ledger, proposal-only agents, publish-time fairness simulation.

---

## 0. Ranked shortlist: which of the 12 to build, in what order

### Takeaway
Build the three that share one spine first (#1 transparency log, #2 fairness certificate, #8 replay). Each reuses the same canonical-hash and signing code, and together they make the demo line "don't trust us, verify us". Then add the agent firewall (#6), the red-team scoreboard (#7), and the DP meter (#4) as independent visual demos. Treat ZK fairness (#3) and BBS unlinkability (#10b) as stretch items that should only be claimed as "prototype".

### Cited Findings
- Summary table (effort, demo and novelty ratings are my estimates; see each section for evidence)

| # | Technique | What it makes provable | Effort (dev-days) | Live demo (<60 s) | Novelty confidence |
|---|---|---|---|---|---|
| 1 | Witness-cosigned transparency log + candidate-held inclusion receipts | A rule version or decision existed, in this order, and was never rewritten | 5-8 | Student verifies a decision receipt on a phone; tamper with the DB; verification fails | High (placement), Medium-High (hiring overall) |
| 2 | Signed fairness certificate + "recompute it yourself" bundle | A published rule's fairness numbers were computed from committed data by published code | 4-6 | Judge pastes the certificate into a verifier page and gets a green tick, then flips one number | High |
| 3 | ZK / commitment-based fairness audit (stretch) | Selection-rate counts are correct without revealing individuals | 10-14 (risky) | Proof verifies in the browser in seconds | Medium-High but heavy |
| 4 | Differential-privacy aggregates with a live privacy-budget meter | Recruiter/university statistics cannot be used to single out a student, with a stated epsilon | 4-5 | Recruiter keeps querying; budget bar drains; answers lock | Medium-High |
| 5 | Per-student keys + crypto-shredding + signed erasure and consent receipts | The student's data is cryptographically unreadable after erasure; the receipt is verifiable | 4-6 | Press "Erase me"; decryption fails; the log still verifies | Medium |
| 6 | Cedar policy-as-code agent firewall + capability tokens | "AI can only propose" holds for every possible request, checked by a solver | 5-7 | Ask the agent to publish; Cedar denies with a policy ID; show the CI proof | Medium-High |
| 7 | Prompt-injection red-team harness with a live scoreboard | Agents hold up against resume/JD/email attacks, measured at the tool-call level | 4-5 | Run 100+ attacks; show 0 policy violations | Medium |
| 8 | Reproducible decisions: canonical snapshot + "Replay this decision" | Any rule-based decision can be re-executed and matches the logged hash | 3-4 | Click Replay in the student's browser; hash matches; edit one input; mismatch | Medium-High |
| 9 | Process-evidence code provenance (gitsign + log timestamps) | A repo's commits were signed and logged at time T; history was not backfilled | 4-6 | Repo badge "anchored since March"; forge a commit date; flagged | Medium-High |
| 10 | Status-list revocation (+ BBS unlinkability stretch) | Passes can be revoked without a call-home; two recruiters cannot correlate one student | 2-3 (status), 5-7 (BBS) | Revoke a pass; the verifier flips; unlinkable presentations differ | Low-Medium (status), Medium-High (BBS in placement) |
| 11 | Multilingual explanation parity + accessibility evals as CI gates | Reason codes in Hindi/Marathi carry identical facts; UI passes automated a11y checks | 5-6 | Public scorecard page that turns red if a build regresses | Medium-High |
| 12 | Compliance evidence dashboard generated from the logs | EU AI Act Art. 12/13/14, ISO 42001 and DPDP controls each link to verifiable evidence | 4-5 | Click a control; see the live count and inclusion-proof link | Low-Medium (dashboards exist), Medium (log-linked) |

### Inferences
- Judges respond to "break it and watch it fail" demos more than to dashboards. Items 1, 2, 5, 6, 8 and 9 all have a tamper-then-verify moment that fits in under a minute.
- The common infrastructure is one canonicalisation function (RFC 8785 JCS), one signing key hierarchy, and one log. Building #1 first makes #2, #5, #8, #9 and #12 mostly thin layers on top.

### Gaps
- Effort estimates are mine and assume 1-2 developers who are comfortable with TypeScript. They were not benchmarked.

---

## 1. Transparency log with witness cosigning and candidate-held inclusion proofs (Certificate-Transparency / Sigstore style)

### Takeaway
PRAMAAN's existing hash chain is tamper-evident only to someone holding the whole chain, and the operator can still show different histories to different parties. A tile-based transparency log gives O(log n) inclusion proofs and consistency proofs that any outsider (student, recruiter, NAAC auditor) can check. Independent witnesses cosign the checkpoints, which blocks split-view attacks. This is a mature technique in software supply chains but I found no deployment in campus placement or hiring.

### Cited Findings
- Transparency logs are append-only Merkle-tree structures with compact proofs that an entry is included or that one log is a prefix of another. For a log of N records the inclusion proof is O(lg N). [Russ Cox, "Transparent Logs for Skeptical Clients"](https://research.swtch.com/tlog)
- The log operator need not be trusted. Public verifiability depends on witnesses, which are independent parties that check consistency. [SoK: Log Based Transparency Enhancing Technologies](https://arxiv.org/pdf/2305.01378); [Cox](https://research.swtch.com/tlog)
- C2SP's `tlog-cosignature` defines a witness's cosignature as a signature over a checkpoint. A log client can require a quorum of cosignatures before trusting an inclusion proof, which guards against split-view attacks. [C2SP tlog-cosignature](https://github.com/C2SP/C2SP/blob/main/tlog-cosignature.md)
- The witness protocol has the witness receive a checkpoint plus a consistency proof from its last-seen size. Open-source witnesses exist: Filippo Valsorda's Torchwood (`litewitness`, SQLite-backed) and transparency-dev's witness. [pkg.go.dev: torchwood](https://pkg.go.dev/filippo.io/torchwood); [pkg.go.dev: transparency-dev/witness](https://pkg.go.dev/github.com/transparency-dev/witness)
- Rekor v2 went GA on 10 Oct 2025 as a tile-backed log on Tessera, with storage backends listed as GCP, AWS, MySQL and POSIX filesystem. Tiles are fully cacheable and can be served by a CDN. The log returns an inclusion proof on upload and users are told to store it alongside the artifact. Built-in witnessing was "to be implemented soon". [Sigstore blog, Rekor v2 GA](https://blog.sigstore.dev/rekor-v2-ga/)
- Tessera is a Go library for building tile-based logs. A POSIX filesystem storage driver exists, so a small team can run it without cloud infrastructure. One README warns that adapting its tlog-tiles API into another read API loses the read-scaling. [transparency-dev/tessera](https://github.com/transparency-dev/tessera); [POSIX conformance docs](https://pkg.go.dev/github.com/transparency-dev/tessera/cmd/conformance/posix)
- IETF SCITT Architecture is now RFC 9943 (Standards Track, 2026; mirrors disagree on the month). It gives relying parties a way to verify that signed statements were registered with a transparency service, with receipts as COSE signed objects. The text focuses on software supply chain but says it applies to other statement types. [RFC 9943](https://www.rfc-editor.org/rfc/rfc9943.html)
- Public anchoring: OpenTimestamps calendar servers aggregate hashes into a Merkle tree and anchor the root in one Bitcoin transaction. The calendar servers are free, though proofs start pending and typically confirm in 10-60 minutes, sometimes hours. A TypeScript library exists (`@otskit/core`, v0.2.0 per Socket). [OTSkit/OTSkit-core](https://github.com/OTSkit/OTSkit-core); [Socket listing](https://socket.dev/npm/package/@otskit/core)
- Closest hiring-specific prior art found: the VeritasChain "VAP-PAP" proposal for hiring-AI audit trails (hash chain + Ed25519 + RFC 3161 timestamp, optional transparency log, crypto-shredding). The post says the hiring profile (PAP) is in a "research phase" and the code is an illustrative sketch, not a released library, and it does not mention Merkle trees. [VeritasChain post](https://dev.to/veritaschain/building-tamper-evident-audit-trails-for-hiring-ai-a-technical-deep-dive-into-vap-pap-1fbm)
- A search for hiring-platform transparency logs also surfaced a USPTO application on candidate tracking that mentions Merkle roots as an accumulator, with no candidate-facing proofs. [USPTO application 11876916](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11876916)

### Inferences
- **What it proves:** (a) a rule version, fairness certificate, consent receipt or eligibility decision with hash H was published at log position i; (b) the log at size n is an extension of the log at size m < n (no rewrite); (c) at least k independent witnesses have seen the same head. It does NOT prove the underlying data was true.
- **Library/standard:** Easiest low-risk route is Tessera POSIX in Go as a small sidecar, serving static tiles from any static host, with `tlog-checkpoint`/`tlog-tiles` formats and a Torchwood witness. If the team wants TS-only, a minimal RFC 9162-style Merkle tree (~300 lines) plus signed checkpoints is feasible, but then standards-compat is lost. For a witness, run a second log-follower in a GitHub Action or a college server. For public anchors, push each checkpoint to a public GitHub repo (cheap "witness") and OpenTimestamps (Bitcoin anchor). SCITT/COSE receipts are the standards story to cite.
- **Effort:** 5-8 days (Tessera sidecar + client-side verifier in browser/TS + witness + anchoring job). The browser verifier is the bulk of the demo value.
- **What the judge sees:** Student phone shows "Decision receipt: log index 4,812, checkpoint cosigned by 2 of 2 witnesses, anchored on Bitcoin (pending/confirmed)". Press Verify: green in under a second, computed locally. Then the presenter edits a rule version directly in Postgres, the daily consistency monitor fires red, and a previously valid receipt now fails against the new checkpoint.
- **Design note:** put only salted commitments and pseudonymous IDs in log entries (never names, marks or categories), or the log conflicts with DPDP erasure (see #5).
- **Novelty confidence: High for campus placement, Medium-High for hiring overall.** Search evidence: searches for "hiring platform transparency log Merkle candidates inclusion proof" returned only the general technique, the VAP-PAP research-phase proposal and one patent application. No placement, ATS or EdTech product with candidate-verifiable inclusion proofs was found. Rekor/CT/SCITT are existing transparency logs, but for software and certificates, not hiring decisions. The honest pitch is "Certificate Transparency for eligibility rules".

### Gaps
- I did not verify the current maturity of Tessera's POSIX driver or the exact module path (search results used both `transparency-dev/tessera` and `trillian-tessera`).
- I did not find a browser-side tlog verifier library; the client-side verifier may need to be written (RFC 9162 verification is short, but this is an assumption).
- Whether a witness network for private (non-public) logs would be taken seriously by a regulator is untested.

---

## 2. Signed fairness certificates with reproducible computation ("recompute it yourself")

### Takeaway
Existing hiring-fairness evidence is a retrospective PDF audit. A certificate is a signed, machine-readable statement that binds a specific rule hash, a committed dataset snapshot, the code version and the computed metrics, and is logged in #1. Anyone with the aggregate inputs can recompute the metrics and compare. It proves the computation was done as claimed on the committed data. It does not prove the data was honest.

### Cited Findings
- Eightfold publishes an NYC LL144 bias audit with impact ratios, and Harver publishes a platform audit PDF; both are model-level, annual, retrospective. [Eightfold bias audit](https://eightfold.ai/trust/bias-audit-results/); [Harver 2025 audit](https://harver.com/wp-content/uploads/2025/11/Harver-Platform-2025-Bias-Audit.pdf) (both as cited in earlier PRAMAAN notes)
- The four-fifths rule misbehaves with small samples; Fisher's exact test is preferred for small cells. [Roth, Bobko & Switzer 2006](https://web.pdx.edu/~mccunee/quant_621/Outlines/Roth,%20Bobko,%20Switzer%202006.doc); [Fulcrum](https://www.fulcrum.com/chi-square/) (from earlier notes). A certificate should therefore carry Fisher p, a CI and the shortfall count, not only the ratio.
- Research on cryptographic fairness certification: FairProof (Yadav, Roy Chowdhury, Boneh, Chaudhuri; ICML 2024) certifies local individual fairness for ReLU networks in zero knowledge using a commitment to the model weights. It reports about 1.17 minutes per data point for a German-credit setup without parallelism. [arXiv 2402.12572](https://arxiv.org/html/2402.12572v2)
- OATH (Franzese, Shamsabadi, Haddadi) proves demographic parity of a deployed model with authenticated commitments and addresses model-switching and data-forging, but proves only demographic parity. [arXiv 2410.02777](https://arxiv.org/abs/2410.02777v1); [search summary on ZK-fairness work](https://65610.csail.mit.edu/2026/reports/zkp_online_fairness.pdf)
- Confidential-PROFITT certifies fairness of tree training, not deployed outputs. [ICLR 2023](https://iclr.cc/virtual/2023/poster/11224)
- Sigstore/in-toto-style signed statements and DSSE envelopes are the standard container for "signed claims about an artifact"; Rekor v2 accepts `hashedrekord` and `dsse` entry types. [Sigstore blog](https://blog.sigstore.dev/rekor-v2-ga/) (entry-types detail is from a secondary summary of the v2 design; not verified in the GA post)

### Inferences
- **What it proves:** "Rule R (hash r) at publish time had impact ratio 0.86, Fisher p = 0.04, CI [..], shortfall = 6 students, computed by code at git SHA s over a dataset snapshot with Merkle root d; signed by the placement officer's key; logged at index i." The verifier checks the signature, the log inclusion and, with the aggregate counts, recomputes the numbers.
- **Commitment-based selective audit (cheap, no ZK):** the college commits to a Merkle tree of salted per-student records (group label, outcome). An auditor can request random leaf openings with inclusion proofs. Disclosure is limited to the sampled students, and the audit shows that the committed counts match the opened sample. This is a standard commit-and-sample audit I am proposing, not a cited product.
- **Library/standard:** DSSE/in-toto statement format; JCS (RFC 8785) for canonical JSON; `@sigstore/sign` or plain Ed25519 (WebCrypto/`@noble/ed25519` **[from memory]**); a tiny standalone verifier page. The Fisher test already exists in the team's own fairness code.
- **Effort:** 4-6 days (certificate schema, signer, logger, verifier page, "recompute" CLI).
- **What the judge sees:** A QR code on the published drive page opens the certificate. The verifier page shows four green ticks (signature, log inclusion, witness quorum, recompute match). The presenter flips one number in the JSON and the recompute tick turns red.
- **Honest limit:** garbage-in-garbage-out. The certificate proves integrity of the computation, not that the group labels are correct. Say so on screen.
- **Novelty confidence: High.** Search evidence: found only retrospective PDF audits (Eightfold, Harver) and academic ZK papers for ML models. Found no product that issues a per-rule, machine-verifiable fairness certificate before publication. (Earlier notes already found no publish-time fairness simulation; this adds the signed, logged, recomputable artefact on top.)

### Gaps
- No evidence on whether Indian recruiters or colleges would accept a certificate as meaningful; regulatory value in India is zero today (DPDP has no explanation right per earlier notes).
- The DSSE and `hashedrekord` detail was only confirmed through a secondary summary.

---

## 3. ZK or commitment-based fairness audit that proves selection rates without revealing individuals (stretch)

### Takeaway
Academic ZK-fairness systems exist but target ML models, not rule-based eligibility counting, and they are heavy. For a rule-based drive, a small SNARK that proves "k of n committed students pass this rule, split by group" is plausible, but it is a stretch goal at 10-14 days with real risk. Present it as a prototype for one rule, not a platform feature.

### Cited Findings
- FairProof, OATH, Confidential-PROFITT and Fairness-as-a-Service all prove fairness properties in zero knowledge for ML models, mostly demographic parity. Demographic parity alone can be gamed (selecting less-fit members of one group to meet the ratio). [OATH arXiv 2410.02777](https://arxiv.org/abs/2410.02777v1); [FairProof](https://arxiv.org/html/2402.12572v2)
- OATH's authors note offline fairness certificates can fail once a model is deployed, which motivated their online certification. [OATH](https://arxiv.org/abs/2410.02777v1)
- EU age-verification ZK is the nearest real deployment, and EFF reported in Aug 2026 that its ZK features were not yet live outside a demo build. [EFF](https://www.eff.org/deeplinks/2026/08/zkps-arent-age-verification-silver-bullets) (from earlier notes)
- Earlier PRAMAAN notes concluded ZK range proofs are not mature enough to bet a product on in 2026. [campus-placement-novelty-landscape.md](C:/Users/SEBIN/Desktop/PRAMAAN/docs/research/campus-placement-novelty-landscape.md)

### Inferences
- **What it would prove:** Given a published commitment to the drive's student table (Merkle root of salted records), the prover shows in ZK that the public rule predicate, applied to the committed records, yields k selected out of n, and k_g out of n_g per group g. The verifier learns only the counts it needs for the impact ratio. This is my proposal, not a cited system.
- **Library:** Circom + snarkjs, or Noir **[from memory, not verified]**. Counting circuits over a few thousand rows are feasible in principle (inference, no benchmark found). Proof verification in-browser is possible with snarkjs **[from memory]**.
- **Effort:** 10-14 days with high risk (circuit design, trusted-setup choice, witness generation, in-browser verifier). Do only after #1 and #2.
- **What the judge sees:** "Proof generated in 8 s, verified in 40 ms in the browser. The verifier never saw a name, mark or category."
- **Recommendation:** If time is short, skip the SNARK and demo the commit-and-sample audit from #2, which delivers 80% of the story with 10% of the risk. Do not claim "zero-knowledge fairness" if only the commit-and-sample version ships.
- **Novelty confidence: Medium-High.** Search evidence: one search found only academic ML-model papers (FairProof, OATH, PROFITT) and opinion pieces. No campus-placement or hiring product and no rule-counting ZK fairness prototype found. The novelty is in the setting, not in the cryptography.

### Gaps
- No benchmark found for SNARK counting circuits at campus-drive scale; the feasibility claim is my own reasoning.
- Whether any legal or procurement body values ZK fairness proofs in India is unknown.

---

## 4. Differential privacy / noisy aggregates for university and recruiter statistics, with a privacy-budget display

### Takeaway
Real deployments of DP for hiring analytics exist (LinkedIn), but I found none in campus placement. The honest design is: use cell suppression for single-college dashboards (cohorts are small, DP noise would swamp them), and use DP with a hard, visible epsilon budget for cross-college, university-level and recruiter-facing statistics.

### Cited Findings
- LinkedIn's Audience Engagements API is a differentially private analytics system with user-level guarantees and a budget service that enforces a strict budget on results returned to an analyst. [Rogers et al., arXiv 2002.05839](https://arxiv.org/abs/2002.05839); [J. Privacy & Confidentiality](https://journalprivacyconfidentiality.org/index.php/jpc/article/view/782)
- LinkedIn's labor-market report applies Laplace noise to counts for top-hiring-employer rankings, using the same algorithms. [Search summary of LinkedIn's report](https://transcend.io/blog/industry-perspective-how-linkedin-developed-a-differentially-private-data); epsilon values were not found.
- Future of Privacy Forum 2026 briefs say DP suits dashboards and public reporting with subgroup breakdowns, but noise reduces precision for small groups. [FPF PETs for EdTech (2026)](https://fpf.org/wp-content/uploads/2026/05/Privacy-Enhancing-Technologies-for-EdTech-Service-Providers.pdf) (I could not extract the PDF text; this comes from the search-result summary of the FPF series, so treat as medium confidence)
- Indiana University's institutional research dashboards mask headcounts under 11 and relabel attributes that could reveal small cells. That is suppression, not DP. [IU IR guide](https://iuia.iu.edu/finding-test/fa-technical-guide-for-developers.html) (as surfaced in search; not fetched)
- Tumult Labs' marketing says DP helped build the US College Scorecard. This is a vendor claim. [Tumult Labs](https://tmlt.io/)
- Libraries: OpenDP is Rust with Python and R bindings, with no official JS/TS binding found. The npm package `differential-privacy` implements the Laplace mechanism and throws `PrivacyBudgetExceededError` when `maxEpsilon` or `maxCallCount` is exceeded. [OpenDP docs](https://docs.opendp.org/en/beta/getting-started/typical-workflow.html); [npm differential-privacy](https://www.npmjs.com/package/differential-privacy). A second npm package `privacy-utils-dp` was listed (Laplace, Gaussian, exponential, budget tracking) but not verified. [pkgstats](https://www.pkgstats.com/pkg:privacy-utils-dp)
- A 2025 EDM poster studied DP for knowledge tracing; it is research, not a deployment. [EDM 2025 poster](https://educationaldatamining.org/EDM2025/proceedings/2025.EDM.poster-demo-papers.289/2025.EDM.poster-demo-papers.289.pdf)

### Inferences
- **What it proves:** the published statistic (median CTC by branch, offers per category) satisfies epsilon-DP with a stated budget per recruiter per quarter. Any single student's presence or absence changes the answer distribution by at most a bounded factor.
- **Library:** OpenDP behind a Python microservice (FastAPI) for the mechanism and composition accounting, or the npm `differential-privacy` package for a TS-only path. Cache answers per (query, epsilon) so repeated queries cannot be averaged to cancel noise. Compose budgets across recruiters per cohort.
- **Effort:** 4-5 days (query catalogue, mechanism, budget ledger, meter UI, cache).
- **What the judge sees:** A recruiter view with a budget bar (epsilon 1.0 per quarter). Each query drains it. The same query repeated returns the same noisy answer. At zero the dashboard says "budget exhausted; resets 1 Jan". A side-by-side shows the true and noisy counts and, for small cells, the suppression rule.
- **Honest limit:** campus cohorts are small. At n of a few hundred, DP counts for subgroups will be too noisy to be useful, which the FPF guidance also warns about. Use DP only where aggregation spans colleges or years, and say that on screen. Choosing epsilon is a policy decision; do not present a number as "safe".
- **Novelty confidence: Medium-High for placement.** Search evidence: searches for DP in student-outcome dashboards found guidance and research but no deployed university or placement dashboard using DP, and only vendor claims for College Scorecard. LinkedIn proves the pattern works in hiring analytics at scale, so the novelty claim must be "first we found in campus placement", not "first in hiring".

### Gaps
- LinkedIn's actual epsilon values were not found.
- I could not read the FPF PDFs directly.
- No Indian regulator has said anything about DP for placement statistics; NIRF/NAAC reporting requires exact figures, so DP applies only to externally shared statistics, not accreditation filings.

---

## 5. Verifiable erasure: per-student keys, crypto-shredding, and signed erasure + consent receipts (DPDP)

### Takeaway
Crypto-shredding (encrypt each student's data under its own key, then destroy the key) is a well-known pattern, and it lets a log keep pseudonymous commitments while the underlying data becomes unreadable. A "proof of erasure" cannot be cryptographically complete (nobody can prove no copy exists). What a small team can show is a verifiable key-destruction attestation plus a signed consent/erasure receipt in the transparency log. Regulator acceptance of crypto-shredding as erasure is not established by the sources I found.

### Cited Findings
- Practitioner guides describe per-subject keys destroyed on erasure; in a Google Cloud KMS example the key destruction is scheduled, then data becomes unrecoverable after completion, so timing matters for any SLA. [OneUptime guide, Feb 2026](https://oneuptime.com/blog/post/2026-02-17-how-to-set-up-crypto-shredding-for-gdpr-right-to-erasure-compliance-in-google-cloud/markdown)
- The EDPB blockchain guidance (draft, dated 2024 or 2025 depending on the source) says only proofs of existence such as keyed hashes or commitments should be stored on-chain. A law-firm commentary notes it does not engage with whether encryption plus key destruction amounts to deletion. [PPC Land](https://ppc.land/edpb-forces-blockchain-firms-to-avoid-storing-personal-data-on-chain/); [Slaughter and May](https://www.slaughterandmay.com/insights/new-insights/when-decentralisation-meets-regulation-how-blockchain-and-gdpr-can-coexist/)
- Vendor posts claim the EDPB "supports" crypto-shredding. These are marketing and I could not trace the quoted line to a primary source. [VeritasChain post](https://dev.to/veritaschain/crypto-shredding-how-immutable-audit-logs-and-gdpr-coexist-2h7g)
- DPDP Rule 8: erase when purpose is served or consent is withdrawn. Logs and related personal data must be retained at least one year for breach investigation, then erased unless other law requires more. Most duties apply from 13 May 2027. [dComply rules index](https://dpdpa.dcomply.in/rules/); [Mondaq highlights](https://www.mondaq.com/india/data-protection/1709066/key-highlights-of-the-digital-personal-data-protection-rules-2025) (both from earlier notes)
- ISO/IEC TS 27560:2023 defines a consent-record and consent-receipt information structure, with a receipt as a document communicating the existence of a consent record. It descends from the Kantara Consent Receipt specification. It is a Technical Specification, although one Kantara page calls it a Standard. [Kantara wiki](https://kantara.atlassian.net/wiki/x/GQBQAg); [Implementing ISO/IEC TS 27560:2023 (arXiv)](https://arxiv.org/pdf/2405.04528)

### Inferences
- **What it proves:** (a) the student's record is stored only as ciphertext under a per-student data key (DEK), wrapped by a key-encryption key; (b) on erasure, the DEK was destroyed at time T, attested in a signed receipt logged in #1; (c) the log retains only salted commitments, so it does not reintroduce the data. It does NOT prove that no plaintext copies, backups or exports exist.
- **Library:** Envelope encryption with AES-GCM via WebCrypto or libsodium **[from memory]**; KEK in a cloud KMS or, for the demo, a local file with a documented rotation. Consent/erasure receipts as ISO 27560-shaped JSON signed with the college key. Plug into the existing consent ledger.
- **Effort:** 4-6 days (key hierarchy, encrypt-on-write for selected tables, erase endpoint, receipt format, log integration, a "restore from backup" test that shows the destroyed key stays destroyed).
- **What the judge sees:** Student presses "Erase my data". A split screen shows the row before (readable in an admin tool) and after (ciphertext blob, "key destroyed 14:02:07"). A download gives a signed erasure receipt. Verify it against the log: green, and the log entry contains no personal data.
- **Honest limits to show on screen:** backups holding the old wrapped key must be rotated; a receipt is an attestation by the operator, not a proof; a one-year log-retention rule may require keeping pseudonymised logs.
- **Novelty confidence: Medium.** Search evidence: crypto-shredding is common practitioner knowledge, and the VAP-PAP proposal for hiring includes it. I found no campus-placement or EdTech product that offers a student-held erasure receipt, but I only ran one search on this. The ISO 27560 consent receipt in a placement context also was not found. The novelty is the student-visible, log-linked receipt, not the crypto.

### Gaps
- I did not verify any regulator's position on crypto-shredding as erasure (EU or Indian). The EDPB item is only about blockchains.
- Nothing found on how the DPDP Board will treat key destruction.
- ISO 27560 field list not retrieved; needs the ISO text or the arXiv implementation paper.

---

## 6. Policy-as-code agent firewall (Cedar) + capability-scoped tokens: machine-checkable "AI can only propose"

### Takeaway
Proposal-only agents are a design stance; Cedar makes it a checkable invariant. Cedar's forbid-overrides-permit semantics, plus solver-based policy analysis, let CI prove that no request from an agent principal can ever be allowed to publish, approve or send. Capability tokens (Biscuit, with offline attenuation) limit each agent run to one drive and a short time-to-live.

### Cited Findings
- Cedar semantics: the authorizer returns Deny if no permit applies or if any forbid applies; Allow needs a satisfied permit and no satisfied forbid. Cedar's symbolic compiler translates policies to SMT-LIB and supports checking equivalence, inconsistency and invariants. The Cedar Analysis CLI includes a "Forbid Overrides" check. The core is modelled and proven in Lean. [arXiv 2407.01688, How We Built Cedar](https://arxiv.org/pdf/2407.01688); [AWS blog: Cedar analysis](https://aws.amazon.com/blogs/opensource/introducing-cedar-analysis-open-source-tools-for-verifying-authorization-policies); [AWS blog: Lean](https://aws.amazon.com/blogs/opensource/lean-into-verified-software-development)
- `@cedar-policy/cedar-wasm` provides WebAssembly bindings for JS/TS (default ESM build for bundlers, a `/nodejs` CommonJS build, a `/web` build). Packaging is environment-dependent. GitLab's advisory database lists a 2026 advisory about template slot-id validation causing a panic and decision divergence, so pin a patched version. [Cedar repo](https://github.com/cedar-policy/cedar); [pkgstats](https://pkgstats.com/pkg:@cedar-policy/cedar-wasm); [GitLab advisory DB](https://advisories.gitlab.com/pkg/npm/@cedar-policy/cedar-wasm/)
- Biscuit tokens support offline attenuation (adding checks without contacting the issuer), Datalog policies and decentralised verification by any holder of the root public key. Revocation needs external state, so use short expiry. [Clever Cloud intro to Biscuit](https://www.clever.cloud/blog/engineering/2021/04/12/introduction-to-biscuit/); [biscuit-auth docs](https://docs.rs/crate/biscuit-auth/6.0.0/source/src/token/authorizer.rs)
- Google's AgentMesh documentation describes an agent authorization design on Biscuit: control plane writes roles into the authority block, holder attenuation is limited to one fact type, and attenuation blocks are capped at 8. [AgentMesh authorization docs](https://google.github.io/agentmesh/docs/concepts/authorization/)
- CaMeL (Google DeepMind/ETH Zurich) enforces provenance-tracked security policies with a privileged planner model and a quarantined model that has no tool access. On AgentDojo it completed 77% of tasks with provable security versus 84% undefended; Simon Willison notes users still must write the policies and prompt injection is not fully solved. [arXiv 2503.18813](https://arxiv.org/pdf/2503.18813); [Willison](https://simonw.substack.com/p/camel-offers-a-promising-new-direction)
- OPA with Rego is the other mainstream policy-as-code option; it compiles to Wasm **[from memory, not verified]**.

### Inferences
- **What it proves:** (a) every agent action goes through a policy decision point; (b) a solver-checked invariant: "there is no request with principal in Agent that Cedar allows for action in {Publish, Approve, SendEmail, ChangeRule}"; (c) each run carries a token scoped to one drive and expiring in N minutes, so even a compromised agent cannot act elsewhere. The invariant is proved over the policy set, not over the LLM.
- **Library:** `@cedar-policy/cedar-wasm` for evaluation inside the Node API. For the solver proof, run the Cedar Analysis CLI in CI **(whether the analysis tooling is exposed through the wasm package was not verified; plan to run it as a separate Rust CLI step)**. Biscuit (`@biscuit-auth/biscuit-wasm` **[package name from memory]**) or a simple signed-JWT with narrow scopes if Biscuit proves awkward.
- **Effort:** 5-7 days (entity/action schema, policies, middleware, analysis in CI, token minting, UI that shows the decision and policy ID).
- **What the judge sees:** In the agent console, the judge types "publish this drive now". Response: "DENIED by policy `agents-cannot-commit` (forbid). Proof status: verified in CI run #213, no request exists that allows it." Then an officer clicks Approve and it works, with the approval recorded in the log.
- **Honest limit:** this proves the policy gate, not that the application has no bypass route. Add a test that enumerates all write endpoints and confirms each calls the gate.
- **Novelty confidence: Medium-High for placement/EdTech.** Search evidence: policy-as-code and capability tokens for agents are active in the security/infra world (Cedar MCP tooling, AgentMesh, CaMeL). Earlier notes found Unstop's agents with no human-approval gate described. I found no placement or EdTech product advertising machine-checked proposal-only agents. The component technologies are not new; the invariant-in-CI-with-a-solver demo for this domain is.

### Gaps
- I did not verify that Cedar's analysis (SMT) is usable from TypeScript or Windows CI without extra Rust toolchain work.
- The Biscuit npm/wasm package name and maturity were not verified.
- No source gave a performance benchmark for Cedar-wasm in Node.

---

## 7. Prompt-injection red-team harness with a live on-screen scoreboard (resumes, JDs, emails)

### Takeaway
The threat is real in hiring: a USENIX Security 2026 study found hidden prompt injections in about 1% of 200K real resumes. A harness that replays a curated attack corpus against the platform's agents on every build, and reports at the tool-call level (did any forbidden action happen?), produces a number a judge can see. The effect of injections on real hiring decisions has not been measured in that study, so frame it as risk reduction, not proof of safety.

### Cited Findings
- "Measuring Real-World Prompt Injection Attacks in LLM-based Resume Screening" analysed about 200K resumes from hireEZ; about 1% contained hidden injections, prevalence rose over the last 1-2 years, and more than 90% of injected prompts did not use explicit instructions. The authors built resume-specific detectors that outperformed general ones on a small manual validation set. Published at USENIX Security 2026. [arXiv 2605.28999](https://arxiv.org/abs/2605.28999)
- A secondary summary lists concealment techniques including background-coloured text, roughly 1-pt text, off-page text and parser-only layers, and notes the study did not test end-to-end effects on hiring decisions. [Metaview summary](https://www.metaview.ai/resources/blog/resume-prompt-injection); [Duke Pratt](https://pratt.duke.edu/news/thwarting-prompt-injection/)
- Promptfoo's `indirect-prompt-injection` plugin tests whether untrusted content placed in a named variable influences the model; it is documented for CI (GitHub Actions, GitLab CI, Jenkins), exits non-zero on failure, and one guide says it is remote-only (matters if fully offline). [Promptfoo plugin docs](https://promptfoo.dev/docs/red-team/plugins/indirect-prompt-injection); [guide](https://qaskills.sh/blog/promptfoo-red-teaming-guide-2026)
- AgentDojo is the benchmark used to evaluate CaMeL's agent-injection defence. [arXiv 2503.18813](https://arxiv.org/pdf/2503.18813)
- NVIDIA garak is another open-source LLM vulnerability scanner **[from memory, not verified]**.

### Inferences
- **What it proves:** "N attack payloads across resumes (white text, 1-pt text, off-page PDF layers), JDs, recruiter emails and calendar invites were replayed against the agents; M caused a model deviation; 0 caused a policy violation." The two metrics separate "the model was fooled" (expected sometimes) from "the system let it act" (the number that matters, enforced by #6).
- **Library:** Promptfoo (indirect-injection plugin + custom provider that calls the PRAMAAN agent endpoint), a hand-built PDF corpus generator (PyMuPDF/reportlab **[from memory]**), results written as JSON and rendered on a scoreboard page. Optionally a CaMeL-style split: a quarantined extractor with no tools reads resumes; the planner never sees raw resume text.
- **Effort:** 4-5 days (corpus of about 100 payloads, harness, CI job, results page, a "known failing" list).
- **What the judge sees:** A big Run button. 120 attacks stream by in about 40 s with colour-coded rows. Final line: "Model deviated on 7/120; forbidden tool calls: 0/120; build gate: PASS". Then the presenter adds a new payload live (a judge supplies one) and re-runs.
- **Honest limit:** passing the corpus does not mean immunity. Publish the deviations too. Corpus and defences should be versioned and logged in #1.
- **Novelty confidence: Medium.** Search evidence: resume injection is a documented, discussed threat (USENIX 2026, Metaview and Duke write-ups), and promptfoo/garak are generic tools. I found no placement or EdTech product publishing a live injection scoreboard for its own agents, but I did not search vendor trust pages exhaustively.

### Gaps
- No published measurement of how often resume injections actually change rankings (the USENIX study explicitly did not test it).
- Promptfoo plugin offline/remote constraints need verification before relying on it in a locked-down demo.
- Garak and PDF-tooling claims are from memory.

---

## 8. Reproducible decisions: canonical input snapshot, hash of inputs, and a "Replay this decision" button

### Takeaway
For deterministic rule evaluation (eligibility, fairness numbers), the platform can store a canonical snapshot of inputs and bind it to the rule hash and engine version, so anyone can re-run the evaluator and get an identical output hash. LLM output is not deterministic, so for AI proposals only record prompt and output hashes; do not claim replay.

### Cited Findings
- RFC 8785 (JSON Canonicalization Scheme) gives a deterministic JSON serialisation (UTF-16 code-unit key sorting, array order preserved, ECMAScript number formatting) so hashing and signing are repeatable. It is Informational, not Standards Track. [RFC 8785](https://datatracker.ietf.org/doc/rfc8785/)
- One implementation's docs note that canonicalisation is a schema decision and the digest algorithm is chosen separately, so a record should store the canonicalisation version and hash algorithm together. [vr-jcs docs](https://docs.rs/vr-jcs/0.4.0/src/vr_jcs/lib.rs.html)
- EU AI Act Art. 12 requires automatic recording of events over a high-risk system's lifetime for traceability and monitoring. [AI Act Service Desk, Art. 12](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-12)
- Colorado SB 26-189 (1 Jan 2027) and EU Art. 86 require explanations of the role of the automated system after adverse outcomes. [McDermott](https://www.mcdermottlaw.com/insights/colorado-ai-law-in-flux-comprehensive-replacement-bill-signed-after-federal-court-blocks-predecessors-enforcement/); [Gibson Dunn](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/) (from earlier notes)

### Inferences
- **What it proves:** decision D = evaluate(rule r, snapshot s, engine v) was recorded with hash H = SHA-256(JCS({r, s, v, output})). Replay re-executes the published evaluator bundle on the same snapshot and compares hashes. A mismatch means the record or the engine changed.
- **Library:** `json-canonicalize` or a hand-written JCS **[from memory]**; PRAMAAN's existing `packages/domain` evaluator compiled to a browser bundle so replay runs client-side; version pinning by git SHA; the hash logged in #1.
- **Effort:** 3-4 days if the evaluator is already pure (it appears to be, per the existing domain package; I did not read the code). Add property tests for determinism: no `Date.now()`, no randomness, no unordered iteration.
- **What the judge sees:** The student's "why not eligible?" screen has a Replay button. It runs in the browser, shows the input snapshot (own data only), the rule version and the output, and the line "Recomputed hash matches logged hash 9f3a..". The presenter edits one input in dev tools, and the line turns red.
- **Honest limit:** inputs that were wrong at the time reproduce the wrong answer faithfully. Replay proves consistency, not correctness. Snapshots contain personal data and must follow #5 (encrypted, erasable).
- **Novelty confidence: Medium-High for placement.** Search evidence: one search on hiring/ATS decision-replay found no product; results covered only the JCS standard. A Credo AI case study shows hiring-related governance platforms exist for talent matching, but I found nothing about candidate-facing replay. Limited search, so treat as medium.

### Gaps
- I did not search specifically for "model card" or "decision record" features in Superset, Eightfold or Workday documentation.
- Whether replay is legally meaningful (versus only technically meaningful) is untested.

---

## 9. Code-authorship integrity without AI detectors: signed-commit process evidence and plausibility signals

### Takeaway
AI-code detectors are unreliable, and earlier notes already cover the research. A cheaper, defensible alternative is prospective process evidence: students sign commits keylessly, each signature is written to a public transparency log, and the platform reports "anchored since date X" as a proof-level input. It proves when and by whom commits were signed. It does not prove a human wrote the code.

### Cited Findings
- Detector reliability (summarised from earlier notes, not repeated in depth): Liang et al., *Patterns* 2023 found GPT detectors misclassify non-native English; Vanderbilt disabled Turnitin's detector; code detectors collapsed to labelling nearly everything as AI in one preprint. [Patterns](https://www.cell.com/patterns/fulltext/S2666-3899(23)00130-7); [Vanderbilt](https://www.vanderbilt.edu/brightspace/2023/08/16/guidance-on-ai-detection-and-why-were-disabling-turnitins-ai-detector/); [arXiv 2610.01664](https://arxiv.org/pdf/2610.01664)
- Gitsign (Sigstore) does keyless Git commit signing with an OIDC identity. Signing data is written to the Rekor transparency log, so signatures stay verifiable after certificates expire. The Rekor entry holds a hash of the commit and the code-signing certificate, which can contain identifying details such as emails; sensitive users can run their own Rekor. [Sigstore docs: gitsign](https://docs.sigstore.dev/cosign/signing/gitsign); [Chainguard on Gitsign](https://www.chainguard.dev/unchained/keyless-git-commit-signing-with-gitsign-and-github-actions)
- Process-evidence precedent in education: Turnitin Clarity records the writing process (keystroke-level playback, pasted-text markers, AI-chat logs). The vendor describes the signals as conversation starters and I found no independent validation of accuracy. Privacy/consent handling was not found. [Turnitin guide](https://guides.turnitin.com/hc/en-us/articles/36983190006413); [UCLA pilot note](https://dts.ucla.edu/news/turnitin-clarity-enhancement-writing-process-tools-exploration)
- Team-repo attribution via git logs and `git blame` measures activity, not meaningful contribution (TRACE authors' own caveat). [arXiv 2510.03998](https://arxiv.org/html/2510.03998v3) (from earlier notes)
- Hiring vendors' own guidance: integrity flags should start a conversation, not auto-reject. [Metamindz](https://www.metamindz.co.uk/post/karat-hackerrank-codesignal-ai-interview-cheating-2026) (from earlier notes)

### Inferences
- **What it proves:** "Commits c1..cn in this repo were signed under identity X, and each signature was logged at log time T." Because the log timestamp cannot be backdated once the entry is witnessed (the same logic as #1), a student cannot retroactively fabricate months of history. Combined with the mutation probe (already planned), it forms two independent layers: a provenance layer and an understanding layer.
- **Plausibility signals (non-accusatory):** commit cadence across weeks, size distribution of diffs, share of commits signed, gap between first signed commit and last. These are shown as "evidence completeness" on the proof ladder, never as a verdict. Do not display an "AI probability".
- **Library:** gitsign + Sigstore public-good instance, or self-hosted Rekor v2 (Tessera) to avoid putting student emails in a public log; a verifier using the Rekor client libraries. A GitHub App can read the repo and call `git verify-commit` equivalents.
- **Effort:** 4-6 days (onboarding docs and script, verifier, proof-ladder integration, privacy-safe identity handling). Students must opt in before they start building, which limits retroactive use.
- **What the judge sees:** A student repo card: "148 of 152 commits signed; first anchored 4 Mar 2026; verified against log". The presenter rewrites the date on an old commit with `git commit --amend --date`; the unsigned commit is shown as "unanchored" while the signed history stays green.
- **Honest limits:** it only works prospectively; a student can still paste AI-generated code and sign it; OIDC identities can be shared. Say this explicitly. It raises the cost of backdating, which is the narrow thing it proves.
- **Novelty confidence: Medium-High.** Search evidence: gitsign results were all supply-chain security. I found no education, hiring or placement use of signed-commit provenance as a proof-level input. Turnitin Clarity is the closest precedent in education but concerns writing, not code, and is a vendor claim with no validation found.

### Gaps
- No study found validating commit-history plausibility signals against ground truth in the LLM era.
- Privacy of OIDC identities in public Rekor is a real concern; self-hosting vs. public log was not resolved.
- No source on student willingness to adopt signed commits.

---

## 10. W3C / IETF status lists for revocation, and BBS unlinkable presentations in practice

### Takeaway
PRAMAAN already has SD-JWT passes. Revocation and unlinkability are the two gaps. Status lists are mature enough to ship (W3C Bitstring Status List is a Recommendation; IETF Token Status List is in the RFC Editor queue). BBS is still a draft, so ship it only as a prototype. SD-JWT presentations stay linkable to the issuer signature across verifiers; BBS is the standards-track answer.

### Cited Findings
- IETF Token Status List (`draft-ietf-oauth-status-list`): the datatracker showed revision -21 dated 21 Jun 2026, IESG state "RFC Ed Queue", and "Awaiting Second editor", with no RFC number yet. It targets SD-JWT and SD-JWT VC, with a compressed status list inside a signed Status List Token. Authors: Looker, Bastian, Bormann. The page's "last updated" date looked inconsistent, so recheck. [IETF datatracker](https://datatracker.ietf.org/doc/draft-ietf-oauth-status-list/)
- SD-JWT is RFC 9901 (Nov 2025); the SD-JWT VC profile was still an Internet-Draft at -27 in IESG evaluation as of Nov 2026. [RFC 9901](https://www.rfc-editor.org/rfc/rfc9901.html); [draft-ietf-oauth-sd-jwt-vc](https://datatracker.ietf.org/doc/draft-ietf-oauth-sd-jwt-vc/) (from earlier notes)
- W3C VC Data Model 2.0, Data Integrity 1.0 and Bitstring Status List v1.0 are Recommendations dated 15 May 2025; the BBS cryptosuite (bbs-2023) was a Candidate Recommendation Draft on 7 Apr 2026. [W3C VC Overview Note, 17 Jun 2026](https://www.w3.org/TR/2026/NOTE-vc-overview-20260617/) (from earlier notes; not re-fetched)
- The CFRG BBS scheme is still an Internet-Draft (draft-12, Sept 2026, intended status Informational); blind-signature and per-verifier-linkability drafts are also still drafts (linkability draft-03, June 2026). [draft-irtf-cfrg-bbs-signatures](https://www.ietf.org/archive/id/draft-irtf-cfrg-bbs-signatures-12.html); [per-verifier linkability](https://datatracker.ietf.org/doc/html/draft-irtf-cfrg-bbs-per-verifier-linkability-03)
- JavaScript BBS libraries found: `@grottonetworking/bbs-signatures` (pure JS, v0.1.5 listed), `@herculas/bbs-signature` (Rust compiled to Wasm; docs target an older draft version 8), Digital Bazaar's `bbs-signatures` (Node 18+), MATTR's `bbs-signatures` (Rust core; asm.js deprecated), and Microsoft's TypeScript reference implementation, which is not positioned as production. [npm grotto](https://npmjs.com/package/@grottonetworking/bbs-signatures); [JSR herculas](https://jsr.io/@herculas/bbs-signature); [Digital Bazaar](https://github.com/digitalbazaar/bbs-signatures); [MATTR](https://github.com/mattrglobal/bbs-signatures); [Microsoft](https://github.com/microsoft/bbs-node-reference)
- Earlier notes found no education or hiring deployment of BBS or ZK range proofs. [credentials_and_india_dpi.md](C:/Users/SEBIN/Desktop/PRAMAAN/docs/research/notes/credentials_and_india_dpi.md)
- A bitstring status list's privacy comes from herd privacy: a verifier downloads the whole list, so the issuer learns nothing about which credential was checked. The minimum list size requirement in the W3C spec is **[from memory: 131,072 entries (16 KB); not re-verified]**.

### Inferences
- **What it proves:** (status list) a pass was valid at the time of check and was later revoked by the issuer, without any call-home that reveals which student a recruiter is checking; (BBS) a student can present a derived proof to two recruiters such that the two proofs cannot be linked to each other or to the original signature.
- **Library:** `@sd-jwt/*` already in use; Token Status List via `@owf/token-status-list` (per earlier notes) or a ~100-line bitstring implementation with gzip and a signed JWT; BBS via `@grottonetworking/bbs-signatures` or the Wasm option, pinned and clearly labelled "draft".
- **Effort:** status list 2-3 days; BBS prototype 5-7 days with version-mismatch risk.
- **What the judge sees:** TPO clicks "Revoke pass: backlog appeared". The recruiter's wallet refreshes and the pass flips to red with reason class (revoked, not the student's data). For BBS: the same student presents to two recruiter screens; each shows a different presentation fingerprint, and a "can a colluding pair link these?" panel answers No for BBS and Yes for SD-JWT.
- **Honest limits:** status lists reveal the revocation event to anyone checking that index at that time; BBS standards are drafts and libraries target earlier draft versions; unlinkability from the issuer is not provided by plain BBS (it is from verifiers).
- **Novelty confidence: Low-Medium for revocation (standard feature of VC stacks), Medium-High for BBS in a placement setting.** Search evidence: earlier notes found no BBS in education/hiring; this session's searches found only generic libraries and the drafts. I did not check whether Open Badges 3.0 platforms (Credly, Accredible) already expose status lists, so do not claim revocation is new.

### Gaps
- Not checked: whether Credly/Accredible OB 3.0 credentials carry W3C status lists.
- BBS interop versions (draft-8 vs -12 vs W3C CRD) were not reconciled.
- The 16 KB minimum bitstring size is from memory.

---

## 11. Multilingual explanation parity and accessibility safety evals as CI gates

### Takeaway
PRAMAAN's reason codes and agent summaries will be shown in Hindi, Marathi and English. LLMs are measurably more biased and less safe in Indian languages than in English, so the safe design is templated reason codes (deterministic, no LLM) plus an automated parity test that every language version carries the same numbers, clauses and appeal route. Add automated accessibility checks, and be honest that they catch only part of the issues.

### Cited Findings
- BharatBBQ (TACL vol. 13; EMNLP 2025) is a bias benchmark for question answering in eight Indian languages including Hindi and Marathi plus English, with 13 social categories (3 intersectional). It reports models show significantly more bias in Indian languages than in English. It is a QA benchmark, not about explanation quality. [arXiv 2508.07090](https://arxiv.org/abs/2508.07090v1); [TACL](https://transacl.org/index.php/tacl/article/view/8301)
- IndicSafeEval (Mondal et al., Findings of EMNLP 2026) has 7,200 adversarial prompts in Hindi, Bengali, Marathi and Punjabi across ten risk categories and six persuasion strategies; safety varies by language, persuasion style and risk category. [arXiv 2609.03781](https://arxiv.org/pdf/2609.03781); [ACL Anthology](https://aclanthology.org/2026.findings-emnlp.2457/)
- IndicJR (Pattnayak and Chowdhuri, arXiv 2602.16832) is a judge-free jailbreak benchmark in 12 Indic/South-Asian languages with 45,216 prompts; romanised or mixed-script inputs lowered attack success under the JSON track. [Hugging Face papers](https://huggingface.co/papers/2602.16832)
- DPDP Rule 3 requires the consent notice be plain-language and available in the 22 Eighth Schedule languages on request. [dComply](https://dpdpa.dcomply.in/rules/) (from earlier notes)
- Bhashini offers free translation/ASR/TTS APIs (from earlier notes); a fallback provider is needed. [Bhashini docs](https://bhashini.gitbook.io/bhashini-apis/)
- Deque's study: automated axe-based testing found about 57.38% of issues by volume across 13,000+ pages and nearly 300,000 issues, rising to 80.39% with guided testing. By WCAG 2.1 AA success criteria, automation found issues for 16 of 50 criteria. This is a vendor study of its own customers' audits. [Deque study](https://www.deque.com/blog/automated-testing-study-identifies-57-percent-of-digital-accessibility-issues)

### Inferences
- **What it proves:** (parity) for each reason code r and each language L, the rendered text contains the same extracted facts (threshold, student value, gap, deadline, appeal route) as the English reference. (a11y) the shipped UI has zero automated WCAG violations on the key flows, and a human audit sheet covers the rest.
- **Library:** deterministic message templates (ICU MessageFormat) rather than LLM translation for reason codes; a parity test that parses numbers and clause IDs from each rendering; optionally back-translation through Bhashini/IndicTrans2 **[IndicTrans2 from memory]** with a similarity threshold; a small BharatBBQ/IndicSafeEval subset run against any LLM summariser; `axe-core` + Playwright in CI **[from memory]**; WCAG 2.2 AA as target.
- **Effort:** 5-6 days.
- **What the judge sees:** A public scorecard page: "Reason codes: 24 codes x 3 languages, parity 72/72. Axe: 0 violations on 11 flows. LLM summariser on IndicSafeEval subset: refusal parity gap 4 pts (Hindi) / 9 pts (Marathi)". A Marathi explanation is read aloud (Bhashini TTS) while the same facts show in English side by side. Break a template and the scoreboard flips red.
- **Honest limits:** parity checks facts, not tone or cultural fit; a native-speaker review is still needed; accessibility automation catches roughly half of issues by volume per the vendor's own study; benchmarks were developed on open models and may not reflect the production model.
- **Novelty confidence: Medium-High.** Search evidence: earlier notes found Bhashini-based multilingual reason codes unclaimed by any placement platform. This session's searches found Indic bias and safety benchmarks but no placement or EdTech product publishing multilingual parity or accessibility scorecards. Accessibility CI itself is common practice in general software, so the novelty is the public, multilingual, decision-linked scorecard.

### Gaps
- I did not find any study of explanation-quality fairness across Hindi vs Marathi (only bias and jailbreak benchmarks).
- Indian accessibility law specifics (RPwD Act, GIGW) were not researched.
- Per-model numbers in the benchmark papers were not opened.

---

## 12. Compliance evidence dashboard: EU AI Act Art. 12/13/14, ISO/IEC 42001 and DPDP generated from the logs

### Takeaway
Enterprise AI-governance platforms already sell compliance dashboards, so a dashboard alone is not novel. What a small team can add is evidence that is generated from the transparency log and linked by inclusion proof, rather than self-attested checkboxes. Human-oversight metrics (override rate, review time, edit/approve/reject ratios) are the most credible Art. 14 evidence.

### Cited Findings
- EU AI Act Art. 12 requires high-risk systems to technically allow automatic recording of events over their lifetime. [AI Act Service Desk, Art. 12](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-12)
- Commentary (secondary, compliance-vendor and law-firm blogs) says providers build the logging capability, deployers keep the logs, deployers under Art. 26 keep logs at least six months where under their control, and logs showing who reviewed a decision and when help show oversight is real. [Mishcon de Reya Art. 12 page](https://mishcon.com/eu-uk-ai-navigator/article-12); [Prediction Guard](https://predictionguard.com/blog/eu-ai-act-compliance-audit-log-what-regulators-expect-and-how-to-document-it); [datenschutz-notizen](https://www.datenschutz-notizen.de/ai-logging-under-the-eu-ai-act-the-compliance-infrastructure-behind-high-risk-systems-4458904/)
- One HR guide says that pre-sorting candidates with AI so reviewers only see those who passed the threshold is not meaningful human oversight. This is a secondary source; check the legal text. [MintHCM guide](https://minthcm.org/ai-act-for-hr-what-you-need-to-do-before-2-august-2026/)
- Annex III high-risk obligations (employment and education) moved to 2 Dec 2027 under the Digital Omnibus (Regulation (EU) 2026/1744). [Gibson Dunn](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/) (from earlier notes)
- ISO/IEC 42001 Annex A has 38 controls in nine objectives (A.2-A.10) per most sources (others say 37 or 39). It is voluntary, shares structure with ISO 27001, and vendor guides estimate under $10,000 for small organisations with existing ISO infrastructure and six to twelve months to certification. These are vendor estimates. [SureCloud guide](https://www.surecloud.com/resource-hub/iso-42001-annex-a-controls); [DataGuard](https://www.dataguard.com/iso-42001/)
- Existing products: Credo AI (EU AI Act readiness, dashboards, a hiring-related AdeptID case study claiming "100% compliance readiness" for its talent-matching use case), Holistic AI (bias auditing focus), FairNow (hiring/HR focus per one comparison). All claims are vendor or third-party comparison material. [Credo AI AdeptID case study](https://www.credo.ai/casestudies/adept-id); [Credo AI EU AI Act](https://credo.ai/eu-ai-act); [guptadeepak comparison](https://guptadeepak.com/tools/top-5-ai-governance-platforms-2026/)
- DPDP: most duties from 13 May 2027; consent notice in plain language; breach reporting to the Board within 72 hours after "without delay" notice. [dComply](https://dpdpa.dcomply.in/rules/) (from earlier notes)

### Inferences
- **What it proves:** each control row links to machine evidence: Art. 12 (event count and latest checkpoint), Art. 13 (published rule versions and reason-code coverage), Art. 14 (human review rate, override rate and reasons, median time-to-review, approve/edit/reject ratio of agent proposals), ISO 42001 (risk register, red-team results from #7, fairness certificates from #2), DPDP (consent receipts and erasure receipts from #5). Clicking a number opens the inclusion proof.
- **Library:** none specific; a read-only reporting API over the log and audit tables; OSCAL-style control-to-evidence mapping JSON **[OSCAL from memory]**.
- **Effort:** 4-5 days after #1, #2, #5 and #7 exist. It is a pure reporting layer.
- **What the judge sees:** A control grid with green, amber and grey cells; clicking "Art. 14 human oversight" shows "Override rate 11%, median review 4 min, 0 agent actions without approval (proved by #6)". Print to PDF gives a regulator pack.
- **Honest limits:** a dashboard reports readiness, not conformity. Do not claim compliance or certification. EU duties may not apply to an India-only platform, and the Annex III dates are 2027. Automation-bias risk: showing high approval rates can itself indicate rubber-stamping, so show it as a risk metric.
- **Novelty confidence: Low-Medium overall, Medium for the log-linked variant.** Search evidence: governance dashboards exist (Credo AI, Holistic AI, FairNow), including one hiring-adjacent case study. I found no campus-placement product with a compliance dashboard, and none whose entries link to cryptographic inclusion proofs, but I searched only once for this combination. Pitch it as a consequence of #1, not as a headline.

### Gaps
- I did not retrieve the Art. 13, 14, 26 legal text; wording above comes from the Service Desk for Art. 12 and secondary sources for the rest.
- No source on whether any Indian regulator or university will accept such a dashboard.
- ISO 42001 control count disagrees across sources; use the official standard before mapping.

---

## 13. Cross-cutting guardrails: claims to avoid and a suggested 60-second demo script

### Takeaway
The credibility of a "provable" platform depends on stating exactly what each proof does and does not show. Overclaiming is the fastest way to lose a technical judge.

### Cited Findings
- Detector-based accusations are unreliable and biased; vendors themselves say flags are conversation starters. (See #9 sources.)
- ZK fairness and BBS are research-stage or draft-stage for production use. [EFF](https://www.eff.org/deeplinks/2026/08/zkps-arent-age-verification-silver-bullets); [W3C VC Overview](https://www.w3.org/TR/2026/NOTE-vc-overview-20260617/)
- The prompt-injection paper did not measure decision impact; CaMeL's authors and reviewers say injection is not solved. [arXiv 2605.28999](https://arxiv.org/abs/2605.28999); [Willison](https://simonw.substack.com/p/camel-offers-a-promising-new-direction)

### Inferences
- **Do not claim:** "tamper-proof" (say tamper-evident); "proof of erasure" (say verifiable key destruction); "bias-free" or "compliant" (say "fairness certificate" and "evidence for"); "AI-proof" (say "measured against N attacks"); "first ever" (say "no public prior art found").
- **60-second script (uses #1, #2, #8, #6):** (1) Officer publishes a rule; the screen shows the fairness certificate and a log index (10 s). (2) Student phone: "Why am I not eligible?" -> reason code in Marathi + Replay button, hash matches (15 s). (3) Presenter edits the DB row; the monitor goes red; the student's receipt no longer verifies against the new checkpoint (15 s). (4) Judge asks the AI agent to "publish it"; Cedar denies and the CI proof badge is shown (10 s). (5) Scoreboard: 120 injection attacks, 0 forbidden actions (10 s).
- **Build order if two developers and about four weeks:** #1 -> #8 -> #2 -> #6 -> #7 -> #5 -> #4 -> #11 -> #12; #9 and #10 as time allows; #3 only as a research prototype.

### Gaps
- None of the demo timings were rehearsed; they are planning estimates.
