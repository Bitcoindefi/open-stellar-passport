import { Client, type VerifyInput, type VerifyResult, type Groth16Proof, networks } from "../bindings/src/index.js";

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
  Unknown = "Unknown",
}

export type VerifyCredentialInput = {
  /** registry root, 32 bytes */
  root: Buffer;
  /** Groth16 proof bytes (implementation-specific packing) */
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

export type PassportClientOptions = {
  baseUrl?: string;
  apiKey?: string;
  revocationCacheMs?: number;
  rpc?: unknown;
  contractId?: string;
};

type PassportRevocationCacheEntry = {
  value: boolean;
  expires: number;
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
    default:
      return PassportError.Unknown;
  }
};

/**
 * Typed client for the Agent Passport validator contract.
 *
 * This SDK currently implements the required functionality using the
 * generated typed contract bindings under `sdk/bindings`.
 */
export class PassportClient {
  private readonly typed?: Client;
  private readonly baseUrl?: string;
  private readonly apiKey?: string;
  private readonly revocationCacheMs: number;
  private readonly revocationCache = new Map<string, PassportRevocationCacheEntry>();

  /**
   * @param rpcOrOptions - Soroban RPC server instance or client options.
   * @param contractId - validator contract ID when using the legacy constructor.
   */
  constructor(rpcOrOptions: unknown, contractId?: string) {
    const hasOptions =
      typeof rpcOrOptions === "object" &&
      rpcOrOptions !== null &&
      contractId === undefined;
    const options = hasOptions ? (rpcOrOptions as PassportClientOptions) : undefined;

    this.baseUrl = options?.baseUrl;
    this.apiKey = options?.apiKey;
    this.revocationCacheMs = options?.revocationCacheMs ?? 60_000;

    const resolvedContractId = contractId ?? options?.contractId;
    const resolvedRpc = contractId !== undefined ? rpcOrOptions : options?.rpc;

    if (resolvedContractId) {
      this.typed = new Client({
        contractId: resolvedContractId,
        networkPassphrase: networks.testnet.networkPassphrase,
        rpcUrl: (resolvedRpc as any)?.rpcUrl ?? "",
      });
    }

    if (!this.typed && !this.baseUrl) {
      throw new Error(
        "PassportClient requires either rpc+contractId or baseUrl for revocation checks",
      );
    }
  }

  /**
   * Verify a single credential proof.
   *
   * Note: the contract interface exposes `verify_batch`; this method submits
   * a single-element batch and returns the first result.
   *
   * @param input - proof + public inputs.
   * @returns typed result indicating success and optional error.
   */
  async verifyCredential(
    input: VerifyCredentialInput,
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.typed) {
      throw new Error(
        "PassportClient must be created with rpc+contractId to verify credentials",
      );
    }

    const proofs: VerifyInput[] = [
      {
        proof: input.proof as unknown as Groth16Proof,
        public_inputs: input.publicInputs.map((x) => BigInt(x)),
      },
    ];

    const tx = await this.typed.verify_batch({ proofs });
    const { result } = await tx.signAndSend();
    const arr = (result.unwrap?.() ?? result) as VerifyResult[];

    const r0 = arr[0];
    if (!r0?.success) return { success: false, error: r0?.error ?? undefined };
    return { success: true };
  }

  /**
   * Verify multiple proofs.
   *
   * Automatically splits into chunks of 8 to respect the contract's batch
   * limit.
   */
  async verifyBatch(inputs: VerifyBatchInput[]): Promise<VerifyBatchResult[]> {
    if (!this.typed) {
      throw new Error(
        "PassportClient must be created with rpc+contractId to verify batch proofs",
      );
    }

    const BATCH_LIMIT = 8;
    const out: VerifyBatchResult[] = [];

    for (let i = 0; i < inputs.length; i += BATCH_LIMIT) {
      const chunk = inputs.slice(i, i + BATCH_LIMIT);
      const tx = await this.typed.verify_batch({ proofs: chunk });
      const { result } = await tx.signAndSend();
      const resArr = (result.unwrap?.() ?? result) as VerifyResult[];

      for (const r of resArr) {
        out.push({
          ...r,
          error: r.success ? undefined : mapSymbolToPassportError(r.error),
        });
      }
    }

    return out;
  }

  async isRevoked(passportId: string): Promise<boolean>;
  async isRevoked(root: Buffer): Promise<boolean>;
  async isRevoked(identifier: string | Buffer): Promise<boolean> {
    if (typeof identifier === "string") {
      return this.isRevokedByPassportId(identifier);
    }

    return this.isRevokedByRoot(identifier);
  }

  private async isRevokedByPassportId(passportId: string): Promise<boolean> {
    if (!this.baseUrl) {
      throw new Error(
        "PassportClient must be created with baseUrl to check passport revocation by ID",
      );
    }

    const now = Date.now();
    const cached = this.revocationCache.get(passportId);
    if (cached && cached.expires >= now) {
      return cached.value;
    }

    const url = new URL(
      `/api/protocol/passport/${encodeURIComponent(passportId)}`,
      this.baseUrl,
    );

    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch passport status: ${response.status}`);
    }

    const body = (await response.json()) as { status?: unknown };
    const revoked = body.status === "revoked";
    this.revocationCache.set(passportId, {
      value: revoked,
      expires: revoked ? Infinity : now + this.revocationCacheMs,
    });

    return revoked;
  }

  /**
   * Check whether a registry root has been revoked.
   *
   * The contract does not expose a dedicated `is_revoked` read method; this
   * scans the audit log entries for a matching `revoke` action.
   */
  private async isRevokedByRoot(root: Buffer): Promise<boolean> {
    if (!this.typed) {
      throw new Error(
        "PassportClient must be created with rpc+contractId to check root revocation",
      );
    }

    const count = await this.typed.audit_count();
    const total = count.result ?? count;

    for (let i = 0n; i < total; i++) {
      const tx = await this.typed.get_audit_entry({ seq: i });
      const rec = tx.result ?? undefined;
      if (!rec) continue;
      if (rec.action === "revoke" && Buffer.isBuffer(rec.root) && rec.root.equals(root)) {
        return true;
      }
    }

    return false;
  }
}

