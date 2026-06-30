import { Contract, SorobanRpc, xdr } from "@stellar/stellar-sdk";
import { RateLimitError } from "./errors";

export interface VerifyOptions {
  caller: string; // Stellar address
  proof: Groth16Proof;
  publicInputs: string[];
}

export class AgentPassportSdk {
  private contract: Contract;
  private rpc: SorobanRpc.Server;

  constructor(contractId: string, rpcUrl: string) {
    this.contract = new Contract(contractId);
    this.rpc = new SorobanRpc.Server(rpcUrl);
  }

  async verifyAndRegister(
    caller: string,
    proof: Groth16Proof,
    publicInputs: string[]
  ): Promise<Attestation> {
    try {
      const tx = await this.buildTransaction("verify_and_register", [
        xdr.ScVal.scvAddress(caller),
        proof.toScVal(),
        publicInputs.map((pi) => xdr.ScVal.scvU256(BigInt(pi))),
      ]);
      const result = await this.rpc.simulateTransaction(tx);
      
      if (SorobanRpc.Api.isSimulationError(result)) {
        const errorCode = this.parseErrorCode(result.error);
        const rateLimitErr = RateLimitError.fromContractError(errorCode);
        if (rateLimitErr) throw rateLimitErr;
        throw new Error(`Simulation failed: ${result.error}`);
      }

      return this.parseAttestation(result);
    } catch (err) {
      if (err instanceof RateLimitError) throw err;
      throw new Error(`verify_and_register failed: ${err}`);
    }
  }

  async setRateLimit(maxCalls: number, adminSigner: any): Promise<void> {
    const tx = await this.buildTransaction("set_rate_limit", [
      xdr.ScVal.scvU32(maxCalls),
    ]);
    // ... sign and submit with adminSigner
  }

  async getRateLimit(): Promise<{ maxCalls: number; windowLedgers: number }> {
    const tx = await this.buildTransaction("get_rate_limit", []);
    // ... simulate and parse
    return { maxCalls: 10, windowLedgers: 10 };
  }

  private parseErrorCode(error: string): number {
    // Parse Soroban error format to extract the numeric code
    const match = error.match(/Error\(Contract, #(\d+)\)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  // ... other existing methods ...
}