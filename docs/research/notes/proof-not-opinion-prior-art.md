# Proof, not opinion: hostile prior-art notes

Prepared 2026-11-19 by a sceptical examiner. Scope: the mechanism as designed (two-party signed offers; per-college Merkle log with signed checkpoints and a public verifier; verified/recorded statistics split with auditor sampling; committed and replayable eligibility decisions; parent-university witness cosigning; the proof-not-opinion principle).

## How to read these notes

Reading codes, used inline and in the source list:

- **[L]** fetched, text extracted locally with pdftotext, read by me. Paraphrases and clause numbers are reliable.
- **[F]** fetched with WebFetch. The tool returns a small-model extraction of the page against my prompt, so this is second-hand reading. I asked for dates, numbers and attributions and noted gaps.
- **[S]** seen only in a search-result summary, not opened. A lead, not a verified fact.
- **[X]** fetch failed or returned nothing (HTTP 403/404, empty page, DNS failure). Not read.

Limits, stated up front:

- Time-boxed. The web search tool is US-only. No Indian-language sources, no paid databases (IEEE Xplore, Scopus, Derwent), no professional patent search, no vendor demos, no product changelogs found for Superset, Unstop, Placewit or CollPoll.
- nirfindia.org returned HTTP 403 to every fetch. The 2024-2026 NIRF framework PDFs and the India Rankings 2025 report were therefore not read. The 2017 methodology and the 2023 report were read through college-hosted copies. Clause wording may have changed since.
- Official wording is paraphrased with section numbers, not copied. One short quote is used (section 1.1). Read the cited section for the exact text.
- Not found means absent from what I could reach. It is not proof of absence.

---

## 0. Findings in brief

**A. The problem is real, but it is mostly self-reported aggregates that are lightly checked, not forged signed offers.** NIRF's own India Rankings 2023 report says its team did limited validation and that accuracy rests with institutions. NAAC's chairman describes the 2025 reform as trust-based with penalties for false data. Documented misreporting (AMU law, Aug 2026; IIM Amritsar, Aug 2026) is about inflated aggregates. In one documented Odisha case (2017; SOA University and ITER in the reports), fake offers came through an agency claiming to represent companies, and the students accepted in good faith. US precedent (Corinthian/Heald, fined about USD 30 million in 2015) involved paying temp agencies to hire graduates briefly. Two signatures do not stop those unless recruiter keys are tied to real companies and auditors call the company back.

**B. Every ingredient has precedent. The cryptography is the least original part.** Closest hits: the Indian Placement Reporting Standards (IPRS, IIM Ahmedabad; revision 2.2, Sept 2017) already accept a student-signed placement form plus a recruiter-signed data form as proof for a mandatory external audit. ACCSC (US) requires an independent verifier to sample at least 50 percent of reported placements and confirm each with the employer or graduate. The ABA (US) audits a random 4 percent of graduate files. AT&T patent US 10,832,220 B2 (shown as active) describes applicant-signed and registrar-signed record hashes on a blockchain that recruiters check; claim 1 as read covers the applicant-signing smart-contract flow. A 2025 PLOS One paper uses ECDSA signatures by companies and students on a school-company blockchain. IETF SCITT (RFC 9943) standardises signed statements plus transparency receipts. No source combining all of: recruiter-key offer, student-key acceptance, per-college CT-style log, witness cosigning, and accreditation statistics split by verification status.

**C. No competitor found that offers verified offers or verified placement statistics.** Closest: Superset (placement team approves offers; system checks CTC, role and location against the announced drive; no employer confirmation or cryptography in public docs), OpenEduCat (QR link to the institution's own verification page), RippleHire (eMudhra-certified e-signed offers), and employer issuance through DigiLocker (IndianOil, Sept 2026). The government could absorb the verification role through DigiLocker, EPFO and the NAAC One Nation One Data portal.

**D. Safe wording exists. Claims of being first, tamper-proof, impossible to fake, needing no trust, RFC 9162 compliant or legally binding are unsafe.** Biggest weaknesses a judge or cryptographer will raise: the recruiter-key identity problem (the college can register a key it controls; agencies and paid employers sign validly); the operator holds the checkpoint key; the verifier page is served by the party being audited; the public page exposes only hashes, so the public cannot recompute counts or medians; the audit sample is drawn by the server; offers are not joinings.

**W. Witness cosigning is standard. A parent university as the witness is the new part.** The witness pattern is documented in CoSi (2016), Sigsum, the C2SP tlog-witness protocol, OmniWitness, ArmoredWitness and Tessera witness policies. Rekor v2 planned built-in witnessing (Oct 2025). No source found for a regulator or parent institution acting as witness. The implementation differs from the standard in ways that weaken it (section 2.3).

---

## 1. Problem evidence

### 1.1 What NIRF and NAAC require as evidence, and how it is checked

**NIRF data collection.**

- The Data Capturing System templates (Overall template; NIIT University's 2025 submission printout) ask for aggregates per programme and year: students placed, median salary of placed graduates in rupees, students selected for higher studies. The printed templates show no per-student evidence field. The live portal may differ. [L: DCS template; NIIT printout]
- The 2025 Colleges framework reportedly also asks for company names, numbers recruited per company and salary ranges. [S: search summary of nirfindia.org Colleges.pdf; not opened]

**NIRF checks, from the 2017 methodology [L].**

- 3.2: institutions must publish the submitted data on their own website and invite public comment for at least four weeks before final submission.
- 3.3: NIRF does limited checking, on a random basis, that the data is on the site.
- 3.4: data stays on the site for three years; institutions acting dishonestly or unethically are automatically debarred for two years.
- 3.5: NIRF may physically check institution records and audited accounts; non-cooperation can lead to debarment.
- 4.3: NIRF may authenticate data with partner agencies where felt necessary and feasible.
- 5.1: the institution is responsible for checking what NIRF displays; silence counts as agreement.
- 5.2: deliberate manipulation leads to removal from the list and from future rankings, with a public note.

**NIRF practice, India Rankings 2023 report [L].**

- 6.5.1: expert committees looked for outliers. Institutions with exaggerated or anomalous data were contacted and, where felt necessary, asked for documentary evidence.
- 6.5.2: final responsibility for accuracy lies with the institution.
- Section 8, in NIRF's own words: the NIRF team "has done limited validation of data".

**2025-2026 developments (all second-hand).**

- Madurai Bench of the Madras High Court granted an interim stay on publishing NIRF 2025 in March 2025 on a PIL alleging unverified, inflated data (PhD, faculty, funds figures higher than in NAAC AQARs) [F: Careers360, 24 Mar 2025]. The stay was lifted; rankings came out 4 Sep 2025 [F: Education21; Leaflet]. The court noted the petitioner could challenge the published list if discrepancies were evidenced [F: Education21].
- NIRF 2025 added negative marking for retracted research. The NBA chairman said penalties for misrepresentation of data are being built into the methodology, and that a decision to debar institutions that persist had not yet been taken (3 Oct 2025) [F: Careers360/PTI; F: Education21 citing Times of India]. I found no confirmed case of an institution penalised for misreporting placement data. The CIC noted a long delay in the AMU RTI case and imposed no penalty [F: Leaflet].
- A single source says the Ministry outsourced data verification to EY [F: Education21]. Unconfirmed elsewhere.
- NIRF 2026 had not been released as of 10 Oct 2026 per a guide site [S]. The 2026 data window closed in March 2026 [S].

**NAAC.**

- Placement (metric 5.2.1) is validated through Data Validation and Verification (DVV). College-published DVV clarifications ask for year-wise student lists and supporting proof for selected students (offer or appointment letters for placement; admission letters or ID cards for progression) [L: Jeppiaar Institute DVV 5.2.1 clarification; S: other colleges' DVV files, one reporting offer letters for 25 students in the older placement-only version]. The official NAAC manual was not read.
- Feb 2025: CBI arrested ten people including the chairman and six members of a NAAC inspection committee over alleged bribery for an A++ grade for KLEF; about 900 assessors were later removed [F: THE opinion, 9 Apr 2025; S: Careers360, ThePrint, Deccan Herald].
- July 2025: NAAC's executive committee chairman described the new binary accreditation as trust-based and data-driven, with minimal physical visits and heavy penalties for false submissions [F: ThePrint, 10 Jul 2025]. In a separate interview he said NAAC does not verify every institution individually, is building AI anomaly detection, requires public disclosure of submitted data, and cited loss of accreditation for up to five years or a three-year bar from rankings as penalties. A One Nation One Data portal would let AISHE, NAAC, NBA, AICTE and others pull a single yearly submission by API [F: Careers360].
- NBA: the management SAR format sets a placement ratio above 60 percent averaged over three years [S].

**Reading.** Placement evidence for NIRF is an aggregate return. Checking is sampled and discretionary. The official line in 2025 is trust plus penalties plus anomaly detection. Nothing in the regulators' public material asks for cryptographic evidence. That is a gap for the pitch and a risk: regulators may not care until they are asked to.

### 1.2 Documented cases in India

| Case | Date | What is documented | Source (read) |
|---|---|---|---|
| AMU law placement data | Leaflet 19 Aug 2026; Siasat 21 Aug 2026 | NIRF returns claim 182 of 218 (2023-24), 184 of 217 (2022-23), 185 of 219 (2024-25) placed with an identical median salary. RTI replies: Murshidabad centre nil; Malappuram one confirmed of 51. Annual report lists 10 placements against 184 declared for the same batch. Duplicate names and mislabelled programmes in uploaded registers. AMU gave no substantive answer per the report. Allegations by a news outlet, not adjudicated. | [F] https://theleaflet.in/leaflet-reports/ctrlaltdeceive-amu-fudged-its-law-placement-data-for-years-nirf-looked-the-other-way ; https://www.siasat.com/amu-manipulated-its-placement-records-to-boost-ranking-report-3528435/ |
| IIM Amritsar, NIRF vs audit report | Careers360, 21 Aug 2026 | NIRF figures show more placed students and higher medians than the institute's audited report for 2024 and 2025 batches (for example 277 vs 251, and 310 vs 267 placed). Denominators differ (the audit counts students interested in placement), the article text contradicts its own table once, and the institute called the gap minor. | [F] https://www.careers360.com/mba/articles/iim-amritsar-nirf-audit-report-data-mismatch |
| IIT Kharagpur caution letter | Swarajya, 30 Nov 2018 | Students alleged inflated accessibility claims (not placement). NIRF reportedly issued a warning. Shows the debarment clause exists and was threatened, not applied. | [F] https://swarajyamag.com/amp/story/insta%2Fiit-kharagpur-fakes-numbers-to-rank-higher-receives-caution-letter-from-hrd-ministry |
| NIRF vs annual reports, top IITs and IIMs | Scroll, 16 Jun 2025 | Income and expenditure submitted to NIRF differ from annual reports (not placement). An IIT professor and a former IIT director say there is no proper verification. | [F] https://scroll.in/article/1083409/how-reliable-are-the-rankings-assigned-to-india-s-top-iits-and-iims |
| Fake offer letters, Odisha | 2017 (Scroll 11 Jan 2018; Careers360 11 Dec 2019) | An agency claiming to represent large companies interviewed and issued offers. Companies later said they had not hired from the campus. About 414 students affected in one account. Careers360 reports hundreds of SOA University graduates received fake offers and the university admitted they were scammed. A 2017 report says an associate dean at ITER was arrested; I could not open it. | [F] https://scroll.in/article/862623/indias-engineering-graduates-have-loans-to-pay-but-no-jobs-so-who-is-clearing-their-debt ; https://news.careers360.com/placement-trap-students-share-bitter-truth-about-job-drives/amp ; [S, fetch 403] https://www.business-standard.com/article/pti-stories/iter-associate-dean-arrested-for-fake-placements-of-students-117052600627_1.html |
| Tactics inventory, B-schools | Careers360, updated 26 Dec 2025 | Barring students with backlogs from registering, forced opt-outs, in-house placements, shell firms paid to hire on paper (unnamed placement officer), internships counted as jobs, family business counted. States audit of placement is negligible. Anonymous sourcing; tables unverified. | [F] https://www.careers360.com/mba/articles/the-big-lie-of-100-percent-placements-in-b-schools |
| Offers on paper, paid drives, declarations | Careers360, 11 Dec 2019 | Letters of intent counted as offers; students who left without jobs signed higher-study declarations; fees paid to sit drives; placement cells did not verify recruiters. | [F] link above |
| Advertising | various | Government told Parliament that some edtech ads promise 100 percent placement; ASCI and CCPA have acted in coaching and edtech cases; a Punjab consumer forum ordered a refund where a placement guarantee had no appointment letter. I found no CCPA fine on a degree college for placement claims. | [S] |

### 1.3 Documented cases elsewhere

| Case | What happened | Source (read) |
|---|---|---|
| Corinthian / Heald College (US) | US Department of Education found 947 misstated placement rates and fined about USD 30 million (14 Apr 2015). Heald paid temp agencies to hire graduates briefly and counted them as placed in field, counted out-of-field and already-employed graduates. The CFPB separately alleged fictitious employers; that is an allegation, not a finding. | [F] https://www.pbs.org/wgbh/frontline/article/for-profit-college-is-closed-after-fine-for-its-job-placement-claims ; [S] CFPB https://www.consumerfinance.gov/about-us/newsroom/cfpb-sues-for-profit-corinthian-colleges-for-predatory-lending-scheme/ |
| US law schools | Villanova censured (Aug 2011) and Illinois found to have falsified admissions data; the ABA section then moved to draft penalties (fines, loss of accreditation) for schools that misreport. Now runs random audits of graduate employment files (section 2.4). | [F] https://www.abajournal.com/news/article/legal_ed_section_defends |
| Temple Fox School of Business | Former dean convicted Nov 2021 of conspiracy and wire fraud for false data to U.S. News about online MBA programmes; sentenced 11 Mar 2022 to 14 months. | [F] https://www.yahoo.com/news/former-temple-u-business-dean-210958192.html ; DOJ pages returned empty [X] |
| FT MBA ranking | KPMG audits selected school-supplied data on an irregular schedule; most schools unaudited for five years or more; IE Business School excluded in 2018. | [S] https://poetsandquants.com/2019/01/23/how-to-read-interpret-the-financial-times-mba-ranking/ |

### 1.4 What the evidence says about the mechanism

The documented fraud modes are not all the same as a college forging an accepted offer. Mapping:

| Documented mode | Documented where | Do two signatures plus a log help? |
|---|---|---|
| Inflated numerators in a self-reported return, no offers behind them | AMU, IIM Amritsar | Yes for the verified bucket. It cannot be filled without both signatures. The college-only bucket stays self-reported, which is the point of the split. |
| Agency issues offers in the name of companies that never hired; students are victims | ITER/SOA 2017, Scroll 2018 | Only if the recruiter key is bound to the real company and an auditor confirms with the company. Otherwise both signatures are valid and the log looks clean. |
| College pays real or shell firms to hire briefly | Heald 2015; Scroll 2018 and Careers360 2025 (allegations) | No for the signature. Partly with joined and tenure attestations and EPFO cross-checks. |
| Students with no job counted through declarations | Careers360 2019, 2025 | No. This is a category and denominator problem unless the log also commits to the cohort roster and outcome categories. |
| Internships, family business, in-house roles counted as jobs | Careers360 2025 | Depends on the offer type in the signed schema. |
| Duplicates, wrong programme labels, missing salary | AMU | Yes, if each entry has a unique student reference and a mandatory salary. |
| Different numbers to different bodies | IIM Amritsar; Scroll 2025 | Yes. One signed source can feed NIRF, NAAC and NBA. |
| Backlog bars, forced opt-outs | Careers360 | No. |
| Assessor bribery | NAAC 2025 | Different problem. |

I found no documented case of a college forging two-party signed offers. That is also because such signatures barely exist in India outside IPRS forms (section 2.1).

---

## 2. Prior art per element

### 2.1 Element 1: recruiter signs the offer, student signs the acceptance, college cannot create or alter a placement without both

| Ingredient | Status | Evidence | Read |
|---|---|---|---|
| Employer-signed, checkable offer or appointment letter | **Already exists (India)** | IndianOil issues Offers of Appointment through DigiLocker with MeitY, as a defence against fake letters (reported 19 Sep 2026): https://psuwatch.com/newsupdates/indian-oil-becomes-first-psu-to-issue-appointment-offers-through-digilocker . TCS, Cognizant and Tech Mahindra added QR-based digital signatures to offer letters (People Matters, 26 Nov 2013): https://www.peoplematters.in/news/talent-acquisition/digital-signatures-to-deter-job-hoaxes-4059 . DigiLocker issuer route for offer letters is advertised by vendors (Meon) [S]. | [F], [S] |
| Employer-issued verifiable employment credentials | **Already exists (global)** | Microsoft Entra Verified ID, issuer-signed, holder-controlled (Microsoft Learn what's-new page, updated Nov 2026): https://learn.microsoft.com/en-us/entra/verified-id/whats-new ; LinkedIn workplace verification with Entra (2023, current employment only) [S] https://techcrunch.com/2023/04/12/linkedin-rolls-out-ways-to-verify-your-identity-and-employment-without-a-price-tag ; Velocity Network career credentials [S]; Workday Credentials beta, Oct 2019, status since unknown https://www.ledgerinsights.com/workday-beta-blockchain-credentials-platform/ | [F], [S] |
| Candidate-signed acceptance | **Already exists** | RippleHire (Indian ATS): click-to-accept or eMudhra-certified e-signature, hash-based tamper detection, audit trail: https://www.ripplehire.com/digital-signatures . Aadhaar eSign for offer letters is sold by many vendors [S]. | [F], [S] |
| Recruiter signature and student signature as audit proof of placement | **Already exists (B-schools, on paper)** | IPRS revision 2.2 section 7.3: an institute can have the student sign a placement form naming the recruiter whose offer they accept; the recruiter signs a data form with designation and contact details; offer letters are also accepted; auditors accept these as proof. Section 5.2: statistics must be certified by an external auditor. | [L] https://coalitiongreenwich.crisil.com/content/dam/crisil/our-businesses/sme_ratings/Placement-Data-Audit/IPRSRevision2.2.pdf ; IIMA says it publishes only third-party audited reports https://www.iima.ac.in/inmediaiprs-report-2025-iima-mba-pgp-reaffirms-continued-trust-recruiters-institutes-talent-pool [F] |
| Employer and student ECDSA signatures in school-company recruitment on a ledger | **Close precedent** | PLOS One 2025 (Chen et al.): Hyperledger Fabric among schools and companies, IPFS, companies sign postings with ECDSA, students sign applications and authorisations. No offers, acceptances or statistics. https://pmc.ncbi.nlm.nih.gov/articles/PMC12321149/ ; Dhanala and Radha, IEEE ICCES 2020 (Ethereum recruitment records verified by college, past employers, police) https://www.amrita.edu/publication/implementation-and-testing-of-a-blockchain-based-recruitment-management-system/ | [F] |
| Holder-signed plus registrar-signed record hashes on a ledger, verified by recruiters | **Close precedent, patented** | AT&T US 10,832,220 B2, priority 6 Mar 2018, granted 10 Nov 2020, shown as active: applicant signs published records on a blockchain; the description has a recruiter comparing applicant-signed and registrar-signed hashes. Claim 1 as read covers a smart contract between applicant and group manager and applicant-signed records; it does not recite offers or placement statistics. Claims not fully analysed. https://patents.google.com/patent/US10832220B2/en | [F] |
| Other filings | Close | US 2018/0293547 (employment and education verification with blockchain, application, status unknown) https://ipiq.io/patents/5099027 [F]; SAP US 2018/0082256 (credential verification network) [S, fetch 403]; MassMutual US 11,308,448 [S] | mixed |
| Hackathon and thesis-grade placement dapps | Close | Resume.sol-onchain PIC (Polygon testnet, Jan 2024; no offers or statistics) https://devfolio.co/projects/resumesolonchain-picplacement-andinternship-cell-07d8 [F] | [F] |
| **The combination**: recruiter key signs the offer, student key signs an acceptance that commits to the offer hash, entry appended to a per-college CT-style log, entries feed accreditation statistics | **No public prior art found** | Searched: IEEE, PLOS and arXiv blockchain placement and recruitment papers; Google Patents and USPTO via web search; hackathon sites; Indian credential startups; global ATS and campus platform documentation; NIRF, NAAC, NBA, AICTE with blockchain. | |

Legal note: a self-generated ECDSA key is not an Aadhaar eSign or a Digital Signature Certificate under section 3A and the Second Schedule of the IT Act (secondary sources only [S]). Do not call these signatures legally binding.

### 2.2 Element 2: per-college append-only Merkle log, signed checkpoints, inclusion and consistency proofs, public verifier, receipts

| Ingredient | Status | Evidence | Read |
|---|---|---|---|
| Merkle log with inclusion and consistency proofs and signed tree heads | **Already exists** | RFC 9162 (CT v2.0, Dec 2021) is Experimental and obsoletes RFC 6962: https://www.rfc-editor.org/rfc/rfc9162.html . Russ Cox, Transparent Logs for Skeptical Clients (2019), for the Go checksum database: https://research.swtch.com/tlog . Sigstore Rekor v2 GA 10 Oct 2025, tile-backed: https://blog.sigstore.dev/rekor-v2-ga/ . Tessera, successor to Trillian v1, production ready: https://github.com/transparency-dev/tessera . Let's Encrypt retired its RFC 6962 logs for Static CT API tile logs (read-only 30 Nov 2025, shut down 28 Feb 2026): https://letsencrypt.org/2025/08/14/rfc-6962-logs-eol.html | [F] |
| Receipts a holder keeps, verifiable offline | **Already exists** | RFC 9943 SCITT Architecture (Standards Track, 2026): issuer-signed statements registered with a transparency service, which returns a receipt (signed proof of inclusion). Scope text says software supply chain, applies to other chains. https://www.rfc-editor.org/rfc/rfc9943.html . RFC 9942 COSE Receipts defines the RFC 9162 SHA-256 tree inclusion and consistency proof encodings: https://www.rfc-editor.org/rfc/rfc9942.html | [F] |
| Log outside certificates and software | **Already exists** | Go checksum database; Android Binary Transparency, LVFS and Sigsum monitored by witnesses (https://blog.transparency.dev/can-i-get-a-witness-network [F]); WhatsApp auditable key directory, append-only with public audit proofs (Apr 2023) https://engineering.fb.com/2023/04/13/security/whatsapp-key-transparency/ [F] | [F] |
| Hash-tree integrity for public registries | Close precedent | Estonia KSI for registries and health records [S] https://www.globenewswire.com/news-release/2016/03/03/1202115/0/en/Estonian-Government-Guardtime-Accelerate-Adoption-of-Blockchain-Technology-to-Secure-1M-Patient-Health-Records.html . Haber and Stornetta (1991), weekly hash in the New York Times [S] https://decentralizedthoughts.github.io/2020-07-05-the-first-blockchain-or-how-to-time-stamp-a-digital-document | [S] |
| Education and exam ledgers | Close precedent (India and abroad) | OpenCerts, Singapore, Merkle-batch certificate roots on Ethereum [S] https://developer.tech.gov.sg/products/categories/blockchain/opencerts/overview . CBSE with NIC blockchain for board results documents, 2021 [S] https://news.careers360.com/cbse-use-blockchain-technology-secure-board-exam-result-documents/amp . Madhya Pradesh and Open Campus MoU for up to 50 million student records, Jan 2026 [F] https://briefglance.com/articles/madhya-pradesh-taps-blockchain-to-digitize-50-million-student-records . Startup India blockchain certificate verification, Oct 2020 [F] https://inc42.com/infocus/blockchain-this-week/startup-india-unveils-blockchain-based-certificate-verification-system | [F], [S] |
| Public append-only logs for hiring and selection | Close precedent, thinly documented | Kerala PSC blockchain recruitment system inaugurated Mar 2026, mechanism not described [F] https://duk.ac.in/spotlight/kbas-blockchain-based-system-at-kpsc-inaugurated-by-the-honble-chief-minister/ . AIIMS Delhi declared 460+ faculty results in Jul 2026 with a blockchain layer between marks and the merit list; marks locked with OTPs; no technical description or independent verification reported [F] https://educationpost.in/news/technology/aiims-delhi-fills-over-460-faculty-posts-adopts-blockchain-technology-in-recruitment | [F] |
| E2E-verifiable voting bulletin boards | Close precedent, other domain | vVote public web bulletin board https://arxiv.org/pdf/1404.6822 [S] | [S] |
| **CT-style transparency log (not a consensus blockchain) of campus placements, hiring, admissions or grades** | **No public prior art found** | Searched transparency log with hiring, admissions, grades, exam results, placement; Merkle with placement statistics; blockchain with NIRF, NAAC, AICTE. Only blockchain-style prototypes found (above). | |

Two cautions a cryptographer will raise:

- RFC 9162 is Experimental. The deployed ecosystem moved to tile logs (Static CT API, C2SP tlog-tiles) and C2SP signed-note checkpoints, not to RFC 9162. Say `RFC 6962-style hashing`. Do not say `RFC 9162 compliant`.
- The college-signed checkpoint in the code uses a custom text format (origin, size, hex root, college-supplied time), not a C2SP checkpoint. See 2.3.

### 2.3 Element 2b (new): a parent university cosigns the college's checkpoints with a key the college does not hold

**What is already standard.**

| Piece | Evidence | Read |
|---|---|---|
| The idea of independent witnesses cosigning authoritative statements so a rewrite is caught | Syta et al., CoSi, IEEE S&P 2016 (arXiv 1503.08768) [S]. Haber and Stornetta's newspaper publication of a root is the oldest form [S]. | [S] |
| CT gossip as the earlier answer to split views | IETF draft-ietf-trans-gossip: Experimental, expired, last revision -05 (14 Jan 2018), never became an RFC. https://datatracker.ietf.org/doc/draft-ietf-trans-gossip/ | [F] |
| Witness protocol | C2SP tlog-witness: a log posts the previous size, a consistency proof and the new checkpoint; the witness checks its own stored last-cosigned state for that origin (409 on size mismatch, 422 on a bad proof), checks the log's signature, persists the state before answering, and returns a timestamped cosignature. It must not cosign an inconsistent checkpoint. https://c2sp.org/tlog-witness | [F] |
| Checkpoint and cosignature formats | C2SP tlog-checkpoint: origin line, decimal size, base64 RFC 6962 root, signed-note signatures. tlog-cosignature: Ed25519 (or ML-DSA-44, recommended for new deployments) cosignatures that include a timestamp; asserts the checkpoint is consistent with every view the cosigner has seen and that tree size never decreases. https://c2sp.org/tlog-checkpoint ; https://c2sp.org/tlog-cosignature | [F] |
| Witnesses check consistency, not content | transparency.dev: one witness shows append-only; an odd-sized group using an N-of-M quorum can detect split views; witnesses do not inspect log contents; separate monitors check legitimacy. https://blog.transparency.dev/can-i-get-a-witness-network | [F] |
| Cadence and freshness | Sigsum design: witnesses poll at least once a minute and cosign only fresh (under five minutes) append-only heads; security assumes at most a threshold of independent witnesses misbehave; end users choose their witness policy. https://getuid.sigsum.org/sigsum/plain/doc/design.md | [F] |
| Witness operators and tooling | OmniWitness (monitors logs in the generic checkpoint format; polling or bastion; public witness network config): https://github.com/transparency-dev/witness/tree/main/cmd/omniwitness [F]. Witness Network, an experimental community-vetted list sharing witness and log configuration: https://www.witness-network.org/ [F]. ArmoredWitness hardware, 15 devices with custodians per the blog [F]. | [F] |
| Log software | Tessera supports C2SP witnesses through a witness policy; if the policy cannot be satisfied, no checkpoint is published. Tessera is the successor to Trillian v1. https://github.com/transparency-dev/tessera [F]. Trillian v1 itself: no built-in witness protocol found. Sigsum's earlier Trillian-based front end used witness cosigning [S]. | [F], [S] |
| Sigstore | Rekor v2 GA post (10 Oct 2025): witnessing to be integrated directly into Rekor, described as a coming follow-up. I could not confirm it has shipped. https://blog.sigstore.dev/rekor-v2-ga/ [F]. A rekor-tiles issue discusses witness cosignatures and post-quantum checkpoint signatures [S]. | [F], [S] |
| Go checksum database | Transparent log run by Google. No evidence found that the go command verifies witness cosignatures. Third-party auditors exist; Source Spotter says it cosigns heads and runs a gossip endpoint [S] https://sourcespotter.com/sumdb/ . The OmniWitness blog lists Go SumDB among logs it monitored [F]. | [F], [S] |

**What is new or unusual in PRAMAAN's use.**

1. **Who the witness is.** In the ecosystem, witnesses are neutral or volunteer operators chosen by each verifier's policy. Here the witness is the college's parent or affiliating university, which has an institutional relationship with the log operator. I found no precedent for a regulator, accreditor or parent institution acting as a witness. That is a governance contribution, not new cryptography.
2. **What is witnessed.** Placement offers, rule publications and decision batches, not software, certificates or keys.
3. **A policy hook.** A regulator could require the checkpoint hash and its witness cosignature in the NIRF or NAAC submission. This is an idea, not an existing rule. I found no such requirement anywhere.

**Where the implementation differs from the standard (read from the repo, not from outside research).**

| Standard practice | As built | Effect |
|---|---|---|
| C2SP signed-note checkpoint; Ed25519 or ML-DSA-44 cosignature with witness timestamp | Custom checkpoint text (origin, size, hex root, college-supplied time); witness signs it plus a key id with ECDSA P-256 from a browser; the signed text carries the college's time, not a witness time | Cannot join existing witness networks; no independent time anchor |
| Witness holds its own state and checks the proof itself before signing | The university admin's browser signs text that the platform server prepares after running the consistency check on its own database; witnessed state lives in the same database | If the operator is the adversary, it can show the witness a doctored view or delete witness records. The witness is independent in key custody only. |
| Cosignatures served by the witness or mirrored by third parties | Served from the platform's public endpoint | Deletable by the operator unless someone else keeps a copy |
| Witness before publishing (Tessera) or at least every minute (Sigsum) | Manual action; receipts at acceptance point at a college-signed checkpoint | Entries after the last witnessed size are unprotected |
| N-of-M quorum | One witness | A single colluding or lazy university defeats it. A university also has reputational reasons to look away. |

**What witness cosigning does and does not catch.**

- Catches: a college rewriting or truncating history up to the last witnessed size and re-signing with its own key, provided verifiers can obtain the earlier cosignature from a source the college does not control.
- Does not catch: entries never logged; fake recruiters or ghost students; collusion between the college and the witness; anything after the last cosigned size; a malicious operator who also controls what the witness is shown.
- Detection, not prevention.

### 2.4 Element 3: statistics split into verified and college-only; auditor draws a random sample, checks signatures, asks the company to confirm the recruiter key

| Ingredient | Status | Evidence | Read |
|---|---|---|---|
| Independent verifier samples placements and confirms with employer or graduate | **Already exists (US)** | ACCSC guidelines for independent third-party employment verification (April 2023): the verifier selects at least 50 percent of employed graduates, may not alter the sample to improve results, must obtain verification from the employer or graduate verbally or in writing (the guideline says this is more than a review of the school's own backup paperwork), works independently of the school, reports verified-correct, verified-but-different, unable-to-verify and verified-not-correct. https://www.accsc.org/wp-content/uploads/2024/02/Guidelines-for-Independent-Third-Party-Verification-42023.pdf [L]; https://www.accsc.org/training-and-resources/resources/employment-verification/ [F] | [L], [F] |
| Regulator draws a random sample of graduate files | **Already exists (US)** | ABA Random Graduate Review, class of 2024 cycle: random sample of 4 percent of graduates or 5 files, whichever is greater; each school uploads the underlying file and a records validation form per selected graduate; mismatches escalate to additional documentation review and the Council. https://www.nalp.org/uploads/25handouts/ABA_QASessionHandout.pdf | [L] |
| External audit of placement statistics in India | **Already exists (B-schools)** | IPRS section 5.2: statistics certified by an external auditor, audit status (cleared or pending) disclosed, raw data kept at least one year; section 5.1: deviations from the standard listed with reasons. IIM Udaipur and IIM Ahmedabad publish audited reports; auditors are mostly small firms and some letters cover only salary figures [S: IIM Udaipur audited reports https://www.iimu.ac.in/upload_data/Placement/IIMU_PGP_FINAL_PLACEMENT_REPORT_AUDITED_2016-18_OCT181.pdf ]. IPRS is modelled on the 1999 MBA CSC (now CSEA) standards [L]. | [L], [S] |
| Accreditor and ranker sampling in India | **Already exists** | NIRF limited random checking and physical checks (2017 clauses 3.3, 3.5); NAAC DVV proofs for selected students (section 1.1). | [L] |
| Reported-versus-unknown split | Close precedent | NACE first-destination standard reports a knowledge rate alongside outcomes; Handshake and Symplicity serve as survey tools [F] https://www.naceweb.org/job-market/graduate-outcomes/first-destination/standards-and-protocols . IPRS compliance statements list deviations. | [F], [L] |
| Statistical audit sampling | Close precedent, other domain | Risk-limiting audits (Lindeman and Stark 2012): audit of sampled paper records against reported tallies; sample drawn from a pseudo-random generator seeded by public dice rolls or inputs from several parties; the manifest is fixed before the audit. https://www.stat.berkeley.edu/~stark/Preprints/gentle12.pdf [L]. India: the Supreme Court raised VVPAT verification from one to five randomly selected polling stations per assembly segment in 2019 and in April 2024 rejected 100 percent verification. https://www.scobserver.in/cases/vvpats-for-voter-verification/ [F] | [L], [F] |
| Cryptographic commitment to a count or total | Close precedent, other domain | Merkle sum trees for proof of liabilities and Provisions (Dagher et al., CCS 2015); a 2018 ePrint paper reports an attack on the liability scheme [S] https://crypto.stanford.edu/~dabo/abstracts/provisions.html ; https://eprint.iacr.org/2018/1139 | [S] |
| Government cross-checks against administrative data | Close precedent, other domain | US College Scorecard earnings come from tax records, not self-report [S] https://collegescorecard.ed.gov/assets/InstitutionDataDocumentation.pdf . India: EPFO UAN employment-history APIs sold by background-check vendors [S]; PM-VBRY (approved July 2025, jobs from 1 Aug 2025 to 31 Jul 2027) pays first-time employees only after UAN face authentication [S]. | [S] |
| **Verified bucket whose sample evidence is cryptographically checkable by third parties, bound to a public witnessed log, feeding NIRF, NAAC and NBA tables** | **No public prior art found** | Searched: NIRF, NAAC, NBA, AICTE with blockchain, ledger, tamper-proof; placement statistics with Merkle or cryptographic proof; verifiable counting for institutional statistics. | |

### 2.5 Element 4: batches of eligibility decisions committed to the log; a student replays a decision against stored rules and inputs and compares result and input fingerprint

| Ingredient | Status | Evidence | Read |
|---|---|---|---|
| Decision logs with input, policy version and result, intended for replay | **Already exists** | Open Policy Agent decision logs record a decision id, the input, the result and the bundle revision, and are intended for auditing, offline debugging and decision replay (a field stores non-deterministic builtin results so a decision can be reproduced). https://www.openpolicyagent.org/docs/management-decision-logs . Styra DAS has a replay button [S]. | [F], [S] |
| Signed record of a policy decision with policy digest and input digests | **Already exists** | SLSA Verification Summary Attestation: policy uri and digest, digests of all input attestations, pass or fail, time verified. https://slsa.dev/spec/v1.0/verification_summary | [F] |
| Cryptographic accountability for automated decisions | Close precedent | Kroll et al., Accountable Algorithms, 165 U. Pa. L. Rev. 633 (2017): procedural regularity, commitments and zero-knowledge proofs so all decisions are shown to use the same policy. I confirmed the citation and thesis from search results only; the full text could not be opened. https://scholarship.law.upenn.edu/penn_law_review/vol165/iss3/3 [S, fetch 404] | [S] |
| Public algorithm and ex-post explanation for admissions | Close precedent | France's Parcoursup: national code published; Conseil constitutionnel decision 2020-834 QPC requires local ranking criteria to be disclosed after the process [S]. | [S] |
| Rules as code with reproducible results | Close precedent | Catala, applied to French family and housing benefits [S] https://arxiv.org/abs/2103.03198v2 | [S] |
| Tamper-evident selection with committed marks | Close precedent (India, 2026) | AIIMS Delhi (Jul 2026), see 2.2. No technical description public. | [F] |
| Campus eligibility shown to students | Already exists (weak form) | Superset shows students which criteria they met or missed (from the team's earlier landscape note). No replay, versioning or commitment found. | [S] |
| **Batch commitment of eligibility decisions to a transparency log with student-side replay of stored rules and inputs, in campus placement** | **No public prior art found** | Searched: eligibility decision replay, student eligibility audit trail, Superset, Unstop, CollPoll, Placewit, rules-as-code and algorithm-transparency literature. | |

Limit to state plainly: replay proves determinism of the stored rule on the stored inputs. It does not prove the inputs were true, the rule was lawful or fair, or that the student was shown the same rule version before the drive.

### 2.6 Element 5: the principle that models only propose

- Propose-and-verify is a standard design: DeepMind's FunSearch pairs a language model that proposes programs with an automated evaluator that scores them [S] https://deepmind.google/discover/blog/funsearch-making-new-discoveries-in-mathematical-sciences-using-large-language-models/
- The slogan space is occupied. CodeSignal's hiring pages are built around a proof-not-proxies message [F] https://codesignal.com/proof-not-proxies/ ; other hiring vendors use proof-based taglines [S]. Do brand and slogan clearance before printing the tagline widely. This is not legal advice.

### 2.7 Verdicts

| Item | Verdict | Where to look |
|---|---|---|
| 1. Two-party signed offer and acceptance | **Already exists in parts** (employer-signed letters, candidate e-sign, IPRS signed forms). **Close precedent** for signed records on a ledger in recruitment (AT&T US 10,832,220; PLOS One 2025). **No public prior art found** for the exact combination as basis for accreditation statistics. | 2.1 |
| 2. Per-college Merkle log with checkpoints, proofs, receipts, public verifier | **Already exists** as technology and standards (CT, Rekor, Tessera, C2SP, SCITT). **Close precedent in other domains** (education ledgers, key directories). **No public prior art found** for placement, hiring, admissions or grades. | 2.2 |
| 2b. Witness cosigning | **Already standard.** Parent university as witness: **no public prior art found**. | 2.3 |
| 3. Verified and college-only split, auditor sampling | **Already exists** without cryptography (IPRS, ACCSC, ABA, NAAC DVV, NIRF). **No public prior art found** for cryptographically checkable samples feeding Indian accreditation tables. | 2.4 |
| 4. Committed, replayable decisions | **Close precedent in other domains** (OPA, SLSA, Kroll, Parcoursup, AIIMS). **No public prior art found** for campus placement. | 2.5 |
| 5. Models only propose | **Close precedent.** Not claimable as novel. | 2.6 |

---

## 3. Closest competitors

Public documentation only. Absence here is not absence in product, demos or sales calls.

| Product | What public material shows about offers and placement statistics | Verification found? | Read |
|---|---|---|---|
| **Superset** (TnpSuite) | Recruiters upload offer PDFs and CTC annexures to a repository; placement team approves, rejects or requests resubmission; system checks CTC, role, location and pay structure against the announced details and flags duplicate selections and offer overlaps; advertises a digital audit trail (blog, 29 Nov 2025). Self-reported scale: 3.07 lakh campus offers in 2022. The blog does not mention NAAC, NIRF or NBA. No changelog found. | Consistency checks and officer approval. No employer confirmation or cryptography found. | [F] https://joinsuperset.com/blogs/?p=3152 ; https://joinsuperset.com/lp/employer ; https://joinsuperset.com/lp/university |
| **Unstop** | Employer-side campus hiring and agents; no institution-side placement dashboard or accreditation export found. | None found. | [S] https://unstop.com/employers/campus-hiring |
| **Placewit** | Nothing found. | None found. | [S] |
| **CollPoll** | Placement Management listed as a module; no detail on offers or accreditation. | None found. | [S] https://www.sourceforge.net/software/product/CollPoll |
| **OpenEduCat** | Offer letter tool for admissions and HR (not placement cells): unique reference, QR to a verification URL on the institution's own domain, statuses active, accepted, withdrawn, expired, e-sign workflow, audit trail. | Authenticity against the issuer's own record. | [F] https://openeducat.org/tools/offer-letter-generator/ |
| **RippleHire** (Indian ATS) | E-signed offers, optional eMudhra-certified signature, hash-based tamper detection. | Signature validity. | [F] https://www.ripplehire.com/digital-signatures |
| **DigiLocker employer issuance** | IndianOil offers of appointment (Sep 2026); issuer API sold by vendors; TCS iON integration announced by NeGD [S]. | Government-signed issuance. | [F] https://psuwatch.com/newsupdates/indian-oil-becomes-first-psu-to-issue-appointment-offers-through-digilocker |
| **Handshake** | First-destination survey tooling on NACE standards (Carnegie Mellon says its figures come from the Handshake survey); a sourced-outcomes beta mentioned on a Syracuse update page; no per-offer verification found. | Self-report plus school-added checks (LinkedIn matching at some schools). | [S] https://www.cmu.edu/career/outcomes/data-definitions.html ; https://answers.atlassian.syr.edu/wiki/spaces/Handshake/pages/524222467 ; [F] NACE page |
| **Symplicity** | Named as an FDS platform by NACE; nothing on offer verification found. | None found. | [F] NACE page |
| **Workday** | Credentials beta 2019 (blockchain, DIDs), later payroll-based employment verification via Equifax, Experian, Checkr; patents on credentials. | Payroll-based, not placement. | [F] Ledger Insights; [S] |
| **HireVue** | Nothing on offers or placement statistics found. | None found. | [S] |
| **LinkedIn with Entra Verified ID; Velocity Network** | Employer-issued verifiable employment credentials. | Current employment, issuer-signed. | [F] Microsoft Learn; [S] |
| **IPRS, NACE, MBA CSEA, ABA, ACCSC** | Standards and audits, not products (section 2.4). | Audit-based. | [L], [F], [S] |

Possible pre-emption by government rails (strategy risk): One Nation One Data portal; DigiLocker issuance by employers; EPFO UAN and PM-VBRY as an administrative record of first jobs; NAD and APAAR for student identity.

---

## 4. Safe and unsafe claims

### 4.1 Time-boxed search statement (use as is, adjust dates)

> In a time-boxed search in November 2026 of academic papers, patents, accreditation documents, open-source transparency-log projects and the public documentation of Indian and global placement platforms, we found no public product, paper, standard or scheme that combines recruiter-signed offers, student-signed acceptances, a per-college append-only Merkle log with witness-cosigned checkpoints, and accreditation statistics split by verification status. We did not run a professional patent search and could not see private products or demos.

Search coverage behind it: NIRF, NAAC, NBA, AICTE and UGC documents and news; fake-offer and inflated-placement cases; US placement-audit regimes; verifiable-credential products (Entra, Velocity, Workday, DigiLocker, EPFO, Aadhaar eSign); IEEE, PLOS and arXiv blockchain recruitment papers; Google Patents and USPTO through web search; hackathon sites; Certificate Transparency, Rekor, Trillian, Tessera, Sunlight, C2SP, Sigsum, Go sumdb and witness networks; transparency or Merkle logs for hiring, admissions, grades and exam results; election bulletin boards and risk-limiting audits; decision-replay and rules-as-code literature; Superset, Unstop, Placewit, CollPoll, Handshake, Symplicity, Workday and HireVue public pages.

### 4.2 Safe

1. We apply a proven pattern, Merkle logs with witness-cosigned checkpoints as used in Certificate Transparency, Sigstore and the C2SP witness ecosystem, to placement claims.
2. A college cannot add or change a verified placement without a registered recruiter key and the student's key, and cannot rewrite history its parent university has already witnessed without the mismatch being detectable by anyone holding the earlier cosignature.
3. NIRF says its own team did limited validation and that institutions are responsible for accuracy. NAAC's chairman describes the 2025 system as trust-based with penalties. We let a college prove a part of its placement numbers instead of asking to be trusted.
4. Audit sampling of placement data already exists (IIM placement audits under IPRS, ACCSC, ABA). We make the sample's evidence independently checkable.
5. The signatures show that the holders of two registered keys agreed to this offer and acceptance. The auditor's call to the company and a signed joined event are what connect that to real employment.
6. Our public page lets anyone recompute the log's integrity in their browser. Statistics are checkable by auditors with access to the entries.
7. The witness today is the college's parent university, a single witness. More witnesses are the next step.

### 4.3 Unsafe

| Do not say | Why |
|---|---|
| First, first ever, world's first, only, never done, novel mechanism, patent-pending | IPRS, ACCSC, ABA, AT&T US 10,832,220, PLOS One 2025, SCITT, Sigstore and C2SP all pre-date it in parts. |
| Tamper-proof, immutable, cannot be faked, the college cannot fake a placement | It is tamper-evident. A registered fake recruiter, an agency, a paid employer, a coerced or ghost student all pass the signature checks. |
| No trust in us, trustless, zero trust | Trust moves to the recruiter-key registry, the verifier code, the witness and the auditor. |
| Blockchain, decentralised | One operator and one witness. |
| Independent witness network, independent witnesses | One parent university is a witness, not a network. |
| RFC 9162 compliant, standards-based checkpoints | RFC 9162 is Experimental; the checkpoint and cosignature formats are custom. |
| Legally binding signatures, valid under the IT Act, eSign | Self-generated keys are not eSign or a DSC. |
| Proves the student was hired, joined or is employed | An accepted offer is not a joining. |
| NIRF, NAAC or NBA accepted, approved, compliant; fraud reduced by X percent | No regulator has said so; no measured outcome. |
| DPDP compliant | Not assessed. |
| Proof, not opinion as an exclusive tagline | Adjacent slogans exist (section 2.6). |

Also fix before the demo script is used: the pitch table says the college holds the checkpoint-signing key, but the code uses one process-level key for all colleges, so the operator holds it (section 5). The pitch says demo signing keys are generated at start-up and discarded, but the demo checkpoint-signing seed is a fixed public constant.

---

## 5. Weaknesses and mitigations

### 5.1 Weaknesses a judge or cryptographer will raise

| # | Weakness | Evidence or reason | Standard mitigation |
|---|---|---|---|
| 1 | **The college can register a recruiter key it controls, and agencies sign validly.** | ITER/SOA 2017 agency offers; Heald paid temp agencies. In the code any authenticated recruiter membership can register any P-256 key; nothing in registration ties the key to a verified company identity. | Bind the key to a legal entity and a domain the company controls (DNS record or well-known file, the DID domain-linkage pattern used by Entra and the DIF spec [S] https://identity.foundation/specs/did-configuration ); check CIN or GSTIN; offer an organisation DSC route (the RippleHire and eMudhra pattern). Keep a cross-college recruiter-key log in the style of WhatsApp's key transparency so a college cannot hold a private key for a company. Auditor calls the company on contact details not supplied by the college (the ACCSC independence rule). |
| 2 | **Paid real employers and short tenures.** | Heald; Scroll 2018. | Signed joined and still-employed-at-90-days events; separate counts for offers, joinings and retained; EPFO UAN match as a sampled check (coverage limits apply). |
| 3 | **Students are not independent of the placement cell; student key re-registration with officer approval lets the college mint a key for a student.** | Careers360 2019 declarations; pitch describes officer-approved recovery. | Bind the student key to the university or exam-board enrolment record, not the college tenant; rotation needs the old key or a witness-cosigned re-registration; auditors call students directly (ACCSC allows verification from employer or graduate). |
| 4 | **The operator holds the checkpoint-signing key.** | One process-level issuer key from an environment seed serves all colleges (ledger.ts, server.ts). | HSM or KMS custody; per-college keys; key rotation by adding signatures (C2SP allows several); external witnesses. State who the operator is in the threat model. |
| 5 | **Witness is weaker than the standard** (single, custom format, server-prepared text, state in the operator's database, no witness time, manual cadence). | Section 2.3 table. | Adopt C2SP checkpoint and cosignature formats; let each witness fetch and verify the proof itself and keep its own state; mirror cosigned checkpoints at the university site and a regulator; add witnesses (other universities, the regulator, the community Witness Network); witness before issuing receipts (Tessera behaviour) or at least every few minutes. |
| 6 | **Split views; no gossip.** | CT gossip drafts expired without becoming an RFC. | A witness quorum and monitors, not gossip. Let receipts carry the latest cosigned checkpoint so holders act as informal gossip carriers. |
| 7 | **Receipts help only if holders check.** | Transparency makes misconduct detectable, not impossible (RFC 9943 says so). | Auto-check receipts in the student app on a schedule; run a monitor for recruiters; accept only witnessed checkpoint hashes at NIRF or NAAC submission time. |
| 8 | **The verifier page is delivered by the party being audited.** | Public page and its script come from the college platform. | Ship an independent verifier (open-source command line tool or neutral hosting), pin its hash, reproducible builds, subresource integrity. Tell users to verify with their own copy. |
| 9 | **Public page exposes only hashes and entry kinds, so the public cannot recompute counts, medians or signature validity.** | Public endpoints return leaf hashes, kinds and times. The verified count is the operator's assertion until entries are disclosed. | Publish redacted entries: company id, recruiter key id, salary band or value, offer hash, both signatures, salted student pseudonym. Or gate disclosure to auditors with commit-then-sample. |
| 10 | **Audit sample is drawn by the server.** | `randomInt` on the server. | Commit-then-sample: fix the log size in a witnessed checkpoint, then derive indices from public randomness (dice or a beacon such as drand https://drand.love/ [F]) and a hash, as in risk-limiting audits [L]. Size the sample per ACCSC (at least 50 percent for small cohorts) or ABA (4 percent or 5) analogues. |
| 11 | **Backdating and time.** | Checkpoint time and signing times are client or server clock claims; live signing is only checked within 15 minutes of server time. | Witness-signed timestamps (C2SP cosignatures have them), RFC 3161 timestamping or OpenTimestamps; define year cut-offs by witnessed time. |
| 12 | **Omission and denominators.** | Log proves what is in it. Backlog bars and forced opt-outs (Careers360) sit outside. | Commit the graduating cohort roster, signed by the university; publish verified placed over cohort and the college-only remainder; define salary (CTC versus maximum earning potential as IPRS does) in the signed schema; dedupe by student because NIRF counts students, not offers. |
| 13 | **Offer is not joining; offers get withdrawn.** | Careers360 2019 on letters of intent. | Signed lifecycle events: joined, withdrawn, resigned within a stated period. |
| 14 | **Legal weight of self-generated keys.** | IT Act section 3A and the Second Schedule recognise listed techniques (Aadhaar eKYC eSign, digital signatures) [S]. | Position as audit evidence. Offer an optional DSC or eSign overlay for recruiters. |
| 15 | **DPDP erasure and correction versus an append-only log.** | Commentary on the conflict (section 12) [S]. | Log salted commitments only; keep entries in an erasable store; crypto-shred the salt on erasure. The public page already shows only hashes. The student pseudonym is a hash of the college id and student id, which is guessable if ids are guessable, so give each student a random secret. |
| 16 | **Browser-held keys are lost on cache clear or device change.** | Pitch concedes no recovery. | Passkeys or WebAuthn-backed keys; recovery by cosigned re-registration; revocation entries. |
| 17 | **Canonical JSON is custom.** | Sorted keys with built-in number formatting. | Sign the exact byte string and store it; or adopt RFC 8785 JCS; publish test vectors for cross-language verification. |
| 18 | **Replay proves repeatability, not truth or fairness.** | Section 2.5. | Sign inputs at source (university marks via NAD or DigiLocker where possible); publish the rule hash before the drive (already logged); label replay as a determinism check. |
| 19 | **Incentive: dishonest colleges will not adopt; regulators are comfortable with trust.** | Section 1.1. | Honest-college advantage; regulator-side pilot; the split-number report lets adoption start small. |
| 20 | **Pre-emption by government rails or an incumbent.** | One Nation One Data; DigiLocker issuance; EPFO. | Interoperate: accept DigiLocker-issued offers as recruiter-side signatures; export evidence packs. |

### 5.2 Implementation observations read from the repo

These come from reading `docs/PITCH.md`, `packages/domain/src/transparency-log.ts`, `apps/api/src/v2/ledger.ts`, `apps/api/src/v2/routes-ledger.ts` and `apps/api/tests/v2-ledger-witness.test.ts`, plus one line in `apps/api/src/v2/demo.ts`. Treat as review comments, not research.

- Tree hashing follows the RFC 6962 pattern: a 0x00 prefix for leaves, 0x01 for nodes, the same split rule, standard inclusion and consistency verification. Good.
- One issuer key for all colleges, set from `PRAMAAN_ISSUER_SEED`. The demo falls back to a fixed public seed constant.
- Witness flow: `/api/v2/university/witness/prepare` runs the consistency check on the server, then the browser signs the returned text; `cosign` verifies the signature and stores it. The test shows a rewritten and re-signed log is flagged only because the stored cosignature is still in the database.
- Checkpoint and witness text carry the college's time. The witness's own time is stored outside the signed text.
- Receipts issued at acceptance point at the latest college-signed checkpoint, not a witnessed one.
- `auditSample` picks the sample with the server's random number generator.
- The demo script line that tells the audience they need not trust the team should become an invitation to check the log with their own copy of the verifier.

---

## 6. Source list and how each was read

Codes: [L] local text extraction, read; [F] WebFetch extraction; [S] search summary only; [X] could not be read.

### Problem evidence

- NIRF Methodology for Ranking of Academic Institutions in India 2017 (college copy) https://allduniv.ac.in/pdf/Ranking_Methodology_And_Metrics_2017.pdf [L]. Official location https://www.nirfindia.org/Docs/Ranking_Methodology_And_Metrics_2017.pdf [S].
- India Rankings 2023 report (college copy) https://marivanioscollege.com//admin/nirf/IR2023_Report.pdf [L].
- NIRF DCS Overall template https://www.unishivaji.ac.in/uploads/naac/2026/may/04-May/NIRF-Overall-Templates.pdf [L]. NIIT University NIRF 2025 submission https://niituniversity.in/wp-content/uploads/2025/03/NIRF25-NIIT-UNIVERSITY2025012.pdf [L].
- nirfindia.org pages and PDFs: https://www.nirfindia.org/ ; https://www.nirfindia.org/nirfpdfcdn/2025/framework/Overall.pdf ; https://www.nirfindia.org/nirfpdfcdn/2025/pdf/Report/IR2025_Report.pdf ; https://www.nirfindia.org/Docs/Ranking-Framework-for-Engineering-Institutions.pdf [X, HTTP 403]. 2025 Colleges framework contents [S] https://www.nirfindia.org/nirfpdfcdn/2025/framework/Colleges.pdf .
- The Leaflet, AMU law placement data, 19 Aug 2026 https://theleaflet.in/leaflet-reports/ctrlaltdeceive-amu-fudged-its-law-placement-data-for-years-nirf-looked-the-other-way and amp version [F]. Siasat, 21 Aug 2026 https://www.siasat.com/amu-manipulated-its-placement-records-to-boost-ranking-report-3528435/ [F].
- Careers360, IIM Amritsar, 21 Aug 2026 https://www.careers360.com/mba/articles/iim-amritsar-nirf-audit-report-data-mismatch [F].
- Careers360, Madras HC stay, March 2025 https://news.careers360.com/nirf-ranking-2025-madras-hc-restrains-education-ministry-nbe-from-publishing-list-after-plea-alleging-malpractice-reports/amp [F]. Education21, 21 Oct 2025 https://education21.in/nirf-2025-a-decade-of-rankings-still-in-evolution/ [F]. LegallyIndia forum post https://www.legallyindia.com/convos/topic/448724-breaking-2025-nirf-rankings-which-got-delayed-because-of-a-mad-hc-order-on-universities-giving-false-data-to-be-released-shortly-new-points-system-and-introduction-of-negative-marking [F, unverified forum, used for nothing load-bearing].
- Careers360/PTI, negative marking, 3 Oct 2025 https://news.careers360.com/nirf-rankings-introduce-negative-marking-for-retracted-papers-poor-quality-research/amp [F]. THE opinion, 9 Apr 2025 https://www.timeshighereducation.com/opinion/indias-universities-must-address-growing-credibility-problems [F]. Scroll, 16 Jun 2025 https://scroll.in/article/1083409/how-reliable-are-the-rankings-assigned-to-india-s-top-iits-and-iims [F]. Swarajya, 30 Nov 2018 https://swarajyamag.com/amp/story/insta%2Fiit-kharagpur-fakes-numbers-to-rank-higher-receives-caution-letter-from-hrd-ministry [F]. Deccan Herald NIRF scrutiny https://www.deccanherald.com/education/nirf-rankings-need-for-scrutiny-3852393 [X, 403].
- NAAC: ThePrint, 10 Jul 2025 https://theprint.in/education-2/after-bribery-row-naac-set-to-roll-out-revamped-accreditation-system-with-stricter-grading-norms/2685638 [F]; Careers360 One Nation One Data https://news.careers360.com/naac-grade-binary-accreditation-anil-sahasrabudhe-university-one-nation-one-data-netf-nba-nirf-2025-ranking-klef-apaar-nep-iit-nit/amp [F]; Careers360 assessors removed https://news.careers360.com/naac-removes-900-assessors-amid-allegations-of-corruption-in-grading-cbi-arrests-bribery-case/amp [S]; DVV 5.2.1 clarification https://www.jeppiaarinstitute.org/pdf/dvv-clarification/DVV-5.2.1.pdf [L]; other DVV files (BLDEA CET, SJCET, others) [S, or index only]; NBA SAR format https://www.nbaind.org/Files/SAR%20Management-30-11-2023.pdf [S].
- Fake offers and inflated placements: Scroll, 11 Jan 2018 https://scroll.in/article/862623/indias-engineering-graduates-have-loans-to-pay-but-no-jobs-so-who-is-clearing-their-debt [F]; Careers360, 11 Dec 2019 https://news.careers360.com/placement-trap-students-share-bitter-truth-about-job-drives/amp [F]; Careers360, updated 26 Dec 2025 https://www.careers360.com/mba/articles/the-big-lie-of-100-percent-placements-in-b-schools [F]; Business Standard/PTI, ITER arrest https://www.business-standard.com/article/pti-stories/iter-associate-dean-arrested-for-fake-placements-of-students-117052600627_1.html [X, 403; headline seen in search].
- Advertising and regulators: CCPA, ASCI, consumer forum items [S] https://news.careers360.com/coaching-institutes-should-not-make-100-selection-claim-guidelines-curb-misleading-ads/amp ; https://lawtrend.in/consumer-panel-orders-education-firm-to-refund-course-fee-over-misleading-job-guarantee/ ; UGC and AICTE items [S] https://theprint.in/india/aicte-will-punish-colleges-if-they-give-wrong-information-in-prospectus/356496/
- Elsewhere: PBS Frontline, Corinthian https://www.pbs.org/wgbh/frontline/article/for-profit-college-is-closed-after-fine-for-its-job-placement-claims [F]; US ED fine letter https://www.republicreport.org/wp-content/uploads/2015/04/EDfinesCoCo.pdf [X, 403]; CFPB https://www.consumerfinance.gov/about-us/newsroom/cfpb-sues-for-profit-corinthian-colleges-for-predatory-lending-scheme/ [S]; ABA Journal https://www.abajournal.com/news/article/legal_ed_section_defends [F]; Temple, AP via Yahoo https://www.yahoo.com/news/former-temple-u-business-dean-210958192.html [F]; DOJ pages https://www.justice.gov/usao-edpa/united-states-v-moshe-porat-et-al [X, empty]; FT MBA audits https://poetsandquants.com/2019/01/23/how-to-read-interpret-the-financial-times-mba-ranking/ [S].
- Audit regimes: ABA/NALP slides https://www.nalp.org/uploads/25handouts/ABA_QASessionHandout.pdf [L]; ACCSC guidelines https://www.accsc.org/wp-content/uploads/2024/02/Guidelines-for-Independent-Third-Party-Verification-42023.pdf [L] and page https://www.accsc.org/training-and-resources/resources/employment-verification/ [F]; IPRS rev 2.2 https://coalitiongreenwich.crisil.com/content/dam/crisil/our-businesses/sme_ratings/Placement-Data-Audit/IPRSRevision2.2.pdf [L]; IIMA release https://www.iima.ac.in/inmediaiprs-report-2025-iima-mba-pgp-reaffirms-continued-trust-recruiters-institutes-talent-pool [F]; IIMA IPRS site https://web.iima.ac.in/iprs/faq.php [X, DNS failure]; IIM Udaipur audited reports [S] https://www.iimu.ac.in/upload_data/Placement/IIMU_PGP_FINAL_PLACEMENT_REPORT_AUDITED_2016-18_OCT181.pdf ; NACE first-destination page https://www.naceweb.org/job-market/graduate-outcomes/first-destination/standards-and-protocols [F]; MBA CSEA standards history [S] https://cdn.ymaws.com/cseaglobal.org/resource/collection/61BF28D3-16AA-4C84-854E-E45A5D6C2054/Standards_History.pdf ; College Scorecard documentation [S] https://collegescorecard.ed.gov/assets/InstitutionDataDocumentation.pdf .

### Prior art: logs, witnesses, standards

- RFC 9162 https://www.rfc-editor.org/rfc/rfc9162.html [F]; RFC 9942 https://www.rfc-editor.org/rfc/rfc9942.html [F]; RFC 9943 https://www.rfc-editor.org/rfc/rfc9943.html [F].
- C2SP: https://c2sp.org/tlog-witness [F]; https://c2sp.org/tlog-checkpoint [F]; https://c2sp.org/tlog-cosignature [F].
- Cox, Transparent Logs for Skeptical Clients https://research.swtch.com/tlog [F]. Go sumdb proposal https://go.googlesource.com/proposal/+/master/design/25530-sumdb.md [S]; Source Spotter https://sourcespotter.com/sumdb/ [S].
- Rekor v2 GA https://blog.sigstore.dev/rekor-v2-ga/ [F]. Tessera https://github.com/transparency-dev/tessera [F]. Let's Encrypt https://letsencrypt.org/2025/08/14/rfc-6962-logs-eol.html [F]. Transparency.dev https://transparency.dev/ [F]; witness network blog https://blog.transparency.dev/can-i-get-a-witness-network [F]; https://www.witness-network.org/ [F]; OmniWitness https://github.com/transparency-dev/witness/tree/main/cmd/omniwitness [F]; ArmoredWitness https://github.com/transparency-dev/armored-witness [S]; Sigsum design https://getuid.sigsum.org/sigsum/plain/doc/design.md [F].
- CT gossip draft https://datatracker.ietf.org/doc/draft-ietf-trans-gossip/ [F]. CoSi https://arxiv.org/abs/1503.08768 [S]. Haber and Stornetta https://decentralizedthoughts.github.io/2020-07-05-the-first-blockchain-or-how-to-time-stamp-a-digital-document [S].
- WhatsApp key transparency https://engineering.fb.com/2023/04/13/security/whatsapp-key-transparency/ [F]. Estonia KSI https://www.globenewswire.com/news-release/2016/03/03/1202115/0/en/Estonian-Government-Guardtime-Accelerate-Adoption-of-Blockchain-Technology-to-Secure-1M-Patient-Health-Records.html [S]. OpenCerts https://developer.tech.gov.sg/products/categories/blockchain/opencerts/overview [S]. vVote https://arxiv.org/pdf/1404.6822 [S].
- Risk-limiting audits https://www.stat.berkeley.edu/~stark/Preprints/gentle12.pdf [L]. drand https://drand.love/ [F]. VVPAT https://www.scobserver.in/cases/vvpats-for-voter-verification/ [F]. Provisions https://crypto.stanford.edu/~dabo/abstracts/provisions.html and https://eprint.iacr.org/2018/1139 [S].
- Decision replay: OPA https://www.openpolicyagent.org/docs/management-decision-logs [F]; SLSA VSA https://slsa.dev/spec/v1.0/verification_summary [F]; Kroll et al. https://scholarship.law.upenn.edu/penn_law_review/vol165/iss3/3 [X, 404; citation from search results]; Princeton copy https://oar.princeton.edu/bitstream/88435/pr1r24q/1/AccountableAlgorithms.pdf [X, 401]; Parcoursup items [S] https://www.assemblee-nationale.fr/dyn/15/questions/QANR5L15QE27517.pdf ; Catala https://arxiv.org/abs/2103.03198v2 [S]; FunSearch [S] https://deepmind.google/discover/blog/funsearch-making-new-discoveries-in-mathematical-sciences-using-large-language-models/ .

### Prior art: offers, credentials, recruitment ledgers

- IndianOil DigiLocker https://psuwatch.com/newsupdates/indian-oil-becomes-first-psu-to-issue-appointment-offers-through-digilocker [F]. NeGD DigiLocker with TCS iON https://www.digitalindia.gov.in/quick_update_post/negd-announces-successful-integration-of-digilocker-with-tcs-ion-recruitment-workflow/ [X, 403]. Meon DigiLocker issuer API https://meon.co.in/digilocker-issuer-api [S].
- People Matters, 2013 https://www.peoplematters.in/news/talent-acquisition/digital-signatures-to-deter-job-hoaxes-4059 [F]. RippleHire https://www.ripplehire.com/digital-signatures [F]. OpenEduCat https://openeducat.org/tools/offer-letter-generator/ [F]. Aadhaar eSign vendor pages [S] https://signdesk.com/aadhaar-esign . IT Act commentary [S] https://helpx.adobe.com/legal/esignatures/regulations/india.html .
- Microsoft Entra Verified ID what's new https://learn.microsoft.com/en-us/entra/verified-id/whats-new [F, reached by redirect from the LinkedIn employment-verification page]; LinkedIn and Entra [S] https://techcrunch.com/2023/04/12/linkedin-rolls-out-ways-to-verify-your-identity-and-employment-without-a-price-tag ; Velocity Network [S] https://lf-decentralized-trust-labs.github.io/labs/lfdt/verii.html (fetch 404); DIF domain linkage [S] https://identity.foundation/specs/did-configuration ; Workday Credentials https://www.ledgerinsights.com/workday-beta-blockchain-credentials-platform/ [F, paywalled, partial].
- PLOS One 2025 https://pmc.ncbi.nlm.nih.gov/articles/PMC12321149/ [F]. Dhanala and Radha https://www.amrita.edu/publication/implementation-and-testing-of-a-blockchain-based-recruitment-management-system/ [F]. Awaji and Solaiman, arXiv 2204.12547 https://arxiv.org/abs/2204.12547v1 [F]. Battah et al., IEEE Access 2023, blockchain university rankings https://khazna.ku.ac.ae/en/publications/using-blockchain-for-enabling-transparent-traceable-and-trusted-u/ [S]. Resume.sol-onchain https://devfolio.co/projects/resumesolonchain-picplacement-andinternship-cell-07d8 [F].
- Patents: https://patents.google.com/patent/US10832220B2/en [F, read in two chunks; claim 1 summarised, last 25k characters unread]; https://ipiq.io/patents/5099027 [F]; https://uspto.report/patent/app/20180082256 [X, 403]; MassMutual US 11,308,448 https://insurancenewsnet.com/oarticle/patent-issued-for-intelligent-employment-based-blockchain-uspto-11308448-massachusetts-mutual-life-insurance-company [S]; Workday patents https://insurancenewsnet.com/oarticle/patent-issued-for-system-for-credential-storage-and-verification-uspto-11700117-workday-inc [S].
- Indian government ledgers: Madhya Pradesh and Open Campus https://briefglance.com/articles/madhya-pradesh-taps-blockchain-to-digitize-50-million-student-records [F]; Startup India https://inc42.com/infocus/blockchain-this-week/startup-india-unveils-blockchain-based-certificate-verification-system [F]; Kerala PSC https://duk.ac.in/spotlight/kbas-blockchain-based-system-at-kpsc-inaugurated-by-the-honble-chief-minister/ [F]; AIIMS Delhi https://educationpost.in/news/technology/aiims-delhi-fills-over-460-faculty-posts-adopts-blockchain-technology-in-recruitment [F], Crypto Times https://www.cryptotimes.io/2026/07/07/indias-blockchain-yes-crypto-no-push-just-reached-aiims-delhi/ [X, 403]; CBSE https://news.careers360.com/cbse-use-blockchain-technology-secure-board-exam-result-documents/amp [S], CBSE press note https://cbse.gov.in/cbsenew/documents/Press_Note_CBSE_uses_BlockChain_Technology_english.pdf [X, 403].
- EPFO and PM-VBRY [S] https://documentation.hyperverge.co/api-reference/india_api/EPFO%20APIs/employment_history_with_UAN_api ; https://labour.gov.in/sites/default/files/pib2120326.pdf . DPDP and blockchain commentary [S] https://www.legal500.com/developments/thought-leadership/immutability-vs-accountability-data-protection-challenges-for-crypto-web3-and-blockchain-platforms-under-indias-dpdp-regime/ .

### Competitors

- Superset https://joinsuperset.com/blogs/?p=3152 [F]; https://joinsuperset.com/lp/employer [F]; https://joinsuperset.com/lp/university [F]. Unstop [S] https://unstop.com/employers/campus-hiring . CollPoll [S] https://www.sourceforge.net/software/product/CollPoll . Handshake employer update https://updates.joinhandshake.com/announcements/ann_S8UDtdj6a3Rmc [F, did not contain the feature I was checking]; Syracuse Handshake update page https://answers.atlassian.syr.edu/wiki/spaces/Handshake/pages/524222467 [S]; Carnegie Mellon outcomes page https://www.cmu.edu/career/outcomes/data-definitions.html [S]. CodeSignal https://codesignal.com/proof-not-proxies/ [F].

### Repository files read (read-only)

`docs/PITCH.md`, `docs/research/campus-placement-novelty-landscape.md`, `packages/domain/src/transparency-log.ts`, `apps/api/src/v2/ledger.ts`, `apps/api/src/v2/routes-ledger.ts`, `apps/api/tests/v2-ledger-witness.test.ts`, and a grep of `apps/api/src/v2/demo.ts`, `server.ts`, `index.ts`.

---

## 7. Not done, worth doing next

- Professional patent search (US, EP, IN) on recruitment-record and credential ledgers; claim analysis of US 10,832,220 B2 and SAP US 2018/0082256.
- Read the live NIRF framework and DCS instructions for 2026 and the NAAC DVV manual; ask NIRF or NAAC whether per-student evidence is ever uploaded.
- Get Superset's eligibility and offer modules in a demo and ask whether offers are confirmed with employers.
- Read two IIM audit letters (IIM Udaipur, IIM Ahmedabad) to see what auditors actually check and how long they take.
- Interview one auditor and one recruiter about key custody, call-back willingness and cost.
