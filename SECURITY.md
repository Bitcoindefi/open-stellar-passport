# Security Policy

open-stellar-passport is a research prototype for zero-knowledge credential and
Stellar/Soroban payment-gating flows. Please report potential vulnerabilities
privately before publishing details.

## Supported Scope

Security reports are in scope for the current `main` branch, including:

- `contracts/agent-passport-validator/` Soroban contract code
- `circuits/` proving circuits and vendored circuit dependencies
- `sdk/` and `sdk/bindings/` client libraries
- `frontend/` demo code that generates proofs or calls the contract
- dependency and build-chain issues that could affect proof soundness,
  verification, or transaction authorization

The live demo and testnet deployments are hackathon/research infrastructure.
Do not use real funds or private production identity material with this project.

## Reporting a Vulnerability

Preferred channel: open a private GitHub security advisory for this repository:

https://github.com/Bitcoindefi/open-stellar-passport/security/advisories/new

If private reporting is not available, open a minimal public issue asking for a
secure contact path. Do not include exploit details, proof material, private
keys, identity data, or live credentials in a public issue.

Please include, when safe:

- affected package, contract, circuit, or workflow
- a concise impact summary
- reproduction steps using local test data only
- affected dependency versions, if applicable
- any suggested mitigation or patch direction

## Response Expectations

Maintainers will make a best-effort attempt to acknowledge reports promptly,
triage impact, and coordinate a fix before public disclosure. Because this is a
research prototype, supported remediation may be limited to the current `main`
branch and testnet/demo artifacts.

## Dependency Hygiene

Dependency updates are monitored with Dependabot for the npm and Cargo manifests
that affect the circuit, SDK, frontend, and Soroban contract. A non-blocking
security-audit workflow is also provided so dependency advisories are visible
without turning unrelated pull requests red while the project is still a
prototype.
