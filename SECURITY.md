# Security Policy

`open-stellar-passport` is a hackathon/testnet project whose value rests entirely
on cryptographic trust. We take soundness issues seriously and document the
current trust assumptions honestly below.

## Reporting a vulnerability

Please **do not** open a public issue for a security vulnerability. Instead use
GitHub's private *"Report a vulnerability"* flow on this repository, or email the
maintainer. We aim to acknowledge within a few days.

In scope: the Soroban contracts (`contracts/`), the circuit (`circuits/`), the
proving/encoding code (`sdk/`, `frontend/src/lib/`).

## Current trust assumptions (testnet)

These are the things a reviewer must know before trusting the system. Several are
tracked as open issues.

### Trusted setup (Groth16) — issue #3

The proving key `frontend/public/zk/agent_passport_final.zkey` requires a
circuit-specific Phase-2 trusted setup. **Until the ceremony provenance is
documented, treat the setup as single-contributor:** whoever produced the zkey
could, in principle, forge proofs that pass the on-chain verifier. This is
acceptable for a testnet demo but **not** for production.

You can confirm the shipped zkey matches the verification key used by the
browser and the on-chain verifier:

```bash
bash scripts/verify-zkey.sh   # OK — committed verification_key.json matches the zkey.
```

A full ceremony verification (`snarkjs zkey verify circuit.r1cs pot.ptau zkey`)
additionally needs the `.r1cs` and the Powers-of-Tau file; documenting the ptau
source + hash is part of issue #3.

### Registry-root allow-list — issue #1 (fixed)

The validator now pins the accepted `registryRoot` to an admin-managed
allow-list (`init` attests the first root; `add_registry_root` /
`remove_registry_root` manage it). A proof against an unattested root is rejected
with `UnknownRegistryRoot` before the pairing check.

### Circuit range checks — issue #2 (source fixed, regen pending)

`agent_passport.circom` now range-checks `balance` and `spendCap` to
`balanceBits` bits so `GreaterEqThan` cannot be wrapped. **This change requires
recompiling the circuit, a fresh trusted setup, and redeploying the verifier
contract** — until then the deployed artifacts predate the fix.

### Admin trust — issue #6 (hardened)

`set_verifier` is admin-gated and now emits an event; admin can be transferred
(two-step) or renounced to freeze the verifier/roots. The admin is still fully
trusted while present — prefer a multisig admin for any non-demo deployment.
