/**
 * High-level Agent Passport SDK: prove client-side, then mint / read the
 * on-chain attestation through the typed AgentPassportValidator client.
 */
import {
  Client,
  networks,
  type Attestation,
  type VerifyInput,
  type VerifyResult,
} from "../bindings/src/index.js";
import type { ClientOptions } from "@stellar/stellar-sdk/contract";
import {
  generatePassportProof,
  type PassportArtifacts,
  type PassportWitness,
  type SorobanProof,
} from "./prover.js";

export interface AgentPassportConfig {
  /** Soroban RPC endpoint, e.g. https://soroban-testnet.stellar.org */
  rpcUrl: string;
  /** Deployed AgentPassportValidator id. Defaults to the testnet deployment. */
  contractId?: string;
  /** Network passphrase. Defaults to testnet. */
  networkPassphrase?: string;
  /** Circuit artifacts used for client-side proving. */
  artifacts: PassportArtifacts;
  /** Signer for state-changing calls (e.g. Freighter / a server keypair). */
  publicKey?: string;
  signTransaction?: ClientOptions["signTransaction"];
}

export class AgentPassport {
  readonly client: Client;
  private readonly artifacts: PassportArtifacts;

  constructor(cfg: AgentPassportConfig) {
    this.artifacts = cfg.artifacts;
    this.client = new Client({
      contractId: cfg.contractId ?? networks.testnet.contractId,
      networkPassphrase: cfg.networkPassphrase ?? networks.testnet.networkPassphrase,
      rpcUrl: cfg.rpcUrl,
      publicKey: cfg.publicKey,
      signTransaction: cfg.signTransaction,
    });
  }

  /** Prove the passport claims client-side (secrets never leave here). */
  prove(witness: PassportWitness): Promise<SorobanProof> {
    return generatePassportProof(witness, this.artifacts);
  }

  /**
   * Verify multiple proofs in a single call (or multiple calls if > 8).
   * Splits into chunks of 8 automatically to stay within Soroban limits.
   * Returns results for all proofs; doesn't short-circuit on first failure.
   */
  async batchVerify(inputs: SorobanProof[]): Promise<VerifyResult[]> {
    const BATCH_LIMIT = 8;
    const allResults: VerifyResult[] = [];

    for (let i = 0; i < inputs.length; i += BATCH_LIMIT) {
      const chunk = inputs.slice(i, i + BATCH_LIMIT);
      const verifyInputs: VerifyInput[] = chunk.map((p) => ({
        proof: p.proof,
        public_inputs: p.publicInputs.map((s) => BigInt(s)),
      }));

      const tx = await this.client.verify_batch({ proofs: verifyInputs });
      const { result } = await tx.signAndSend();
      allResults.push(...result.unwrap());
    }

    return allResults;
  }

  /**
   * Submit a proof to mint the agent's passport. Returns the stored attestation.
   * Throws `NullifierUsed` if replayed, `InvalidProof` if the proof is unsound.
   */
  async register(p: SorobanProof): Promise<Attestation> {
    const tx = await this.client.verify_and_register({
      proof: p.proof,
      public_inputs: p.publicInputs.map((s) => BigInt(s)),
    });
    const { result } = await tx.signAndSend();
    return result.unwrap();
  }

  /** Prove + register in one call. */
  async proveAndRegister(witness: PassportWitness): Promise<Attestation> {
    return this.register(await this.prove(witness));
  }

  /** Does this agent hold a valid passport? (read-only simulation) */
  async isRegistered(agentId: bigint | string): Promise<boolean> {
    const tx = await this.client.is_registered({ agent_id: BigInt(agentId) });
    return tx.result;
  }

  /** Fetch the stored attestation, or undefined. */
  async getPassport(agentId: bigint | string): Promise<Attestation | undefined> {
    const tx = await this.client.get_passport({ agent_id: BigInt(agentId) });
    return tx.result ?? undefined;
  }

  /** Has this nullifier already been spent? */
  async isNullifierUsed(nullifier: bigint | string): Promise<boolean> {
    const tx = await this.client.is_nullifier_used({ nullifier: BigInt(nullifier) });
    return tx.result;
  }

  /**
   * The x402 gate: settle only if the agent has a passport whose proven spend
   * cap covers `amount`. This is the one call a payment hub needs.
   */
  async authorizePayment(agentId: bigint | string, amount: bigint | string): Promise<boolean> {
    const passport = await this.getPassport(agentId);
    if (!passport) return false;
    return BigInt(passport.spend_cap) >= BigInt(amount);
  }
}
