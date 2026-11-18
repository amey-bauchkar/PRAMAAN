# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private reporting: **Security → Report a vulnerability** on this repository. Include the affected component, steps to reproduce and the impact you expect.

You can expect an acknowledgement within five working days. Fixes are released before details are disclosed.

## Scope

In scope: the API, web app, database migrations and policies, credential and Eligibility Pass signing, and the consent ledger.

Out of scope: the local code judge. It is a development runner and not a security boundary; production deployments must use an isolated Judge0 instance.

## Secrets

Never commit `.env` files, keys or database URLs. The demo issuer seed is public and must not be used outside the demo. See the production notes in the [README](README.md#self-hosting) and the [threat model](docs/SECURITY_AND_THREAT_MODEL.md).
