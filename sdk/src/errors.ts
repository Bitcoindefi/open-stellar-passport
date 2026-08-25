/**
 * Typed contract error codes for the AgentPassportValidator.
 *
 * Source of truth: `contracts/agent-passport-validator/src/lib.rs`
 *
 *   #[contracterror]
 *   #[repr(u32)]
 *   pub enum Error {
 *       NotInitialized = 1,
 *       AlreadyInitialized = 2,
 *       BadPublicInputs = 3,      // wrong number of public inputs for the circuit
 *       NullifierUsed = 4,        // nullifier already spent (replay / Sybil)
 *       InvalidProof = 5,         // Groth16 proof did not verify
 *       UnknownRegistryRoot = 6,  // registry root not in the approved allow-list
 *       BatchTooLarge = 7,        // batch exceeds the limit of 8
 *       RateLimitExceeded = 8,    // per-ledger credential verification limit hit
 *   }
 */

/** Every error code the validator contract can emit, keyed by its u32 value. */
export enum PassportError {
  /** Contract has not been initialized yet (admin/verifier unset). */
  NotInitialized = 1,
  /** `initialize` called on an already-initialized contract. */
  AlreadyInitialized = 2,
  /** Wrong number of public inputs for the agent_passport circuit. */
  BadPublicInputs = 3,
  /** This nullifier was already spent — replay / Sybil attempt. */
  NullifierUsed = 4,
  /** The Groth16 proof did not verify against the embedded verification key. */
  InvalidProof = 5,
  /** The registry root is not in the approved allow-list. */
  UnknownRegistryRoot = 6,
  /** Batch size exceeds the limit of 8. */
  BatchTooLarge = 7,
  /** This wallet exceeded the per-ledger credential verification limit. */
  RateLimitExceeded = 8,
}

const ALL_CODES: ReadonlyArray<PassportError> = Object.values(
  PassportError,
) as PassportError[];

/**
 * Extract a passport error code from a thrown Soroban SDK error.
 *
 * Soroban surfaces contract errors as `SorobanRpc.Error` / `ClientError` objects
 * whose message or `code` carries the raw u32 (e.g. "ContractError(5)").
 * Returns the matching {@link PassportError}, or `null` when the input is not a
 * passport-contract error (network failure, host error, unrelated contract…).
 */
export function parsePassportError(e: unknown): PassportError | null {
  if (e === null || e === undefined) return null;

  const code = extractCode(e);
  if (code === null) return null;

  return (ALL_CODES as ReadonlyArray<number>).includes(code)
    ? (code as PassportError)
    : null;
}

function extractCode(e: unknown): number | null {
  if (typeof e === "number") return e;

  if (typeof e === "object") {
    const anyErr = e as { code?: unknown; message?: unknown };
    if (typeof anyErr.code === "number") {
      // Some SDK paths expose the decoded contract code directly.
      if ((ALL_CODES as ReadonlyArray<number>).includes(anyErr.code)) return anyErr.code;
    }
    if (typeof anyErr.message === "string") return fromMessage(anyErr.message);
    const text = String(e);
    if (text !== "[object Object]") return fromMessage(text);
  }

  if (typeof e === "string") return fromMessage(e);

  return null;
}

function fromMessage(message: string): number | null {
  // Matches "ContractError(4)", "contract error 4", "Error(4)", bare "(4)"…
  const m = message.match(/(?:ContractError|error|Error)\D*(\d+)/) ?? message.match(/\((\d+)\)/);
  if (!m) return null;
  return Number.parseInt(m[1]!, 10);
}
