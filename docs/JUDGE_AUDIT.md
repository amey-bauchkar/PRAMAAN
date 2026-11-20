# Judge audit (19 Nov 2026)

An independent-style audit of the whole solution against the eight scoring parameters. Scores are my own judgement from the code, tests and the running demo. They are not an official score.

## What was checked

- Every API route, as every demo role, with empty and malformed bodies: no server errors, and no role can read another role's area (`apps/api/tests/v2-route-safety.test.ts`, 79 routes).
- Row-level security is forced on every table (static check) and tenant isolation is tested on sampled endpoints.
- A stored eligibility decision can be replayed from its saved inputs and rule version, and an altered input is detected (`v2-replay.test.ts`).
- Live calls to Groq and Gemini for interview scoring and question drafting.
- Response times on the demo database (220 students in one college, in-process PostgreSQL, so not a production figure).

## Scorecard

| Parameter | Score | Why | What would raise it |
|---|---|---|---|
| Novelty | 8 | Code ownership check, publish-time fairness repair, predicate-only passes, replayable decisions. "No public prior art found" is the strongest honest claim. | A public decision log with receipts, a season simulator. |
| Clarity of the idea | 7 | The product is broad. One story is not yet the default path. | One-sentence pitch and a 30-second hero demo. |
| Feasibility | 8 | Runs offline, 540+ tests, honest limits table. | A one-click demo reset. |
| Practicability | 6 | Only synthetic data. No real officer, student or recruiter has used it. | One real pilot with written feedback. This matters most. |
| Sustainability | 5 | No cost or pricing evidence in the repo. | A cost per college and a payer, with figures from a real quote. |
| Scale of impact | 6 | Multi-tenant design is sound, but nothing is measured above one college of 220 students. | A load test on production PostgreSQL. |
| User experience | 7 | Plain language, mobile layout works, Hindi and Marathi are unreviewed drafts. | Native-speaker review, an accessibility pass. |
| Project implementation | 8 | Real mail, calendar, review, erasure, retention, replay. Probes still run on seeded sample code only. | Probes from a student's own repository. |

## Defects found and fixed in this audit

- Cohort intervention ranking took about 2.7 s for 220 students (one database round trip per student, and every drive re-checked for every skill). It now loads all students in two queries and re-checks only the blocked drives that ask for the skill: about 0.45 s, with the same results (all domain and demo-flow tests pass).
- The "decision to evidence" view could show a result but could not prove it. Students can now replay a decision and see whether it reproduces.
- The ensemble interview judge gave credit if any one model agreed, and a live test showed Gemini awarding full marks to keyword stuffing. Credit now needs agreement from every model that answered.

## Open findings

- The code ownership check is not generated from a student's own imported repository, and runs JavaScript only.
- The content security policy allows inline scripts (a Next.js requirement for now) and names a fixed API origin.
- Mail sending, GitHub OAuth and revocation, DigiLocker, APAAR, NAD and Bhashini were not exercised against real services.
- No demo reset button: the in-memory demo database resets only when the server restarts.
- No numbers for cost, payer or pilot outcomes exist yet. Do not invent them for the deck.

## Update: placement ledger (19 Nov 2026)

Added the placement ledger and replay (see PITCH.md). It targets Novelty and Clarity. What it adds: signed offers, a public recomputable log, receipts students keep, and reports that separate verified from recorded placements. Re-scoring is not done here because the score depends on the prior-art findings (docs/research/notes/proof-not-opinion-prior-art.md) and on how the demo is delivered.

What the prior-art examination changed (same day). The examiner found that every ingredient has precedent (signed placement forms in IIM audits, US placement audits, transparency logs, witnesses, blockchain recruitment papers and a patent), so the novelty claim is now limited to the combination and to a university acting as witness, with the exact time-boxed wording in PITCH.md. The code was changed to answer the examiner's points that could be fixed in a day: the witness signs with its own clock, the university's browser rebuilds the log before signing, the audit sample is drawn from a seed the auditor chooses, the public page and the university check the witness signature themselves, and a standalone verifier script exists. The slogan became "Receipts, not claims", and the copy no longer says the college holds the signing key, that the log is tamper-proof or that no trust is needed. Still open, and listed in KNOWN_LIMITATIONS.md: tying recruiter keys to real companies, joined and withdrawn events, more than one witness, per-college keys in a hardware module, public redacted entries, and key recovery.
