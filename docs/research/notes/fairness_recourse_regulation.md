# Fairness, Explainability, Algorithmic Recourse and Regulation for an Indian Campus Placement Platform (state as of Nov 2026)

Note on method: about 16 search/fetch calls. The MeitY/eGazette PDF and the NY State Comptroller report PDF were not fetched directly (the OSC page returned HTTP 403). DPDP Rules details therefore come from law-firm and compliance-site summaries. Items marked **[not re-verified this session]** come from well-known primary texts (statutes, canonical arXiv papers). Their URLs are canonical, but I did not fetch them in this session, so the report writer should treat them as lower-confidence.

---

## 1. India: DPDP Act 2023 and DPDP Rules 2025 (obligations and phased timeline)

### Takeaway
The DPDP Rules were notified on 13 Nov 2025 (G.S.R. 846(E); some sources say 14 Nov). Rollout is in three phases: Board/definitions immediately, Consent Manager registration from 13 Nov 2026, and nearly all substantive duties from 13 May 2027. So as of Nov 2026 a placement platform is in the 18-month runway: most obligations are not yet enforceable, but they are fixed and known. DPDP has no right to explanation of automated decisions. Its decision-relevant hooks are notice, the accuracy duty for decision-making data, erasure and grievance rights, the under-18 regime, and the Significant Data Fiduciary (SDF) duty to check algorithms.

### Cited Findings
- **Notification and phases.** The Rules were notified 13 Nov 2025 (Wikipedia and some sources say 14 Nov). Rules 1, 2 and 17–21 (definitions, Data Protection Board) took effect 13 Nov 2025. Rule 4 (Consent Manager registration) takes effect 13 Nov 2026. Rules 3, 5–16, 22 (and 23 where counted) take effect 13 May 2027. — [dComply rule index](https://dpdpa.dcomply.in/rules/); [Wikipedia: DPDP Rules 2025](https://en.wikipedia.org/wiki/Digital_Personal_Data_Protection_Rules,_2025); [TCSA roadmap](https://www.tcsa.in/resources/dpdp-rules-2025-implementation-roadmap)
- Mondaq says Consent Manager provisions start "November 14, 2026", one day off from the 13 Nov date most sources give. — [Mondaq: DPDP Rules notified](https://www.mondaq.com/india/data-protection/1708164/digital-personal-data-protection-rules-2025-notified)
- Sources number the rules differently: some private guides count a "Rule 23". The Gazette G.S.R. 846(E) is the authoritative numbering. In dComply's numbering: Rule 12 covers SDF obligations, Rule 13 algorithmic due diligence, Rule 14 Data Principal rights, Rule 15 cross-border transfer, Rule 16 research exemption. — [dComply](https://dpdpa.dcomply.in/rules/)
- **Rule 3 (consent notice).** The notice must be clear and plain, in English by default, and available in the 22 Eighth Schedule languages on request. It must itemise the personal data collected, state the specific purpose, and explain how to withdraw consent and exercise rights. — [dComply](https://dpdpa.dcomply.in/rules/)
- **Rule 4 (Consent Managers).** It sets eligibility, registration and conduct standards for Consent Managers under s.2(g). Applications go via dpbi.gov.in. dComply notes the Board was "not yet constituted" and the Secretariat was expected to handle intake. From Nov 2026, registered entities can offer interoperable consent platforms. — [dComply](https://dpdpa.dcomply.in/rules/); [Seqrite](https://www.seqrite.com/blog/dpdp-rules-are-here-what-changed-from-the-draft/)
- **Rule 7 (breach notification).** The fiduciary must notify the Board and each affected Data Principal "without delay", then file a detailed report within 72 hours (extendable by the Board on written request). The report covers facts, mitigation and findings on the responsible party. This is separate from the CERT-In 6-hour reporting regime. — [Amlegals](https://amlegals.com/digital-personal-data-protection-rules-2025/); [dComply](https://dpdpa.dcomply.in/rules/); [Cyril Amarchand Mangaldas client alert (PDF)](https://www.cyrilshroff.com/wp-content/uploads/2025/11/Client-Alert-DPDP-Rules-Nov-2025.pdf)
- **Logs.** Logs and relevant personal data must be retained for at least one year for breach detection and investigation, then erased unless another law requires longer retention. — [Mondaq key highlights](https://www.mondaq.com/india/data-protection/1709066/key-highlights-of-the-digital-personal-data-protection-rules-2025); [Baker Botts](https://ourtake.bakerbotts.com/post/102lund/india-notifies-final-rules-for-digital-data-protection-act)
- **Rule 8 (erasure).** Data must be erased once the purpose is served or consent is withdrawn. The Third Schedule sets time-based erasure, with 48-hour advance notice to the user, but only for large e-commerce, social media and online-gaming intermediaries. A placement platform is probably not in those classes. — [dComply](https://dpdpa.dcomply.in/rules/); [Mondaq](https://www.mondaq.com/india/data-protection/1709066/key-highlights-of-the-digital-personal-data-protection-rules-2025)
- **Rule 10 (children, i.e. under-18s).** Verifiable parental or guardian consent is required, using government-issued identity tokens or DigiLocker-based verification, from 13 May 2027. Tracking, behavioural monitoring and targeted advertising directed at children are prohibited by Act s.9(3). — [TCSA](https://www.tcsa.in/resources/dpdp-rules-2025-implementation-roadmap); [The Bar Bulletin](https://thebarbulletin.com/dpdp-rules-2025-consent-managers-children-data-key-obligations/)
- **Fourth Schedule exemption for educational institutions.** Educational institutions may process children's data, and track or monitor them, without verifiable parental consent, but only for two purposes: (a) the institution's educational activities, and (b) monitoring "in the interests of the safety of children enrolled". Sources disagree on whether this is Part A item 3 or items 3–4. — [Tsaaro: regulatory carve-outs](https://tsaaro.com/blogs/regulatory-carve-outs-examining-exemptions-under-the-dpdp-act-2023-and-dpdp-rules-2025); [S.S. Rana](https://ssrana.in/articles/schools-coaching-centres-platforms-processing-childrens-data-are-you-compliant/); [Storyboard18](https://www.storyboard18.com/digital/dpdp-rules-carve-out-key-exemptions-for-healthcare-providers-schools-and-childcare-services-processing-childrens-data-84208.htm)
- **The exemption is narrow.** Data collected for educational purposes cannot be reused for behavioural analytics, marketing or commercial analytics without fresh consent or another applicable exemption. Commentary also says children's behavioural data must be kept separate from any tracking, profiling or ad processing. — [Tsaaro: safeguarding minors](https://tsaaro.com/blogs/safeguarding-minors-online-understanding-parental-consent-obligations-and-behavioural-monitoring-restrictions-under-the-dpdpa-and-dpdp-rules); [LiveLaw](https://www.livelaw.in/articles/dpdp-child-data-rules-demand-edtech-platforms-555317)
- **SDF duties** (Rules 12/13 in dComply's numbering):
  - India-resident DPO
  - annual DPIA and an independent audit
  - targeted data localisation
  - due diligence to verify that "algorithmic software" does not pose risks to Data Principals' rights

  SDF status applies only if the Central Government designates the fiduciary. — [dComply](https://dpdpa.dcomply.in/rules/)
- **Act-level provisions [not re-verified this session].**
  - s.2(f): "child" means under 18.
  - s.8(3): where personal data is likely to be used to make a decision affecting the Data Principal, the fiduciary must ensure it is complete, accurate and consistent.
  - s.9(3): ban on tracking, behavioural monitoring and targeted advertising directed at children.
  - Schedule penalties: up to INR 250 crore for security-safeguard failures and up to INR 200 crore for breaching children's obligations.
  - The Act has no GDPR Art. 22-style automated-decision right.

  — [MeitY DPDP Act 2023 PDF](https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf)

### Inferences
- Most placement-eligible students are 18 or older, so the under-18 regime mostly matters for first-year students at entry, or if the platform extends into school or early-college pipelines. If a platform builds "skill tracking" or "readiness scores" on under-18 data, that can count as behavioural monitoring. It falls within the educational-institution exemption only if the college itself, not a vendor's commercial analytics, does it for educational activities. A vendor processing for the college would need to be a processor under the college's educational purpose, with no secondary commercial use.
- The s.8(3) accuracy duty for decision-relevant data is the closest DPDP gets to fairness or explanation. It supports a "show the student exactly which data drove an eligibility outcome and let them correct it" feature, which aligns with the rights to correction and grievance.
- Nov 2026 to May 2027 is a window to ship compliant consent notices, multilingual notices and consent-manager integration before enforcement begins. Being early here can be a sales point with colleges.

### Gaps
- I did not fetch the official MeitY/eGazette text, so the exact wording of Rule 10 verification methods, the Fourth Schedule entries, and the grievance response timeline is unverified. One secondary source mentioned a 90-day grievance period, but I did not confirm it.
- There is no evidence yet that any placement platform has been designated an SDF. Designation criteria (volume, sensitivity, risk) were not found.
- The Data Protection Board's actual operational status in Nov 2026 is unconfirmed beyond dComply's note that it was not constituted at the time of writing.
- I did not obtain a Trilegal, AZB or Khaitan summary specifically; searches returned Cyril Amarchand, Baker Botts, Mondaq-hosted firms, S.S. Rana and Tsaaro.
- MeitY's India AI Governance Guidelines (released around Nov 2025) are non-binding, and I did not verify them in this session.

---

## 2. Foreign AI-in-hiring/education regulation: NYC LL144, Colorado, EU AI Act, UK

### Takeaway
NYC LL144 has been in force since 5 July 2023 and requires annual bias audits that publish impact ratios. A Dec 2025 NY State Comptroller audit found its enforcement "ineffective". Colorado's SB 24-205 was delayed to 30 June 2026, then put on hold by a stipulated court order, then repealed and replaced by the much lighter SB 26-189, effective 1 Jan 2027. The EU AI Act's Annex III obligations for employment and education high-risk systems were moved from 2 Aug 2026 to 2 Dec 2027 by the Digital Omnibus (Regulation (EU) 2026/1744). None of these binds an India-only platform directly. They are the de-facto templates for "audit-ready" fairness features.

### Cited Findings
- **NYC LL144 enforcement audit.** The NY State Comptroller's audit (report 2024-N-6, issued 2 Dec 2025, covering July 2023–June 2025) found DCWP's enforcement "ineffective". Findings:
  - DCWP received only two AEDT complaints in scope and did not test whether intake worked.
  - It does not routinely monitor annual bias-audit compliance or pursue proactive leads.
  - Enforcement actions were rare, with no follow-up on remediation.

  DCWP disputed some findings and cited resource constraints and "no evidence of widespread non-compliance", but agreed to adopt most recommendations in whole or in part. — [NY OSC audit page](https://www.osc.ny.gov/state-agencies/audits/2025/12/02/enforcement-local-law-144-automated-employment-decision-tools); [OSC press release](https://www.osc.ny.gov/press/releases/2025/12/dinapoli-new-yorkers-deserve-transparent-hiring-process-when-artificial-intelligence-used-vet-their); [OSC report PDF](https://www.osc.ny.gov/files/state-agencies/audits/pdf/sga-2026-24n6.pdf); [DLA Piper, 30 Jan 2026](https://www.dlapiper.com/en/insights/publications/2026/01/critical-audit-of-nyc-ai-hiring-law-signals-increased-risk-for-employers)
- Seyfarth notes that a DCWP commissioner signalled more scrutiny, but no specific new enforcement initiative was announced. — [Seyfarth](https://www.seyfarth.com/news-insights/new-york-city-department-of-consumer-and-worker-protection-dcwp-commissioner-signals-increased-scrutiny-of-ai-in-the-workplace-and-calls-for-expanded-guardrails.html); [DCI Consulting](https://blog.dciconsult.com/recommended-changes-to-local-law-144)
- Secondary blogs report figures such as "32 companies reviewed" and "17 potential issues found by auditors". These come from low-authority sources and should be checked against the OSC PDF before use. — [Staffing Industry Analysts](https://www.staffingindustry.com/editorial/cws-30-contingent-workforce-strategies/enforcement-of-new-york-s-ai-in-hiring-law-falling-short)
- **LL144 mechanics [not re-verified this session].**
  - Covers AEDTs that "substantially assist or replace" discretionary decisions.
  - An independent bias audit is required within one year before use, with a public summary.
  - Impact ratio = the category's selection rate (or scoring rate) divided by the rate of the most-selected category.
  - Audits cover sex, race/ethnicity and intersectional categories. Categories under 2% of data may be excluded.
  - Candidates get 10 business days' notice.
  - Civil penalties are $500–$1,500 per violation.
  - There is no legal threshold: an impact ratio below 0.8 is not itself a violation.

  — [NYC DCWP AEDT page](https://www.nyc.gov/site/dcwp/about/automated-employment-decision-tools.page)
- **Colorado timeline.**
  - SB 25B-004 (2025 special session) moved SB 24-205's effective date from 1 Feb 2026 to 30 June 2026 without substantive change. — [NatLawReview](https://natlawreview.com/article/colorado-delays-comprehensive-ai-law-further-changes-anticipated); [Berg Hill](https://bhgrlaw.com/2025/10/colorado-legislature-further-delays-implementation-of-consumer-protections-for-artificial-intelligence-law-to-june-30-2026-what-employers-need-to-know/)
  - 27 Apr 2026: in xAI's suit (with DOJ intervening), Magistrate Judge Cyrus Y. Chung entered a stipulated order. The AG agreed not to enforce SB 205 until 14 days after a ruling on xAI's preliminary-injunction motion. xAI may file that motion up to 28 days after final rulemaking under SB 205 or replacement legislation. This is a stipulated delay, not a merits injunction. — [McDermott Will & Schulte](https://www.mcdermottlaw.com/insights/colorado-ai-law-in-flux-comprehensive-replacement-bill-signed-after-federal-court-blocks-predecessors-enforcement/)
  - 14 May 2026: SB 26-189 was signed. It repeals and re-enacts the framework as a "notice-based approach", effective 1 Jan 2027, with AG rulemaking due by then. It keeps notice at point of interaction, a plain-language explanation of the ADMT's role within 30 days of an adverse outcome, data correction, and human review. It drops detailed impact assessments, the general anti-discrimination duty and AG disclosures. It bars joint-and-several liability and gives a 60-day cure period that sunsets after 3 years. xAI and DOJ are expected to challenge SB 189. — [McDermott](https://www.mcdermottlaw.com/insights/colorado-ai-law-in-flux-comprehensive-replacement-bill-signed-after-federal-court-blocks-predecessors-enforcement/)
  - Whether SB 189 keeps education and employment as "consequential decisions" was not confirmed (SB 205 included both).
- **EU AI Act Digital Omnibus.**
  - Provisional agreement 6–7 May 2026; Parliament adopted 16 June 2026; Council final approval 29 June 2026.
  - Published as Regulation (EU) 2026/1744 in the OJ on 24 July 2026; in force 27 July 2026.
  - Annex III high-risk (including employment/recruitment and education) moves from 2 Aug 2026 to 2 Dec 2027. Annex I (product-embedded) moves to 2 Aug 2028.
  - Art. 50 transparency still applies from 2 Aug 2026. The watermarking grace period runs to 2 Dec 2026 for systems already on the market.

  — [Gibson Dunn](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/); [regulation-ai.eu: Reg 2026/1744](https://www.regulation-ai.eu/en/omnibus/); [CSA research note](https://labs.cloudsecurityalliance.org/research/csa-research-note-eu-ai-act-omnibus-vii-deadline-delay-20260/); [HLC](https://www.hlc.com/en/publications/eu-legislators-agree-to-delay-for-highrisk-ai-rules)
- The Omnibus also widens the legal basis for processing special-category data for bias detection and correction. It now extends beyond high-risk providers to all AI systems and GPAI models, under a strict-necessity standard. The Art. 4 AI-literacy duty is softened to "support" literacy. — [Gibson Dunn](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/)
- **EU AI Act substance [not re-verified this session].**
  - Annex III point 3 (education) covers: admission/assignment; evaluating learning outcomes; assessing appropriate level of education; monitoring prohibited behaviour during tests.
  - Annex III point 4 (employment) covers: recruitment/selection, including targeted job ads and filtering/evaluating applications; and decisions on promotion, termination, task allocation and monitoring.
  - Provider duties: Arts 9–15 (risk management, data governance including bias examination, technical documentation, logging, transparency to deployers, human oversight, accuracy/robustness).
  - Deployer duties (Art. 26) include human oversight by competent persons and informing workers' representatives. Art. 27 requires a fundamental-rights impact assessment for certain deployers.
  - Art. 86 gives affected persons a right to "clear and meaningful explanations of the role of the AI system in the decision-making procedure and the main elements of the decision" for Annex III decisions with legal or similarly significant effects.
  - Art. 5(1)(f) bans emotion recognition in workplaces and education (in force since 2 Feb 2025).

  — [EUR-Lex Regulation (EU) 2024/1689](https://eur-lex.europa.eu/eli/reg/2024/1689/oj)
- **UK ICO AI-in-recruitment audit outcomes.** Published 6 Nov 2024 from consensual audits run Aug 2023–May 2024. Nearly 300 recommendations (some say 296), all accepted or partly accepted. Recommendations cover fairness (monitoring accuracy and bias), transparency/explanation to candidates, data minimisation, and lawful basis. The ICO also published six questions for recruiters to ask before procurement. It found some providers took no active steps to monitor accuracy and bias. — [ICO news](https://ico.org.uk/about-the-ico/media-centre/news-and-blogs/2024/11/ico-intervention-into-ai-recruitment-tools-leads-to-better-data-protection-for-job-seekers); [ICO outcomes report PDF](https://cy.ico.org.uk/media2/migrated/4031620/ai-in-recruitment-outcomes-report.pdf); [Hunton](https://www.hunton.com/privacy-and-cybersecurity-law-blog/uk-ico-publishes-report-on-audit-of-ai-recruitment-tools)

### Inferences
- **What these regimes converge on** (useful as an Indian "beyond-compliance" spec):
  - notice before use
  - published group impact ratios, including intersectional ones
  - plain-language post-adverse-outcome explanation (Colorado SB 189: within 30 days; EU Art. 86)
  - data correction
  - human review or appeal
  - logging

  A campus platform that ships all of these by default would exceed any Indian legal requirement and be ready for multinational recruiters subject to NYC or EU rules.
- **Education is high-risk.** Under the EU AI Act, a tool that "evaluates learning outcomes" or "assigns persons to educational institutions" is high-risk. Placement-eligibility filtering that a recruiter applies to students also sits squarely in Annex III point 4(a). EU-headquartered recruiters hiring from Indian campuses may push AI Act-like contractual requirements onto the platform from Dec 2027. This is an inference: the AI Act applies extraterritorially where output is used in the EU, which may not be the case for India-located jobs.
- **Enforcement is weak.** The weak LL144 record and Colorado's retreat suggest regulation here is driven more by transparency than by penalties. Competitive differentiation will come from voluntary, credible transparency rather than legal compulsion.

### Gaps
- I could not fetch the OSC report PDF (403), so the exact counts (companies surveyed, issues found) are unverified.
- SB 26-189's coverage of education and employment, and its final rule text, are unconfirmed.
- I did not cover the Illinois HB 3773 amendment to the IL Human Rights Act (effective 1 Jan 2026), California CRD ADS regulations (effective Oct 2025), or the EEOC's withdrawal of AI guidance in 2025. These are relevant US datapoints the writer may want to flag as unresearched here.

---

## 3. Four-fifths rule: limitations and better practice

### Takeaway
The four-fifths (80%) rule is a heuristic from the 1978 Uniform Guidelines. With small samples, which are typical for single campus drives, it produces many false positives and misses. Significance tests over-flag in large samples. Better practice combines impact ratios with exact tests (Fisher), confidence intervals and practical-significance measures, and handles small intersectional cells explicitly.

### Cited Findings
- With small samples, the 4/5ths rule often flags adverse impact even when population selection rates are equal (Roth, Bobko & Switzer 2006, Journal of Applied Psychology). Requiring a significance test as well markedly reduces false positives in moderate samples. — [Roth, Bobko & Switzer 2006 (course copy)](https://web.pdx.edu/~mccunee/quant_621/Outlines/Roth,%20Bobko,%20Switzer%202006.doc)
- In *Bazile v. City of Houston* (2012), experts noted that the impact ratio and 80% threshold ignore sampling error. The 4/5ths rule, Fisher exact and chi-square gave conflicting conclusions. — [DCI Consulting](https://blog.dciconsult.com/a-deeper-dive-into-the-adverse-impact-analyses-in-bazile-v-city-of-houston-2012)
- Fisher's exact test gives the exact probability of the observed 2x2 table under the null and is preferred when cell counts are small (around <5). It converges with the Z-test in large samples. Chi-square flags even trivial differences when samples are large. — [Fulcrum Inquiry](https://www.fulcrum.com/chi-square/); [Berkshire](https://berkshire.helpjuice.com/additional-information/adverse-impact)
- Critics call the 80% threshold arbitrary. Courts use it, but neither the US Supreme Court nor any federal circuit has adopted it as a binding standard. — [Fulcrum Inquiry](https://www.fulcrum.com/?p=665)
- **UGESP text [not re-verified this session].** 29 CFR 1607.4(D) says a selection rate below 4/5 "will generally be regarded" as evidence of adverse impact. It also says smaller differences may still be adverse impact if statistically and practically significant, and larger differences may not be when based on small numbers and not statistically significant. — [eCFR 29 CFR 1607.4](https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XIV/part-1607/section-1607.4)

### Inferences
- **Better practice for a placement platform:**
  - Report the impact ratio together with a confidence interval (for example, a bootstrap or Katz log interval for the ratio).
  - Report the Fisher exact p-value, plus a "shortfall" count: how many additional selections from the lower group would bring the ratio to parity or to 0.8.
  - Pool across drives or seasons (Mantel-Haenszel or Cochran-Mantel-Haenszel across strata) to beat small samples.
  - Report intersectional cells (gender × category × region) with minimum-cell suppression to avoid re-identification.
- **"Shortfall" is actionable.** The shortfall framing (number of people) is more legible to placement officers than ratios, and it maps directly to fixing a rule.

### Gaps
- No India-specific adverse-impact standard exists. Indian law has no statutory equivalent of UGESP for private hiring; constitutional reservation applies to the public sector.
- I did not retrieve the primary Roth et al. article or later work (e.g., Morris & Lobsenz, or SIOP 2022 recommendations), so specific alternative thresholds are not cited here.

---

## 4. Algorithmic recourse and counterfactual explanations

### Takeaway
The core literature (Wachter et al. 2017; Ustun, Spangher & Liu 2019; Karimi et al. survey; Miller, Milli & Hardt 2020) defines recourse as the minimal *feasible, actionable* change that flips a decision. It separates genuine improvement from gaming and shows recourse can be invalidated by model or distribution change. Recourse is studied in lending and education research. I found no evidence of a deployed hiring or campus product that issues formal, guaranteed recourse. Rule-based eligibility (CGPA ≥ X, no backlogs, branch ∈ S) is the easy, exactly-solvable case.

### Cited Findings
- Karimi, Barthe, Schölkopf & Valera's survey (ACM Computing Surveys) frames recourse as "what could a person change to obtain a better outcome". It ties recourse to legal motivations such as GDPR and separates contrastive explanations from consequential recommendations. — [Karimi et al. survey (ETH Research Collection)](https://www.research-collection.ethz.ch/server/api/core/bitstreams/b678a1ef-8171-4f77-a029-a3bdaf606bb3/content)
- Verma et al.'s review defines recourse as specific, minimal modifications that lead to a favourable result and must be feasible. Their example is that "decrease your age" is infeasible. — [Verma et al. review (arXiv 2010.10596)](https://alphaxiv.org/abs/2010.10596)
- Ustun, Spangher & Liu (2019) formulate recourse as finding minimum-cost feasible feature changes that yield the desired outcome. They distinguish it from strategic manipulation: recourse changes the true attributes, manipulation only changes reported features. — characterised in [König et al., Improvement-Focused Causal Recourse (AAAI 2023)](https://arxiv.org/pdf/2210.15709); original: [Ustun et al., arXiv 1809.06514](https://arxiv.org/abs/1809.06514) [not re-verified this session]
- Miller, Milli & Hardt (ICML 2020) separate "gaming" (changes Ŷ but not Y) from "improvement" (changes both). They show that designing classifiers that incentivise improvement requires solving a non-trivial causal inference problem. — [PMLR v119](https://proceedings.mlr.press/v119/miller20b.html)
- König et al. (AAAI 2023) propose Improvement-Focused Causal Recourse, which targets changes to the real-world state Y rather than mere acceptance. They note that no improvement-focused recourse method existed before. — [arXiv 2210.15709](https://arxiv.org/pdf/2210.15709)
- **Education study.** A recourse technique recommended changes to 66 students, but following them would improve grades for only 60.6% of them. Distribution shift invalidated recourse. — [arXiv 2505.14377](https://arxiv.org/html/2505.14377v1)
- **CHI 2025.** Upadhyay, Lakkaraju & Gajos question whether the standard counterfactual paradigm best serves recourse from a human-centred perspective. — [Upadhyay et al. 2025 (Harvard)](https://kgajos.seas.harvard.edu/papers/upadhyay2025counterfactual.pdf)
- **Wachter, Mittelstadt & Russell (2017).** "Counterfactual Explanations without Opening the Black Box" proposes counterfactuals as a GDPR-compatible explanation that does not require disclosing the model. [not re-verified this session] — [arXiv 1711.00399](https://arxiv.org/abs/1711.00399)

### Inferences
- **Why rule-based eligibility is the easy case.** Placement eligibility rules are mostly conjunctive thresholds, for example CGPA ≥ 7.0, 10th/12th % ≥ 60, active backlogs = 0, branch in {CSE, IT, ECE}, graduation year = 2027. For these, the "smallest change that makes you eligible" is exactly computable. There is no ML black box, so it is free of the robustness and validity problems that plague model-based recourse.
- **The novel part is classification and time.** The work is in labelling each failed clause as:
  - *immutable* (graduation year, 10th marks), so the student gets "not achievable for this drive"
  - *achievable within the drive deadline* (clear a backlog in supplementary exams, upload a missing certificate)
  - *achievable for future drives* (raise CGPA by 0.3 over the next semester, with the required semester GPA computed)
- **Aggregate recourse** ("you would be eligible for 14 more drives if you cleared 1 backlog") fits the improvement framing (Miller et al.), because the rule's features (backlogs, CGPA) are genuinely causal to the outcome.
- **Gaming risk** comes mainly from self-reported or unverifiable fields (skills, certifications). Recourse should be offered only on verified fields, or flagged when it relies on self-reported ones.
- **Recourse invalidation.** If a recruiter edits criteria after publishing, previously issued recourse becomes invalid, as in the education study's distribution-shift result. A product could promise recourse stability (criteria frozen at publish) as a commitment.

### Gaps
- I found no source showing a commercial hiring, ATS or campus-placement product offering formal counterfactual or recourse guidance. Absence of evidence after limited search does not prove no such product exists.
- I did not retrieve lending-industry recourse practice (e.g., US ECOA adverse-action "principal reasons") in this session. It is a known analogue but not re-cited here.

---

## 5. Fairness-aware selection-rule repair / constrained threshold optimisation

### Takeaway
There is substantial academic work on fair ranking and selection under constraints, and US disparate-impact doctrine has a "less discriminatory alternative" (LDA) step. I found no commercial product that, given a recruiter's eligibility rule, searches for the *minimal edit* that cuts adverse impact while keeping job-relevance. This looks like a genuine gap.

### Cited Findings
- Miller, Milli & Hardt's causal framing implies that rules built on causally relevant features incentivise improvement rather than gaming. This argues that any "repaired" rule should keep job-relevant, causal criteria. — [PMLR v119](https://proceedings.mlr.press/v119/miller20b.html)
- **Background literature [not re-verified this session]:**
  - Zehlike et al., "FA*IR: A Fair Top-k Ranking Algorithm" (CIKM 2017) — [arXiv 1706.06368](https://arxiv.org/abs/1706.06368)
  - Kleinberg & Raghavan, "Selection Problems in the Presence of Implicit Bias" (ITCS 2018) — [arXiv 1801.03533](https://arxiv.org/abs/1801.03533)
  - Black, Koepke, Kim, Barocas & Hsu, "Less Discriminatory Algorithms" (Georgetown Law Journal, 2024), which argues that model multiplicity means equally accurate, less discriminatory alternatives usually exist and should be searched for. I did not confirm a URL.
- Under Title VII burden-shifting (42 U.S.C. §2000e-2(k)), the plaintiff can prevail if a less discriminatory alternative with equal validity exists and the employer refuses it. [not re-verified this session] — [42 U.S.C. 2000e-2 (Cornell LII)](https://www.law.cornell.edu/uscode/text/42/2000e-2)

### Inferences
- **The problem is small and searchable.** Campus eligibility rules have few clauses and only a few hundred to a few thousand candidates. The "minimal rule edit" problem can be solved by exhaustive or ILP search: for example, "lowering CGPA cutoff 7.5 → 7.2 raises the female/male impact ratio from 0.71 to 0.86 and adds 23 eligible students". Combined with "publish-time fairness simulation" (preview impact ratios, confidence intervals and Fisher p-values before a drive goes live), this is a concrete, novel feature with legal grounding in the LDA concept.
- **Use only legitimate levers.** Repair must avoid explicit group-based thresholds, which raise legal issues in the US (§2000e-2(l) bans adjusting scores by protected group) and political sensitivity in India. It should adjust only facially neutral thresholds and report job-relevance trade-offs.

### Gaps
- No product evidence was found for automated rule repair in ATS or campus platforms. Searching vendor docs (e.g., Pymetrics/Harver's audit tooling, holistic AI audit platforms) was not completed.
- I did not verify an empirical link between campus CGPA cutoffs and on-the-job performance (needed for "job-relevance").

---

## 6. Caste/category-based fairness in Indian hiring and education

### Takeaway
Western fairness frameworks do not port well to India (Sambasivan et al.). Caste is inferable from proxies even when names are removed, and caste bias has been shown in LLMs. Indian institutions do collect category data (SC/ST/OBC/EWS/General) for reservations and statutory reporting. In private hiring, however, using it is legally and socially sensitive, and fairness research on it is thin.

### Cited Findings
- Sambasivan, Arnesen, Hutchinson & Prabhakaran (Google Research, FAccT 2021), "Re-imagining Algorithmic Fairness in India and Beyond". Based on 36 expert interviews and analysis of Indian deployments, they argue that conventional fairness is Western in its subgroups, values and optimisations, and that it must account for caste, religion and other axes, data gaps and limited accountability. — [arXiv 2012.03659](https://arxiv.org/pdf/2012.03659.pdf)
- An opinion essay argues that algorithms reconstruct caste from non-name variables (e.g., location, schools, language), so removing surnames does not remove caste bias. — [The India Forum (2026)](https://www.theindiaforum.in/caste/algorithms-dont-need-your-surname-guess-your-caste-thats-problem)
- An IIM Bangalore working paper tests LLMs for caste-occupation stereotyping across all Indian districts in five studies, using last-name signals. — [IIMB WP No. 724 (2025)](https://www.iimb.ac.in/sites/default/files/2025-08/WP%20No.%20724.pdf)
- A NASSCOM survey (via secondary source) found unintended bias or discrimination was the fourth most reported AI risk (29% of AI-using organisations). The same source notes that US and EU bias research rarely covers caste. — [The People's Board](https://www.thepeoplesboard.com/?p=21452) (secondary; NASSCOM primary not retrieved)
- A claim that IIT Madras's "IndiCASA" benchmark found upper-caste preference in faculty-resume screening is unverified; it came only from a low-authority blog. — [AcademicJobs blog](https://www.academicjobs.com/in/research-publication-news/caste-bias-ai-models-india-or-iit-detection-tools-12252)

### Inferences
- Caste or category data is not a "sensitive personal data" category under DPDP 2023, which dropped the sensitive-data class. It is still socially and politically sensitive.
- **A privacy-preserving design:**
  - Category data is held by the college (which already holds it for AISHE/NIRF and scholarships).
  - The platform computes only aggregate impact ratios at publish time, with minimum-cell suppression.
  - Category is never shown to recruiters and never used as a selection feature.

  This "fairness audit without exposure" pattern mirrors the EU Omnibus's bias-detection basis for special-category data.
- Other proxies are measurable and probably correlated with caste and class: rural/urban origin, medium of schooling, first-generation-learner status, and 10th/12th board. They are less sensitive to audit on.

### Gaps
- I did not find an empirical study of caste or category disparities in Indian *campus placement* outcomes or eligibility cutoffs specifically. The Deshpande & Newman / Thorat & Attewell audit studies of Indian private-sector hiring are known but were not retrieved this session.
- The legal position on private employers voluntarily collecting caste data in India was not researched with a primary source.

---

## 7. Explainability requirements: right to explanation, plain-language reasons, human oversight

### Takeaway
A legal right to explanation for algorithmic hiring or education decisions exists in the EU (AI Act Art. 86 from Dec 2027 for Annex III; GDPR Art. 22/15) and Colorado (SB 189 post-adverse-outcome explanation from 1 Jan 2027). NYC LL144 requires notice but not individual reasons. India's DPDP gives none, only notice, access, correction and grievance. Human-oversight duties are explicit in the EU AI Act (Arts 14 and 26) and Colorado (human review).

### Cited Findings
- Colorado SB 26-189 (effective 1 Jan 2027) requires a plain-language description of the ADMT's role within 30 days of an adverse outcome, plus data correction and human review. This is less detailed than SB 205's "principal reasons, degree of contribution, data sources". — [McDermott](https://www.mcdermottlaw.com/insights/colorado-ai-law-in-flux-comprehensive-replacement-bill-signed-after-federal-court-blocks-predecessors-enforcement/)
- The EU Annex III date is now 2 Dec 2027, which governs when Art. 86 explanations and Art. 14/26 human-oversight duties bite for employment and education systems. — [Gibson Dunn](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/)
- **EU AI Act text [not re-verified this session].** Art. 86(1): right to "clear and meaningful explanations of the role of the AI system in the decision-making procedure and the main elements of the decision taken". Art. 14: human oversight enabling persons to understand, monitor, override and stop the system and to guard against automation bias. Art. 26(2): deployers assign oversight to persons with competence, training and authority. — [EUR-Lex 2024/1689](https://eur-lex.europa.eu/eli/reg/2024/1689/oj)
- The UK ICO's recruitment audit recommends that providers and recruiters explain clearly to candidates how their data is processed and the logic of AI tools. — [ICO news](https://ico.org.uk/about-the-ico/media-centre/news-and-blogs/2024/11/ico-intervention-into-ai-recruitment-tools-leads-to-better-data-protection-for-job-seekers); [Lewis Silkin](https://www.lewissilkin.com/en/insights/2024/11/27/ai-in-recruitment-icos-recommendations-and-key-questions)
- DPDP Rule 3 requires plain-language, multilingual notices (22 Eighth Schedule languages on request). This is a precedent for plain-language communication even though DPDP has no decision-level explanation right. — [dComply](https://dpdpa.dcomply.in/rules/)

### Inferences
- **Per-decision reason codes.** A placement product that issues reason codes for every ineligible or rejected outcome ("Not eligible: CGPA 6.8 < 7.0 required; achievable gap 0.2"), in the student's chosen Indian language, with a one-click appeal or correction request routed to a named placement officer, would meet the highest common bar (EU Art. 86 + Colorado SB 189 + ICO). It would also be novel in the Indian campus market.
- **Human oversight on overrides.** Overrides should be logged with reasons, an Art. 14/26-style automation-bias guard. This also creates the audit trail needed for impact-ratio reporting.

### Gaps
- I did not research Indian sectoral rules that might require reasons: UGC/AICTE grievance regulations for students, and Supreme Court jurisprudence on natural justice for public institutions. These may give students a reasons-based right against *public* colleges independent of DPDP.
- The EU Commission's Art. 86 guidance and harmonised standards (CEN-CENELEC JTC 21) progress were not retrieved.
