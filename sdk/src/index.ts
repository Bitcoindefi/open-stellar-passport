/**
 * @open-stellar/agent-passport
 *
 * Client-side ZK proving + the typed on-chain client for the Agent Passport:
 * a zero-knowledge credential that gates autonomous AI-agent payments on
 * Stellar without revealing the operator's identity or balance.
 */
export { AgentPassport, authorizePassportSpend, type AgentPassportConfig, type CircuitBreakerConfig, type SpendLimits } from "./passport.js";
export {
  createDelegationToken,
  verifyDelegationToken,
  authorizeDelegatedPayment,
  revokeDelegationToken,
  revokeDelegatorTokens,
  resetDelegationState,
  type DelegationToken,
} from "./delegation-token.js";
export {
  generatePassportProof,
  toSorobanProof,
  derivePublicInputs,
  type PassportArtifacts,
  type PassportWitness,
  type PublicInputs,
  type SorobanProof,
  type Artifact,
} from "./prover.js";

// Re-export the typed contract client + types generated from the deployed contract.
export {
  Client as AgentPassportValidatorClient,
  networks,
  Errors,
  type Attestation,
  type Groth16Proof,
} from "../bindings/src/index.js";

export {
  validatePassportWitness,
  validateMerkleRootHex,
  ValidationError,
  MERKLE_TREE_DEPTH,
  CIRCUIT_BALANCE_BITS,
  SPEND_CAP_MAX,
  AGENT_ID_MAX,
  LEAF_INDEX_MAX,
  FIELD_HEX_LENGTH,
} from "./validate.js";

export { PassportClient } from "./PassportClient.js";

