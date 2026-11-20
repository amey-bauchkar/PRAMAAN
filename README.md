# PRAMAAN

[![CI](https://github.com/amey-bauchkar/PRAMAAN/actions/workflows/ci.yml/badge.svg)](https://github.com/amey-bauchkar/PRAMAAN/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%E2%89%A522-339933)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)

**Skills you can prove. Placements you can audit.**

PRAMAAN is a campus-placement platform for colleges. Student work becomes graded, verifiable proof of skill. Placement officers publish eligibility rules that are versioned, tested for fairness and explained in plain language. Recruiters see evidence instead of claims. It was built for the QUASAR 5.0 EdTech problem statement.

## What it does

The idea in one line: **receipts, not claims.** A model may propose, but only something that was executed, computed or signed may decide. Three receipts anyone can check: a skill certificate, a replayable eligibility decision, and a placement signed by both the recruiter and the student and recorded in a public log. See [docs/PITCH.md](docs/PITCH.md).

- **Placement ledger.** A placement counts as verified only when the recruiter signs the offer and the student signs the acceptance (keys stay in their browsers). Every accepted offer, published rule version and batch of decisions goes into an append-only Merkle log whose checkpoints are signed by the log operator and can be witnessed by the parent university with its own key. Anyone can rebuild and check the log in their own browser at `/ledger/<college id>`, or with `npm run verify:ledger -- <api address> <college id>`, which shares no code with the website. Reports separate verified placements from placements the college only recorded. What it does not prove, and what is next, is listed in [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md).
- **Replay this decision.** Re-run a stored eligibility decision on its saved inputs and rule version and compare the result.
- **Verified skill graph.** Evidence (repositories, machine tests, mock drives, mentor attestations) moves a skill through Claimed, Observed and Verified, with Proof Levels L1 to L3. Code authorship is checked with a Live Mutation Probe: the student changes their own code under hidden tests and predicts its behaviour.
- **Explainable eligibility.** Rules are written in a small DSL, versioned, and evaluated per student. Every failed check is returned as a reason in English, Hindi or Marathi, with an appeal path.
- **Fairness checks and repair.** Each rule is tested against the four-fifths benchmark before it is published. When a rule fails, the repair search proposes a small, fairer change that keeps the required skills. Officers decide and a reason is recorded.
- **Proof Path.** For each student, the proof that unlocks the most drives, the hours it takes, and whether it fits before each deadline.
- **Eligibility Pass.** A signed, single-use pass that tells a recruiter "CGPA 7.5 or above: met" without disclosing the CGPA.
- **Consent and privacy.** A consent ledger built around the DPDP Act 2023. Withdrawing consent steps down the proofs that depended on it. Tenant isolation uses forced row-level security on every table.
- **Verifiable credentials.** Open Badges 3.0 credentials signed with Ed25519 and a public verification page.

The product design, audit and build plan are in [docs/SOLUTION_AND_BUILD_PLAN.md](docs/SOLUTION_AND_BUILD_PLAN.md). The prior-art research is in [docs/research](docs/research/campus-placement-novelty-landscape.md).

## Quick start

Requires Node.js 22 or newer.

```bash
npm install
npm run demo
```

Open http://localhost:3000 and choose a persona (student, placement officer, recruiter or university).

The demo runs the whole product on an in-process PostgreSQL (PGlite) with every migration applied and a synthetic 300-student university. It needs no Supabase account, Docker or network access. All people, colleges and companies are fictional and labelled as synthetic. A guided tour is in [docs/DEMO_WALKTHROUGH.md](docs/DEMO_WALKTHROUGH.md).

For a faster, production-mode build of the web app:

```bash
node scripts/demo.mjs --prod
```

## Repository layout

| Path | Contents |
|---|---|
| `apps/web` | Next.js app with workspaces for student, placement office, recruiter and university |
| `apps/api` | Fastify API. `src/v2` holds the product modules and `src/demo-server.ts` is the offline entry point |
| `packages/domain` | Pure, tested engines: skill state machine, eligibility DSL, Proof Path, fairness, mock drives, readiness, credentials |
| `packages/contracts` | Shared Zod schemas and types used by the API and web app |
| `db/migrations` | PostgreSQL schema with forced row-level security (001 to 025) |
| `db/seeds` | Taxonomy, assessment banks and the synthetic tenant |
| `scripts` | Migration runner, demo launcher, seed generator |
| `docs` | Architecture, database design, security model, decisions and research |

## Development

```bash
npm run dev:api      # API on :4000
npm run dev:web      # web app on :3000
npm run typecheck
npm run lint
npm test
npm run test:offline
```

`npm test` runs every suite, including those that need a live PostgreSQL or Supabase database (`DATABASE_URL`, `DATABASE_URL_ADMIN`). `npm run test:offline` runs only the suites that need no external services; it is what CI runs first.

Warning: `db/tests/migration-runner.test.ts` applies pending migrations to whatever `DATABASE_URL_ADMIN` points at. If your `.env` holds real credentials, use `npm run test:offline` and do not run `npm test`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for branch naming, commit style and review expectations.

## Self-hosting

A `Dockerfile` and `docker-compose.yml` run the API, web app and PostgreSQL for a single college or university.

1. `cp .env.example .env` and fill in the secrets.
2. `docker compose up -d db && docker compose run --rm migrate && docker compose up -d`

Notes for a real deployment:

- Apply migrations with `npm run migrate`, which uses `DATABASE_URL_ADMIN`. The API runs as the restricted `app_api` role.
- The local code judge is a development runner and is not a security boundary. Set `JUDGE0_URL` to use an isolated Judge0 instance.
- Set `PRAMAAN_ISSUER_SEED` (32 bytes of hex) from a secret store. The demo seed is public.
- Without `SMTP_HOST`, outreach messages stay in the outbox and are not sent.
- ESCO and O\*NET mappings are seeded as `pending_review` and must be confirmed against the official sources before being shown as aligned.
- The DPDP controls are built in, but a real pilot needs legal review.

## Documentation

| Document | Purpose |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | Modular monolith, execution service, trust boundaries |
| [Database design](docs/DATABASE_DESIGN.md) | Schema, row-level security, audit chain |
| [Security and threat model](docs/SECURITY_AND_THREAT_MODEL.md) | Assets, threats and mitigations |
| [Decision log](docs/DECISION_LOG.md) | Architecture decisions and their reasons |
| [Known limitations](docs/KNOWN_LIMITATIONS.md) | What the platform does not do |
| [Solution and build plan](docs/SOLUTION_AND_BUILD_PLAN.md) | Product design and status |
| [Real data plan](docs/REAL_DATA_PLAN.md) | How to move from synthetic to real cohorts |

## Status

The product runs end to end on synthetic data. It has not been piloted with a real college. Real-data onboarding, legal review of the consent flows and an isolated code-execution service are the main steps before a pilot.

## Security

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

All rights reserved. No license has been granted for reuse.
