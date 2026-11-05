# PRAMAAN — Architecture Decision Log (ADR)

**Format:** Michael Nygard ADR Template  
**Decision Authority:** Solo Developer Lead Engineer & Technical Product Partner  

---

## ADR-01: Modular Monolith with Isolated Sandbox Worker

- **Status:** Approved
- **Context:** The application requires multiple domains: identity, consent, code parsing, skill verification, eligibility, placement scheduling, fairness simulation, and reporting. Proposals in research reports recommended microservices with Kubernetes, gRPC, and Kafka.
- **Decision:** Build a single **Modular Monolith** using Fastify and TypeScript for the core API, coupled with a separate isolated runner service for sandboxed code execution. Module boundaries are strictly enforced via TypeScript packages (`packages/contracts`, `packages/domain`).
- **Consequences:** Eliminates distributed transaction failures, network latency, multi-repo synchronization friction, and deployment complexity for a solo developer. Retains hard isolation where it matters most: untrusted code execution.

---

## ADR-02: PostgreSQL Row-Level Security (RLS) for Multi-Tenancy

- **Status:** Approved
- **Context:** The QUASAR problem statement mandates college-level tenant isolation, university roll-ups, and student privacy. Application-layer filtering (`WHERE org_id = x`) is vulnerable to developer oversight. Separate databases per college add massive operational overhead.
- **Decision:** Enforce multi-tenancy at the PostgreSQL kernel layer using `ROW LEVEL SECURITY` with `FORCE ROW LEVEL SECURITY`. The application role runs under `NOBYPASSRLS`. All database sessions set transaction-local context (`SET LOCAL app.current_org_id = :org_id`).
- **Consequences:** Prevents data leaks across colleges even if an application SQL query misses an `org_id` filter. Requires automated RLS tests in CI to verify that cross-tenant queries return zero rows.

---

## ADR-03: Propose / Approve Pattern for AI Governance

- **Status:** Approved
- **Context:** Requirements specify "AI Helps, Human Decides" and mandate that no AI agent independently rejects candidates, marks skills verified, or allocates drive dates.
- **Decision:** AI services have read-only access to scoped evidence views and insert-only privileges on a `proposals` table. Consequential tables (`student_skills`, `eligibility_decisions`, `applications`, `offers`, `drives`) cannot be modified by AI worker roles. Consequential actions require explicit officer or student approval through an approval inbox.
- **Consequences:** Provides a permanent structural guarantee of human oversight. Creates an auditable record of all AI suggestions and subsequent officer actions.

---

## ADR-04: Defensive Schema Validation and Tool Allowlisting for LLM Security

- **Status:** Approved
- **Context:** Ingesting untrusted repositories, job descriptions, and emails introduces indirect prompt injection risks.
- **Decision:**
  1. No prompt delimiters are relied upon as security boundaries.
  2. All LLM calls require structured JSON output validated against strict Zod schemas.
  3. LLM agents have access only to explicitly allowlisted, read-only tools.
  4. Extracted outputs (e.g. skills, code spans) are validated by independent deterministic resolvers (Anchor Resolver, Canonical Taxonomy Resolver).
- **Consequences:** Prevents hallucinated or injected entities from corrupting domain state. If schema parsing or anchor validation fails, the proposal is rejected or escalated to human review.

---

## ADR-05: Live Mutation Probe on Extracted Pure Functions

- **Status:** Approved
- **Context:** Executing untrusted student repositories wholesale creates severe security risks (sandbox escape, malicious dependencies, arbitrary network calls) and high operational fragility (missing environment variables, complex build steps).
- **Decision:** Never execute an entire repository. The Code Archaeology engine extracts only identified pure functions and their explicit inputs/outputs. The Live Mutation Probe presents a targeted code modification challenge against a pre-authored, reviewed unit test harness running in an unprivileged container with zero network access and hard memory/time bounds.
- **Consequences:** Guarantees deterministic, fast (<2s) execution. Eliminates runtime dependencies on student build tooling. If the sandbox fails or times out, the system fails closed (preserves state, routes to faculty review).

---

## ADR-06: Five-State Deterministic Skill Model

- **Status:** Approved
- **Context:** Most platforms use arbitrary continuous "skill scores" (e.g. "87% Python") derived from black-box LLM estimations or commit counts.
- **Decision:** Skills transition deterministically across five discrete states:
  $$\text{Claimed} \rightarrow \text{Observed} \rightarrow \text{Evidence-Linked} \rightarrow \text{Verified} \rightarrow \text{Expired}$$
  Transitions are governed by explicit domain rules:
  - `Claimed`: Self-declared by student.
  - `Observed`: Detected via static code parsing or external profile import.
  - `Evidence-Linked`: Supported by an accepted code span or mentor-attested lab artifact.
  - `Verified`: Validated via passing Live Mutation Probe or qualified viva.
  - `Expired`: Automatically downgraded after validity period (e.g. 180 days).
- **Consequences:** Transparent, defensible, and explainable to recruiters. Eliminates ungrounded "confidence scores."

---

## ADR-07: Versioned Declarative Rules for Drive Eligibility

- **Status:** Approved
- **Context:** Campus placements typically rely on manual, error-prone spreadsheet filtering.
- **Decision:** Eligibility criteria are formulated as versioned, declarative JSON rules. When a drive's eligibility is evaluated, an immutable snapshot of student data and the exact rule version are recorded. A deterministic evaluator computes the pass/fail result with explicit reason codes.
- **Consequences:** Guarantees that any past eligibility decision is 100% reproducible and explainable. Enables instant What-If and Fairness simulation for new rule drafts before publishing.

---

## ADR-08: Purpose-Specific Consent Ledger and Instant Token Revocation

- **Status:** Approved
- **Context:** Compliance with India's Digital Personal Data Protection (DPDP) Act and international privacy standards requires consent to be granular, purpose-limited, and revokable.
- **Decision:** Consent is maintained as an append-only ledger in `consent_grants` with distinct purpose codes (`placement_ops`, `repo_verification`, `recruiter_sharing`, `analytics`). When a student revokes consent for a repository, all stored OAuth tokens are purged from the database and revoked upstream within the same HTTP request.
- **Consequences:** Prevents unauthorized data reuse. Demonstrates privacy-by-design to institutional auditors and accreditation bodies.

