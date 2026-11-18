# PRAMAAN — Product Blueprint, QUASAR Strategy & Claude Collaboration Brief

**Document purpose:** Single source of context for planning and developing PRAMAAN as a QUASAR EdTech solution and as a credible product for eventual use by colleges and recruiting companies.

**Status:** Domain selected; product direction proposed; detailed product requirements and architecture still require validation and approval.

**Competition:** QUASAR — Vasantdada Patil Pratishthan's College of Engineering & Visual Arts.

**Selected domain:** EdTech — Agentic Placement Intelligence Platform.

**Working product name:** PRAMAAN (प्रमाण — proof/evidence).

**Working tagline:** *Skills you can defend. Evidence recruiters can trust.*

> **Important source instruction:** The complete official QUASAR problem-statement PDF must be attached together with this Markdown file when this document is given to Claude. The PDF is the authoritative source for competition requirements. This brief is a product proposal and planning document; where anything in this brief conflicts with the PDF, the PDF wins. Claude must check every official requirement against the PDF and must not silently omit, reinterpret or replace any requirement.

---

# 1. Project Context

We have reviewed four QUASAR domains and shortlisted FinTech and EdTech. After comparing three independent AI product-strategy responses and considering feasibility, real data access, demonstration quality, possible pilot access and commercial potential, we have **finalized EdTech**.

The selected official problem statement is:

**Agentic Placement Intelligence Platform**

The official statement describes a platform that transforms evidence from student repositories, projects, assessments and other sources into verified skill profiles; identifies skill gaps; connects skills to industry demand; recommends learning; and coordinates campus hiring through explainable, auditable, human-controlled automation.

The goal is not to build another ordinary placement portal, a generic AI chatbot, a resume parser or a collection of dashboards.

We want to build a product that:

1. Satisfies every mandatory requirement of the official QUASAR EdTech problem statement.
2. Has a distinctive, technically meaningful innovation that judges can experience in a live demonstration.
3. Solves a real problem for students, colleges and recruiters.
4. Uses real data where permission and access allow it, and clearly labels synthetic/demo data.
5. Can be piloted with a real college and real students after the competition.
6. Has a credible path to becoming a secure, maintainable B2B SaaS product for educational institutions and hiring companies.

The product should be designed for real usage from the beginning, but we must be honest about maturity. A hackathon prototype, a pilot-ready release and a production-grade commercial product are different milestones. We must not claim that a short competition build is fully production-ready.

## 1.1 The underlying problem

Student resumes and self-declared skill lists do not reliably demonstrate what a student can actually do. A student may claim React, Java, Python, SQL or backend development experience, but a recruiter may have no direct evidence that the student understands the work represented in a project.

At the same time:

- Students do not always know which skills are relevant to their target roles or how to close specific gaps.
- Placement officers coordinate profiles, eligibility, company drives, assessments, interviews, offers and reporting across fragmented tools and spreadsheets.
- Recruiters need useful, explainable evidence to discover and assess candidates.
- Colleges need reliable cohort-level skill and placement insights.
- AI-assisted code and polished resumes make it more important to assess demonstrated understanding rather than relying on claims or attempting to guess whether AI was used.

**Product thesis:** Convert student work and assessment outcomes into evidence-linked, explainable and refreshable capability records, then use those records to improve learning and placement workflows.

We do not claim to prove who authored every line of code. We assess whether a student can explain, reason about, predict the behaviour of and modify a specific body of work. Repository history is supporting provenance evidence, not conclusive proof of authorship.

---

# 2. Product Vision and Positioning

## 2.1 Product vision

**PRAMAAN is an evidence-based placement intelligence platform that connects students, colleges and recruiters through continuously updated skill profiles, practical verification, personalized skill development and explainable campus-hiring workflows.**

## 2.2 Product mission

Make student capabilities more visible and verifiable, help students close relevant skill gaps, and help colleges and recruiters make better-informed placement decisions.

## 2.3 Primary user groups

### A. Students

Students should be able to:
- Create and maintain a student-owned profile.
- Connect selected repositories through explicit, revocable, read-only permissions.
- Add projects, certificates, LeetCode or other assessment evidence, and mentor attestations where supported.
- See which skills are claimed, observed, evidence-linked, verified or expired.
- Understand why a skill has a particular status.
- Complete mock drives and receive actionable reports.
- Compare their skills with target-company requirements.
- Follow personalized learning paths that produce new evidence, not merely course-completion badges.
- See upcoming drives, eligibility rules, application status and reasons for ineligibility.
- Control what data is shared and withdraw permissions.
- Appeal or request review of decisions and assessment outcomes.

### B. College / University / Training & Placement Officers

Officers should be able to:
- Manage students, departments, batches and roles.
- View verified-skill coverage and cohort skill gaps.
- Compare cohort capabilities with industry demand.
- Set versioned eligibility rules and explain decisions.
- Create mock drives and review assessment questions.
- Coordinate recruiter onboarding, calendars, interviews, offers and student communication.
- Search candidates using evidence-backed skills and explainable match reasons.
- Review AI-generated recommendations and approve actions that affect student candidacy.
- Monitor fairness and potential selection disparities.
- Export placement and career-outcome reports.
- Review audit logs and agent actions.

### C. Recruiters / Companies

Recruiters should be able to:
- Create a company profile and manage authorized recruiter users.
- Publish roles and define required skills and eligibility constraints.
- Search for candidates using role-relevant, evidence-backed capabilities.
- Inspect the evidence, assessment date, verification status and limitations behind a skill claim.
- Request a fresh verification or re-probe with student consent.
- Review mock-drive or assessment results.
- Shortlist candidates and manage interview stages and offers.
- Provide structured feedback where agreed.
- See clear reasons for a candidate match rather than an unexplained score.

## 2.4 Who pays and who uses it

Initial customer hypothesis:
- **Primary institutional buyer:** College management, Training & Placement Officer, Dean or Director.
- **Primary daily user:** Student; TPO staff use it for cohort and placement operations.
- **Secondary customer:** Recruiters hiring fresh graduates.

Initial pilot hypothesis:
- Start with one engineering college and one CSE/IT cohort.
- Start with a small number of volunteer students using their own repositories with explicit consent.
- Recruit one or two friendly recruiters or industry mentors to evaluate whether the evidence is useful.

These are hypotheses to validate through interviews and pilot activity, not confirmed customers or commitments.

---

# 3. Product Differentiation: What Makes PRAMAAN Stand Out

The standout innovation should be a real capability, not a marketing phrase. Do not claim that every component is first-of-its-kind. Research competitors and identify the exact differentiation that can be supported by evidence.

## 3.1 Innovation Pillar 1 — Code Archaeology / Evidence Engine

**Purpose:** Analyze a student's selected software project to identify concrete evidence of technical capabilities and meaningful implementation decisions.

Potential workflow:
1. Student connects GitHub using a narrowly scoped, read-only integration.
2. Student explicitly selects the repository or repositories to import.
3. PRAMAAN fetches permitted metadata, relevant source files, commit history and project structure.
4. A deterministic parser analyzes supported languages and syntax structures.
5. The system identifies candidate skills, modules, important functions and potentially meaningful changes across commits.
6. Each candidate skill is linked to evidence such as a repository, commit SHA, file path, line range, test or project artifact.
7. The system labels the skill as a candidate for assessment rather than automatically calling it verified.

Examples of potentially useful evidence:
- An API route and validation implementation.
- A React component and state-management pattern.
- A database schema and query layer.
- Authentication and authorization code.
- Tests and error handling.
- A dependency or architecture change across commits.

**Technical direction:** Tree-sitter or appropriate language parsers for syntax analysis; Git history/diff inspection; dependency and symbol analysis where feasible. Begin with JavaScript/TypeScript and Python. Expand language support only after the initial pipeline is reliable.

**Critical caveats:**
- A commit history does not prove identity or authorship.
- Public repository access does not grant unrestricted rights to reproduce code or ignore its licence.
- Forks, generated files, copied code and group projects need careful treatment.
- Repository content and README files are untrusted input and must never be treated as system instructions.
- If evidence is weak, say so. Do not fabricate skills or questions.

## 3.2 Innovation Pillar 2 — Executable Skill Verification / Defence Engine

**Purpose:** Assess whether a student can demonstrate understanding of a skill through questions grounded in their own project and practical, controlled code tasks.

Proposed verification sequence:
1. Student selects a candidate skill, such as React state management or Node.js API development.
2. PRAMAAN retrieves the evidence supporting that skill.
3. A question generator proposes questions anchored to real commits, files, code spans or implementation decisions.
4. A validator rejects questions whose evidence anchors do not resolve or which cannot reasonably be answered from the artifact.
5. The student completes a voice or text defence.
6. The system asks adaptive follow-up questions based on the answer and relevant code evidence.
7. Where safe and feasible, the student predicts the behaviour of their code, fixes a bug or makes a small modification.
8. The code is run in a restricted execution environment with resource and network limits.
9. A structured rubric evaluates technical correctness, reasoning, explanation and practical outcome.
10. The system produces a transparent result, with evidence and transcript references. Low-confidence or disputed results can be reviewed by a human.

Example:
- Repository evidence shows a React component using a functional state updater.
- The system asks why that pattern was used and what could happen when updates are queued.
- The student predicts the output for a specific scenario.
- A controlled probe executes the relevant code and displays the actual result.
- The student may be asked to make a small modification.

Possible assessment dimensions:
- Conceptual understanding.
- Understanding of the specific implementation.
- Reasoning about trade-offs and edge cases.
- Ability to predict behaviour.
- Ability to modify or debug code.
- Practical execution result.

**Important safeguards:**
- Do not label a student as cheating or as an AI-code author based on detector output.
- Do not claim that a viva proves authorship.
- Use “insufficient evidence” where the assessment is inconclusive.
- Allow appeal, reassessment and human review.
- Offer accessible alternatives such as text-based defence when voice is unsuitable.
- Do not use accent, fluency or language preference as a proxy for technical competence.
- Do not issue a calibrated probability or claim “accuracy” until validated on a labelled benchmark.

## 3.3 Innovation Pillar 3 — Portable Skill Evidence Passport

**Purpose:** Turn an assessment into a transparent, evidence-linked capability record.

A capability record should contain, at minimum:
- Student and institution reference, with appropriate visibility rules.
- Skill identifier and taxonomy version.
- Status: Claimed, Observed, Evidence-linked, Verified or Expired.
- Supporting evidence references: repository, artifact hash, commit range, file and line references, assessment or certificate.
- Verification method and rubric version.
- Assessment date and expiry/freshness policy.
- Result and plain-language explanation.
- Confidence information only where it has a defensible, validated meaning.
- Issuer/attestor and cryptographic integrity information where implemented.
- Student consent and sharing status.
- Re-probe or renewal history.

Key properties:
- **Evidence-linked:** A recruiter can inspect why a claim has a status.
- **Portable:** The student can export or share a credential, subject to privacy controls and the chosen credential standard.
- **Refreshable:** A skill can become stale or expire according to a transparent policy.
- **Re-testable:** A recruiter can request a fresh challenge with student consent.
- **Appealable:** The student can challenge an incorrect or incomplete record.

W3C Verifiable Credentials may be researched as an interoperability option. Do not add blockchain simply for marketing. Signed, tamper-evident records may be sufficient for an initial implementation.

---

# 4. Official QUASAR EdTech Requirements — Requirement Baseline

This section captures the visible content of the official PDF's EdTech pages 14–19. Claude must verify it against the attached full PDF and correct any transcription or interpretation errors. Preserve every mandatory official requirement in the final traceability matrix.

## 4.1 Business Requirements — PDF page 14

### A. Core Competency Profiling & Verification

1. **Student-owned dynamic profile:** The profile is part of the student record and updated from evidence independently of the resume. Resume-generated profiles are stored as “Claimed” on demand.
2. **Evidence-gated verification:** Never show a skill as verified without evidence. Every skill has an evidence trail and a state: Claimed, Observed, Evidence-linked, Verified or Expired.
3. **Consent-based repository ingestion:** Explicit, revocable consent; read-only and least-privilege access.
4. **Standard-aligned taxonomy:** Map to ESCO, O*NET and NSQF. Support portable verifiable credentials (for example, W3C Verifiable Credentials).

### B. Skill-Gap Bridging & Training Intelligence

5. **Industry-demand alignment:** Segment required job descriptions and hiring trends; show live in-demand skills; compare demand with cohort verified skills.
6. **Personalized AI learning paths:** Target verified gaps for a chosen role. Recommend projects and practice tasks that produce new verifiable evidence, not just course completions.
7. **Predictive training prioritization:** Cohort gap heatmap and recommendation priority based on confidence, intervention cost and placement impact.

### C. Automated Campus Hiring Workflows / Declarative Eligibility Engine

8. **Versioned, configurable rules:** Academic, backlog, skill and policy rules. Every decision records the rule version and inputs and must be reproducible and appealable.
9. **Coordinate drive management:** Single calendar and workflow for recruiter onboarding, scheduling, shortlisting, assessments, interviews and offer tracking. Prevent clashes.
10. **Recruiter views and coordination:** Candidate and recruiter views for scheduling, shortlisting, assessments, interviews and offer tracking.
11. **Explainable matching:** Reason codes for every match. No ranking by an unexplained score.
12. **Agentic automation with human oversight:** AI agents may assist ingestion, profiling, gap analysis, eligibility, scheduling, tasks and audit. Any action affecting candidacy needs T&P officer/reviewer approval. Log every agent action.

### D. Trust, Privacy, Explainability & Compliance

13. **Explainable scoring:** Every score/recommendation shows evidence, contributing factors, confidence and a plain-language explanation.
14. **Privacy and consent:** Granular scopes; revoke and delete; purpose limitation, retention and role/tenant limits; support privacy rights.
15. **Fairness monitoring:** Monitor selection/shortlisting across gender, category, branch and college type. Flag disparities for human review. Follow applicable laws and local policy. Avoid proxies for protected attributes.
16. **Integrity:** Tamper-evident audit trail for live modification events, consent events, eligibility decisions and agent actions.

### E. Multi-Tenancy & Administration

17. **Multi-tenancy:** Each college has its own tenant. Support university/college/department/officer roles and appropriate automated cross-institution tasks. Scale by college and recruiter roles; support unified reporting.
18. **Role permissions:** University → College → Department → Officer with fine-grained access.
19. **Unified reporting:** One view of Placement Rate, Verified Skill Coverage, Skill Gap Closure Rate, Shortlist-to-Offer Ratio and Time-to-Mentor/Staff.
20. **Streamlined student and recruiter experience:** Centralized profile, evidence, personalized learning, drive eligibility, recruiter requirements, shortlists, feedback, transparent communication and structured submissions.

## 4.2 Expected Outcome — PDF page 15

The expected outcome is a demonstrable AI-powered, evidence-based placement intelligence platform combining verified skill profiling, skill-gap analysis, AI-curated learning paths, automated campus hiring and trusted multi-tenant governance.

The solution should:
- Convert student evidence into dynamic verified skill profiles rather than static resumes.
- Keep profiles updated from evidence and connect them to live industry requirements.
- Use AI agents to assist profiling, eligibility and scheduling, while any action affecting candidacy requires T&P officer approval.
- Make every score and decision explainable and auditable.
- Provide a practical foundation for scaling from one college to a university and multiple colleges.
- Deliver verified skill profiles, explainable decisions, human-controlled automation and fair, auditable outcomes.

## 4.3 Student Dashboard — PDF page 16

1. **Student Skill Profile:** One profile per student, populated from GitHub, LeetCode, projects, certificates and similar evidence. Explicitly show evidence and provenance.
2. **Safe Code Import:** Student permission is required; read-only; student may withdraw at any time. Other evidence uploads are accepted.
3. **Skill Proof Check:** Each skill has a status. No proof = Claimed; evidence found can progress through the evidence/verification states. Old proof expires and the student must refresh it. The complete five-state model from page 14 must be represented.
4. **Target Companies + Skill Match:** Show suitable target companies and gaps between student skills and company requirements.
5. **Mock Drive + Personal Report:** Three rounds: aptitude (30 questions), machine test (2 coding questions, 10 marks each), and interview questions generated for the chosen role. After the drive, provide per-round scores, weak topics and where marks were lost.
6. **Personal Learning Path:** Roadmap based on mock-drive results and skill gaps; tasks and projects that create new proof. The student can add new proof and retake a mock.
7. **My Drives + Eligibility:** Show upcoming drives, eligibility and reasons. If not eligible, identify the failed rule and allow an appeal.
8. **My Privacy + Consent:** Student controls data sharing, can withdraw GitHub access and can see why each score was assigned in simple language.

## 4.4 Admin Dashboard — PDF pages 17–18

1. **Cohort Skill Dashboard + Reports:** Heatmap of weak skills across batch, branch and college. Include placement rate, skill coverage, gap closure, time-to-shortlist and offers. Download PDF/Excel. Show before-versus-after improvement.
2. **Industry Skill-Gap Profiler Agent:** Analyze job descriptions across technology roles, identify rising skills and compare them with cohort capabilities. Show evidence and source of demand. Example in the brief: Docker requested in 40% of new jobs while only 10% of the batch has it, leading to a Docker training suggestion.
3. **Predictive Placement Analytics Agent:** Forecast placement rate, skill coverage, gaps, students who may need support, learning progress and offer trends. Inputs may include mock scores, learning progress, CGPA and prior placement patterns. Example in the brief: forecast 65%, identify 45 students for support and suggest early mentoring. This is an example, not a target or a result to fabricate. Predictions need suitable historical data and validation; otherwise label output as illustrative or rule-based.
4. **Mock Drive Setup:** Officer manages question banks for aptitude and machine tests and reviews AI-generated interview questions per role.
5. **Bulk Mailing:** Send invitation email templates to companies in the campus database; track replies where the integration permits.
6. **Drive Management + Auto Allocation:** Calendar for company visits, slots, interviews and offers. Prevent clashes. The system may read company email, propose/select a slot and allocate a drive, but an officer confirms it.
7. **Eligibility Rules:** Officer sets rules for marks, backlogs and skills. Rules are versioned; the exact version used is saved so decisions are checkable and appealable.
8. **Recruiter Candidate Search:** Recruiters search by verified skills. Results explain why a student matched. No secret scores.
9. **AI Helps, Human Decides:** AI assists with profiling, checking, scheduling, interview-question generation and predictions. Officers approve/modify relevant actions. Do not label a student “at risk” or “failing” without human review. Log every AI action.
10. **Fairness Check:** Check selection results for disparities across gender, category and branch; flag issues for officer review.
11. **Accreditation Reporting Suite:** One-click NAAC/NIRF-oriented placement and career-outcome reports, such as placement counts, salary data, higher studies and branch-wise outcomes. Avoid claiming official approval or automatic compliance; make exports configurable and reviewable.
12. **Roles + College-Separate Data:** Keep each college's data separated. Support university, college, department and officer roles. Follow India's applicable data-protection requirements.

---

# 5. Product Architecture — Five Connected Engines

PRAMAAN should be designed as one coherent platform with five major engines and three role-based portals.

## Engine 1 — Evidence Engine

Responsibilities:
- GitHub repository connection and consent.
- Read-only ingestion and token management.
- Project, file, commit and test metadata.
- Additional evidence upload (certificates, project reports, assessment results, mentor attestations).
- Evidence provenance and integrity references.
- Language and framework detection.
- Repository import status and failure handling.

## Engine 2 — Verification Engine

Responsibilities:
- Skill claim selection.
- Evidence retrieval.
- Code archaeology and question anchors.
- Adaptive viva/defence.
- Practical tasks and executable probes.
- Structured rubric and transparent scoring.
- Human review, disputes and reassessment.
- Attestation issue/renewal/expiry.

## Engine 3 — Skill Intelligence Engine

Responsibilities:
- Skill taxonomy and mapping.
- Evidence-linked skill graph.
- Job-description requirement extraction.
- Student-role and cohort-role gap analysis.
- Learning path and evidence-sprint generation.
- Training prioritization using explainable inputs.

## Engine 4 — Placement Intelligence Engine

Responsibilities:
- Company and recruiter onboarding.
- Job roles and requirements.
- Candidate search and reason-coded matching.
- Versioned eligibility engine.
- Mock drives and question banks.
- Drive calendar, slot allocation and clash prevention.
- Applications, shortlists, interviews and offers.
- Bulk communication and response tracking where authorized.
- Placement analytics and reporting.

## Engine 5 — Trust, Fairness & Governance Engine

Responsibilities:
- Authentication, roles and scoped authorization.
- Organization and tenant isolation.
- Consent, withdrawal and deletion workflows.
- Privacy and retention controls.
- Explainability and evidence provenance.
- Tamper-evident audit logs.
- Fairness monitoring and human review.
- Agent/action logs and approvals.
- Appeals and dispute resolution.
- Security, abuse prevention and observability.

## Role-based portals

### Student Portal
- Overview/dashboard.
- Profile and academics.
- Projects and repositories.
- Skills and Skill Passport.
- Verification sessions.
- Mock drives and personal reports.
- Target companies and skill fit.
- Personalized learning/evidence sprints.
- Drives, eligibility, appeals and applications.
- Privacy, consent and data controls.

### TPO / Admin Portal
- Institution, departments, batches and student roster.
- Cohort skill dashboard and reports.
- Industry skill-gap profiler.
- Predictive placement analytics.
- Mock-drive setup and question bank.
- Bulk mailing and recruiter onboarding.
- Drive calendar and slot management.
- Eligibility rules and version history.
- Candidate search and shortlists.
- Fairness checks and review queue.
- Accreditation exports.
- Roles, permissions, tenant administration and audit logs.

### Recruiter Portal
- Company profile and recruiter roles.
- Job creation and role skill requirements.
- Candidate search and filters.
- Evidence-backed candidate profiles.
- Skill-level and match explanations.
- Assessment history and re-probe requests.
- Shortlists and interview stages.
- Feedback and offer tracking.

---

# 6. Proposed Technical Architecture

The stack below is a starting recommendation, not a fixed requirement. Claude should evaluate it against current documentation, deployment constraints, team experience, cost and security. Prefer a modular monolith over unnecessary microservices for the first release.

## 6.1 Suggested stack

| Layer | Initial recommendation | Notes |
|---|---|---|
| Frontend | Next.js + React + TypeScript | One application with role-gated student, TPO and recruiter surfaces |
| UI | Tailwind CSS + shadcn/ui or equivalent | Accessible, consistent design system |
| Backend | Node.js + Fastify or NestJS | Modular monolith with documented REST APIs/OpenAPI |
| Database | PostgreSQL | Relational data, audit events, tenant-aware design |
| Auth | Supabase Auth or another proven managed provider | Validate enterprise needs, MFA and SSO before choosing |
| Authorization | Server-side RBAC + PostgreSQL RLS where appropriate | Never rely only on hidden frontend routes |
| File storage | Private S3-compatible object storage | Signed URLs, retention and access policies |
| Jobs | Redis + BullMQ | Repo ingestion, analysis, notifications and report generation |
| Repository analysis | Git tooling + Tree-sitter | Start with JavaScript/TypeScript and Python |
| Skill taxonomy | Internal canonical skill IDs + mappings to ESCO/O*NET/NSQF | Preserve source, mapping confidence and taxonomy version |
| AI | Provider abstraction with schema-constrained outputs | Use different model tiers only after evaluation |
| Code execution | Judge0 for an initial controlled integration or a reviewed isolated runner | Production use requires a hardened threat model and independent review |
| Search | PostgreSQL full text initially; pgvector only if a measured need exists | Avoid adding vector search just for fashion |
| Monitoring | Sentry + structured logs; OpenTelemetry as maturity grows | No secrets or unnecessary PII in logs |
| Deployment | Managed frontend + containerized backend/worker + managed PostgreSQL | Keep staging and production separate |
| CI/CD | GitHub Actions or equivalent | Tests, type checks, migrations and deployment approvals |

## 6.2 Backend module boundaries

```text
PRAMAAN
├── auth
├── organizations
├── memberships-and-roles
├── students
├── academic-records
├── consent-and-privacy
├── github-integration
├── repositories-and-projects
├── evidence
├── skill-taxonomy
├── skill-graph
├── code-archaeology
├── verification-sessions
├── question-generation
├── code-probes
├── assessment-rubrics
├── attestations-and-passport
├── jobs-and-companies
├── skill-matching
├── eligibility-rules
├── mock-drives
├── drive-management
├── applications-and-offers
├── learning-paths
├── communications
├── cohort-analytics
├── predictive-analytics
├── fairness-and-review
├── accreditation-reports
└── audit-and-observability
```

## 6.3 Initial data model / entities

Plan the schema before implementation. Likely entities include:

- `organizations` — colleges, universities and companies.
- `organization_hierarchy` — university, college and department relationships.
- `users` — platform identities.
- `memberships` — user-to-organization membership and role.
- `students` — student profile and institutional references.
- `academic_records` — CGPA, backlogs, branch, year and source metadata.
- `consent_grants` — purpose, scope, timestamp, expiry and revocation.
- `connected_accounts` — GitHub integration metadata and encrypted token references.
- `repositories` — imported repository metadata and selected access scope.
- `projects` — student-facing project records.
- `commits` — selected commit metadata and references.
- `evidence_items` — code spans, tests, certificates, projects and other evidence.
- `skills` — canonical skill taxonomy IDs and versions.
- `skill_mappings` — links among internal taxonomy, ESCO, O*NET and NSQF where appropriate.
- `skill_evidence` — relationship between a skill and its supporting evidence.
- `verification_sessions` — viva/practical assessment sessions.
- `verification_items` — questions, rubrics, anchors and response references.
- `probe_runs` — sandbox execution metadata and output summaries.
- `attestations` — capability records, status and expiry.
- `jobs` / `job_roles` — company opportunities.
- `job_skills` — required skills, levels and importance.
- `eligibility_rule_sets` — versioned rules.
- `eligibility_decisions` — inputs, rule version, result and reason codes.
- `drives` — placement drives.
- `drive_rounds` — assessments and interview stages.
- `applications` — student participation and status.
- `mock_assessments` / `assessment_results` — mock-drive data.
- `learning_paths` / `learning_tasks` — personalized intervention plans.
- `interviews` / `offers` — recruitment outcomes.
- `communications` — email invitations, delivery and reply metadata where supported.
- `fairness_reviews` — cohort-level disparity indicators and human review status.
- `audit_events` — append-only record of sensitive actions, decisions and agent activity.

This is a conceptual entity inventory, not a final schema. Avoid duplicating student identity across tenants. Define data ownership, retention and access boundaries explicitly.

## 6.4 Architecture principles

1. Begin with a modular monolith.
2. Use explicit API contracts and typed request/response schemas.
3. Keep business rules deterministic and versioned where decisions must be reproducible.
4. Keep AI outputs structured, validated and reviewable.
5. Use background jobs for repository ingestion and expensive analysis.
6. Store evidence references and provenance separately from generated summaries.
7. Do not store raw repository contents longer than necessary; minimize copied code and respect licenses.
8. Use read-only, least-privilege repository access.
9. Enforce tenant boundaries at the backend and database layers.
10. Make all candidate-impacting decisions explainable and subject to human oversight.
11. Keep demo/synthetic data visibly separate from real student and company data.
12. Add operational monitoring, backup and recovery plans before a real pilot.

---

# 7. AI and Agentic System Design

The official statement asks for an agentic platform, but we should not add autonomous agents to every module. Use bounded agents or workflows only where they provide measurable value.

## 7.1 What should be deterministic?

- Repository and syntax parsing.
- Evidence-anchor validation.
- Skill-status transitions.
- Eligibility rules.
- Rule-version recording.
- Assessment timing and marks calculation.
- Calendar clash detection.
- Permission and access checks.
- Audit logging.
- Report arithmetic.
- Code execution and test result capture.

## 7.2 Where should AI be used?

- Suggest candidate skills from code evidence.
- Generate code-grounded viva questions.
- Generate adaptive follow-up questions within a bounded assessment.
- Summarize answers against a fixed rubric, with evidence spans.
- Extract skill requirements from job descriptions.
- Explain a skill gap in plain language.
- Suggest evidence-producing learning tasks.
- Analyze industry skill demand from approved job-posting sources.
- Draft interview questions for officer review.
- Support cohort-level narrative insights.

## 7.3 Bounded agent workflows

Potential bounded agents:

1. **Repository Profiling Agent:** Retrieves approved evidence, proposes candidate capabilities and records each source.
2. **Defence Agent:** Retrieves allowed code evidence, asks grounded questions and invokes a strictly allowlisted probe tool. It has no write access to the repository or student account.
3. **Industry Skill-Gap Agent:** Processes permitted job descriptions, identifies recurring skills and shows source links and confidence/coverage.
4. **Learning Path Agent:** Suggests a sequence of tasks that produce new evidence for a selected role.
5. **Placement Coordination Agent:** Suggests schedule slots, checks clashes and drafts communications. Officer confirms actions.
6. **Predictive Analytics Agent:** Produces decision-support summaries only when sufficient historical data exists; no student-impacting action without officer review.

## 7.4 AI reliability controls

- Require strict JSON schemas for model responses.
- Validate every code/file/commit anchor before showing a question.
- Reject or flag unanswerable, vague or unsupported questions.
- Ask the model to cite the exact evidence span supporting an assessment point.
- Separate source evidence from model interpretation.
- Use confidence thresholds only after a validation study; otherwise show qualitative states.
- Human review for disputed, low-evidence or high-impact results.
- Log model, prompt/rubric version, input references and output for audit, while minimizing personal data.
- Treat repository text, comments, README files and commit messages as untrusted data (prompt-injection risk).
- Do not allow models to run arbitrary shell commands or access unrestricted network resources.
- Never automatically reject a candidate based on an AI score.
- Provide accessible text-based assessments and accommodations where appropriate.

---

# 8. Data and Integration Strategy

## 8.1 Data that can potentially be used early

- Student-selected public GitHub repositories accessed within GitHub's policies and permissions.
- Student-provided projects and documentation.
- Student-submitted certificates and portfolio artifacts.
- Student-authorized LeetCode or other assessment records, subject to actual API/access terms; do not scrape where prohibited.
- Public job descriptions or approved job-posting APIs, subject to their licensing and terms.
- Public skill taxonomies such as ESCO and O*NET, mapped carefully to NSQF and Indian role requirements.
- Public institutional data, only where the source and usage rights are clear.

## 8.2 Data requiring permission or partnership

- Student roster, branch, CGPA and backlog from college ERP/SIS.
- Historical placement, offer, salary and higher-studies outcomes.
- Recruiter shortlist, interview and offer outcomes.
- Private repository data.
- Recorded defence sessions and transcripts.
- Employer feedback and later job-performance outcomes.

## 8.3 Synthetic data policy

Synthetic data may be used to demonstrate workflows and test edge cases. It must:
- Be marked `SYNTHETIC DEMO DATA` in the UI and data records.
- Never be presented as real institutional or recruiter information.
- Be generated with realistic but fictional values.
- Be isolated from real student records.
- Be excluded from real-world performance or accuracy claims.

## 8.4 GitHub integration requirements

- Use an official GitHub App or appropriately scoped OAuth integration.
- Prefer selected-repository, read-only access.
- Request only permissions necessary for the feature.
- Encrypt tokens and rotate/revoke them safely.
- Do not store tokens in browser local storage.
- Respect rate limits and GitHub terms.
- Allow disconnection and data deletion.
- Record imported repository, scope, timestamp and consent reference.
- Handle private and public repositories differently and transparently.
- Do not train models on student code without explicit, separate opt-in.

## 8.5 Integration principles

Start with CSV import/export and well-documented APIs. Add college SSO, ERP, ATS, email/calendar and credential integrations only after a real partner asks for them and the security/terms are understood.

---

# 9. MVP Scope and Prioritization

We have two related but distinct deliverables: the QUASAR demonstration and the longer-term product.

## 9.1 QUASAR demonstrable MVP — must work end-to-end

Priority A — core standout workflow:
1. Student login and basic profile.
2. Consent and GitHub repository connection or a clearly labelled manual import fallback.
3. Ingest a real, permissioned JavaScript/TypeScript or Python repository.
4. Generate project/file/commit evidence.
5. Show candidate skills with supporting evidence anchors.
6. Generate at least a small set of validated, repository-grounded questions.
7. Conduct a live text-based defence (voice can be added if reliable).
8. Run at least one or more safe, controlled executable probes on a deliberately supported project type.
9. Produce a transparent skill result and evidence-backed passport card.
10. Allow a recruiter/demo account to inspect a skill record and request a fresh re-probe with student consent.

Priority B — mandatory platform coverage:
11. Student profile and evidence page.
12. Skill status and skill graph representation.
13. Target-company/role skill matching with reason codes.
14. Mock-drive setup and the specified 3-round structure.
15. Personal report and evidence-producing learning path.
16. TPO cohort skills dashboard and industry skill-gap view.
17. Eligibility rules with version, reasons and appeal path.
18. Drive calendar and basic shortlisting workflow.
19. Recruiter candidate search and company role requirements.
20. Basic fairness review and human approval workflow.
21. Audit log of relevant AI actions and decisions.
22. Consent revocation and data deletion workflow.
23. Multi-tenant/role separation demonstrated with at least two demo organizations or test tenants.
24. PDF/CSV/Excel report export for the specified placement indicators, with honest data labels.

For any mandatory feature that cannot be deeply implemented in the competition timeframe, build a real, narrowly scoped vertical slice and clearly disclose the limitation. Do not show dead buttons or pretend that a mock flow is a live integration.

## 9.2 Real pilot — next stage

- One college and a defined department/cohort.
- 20–50 volunteer students as an initial validation group (target to be adjusted after recruitment).
- Permissioned repository ingestion and privacy notice.
- Assessment benchmark with human-reviewed outcomes.
- Student dispute and reassessment flow.
- TPO role setup, roster import and eligibility rule review.
- Recruiter feedback on evidence usefulness.
- Secure deployment, backups and monitoring.
- Security assessment of code sandbox.
- Documented data retention, deletion and incident response.

## 9.3 Later product roadmap

- More programming languages and project types.
- Design, electronics, research and non-code portfolios.
- College SSO and ERP integrations.
- ATS integrations and recruiter APIs.
- Multi-college and university administration.
- Better Indian-language accessibility.
- Credential standards/interoperability.
- Outcome-calibrated assessment models after sufficient consented longitudinal data.
- More advanced fairness analysis and institutional reporting.

## 9.4 Features not to prioritize initially

- Generic chatbot that merely answers placement FAQs.
- Resume builder or resume keyword score.
- AI-code detector that accuses students of cheating.
- Course marketplace/LMS.
- Blockchain for marketing purposes.
- Unbounded autonomous agents.
- Broad scraping of private or third-party data.
- Automated rejection or opaque ranking.
- A large number of integrations before validating the core workflow.

---

# 10. Development Roadmap

The roadmap below is an indicative six-to-eight-week programme for a serious first release, assuming a small team and regular development time. It is not a promise that a production-grade enterprise system can be completed in eight weeks. The QUASAR event date and exact build window must be used to create a separate competition sprint plan.

## Phase 0 — Product discovery and scope freeze (Days 1–2)

Deliverables:
- Product Requirements Document.
- Official requirement traceability matrix.
- Student, TPO and recruiter user journeys.
- Differentiator/novelty statement.
- MVP scope and explicit non-goals.
- Initial threat model and data classification.
- Architecture decision record.
- Development backlog and ownership.

Exit criteria:
- Every official requirement mapped to a planned feature and acceptance test.
- Team agrees on the first end-to-end workflow.
- No unresolved ambiguity about what is demo data versus real data.

## Phase 1 — Platform foundation (Week 1)

Build:
- Repository and CI setup.
- Frontend application shell and design system.
- Authentication and role-based access.
- Organization/tenant model.
- PostgreSQL schema and migrations.
- Student profile.
- Consent and permissions foundation.
- API contracts and seed data.

Exit criteria:
- Student, officer and recruiter can sign in to the correct role experience.
- Tenant isolation tests pass.
- Basic profile and consent flows work.

## Phase 2 — Evidence and Code Archaeology (Week 2)

Build:
- GitHub App/OAuth integration with minimum read-only scope.
- Repository selection and import status.
- File tree and language detection.
- Commit and diff processing.
- Tree-sitter or other parser for initial supported languages.
- Candidate skill extraction/mapping.
- Evidence anchors and provenance display.
- Manual artifact upload fallback.

Exit criteria:
- A permissioned real repository can be imported.
- The system creates evidence-linked candidate skills with resolvable file/commit references.
- Import failures are handled without corrupting the profile.

## Phase 3 — Executable Verification (Weeks 3–4)

Build:
- Evidence-grounded question generation.
- Anchor and answerability validator.
- Text-based adaptive defence.
- Structured assessment rubric.
- Controlled code-probe interface.
- Sandbox integration and execution limits.
- Results and transcript/evidence references.
- Human review, appeal and reassessment path.
- Skill Passport/attestation creation.

Exit criteria:
- A real repository can produce a small assessment set with valid evidence anchors.
- A student can complete a defence and a practical probe.
- The resulting skill record explains what was assessed and what evidence supports the result.
- Unsupported or uncertain cases are labelled as insufficient evidence, not falsely verified.

## Phase 4 — Complete role-based portals and placement workflows (Weeks 4–5)

Build:
- Student dashboard and learning path.
- TPO dashboard, cohort skill heatmap and reports.
- Recruiter/company dashboard.
- Job role creation and skill requirements.
- Evidence-based matching and reason codes.
- Versioned eligibility rules and appeals.
- Mock drives and question bank.
- Drive calendar, applications and offer tracking.
- Bulk communication in a safe demo/pilot mode.

Exit criteria:
- Student-to-recruiter journey works end-to-end.
- Officer approval is required for actions affecting candidacy.
- Eligibility decisions can be reproduced from the saved rule version and inputs.

## Phase 5 — Governance, analytics and reporting (Week 6)

Build:
- Audit trail and agent/action logs.
- Fairness monitoring and review queue.
- Role/tenant access hardening.
- Data export and accreditation report templates.
- Cohort gap analysis and industry-demand view.
- Predictive analytics only where historical data supports them; otherwise label outputs as rule-based/illustrative.
- Consent withdrawal and deletion tests.

Exit criteria:
- Sensitive actions are logged.
- Fairness indicators explain what was compared and what they cannot conclude.
- Reports are reproducible and identify data coverage/limitations.

## Phase 6 — QA, pilot preparation and competition polish (Weeks 7–8)

Build/test:
- End-to-end tests for all priority workflows.
- Security testing and dependency scanning.
- Sandbox isolation test plan and review.
- Performance and failure testing.
- Backup/restore validation.
- Accessibility and responsive UI review.
- Demo environment reset and seed-data script.
- User guide and admin guide.
- API documentation.
- Pilot onboarding pack and feedback forms.
- Final QUASAR demonstration and presentation.

Exit criteria:
- No critical security or data-isolation issue in the tested scope.
- Core demo can be reproduced from a clean environment.
- All limitations are disclosed.
- Volunteer users can complete the core flow without developer intervention.

---

# 11. QUASAR Competition Strategy

## 11.1 Two objectives

1. **Breadth:** Cover the official requirements across student, admin and recruiter experiences.
2. **Depth:** Demonstrate a standout innovation that works live and can withstand technical questions.

A dashboard-only solution will look generic. A brilliant code-viva demo that ignores the official placement workflows will look incomplete. We need both.

## 11.2 Recommended demo narrative

Tell one continuous story: **Student → Evidence → Verification → Skill Passport → Company → Hiring.**

Suggested live sequence:

1. **Real evidence:** A volunteer student connects a selected GitHub repository with permission.
2. **Code intelligence:** PRAMAAN shows repository structure, relevant commits and candidate skills with visible evidence references.
3. **Grounded question:** The system generates a question linked to an actual file, commit or code section.
4. **Live defence:** The student explains the implementation and answers a follow-up question.
5. **Executable proof:** The student predicts program behaviour or makes a small modification; the isolated runner displays the actual test result.
6. **Skill Passport:** A transparent, dated skill record is created with evidence and assessment details.
7. **Recruiter experience:** A recruiter creates or opens a role, sees reason-coded matches and inspects the evidence.
8. **Re-probe:** The recruiter requests a fresh challenge with student consent.
9. **TPO experience:** Show cohort skill gaps, one learning intervention, an eligibility decision with rule version and the fairness/review view.
10. **Governance:** Demonstrate consent withdrawal, audit trail and tenant separation where possible.

## 11.3 Demo reliability

- Use at least one real student-owned repository and a volunteer willing to participate.
- Pre-cache permitted repository metadata to reduce network uncertainty, but visibly identify cached/preloaded data.
- Have a second repository as fallback.
- If live GitHub access fails, use a clearly labelled recorded or pre-imported sample; never pretend it is live.
- If sandbox execution fails, show a clear failure state and do not mark the probe as passed.
- Keep synthetic student, company, academic and placement information visibly labelled.
- Prepare a reset script and a demo walkthrough.
- Show one failure or “insufficient evidence” case to demonstrate integrity.

## 11.4 Suggested pitch structure

1. The problem: student claims and placement workflows lack trusted, actionable evidence.
2. Who is affected: students, TPOs and recruiters.
3. Why current workflows are insufficient: resumes, self-declared skills and disconnected assessment/placement tools.
4. PRAMAAN product vision.
5. Three innovation pillars.
6. End-to-end live demo.
7. Official requirement coverage.
8. Architecture and AI governance.
9. Data, privacy, fairness and human oversight.
10. Pilot plan, impact measurement and business model.
11. Roadmap and closing vision.

## 11.5 Judge-facing principles

- Do not say “first-ever,” “100% accurate,” “fraud-proof,” or “guaranteed placement” without proof.
- Do not claim that GitHub commit history proves authorship.
- Do not claim that the AI detects whether code was written by AI.
- Do not call a confidence score accuracy.
- Explain which data is real, synthetic, public, permissioned or unavailable.
- Explain why the system needs AI and which tasks remain deterministic.
- Explain how human approval, student appeals and fairness review work.
- Show the technical differentiator instead of spending the entire presentation on dashboards.

---

# 12. Suggested Team Structure and Workflow

This is a suggested structure for a four-person engineering team. Adjust names and ownership to match the actual team.

| Role | Primary responsibility | Secondary responsibility |
|---|---|---|
| Technical lead / integration | Architecture, backend contracts, database, security decisions and integration | Core verification engine and release coordination |
| Frontend developer A | Student portal and shared UI components | Responsive design and accessibility |
| Backend/AI developer | GitHub ingestion, code analysis, question generation and execution integration | Evidence and attestation workflows |
| Frontend/full-stack developer B | TPO and recruiter portals, placement workflow and analytics | Reports and test coverage |

## Team engineering rules

- One Git repository and agreed branch strategy.
- Shared API contracts before parallel frontend/backend implementation.
- One owner for schema/migrations.
- Feature branches and pull-request reviews.
- TypeScript types shared between frontend and backend where practical.
- Environment variables for secrets; never commit keys or tokens.
- Separate local, staging and production environments.
- CI checks for linting, type checking, unit tests and build.
- Every feature must have acceptance criteria and a test.
- No one should silently change shared database fields or API response formats.
- Integrate daily or at agreed short intervals; do not wait until the end.

---

# 13. Success Metrics and Evaluation Plan

We need to measure product behaviour rather than invent impressive results.

## 13.1 Evidence and verification metrics

- Repository import success rate.
- Percentage of generated questions whose evidence anchors resolve correctly.
- Human reviewer rating of question relevance and answerability.
- Agreement between system rubric and independent human reviewers.
- Practical probe completion and pass rates.
- False-negative rate on genuine contributors/understanders.
- Rate of insufficient-evidence decisions and appeals.
- Student completion and abandonment rates.

## 13.2 Student and learning metrics

- Percentage of profile skills with linked evidence.
- Number of skill gaps identified against a selected role.
- Completion of recommended evidence tasks.
- New evidence added after learning tasks.
- Mock-drive participation and score changes.

## 13.3 College and recruiter metrics

- Time to produce a cohort skill report.
- Eligibility decision reproducibility.
- Time to shortlist a defined number of candidates.
- Recruiter use of evidence views and re-probes.
- Shortlist-to-interview and interview-to-offer ratios, where real outcome data is available.
- Skill Gap Closure Rate.
- Verified Skill Coverage.
- Placement Rate and reporting completeness.

## 13.4 Fairness and trust metrics

- Differences in assessment outcomes across language preferences and relevant demographic groups, where collection and analysis are lawful and appropriate.
- Appeal and overturn rate.
- False-negative rate for genuine ability.
- Consent withdrawal completion time.
- Data deletion completion and verification.
- Unauthorized cross-tenant access test results.
- AI question-anchor failure rate.
- Human approval compliance for candidate-impacting actions.

Any numeric target must be labelled as a proposed target until measured. Do not use synthetic-data results to claim real placement impact.

---

# 14. Production Readiness: What “Ready for Companies” Actually Means

The ambition is to make PRAMAAN usable by companies and colleges. That requires more than a successful hackathon presentation.

Before onboarding a real institution or recruiter, evaluate at least the following gates.

## Gate A — Product and workflow
- Real user roles and permission matrix.
- Complete onboarding and account recovery.
- Documented candidate and recruiter workflows.
- Data import/export and error handling.
- Student support, appeals and reassessment.

## Gate B — Security
- Threat model and security review.
- Strong authentication and session handling.
- Backend authorization and tenant isolation tests.
- Encrypted secrets and tokens.
- Rate limits, abuse prevention and secure file handling.
- Dependency and container scanning.
- Sandbox isolation validation by a competent reviewer.
- Incident response and breach procedures.

## Gate C — Privacy and compliance
- Clear privacy notice and purpose limitation.
- Granular consent and withdrawal.
- Retention schedule and deletion workflow.
- Access/correction/grievance process.
- Special care for minors and any applicable parental-consent obligations.
- Student control over recruiter visibility and optional recording.
- Institutional data-processing terms and role responsibilities.
- Legal review of applicable Indian data-protection, education and employment requirements.

## Gate D — AI and assessment validity
- Documented rubrics and model versions.
- Benchmark with known ground truth and human labels.
- Performance across programming languages and student backgrounds.
- Question validity and answerability checks.
- Fairness and accessibility review.
- Human appeal and error-correction process.
- No unsupported accuracy claims.

## Gate E — Reliability and operations
- Monitoring, alerting and error reporting.
- Database backups and tested restore.
- Queue retry/dead-letter handling.
- Deployment rollback procedure.
- Load and performance tests.
- Cost monitoring for model calls and sandbox execution.
- Support documentation, onboarding and admin controls.

Only after relevant gates are passed should we call a release pilot-ready or production-ready. A limited pilot can have a narrower scope, but the limitations must be explicit and agreed with the pilot institution.

---

# 15. Risks, Unknowns and Open Decisions

Claude must challenge these rather than assume they are solved.

1. **Competitor differentiation:** Repository analysis, GitHub profiles and AI viva/assessment products already exist. Research exactly what is different about our combination and avoid unsupported “no competitor does this” claims.
2. **Assessment validity:** Can a short defence measure a skill reliably? Which tasks are objectively testable? How do we minimize false negatives?
3. **Authorship vs understanding:** What can we honestly infer from commits, project history, viva responses and code probes?
4. **Code sandbox security:** How do we safely execute untrusted student code? Is a managed judge API sufficient for a prototype? What is required for commercial deployment?
5. **Prompt injection:** Student-controlled code, comments and documentation can contain malicious instructions.
6. **Repository licensing:** What code excerpts or derived evidence may be displayed to recruiters? What happens with unlicensed repositories?
7. **GitHub permissions and API limits:** Which exact scopes are required? How do we implement revocation and deletion?
8. **College willingness to pay:** Validate who owns the budget, procurement cycle, pilot approval and required integrations.
9. **Recruiter adoption:** Recruiters may not want to learn a new portal. Can PRAMAAN fit into existing workflows through exports or integrations?
10. **Skill taxonomy mapping:** ESCO and O*NET are not automatically equivalent to Indian NSQF or every employer's requirements. How will mappings be maintained and reviewed?
11. **Predictive analytics:** Historical data may be unavailable or biased. What can be shown honestly before sufficient data exists?
12. **Fairness:** Which groups are measured, what is the lawful basis, which thresholds are appropriate and how are small sample sizes handled?
13. **Student anxiety and accessibility:** How can assessments be supportive, accessible and non-punitive?
14. **Skill expiry:** What evidence justifies expiry duration for each skill? Do not use arbitrary freshness periods without a policy.
15. **Model cost and latency:** What is the cost per assessment, and can it fit a college SaaS model?
16. **Competition time constraints:** The QUASAR event date, team size and available build time must determine the actual hackathon sprint. Do not assume the six-to-eight-week plan is the event deadline.

---

# 16. Immediate Next Deliverables

Before large-scale implementation, prepare these artifacts in this order:

1. **Final PRD:** Product goals, user personas, workflows, functional requirements, non-functional requirements, acceptance criteria and out-of-scope items.
2. **Official Requirement Traceability Matrix:** Every statement requirement → product module → demo status → test case → evidence/page reference.
3. **System Architecture Document:** Context diagram, module diagram, data flow, deployment, trust boundaries and major decisions.
4. **Database Design:** ERD, tenant strategy, access control, audit events, evidence and assessment models.
5. **API Contract:** Endpoints, request/response schemas, auth/permissions and error formats.
6. **Threat Model & Privacy Plan:** Data classification, threat scenarios, mitigations, retention and deletion.
7. **UX Sitemap and Wireframes:** Student, TPO, recruiter and admin experiences.
8. **MVP Backlog:** Prioritized stories with acceptance criteria and owners.
9. **Test Strategy:** Unit, integration, end-to-end, security, fairness and sandbox tests.
10. **QUASAR Demo Plan:** Script, live data, backup plan, reset process and judge Q&A.

Do not begin by generating the entire codebase. First resolve the product and architecture decisions, then implement in vertical slices.

---

# 17. Guidance for Claude Sonnet 5.5

The following prompt should be pasted into Claude Sonnet 5.5 after attaching:

1. The **complete official QUASAR problem-statement PDF**.
2. This Markdown file, **PRAMAAN_Product_Blueprint_and_Claude_Collaboration_Brief.md**.

Claude is being invited to act as a critical product and engineering collaborator. It should not blindly agree with this brief or rewrite the project into a different concept without a strong reason.

## COPY-PASTE PROMPT FOR CLAUDE SONNET 5.5

```text
# ROLE: PRAMAAN — Product Co-Founder, Principal Architect and QUASAR Strategy Collaborator

You are joining our team as a senior product co-founder, principal software architect, AI/ML architect, security reviewer, EdTech/placement-domain specialist and extremely strict QUASAR hackathon evaluator.

I have attached two files:

1. The complete official QUASAR problem-statement PDF.
2. PRAMAAN_Product_Blueprint_and_Claude_Collaboration_Brief.md — our current product vision, requirements summary, proposed differentiators, architecture, roadmap and competition strategy.

READ BOTH ATTACHMENTS CAREFULLY BEFORE MAKING RECOMMENDATIONS.

## 1. SMALL CONTEXT ABOUT QUASAR AND OUR DECISION

We are participating in QUASAR, an engineering innovation competition. The official PDF contains four domains, but our team has finalized the EdTech domain:

“Agentic Placement Intelligence Platform.”

We are NOT considering FinTech or the other domains any longer. Do not reopen domain selection unless you find a direct, serious contradiction with the official competition rules.

Our chosen product direction is PRAMAAN:

“An evidence-based placement intelligence platform that verifies and organizes student capabilities, identifies skill gaps, helps students produce new evidence, and connects students with colleges and recruiters through explainable, human-controlled placement workflows.”

Our working tagline is:
“Skills you can defend. Evidence recruiters can trust.”

We want two outcomes:

A. A strong QUASAR prototype that demonstrably satisfies the official problem statement and has a memorable, technically deep innovation.

B. A credible product foundation that can be piloted by a real college and used by real recruiting companies after the competition.

We understand that a hackathon prototype is not automatically a production-ready SaaS product. Help us plan both stages honestly.

## 2. THE CORE PRODUCT DIRECTION

The current proposal has five engines:

1. Evidence Engine — consent-based repository and project ingestion, provenance and skill evidence.
2. Verification Engine — code-grounded questions, adaptive viva/defence, safe practical probes and structured assessment.
3. Skill Intelligence Engine — skill graph, role matching, gap analysis and evidence-producing learning paths.
4. Placement Intelligence Engine — jobs, candidate search, eligibility, mock drives, calendars, shortlists, interviews and offers.
5. Trust, Fairness & Governance Engine — privacy, consent, tenant isolation, explainability, audit trail, fairness review, appeals and human approval.

Three proposed differentiators:

A. CODE ARCHAEOLOGY: Analyze a student-selected repository and its history to identify candidate technical capabilities and implementation decisions, with every claim linked to actual evidence such as files, code spans, commits or tests.

B. EXECUTABLE SKILL VERIFICATION: Ask questions grounded in that student's selected project, conduct an adaptive defence, ask the student to predict or modify code, and run safe probes in a restricted execution environment. Evaluate understanding and demonstrated capability, not whether a detector guesses that AI was used.

C. PORTABLE SKILL EVIDENCE PASSPORT: Create transparent, evidence-backed capability records with status, assessment method, date, expiry/freshness policy, provenance, sharing controls and recruiter-triggered re-probe where the student consents.

Important honesty principles:
- Commit history does not prove authorship.
- A viva does not prove who wrote every line; it assesses demonstrated understanding and ability to defend/modify the work.
- Do not build an AI-code detector or accuse students of cheating.
- Use “insufficient evidence” when results are inconclusive.
- Never invent accuracy or calibrated confidence values.
- Never automatically reject candidates; human approval is required for candidate-impacting actions.
- Treat code, README files, comments and commit messages as untrusted inputs that may contain prompt injection.

## 3. THE OFFICIAL PDF IS THE AUTHORITATIVE SPECIFICATION

The PDF must take precedence over the Markdown brief.

Carefully inspect the EdTech pages (PDF pages 14–19, subject to the document's actual page numbering) and extract every requirement, example, expected outcome, constraint and deliverable.

Build a complete Requirement Traceability Matrix with these columns:

- PDF page and section/heading
- Exact or faithful requirement statement
- Mandatory/expected/illustrative classification
- PRAMAAN module
- Planned feature
- Acceptance criteria
- Test case
- Planned QUASAR demo evidence
- Current status (not started / planned / implemented / tested / deferred)
- Any ambiguity or risk

Do not silently omit difficult requirements such as fairness, accreditation reporting, multi-tenancy, role hierarchy, drive automation, predictive analytics, bulk mailing, appeals, consent and audit logs.

If this Markdown brief has summarized a requirement incorrectly or incompletely, correct it and explain the correction.

## 4. YOUR FIRST TASK: CRITICALLY REVIEW THE CURRENT PLAN

Do not start coding yet.

Review the attached brief like a skeptical co-founder and principal architect.

Identify:
1. What is strong and should be retained?
2. What is vague, unrealistic, redundant or technically risky?
3. What does the official PDF require that this brief has missed?
4. Which proposed differentiators are actually differentiated, and which already exist in competitor products?
5. What is the smallest genuinely useful product that satisfies the statement?
6. What is the most impressive live innovation we can safely demonstrate?
7. Which features should be cut, simplified, postponed or integrated with existing tools?
8. What is needed for a college pilot versus what is needed for a commercial production release?
9. Which assumptions need customer interviews or proof-of-concept tests?
10. What could cause judges, a TPO or a recruiter to reject this product?

Do not flatter the idea. Be specific and critical. If you disagree with a design choice, give a better alternative and explain the trade-off.

## 5. RESEARCH AND VALIDATION

If web research is available, research current products, competitors, API documentation, relevant standards and applicable Indian privacy/data-protection requirements.

Prioritize primary sources:
- Official competitor product documentation and product pages.
- Official GitHub API and OAuth/App documentation.
- Official framework and execution-sandbox documentation.
- Official ESCO, O*NET and NSQF references.
- Official W3C Verifiable Credentials documentation if relevant.
- MeitY/official Government of India materials for privacy obligations.
- Relevant academic research for assessment validity and fairness.

Separate:
- Verified fact with source.
- Vendor claim.
- Research finding.
- Your inference.
- Assumption requiring validation.

Do not invent competitor limitations or claim “no one offers this” merely because you did not find a feature on a public page. Assess the exact differentiation and phrase novelty claims carefully.

## 6. PRODUCE THE FOLLOWING DELIVERABLES

### Deliverable A — Final Product Requirements Document (PRD)

Include:
- Product vision and goals.
- Primary users and buyer hypotheses.
- User journeys for students, TPO/admins and recruiters.
- Functional requirements.
- Non-functional requirements.
- Official QUASAR requirement traceability.
- Acceptance criteria.
- Scope and non-goals.
- MVP, pilot and production boundaries.

### Deliverable B — Product and UX Architecture

Provide:
- Sitemap for student, TPO/admin, recruiter and platform-admin portals.
- Main screens and key UI states.
- Navigation and workflows.
- Loading, error, empty, permission-denied and offline/unavailable states where relevant.
- Accessibility and responsive behavior.
- A consistent enterprise-grade visual direction.

### Deliverable C — Technical Architecture

Review the proposed stack: Next.js/React/TypeScript, Node.js/Fastify or NestJS, PostgreSQL, Supabase Auth or an equivalent provider, Redis/BullMQ, Tree-sitter, an LLM provider abstraction and a restricted code-execution service.

Do not accept it blindly. Recommend the simplest safe architecture that the team can build and maintain.

Include:
- System context diagram.
- Container/component architecture.
- Module boundaries.
- Data flow for repository ingestion, code analysis, assessment, attestation and recruiter verification.
- Tenant isolation model.
- API boundaries and contracts.
- Background jobs.
- Deployment environments.
- Observability, backup and recovery.
- Security trust boundaries.

Prefer a modular monolith initially. Do not introduce microservices, Kubernetes, Kafka or blockchain unless there is a proven requirement.

### Deliverable D — Database and API Design

Produce:
- ERD (Mermaid is acceptable).
- Main entities, relations and important fields.
- Tenant ownership and row-level access rules.
- Consent and revocation model.
- Evidence provenance model.
- Verification session and probe-result model.
- Skill attestation model and status transitions.
- Versioned eligibility-rule and decision model.
- Audit-event model.
- API endpoint catalogue with methods, auth scopes and request/response examples.

### Deliverable E — AI and Verification Design

Specify:
- What must be deterministic.
- What genuinely needs AI/LLM.
- Whether and where bounded agents are useful.
- How questions are grounded in code evidence.
- How evidence anchors are validated.
- How executable probes are generated, reviewed and run safely.
- Assessment rubrics and scoring policy.
- Human review, appeals and reassessment.
- Prompt-injection controls.
- Benchmark methodology and evaluation metrics.
- How to avoid bias against language, accent, disability or educational background.

Do not claim that commit analysis proves authorship. Design the product to measure demonstrated understanding and practical capability.

### Deliverable F — Security, Privacy and Governance Plan

Include:
- Threat model.
- GitHub least-privilege permissions and token lifecycle.
- Code sandbox isolation and abuse protection.
- Data classification and minimization.
- Consent, withdrawal, deletion and retention.
- Tenant isolation and RBAC.
- Student data sharing controls.
- Candidate-impacting human approval.
- Audit trail and explainability.
- Fairness review and appeals.
- Applicable Indian privacy/legal questions that require professional review.

### Deliverable G — Roadmap and Engineering Backlog

Create:
1. Competition demo plan based on the actual QUASAR date and team time available. If the date/time is not in the attachments, state the gap and provide a relative-day plan without inventing a deadline.
2. Six-to-eight-week indicative first-release plan, clearly labelled as an estimate.
3. College pilot plan.
4. Longer production-readiness roadmap.
5. Prioritized epics, user stories, owners/roles, dependencies and acceptance criteria.
6. A RACI or module-ownership proposal for a four-person student team, clearly marked as a suggested arrangement.

### Deliverable H — Demo and Judge Strategy

Design a coherent live story:
Student → Evidence → Verification → Skill Passport → Company → Hiring.

Include:
- Exact click-by-click demo flow.
- What data is real and what is synthetic.
- Live repository fallback.
- Sandbox failure fallback.
- One example of “insufficient evidence” to show integrity.
- Which official requirements are demonstrated in which screen.
- Technical and product questions judges may ask, with honest answers.
- What we must not claim without measurement.

### Deliverable I — Pilot and Commercial Validation

Define:
- First college pilot profile.
- First student cohort.
- Recruiter discovery/interview plan.
- Hypotheses to validate.
- Adoption metrics.
- Assessment validity metrics.
- Security/privacy readiness gates.
- Pilot success/stop criteria.
- A realistic business model to test, not an invented market-size claim.

## 7. PRIORITIZATION RULES

Use three labels throughout:

- **P0 — QUASAR-critical:** Must be demonstrated or clearly addressed to comply with the official statement.
- **P1 — Pilot-critical:** Needed for a controlled college/recruiter pilot.
- **P2 — Later:** Valuable but should not delay the initial product.

For every P0 feature, provide a minimum acceptance test. If the feature cannot be fully implemented in the competition window, propose a truthful, narrow vertical slice and disclose limitations.

The three standout innovation pillars should be implemented deeply, but they must not crowd out mandatory requirements.

## 8. TEAM AND COMMUNICATION STYLE

We are a student engineering team comfortable with modern JavaScript/TypeScript, React, Node.js, APIs and database-backed web applications. We want detailed, practical, buildable guidance.

Explain difficult concepts clearly. Do not overcomplicate the stack. Prefer working end-to-end slices over large amounts of disconnected scaffolding.

Do not generate the entire application codebase yet. First return the review and planning deliverables. After we approve the architecture and backlog, we will ask you to help implement modules one at a time.

When later writing code:
- Provide complete files or clearly scoped patches.
- State file paths.
- Include validation and error handling.
- Include tests.
- Explain environment variables without exposing secrets.
- Never invent credentials or API keys.
- Do not silently alter agreed API contracts or schema.

## 9. REQUIRED RESPONSE ORDER

Return your work in this order:

1. Executive assessment: what to keep, change and cut.
2. Verified extraction of all official EdTech requirements from the PDF.
3. Requirement Traceability Matrix.
4. Final PRD.
5. User journeys and UX sitemap.
6. Technical architecture and Mermaid diagrams.
7. Database ERD and API catalogue.
8. Code Archaeology and Verification Engine design.
9. AI/agent architecture and evaluation plan.
10. Security, privacy, fairness and governance plan.
11. P0/P1/P2 feature prioritization.
12. Competition timeline and demo script.
13. Six-to-eight-week roadmap and detailed backlog.
14. Pilot and production-readiness plan.
15. Open questions, assumptions and risks.

Finish with a concise list of the next 10 concrete actions our team should take.

Do not ask us questions before doing the work. Make clearly labelled assumptions where essential information is missing. Do not invent QUASAR dates, rules, criteria, APIs, competitor capabilities or measured results.

Our goal is not merely to produce a flashy hackathon demo. Our goal is to build a technically credible, genuinely useful product that satisfies QUASAR and has a realistic path to real college and company adoption.
```

---

# 18. Final Working Principles

1. The official QUASAR PDF is the source of truth for competition requirements.
2. PRAMAAN must satisfy the complete EdTech statement, not only its verification feature.
3. Code Archaeology, Executable Skill Verification and the Skill Evidence Passport are the proposed differentiators; validate their novelty instead of assuming it.
4. Real evidence is more important than impressive-looking AI output.
5. Every claim should link to evidence and have a clear status.
6. Every candidate-impacting decision must be explainable, reproducible where applicable and subject to human approval.
7. Students must retain meaningful control over their data and permissions.
8. Never mistake a commit history for proof of authorship.
9. Never invent accuracy, placement uplift, customer validation or market statistics.
10. Build a coherent end-to-end product, not disconnected pages.
11. Keep security, privacy, fairness, accessibility and auditability in the architecture from the start.
12. Separate competition demo, controlled pilot and production release requirements.
13. Use the simplest architecture that safely solves the problem.
14. Test with real students and recruiters as early as possible.
15. The ultimate measure is whether a student, placement officer or recruiter can genuinely use PRAMAAN to make a better-informed decision.

**End of brief.**
