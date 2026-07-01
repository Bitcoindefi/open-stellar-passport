// sdk/src/PassportClient.ts
import {
  Client,
  type VerifyInput,
  type VerifyResult,
  type Groth16Proof,
  networks,
} from "../bindings/src/index.js";

/**
 * Errors surfaced by the PassportValidator contract.
 */
export enum PassportError {
  NotInitialized = "NotInitialized",
  AlreadyInitialized = "AlreadyInitialized",
  BadPublicInputs = "BadPublicInputs",
  NullifierUsed = "NullifierUsed",
  InvalidProof = "InvalidProof",
  BatchTooLarge = "BatchTooLarge",
  UnknownRegistryRoot = "UnknownRegistryRoot",
  RateLimitExceeded = "RateLimitExceeded",
  Unknown = "Unknown",
}

/**
 * Typed rate limit error with retry estimate.
 */
export class RateLimitError extends Error {
  public readonly retryAfterLedgers: number;
  public readonly code: string;

  constructor(retryAfterLedgers: number) {
    super(`Rate limit exceeded. Retry after ${retryAfterLedgers} ledgers.`);
    this.name = "RateLimitError";
    this.code = "RateLimitExceeded";
    this.retryAfterLedgers = retryAfterLedgers;
  }
}

export type VerifyCredentialInput = {
  /** registry root, 32 bytes */
  root: Buffer;
  /** Groth16 proof bytes */
  proof: Buffer;
  /** circuit public inputs (as field elements) */
  publicInputs: bigint[];
  /** optional unix timestamp */
  expiryDateUnix?: number;
};

export type VerifyBatchInput = VerifyInput;

export type VerifyBatchResult = VerifyResult & {
  /** mapped error */
  error?: PassportError;
};

const mapSymbolToPassportError = (err: unknown): PassportError | undefined => {
  if (typeof err !== "string") return undefined;
  switch (err) {
    case "NotInitialized":
      return PassportError.NotInitialized;
    case "AlreadyInitialized":
      return PassportError.AlreadyInitialized;
    case "BadPublicInputs":
      return PassportError.BadPublicInputs;
    case "NullifierUsed":
      return PassportError.NullifierUsed;
    case "InvalidProof":
      return PassportError.InvalidProof;
    case "BatchTooLarge":
      return PassportError.BatchTooLarge;
    case "UnknownRegistryRoot":
      return PassportError.UnknownRegistryRoot;
    case "RateLimitExceeded":
      return PassportError.RateLimitExceeded;
    default:
      return PassportError.Unknown;
  }
};

/**
 * Check if an error is a rate limit error and return typed info.
 */
export function parseRateLimitError(err: unknown): RateLimitError | null {
  if (err instanceof Error && err.message.includes("RateLimitExceeded")) {
    // Extract retry estimate from error if available, default to window size
    return new RateLimitError(10);
  }
  if (typeof err === "string" && err.includes("RateLimitExceeded")) {
    return new RateLimitError(10);
  }
  return null;
}

export class PassportClient {
  private readonly typed: Client;

  constructor(rpc: unknown, contractId: string) {
    this.typed = new Client({
      contractId,
      networkPassphrase: networks.testnet.networkPassphrase,
      rpcUrl: (rpc as any)?.rpcUrl ?? "",
    });
  }

  async verifyCredential(
    input: VerifyCredentialInput,
  ): Promise<{ success: boolean; error?: string }> {
    const proofs: VerifyInput[] = [
      {
        proof: input.proof as unknown as Groth16Proof,
        public_inputs: input.publicInputs.map((x) => BigInt(x)),
      },
    ];

    try {
      const tx = await this.typed.verify_batch({ proofs });
      const { result } = await tx.signAndSend();
      const arr = (result.unwrap?.() ?? result) as VerifyResult[];

      const r0 = arr[0];
      if (!r0?.success) {
        const mapped = mapSymbolToPassportError(r0?.error);
        if (mapped === PassportError.RateLimitExceeded) {
          throw new RateLimitError(10);
        }
        return { success: false, error: r0?.error ?? undefined };
      }
      return { success: true };
    } catch (err) {
      const rateLimit = parseRateLimitError(err);
      if (rateLimit) throw rateLimit;
      throw err;
    }
  }

  async verifyBatch(inputs: VerifyBatchInput[]): Promise<VerifyBatchResult[]> {
    const BATCH_LIMIT = 8;
    const out: VerifyBatchResult[] = [];

    for (let i = 0; i < inputs.length; i += BATCH_LIMIT) {
      const chunk = inputs.slice(i, i + BATCH_LIMIT);
      try {
        const tx = await this.typed.verify_batch({ proofs: chunk });
        const { result } = await tx.signAndSend();
        const resArr = (result.unwrap?.() ?? result) as VerifyResult[];

        for (const r of resArr) {
          out.push({
            ...r,
            error: r.success ? undefined : mapSymbolToPassportError(r.error),
          });
        }
      } catch (err) {
        const rateLimit = parseRateLimitError(err);
        if (rateLimit) throw rateLimit;
        throw err;
      }
    }

    return out;
  }
}
