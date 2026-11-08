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

---

## ADR-13: Registration Mutex Cleanup Guarantee, Mandatory Git Blob SHA for Trusted Provenance, and Write-Once Ingestion Record Immutability

- **Status:** Approved
- **Context:** An independent source review of commit `ca17be9` identified three remaining edge-case implementation gaps before formally freezing P0-05:
  1. *Registration Mutex Cleanup Memory Leak:* `AnchorService.runWithLock()` stored a chained promise created via `currentQueue.then(() => nextInQueue, () => nextInQueue)` in `registrationQueues`, but compared against `nextInQueue` in the `finally` block. Because `nextInQueue !== queuedPromise`, completed lock entries were never deleted from the map, resulting in unbounded memory accumulation.
  2. *Missing Git Blob SHA on Trusted Snapshots:* `SourceSnapshotSchema` allowed `blobSha` to be optional even for snapshots tagged `trusted_ingestion_pipeline`. A trusted snapshot lacking its blob SHA could bypass manifest blob verification.
  3. *Ingestion Record Mutability Risk:* `InMemoryTrustedIngestionStore.saveRecord()` unconditionally overwrote stored records via `Map.set()`, leaving ingestion records mutable in memory and vulnerable to race conditions or duplicate file paths in manifests.
- **Decision:**
  1. **Leak-Free Mutex Cleanup:** `runWithLock` assigns `queuedPromise` to a local variable and stores that exact reference in `registrationQueues.set(key, queuedPromise)`. In `finally`, `this.registrationQueues.get(key) === queuedPromise` is evaluated; if true, the key is cleanly removed from the map. When multiple requests queue for the same key, earlier requests leave the map intact for subsequent waiters until the queue is fully drained. Verified via `getRegistrationQueuesSize() === 0`.
  2. **Mandatory 40-Character Git Blob SHA for Trusted Provenance:**
     - `SourceSnapshotSchema` superRefine enforces that when `provenance === 'trusted_ingestion_pipeline'`, `blobSha` must be defined and match `/^[0-9a-fA-F]{40}$/`.
     - `AnchorService.registerTrustedSnapshot()` strictly rejects snapshots without a valid 40-character Git `blobSha` (`TRUSTED_SNAPSHOT_BLOB_SHA_REQUIRED`).
     - `AnchorService.resolveAnchor()` fails closed (`UNTRUSTED_CLIENT_SNAPSHOT`) if authoritative resolution is requested for a trusted snapshot lacking its Git `blobSha`.
     - Optional `blobSha` is preserved exclusively for non-authoritative client/legacy snapshots.
  3. **Write-Once Immutability for Ingestion Records:**
     - `InMemoryTrustedIngestionStore.saveRecord()` validates records against `TrustedIngestionRecordSchema`.
     - Manifest paths are canonicalized via `normalizeFilePath()`, and duplicate canonical file paths are rejected (`DUPLICATE_MANIFEST_PATH`). Manifest entries require non-negative `byteSize` metadata.
     - Saving an exact duplicate record is treated as an idempotent no-op.
     - Any attempt to replace an existing record with a different ingestion ID, tree SHA, owner, or manifest throws `IMMUTABLE_INGESTION_RECORD_MUTATION_REJECTED`.
     - `AnchorService.registerTrustedSnapshot()` verifies that snapshot `orgId`, `studentId`, `repositoryId`, `commitSha`, `filePath`, `blobSha`, and `rawFileHash` agree with the persisted server-controlled record and its manifest entry.
  4. **Explicit P0-04 Production Boundary:** The application composition root (`buildApp()`) will wire durable snapshot and trusted ingestion storage adapters under ticket P0-04. The current development configuration is not claimed to provide durable authoritative ingestion until P0-04 is implemented.
- **Consequences:** Eliminates memory leak vectors in concurrent registration, establishes cryptographic file-level Git blob binding for authoritative verification, and enforces strict write-once semantics for ingestion manifests. P0-05 deterministic anchor resolver core is formally frozen.

---

## ADR-14: Separation of Trusted Ingestion Record Creation from Snapshot Registration, Prior Consent Enforcement, and Audit-Failure Safety

- **Status:** Approved
- **Context:** An independent source review of commit `9b51ec2` identified that `AnchorService.registerTrustedSnapshot()` accepted a caller-supplied `TrustedIngestionRecord` and created it when no existing record was found. Schema validation and write-once semantics prove record structure and immutability, but not that GitHub actually supplied the commit, tree, and file blobs. Furthermore, consent checks were not strictly required before repository data retention, and audit logging failures in trusted registration could theoretically leave unaudited snapshots in memory.
- **Decision:**
  1. **Separation of Record Creation from Snapshot Registration:** `registerTrustedSnapshot` strictly requires an already-persisted `TrustedIngestionRecord` in `ITrustedIngestionStore` (`TRUSTED_INGESTION_RECORD_NOT_FOUND`). It never creates or mutates records from method arguments. A separate server-controlled ingestion process (P0-04) creates the trusted record only after GitHub commit/tree/blob verification succeeds.
  2. **Exhaustive Record Identity & Manifest Verification:** `registerTrustedSnapshot` compares the supplied record against the persisted record across all fields (`ingestionId`, `orgId`, `repositoryId`, `commitSha`, `treeSha`, `studentId`, `verifiedAt`, `provenance`, and complete manifest array with each entry's `filePath`, `blobSha`, `rawFileHash`, `byteSize`). Any mismatch fails closed (`INGESTION_RECORD_MISMATCH`).
  3. **Enforced Consent Prior to Ingestion & Persistence:** Before ingesting or persisting student repository data, `registerTrustedSnapshot` requires an available consent repository and verifies active, tenant-scoped student consent for `repo_verification`. Missing, revoked, or unavailable consent fails closed (`CONSENT_REQUIRED_OR_REVOKED`, `CONSENT_SERVICE_UNAVAILABLE`, `CONSENT_SERVICE_ERROR`) before any snapshot or record interaction.
  4. **Audit-Failure-Safe Compensating Rollback:** Registration is wrapped in the per-identity `runWithLock` mutex. If audit logging fails, newly stored snapshots are cleanly rolled back via conditional `deleteSnapshot` (using exact `snapshot.snapshotId`). Unaudited snapshots can never resolve as authoritative, while pre-existing snapshots (`wasAlreadyPresent === true`) are preserved intact.
- **Consequences:** Fully closes the trusted ingestion boundary before implementing P0-04. Establishes that client or untrusted callers cannot create trusted ingestion records, guarantees that consent precedes data retention, and ensures audit-storage parity.

---

## ADR-15: Explicit Registration Commit State Lifecycle and Fail-Closed Audit Quarantine

- **Status:** Approved
- **Context:** An independent source review of commit `fa19449` identified that if audit logging fails during `AnchorService.registerTrustedSnapshot()`, and the subsequent compensating rollback (`deleteSnapshot`) fails or returns `false` (e.g. disk failure, network timeout, adapter error), the newly stored snapshot remains in storage with `provenance: 'trusted_ingestion_pipeline'` and a valid `ingestionId`. Because `resolveAnchor()` previously only checked trusted provenance and manifest matching, an unaudited snapshot could theoretically be resolved authoritatively if physical rollback failed.
- **Decision:**
  1. **Explicit Registration Commit State Lifecycle:** Added `SnapshotRegistrationStateSchema` (`pending_audit`, `audit_committed`, `quarantined`) to `@pramaan/contracts` and `SourceSnapshot`.
  2. **Fail-Closed State Promotion:**
     - `registerTrustedSnapshot` stores the snapshot initially with `registrationState: 'pending_audit'`.
     - Only after `this.auditRepo.log()` succeeds is the state promoted to `audit_committed` using `updateRegistrationState` bound to `expectedSnapshotId`.
     - If `auditRepo.log()` fails, the snapshot state is immediately transitioned to `quarantined` before attempting `deleteSnapshot`.
     - Even if `deleteSnapshot` fails or throws an exception, the snapshot remains permanently in `quarantined` state in storage.
  3. **Strict Authoritative Gate in Resolver:** `AnchorService.resolveAnchor(..., { authoritative: true })` strictly enforces `snapshot.registrationState === 'audit_committed'`. Any snapshot in `pending_audit`, `quarantined`, or undefined state fails closed with `ANCHOR_INVALID` and `error: 'REGISTRATION_NOT_AUDIT_COMMITTED'`.
  4. **Pre-Existing Audit-Committed Snapshot Protection:** Duplicate registration requests for an already `audit_committed` snapshot are tracked with `wasAlreadyCommitted === true`. If the audit logging for the duplicate request fails, the existing snapshot is never downgraded, quarantined, or deleted.
  5. **Safe Reconciliation & Retry:** An interrupted or quarantined registration can be safely retried. When audit persistence succeeds on retry, the snapshot is promoted to `audit_committed` and becomes eligible for authoritative resolution.
  6. **P0-04 Prior Consent Enforcement Boundary:** P0-04 must verify active, tenant-scoped student consent for `repo_verification` before fetching repository content, retaining blobs, generating ingestion records, and registering snapshots.
- **Consequences:** Eliminates single point of failure in physical rollback. Guarantees that even with 100% compensating rollback failure, unaudited evidence can never be resolved authoritatively. P0-05 is completely hardened and frozen.

---

## ADR-16: Trusted Static GitHub Repository Ingestion Pipeline (P0-04)

- **Status:** Approved
- **Context:** P0-05 implemented exact code anchor resolution against content-addressed snapshots. However, activating authoritative verification in production required Milestone M2 Ticket P0-04: authenticating students via GitHub OAuth, fetching repository contents without executing code, verifying Git blob integrity against remote Git trees, enforcing DPDP consent prior to network calls, and persisting snapshots and manifests in durable PostgreSQL storage with RLS.
- **Decision:**
  1. **OAuth 2.0 with PKCE S256 Challenge:** Students initiate connections with a single-use cryptographic state and S256 code challenge. The state binds tenant (`orgId`), student (`studentId`), and redirect URI with a 10-minute expiry. Replays are strictly rejected.
  2. **AES-256-GCM Token Encryption at Rest:** GitHub access and refresh tokens are encrypted using authenticated AES-256-GCM (`v1:iv:tag:ciphertext`) with unique 12-byte IVs, 16-byte auth tags, and key versioning under `GITHUB_TOKEN_ENCRYPTION_KEY`. Missing or invalid keys fail closed in production (`503`). Plaintext tokens are NEVER logged, exposed to API responses, or leaked in error messages.
  3. **Fail-Closed Consent-Before-Fetch Boundary:** The ingestion engine verifies active DPDP `repo_verification` consent in `IConsentRepository` before making ANY GitHub API call. If consent is absent, revoked, or expired, exactly zero GitHub API calls are dispatched (`callCount === 0`). Consent is re-verified immediately prior to database persistence.
  4. **Static Ingestion & Truncated Tree Recovery:** Code is fetched exclusively via GitHub REST API without `git clone`, `npm install`, or child process execution. If the recursive tree response returns `truncated: true`, the engine falls back to deterministic iterative directory walking.
  5. **Strict File Filtering & Hard Limits:** Allows only source code files (`.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`). Rejects symlinks (`mode: '120000'`), submodules (`mode: '160000'`), binary files, vendor directories (`node_modules`, `dist`, `.git`), secret files (`.env*`, `*.pem`, `*.key`), and path traversals. Enforces strict limits: $\le 200$ files, $\le 512$ KB per file, and $\le 10$ MB total retained payload.
  6. **Cryptographic Git Object & Raw Hash Verification:** Raw bytes are formatted as Git objects (`blob ${byteLength}\0${rawBytes}`). The calculated Git blob SHA-1 must strictly match the remote tree entry SHA. Raw SHA-256 (`rawFileHash`) is computed and bound to the file manifest entry.
  7. **Write-Once Canonical Ingestion Manifests & Snapshots:** Stores immutable `TrustedIngestionRecord` before registering snapshots via `AnchorService.registerTrustedSnapshot()`. Snapshots progress from `pending_audit` to `audit_committed`.
  8. **Durable PostgreSQL Adapters & Migration 011:** Schema migration `011_trusted_repository_ingestion_and_snapshots.sql` adds `github_oauth_states`, `source_snapshots`, `trusted_ingestion_records`, and `ingestion_jobs` with RLS enabled and forced across all tables. Repositories `PgSourceSnapshotStore`, `PgTrustedIngestionStore`, `PgGitHubCredentialRepository`, and `PgIngestionJobRepository` implement multi-tenant tenant-transaction isolation under `app_api`.
  9. **Production Application Composition:** In `buildApp()` (`apps/api/src/app.ts`), production mode wires these durable PostgreSQL adapters and fails closed if in-memory adapters are configured.
- **Consequences:** Establishes complete end-to-end trusted static repository ingestion with zero untrusted code execution, cryptographic Git provenance, and durable PostgreSQL storage. P0-04 is completely verified and operational.

---

## ADR-17: Remediation of GitHub OAuth Scopes, Tenant State Isolation, Ingestion Resource Boundaries, Key Ring Versioning, and Callback Security

- **Status:** Approved
- **Context:** An independent security review of PR #2 identified gaps in authorization scopes, OAuth state tenant isolation, ingestion resource enforcement, cipher key validation/rotation, callback URI validation, and request lifecycle description.
- **Decision:**
  1. **GitHub Authorization Scope Hardening:** Discarded invalid scope token `repo:read`. Defined GitHub Apps with fine-grained read-only permissions (`contents:read`, `metadata:read`) as the primary production standard. Supported legacy OAuth App read-only scopes (`read:user`, `user:email`, `public_repo`), while emitting explicit warnings if monolithic `repo` scope is configured. Callback verifies granted scopes fail-closed with `INSUFFICIENT_GITHUB_PERMISSIONS` (403).
  2. **Tenant-Safe OAuth State Consumption:** State consumption executes inside `withTenantTransaction(context, ...)` under the restricted `app_api` role. PostgreSQL RLS policies on `github_oauth_states` physically prevent any cross-tenant state visibility. Consumption is atomic (`FOR UPDATE`) with immediate single-use invalidation (`used_at = CURRENT_TIMESTAMP`). Cross-tenant consumption attempts return null.
  3. **Strict Ingestion Limit Enforcement:** Production defaults are aligned with operational claims: 200 files maximum, 512 KB per file, 10 MB aggregate retained bytes. Entries with declared size > 512 KB in the Git tree are rejected prior to blob download. Undeclared blobs exceeding 512 KB are excluded post-download. Aggregate retained bytes exceeding 10 MB trigger `TOTAL_SIZE_LIMIT_EXCEEDED`. No oversized content is persisted, and all limit failures are durably recorded in `ingestion_jobs`.
  4. **Versioned AES-256-GCM Key Ring & Zero-Downtime Rotation:** Enhanced `AesGcmTokenCipher` with a versioned key ring (`Record<string, string>`) and active key versioning. Ciphertext format is `version:iv:tag:ciphertext`. Tokens encrypted under prior keys (e.g. `v1`) decrypt seamlessly while new tokens encrypt with `v2`. Unknown key versions fail closed (`UNKNOWN_KEY_VERSION`), and production mode strictly enforces 64-hex key formatting.
  5. **Fixed OAuth Callback URI & Host Header Protection:** The server enforces a canonical `GITHUB_OAUTH_REDIRECT_URI` and strict allowlist validation. Client-supplied `redirect_uri` outside the allowlist fails with 400 `INVALID_REDIRECT_URI`. Host headers (`req.headers.host`) and client parameters are never trusted. Production startup fails closed if GitHub credentials or redirect URIs are missing or placeholders.
  6. **Synchronous Request Lifecycle Documentation:** Accurately documented the request lifecycle as synchronous execution within HTTP timeout boundaries with durable relational tracking in `ingestion_jobs`, providing auditability, idempotent status polling via `GET /api/evidence/repositories/ingest/:id`, and the architectural foundation for a future decoupled daemon.
- **Consequences:** Eliminates OAuth scope confusion, closes cross-tenant OAuth state exposure, prevents DoS/zip-bomb attacks via pre-download tree size filtering, enables zero-downtime token key rotation, and secures OAuth callback redirection against spoofing.

---

## ADR-18: User ID vs Student ID Disambiguation, Browser OAuth Redirect Architecture, Delegated Connection Prohibition, and Canonical Repository Relational Records

- **Status:** Approved
- **Context:** An independent integration review of PR #2 identified four critical architectural issues and one capability constraint:
  1. *User ID vs Student ID Disambiguation:* `SessionContext.userId` represents `users.id`. In PostgreSQL schema migrations 003 and 011, foreign keys in `repositories`, `connected_accounts`, `github_oauth_states`, `source_snapshots`, `trusted_ingestion_records`, and `ingestion_jobs` reference `students(id)`. Code using `context.userId` directly as a student ID broke relational foreign key integrity.
  2. *Browser OAuth Redirect Architecture:* Browsers redirected from GitHub back to the server cannot send custom Authorization Bearer headers. An unauthenticated browser GET to `/api/integrations/github/callback` failed or required unauthenticated token exchange.
  3. *Prohibition of Delegated GitHub Connections:* Staff members (placement officers, platform admins) attempting to initiate OAuth on behalf of students would erroneously link staff GitHub identities to student records.
  4. *Canonical Repository Database Records:* The static ingestion engine generated unbacked random repository UUIDs on every ingestion, missing persistent repository records, consent grant linkage, and cross-student ownership verification.
  5. *Public-Repository-Only Scope (Option B):* Requesting broad `repo` write scopes for public repositories violated least privilege.
- **Decision:**
  1. **User ID vs Student ID Disambiguation:**
     - Extended `ITenantRepository`, `InMemoryTenantRepository`, and `PgTenantRepository` with `getStudentByUserId(context, userId)`.
     - In `apps/api/src/app.ts`, student endpoints resolve `student = await tenantRepo.getStudentByUserId(context, context.userId)` server-side.
     - Enforce that client-supplied `studentId` cannot override or substitute verified student identity (`FORBIDDEN_STUDENT_ACCESS`, 403).
     - Bound all database foreign keys in `repositories`, `connected_accounts`, `github_oauth_states`, `source_snapshots`, `trusted_ingestion_records`, and `ingestion_jobs` strictly to `students.id`.
     - Adapted `AnchorService.resolveAnchor` and `StaticRepoIngestionService` to respect canonical student profile identity while preserving frozen P0-05 resolver core.
  2. **Browser OAuth Redirect Architecture:**
     - Implemented dedicated client component page `apps/web/app/integrations/github/callback/page.tsx` wrapped in React `<Suspense>`.
     - `GET /api/integrations/github/callback` without Authorization header issues HTTP 302 Found redirect to `/integrations/github/callback?code=...&state=...`.
     - Frontend extracts code and state and issues authenticated `POST /api/integrations/github/callback` with Bearer JWT, executing PKCE verification, token exchange, credential encryption, and audit logging.
  3. **Prohibition of Delegated Connection:**
     - Only students (`context.role === 'student'`) may connect their GitHub account.
     - Officer and administrator attempts to initiate or complete connection fail closed with 403 `FORBIDDEN_DELEGATED_CONNECTION`.
  4. **Canonical Repository Relational Records:**
     - Implemented `IRepositoryRepository`, `InMemoryRepositoryRepository`, and `PgRepositoryRepository` backed by `repositories` table with `getOrCreateRepository`, `getRepositoryById`, and `findRepositoryByProviderId`.
     - Repository registration links `student_id`, `provider: 'github'`, `provider_repo_id`, `url`, `default_branch`, and verified `consent_grant_id`.
     - Idempotent re-ingestion returns the existing canonical `repositoryId`.
     - Cross-student repository ID substitution throws `CROSS_STUDENT_REPOSITORY_FORBIDDEN` (403). Cross-tenant lookup fails closed under PostgreSQL RLS (`REPOSITORY_NOT_FOUND`).
  5. **Public-Repository-Only Scope (Option B):**
     - Declared public-repository-only scope: default scopes set to `['read:user', 'public_repo']` space-separated per RFC 6749.
     - Broad `repo` write scope is excluded.
     - Ingestion of private repositories is rejected fail-closed with 400 `PRIVATE_REPOSITORY_NOT_SUPPORTED`.
- **Consequences:** Restores 100% relational foreign-key integrity in PostgreSQL, eliminates browser OAuth token leaks, prevents delegated identity misattribution, establishes canonical repository tracking, and enforces least-privilege OAuth scopes.

---

## 2026-11-09 — P0-04 Final Acceptance Hardening

- **Status:** Approved & Verified
- **Context:** Following the production integration review, four critical acceptance criteria were addressed before merging P0-04:
  1. *GitHub Authorization Scope Transparency:* Clarify that GitHub OAuth `public_repo` grants read/write per official specs; PRAMAAN application code strictly operates as read-only. Ensure callback requires both `read:user` and `public_repo` (or GitHub App permissions `contents:read` and `metadata:read`), rather than allowing `read:user` alone to grant repo ingestion.
  2. *Canonical Repository Concurrency Safety:* Prevent race conditions when simultaneous concurrent ingestion requests attempt to register the same repository. Ensure unique constraint exists on `(student_id, provider, provider_repo_id)` and `getOrCreateRepository` operates atomically via upsert. Re-link active consent grant when changed. Fail closed if repository repository is not configured.
  3. *Audit Actor Identity Preservation:* Ensure `actor_id` in audit events records authenticated user ID (`users.id`), whether student or officer, while snapshot and record ownership points to `students.id`. Satisfy frozen P0-05 resolver invariants without modifying frozen files.
  4. *Consent Revocation Retention Policy:* Define and enforce snapshot retention upon `repo_verification` consent revocation. Transition snapshots to `registration_state = 'quarantined'`, making them immediately inaccessible for authoritative resolution. Subsequent re-consent must not resurrect old quarantined snapshots.
  5. *Browser Callback Deployment Safeguards:* Validate `FRONTEND_URL` in production, guard against React StrictMode duplicate execution via `useRef`, scrub temporary parameters from browser history upon success, and handle GitHub error query parameters gracefully.
- **Decision:**
  1. **OAuth Scope Transparency & Verification:** Updated documentation and logs to accurately reflect that OAuth `public_repo` scope includes read and write capabilities on public repos per GitHub OAuth specs; PRAMAAN enforces strictly read-only access (commits, trees, blobs) in application logic. In `GitHubAccountService.handleOAuthCallback()`, enforce that both `read:user` and `public_repo` (or GitHub App permissions `contents:read` and `metadata:read`) must be granted. Under-scoped tokens fail closed with 403 `INSUFFICIENT_GITHUB_PERMISSIONS`. Private repo ingestion remains disabled (`PRIVATE_REPOSITORY_NOT_SUPPORTED`).
  2. **Schema Migration 012 & Atomic Upsert:** Created `db/migrations/012_canonical_repository_unique_constraint.sql` adding unique constraint `uq_repositories_student_provider_repo` on `(student_id, provider, provider_repo_id)` after deduplicating pre-existing rows. Implemented atomic upsert in `PgRepositoryRepository.getOrCreateRepository()` using `ON CONFLICT (student_id, provider, provider_repo_id) DO UPDATE SET url = EXCLUDED.url, default_branch = EXCLUDED.default_branch, consent_grant_id = EXCLUDED.consent_grant_id RETURNING ...`. Required `repositoryRepo` in `StaticRepoIngestionService`, failing closed with `REPOSITORY_REPOSITORY_REQUIRED`.
  3. **Preservation of Audit Actor Identity via `actorUserId`:** Added optional `actorUserId` to `SessionContextSchema` (`packages/contracts/src/auth.ts`). Updated `PgAuditRepository.logInTransaction` and `AuditService.log` to record `actorId = context.actorUserId ?? context.userId` (`users.id`). In `StaticRepoIngestionService`, passed `anchorContext = { ...context, userId: context.role === 'student' ? targetStudentId : context.userId, actorUserId: context.userId }`. Guaranteed that audit actor is `users.id` (satisfying audit FK to `users(id)`) and snapshot owner is `students.id`, while satisfying frozen `AnchorService` invariants without modifying frozen files.
  4. **Consent Revocation Snapshot Quarantine:** In `PgConsentRepository.revokeConsent()`, when `repo_verification` consent is revoked, atomically transitioned all student snapshots in `source_snapshots` to `registration_state = 'quarantined'`, rendering them immediately inaccessible for authoritative anchor resolution (`REGISTRATION_NOT_AUDIT_COMMITTED` / `CONSENT_REQUIRED_OR_REVOKED`). Ingestion jobs are marked failed (`CONSENT_REVOKED`), tokens purged, evidence withdrawn, and skills downgraded. Subsequent re-consent links canonical repositories to the new grant without resurrecting quarantined snapshots.
  5. **Browser Callback Hardening:** Next.js `/integrations/github/callback` page adds `useRef` guard to eliminate double-invocation under React StrictMode development, scrubs temporary `code` and `state` parameters from browser history upon success via `window.history.replaceState`, and explicitly handles GitHub authorization denial errors (`error=access_denied`). Fastify route validates `FRONTEND_URL` in production mode fail-closed.
- **Consequences:** Eliminates race conditions in canonical repository registration, preserves true audit actor identity across roles, strictly enforces data retention and quarantine on consent revocation, and ensures transparent, least-privilege GitHub authorization with zero regressions.

---

## ADR-19: Provider Revocation Abstraction, Active Consent Uniqueness (Migration 013), Safe Migration 014 Reconciliation, Bounded Tree Traversal, and Ingestion Job Cancellation

- **Status:** Approved & Verified
- **Context:** An independent backend reliability and consent lifecycle review identified five areas for remediation:
  1. *Genuine GitHub OAuth Revocation:* Previously, revocation was logged as `revoked_upstream` merely based on the presence of environment credentials without making an actual upstream HTTP call to GitHub's revocation endpoint.
  2. *Active Consent Uniqueness:* `consent_grants` previously allowed multiple active grants (`revoked_at IS NULL`) for the same student and purpose. Re-consent did not automatically transition previous grants to revoked history, and concurrent grants could race.
  3. *Safe Canonical Repository Reconciliation (Migration 014):* Migration 012 applied a unique constraint on `(student_id, provider, provider_repo_id)` by executing `DELETE FROM repositories r1 ... WHERE r1.id > r2.id`. In databases with dependent child records (`repo_snapshots`, `evidence_items`, `source_snapshots`, `trusted_ingestion_records`, `ingestion_jobs`), `ON DELETE CASCADE` would destroy student evidence.
  4. *Bounded Tree Traversal & Rate-Limit Handling:* Recursive tree fetching could traverse unbounded directory hierarchies or download unbounded files, risking memory exhaustion or infinite rate-limit retries.
  5. *Ingestion Job Transitions on Revocation:* When consent was revoked, running or queued ingestion jobs were not transitioned, risking post-revocation authoritative snapshot registration.
- **Decision:**
  1. **Genuine GitHub OAuth Grant Revocation:**
     - Added `revokeOAuthGrant(accessToken, signal)` to `IGitHubClient`, `DefaultGitHubClient`, and `MockGitHubClient`.
     - `DefaultGitHubClient` invokes GitHub's documented `DELETE /applications/{client_id}/grant` authenticating via HTTP Basic Auth (`client_id:client_secret`) with JSON body `{ access_token }`.
     - In `GitHubAccountService.revokeUpstreamGrantAndUnlink()`, upstream HTTP revocation is performed **strictly outside PostgreSQL transactions holding locks**, eliminating connection pool starvation and long lock holds during network latency.
     - Distinguishes `confirmed` (HTTP 204), `failed` (e.g. 404/422 or network timeout), and `local_only` (sandbox/missing credentials).
     - Local stored credentials and encrypted tokens are unconditionally purged fail-closed, even if upstream fails.
     - Plaintext access tokens are never logged or stored in audit records.
  2. **Active Consent Uniqueness & Partial Unique Index (Migration 013):**
     - Created `db/migrations/013_active_consent_uniqueness.sql` which deterministically reconciles pre-existing duplicates (preserving latest, revoking older) and creates partial unique index `uq_consent_grants_active_student_purpose ON consent_grants (student_id, purpose) WHERE revoked_at IS NULL`.
     - In `PgConsentRepository.grantConsent()`, acquires transaction-level advisory lock `pg_advisory_xact_lock(hashtext(student_id || ':' || purpose))` to serialize concurrent grants, updates existing active grants to `revoked_at = CURRENT_TIMESTAMP`, and inserts the new active grant.
     - In `PgConsentRepository.revokeConsent()`, transitions all active grants for that student and purpose to `revoked_at = CURRENT_TIMESTAMP`, strictly leaving zero active grants.
  3. **Safe Canonical Repository Reconciliation (Migration 014):**
     - Created `db/migrations/014_safe_repository_reconciliation.sql` without modifying Migration 012 checksum.
     - Preflights duplicate repository groups `(student_id, provider, provider_repo_id)`.
     - Re-parents all child records (`repo_snapshots`, `evidence_items`, `source_snapshots`, `trusted_ingestion_records`, `ingestion_jobs`) to the canonical repository (`imported_at ASC, id ASC`), temporarily managing trigger `trg_trusted_ingestion_immutable`.
     - Asserts zero duplicate groups remain, and then deletes redundant repository rows safely without data loss.
  4. **Bounded GitHub Tree Traversal:**
     - Configured limits: `maxTreeEntries = 5000`, `maxDirectoryTraversals = 100`, `maxTreeApiRequests = 30`, `maxFiles = 200`, `maxWallClockMs = 30000ms`.
     - Enforces early termination during traversal: halts immediately with `FILE_COUNT_LIMIT_EXCEEDED` once 201 eligible files are discovered.
     - Handles HTTP 403/429 rate limit errors fail-closed (`GITHUB_RATE_LIMIT_EXCEEDED`) without retry loops.
     - On any limit failure, records terminal error in `ingestion_jobs` and persists NO manifests or snapshots.
  5. **Ingestion Job Status Transitions on Revocation:**
     - Implemented `cancelJobsForStudentOnRevocation(context, studentId)` across interface, in-memory, and PostgreSQL repository adapters.
     - Transitions all in-progress jobs (`queued`, `resolving`, `fetching`, `verifying`, `persisted`) to `status = 'failed'` with `error = 'CONSENT_REVOKED'`, `diagnostics.revocation_reason = 'CONSENT_REVOKED'`, and `completed_at = CURRENT_TIMESTAMP`. Completed and already-failed jobs are untouched.
- **Consequences:** Eliminates external network calls inside database transactions, prevents duplicate active consent grants while preserving audit trail, protects historical student evidence from migration data loss, caps ingestion resource consumption, and guarantees that consent revocation immediately cancels in-flight ingestion jobs.





