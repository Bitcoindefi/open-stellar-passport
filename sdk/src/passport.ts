import { Client, networks, type Attestation, type AuditRecord } from "../bindings/src/index.js";
import type { ClientOptions } from "@stellar/stellar-sdk/contract";
import {
  generatePassportProof,
  type PassportArtifacts,
  type PassportWitness,
  type SorobanProof,
} from "./prover.js";

export interface SpendLimits {
  dailyMaxXlm?: number;
  weeklyMaxXlm?: number;
}

export interface CircuitBreakerConfig {
  maxConsecutiveFailures: number;
}

export interface AgentPassportConfig {
  rpcUrl: string;
  contractId?: string;
  networkPassphrase?: string;
  artifacts: PassportArtifacts;
  circuitBreaker?: CircuitBreakerConfig;
  publicKey?: string;
  signTransaction?: ClientOptions["signTransaction"];
}

export function parsePositivePaymentAmount(amount: bigint | string): bigint | undefined {
  if (typeof amount === "bigint") return amount > 0n ? amount : undefined;
  if (!/^[0-9]+$/.test(amount)) return undefined;

  const parsed = BigInt(amount);
  return parsed > 0n ? parsed : undefined;
}

export class AgentPassport {
  readonly client: Client;
  private readonly artifacts: PassportArtifacts;
  private readonly circuitBreaker?: CircuitBreakerConfig;
  private consecutiveFailures = 0;
  private revoked = false;

  readonly auditLog = {
    count: async (): Promise<bigint> => {
      const tx = await this.client.audit_count();
      return tx.result;
    },
    get: async (seq: bigint): Promise<AuditRecord | null> => {
      const tx = await this.client.get_audit_entry({ seq });
      return tx.result ?? null;
    },
    range: async (from: bigint, to: bigint): Promise<AuditRecord[]> => {
      if (from < 0n || to < from) {
        return [];
      }
      const limit = 50n;
      let actualTo = to;
      if (actualTo - from >= limit) {
        actualTo = from + limit - 1n;
      }
      const promises: Promise<AuditRecord | null>[] = [];
      for (let seq = from; seq <= actualTo; seq++) {
        promises.push(this.auditLog.get(seq));
      }
      const results = await Promise.all(promises);
      return results.filter((r): r is AuditRecord => r !== null);
    },
  };

  constructor(cfg: AgentPassportConfig) {
    this.artifacts = cfg.artifacts;
    this.circuitBreaker = cfg.circuitBreaker;
    this.client = new Client({
      contractId: cfg.contractId ?? networks.testnet.contractId,
      networkPassphrase: cfg.networkPassphrase ?? networks.testnet.networkPassphrase,
      rpcUrl: cfg.rpcUrl,
      publicKey: cfg.publicKey,
      signTransaction: cfg.signTransaction,
    });
  }

  prove(witness: PassportWitness): Promise<SorobanProof> {
    return generatePassportProof(witness, this.artifacts);
  }

  async register(p: SorobanProof): Promise<Attestation> {
    const tx = await this.client.verify_and_register({
      proof: p.proof,
      public_inputs: p.publicInputs.map((s) => BigInt(s)),
    });
    const { result } = await tx.signAndSend();
    return result.unwrap();
  }

  async proveAndRegister(witness: PassportWitness): Promise<Attestation> {
    return this.register(await this.prove(witness));
  }

  async isRegistered(agentId: bigint | string): Promise<boolean> {
    const tx = await this.client.is_registered({ agent_id: BigInt(agentId) });
    return tx.result;
  }

  async getPassport(agentId: bigint | string): Promise<Attestation | undefined> {
    const tx = await this.client.get_passport({ agent_id: BigInt(agentId) });
    return tx.result ?? undefined;
  }

  async isNullifierUsed(nullifier: bigint | string): Promise<boolean> {
    const tx = await this.client.is_nullifier_used({ nullifier: BigInt(nullifier) });
    return tx.result;
  }

  async authorizePayment(agentId: bigint | string, amount: bigint | string): Promise<boolean> {
    const parsedAmount = parsePositivePaymentAmount(amount);
    if (!parsedAmount) return false;

    const passport = await this.getPassport(agentId);
    if (!passport) return false;
    return BigInt(passport.spend_cap) >= parsedAmount;
  }

  authorizeSpend(
    agentId: bigint | string,
    amount: number,
    spendLimits?: SpendLimits,
  ): { ok: boolean; reason?: string } {
    if (this.revoked) return { ok: false, reason: "passport_revoked" };

    const result = authorizePassportSpend(String(agentId), amount, spendLimits);

    if (this.circuitBreaker) {
      if (result.ok) {
        this.consecutiveFailures = 0;
      } else {
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= this.circuitBreaker.maxConsecutiveFailures) {
          this.revoked = true;
          console.log(`[audit] passport_revoked agentId=${agentId} reason=circuit_breaker_tripped`);
          return { ok: false, reason: "circuit_breaker_tripped" };
        }
      }
    }

    return result;
  }
}

// ------------------------------------------------------------------ in-memory audit log

interface AuthorizeEvent {
  agentId: string;
  amount: number;
  ok: boolean;
  timestamp: number;
}

const events: AuthorizeEvent[] = [];

function utcDayStart(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function utcWeekStart(ts: number): number {
  const d = new Date(ts);
  const day = d.getUTCDay();
  const mon = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), mon);
}

export function authorizePassportSpend(
  agentId: string,
  amount: number,
  spendLimits?: SpendLimits,
): { ok: boolean; reason?: string } {
  const now = Date.now();

  if (!spendLimits?.dailyMaxXlm && !spendLimits?.weeklyMaxXlm) {
    events.push({ agentId, amount, ok: true, timestamp: now });
    return { ok: true };
  }

  const dayStart = utcDayStart(now);
  const weekStart = utcWeekStart(now);

  const daySum = events
    .filter(e => e.agentId === agentId && e.ok && e.timestamp >= dayStart)
    .reduce((s, e) => s + e.amount, 0);

  const weekSum = events
    .filter(e => e.agentId === agentId && e.ok && e.timestamp >= weekStart)
    .reduce((s, e) => s + e.amount, 0);

  if (spendLimits.dailyMaxXlm != null && daySum + amount > spendLimits.dailyMaxXlm) {
    events.push({ agentId, amount, ok: false, timestamp: now });
    return { ok: false, reason: 'daily_limit_exceeded' };
  }

  if (spendLimits.weeklyMaxXlm != null && weekSum + amount > spendLimits.weeklyMaxXlm) {
    events.push({ agentId, amount, ok: false, timestamp: now });
    return { ok: false, reason: 'weekly_limit_exceeded' };
  }

  events.push({ agentId, amount, ok: true, timestamp: now });
  return { ok: true };
}
