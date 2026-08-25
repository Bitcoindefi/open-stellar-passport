# @open-stellar/agent-passport

Client-side ZK proving + a typed Soroban client for the **Agent Passport** — a
zero-knowledge credential that gates autonomous AI-agent payments on Stellar
**without revealing the operator's identity or balance**.

The proof is generated where the secrets live (browser/device); only the proof
and its public inputs are ever sent on-chain.

## Install

```bash
npm install @open-stellar/agent-passport
```

## Quick start

```ts
import { AgentPassport } from "@open-stellar/agent-passport";

const sdk = new AgentPassport({
  rpcUrl: "https://soroban-testnet.stellar.org",
  artifacts: {
    wasm: "/circuits/agent_passport.wasm",     // path (Node) or URL (browser)
    zkey: "/circuits/agent_passport_final.zkey",
    witnessWasm: "/circuits/passport_witness.wasm",
  },
  publicKey,                 // signer (e.g. Freighter)
  signTransaction,
});

// 1. prove client-side — privateKey + balance never leave the device
const proof = await sdk.prove(witness);

// 2. mint the passport on-chain (verifies the proof + burns the nullifier)
const attestation = await sdk.register(proof);

// 3. the x402 settle gate: pay only within the proven, hidden spend cap
if (await sdk.authorizePayment(agentId, amount)) settle();
```

## API

| Method | What it does |
|---|---|
| `prove(witness)` | Groth16 proof + Soroban-encoded args (snarkjs, browser/Node) |
| `register(proof)` | `verify_and_register` on-chain → returns the `Attestation` |
| `proveAndRegister(witness)` | both of the above |
| `isRegistered(agentId)` | read-only: does the agent hold a passport? |
| `getPassport(agentId)` | the stored attestation, or `undefined` |
| `isNullifierUsed(nullifier)` | read-only replay check |
| `authorizePayment(agentId, amount)` | `true` iff a passport exists and `provenCap ≥ amount` |

Low-level helpers (`generatePassportProof`, `toSorobanProof`,
`derivePublicInputs`) and the generated typed client
(`AgentPassportValidatorClient`) are also exported.

Defaults target the testnet deployment in [`../deploy/`](../deploy/); pass
`contractId` / `networkPassphrase` to point elsewhere.

## Build

```bash
npm install && npm run build      # -> dist/
node --loader ts-node/esm examples/register.ts   # full e2e (needs a funded key)
```

MIT.


## Input validation (before proving)

`sdk/src/validate.ts` checks witness inputs BEFORE `snarkjs.groth16.fullProve`
runs, so an out-of-range value throws a descriptive `ValidationError` (with the
field name and the received value) instead of a cryptic circuit crash.

`generatePassportProof()` calls it automatically. You can also use the helpers
directly:

```ts
import { validatePassportWitness, validateMerkleRootHex } from "@open-stellar/agent-passport";

validatePassportWitness({
  agentId: "42",
  spendCap: "1000",
  registryRoot: "12345...",
  pathIndices: "7",
});

// Contract-call form of the root:
validateMerkleRootHex("0x" + "ab".repeat(32));
```

### Valid ranges

Limits are exported as named constants so the SDK and any tooling share one
source of truth (`sdk/src/validate.ts`). They mirror the circuit instantiation
`AgentPassport(20, 128)` in `circuits/agent_passport.circom`.

| Field          | Type            | Valid range                          | Error if violated                                   |
| -------------- | --------------- | ------------------------------------ | --------------------------------------------------- |
| `spendCap`     | decimal string  | `1` .. `SPEND_CAP_MAX` (`2^64 - 1`)  | `ValidationError[spendCap]`                         |
| `agentId`      | decimal string  | `0` .. `AGENT_ID_MAX` (`2^32 - 1`)   | `ValidationError[agentId]`                          |
| `registryRoot` | decimal string  | BN254 field element (`< 2^256`)      | `ValidationError[registryRoot]`                     |
| `pathIndices`  | decimal string  | `0` .. `LEAF_INDEX_MAX` (`2^20 - 1`) | `ValidationError[leafIndex]`                        |
| merkle root    | hex string      | 64 hex chars, optional `0x` prefix   | `ValidationError[merkleRoot]`                       |

Note: the circuit itself would accept spend caps up to `2^128 - 1`
(`balanceBits = 128`, see `CIRCUIT_BALANCE_BITS`). The SDK enforces the stricter
`2^64` product bound on purpose; every accepted value is guaranteed to pass
in-circuit.
