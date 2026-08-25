/**
 * Input validation for the Agent Passport proof pipeline.
 *
 * The circom circuit (`circuits/agent_passport.circom`) crashes cryptically -
 * or hangs the prover - when a witness is out of range. These checks run
 * BEFORE `snarkjs.groth16.fullProve` so callers get a descriptive
 * `ValidationError` naming the offending field and value instead.
 *
 * Ranges are read from the circuit instantiation at the bottom of
 * `agent_passport.circom`:
 *
 *   component main {public [...]} = AgentPassport(20, 128);
 *
 * - `levels = 20`       -> Merkle tree depth; leaf index must be < 2^20.
 * - `balanceBits = 128` -> the circuit itself accepts spend caps up to
 *                          2^128 - 1. The SDK deliberately enforces the
 *                          stricter product bound of 2^64: everything below
 *                          2^64 is also below 2^128, so nothing that passes
 *                          here can fail in-circuit.
 */

/** Merkle tree depth of the passport circuit (`AgentPassport(levels, ...)`). */
export const MERKLE_TREE_DEPTH = 20;

/** Bit width the circuit uses for the balance / spendCap comparison. */
export const CIRCUIT_BALANCE_BITS = 128;

/** Maximum `spendCap` accepted by the SDK (product bound, < circuit bound). */
export const SPEND_CAP_MAX = 2n ** 64n - 1n;

/** Maximum `agentId` accepted by the SDK (fits a u32 Stellar-8004 id). */
export const AGENT_ID_MAX = 2n ** 32n - 1n;

/** Maximum leaf index accepted, derived from the tree depth. */
export const LEAF_INDEX_MAX = 2n ** BigInt(MERKLE_TREE_DEPTH) - 1n;

/** Byte length of a BN254 field element in hex form (32 bytes = 64 chars). */
export const FIELD_HEX_LENGTH = 64;

const MAX_FIELD = 2n ** 256n - 1n; // anything wider cannot be a BN254 element

/** Error thrown when a witness field violates its circuit/product bounds. */
export class ValidationError extends Error {
  /** Name of the field that failed validation. */
  readonly field: string;
  /** The value as received, stringified for the error message. */
  readonly received: string;

  constructor(field: string, received: unknown, reason: string) {
    const value =
      typeof received === "bigint"
        ? `${received}`
        : typeof received === "string"
          ? received
          : JSON.stringify(received);
    super(`ValidationError[${field}]: ${reason} (received: ${value})`);
    this.name = "ValidationError";
    this.field = field;
    this.received = String(value);
  }
}

function requireIntegerString(field: string, value: string): bigint {
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) {
    throw new ValidationError(
      field,
      value,
      "expected a non-negative decimal integer string",
    );
  }
  return BigInt(value.trim());
}

function requireFieldElement(field: string, value: string): bigint {
  const n = requireIntegerString(field, value);
  if (n > MAX_FIELD) {
    throw new ValidationError(
      field,
      value,
      `exceeds the 32-byte field element range (max ${MAX_FIELD})`,
    );
  }
  return n;
}

/**
 * Validate a witness input set before proving.
 * Throws {@link ValidationError} on the first violating field.
 */
export function validatePassportWitness(witness: {
  agentId: string;
  spendCap: string;
  registryRoot: string;
  pathIndices: string;
}): void {
  // spendCap: integer, > 0, <= 2^64 - 1. The circuit would accept up to
  // 2^128 - 1 (see CIRCUIT_BALANCE_BITS); the SDK bound is stricter on purpose.
  const spendCap = requireIntegerString("spendCap", witness.spendCap);
  if (spendCap === 0n) {
    throw new ValidationError("spendCap", witness.spendCap, "must be greater than zero");
  }
  if (spendCap > SPEND_CAP_MAX) {
    throw new ValidationError(
      "spendCap",
      witness.spendCap,
      `must be < 2^64 (${SPEND_CAP_MAX + 1n}), even though the circuit accepts up to 2^${CIRCUIT_BALANCE_BITS}`,
    );
  }

  // agentId: integer in [0, 2^32).
  const agentId = requireIntegerString("agentId", witness.agentId);
  if (agentId > AGENT_ID_MAX) {
    throw new ValidationError(
      "agentId",
      witness.agentId,
      `must be < 2^32 (${AGENT_ID_MAX + 1n})`,
    );
  }

  // registryRoot (merkle root): BN254-sized decimal field element.
  requireFieldElement("registryRoot", witness.registryRoot);

  // pathIndices (leaf index): integer in [0, 2^treeDepth).
  const leafIndex = requireIntegerString("leafIndex", witness.pathIndices);
  if (leafIndex > LEAF_INDEX_MAX) {
    throw new ValidationError(
      "leafIndex",
      witness.pathIndices,
      `must be < 2^${MERKLE_TREE_DEPTH} (the registry tree has ${MERKLE_TREE_DEPTH} levels)`,
    );
  }
}

/**
 * Validate a hex-encoded merkle root (contract-call form). Must be
 * {@link FIELD_HEX_LENGTH} hex characters with an optional 0x prefix.
 */
export function validateMerkleRootHex(merkleRoot: string): void {
  const ok =
    typeof merkleRoot === "string" &&
    new RegExp(`^(0x)?[0-9a-fA-F]{${FIELD_HEX_LENGTH}}$`).test(merkleRoot);
  if (!ok) {
    throw new ValidationError(
      "merkleRoot",
      merkleRoot,
      `expected ${FIELD_HEX_LENGTH} hex characters (optional 0x prefix), got ${
        typeof merkleRoot === "string" ? `${merkleRoot.length} chars` : typeof merkleRoot
      }`,
    );
  }
}
