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

---

## ADR-09: Deterministic Exact Code Anchor Verification & Immutable Content-Addressed Snapshots

- **Status:** Approved
- **Context:** Trusting live remote Git branches for verification creates non-deterministic results if repositories are force-pushed, renamed, or deleted. Furthermore, character-based line numbers can drift across operating system line endings (`\r\n` vs `\n`) or character encodings.
- **Decision:** Exact code anchors resolve strictly against immutable, content-addressed source snapshots retained at ingestion. Raw-byte SHA-256 integrity (`hashRawBytes`) is the non-negotiable authoritative gate. UTF-8 byte boundary verification rejects splits of multi-byte characters, and line-ending normalization differences are isolated to diagnostic reporting without overriding raw byte hash mismatch. Inline client snapshots are strictly prohibited from granting authoritative verification status (`UNTRUSTED_CLIENT_SNAPSHOT`).
- **Consequences:** Complete reproducibility of code evidence verification forever. Tampering with files or anchors immediately yields deterministic rejection. Zero dependence on remote repository availability post-ingestion.

---

## ADR-10: Defensive Snapshot Memory Isolation & Fail-Closed Consent Gates on Repository Evidence

- **Status:** Approved
- **Context:** Passing shared Buffer instances across service layers in memory risks accidental or adversarial mutation of retained source snapshots. Furthermore, unauthorized users (including placement officers or mentors) could attempt to trigger repository analysis or symbol parsing on student code without explicit consent.
- **Decision:** `InMemorySourceSnapshotStore` implements defensive buffer copying on both write and read (`Buffer.from(...)`). All snapshot operations and lookups are strictly tenant-scoped (`orgId`). Repository evidence resolution strictly enforces student ownership isolation (`context.userId === anchor.studentId` for students) and requires active purpose consent (`repo_verification`). If consent infrastructure is unavailable, resolution fails closed with `503 CONSENT_SERVICE_UNAVAILABLE`. Production snapshot storage strictly requires durable persistent storage; in-memory stores in production fail closed with `503 DURABLE_STORAGE_REQUIRED`.
- **Consequences:** In-memory snapshot corruption is physically impossible. Privacy regulations (DPDP Act) are enforced at the API route layer—no staff role can inspect or analyze student repositories without active consent.

---

## ADR-11: Strict Tenant Partitioning, Server-Controlled Ingestion Provenance & Compensating Rollback for Evidence Snapshots

- **Status:** Approved
- **Context:** An independent source review of P0-05 identified four potential architectural and security risks:
  1. `InMemorySourceSnapshotStore.getSnapshot()` and `getSnapshotByHash()` fell back to unscoped entries if a tenant-scoped lookup failed, risking cross-tenant data disclosure.
  2. Snapshot registration and parsing routes allowed placement officers or administrators to process student code without explicit student ownership or active DPDP consent.
  3. Authoritative provenance was toggled via a process-global Boolean (`trustedIngestionActive`), creating concurrency race conditions across tenants and requests.
  4. Snapshot registration stored data in memory before emitting audit logs; if audit logging failed, un-audited evidence snapshots persisted without rollback.
- **Decision:**
  1. **Strict Tenant Partitioning Without Fallback:** Completely removed unscoped fallback logic from `getSnapshot()` and `getSnapshotByHash()`. Tenant-scoped lookups (`orgId`) strictly return snapshots stored with that exact tenant ID. Unscoped lookups require explicit invocation with `orgId: undefined`.
  2. **Universal Student Ownership & DPDP Consent Gate:** All snapshot registrations and AST parsing requests require an identified `studentId` and active DPDP `repo_verification` consent. Students can only register snapshots for themselves (`studentId === context.userId`). Placement officers and administrators must provide `studentId` and verify active consent; missing or revoked consent fails closed with `422 CONSENT_REQUIRED_OR_REVOKED`. If consent services are unavailable, operations fail closed with `503 CONSENT_SERVICE_UNAVAILABLE`.
  3. **Diagnostic-Only AST Parsing:** Source code parsed via `/api/evidence/parse` outputs diagnostic AST representations marked `diagnosticOnly: true, authoritative: false, provenance: 'diagnostic_parser'`. It cannot be used to establish authoritative skill verification.
  4. **Server-Controlled Ingestion Provenance (`ITrustedIngestionStore`):** Replaced the mutable global flag with `ITrustedIngestionStore` and `InMemoryTrustedIngestionStore`. Authoritative status (`authoritative: true, provenance: 'trusted_ingestion_pipeline'`) is awarded strictly when a matching ingestion record `(orgId, repositoryId, commitSha, studentId)` exists on the server. Client-supplied snapshots remain permanently non-authoritative (`unverified_client_input`).
  5. **Compensating Rollback on Audit Failure:** In `AnchorService.registerSnapshot()`, newly inserted snapshots are tracked; if subsequent SHA-256 audit chaining throws an error, the newly inserted snapshot is immediately purged via `deleteSnapshot()` before failing closed (`SNAPSHOT_REGISTRATION_FAILED`), preserving audit-storage parity.
- **Consequences:** Fully eliminates cross-tenant disclosure vectors, multi-tenant race conditions, and un-consented repository parsing. Guarantees that evidence storage and audit ledgers remain strictly synchronized even under audit subsystem failures.

---

## ADR-12: Student-Level Snapshot Partitioning, Serialized Concurrent Registration, and File-Level Manifest Provenance Binding

- **Status:** Approved
- **Context:** Following the initial P0-05 corrective patch, an independent source review identified three remaining edge-case security and concurrency gaps:
  1. *Student-Level Snapshot Isolation:* Snapshots were partitioned by `orgId:repositoryId:commitSha:canonicalPath`. If two students in the same college submitted the same repository/commit/file, their snapshots shared storage keys. Furthermore, `AnchorResolver.resolve()` did not verify that snapshot student ownership matched anchor student ownership.
  2. *Concurrent Registration & Rollback Race Conditions:* Under concurrent registrations of the exact same snapshot identity, a race condition between `hasSnapshot()` and `saveSnapshot()` could cause one request's audit failure rollback to delete the snapshot successfully registered by a concurrent request. Swallowing rollback errors could also mask storage adapter failures.
  3. *Coarse-Grained Ingestion Provenance Binding:* `TrustedIngestionRecord` validated trusted ingestion at the repository/commit level rather than cryptographically binding individual files within the Git tree. A student could theoretically present a client-crafted snapshot for an unvetted file within an otherwise ingested commit.
- **Decision:**
  1. **Student-Level Partitioning & Cross-Student Isolation:** Extended snapshot lookup keys in `ISourceSnapshotStore` and `InMemorySourceSnapshotStore` to include `studentId`: `${orgId}:${studentId}:${repositoryId}:${commitSha}:${canonicalPath}` and content hash keys to `${orgId}:${studentId}:${hash}`. `AnchorResolver.resolve()` explicitly verifies that student anchors require a matching `snapshot.studentId`; missing student ownership fails closed with `STUDENT_OWNERSHIP_REQUIRED`, and cross-student mismatches fail closed with `STUDENT_OWNERSHIP_MISMATCH`. Cross-tenant mismatches fail closed with `CROSS_TENANT_ACCESS_REJECTED`.
  2. **Mutex-Serialized Registrations & Conditional Rollback:** `AnchorService` serializes registration attempts for identical snapshot keys using an in-memory promise-queue mutex (`runWithLock`). `deleteSnapshot` accepts `expectedSnapshotId` and executes conditional rollback: it only purges the stored snapshot if its stored ID matches the failed request's ID. Pre-existing snapshots (`wasAlreadyPresent === true`) are never rolled back. Rollback failures are never swallowed; they surface as `SNAPSHOT_REGISTRATION_FAILED_WITH_ROLLBACK_ERROR` with underlying error details preserved.
  3. **File-Level Trusted Ingestion Manifest Binding:** Extended `TrustedIngestionRecord` to include `treeSha: string` (40-char Git tree SHA) and `manifest: TrustedFileManifestEntry[]` (`filePath`, `blobSha`, `rawFileHash`, `byteSize`). Client registrations are permanently marked `provenance: 'unverified_client_input'` and `ingestionId: undefined`. Server-controlled P0-04 static ingestion calls `registerTrustedSnapshot()`. Authoritative resolution strictly requires that the target file exists in the server-verified ingestion manifest, matches the Git `blobSha`, and matches the `rawFileHash`.
- **Consequences:** Eliminates intra-tenant cross-student data leakage, guarantees race-free snapshot registration and safe audit rollback, and binds authoritative evidence provenance strictly to verified Git file manifests. P0-05 deterministic anchor resolver core is formally complete and frozen.


