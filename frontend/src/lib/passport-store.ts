import { isRevoked } from "./passport/revocation-store";

export const DEFAULT_PASSPORT_TTL_DAYS = Number(process.env.PASSPORT_TTL_DAYS ?? 30);

export interface PassportRecord {
  agentId: string;
  issuedAt: string;   // ISO timestamp
  expiresAt: string;  // ISO timestamp — issuedAt + TTL_DAYS
  spendCapXlm: number;
  zkProofHash: string;
}

export interface SpendLimits {
  dailyMaxXlm?: number;
  weeklyMaxXlm?: number;
}

export interface CircuitBreakerConfig {
  maxConsecutiveFailures: number;
}

export interface PassportConfig {
  spendLimits?: SpendLimits;
  circuitBreaker?: CircuitBreakerConfig;
}

interface AuthorizeEvent {
  agentId: string;
  amount: number;
  ok: boolean;
  timestamp: number;
}

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

export class PassportStore {
  private events: AuthorizeEvent[] = [];
  private cbStates = new Map<string, { failures: number; revoked: boolean }>();
  private passports = new Map<string, PassportRecord>();

  // ------------------------------------------------------------------ issuance

  /**
   * Creates and stores a new PassportRecord with issuedAt = now and
   * expiresAt = now + ttlDays.
   */
  issuePassport(
    agentId: string,
    spendCapXlm: number,
    zkProofHash: string,
    ttlDays = DEFAULT_PASSPORT_TTL_DAYS,
  ): PassportRecord {
    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(
      Date.now() + ttlDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const record: PassportRecord = { agentId, issuedAt, expiresAt, spendCapXlm, zkProofHash };
    this.passports.set(agentId, record);
    return record;
  }

  /** Returns the stored passport for an agent, or undefined if not found. */
  getPassport(agentId: string): PassportRecord | undefined {
    return this.passports.get(agentId);
  }

  /**
   * Re-issues a new expiresAt from now without changing spendCapXlm.
   * Requires the matching zkProofHash to prevent unauthorized extensions.
   */
  renewPassport(
    agentId: string,
    zkProofHash: string,
    ttlDays = DEFAULT_PASSPORT_TTL_DAYS,
  ): { ok: true; expiresAt: string } | { ok: false; reason: string } {
    const passport = this.passports.get(agentId);
    if (!passport) return { ok: false, reason: "PassportNotFound" };
    if (passport.zkProofHash !== zkProofHash) return { ok: false, reason: "InvalidProofHash" };

    passport.expiresAt = new Date(
      Date.now() + ttlDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    return { ok: true, expiresAt: passport.expiresAt };
  }

  // ------------------------------------------------------------------ registration

  register(agentId: string, config?: PassportConfig): void {
    if (config?.circuitBreaker) {
      this.cbStates.set(agentId, { failures: 0, revoked: false });
    }
  }

  /** Internal helper: trips the circuit-breaker revoked flag for an agent. */
  private _cbRevoke(agentId: string): void {
    const state = this.cbStates.get(agentId);
    if (!state) return;
    state.revoked = true;
  }

  // ------------------------------------------------------------------ authorization

  authorizePassportSpend(
    agentId: string,
    amount: number,
    config?: PassportConfig,
  ): { ok: boolean; reason?: string; expiredAt?: string } {
    // Revocation check — must be the very first guard
    if (isRevoked(agentId)) {
      return { ok: false, reason: "PassportRevoked" };
    }

    // Expiry check
    const passport = this.passports.get(agentId);
    if (passport && new Date(passport.expiresAt) < new Date()) {
      return { ok: false, reason: "PassportExpired", expiredAt: passport.expiresAt };
    }

    if (config?.circuitBreaker && !this.cbStates.has(agentId)) {
      this.cbStates.set(agentId, { failures: 0, revoked: false });
    }
    const cbState = this.cbStates.get(agentId);

    if (cbState?.revoked) return { ok: false, reason: "passport_revoked" };

    const now = Date.now();
    const hasLimits = !!(config?.spendLimits?.dailyMaxXlm || config?.spendLimits?.weeklyMaxXlm);

    if (hasLimits) {
      const sl = config.spendLimits!;
      const dayStart = utcDayStart(now);
      const weekStart = utcWeekStart(now);

      const daySum = this.events
        .filter((e) => e.agentId === agentId && e.ok && e.timestamp >= dayStart)
        .reduce((s, e) => s + e.amount, 0);

      const weekSum = this.events
        .filter((e) => e.agentId === agentId && e.ok && e.timestamp >= weekStart)
        .reduce((s, e) => s + e.amount, 0);

      if (sl.dailyMaxXlm != null && daySum + amount > sl.dailyMaxXlm) {
        this.events.push({ agentId, amount, ok: false, timestamp: now });
        return this.fail(agentId, cbState, config);
      }

      if (sl.weeklyMaxXlm != null && weekSum + amount > sl.weeklyMaxXlm) {
        this.events.push({ agentId, amount, ok: false, timestamp: now });
        return this.fail(agentId, cbState, config);
      }

      this.events.push({ agentId, amount, ok: true, timestamp: now });
      if (cbState) cbState.failures = 0;
      return { ok: true };
    }

    this.events.push({ agentId, amount, ok: true, timestamp: now });
    if (cbState) {
      cbState.failures++;
      if (cbState.failures >= config!.circuitBreaker!.maxConsecutiveFailures) {
        this._cbRevoke(agentId);
        return { ok: false, reason: "circuit_breaker_tripped" };
      }
    }
    return { ok: true };
  }

  private fail(
    agentId: string,
    cbState: { failures: number; revoked: boolean } | undefined,
    config: PassportConfig,
  ): { ok: false; reason: string } {
    if (!cbState) return { ok: false, reason: "daily_limit_exceeded" };
    cbState.failures++;
    if (cbState.failures >= config.circuitBreaker!.maxConsecutiveFailures) {
      this._cbRevoke(agentId);
      return { ok: false, reason: "circuit_breaker_tripped" };
    }
    return { ok: false, reason: "exceeds_spend_limit" };
  }

  getAllPassports(): PassportRecord[] {
    return Array.from(this.passports.values());
  }

  getPassportCount(): number {
    return this.passports.size;
  }

  reset(): void {
    this.events.length = 0;
    this.cbStates.clear();
    this.passports.clear();
  }
}

/** Singleton store shared across API routes. */
export const globalPassportStore = new PassportStore();
