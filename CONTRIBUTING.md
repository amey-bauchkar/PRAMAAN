# Contributing

## Setup

```bash
npm install
npm run demo
```

Node.js 22 or newer is required. `npm run demo` needs no external services.

## Workflow

1. Branch from `main`: `feat/<topic>`, `fix/<topic>` or `docs/<topic>`.
2. Keep a change focused. Schema changes go in a new numbered file under `db/migrations`; never edit an applied migration.
3. Before opening a pull request, run:

   ```bash
   npm run lint
   npm run typecheck
   npm run test:offline
   ```

4. Open a pull request against `main` and fill in the template. CI must pass.

`npm test` also runs suites that need a database and applies migrations to `DATABASE_URL_ADMIN`; use `npm test` only against a disposable database.

## Commit messages

Use the conventional style, imperative mood, with a scope where it helps:

```
feat(eligibility): explain failed checks in Marathi
fix(consent): step down proofs when consent is withdrawn
docs: describe the Eligibility Pass flow
```

## Code standards

- TypeScript is strict. Avoid `any`; validate external input with the Zod schemas in `packages/contracts`.
- Business rules belong in `packages/domain` as pure functions with tests. The API and web app call them.
- Every table has row-level security. New tables need policies and a test in `db/tests`.
- AI output only proposes. A skill or eligibility decision changes through deterministic checks or an authorised human, and the reason is recorded.
- Demo data is synthetic and labelled. Do not add real personal data to the repository.

## Reporting problems

Use the issue templates. For security issues, follow [SECURITY.md](SECURITY.md) instead.
