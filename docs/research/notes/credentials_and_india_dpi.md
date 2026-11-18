# Verifiable Credentials, Selective Disclosure and Indian DPI for Student Skill Records and Campus Hiring (as of Nov 2026)

Research note, 17 Nov 2026. This was a time-boxed sweep of about 16 tool calls. Several official pages could not be read: the DigiLocker partner FAQ rendered empty, and the PIB ABC/APAAR factsheet PDF was binary-only. Items not confirmed against a source in this session are marked "unverified" and listed under Inferences or Gaps.

## DigiLocker: issuer/requester APIs, how institutions push documents, partner onboarding, skill-certificate use, VCs

### Takeaway
DigiLocker offers two integration surfaces:
- **Issuer:** a Pull URI API that the issuer hosts and DigiLocker calls.
- **Requester / Authorized Partner:** an OAuth2 API for pulling a user's documents with consent.

Both need credentials from the APISetu / DigiLocker Partner portal, and those credentials are issued only after approval. For requester access, the partner must be onboarded by MeitY. There is no public fee schedule, and no separate sandbox is documented. A private placement platform can realistically be a requester (with consent), not an issuer. The college or its university is the issuer, normally through NAD.

### Cited Findings
- The Issuer API Specification is at v1.13 (May 2024). The Pull URI Request API is a REST API that the *issuer* implements. DigiLocker calls the issuer's endpoint, and the issuer returns the URI of the matching document. Issuers configure this in the DigiLocker Partner Portal. Request validation by the issuer API is "strongly recommended". The spec defines XML request and response templates. — [DigiLocker Issuer API Spec v1.13 (API Setu)](https://cf-media.api-setu.in/resources/DigiLocker-Issuer-APISpecification-v1-13.pdf); older [v1.11/1.12 PDF](https://img1.digitallocker.gov.in/assets/img/issuer_api/Digital%20Locker%20Issuer%20API%20Specification%20v1.12.pdf)
- API credentials (Organisation ID, API Key) are provisioned through the APISetu Partner portal during onboarding. They become available only "after approval and application configuration". The Pull URI is mapped to the issuer's document repository and document types during issuer onboarding. — [DigiLocker Partner FAQ](https://www.digilocker.gov.in/web/partners/partner-faq) (as summarised in search results; the page body did not render on direct fetch)
- **Requester side:** the Authorized Partner API Specification v2.2 (Oct 2022) has endpoints such as `/oauth2/1/pull/issuers` and `/oauth2/1/pull/doctype`. Partners "must be onboarded by MeitY" to receive client credentials. — [DigiLocker Authorized Partner API Spec v2.2](https://cf-media.api-setu.in/resources/DigitalLocker-AuthorizedPartnerAPI-Specificationv2.2.pdf); [Jentic API listing (secondary)](https://jentic.com/apis/digitallocker.gov.in/digitallocker-authorized-partner-api-specification)
- **Practical barriers (secondary source):** there is no published fee schedule, onboarding lead time, or sandbox, and the partner FAQ reportedly says there is no separate test environment. Foreign firms need an Indian mobile number and a server located in India (per a FAQ dated 24 Mar 2025). — [Didit blog, "DigiLocker API: how businesses verify documents in India"](https://didit.me/blog/digilocker-api/)
- The Sunbird RC integration guide (about 3 years old) describes adding a Pull URI Request with a callback URL and an HMAC key. Sunbird RC is the open-source registry/VC stack the government uses for verifiable-credential issuance. — [Sunbird RC DigiLocker integration](https://rc.sunbird.org/use/integrations/digilocker-integration)
- **Skill certificates:** Skill India Digital Hub (SIDH) is integrated with DigiLocker, e-Shram, NCS, UIDAI and PFMS. It issues "digitally verifiable credentials and secure digital records". — [PIB press release (MSDE)](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2222120&reg=3&lang=1). Aggregator sites say SIDH/PMKVY certificates land in DigiLocker with NSDC as issuer. These are unofficial: [egovtschemes](https://www.egovtschemes.com/skill-india-digital-registration/).
- **Community prior art:** a public GitHub PR adds a "DigiLocker PRD and contracts" to an "Education_OS" project. This shows other edtech builders are designing DigiLocker integrations. — [rooman-itsd/Education_OS PR #524](https://github.com/rooman-itsd/Education_OS/pull/524)

### Inferences
- A placement platform's realistic DigiLocker path is the requester/"Authorized Partner" flow. The student logs in with OAuth and consents, and the platform pulls the issued NAD marksheets or degree. The platform does not become an issuer. Issuer status is tied to awarding bodies (universities, boards, NSDC/sector skill councils).
- DigiLocker "issued documents" are signed XML/PDF documents fetched by URI. They are not W3C VCs and offer no selective disclosure. The verifier gets the whole marksheet. Any "prove CGPA ≥ 7 without revealing CGPA" capability would need a layer on top: a platform or college attestation re-issued as an SD-JWT/BBS credential after a DigiLocker pull.
- Approval gating (MeitY onboarding, India-hosted servers, no sandbox) means a hackathon or MVP should mock DigiLocker behind an adapter interface and treat live integration as a later step that depends on partner approval.

### Gaps
- I could not render the current DigiLocker partner FAQ body to confirm eligibility rules for private companies vs government entities, or any 2025–2026 fee changes.
- I found no official source on a "DigiLocker for Organisations" product or a DigiLocker W3C-VC export in 2025–2026. This needs a direct check on digilocker.gov.in or apisetu.gov.in.
- I did not confirm whether DigiLocker has added OpenID4VP or VC-format endpoints. I found no evidence that it has.

## APAAR ID, Academic Bank of Credits (ABC), National Academic Depository (NAD): data held, APIs, 2025–26 status, adoption, privacy controversies

### Takeaway
APAAR, ABC and NAD are operating at national scale:
- **APAAR:** about 26.35 crore verified IDs as of July 2026.
- **NAD:** more than 110 crore digital academic records from about 3,420 awarding bodies (July 2026).

Access for third parties is consent-gated through DigiLocker. Employers are a recognised "verifying partner" category. No open, documented employer API was found beyond the DigiLocker partner APIs. Privacy controversy centres on Aadhaar linkage and whether APAAR is in practice mandatory, and courts have weighed in on parental consent.

### Cited Findings
- 26.35 crore verified APAAR IDs had been generated as of 2 July 2026 (official PIB factsheet "Academic Bank of Credits and APAAR"). — [PIB factsheet PDF, Jul 2026](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2026/jul/doc202675912501.pdf) (figure via search snippet; the PDF text could not be extracted directly)
- An earlier figure: 1,855 institutions had joined ABC by March 2024, registering more than 4 crore students. — [Wikipedia: Academic Bank of Credits (India)](https://en.wikipedia.org/wiki/Academic_Bank_of_Credits_(India))
- **NAD scale:** as of 7 July 2026, about 3,420 awarding institutions and organisations, and more than 110 crore digital academic records. Another 2026 summary says more than 3,430 universities, boards and colleges. — [PIB document, Jul 2026](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2026/jul/doc202677915101.pdf); [PIB factsheet 150693](https://pib.gov.in/FactsheetDetails.aspx?Id=150693) (via search snippets)
- A July 2026 report headline says India linked "2,899 HEIs & 98 skill bodies via blockchain" for academic records under One Nation One Student ID. This is a partisan outlet and the claim is unverified against the primary source. — [Organiser, 19 Jul 2026](https://organiser.org/2026/07/19/370617/bharat/one-nation-one-student-id-bharat-links-2899-hies-98-skill-bodies-via-blockchain-to-power-seamless-academic-record/amp/)
- **Consent model:** students share academic records with employers, HEIs or agencies only after explicit consent in DigiLocker. When an employer requests verification, "DigiLocker NAD will notify you through email or SMS". — [NAD FAQ (nad.digilocker.gov.in)](https://nad.digilocker.gov.in/faq); [nad.gov.in FAQ](https://nad.gov.in/faq.html)
- A 2020 NAD brief lists employers among NAD "Verifying Partners". — [Vignan NAD brief (2020)](https://vignan.ac.in/pdf/4b%20NAD_Documents_brief_writeup%20_0082020.pdf)
- **Employer API access:** the only guidance found is vendor guidance (TruScholar). It recommends the DigiLocker Partner API for bulk or ongoing hiring, and describes how employers register under NAD and obtain consent. — [TruScholar: how employers register under NAD](https://www.truscholar.io/blog/how-employers-can-register-under-nad); [TruScholar: employer consent](https://www.truscholar.io/blog/how-can-employers-obtain-consent-of-a-student-for-the-purpose-of-verification)
- Regulators are pushing uploads. For example, NMC asked medical colleges to upload 10 years of academic certificates to DigiLocker NAD. — [Careers360](https://news.careers360.com/nmc-asks-medical-colleges-upload-10-year-academic-certificates-degree-marksheet-scorecard-on-digilocker-nad/amp)
- **Data held / privacy:** APAAR collects name, DOB, gender, contact, Aadhaar number, authentication details, academic records and technical data. Critics warn that Aadhaar-based authentication enables cross-linking with other government databases. — [Mondaq: "Introduction of APAAR ID: A Growing Privacy Concern"](https://www.mondaq.com/india/education/1640770/introduction-of-apaar-id-a-growing-privacy-concern)
- **Mandatory vs voluntary, which sources conflict on:**
  - Mondaq says an ABC ID is mandatory for college or university admission. — [Mondaq](https://www.mondaq.com/india/education/1640770/introduction-of-apaar-id-a-growing-privacy-concern)
  - Other sources say APAAR is consent-based and students cannot be denied education if parents refuse.
  - CBSE reportedly made APAAR mandatory for Class IX–XII board registration from the 2026 session.
  - Reports also mention a Supreme Court direction about an Orissa HC (Dec 2025) ruling and a "no APAAR without explicit parental consent" holding. I could not verify this against primary court records. — [Gridlines explainer](https://gridlines.io/blogs/what-is-apaar-id/); [Sakshi Education web story](https://stories.sakshieducation.com/web-stories/informative/what-is-apaar-id-benefits-supreme-court-order-privacy-concerns-parent-consent-explained)

### Inferences
- NAD/DigiLocker is the authoritative source of marks for most Indian HEIs in 2026. A placement platform verifying CGPA or marksheets should treat a consented NAD pull as the gold-standard verification path.
- APAAR is a sensitive, Aadhaar-linked identifier with live legal controversy. A platform should avoid storing APAAR or Aadhaar numbers. It should store only verification outcomes plus document hashes, which also suits a DPDP data-minimisation posture.
- NAD's "consent then employer verification" design is a whole-document disclosure model. It does not do predicate proofs, so there is clear room for a privacy-preserving eligibility layer.

### Gaps
- I found no official public API documentation for ABC or APAAR (abc.gov.in) aimed at third parties such as placement platforms. The integration appears to be institution-facing only.
- I found no primary-source confirmation of the Supreme Court or Orissa HC APAAR orders. Court records should be checked.
- I could not extract the PIB July 2026 factsheet text: ABC credit counts, the number of institutions on ABC in 2026, and whether data fields are exposed.

## NCVET, NSQF, National Credit Framework (NCrF), Skill India Digital Hub (SIDH), skill wallets / India Stack-style skill credentials

### Takeaway
SIDH is the MSDE platform for skill records. It claims "digitally verifiable credentials" and a "Trust Layer", and it is integrated with DigiLocker, e-Shram, NCS, UIDAI and PFMS. Certificates carry NCVET recognition, and NCrF credit accumulation and redemption runs through SIDH. I found no evidence of a standalone public "skill wallet" product or a public developer API for SIDH credentials. Credentials surface via DigiLocker.

### Cited Findings
- **PIB (MSDE):** "Transparency and credibility in assessment and certification have been strengthened through the issuance of digitally verifiable credentials and secure digital records". SIDH is integrated with DigiLocker, e-Shram, National Career Service, UIDAI and PFMS. — [PIB press release PRID 2222120](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2222120&reg=3&lang=1)
- SIDH describes a "Trust Layer ... to enable verifiable digital credentials designed for portability, permanence, and inclusion and reusable electronic registries as a single source of truth". — [SIDH About Us](https://www.skillindiadigital.gov.in/about-us)
- SIDH certificates carry NCVET recognition and are described as digitally verifiable and portable. NSDC Academy describes "skill courses recognition, credit accumulation and redemption through Skill India Digital Hub under the National Credit Framework (NCrF)". — [NSDC Academy: For Partners](https://www.nsdcacademy.com/for-partners-1)
- **Prior standard:** the "Electronic Skill Credential Standard v1.0" (June 2019, DGT/BharatSkills) sets out e-credentialing principles for the skilling ecosystem, namely verifiability and portability. — [Electronic Skill Credential Standard v1.0 (PDF)](https://bharatskills.gov.in/pdf/ESCS/Electronic_Skill_Credential_Standard_v1.0.pdf)
- A policy overview describes SIDH (launched 2023) as a unified digital ecosystem for skills and employment. — [IMPRI: SIDH 2023](https://www.impriindia.com/insights/policy-update/skill-india-digital-hub-sidh-2023/)
- Aggregator sites quote conflicting course counts for SIDH (2,900+ vs 7,500+). These are unreliable. — [schemesinindia](https://schemesinindia.in/central/skill-india-digital-hub-platform); [Anantam IAS](https://anantamias.com/skill-india-digital-hub/)

### Inferences
- SIDH's "verifiable credentials" are most likely built on Sunbird RC, the government's open-source VC/registry stack, which has a DigiLocker integration. This is unverified. If true, SIDH certificates may be W3C-VC-shaped internally, but external access still goes via DigiLocker.
- NSQF levels and NCrF credit points are a ready-made, government-recognised skill taxonomy and level scale. A placement platform could map its skill records to NSQF levels (1–8) and NCrF credits for interoperability, without needing SIDH API access.

### Gaps
- I found no official "Unified Skill Wallet" or MSDE/MoE skill-wallet announcement in this sweep, and no public SIDH developer API.
- I did not confirm NCVET's current digital certification format (VC vs PDF) or the status of NCVET's "NQR" (National Qualification Register) APIs.
- I did not verify the NCrF notification date or current implementation status. From training knowledge, the NCrF was released in April 2023, but this was not re-sourced here.

## Open Badges 3.0, W3C VC 2.0, CLR 2.0, EDC, EBSI: status and who issues skill VCs at scale

### Takeaway
The W3C VC 2.0 family became W3C Recommendations on 15 May 2025. Two parts were not yet Recommendations at last check, both at Candidate Recommendation Draft (CRD): the BBS cryptosuite (CRD 7 Apr 2026) and JSON Schema. 1EdTech Open Badges 3.0 (final May 2024) and CLR 2.0 (final, reportedly early 2025) are built on W3C VCs. The major badge platforms (Credly, Accredible, Parchment) are reported OB 3.0 issuers. I did not cover EDC/EBSI status in this sweep.

### Cited Findings
- **W3C VC Overview Note (17 Jun 2026):**
  - VC Data Model v2.0, Data Integrity 1.0, EdDSA Cryptosuites, ECDSA Cryptosuites, Securing VCs using JOSE and COSE, Bitstring Status List v1.0 and Controlled Identifiers v1.0 are all W3C Recommendations dated 15 May 2025.
  - Data Integrity BBS Cryptosuites v1.0 (bbs-2023) is a Candidate Recommendation Draft dated 7 Apr 2026.
  - VC JSON Schema is a CRD dated 4 Feb 2025.
  - Quote: "though technically complete, they are still 'Candidate' Recommendations."
  — [W3C Verifiable Credentials Overview (NOTE, 2026-06-17)](https://www.w3.org/TR/2026/NOTE-vc-overview-20260617/)
- **Open Badges 3.0:** final approval by the 1EdTech community, announced May 2024 (one vendor says June 2024). — [1EdTech press release](https://www.1edtech.org/1edtech-article/new-open-badges-30-standard-provides-enhanced-security-and-mobility/411060); [POK vendor page](https://www.pok.tech/en/open-badge-3-0)
- The Open Badges 3.0 Certification Guide is a final release, document version 1.3, dated 12 Dec 2025. — [IMS Global / 1EdTech OB 3.0 Certification Guide](https://www.imsglobal.org/node/208026)
- **CLR Standard 2.0:** publicly available after a 1EdTech community vote. It is aligned with OB 3.0 and shareable between wallets. A vendor dates the release to March 2025. — [1EdTech CLR 2.0 announcement](https://www.1edtech.org/1edtech-article/latest-comprehensive-learner-record-standard-improves-security-portability-and); [checkpoint-elearning](https://www.checkpoint-elearning.de/node/27140)
- The first product certified to issue OB 3.0 and CLR 2.0 was AwardAssured (UK), in March 2023 during the candidate phase. — [PRWeb](https://www.prweb.com/releases/edtech-start-up-awardassured-is-the-first-product-certified-by-1edtech-to-issue-openbadges-3-0-896263030.html)
- A vendor timeline says Accredible, Parchment Digital Badges (formerly Badgr), Credly, POK and others are certified OB 3.0 issuers. This is a vendor claim, not an official list. A 2023 1EdTech/Credential Engine report counted more than 74 million Open Badges issued globally. — [Territorium](https://territorium.com/open-badges-3-0-new-capabilities-and-use-cases-for-digital-credentialing/); [Sunet "Open Standards for Digital Credentials" (PDF)](https://tcs.sunet.se/download/attachments/147521957/Open%20Standards%20for%20Digital%20Credentials%20-%20Sunet.pdf?api=v2)

### Inferences
- For a platform-issued "skill credential", OB 3.0 (a W3C VCDM 2.0 profile) is the safest interoperable choice in 2026. It is final, certifiable, and supported by major badge platforms. CLR 2.0 is the right envelope for a full skill transcript.
- OB 3.0 and CLR 2.0 do not mandate selective disclosure. Pairing them with SD-JWT (via the VC-JOSE-COSE Recommendation) or BBS (still CRD) would go beyond what the badge ecosystem commonly does.

### Gaps
- I did not verify the current status of European Digital Credentials for Learning (EDC; ELM data model, EDC wallet) or of EBSI's diploma use case and its transition into the EUDI Wallet ecosystem.
- I found no current official count of 1EdTech-certified OB 3.0 or CLR 2.0 issuers. The 1EdTech product directory should be checked.
- I did not check for a W3C announcement after June 2026 of BBS reaching Proposed Recommendation or Recommendation.

## Selective disclosure: SD-JWT / SD-JWT VC, BBS (bbs-2023), ZK range proofs, Node/TS libraries, real deployments

### Takeaway
- **SD-JWT:** a finished standard, RFC 9901 (Standards Track, published Nov 2025), with production-ready TypeScript libraries. It is the most mature option.
- **SD-JWT VC:** still an Internet-Draft. It was at -27 on 16 Nov 2026, in IESG Evaluation with an open DISCUSS.
- **BBS (unlinkable selective disclosure):** a W3C Candidate Recommendation Draft.
- **ZK range proofs** such as "CGPA ≥ 7": the closest live deployment is the EU age-verification blueprint, which now requires ZKP. Even there, independent reviewers say the ZKP features were not yet live in production builds as of Aug 2026.

SD-JWT reveals or hides whole claims. It cannot prove "≥ threshold" without revealing the value unless the issuer pre-computes boolean claims (for example `cgpa_gte_7: true`).

### Cited Findings
- **RFC 9901:** "Selective Disclosure for JSON Web Tokens" (D. Fett, K. Yasuda, B. Campbell), Standards Track. The datatracker records publication on 2025-11-19, while ACM DL lists 1 Nov 2025. — [RFC 9901 (rfc-editor)](https://www.rfc-editor.org/rfc/rfc9901.html); [datatracker history](https://datatracker.ietf.org/doc/rfc9901/history/); [ACM DL](https://dl.acm.org/doi/abs/10.17487/RFC9901); [Sakimura commentary](https://www.sakimura.org/en/2025/11/7764/)
- **draft-ietf-oauth-sd-jwt-vc:** latest version -27 (16 Nov 2026), intended status Proposed Standard, expires 20 May 2027. IESG state is "IESG Evaluation::AD Followup" with a DISCUSS to resolve, and the WG state is "Submitted to IESG for Publication". It is not yet an RFC and is not in the RFC Editor queue. — [IETF Datatracker: draft-ietf-oauth-sd-jwt-vc](https://datatracker.ietf.org/doc/draft-ietf-oauth-sd-jwt-vc/)
- EUDI Wallet standards work tracks RFC 9901 as a referenced spec. — [eudi-doc-standards-and-technical-specifications issue #28](https://github.com/eu-digital-identity-wallet/eudi-doc-standards-and-technical-specifications/issues/28)
- **BBS:** "Data Integrity BBS Cryptosuites v1.0" (bbs-2023) is a W3C Candidate Recommendation Draft dated 7 Apr 2026. — [W3C VC Overview Note](https://www.w3.org/TR/2026/NOTE-vc-overview-20260617/)
- **TypeScript library: OpenWallet Foundation `sd-jwt-js`**
  - Packages: `@sd-jwt/core`, `@sd-jwt/sd-jwt-vc`, `@sd-jwt/present`, `@sd-jwt/crypto-nodejs`. Versions 0.19–0.20 are on npm, under Apache-2.0.
  - It describes itself as "framework-agnostic, production-ready ... TypeScript", working in Node.js, React, React Native and browsers.
  - Utilities were consolidated into `@sd-jwt/core`. Token Status List moved to `@owf/token-status-list` (identity-common-ts).
  - `@hopae/sd-jwt` is deprecated.
  — [openwallet-foundation/sd-jwt-js (GitHub)](https://github.com/cre8/sd-jwt-js); [@sd-jwt/sd-jwt-vc README 0.20.0](https://unpkg.com/@sd-jwt/sd-jwt-vc@0.20.0/README.md); [@sd-jwt/core README](https://unpkg.com/@sd-jwt/core@0.20.0/README.md); [deprecated @hopae/sd-jwt](https://www.npmjs.com/package/@hopae/sd-jwt)
- **EU age verification:**
  - The Commission's technical portal says ZKP is "now defined as the mandatory presentation mechanism", with plain mDoc presentation as a fallback. — [ageverification.dev](https://ageverification.dev/)
  - Spec v1.1.0 (2 Sep 2026) reportedly requires apps and websites to implement ZKP. — [anoni.net](https://anoni.net/news/en/2026/09/eu-age-verification-blueprint/)
  - EFF (Aug 2026) reports the ZKP features "aren't yet turned on except for the closed demo/prototype build", and describes a researcher replaying an "over-18" token. — [EFF: ZKPs Aren't Age Verification Silver Bullets](https://www.eff.org/deeplinks/2026/08/zkps-arent-age-verification-silver-bullets)
  - The Commission's older Age Verification Manual still lists ZKP as "upcoming". — [EC Age Verification Manual](https://ec.europa.eu/digital-building-blocks/sites/spaces/EUDIGITALIDENTITYWALLET/pages/930450954/The+Age+Verification+Manual)
- **EU age verification pilots:** France, Denmark, Greece, Italy, Spain, Cyprus and Ireland in 2026. The blueprint was technically ready on 15 Apr 2026. EDRi argues that even mandatory ZKP does not give strict unlinkability. — [ageverification.dev](https://ageverification.dev/); [Au10tix](https://www.au10tix.com/blog/eu-age-verification-dsa-mini-wallet-online-platforms/); [anoni.net](https://anoni.net/news/en/2026/09/eu-age-verification-blueprint/)
- A 2026 academic survey of self-sovereign identity covers this design space. — [SoK: Self-Sovereign Digital Identities (arXiv 2603.06896)](https://arxiv.org/pdf/2603.06896)

### Inferences
- **Implementable today in Node/TS:**
  1. SD-JWT (RFC 9901) using `@sd-jwt/*`. This is mature, and the stability of the SD-JWT VC draft is the main caveat.
  2. Issuer-computed predicate claims, e.g. `cgpa_band: "7-8"`, `meets_cgpa_7: true`, `no_active_backlogs: true`, selectively disclosed with SD-JWT. This is "predicate by attestation", the same pattern as the EU "age_over_18" boolean attributes. It needs no ZK circuits and is easy to audit.
- **BBS / bbs-2023** (Digital Bazaar's `@digitalbazaar/bbs-2023-cryptosuite`, MATTR's `@mattrglobal/bbs-signatures`) is implementable but riskier. It is still a CRD, and BBS needs pairing-friendly curves that are not yet in standard JOSE/FIPS stacks. I did not verify the library names or current versions in this sweep.
- **True ZK range proofs** (Bulletproofs, or circuits such as Google's longfellow-zk used for EU age verification) are not mature enough to bet a product on in 2026. Even the EU flagship was reportedly not live in production as of Aug 2026. For a placement platform, "verifiable boolean predicates signed by the college/platform, plus SD-JWT" is the pragmatic choice.
- **Real-world eligibility rules need multi-record predicates:** Class 10, Class 12, every semester, active backlogs, gap years, and university-specific CGPA-to-percentage conversions. This favours issuer- or platform-computed predicates over generic ZK range proofs on one number. Sources: [sahildubey.com](https://www.sahildubey.com/2026/07/btech-placement-eligibility-cgpa-backlogs-gap-years.html); [gradekar.com](https://gradekar.com/blog/minimum-cgpa-for-placements); [placementpapers.app](https://placementpapers.app/eligibility-criteria/)

### Gaps
- I did not verify the current versions and maintenance status of `@digitalbazaar/bbs-2023-cryptosuite` or `@mattrglobal/bbs-signatures`, or the status of the IETF CFRG BBS draft (draft-irtf-cfrg-bbs-signatures).
- I did not cover the deployment status of ISO 18013-5 / 18013-7 mDL age-over attributes, or of longfellow-zk specifically.
- I found no education or hiring deployment of BBS or ZK range proofs.

## Prior art: privacy-preserving eligibility for campus drives (prove criteria without revealing marks, caste or category)

### Takeaway
I found no product, paper or government pilot implementing privacy-preserving (selective-disclosure or ZK) eligibility checks for Indian campus placement drives. The adjacent systems are weaker:
- NAD/DigiLocker consented whole-document employer verification.
- Vendor verification services such as TruScholar.
- Generic VC/badge platforms.
- The EU age-over-18 ZKP pattern, which is the closest technical analogue.

This looks like a genuine white space, though one 16-call sweep cannot prove absence.

### Cited Findings
- A targeted search for ZKP or privacy-preserving CGPA eligibility in Indian placements returned only generic CGPA-cutoff guides and no cryptographic prior art. Those guides confirm that cutoffs act as binary filters (e.g. a 60% / 6.0 CGPA floor across Class 10, Class 12 and all semesters, plus backlog and gap conditions). — [placementpapers.app](https://placementpapers.app/eligibility-criteria/); [sahildubey.com](https://www.sahildubey.com/2026/07/btech-placement-eligibility-cgpa-backlogs-gap-years.html); [gradekar.com](https://gradekar.com/blog/minimum-cgpa-for-placements)
- **Closest Indian adjacent prior art:** NAD/DigiLocker consent-based employer verification, which discloses the whole document. — [NAD FAQ](https://nad.digilocker.gov.in/faq). Also vendor credential verification for employers: [TruScholar NAD ecosystem](https://www.truscholar.io/blog/understanding-how-the-nad-ecosystem-operates).
- **Closest technical analogue:** EU age verification, which proves "over 18" without revealing date of birth and makes ZKP mandatory from spec v1.1.0. Deployment maturity is disputed. — [ageverification.dev](https://ageverification.dev/); [EFF](https://www.eff.org/deeplinks/2026/08/zkps-arent-age-verification-silver-bullets)

### Inferences
- A placement platform could claim novelty for "eligibility-as-a-predicate". A company sees only `eligible: true/false` per criterion, signed and selectively disclosable. It never sees raw marks, and never sees caste, category, gender or disability fields.
- In Indian campus hiring, category or reservation data matters mainly for PSU drives. Withholding it from private recruiters entirely, and revealing only a predicate where legally required, is a strong DPDP-aligned design point.
- Novelty claims should be framed carefully as "no public prior art found", not "first ever".

### Gaps
- I did not search academic venues (IEEE, ACM, arXiv) for "privacy-preserving transcript verification" or "ZK academic credentials India". Blockchain-certificate papers from Indian institutions likely exist but focus on authenticity, not predicates.
- I did not check commercial products (e.g. Superset, Talview, Mercer-Mettl, or international tools such as Velocity Network, Dock, Truvera) for predicate or selective-disclosure features.

## DPDP Consent Managers and DEPA / Account-Aggregator-style consent for education/skills data

### Takeaway
The DPDP Rules 2025 were notified on 13 Nov 2025. Rule 4 (Consent Manager registration) came into force on 13 Nov 2026, so registration has only just opened. Most other obligations apply from 13 May 2027. I found no evidence of a DEPA- or Account-Aggregator-style consent framework for education or skills data. DigiLocker's in-app consent for NAD sharing is the de facto education consent flow.

### Cited Findings
- The DPDP Rules 2025 were notified on 13 Nov 2025 (one citation says 14 Nov). Rule 4, covering Consent Manager registration and obligations, takes effect on 13 Nov 2026. Rules 3, 5–16, 22 and 23 take effect on 13 May 2027. — [dpdprules.org Rule 4](https://dpdprules.org/rules/4); [Wikipedia: DPDP Rules 2025](https://en.wikipedia.org/wiki/Digital_Personal_Data_Protection_Rules,_2025); [Mondaq: Consent Managers under DPDP Rules](https://www.mondaq.com/india/data-protection/1832140/building-the-consent-layer-consent-managers-under-the-dpdp-rules-2025)
- **Eligibility:** applicants must meet the First Schedule Part A conditions and apply to the Data Protection Board. A guide says the applicant must be a company incorporated in India. The net-worth threshold is disputed: ₹2 crore per one source, ₹12 crore (CA-verified) per another. The Board can suspend or cancel a registration. — [trueprivacy.io](https://trueprivacy.io/blog/dpdp-consent-manager-registration); [nitibharat.com](https://nitibharat.com/consent-manager-registration-guide/); [iqworks.ai](https://iqworks.ai/blog/consent-managers); [ruleexpert.com](https://ruleexpert.com/dpdp-consent-managers-13-november-2026/)
- **Education consent today:** NAD records are shared with employers only after explicit student consent in DigiLocker, with notifications by email or SMS. — [NAD FAQ](https://nad.digilocker.gov.in/faq)

### Inferences
- As of mid-Nov 2026, no registered DPDP Consent Managers are likely to be operating yet, since registration just opened. A placement platform should not depend on one.
- The platform can implement its own DEPA-style consent artefacts, meaning purpose-bound, time-bound, revocable consent records per recruiter and drive. Modelled on the Account Aggregator / DEPA consent-artefact pattern, these would position it well for later interoperation with a registered Consent Manager.
- Becoming a Consent Manager is likely out of reach for an early-stage platform: it must be an Indian company with a net-worth floor and Board registration. A partnership or interoperability approach is more realistic.

### Gaps
- I did not search for DEPA for education or an "education data exchange" (e.g. the NDEAR / DIKSHA consent layer). I found no source either way.
- I did not verify the exact net-worth figure against the Gazette First Schedule.
- I did not find whether DigiLocker has applied, or intends to apply, as a registered Consent Manager.
