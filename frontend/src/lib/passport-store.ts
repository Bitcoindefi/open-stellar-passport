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

  register(agentId: string, config?: PassportConfig): void {
    if (config?.circuitBreaker) {
      this.cbStates.set(agentId, { failures: 0, revoked: false });
    }
  }

  revokePassport(agentId: string): void {
    const state = this.cbStates.get(agentId);
    if (!state) return;
    state.revoked = true;
  }

  authorizePassportSpend(
    agentId: string,
    amount: number,
    config?: PassportConfig,
  ): { ok: boolean; reason?: string } {
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
        this.revokePassport(agentId);
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
      this.revokePassport(agentId);
      return { ok: false, reason: "circuit_breaker_tripped" };
    }
    return { ok: false, reason: "exceeds_spend_limit" };
  }

  reset(): void {
    this.events.length = 0;
    this.cbStates.clear();
  }
}
