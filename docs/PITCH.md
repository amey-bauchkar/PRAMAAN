# PRAMAAN pitch kit

For the PPT and the live demo. Everything here is true of the prototype as built. Where a claim rests on research rather than on code, it says so and points to the source in `docs/research/notes/proof-not-opinion-prior-art.md` (the examiner's notes, written to attack the idea, not to flatter it).

## One sentence

**PRAMAAN turns campus placement from claims into receipts: skills that were checked, decisions anyone can replay, and placement numbers an auditor can verify.**

For the first slide: **Receipts, not claims.** Similar slogans exist in hiring tech (for example "proof, not proxies"), so run a quick slogan check before printing it on anything public.

## The idea in three lines

1. **Skills are proved, not claimed.** A skill is Verified only after a check that ran: a test, a code check, a mentor's sign-off.
2. **Decisions can be replayed.** Every eligibility decision stores its inputs and the rule version. Anyone can run it again and must get the same result.
3. **Placements are signed twice.** The recruiter signs the offer, the student signs the acceptance, and both go into a public log. A placement without both signatures is counted separately as "recorded by the college only". If an entry is changed later, the checks fail.

The log is signed by whoever runs it (the operator). A university can also witness it with a separate key, so a rewrite of history the university has already seen shows up as a mismatch, even if the operator signs the log again. Principle behind all three: a model may propose, but only something that was executed, computed or signed may decide.

## The problem, and the evidence you may cite

The honest framing: **a placement number is today the college's word, and the checking around it is light.** It is not "colleges forge offers".

| Evidence | What it supports | Careful wording |
|---|---|---|
| NIRF's India Rankings 2023 report says its team did "limited validation of data" and that accuracy rests with the institution | Rankings rely on self-reported aggregates | Quote it as NIRF's own words (section 8 of that report). Say "2023 report". |
| NAAC's 2025 reform is described by its own committee chairman as trust-based, data-driven, with penalties for false data (ThePrint, 10 Jul 2025) | Regulators are moving to trust plus penalties, so a way to prove a part of the data has a place | Reported interview, second-hand |
| US Department of Education fined Corinthian Colleges (Heald College) about USD 30 million in 2015 for misstated placement rates | Placement numbers are a known abuse area | A government finding, not our opinion |
| News reports in Aug 2026 compare NIRF placement returns with RTI replies (AMU law) and with an audit report (IIM Amritsar) | Published numbers can disagree with other records | **Allegations by news outlets, not adjudicated.** The IIM Amritsar report also has differing denominators. Do not name a college on a slide unless you need to, and then say "reported by". |
| Odisha 2017 reports: an agency interviewed students and issued offers in the names of companies that later said they had not hired | Fake offers are real. Note that **two signatures alone would not stop this**: the recruiter key must be tied to the real company (see limits below) | Scroll, Jan 2018; Careers360, Dec 2019 |

Also true and worth one line on the problem slide: students are rejected without a reason they can use, and recruiters guess from resumes. Those two are what the skill and decision receipts address.

## How to talk about novelty (the honest version)

The cryptography is the least original part. Say that first, then say what is new.

> The pieces are proven: signed records, Merkle logs and witnesses, the design that secures web certificates (Certificate Transparency). We apply them to a number nobody can check today, a college's placement figure. Three parties take part (recruiter, student, college). The student keeps a receipt. Anyone can run the verifier. Reports split "verified" from "recorded by the college only". A parent university can act as the witness.

**Time-boxed search statement (use as written, keep the date).** In a time-boxed search in November 2026 of academic papers, patents, accreditation documents, open-source transparency-log projects and the public documentation of Indian and global placement platforms, we found no public product, paper, standard or scheme that combines recruiter-signed offers, student-signed acceptances, a per-college append-only Merkle log with witness-cosigned checkpoints, and accreditation statistics split by verification status. We did not run a professional patent search and could not see private products or demos.

**What already exists. Say it before a judge does.**

- **Signed placement forms on paper.** The IIM placement reporting standard (IPRS) already accepts a student-signed placement form and a recruiter-signed data form as proof for an external audit. We make that proof checkable by anyone, any time, instead of once a year by one auditor.
- **Audits of placement data.** IPRS (India), ACCSC and the ABA (US) audit samples of placements. We make the sample reproducible from a seed the auditor picks, and its evidence checkable.
- **Signed offers.** IndianOil issues offers through DigiLocker, and some hiring tools e-sign offers. Those prove an offer came from an employer. They do not give the public a count.
- **Logs and witnesses.** Certificate Transparency, Sigstore, the Go checksum database, the C2SP witness protocol and IETF SCITT. We borrow the design on purpose.
- **Blockchain recruitment papers and one patent** (AT&T US 10,832,220) on signed records on a ledger.

**What we claim is new:** the combination for placement claims, the three-party signature, the split statistics, and a parent university as the witness (a governance idea; the witness pattern itself is standard).

| Do not say | Say instead |
|---|---|
| First, first ever, only, world's first | "In our time-boxed search we found no public prior art for this combination." |
| Tamper-proof, immutable, cannot be faked | "Tamper-evident: any later change shows up in the checks." |
| The college cannot fake a placement | "A verified placement needs a recruiter key and a student key. A fake recruiter key is the weak point, and an auditor can catch it by calling the company." |
| Trustless, no trust in us | "Check it yourself, in your browser or with a script that shares no code with the site." |
| Blockchain, decentralised | "An append-only log like the one behind web certificates. One operator, one witness today." |
| Independent witness network | "One university witness today. More witnesses are the next step." |
| RFC 9162 compliant, standards-based checkpoints | "RFC 6962-style hashing. The checkpoint format is our own." |
| Legally binding signatures | "Audit evidence. An eSign or DSC overlay for recruiters is a later option." |
| Proves the student joined or is employed | "Proves an offer was signed and accepted. A signed joining event is the next step." |
| Approved by NIRF or NAAC, DPDP compliant, fraud cut by X percent | Nothing. None of these is true or measured. |

## 60-second demo (the order matters)

| Time | Screen | What you say | What the judge sees |
|---|---|---|---|
| 0:00 | Landing page, press **Check a placement ledger yourself** | "These are this college's placements. Not a PDF. A log." | Counts: verified placements, rule versions, decision batches. |
| 0:10 | Press **Check this ledger in my browser** | "My browser rebuilds the log and checks the signatures. You can run the same check with a script that shares no code with this site." | A list of "Yes" lines, including the university's witness. |
| 0:20 | Recruiter (Neha Kapoor), Pipeline, **Signed offers**: find Rahul Bhosale (rows are alphabetical, so scroll to the R's), type a CTC, **Sign and send offer** | "A recruiter signs an offer with a key that never leaves their browser." | Offer sent, "waiting for the student". |
| 0:30 | Switch to the shortlisted student, **My Offers**, **Accept and sign** | "The student signs the acceptance and keeps a receipt." | Receipt appears and checks itself in the browser: all Yes. |
| 0:40 | Officer, **Trust Ledger**, **Change one salary in the database** | "Now an insider triples a salary and recomputes the fingerprint." | Red: the recruiter's signature no longer matches and the log no longer matches the state the operator signed. |
| 0:50 | **Put it back**, then **Rewrite history and sign it again** | "Now whoever runs the log rewrites history and signs it again with the log's own key." | The log's own checks pass. The university's earlier witness signature no longer matches. |
| 0:58 | **Put it back** | "A change can be made. It cannot be hidden from someone who checks." | Green again. |

Backup: if the network or browser fails, show a recorded video and `apps/api/tests/v2-ledger.test.ts` plus `v2-ledger-witness.test.ts`, which do the same in code.

## 10 slides

Each slide has one headline. Keep it on the slide, move the detail to speaker notes.

1. **Receipts, not claims.** The one sentence, the logo, three small icons for the receipts.
2. **A placement number is the college's word.** NIRF's own report: "limited validation of data". One reported case, labelled as an allegation. Students get no reason, recruiters guess.
3. **Three receipts.** Skill, decision, placement. One line each.
4. **Skill receipt.** Proof levels and the code ownership check. Say plainly: it checks understanding at the time of the test, and it cannot stop a person using an assistant on another screen.
5. **Decision receipt.** Replay this decision with the stored inputs and rule version. Fairness check and rule repair before publishing. Say plainly: replay proves the rule is repeatable, not that the inputs were true.
6. **Placement receipt.** Two signatures and the public log. Show the demo here.
7. **Try to cheat.** The attack table below, with the live tamper and rewrite.
8. **Built for India.** Hindi and Marathi reasons, DPDP consent and erasure, NAAC and NIRF style reports that split verified from recorded placements.
9. **What is real, and what is not.** Prior art in one line ("IPRS does this on paper; we make it checkable"), the limits table from `docs/KNOWN_LIMITATIONS.md`, and the three weakest points with their fixes. Judges trust a team that lists its limits.
10. **Pilot and ask.** One college, one recruiter, one auditor, one university witness. Metrics: share of placements verified, time to answer a student's "why", appeals decided in 3 days.

Tag every number on slides as **measured** (from the prototype), **simulated**, **cited** (with link) or **projected**. Never put an unlabelled number on a slide. Measured today: the offline test suite (`npm run test:offline`) passed with 52 test files and 575 tests on 20 Nov 2026 (three timing-sensitive files fail only when the machine is heavily loaded, and pass on a rerun).

## What the log protects against, and what it does not

| Attack | What happens |
|---|---|
| Someone adds a placement with no recruiter | It is not a verified placement. It counts only in "recorded by the college only", and reports label it that way. |
| Someone adds a fake recruiter and a fake student | It passes the signature checks. **This is the weakest point.** An auditor catches it by drawing a sample with a seed the auditor picks (so the college does not choose it) and calling the company on contact details the college did not supply. A recruiter can now prove that the key holder controls a company domain (a line published on the company website), and audit tables show that domain or "not proved". An agency or a college can still own a domain, so the auditor still calls the company. Next: registration numbers and a recruiter-key log across colleges. |
| Someone changes a salary | The recruiter's signature no longer matches. Even if the entry's fingerprint is recomputed, the log no longer matches the state the operator signed (shown live). |
| Someone deletes a placement | The student or recruiter still holds a signed receipt, and an earlier signed state no longer extends to the current one (the public page checks this). |
| The operator rewrites the log and signs it again | The operator's own checks pass. The university witness signed an earlier state with its own key and the rewrite no longer matches it (shown live). Entries added after the last witnessing are protected only by the operator's signature and the receipts until the university witnesses again. One witness can also fail by colluding or by not looking. |
| A recruiter signs an offer they never meant | The signature is theirs. It proves they signed, not that they were honest. |
| An agency issues offers in a company's name | Same as a fake recruiter: valid signatures, the domain shows who controls the key, which exposes an agency domain but not an authorised agent. The company call-back is still what settles it. |
| A student accepts and never joins | The log shows an accepted offer, not a joining. Signed joined and resigned events are the next step. |

## Questions a judge will ask

- **"Isn't this just IPRS on paper?"** IPRS already accepts signed forms and an external audit, and we say so. The difference is that anyone can recheck the signatures at any time, the sample is reproducible from a seed the auditor picks, the log shows if history changed, and one source can feed NIRF, NAAC and NBA tables.
- **"Who stops a fake recruiter?"** Three layers, none complete. A recruiter key can be tied to a company domain by publishing one proof line on that website, and audits show the domain. An auditor draws a sample with their own seed and calls the company on contact details the college did not supply. Domain control is not company authorisation, so that call stays. Next: registration numbers (CIN or GSTIN) and a recruiter-key log across colleges.
- **"Who holds the signing key?"** The log operator holds one signing key. In this prototype one key serves every college, and the demo key is a public constant. The next step is a key per college in a hardware module, plus more witnesses.
- **"Who is the witness and why trust them?"** The college's parent university signs the log with a key the operator does not hold. It is one witness, so one colluding or careless university defeats it. More witnesses, and a regulator as one of them, are the next step.
- **"Can't a student use ChatGPT on the code check?"** Not fully stoppable remotely, so we layer checks that each leave evidence a person can read. The practice drive runs in a full-screen window with the camera checked on the student's own device (no video is uploaded), copy and paste blocked, a similarity check against other students' answers, a short question about the student's own code that is answered against what the code really returns, and a numbers-only typing summary. Flags go to a person: nothing is penalised on an AI-detection score, as the problem statement requires, and students under 18 get no camera or typing checks at all. Recruiters can still ask for a live re-check, and we label what it proves.
- **"Why would a college adopt something that exposes weak numbers?"** Honest colleges gain a verifiable edge, and rankings and accreditation bodies can ask for verified counts. Reports show both numbers, so adoption can start with a small verified share and grow.
- **"Why would recruiters sign?"** It takes one click, protects them from disputes, and gives them a receipt too.
- **"Is the AI making decisions?"** No. Models only propose (draft questions, judge interview key points). Eligibility, replay, fairness numbers and signatures are deterministic.
- **"What if I lose my key?"** The prototype keeps a key per browser. A production version needs recovery (a new key registered with approval, old receipts stay valid) and passkey-backed keys.
- **"Is this a blockchain?"** No. It is an append-only Merkle log with signed checkpoints, the design Certificate Transparency uses for web certificates. No tokens, no mining, no network of nodes, no cost per entry.
- **"Is the signature legally binding?"** We do not claim that. A key generated in the browser is audit evidence, not an Aadhaar eSign or a digital signature certificate. A certificate overlay for recruiters is a later option.
- **"Why not just use DigiLocker?"** DigiLocker proves a document came from its issuer. Here the college, the issuer, is the party whose numbers are in doubt, so the proof has to come from the other two parties (recruiter and student) plus a witness. We would accept DigiLocker-issued offers as one more kind of recruiter signature.
- **"Does this expose student data?"** The public log holds fingerprints only. Inside the college's own database an entry holds a pseudonymous student reference, not a name. A hash of guessable ids can be guessed, so a random per-student secret that is deleted on erasure is the next step. Whether a pseudonymous entry counts as personal data under DPDP has not been assessed, so we do not claim compliance.
- **"Does the demo use real data?"** No. The demo data is synthetic and labelled. The recruiter, student and university keys in the demo seed are generated at start-up and discarded. The log's checkpoint-signing key in the demo comes from a fixed public seed, so anyone with the repository can sign as the demo operator. A real deployment sets its own secret.
- **"Can I check it without your website?"** Yes. `npm run verify:ledger -- <api address> <college id>` uses only Node's built-in crypto and fetch. Pin the operator's key and the witness's key to check against keys you trust. It exits with an error if any check fails.

## What to build next, in order

1. Tie recruiter keys to company registration numbers (CIN or GSTIN), and log recruiter keys across colleges. Domain proof already exists.
2. Signed joined, withdrawn and resigned events, and separate counts for offers, joinings and retained.
3. More witnesses (other universities, a regulator), the C2SP checkpoint format, and each witness fetching and verifying the proof itself.
4. A signing key per college in a hardware module, with rotation.
5. Redacted public entries (company id, recruiter key id, salary band, both signatures, a per-student random pseudonym) so the public can recompute counts.
6. Commit the graduating cohort roster, so the denominator is signed too.
