# 🛂 open-stellar-passport

**A zero-knowledge "passport" that lets autonomous AI agents pay — without doxxing their owner or exposing their balance.**

Built for the [Stellar Hacks: Real-World ZK](https://dorahacks.io/hackathon/stellar-hacks-zk) hackathon. The trust layer that [Open-Stellar](https://github.com/leocagli/Open-Stellar) (and any agent-commerce hub on Stellar) was missing.

### ▶ Live demo: **https://bitcoindefi.github.io/open-stellar-passport/**

Generates a real Groth16 proof in your browser and verifies it on the deployed Stellar testnet contract — no wallet, no signup.

![Agent Passport — live demo: client-side ZK proof verified on-chain in Soroban](docs/hero.png)

> Live demo: real in-browser Groth16 proving → real on-chain verification → x402 payment gate. Run it with `cd frontend && npm install && npm run dev`.

🎬 **Demo video** (2:02, ElevenLabs voiceover + synced captions): [narrated](docs/demo-narrated.mp4) · [silent](docs/demo.mp4) — built with Remotion in [video/](video/), script in [docs/VIDEO.md](docs/VIDEO.md)

---

## 🔗 On-chain proof (Stellar testnet)

Not a mock — a real ZK proof was verified and an attestation **minted on-chain**. Everything here is independently verifiable on [stellar.expert](https://stellar.expert/explorer/testnet):

| | Address / tx | Explorer |
|---|---|---|
| **AgentPassportValidator** — stateful policy contract | `CDNSZUNEWFCGSPWLPDSWTENR2WPHKC34RGZQG7RJA54OPGTZGVVRFYBA` | [view ↗](https://stellar.expert/explorer/testnet/contract/CDNSZUNEWFCGSPWLPDSWTENR2WPHKC34RGZQG7RJA54OPGTZGVVRFYBA) |
| **CircomGroth16Verifier** — BN254, our circuit's VK baked in | `CCMKLYSRUH2HMA4UU6WLXWQXEY6KAH5AWB5BEVMJGNGC5GLGTVROLG4A` | [view ↗](https://stellar.expert/explorer/testnet/contract/CCMKLYSRUH2HMA4UU6WLXWQXEY6KAH5AWB5BEVMJGNGC5GLGTVROLG4A) |
| **Mint tx** — `verify_and_register` succeeded, `passport` event emitted | `226170818ccb4e37817e3929cff328da5d71203c72a219c91325100bde966f90` | [view ↗](https://stellar.expert/explorer/testnet/tx/226170818ccb4e37817e3929cff328da5d71203c72a219c91325100bde966f90) |
| **Init tx** | `099f4243ead8af663eaa4cdd31312cc6b981f91362ab4e320572fc87d925025d` | [view ↗](https://stellar.expert/explorer/testnet/tx/099f4243ead8af663eaa4cdd31312cc6b981f91362ab4e320572fc87d925025d) |

What the chain enforces — tested end-to-end:

- ✅ **Valid proof** → `verify_and_register` **Success**: attestation minted for agent `#42` at ledger `3,146,304`, `PassportRegistered` event emitted with the nullifier + spend cap.
- 🔁 **Replay the same proof** → `Error(Contract, #4)` = **`NullifierUsed`** (stateful anti-replay / anti-Sybil).
- ✋ **Tamper a public input** → `Error(Contract, #5)` = **`InvalidProof`** (the BN254 pairing check rejects it — soundness).
- ❌ **Proof against unknown root** → `Error(Contract, #7)` = **`UnknownRegistryRoot`** (only approved roots allowed).
- 💰 **Spend Gate** → `authorize_spend(agent_id, amount)`:
    - ✅ **Cumulative spend ≤ proven cap** → **Success**: decrements `remaining_cap`, `SpendAuthorized` event emitted.
    - ❌ **Spend > remaining cap** → `Error(Contract, #8)` = **`InsufficientSpendCap`** (on-chain enforcement).
- 🔒 Only **4 public inputs** ever reach the chain (`registryRoot`, `nullifierHash`, `agentId`, `spendCap`). The owner key, balance and Merkle path never leave the browser.

**Reproduce it yourself** against the live contract:

```bash
node scripts/smoke-onchain.mjs          # fresh proof verifies · replay rejected · reads
# → SMOKE OK — 4 passed, 0 failed
```

---

## The problem (it bleeds money *and* identity today)

AI agents are starting to pay for things autonomously (x402). To let an agent transact, today you do one of two dangerous things:

1. **Hand it keys or your full balance** → if the agent is compromised, you lose everything (money loss).
2. **KYC the operator into a central database** → another honeypot that gets breached (identity loss — see the 2025 exchange KYC leaks).

And agents get **impersonated and Sybil-farmed**. There's no way to know an agent is backed by a real, solvent, authorized human *without* revealing who they are or how much they hold.

Every existing "agent passport" (SelfClaw, risotto-passport, World ID + AgentKit…) lives on EVM/Solana, verifies identity **off-chain** via an external service, only proves personhood **once**, and **never gates the actual payment with proof-of-funds**. None are on Stellar.

## The solution

The human owner mints an **Agent Passport**: a ZK credential bound to the agent's Stellar address that proves, in a single Groth16 proof verified **on-chain in Soroban**:

| Claim | How |
|---|---|
| 🧍 The operator is a verified human/business | Merkle membership in an attested-identity registry (no PII on-chain) |
| 🔒 One identity can't spawn infinite agents | Poseidon2 **nullifier** bound to the agent id (anti-Sybil / anti-replay) |
| 💰 The operator is solvent for the spend | **proof-of-funds**: `balance ≥ spendCap`, balance stays hidden |

A compromised agent can't exceed its proven cap. The owner's identity and real balance never leave the device. An auditor can later be given a view key (selective disclosure — roadmap).

## How it plugs into Stellar

```
Human → mints agent in trionlabs/stellar-8004 Identity Registry (agent_id)
      → owner generates Groth16 proof CLIENT-SIDE (snarkjs/WASM, secrets never leave)
      → AgentPassportValidator (Soroban) verifies proof on BN254, burns the nullifier
      → writes a "zk-passport" attestation with the `spend_cap`
At payment time (x402):
      → paid-API facilitator calls `authorize_spend(agent_id, amount)` on-chain
      → validator checks `amount ≤ remaining_cap` and decrements it
      → settle only if `authorize_spend` succeeds.
```

We reuse:
- **[NethermindEth/stellar-private-payments](https://github.com/NethermindEth/stellar-private-payments)** (Apache-2.0) — the `circom-groth16-verifier` Soroban contract (BN254 native precompile) and the Poseidon2 / Keypair / MerkleProof circom building blocks.
- **[trionlabs/stellar-8004](https://github.com/trionlabs/stellar-8004)** (MIT) — ERC-8004 Identity / Reputation / Validation registries on Soroban.

## The circuit ([`circuits/agent_passport.circom`](circuits/agent_passport.circom))

```
private: privateKey, balance, pathElements[20], pathIndices
public : registryRoot, nullifierHash, agentId, spendCap
proves : publicKey = Poseidon2(privateKey, 0)
         MerkleProof(publicKey, path) == registryRoot      // personhood
         nullifierHash == Poseidon2(privateKey, agentId)   // anti-Sybil/replay
         balance >= spendCap                                // proof-of-funds
```
~9.6k constraints · 4 public inputs · proves in well under a second client-side.

## Status

- [x] **Phase 0** — circuit compiles, Groth16 trusted setup, **proof generated & verified off-chain** ✅
- [x] **Phase 1** — VK baked into the Soroban `circom-groth16-verifier`, **deployed to testnet & proof verified ON-CHAIN** ✅
  - Verifier contract: [`CCMKLYSRUH2HMA4UU6WLXWQXEY6KAH5AWB5BEVMJGNGC5GLGTVROLG4A`](https://stellar.expert/explorer/testnet/contract/CCMKLYSRUH2HMA4UU6WLXWQXEY6KAH5AWB5BEVMJGNGC5GLGTVROLG4A) (testnet)
  - Valid proof → `true`; tampered public input → `InvalidProof` (soundness verified)
- [x] **Phase 2** — [`AgentPassportValidator`](contracts/agent-passport-validator/) (stateful policy layer) + TypeScript SDK ✅
  - Validator contract: [`CDNSZUNEWFCGSPWLPDSWTENR2WPHKC34RGZQG7RJA54OPGTZGVVRFYBA`](https://stellar.expert/explorer/testnet/contract/CDNSZUNEWFCGSPWLPDSWTENR2WPHKC34RGZQG7RJA54OPGTZGVVRFYBA) (testnet)
  - Cross-contract calls the verifier, **burns the nullifier (anti-replay / anti-Sybil)**, mints a `zk-passport` attestation
  - Audit views: `list_registry_roots()` enumerates the current root allow-list. Spent nullifiers stay event-sourced from `PassportRegistered` events, with `is_nullifier_used(...)` available for point checks so the contract avoids an unbounded nullifier list.
  - On-chain e2e: `verify_and_register` → minted ✅; **replay → `NullifierUsed` ✅**; tampered input → `InvalidProof` ✅ (5 unit tests run the real proof through the real verifier WASM)
  - [`@open-stellar/agent-passport`](sdk/) SDK: client-side proving (snarkjs) + typed client + the `authorizePayment` x402 gate
- [x] **Phase 3** — live [demo frontend](frontend/) ✅
  - Real in-browser Groth16 proving (~1 s) → **real on-chain verification** (no wallet needed) → x402 payment gate → anti-replay
  - Vite + React 19 + Tailwind v4; design system in [`design-system/`](design-system/) (published to Claude Design)
  - Run: `cd frontend && npm install && npm run dev`
- [ ] Selective-disclosure view key + per-payment `amount ≤ cap` proof (stretch)

## Portable build from source

The legacy `scripts/wsl-*.sh` helpers still work for the original WSL layout,
but the portable path is now the repository `Makefile`.

```bash
make check-build-tools
make verify-committed-zk
make build-contracts
```

Tooling:

- Node.js + npm install the pinned `snarkjs` dependency from `package-lock.json`.
- Rust + `rustup` build and test the Soroban validator crate.
- `circom` 2.2.x is required only when recompiling `.circom` sources.
- Stellar CLI is required only for release contract artifact parity, deployment,
  and TypeScript binding generation.

### ZK circuit artifacts

`make verify-committed-zk` copies the committed browser artifacts from
`frontend/public/zk/` into `build/`, exports the verification key from the
committed zkey, compares it with `frontend/public/zk/verification_key.json`, and
runs `node scripts/smoke.mjs` against those copied artifacts.

To recompile the circuit sources:

```bash
make build-circuit
```

To run a fresh local Groth16 setup, provide the powers-of-tau file:

```bash
make circuit-setup POT14=/path/to/pot14_final.ptau ZKEY_ENTROPY="local entropy"
```

The resulting zkey is expected to differ from
`frontend/public/zk/agent_passport_final.zkey` unless the original contribution
transcript and entropy are reused. The committed zkey remains auditable through
the `verify-committed-zk` target.

### Soroban contract artifacts

`make build-contracts` runs the validator unit tests, compiles the contract with
the current Rust `wasm32v1-none` target, and writes the portable Cargo artifact
to `build/contracts/agent_passport_validator.cargo.wasm`. The raw Cargo output
can differ from the committed optimized deployment artifact, so the target prints
a SHA-256 comparison instead of hiding the difference.

For byte-for-byte release artifact parity, install Stellar CLI and run:

```bash
make build-contracts-stellar
make build-verifier-contract
```

The verifier build target fetches Nethermind's
`stellar-private-payments` into ignored `build/external/`, injects the committed
verification key, and writes the built verifier WASM under `build/contracts/`.

### Deployment and bindings

Deployment targets are explicit and require a local Stellar identity name:

```bash
make deploy-verifier STELLAR_SOURCE=passport-deployer
make deploy-validator STELLAR_SOURCE=passport-deployer
make gen-bindings
```

`deploy-validator` reads `deploy/verifier-contract-id.txt`, writes
`deploy/validator-contract-id.txt`, and initializes the validator. Set
`STELLAR_ADMIN` to override the admin address; otherwise the address for
`STELLAR_SOURCE` is used.

## Build (Phase 0 legacy)

```bash
# prerequisites: node, circom 2.2.x, snarkjs
npm install
# compile circuit
circom circuits/agent_passport.circom --r1cs --wasm --sym -o build
# trusted setup (downloads powers-of-tau 2^14)
npx snarkjs groth16 setup build/agent_passport.r1cs build/pot14_final.ptau build/agent_passport_0000.zkey
npx snarkjs zkey contribute build/agent_passport_0000.zkey build/agent_passport_final.zkey -e="<entropy>"
npx snarkjs zkey export verificationkey build/agent_passport_final.zkey build/verification_key.json
# end-to-end smoke test: generate + verify a proof
node scripts/smoke.mjs   # ==> PROOF VALID: true
```

## License

MIT. Vendored circuit building blocks under `circuits/lib/` are Apache-2.0 (© Nethermind), derived from tornadocash/tornado-nova.

## Trust Assumptions

The `AgentPassportValidator` contract has an `admin` role with significant power. Specifically, the admin can:
- **Change the Verifier**: Update the address of the verifier contract used for proof validation. A malicious admin could point to a verifier that always returns `true`, bypassing all ZK security guarantees.
- **Manage Registry Roots**: Add or remove approved identity registry roots.

To mitigate these risks:
- **Observable Actions**: All administrative actions (verifier changes, admin transfers) emit on-chain events for transparency.
- **Two-Step Transfer**: Admin rights are transferred through a propose-and-accept flow to prevent accidental loss of control.
- **Multisig Recommendation**: For production deployments, the admin should be a multisig account (e.g., Gnosis Safe on Stellar) or a DAO-controlled contract, rather than a single-signature key.
- **Renouncement**: The admin role can be renounced if no further upgrades or management are intended.

> ⚠️ Research prototype for a hackathon. Not audited. Do not use with real funds.
