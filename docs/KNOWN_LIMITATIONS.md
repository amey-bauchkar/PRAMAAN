# PRAMAAN — Known Limitations, Assumptions & Technical Boundaries

**Principle:** Transparency over overpromising. This document explicitly outlines what PRAMAAN does not do, what assumptions are made, and where external human or legal review is mandatory.

---

## 1. AI & Verification Boundaries

1. **No AI Authorship / Cheating Detection:** PRAMAAN does not claim to detect whether code was written by AI, Copilot, or another human. Git commit timestamps and authorship history are treated as unverified claims. Verification relies exclusively on the student's ability to defend the code in a grounded viva and pass live functional modification probes.
2. **Pure Function Scope for Automated Mutation Probes:** The automated Live Mutation Probe is engineered for pure algorithmic, computational, and utility functions (e.g. data transformations, parsers, core business logic). Complex full-stack applications with external databases or graphical interfaces are verified via code-grounded viva and faculty mentor attestations, not headless container execution.
3. **No Unassisted Model State Promotions:** LLMs never independently transition a skill to `Verified`. The LLM's role in verification is restricted to generating candidate viva questions anchored to specific code spans. The transition itself is driven by deterministic test results or an authorized mentor's signature.
4. **LeetCode & External Coding Profiles:** Until an official enterprise API agreement exists, LeetCode profile evidence is categorized as `external_profile` supporting `Observed` or `Claimed` status only. It never directly awards a `Verified` badge without secondary defense.

---

## 2. Privacy, Regulatory & Legal Boundaries

1. **Regulatory Compliance Status:** While PRAMAAN implements the technical primitives required by India's DPDP Act, NYC Local Law 144, and the EU AI Act (granular consent, purpose limitation, audit logging, impact ratio monitoring, human oversight), it has not undergone formal legal or third-party regulatory certification. Real-world institutional deployment requires review by qualified legal counsel.
2. **Small-Group Suppression Threshold ($N < 5$):** The small-group suppression threshold used in fairness checks is a configurable institutional privacy safeguard, NOT a statutory legal mandate. Institutions may configure this threshold according to their data governance policies.
3. **Protected Demographic Attributes:** Data on gender, category, or caste is stored in a separate, restricted table (`student_group_attributes`) and is accessible exclusively to the batch fairness analysis role. It is strictly excluded from student profiles, search indexes, recruiter visibility, and eligibility rule evaluations.
4. **Minors (Under 18 Years):** Where a student is flagged as a minor (`is_minor = true`), the platform requires an attested guardian consent record before repository indexing or external recruiter sharing can be activated.
5. **OAuth Revocation Scope:** Consent revocation immediately purges stored credentials and withdraws derived evidence in the local database. Remote provider-side revocation (e.g. invalidating the grant at GitHub) requires active `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` credentials; in sandbox environments without these keys, the system executes local token purge and logs `sandbox_inert`.

---

## 3. Placement & Predictive Analytics Boundaries

1. **Provisional Nature of Predictive Placement Models:** Placement forecasting models (AD-03) output cohort-level scenario ranges (e.g. estimated placement rate bands). These are explicitly watermarked and labeled as "Provisional Estimates — Not Statistically Validated." The platform strictly prohibits applying automated negative labels or intervention flags to individual students without TPO review.
2. **Accreditation Data Exports:** Reports generated for NAAC (Criterion 5.2.1) and NIRF formats provide deduplicated placement counts and transparent calculation formulas. These exports are watermarked as "Draft for Institutional Verification" until verified against official university registers.
3. **Synthetic Demo Data:** All demo environments use synthetic tenant data and mock student profiles. Synthetic outcomes are strictly partitioned and can never be merged into real institutional production databases.
