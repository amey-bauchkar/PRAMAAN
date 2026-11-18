# India-specific public infrastructure and policy for a campus-placement and skill-verification platform (as of 18 Nov 2026)

Scope note: this extends, and does not repeat, `docs/research/notes/credentials_and_india_dpi.md` (DigiLocker issuer/requester specs, NAD/APAAR scale, SIDH trust layer, SD-JWT/BBS status, DPDP consent-manager dates) and `docs/research/notes/india_context_and_research.md` (ISR 2026, AISHE 2022-24, AICTE placement data, NIRF GO weights, NAAC 5.2.1, PMIS/NATS). Those findings are referenced, not re-listed. About 20 tool calls were used. Several official pages returned 403 or binary, so some claims rest on search-result summaries; each such claim is marked "(search summary)". Nothing here is invented; unsourced ideas appear only under Inferences and are labelled.

## 1. DigiLocker, NAD, APAAR/ABC: what a startup or college tool can actually access, onboarding, sandbox

### Takeaway
There are two different things people call a "sandbox", and they must not be confused. API Setu runs a public test portal with pre-filled sample data and no live data. Real DigiLocker partner onboarding is formal, committee-approved, and explicitly refuses temporary or test access. A student team can demo the DigiLocker consent-and-pull flow only against the API Setu sandbox, a commercial aggregator sandbox, or a labelled mock. It cannot pull a real marksheet or NAD record. No third-party API for APAAR or ABC was found.

### Cited Findings
- **API Setu sandbox exists and is open to browse.** It is described as "a portal to test API Setu APIs with pre-filled sample data", and the page states "No live data is used while testing." It lets you build request bodies, view responses and copy code snippets. The page does not list sign-up steps or which DigiLocker endpoints are covered. — [API Setu & DigiLocker Sandbox](https://sandbox.api-setu.in/)
- **API Setu DigiLocker partner page** lists two roles, Requester APIs and Issuer APIs. It lists a Requester API Specification v1.12, an Issuer API Specification v1.13 and a Requester Partner Configuration Manual. A "Terms of Service agreement to be signed by 'Requestor Organization' before proceeding for Integration" is required. The page does not state fees or how API keys are issued. — [API Setu: DigiLocker partners](https://apisetu.gov.in/digilocker)
- **Official onboarding SOP (primary source, text extracted locally):**
  - Eligible partners must be registered in India under MCA, MSME, Startup India, Societies Act, Partnership Act, Trusts and so on. Private organisations, proprietorships, and societies and trusts are all listed as eligible.
  - The partner must show "demonstrable experience in providing online services to Indian citizens". It needs a functional website and its own digital signature for DigiLocker API integration.
  - The partner "must have an authorization from the appropriate governmental regulatory bodies to issue and authenticate documents".
  - Registration requires an official-domain email (personal domains are liable to be rejected), a telephonic verification meeting, and use-case details with "no deviation".
  - The SOP states "No requests of temporary access for any testing purpose etc. will be entertained."
  - Applications go to an onboarding committee (BD, Legal), with final approval by the CEO. Partners must share a demo flow and testing data before go-live, submit quarterly usage reports, and provide an STQC audit report of their application. Verified-but-inactive accounts are disabled after 3 months.
  — [DigiLocker Partners SOP (PDF)](https://cf-media.api-setu.in/resources/Partners-SOP.pdf)
- **Requester terms (June 2025)** exist as a separate document. The search summary says the requester must designate a senior authorised representative and use an official email domain. — [DigiLocker Terms of User Requester, June 2025](https://cf-media.api-setu.in/resources/DigiLocker-Terms-of-User-Requester-june-2025.pdf) (search summary; body not read)
- **Commercial aggregator route:** Setu (a private API company) documents a DigiLocker data product with separate sandbox and production hosts (`dg-sandbox.setu.co`, `dg.setu.co`). Credentials (`x-client-id`, `x-client-secret`, `x-product-instance-id`) must be requested from Setu. The page does not say whether the sandbox is free. It says "All docs other than Aadhaar, can be fetched", and its only examples are a pension certificate and a PF passbook, not education marksheets. End users need an Aadhaar-linked mobile number, and `redirectUrl` must be publicly hosted. — [Setu DigiLocker quickstart](https://docs.setu.co/data/digilocker/quickstart)
- **Possible policy change (reported, unconfirmed):** a news item reports MeitY moving to an empanelled-agency model in which private integrators identify and onboard requester organisations. — [Lapaas Voice news item](https://lapaasvoice.com/govt-close-to-picking-private-ai-integrator-for-digilocker/) (search summary; weak source)
- **DPDP link to DigiLocker:** Rule 10 explicitly treats a parent's age and identity as verifiable via "a virtual token mapped to such details, which is issued by an authorised entity". An authorised entity includes details "made available and verified by a Digital Locker Service Provider". The illustration says the parent "may voluntarily make such details available using the services of a Digital Locker service provider". — [DPDP Rule 10 text (dpdpa.com mirror)](https://dpdpa.com/dpdparules/rule10.html); official source is the [MeitY Rules PDF](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf) (returned 403 here)
- APAAR/ABC/NAD scale and consent model are in the earlier note and not repeated.

### Inferences
- **What can be built for real:**
  - A requester-style OAuth consent screen and document-pull adapter, running against API Setu sandbox sample data, with the code path identical to the future live path.
  - A NAD-style "student consents, employer verifies" flow in which a college admin account acts as the issuer. This must be labelled as a simulation, because the platform is not a DigiLocker issuer.
- **What cannot be demonstrated for real:** pulling live marksheets, degrees or APAAR/ABC data. The SOP's own rule (no temporary test access), the "authorization from governmental regulatory bodies" condition and the STQC audit make it a post-prototype step. Treat DigiLocker live access as **government approval required**.
- **Honest judge-facing framing:** "We built to the published DigiLocker Requester spec v1.12 and tested on the API Setu sandbox. Live partner onboarding needs the SOP's committee approval, STQC audit and digital signature, which we have scoped as a post-pilot step."
- **Candidate "surprise"** is not claiming live access. It is shipping a spec-faithful adapter with a recorded sandbox run, and showing the DPDP Rule 10 parental-consent path using the DigiLocker virtual token pattern.

### Gaps
- I could not read the Requester API v1.12 spec or the API Setu sandbox's endpoint list, so I cannot confirm which education document types (for example CBSE marksheets, NAD degrees) the sandbox returns.
- No fee schedule or onboarding duration appears in the SOP text I extracted. The earlier note's claim, via the Didit blog, that there is no sandbox is contradicted by the API Setu sandbox portal. The accurate version is that there is a sample-data sandbox but no live test access.
- I found no developer documentation for APAAR, ABC (abc.gov.in) or NAD employer APIs. This remains a gap.
- Whether the empanelled-agency model has been implemented is unverified.

## 2. Bhashini: free access, quality, using it for vernacular interview practice and reason explanations

### Takeaway
Bhashini exposes ASR, NMT and TTS as chained "pipelines" (Pipeline Search, Pipeline Config, Pipeline Compute), with models discoverable in ULCA. Its official GitBook says the public APIs are for proof-of-concept use only, and that production use or charging end users requires contacting Bhashini for paid plans. That fits a student prototype exactly. Quality figures for specific languages were not found, and independent research shows Indic ASR error rates are hard to compare because of spelling variation.

### Cited Findings
- Official API docs describe pipelines as single tasks or chains (ASR, NMT, TTS, ASR+NMT, NMT+TTS, ASR+NMT+TTS), with ASR+NMT+TTS run in that order. Flow: Pipeline Search (optional), Pipeline Config (mandatory), Pipeline Compute (mandatory). Models are listed in ULCA with unique Model IDs, and several models may offer the same function. Languages use ISO-639 codes ("hi", "en"). — [Bhashini APIs (GitBook)](https://bhashini.gitbook.io/bhashini-apis)
- **Terms (verbatim intent from the same page):** "The APIs are for proof-of-concept use only." For production, or if you "plan to charge end users", contact the Bhashini team for a paid version and pricing plans. The page does not document how to obtain credentials, endpoint URLs, rate limits or the full language list. — [Bhashini APIs (GitBook)](https://bhashini.gitbook.io/bhashini-apis)
- Registration at bhashini.gov.in gives a user ID and API key, and calls go to the Dhruva inference host (`dhruva-api.bhashini.gov.in`) per community examples. Free access claims come from aggregators and developer pages, not official docs. — [Bhashini API examples (community GitHub)](https://github.com/bhashini-ai/bhashini-api-examples); [SchemesInIndia](https://schemesinindia.in/central/bhashini-digital-india-language-ai-platform)
- Independent evidence on ASR quality: an AI4Bharat/IIT Madras paper (March 2026) argues that much of the Indic-vs-English WER gap is inflated by missing orthographic standards (loanwords with multiple valid spellings), and proposes OIWER. A separate paper proposes SN-WER. An agriculture benchmark reports Hindi best of three (WER 16.2%), with Odia hardest. That figure is domain-specific, not a Bhashini number. — [arXiv 2603.00941](https://arxiv.org/html/2603.00941v1); [arXiv 2606.02548](https://arxiv.org/pdf/2606.02548); [arXiv 2602.03868](https://arxiv.org/html/2602.03868v2)
- Earlier note: Glific, a Bhashini integration labelled experimental, the Feb 2026 voice toolkit, Sarvam integration and practitioner advice to prototype on Bhashini with a fallback. See `india_context_and_research.md` section 5.

### Inferences
- **Realistic 6-week uses:**
  - Reason explanations as translated text (NMT) plus TTS audio, for example "why you are not eligible for this drive" in Hindi, Marathi or Tamil.
  - Voice answers via ASR for vernacular interview practice, with the transcript then graded by the platform.
  - Both fit the PoC licence. Keep a provider interface so a different model can be swapped in.
- **Do not promise accuracy.** Show the transcript to the student for correction, and report confidence per language. Avoid a headline "X% accuracy" claim, because no official per-language figure was found.
- **Design choice that reads as deeply localised:** let the student answer a technical question in their mother tongue and be scored on concepts, then separately practise the English version. This follows from the ThePrint and Careers360 reporting on vernacular students' interview anxiety in the earlier note.
- Using Bhashini is a documented, public-licence integration. It is not a government-approval gate for a prototype, but production or paid use needs a Bhashini agreement.

### Gaps
- No official rate limits, SLAs, current model list or per-language quality benchmark for Marathi, Tamil or other languages. The GitBook page did not give these, and no independent Bhashini-specific WER was found.
- I could not open bhashini.gov.in (page returned no content), so registration steps are community-sourced.
- Whether the PoC licence permits a demo with student users (as opposed to developer testing) is unclear and needs a direct query to Bhashini.

## 3. Skill India Digital Hub, NSQF/NCVET, NCS, AICTE internship portal, NSDC: open APIs, data sets, taxonomies

### Takeaway
No public developer API was found for SIDH, NQR, the AICTE internship portal or NCS itself. The usable open data is on data.gov.in (NCS vacancy and jobseeker tables, licensed under GODL-India) and the read-only NQR search, which exposes NSQF-aligned qualifications by sector, job role and level. For a prototype, NQR and NCS numbers are best used as a taxonomy and real-number source via downloads or manually curated mapping, not live integrations.

### Cited Findings
- **NQR (nqr.gov.in)** is "the official national public record of all qualifications aligned to NSQF levels, qualification pathways and accrediting authorities". It is marked Beta, offers read-only access, and exposes Qualification File details (assessed learning outcomes, assessment, quality assurance, employment/progression opportunities). Planned search is by title, type, occupation/sector, job role and level. The page mentions no download option or API. — [NQR About](https://nqr.gov.in/aboutus)
- NQR holds qualifications across 59 sectors and issues a unique NQR code after NSQC approval. Qualification Files are individual PDFs hosted on nqr.gov.in, for example Data Science and Machine Learning micro-credentials and a Software Developer QP. — [NCVET: National Qualifications Register](https://ncvet.gov.in/?p=2524); example file [QF MicroCredential: Overview of Data Science](https://nqr.gov.in/qualification/file/QF-MicroCredential_Overview%20of%20Data%20Science.pdf) (search summary for the "59 sectors" statement)
- **NCS on data.gov.in:** a catalog titled "National Career Service (NCS)" lists the Ministry of Labour and Employment as contributor and shows Catalog API and Zip download options. Resources include state-wise jobseeker registrations (to 30 June 2022), sector-wise vacancies mobilised (to 30 Sept 2023), state/UT-wise vacancies 2021-22 to 2023-24, and state-wise vacancies as on 15-11-2024 (CSV, sourced from Rajya Sabha answers). Several resources state that "API for this resource does not exist" and offer a "Request API" button. — [data.gov.in NCS catalog](https://www.data.gov.in/catalog/national-career-service-ncs); [State-wise vacancies 15-11-2024](https://www.data.gov.in/resource/state-wise-number-vacancies-mobilised-through-national-career-service-ncs-portal-15-11); [Sector-wise vacancies to 30 Sept 2023](https://www.data.gov.in/resource/sector-wise-vacancies-mobilised-till-30-september-2023) (search summary; the catalog page itself returned 403 to fetch)
- NCS portal has a public dashboard page with state-by-year vacancy tables, with no download or API found. — [NCS dashboard](https://ncs.gov.in/NCSReportDashboard) (search summary)
- **Latest NCS headline numbers (PIB, data as of 15 July 2026):** over 17.68 lakh active vacancies, over 6.64 crore jobseekers registered since inception, and 2.89 crore active jobseekers. A minister in April 2026 said nearly 59 lakh establishments are registered, and "over 7 lakh" vacancies were then active, which conflicts with the July figure. The two probably use different definitions or dates. — [PIB PRID 2294658](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2294658&reg=48&lang=1) (search summary; fetch returned 403); [DD News headline](https://ddnews.gov.in/en/ncs-portal-records-17-68-lakh-active-vacancies-2-89-crore-active-jobseekers/)
- NCS integrates by API with other government and private systems (eShram, Udyam, private job portals). These are institution-to-institution integrations, not public developer APIs. — [Labour Ministry NCS document](https://www.labour.gov.in/static/uploads/2025/09/78d69a80ca9d34b77cf39f5c1da8d620.pdf) and [PIB MoU release with Porter and Gigin](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2251588&reg=3&lang=1) (search summary; titles confirm MoU-based linkages only)
- **AICTE internship portal:** no official developer API was found. Employers use a web "Industry" login. The only AICTE "API" found is a third-party vendor product in "Fixture Mode" (sample data) and is not an AICTE integration. — [Internshala guide](https://internshala.com/blog/?p=29485); [Sahayak docs fixture](https://sahayak-docs.pages.dev/api-reference/fixture/aicte)
- SIDH is integrated with DigiLocker, e-Shram, NCS, UIDAI and PFMS, and describes a Trust Layer (earlier note). NSQF/NCrF levels are covered in the earlier note.

### Inferences
- **Feasible in 6 weeks:** hand-map the platform's skill and role taxonomy to 10 to 20 NQR job roles and NSQF levels (for example Software Developer, Data Annotator), using NQR's public Qualification File PDFs as the reference. Then show a student's skill evidence as "NSQF Level X aligned". Frame it as alignment, not certification.
- **Real numbers for a demo:** NCS vacancy tables are state-wise and sector-wise from data.gov.in CSVs. They are aggregate, and the NCS "vacancies mobilised" metric is not the same as jobs for fresh graduates in a given district, so do not match them to individual students.
- **Not demonstrable for real (needs approval or MoU):** SIDH credential issuance or pull, NCS job posting or application feed, AICTE internship portal data, NATS and PMIS application sync. Present these as "export/deep-link" stubs, labelled as simulation.

### Gaps
- No official NCS or SIDH developer documentation or partner programme was found. Eligibility for private job-board partnerships is unknown (the PIB MoU with Porter and Gigin suggests an MoU route, but terms were not read).
- NQR: unknown whether a bulk export exists. A structured job-role-to-QP table was not confirmed. The Skill India Portal "NSQF aligned QP listing" mentioned by NSDC was not checked.
- Counts of NQR qualifications and the NSQF level coverage of AICTE/diploma programmes were not found.
- Whether the NCS data.gov.in resources have been updated beyond Nov 2024 was not confirmed.

## 4. DPDP Act 2023 and DPDP Rules 2025: children, college data fiduciaries, timelines, demonstrable compliance

### Takeaway
The Rules were notified in November 2025 with an 18-month phased timeline. Obligations that matter to a campus platform (notice, consent, erasure, breach reporting, children's data) apply from about May 2027, so a platform that demonstrates compliance in 2026 is ahead of the deadline. Verifiable parental consent applies to under-18s, which includes some polytechnic and diploma students, and Rule 10 lets a DigiLocker virtual token verify the parent. The educational-institution exemption in the Fourth Schedule is narrow and its exact wording could not be confirmed from the primary text.

### Cited Findings
- **Notification and timeline:** PIB says the Rules were notified on 14 November 2025 (the earlier note cites 13 Nov from other sources; the difference is probably gazette vs press dating). It describes an "eighteen-month period for phased compliance". Each Data Fiduciary must issue a separate, clear consent notice stating the specific purpose. Consent Managers must be Indian companies. The Data Protection Board is fully digital and has four members. — [PIB explainer, 17 Nov 2025](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf) (text extracted locally)
- **Penalty ceilings (PIB):** up to Rs 250 crore for failing to maintain reasonable security safeguards. Up to Rs 200 crore each for failing to notify the Board and individuals of a breach, and for violating obligations relating to children. Up to Rs 50 crore for any other violation. — [PIB explainer](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf)
- **Data principal rights and response time:** access, correction, update, erasure, and nomination of another person. Fiduciaries must respond to such requests within 90 days. A contact point (designated officer or DPO) must be displayed. — [PIB explainer](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf)
- **Children:** verifiable parental consent is required for a child's data (the PIB explainer says unless the processing relates to essential services such as healthcare, education or real-time safety). Child means under 18. — [PIB explainer](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf)
- **Rule 10 mechanism:** the fiduciary must use technical and organisational measures so that verifiable consent of the parent is obtained, with due diligence that the person claiming to be the parent is an identifiable adult (18+). It may rely on details it already holds, details voluntarily provided, or a virtual token from an authorised entity, including a Digital Locker Service Provider. — [Rule 10 text](https://dpdpa.com/dpdparules/rule10.html)
- **Rule 12:** the Act's section 9(1) and 9(3) (parental consent, no tracking or behavioural monitoring of children) do not apply to classes of fiduciaries in Part A of the Fourth Schedule, or to purposes in Part B, subject to conditions there. — [Rule 12 text](https://dpdpa.com/dpdparules/rule12.html)
- **Educational institution exemption (law-firm commentary, not the gazette):** a limited exemption lets institutions track or monitor children without verifiable consent only where "required strictly for the educational activities of the institution" or in the interests of safety of enrolled children. The commentary does not say whether degree colleges or universities are covered. Another source says a B2B edtech acting solely as a processor for the institution shifts the parental-consent obligation to the institution as the fiduciary. — [S.S. Rana & Co](https://ssrana.in/articles/schools-coaching-centres-platforms-processing-childrens-data-are-you-compliant/); [Storyboard18](https://www.storyboard18.com/digital/dpdp-rules-carve-out-key-exemptions-for-healthcare-providers-schools-and-childcare-services-processing-childrens-data-84208.htm)
- **Rule 8 (erasure):** the fiduciary must erase data after the Third Schedule period if the principal has not approached it. It must give at least 48 hours' notice before erasure. Logs must be retained for a minimum of one year. The Third Schedule table contents were not visible. — [Rule 8 text](https://dpdpa.com/dpdparules/rule8.html)
- **Rule 7 (breach):** inform affected principals "without delay"; inform the Board "without delay", with a detailed report within 72 hours (extendable by the Board on request). — [Rule 7 text](https://dpdpa.com/dpdparules/rule7.html)
- Consent Manager registration timing and DEPA analogy are in the earlier note.

### Inferences
- **Who is the fiduciary:** in a campus deployment the college (or training institute) is most plausibly the data fiduciary and the platform its processor (per commentary, not confirmed in the Rules). The platform should therefore ship compliance evidence that the college can show a regulator, with a Data Processing Agreement template.
- **Under-18 users in polytechnic/diploma cohorts** are plausible, since the earlier note's ISR figure shows polytechnic as a distinct cohort. A "guardian consent" step that uses a DigiLocker-style virtual token (simulated) is a concrete localised design point. It should be labelled as a simulation until the platform is a DigiLocker requester.
- **Demonstrable compliance features that map to cited rules (design suggestions):**
  - Purpose-specific consent notices with a signed, timestamped consent receipt (Section on notice).
  - A student-facing "my data" page covering access, correction and erasure, with a 90-day SLA counter.
  - A 48-hour pre-erasure notice and an erasure certificate (hash of deleted record IDs plus timestamp) to support Rule 8.
  - One-year immutable processing logs (Rule 8).
  - A breach drill and notification template using the 72-hour clock (Rule 7).
  - A visible grievance contact (Rules).
- **What a college must show** (from the cited rules): notice, valid purpose-bound consent, erasure and retention handling, breach reporting, a displayed contact, and verifiable parental consent for minors. Significant Data Fiduciary duties (audits, impact assessments) are unlikely to apply to a single college, but the designation criteria were not verified.

### Gaps
- The notified Rules PDF on meity.gov.in returned 403, so the Fourth Schedule Part A text, the Third Schedule time periods and Rule 1 commencement dates are not primary-verified. The 18-month phasing and the November 2026 and May 2027 dates in the earlier note rest on secondary sources.
- Whether degree colleges are within the Part A educational-institution entry, and whether placement processing (sharing data with recruiters) falls under it, is unresolved. The exemption language appears to relate to tracking and monitoring for educational activities and safety, not to disclosure to employers, so the exemption most likely does not cover placement sharing (inference).
- The Rules' exact Consent Manager technical standards and whether any Consent Manager is registered in Nov 2026 are unconfirmed.
- Penalty amounts are from the PIB explainer, not the Act text.

## 5. India Skills Report, AISHE, NIRF/NAAC data formats; tier-2/3 and polytechnic realities; connectivity and device design responses

### Takeaway
Placement outcomes are reported to NIRF through the Data Capturing System as multi-year tables (intake, graduating, placed, median salary, higher studies), and to NAAC as offer letters and lists. Both are manual and audit-prone, which gives a concrete compliance output for a platform. Connectivity is better than the "low connectivity" stereotype for young people: near-universal smartphone and mobile data use, but rural fixed/Wi-Fi access is rare, so the design emphasis should be low data and resumability rather than offline-only.

### Cited Findings
- **NIRF placement template (third-party summary):** the UG placement and higher-studies table has columns for intake, admitted, lateral entry, graduating, placed, median salary and higher studies, for the previous three years. An older 2017 form required annual median salary of placed graduates. One explainer says "placed" counts only campus offers via institute-run drives. These are secondary sources, so the live DCS portal should be checked for the current definitions. — [Thapar NIRF 2025 submission page](https://nirfdemo.pages.dev/college) and [NIRF Overall Templates (Shivaji University copy)](https://www.unishivaji.ac.in/uploads/naac/2026/may/04-May/NIRF-Overall-Templates.pdf) (search summaries); official framework [NIRF Colleges 2025](https://www.nirfindia.org/nirfpdfcdn/2025/framework/Colleges.pdf)
- NIRF reports a 2025 ranking cycle whose placement figures cover 2023-24 (via third-party analysis); the 2026 cycle uses the online DCS portal run by the Ministry of Education. — [NIRF IR2025 report](https://www.nirfindia.org/nirfpdfcdn/2025/pdf/Report/IR2025_Report.pdf); [Avanti Fellows NIRF analysis](https://docs.avantifellows.org/analyses/nirf-outcomes/) (search summaries)
- **AISHE data availability:** AISHE itself says unit-level data is not accessible to the public, and aggregate reports are at aishe.gov.in. Institution directory datasets are on AIKosh under "Open Government License, India". The "All colleges as per AISHE dashboard" dataset lists AISHE code, name, state, district, year of establishment, location, college type, management and affiliated university, is about 4.35 MB, and shows an update date of 15 Dec 2025 (the page is inconsistent on update date). — [AIKosh AISHE colleges dataset](https://aikosh.indiaai.gov.in/home/datasets/details/all_colleges_as_per_aishe_dashboard_3.html); [AISHE](https://aishe.gov.in/?p=172)
- **Connectivity (NSO, Comprehensive Modular Survey: Telecom, Jan to Mar 2025, 34,950 households):**
  - About 85.5% of households own at least one smartphone, and 86.3% have internet access on premises. By sector, 83.3% of rural households have internet access on premises, vs 91.6% urban.
  - Among 15-29 year olds, 96.8% used a mobile phone in the prior three months, and 95.5% rural / 97.6% urban own a smartphone (as given in search summary).
  - 94.3% of 15-24 year olds use the internet.
  - 98.1% of rural internet users (15+) access via mobile data, and only 9.1% of rural vs 24% of urban access via fixed or Wi-Fi.
  - For 15-24 year olds, 32.6% created electronic presentations in the prior three months.
  — [PIB / NSO CMS:T 2025 document](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/may/doc2025529560001.pdf); [People's Archive of Rural India summary](https://ruralindiaonline.org/en/library/resource/comprehensive-modular-survey-telecom-2025); [Business Standard on UPI use by 15-29s](https://www.business-standard.com/finance/news/upi-usage-15-29-age-group-india-nss-2025-survey-125052901936_1.html) (search summaries; the PIB PDF was not read directly)
- ISR 2026, AISHE 2022-24 enrolment, AICTE placement data quality, NAAC 5.2.1 evidence and polytechnic employability (32.92%) are in the earlier note.

### Inferences
- **Compliance-output differentiator:** auto-generate (a) a NIRF-style three-year placement table with median salary, and (b) a NAAC 5.2.1-style placed-student list with linked offer-letter hashes. This ties the product to something every IQAC cell must produce. It is a design idea, since no official machine-readable template for either was found.
- **Connectivity design stance:** the data say "everyone has a phone on mobile data, few have fixed broadband". That supports a low-data PWA (small payloads, resumable uploads, cached assessments, queue-and-sync) and phone-first UX. It does not support a claim that students are "offline". Use the CMS:T numbers to justify this, and avoid claiming a specific share of low-end Android devices (no source found).
- **WhatsApp/SMS and UPI-style simplicity:** no sourced adoption data was found for placement-related WhatsApp use beyond vendor claims about WhatsApp groups (earlier note). A WhatsApp-style "status update" and a UPI-like one-tap consent confirmation are defensible as design choices, and a prototype can simulate them. The WhatsApp Business API is not covered by sources here and would need its own onboarding.
- **Tier-2/3 and polytechnic realities:** AISHE does not classify colleges by tier (earlier note), so use AISHE management and location fields from the directory dataset as proxies (rural/urban, government/private). Label them as proxies.

### Gaps
- Official NIRF DCS placement field definitions for 2026 and a machine-readable NAAC SSR template were not found.
- No AISHE polytechnic-specific enrolment or placement figures. No source on low-end Android share, RAM or storage among students, or on campus Wi-Fi quality.
- No published data on WhatsApp penetration among students or TPO WhatsApp use beyond vendor blogs.
- The CMS:T numbers above come from search summaries of the NSO release and should be re-checked against the PIB PDF before quoting.

## 6. Government datasets and schemes that can supply REAL numbers for a demo, with licences

### Takeaway
The cleanest real-data sources are data.gov.in (GODL-India licence) NCS vacancy and jobseeker tables, AIKosh/OGD AISHE institution directory data (Open Government License, India), the published AISHE/NIRF reports, and NQR Qualification Files for role taxonomies. All are aggregate or institution-level, not student-level, which suits a demo that must not use real student data.

### Cited Findings
- **Licence:** GODL-India applies to "all shareable non-sensitive data ... generated using public funds by various agencies of the Government of India" and was Gazette-notified on 13 Feb 2017. It grants a worldwide, royalty-free, non-exclusive right to use, adapt, publish and translate, with a required attribution line ("Published under [Name of License]: [URL of License]"). Rights end if terms are breached. A third-party summary says commercial reuse is allowed with attribution. data.gov.in says each dataset's own "license" metadata field controls. — [GODL-India overview (Wikipedia/NDSAP)](https://en.wikipedia.org/wiki/National_Data_Sharing_and_Accessibility_Policy); [CIS on GODL](https://cis-india.org/openness/public-consultation-for-the-first-draft-of-government-open-data-use-license-india-announced); [data.gov.in terms (smart cities portal)](https://smartcities.data.gov.in/terms-of-use)
- **Usable datasets located:**
  - NCS state-wise and sector-wise vacancy and jobseeker tables on data.gov.in (see section 3).
  - AISHE institutional directory on AIKosh (institution code, state, district, type, management, affiliating university).
  - AISHE reports 2022-23 and 2023-24 (headline numbers in the earlier note).
  - NIRF published rankings and placement tables on nirfindia.org. NIRF data licence terms were not found.
- **Real headline numbers already sourced in this and earlier notes:** NCS 17.68 lakh active vacancies and 2.89 crore active jobseekers (15 July 2026, PIB); AISHE and AICTE figures; ISR 2026 56.35% employability and 32.92% polytechnic (earlier note).
- **PMIS/NATS:** earlier note; no public API found.

### Inferences
- A demo could show a "real-data dashboard" for a college's state and sector using NCS and AISHE aggregates, each tile carrying its GODL attribution and "as of" date. Student-level demo data must be synthetic and labelled so.
- Real-vs-simulated labelling should be built into the UI (a "SIMULATED" badge on any mock DigiLocker or NAD response).

### Gaps
- Licence text for NIRF and AISHE report PDFs (as distinct from OGD-hosted datasets) was not found. The NCS dashboard page's reuse terms are unknown.
- The 2025-26 PMKVY, NATS and AICTE internship portal datasets were not located as open data.

## 7. Synthesis: documented vs approval-gated, 6-week feasibility, "surprise" integrations

### Takeaway
Real, documented, buildable now: Bhashini pipelines (PoC licence), data.gov.in and AIKosh GODL datasets, NQR public Qualification Files, API Setu sandbox (sample data), DPDP-aligned consent, erasure and breach tooling, and Rule 10 guardian consent logic. Approval-gated and not demonstrable for real: live DigiLocker/NAD/APAAR/ABC access, SIDH credentials, NCS posting and application sync, AICTE internship portal, NATS and PMIS sync.

### Cited Findings
- DigiLocker live access: SOP refuses temporary test access and requires committee approval, a digital signature and an STQC audit report. — [DigiLocker Partners SOP](https://cf-media.api-setu.in/resources/Partners-SOP.pdf)
- Bhashini public APIs are PoC-only, with production or paid use needing a Bhashini agreement. — [Bhashini GitBook](https://bhashini.gitbook.io/bhashini-apis)
- DPDP obligations phased over eighteen months from Nov 2025. — [PIB DPDP explainer](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf)
- No public API found for NQR, NCS, SIDH or AICTE internship portal (sections 3 and 1). NCS and some others have data.gov.in downloads under GODL. — see section 3

### Inferences
**Feasibility and labelling table (all assessments are inferences from the sources above):**

| Integration | Public docs we can build against today | 6-week student build | Label required | Approval needed for real use |
|---|---|---|---|---|
| DigiLocker requester flow | Yes (Requester spec v1.12, API Setu sandbox with sample data) | Adapter plus sandbox run | "Sandbox / spec-faithful" | Yes: SOP committee, digital signature, STQC audit |
| NAD / APAAR / ABC | No third-party API found | Simulation only | "Simulated issuer" | Yes (awarding body / government) |
| Bhashini ASR, NMT, TTS | Yes (GitBook, ULCA) | Yes | "Bhashini PoC API" | Production or paid use needs agreement |
| NQR / NSQF alignment | Read-only web, PDFs; no API | Manual mapping of 10-20 roles | "Aligned to NSQF (informational)" | No (public data); alignment is not certification |
| NCS vacancy data | data.gov.in CSVs, GODL | Yes | Attribution plus "as of" date | No for CSVs; Yes for posting or sync |
| AISHE directory | AIKosh dataset, GODL-type licence | Yes | Attribution | No |
| SIDH credentials | No public API | Simulation only | "Simulated" | Yes |
| AICTE internship portal, PMIS, NATS | No public API | Deep-link or export stub | "Stub" | Yes |
| DPDP consent receipts, erasure proofs, breach clock, guardian consent | Yes (Rules text) | Yes | "Aligned to DPDP Rules 2025; not legal advice" | Consent Manager registration needs an Indian company plus Board approval (earlier note) |

**"You integrated with X?" candidates that stay honest (our judgement):**
1. Bhashini voice interview practice in Hindi, Marathi and Tamil with a live demo. It is a real government API, and few student prototypes use it.
2. API Setu / DigiLocker sandbox run, with a clear "live access needs MeitY partner approval" slide quoting the SOP's own conditions.
3. DPDP Rule 10 guardian consent with a DigiLocker-token-style flow, and Rule 8 erasure certificates plus 48-hour notices. Few prototypes implement the Rules' mechanics.
4. NQR/NSQF level alignment of skills, plus real NCS and AISHE numbers with GODL attribution.
5. NAAC 5.2.1 / NIRF placement table auto-generated for the college.

**What judges may challenge:** claiming DigiLocker or NAD integration without qualification, claiming Bhashini accuracy figures, or using NCS aggregates as per-student job counts. Pre-empt each with the labels above.

### Gaps
- Whether a student team could obtain DigiLocker sandbox credentials through API Setu or through an aggregator such as Setu without company registration is not established. API Setu's SOP requires a registered organisation for live onboarding, and the sandbox portal gave no sign-up steps.
- Judges' actual rubric for the competition is unknown, so "would surprise a judge" is an inference.
- Items not researched: WhatsApp Business API onboarding, SMS gateway DLT registration rules, e-Sign / Aadhaar eKYC, Sunbird RC as a self-hosted VC registry (mentioned in the earlier note, not extended here), and UPI/NPCI-style UX guidelines.
