import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluatePaymentAuthorization, parseContractError } from "./passport";
import { PassportStore } from "./passport-store";
import {
  revokePassport as revocationStoreRevoke,
  _reset as _resetRevocation,
} from "./passport/revocation-store";

describe("parseContractError", () => {
  it("maps Soroban contract error codes to generated validator names", () => {
    expect(
      parseContractError(new Error("simulation failed: Error(Contract, #4)")),
    ).toBe("NullifierUsed");
    expect(parseContractError("host trapped with #5")).toBe("InvalidProof");
  });

  it("truncates unknown verbose errors for display", () => {
    const longMessage = "x".repeat(180);

    expect(parseContractError(longMessage)).toHaveLength(141);
    expect(parseContractError(longMessage).endsWith("…")).toBe(true);
  });
});

describe("evaluatePaymentAuthorization", () => {
  it("authorizes an amount equal to the proven spend cap", () => {
    expect(evaluatePaymentAuthorization({ spend_cap: "500", remaining_cap: "500" }, "500")).toEqual({
      authorized: true,
      cap: "500",
      remaining: "500",
      reason: "Within proven spend cap",
    });
  });

  it("rejects amounts above the remaining spend cap", () => {
    expect(evaluatePaymentAuthorization({ spend_cap: "500", remaining_cap: "250" }, "251")).toEqual({
      authorized: false,
      cap: "500",
      remaining: "250",
      reason: "Exceeds remaining spend cap",
    });
  });

  it("rejects missing passports without exposing network details", () => {
    expect(evaluatePaymentAuthorization(undefined, "1")).toEqual({
      authorized: false,
      reason: "No passport — agent not verified",
    });
  });

  it.each(["0", "-1", "1.5", "abc"])(
    "rejects invalid payment amount %s",
    (amount) => {
      expect(
        evaluatePaymentAuthorization({ spend_cap: "500", remaining_cap: "500" }, amount),
      ).toEqual({
        authorized: false,
        cap: "500",
        remaining: "500",
        reason: "Invalid payment amount",
      });
    },
  );
});

describe("PassportStore — spend limits", () => {
  let store: PassportStore;

  afterEach(() => store.reset());

  const config = { spendLimits: { dailyMaxXlm: 100 } };

  it("passes when under daily limit", () => {
    store = new PassportStore();
    expect(store.authorizePassportSpend("agent-1", 20, config)).toEqual({
      ok: true,
    });
    expect(store.authorizePassportSpend("agent-1", 20, config)).toEqual({
      ok: true,
    });
    expect(store.authorizePassportSpend("agent-1", 20, config)).toEqual({
      ok: true,
    });
    expect(store.authorizePassportSpend("agent-1", 20, config)).toEqual({
      ok: true,
    });
    expect(store.authorizePassportSpend("agent-1", 20, config)).toEqual({
      ok: true,
    });
  });

  it("rejects when 6th auth of 20 exceeds daily 100 cap", () => {
    store = new PassportStore();
    for (let i = 0; i < 5; i++)
      store.authorizePassportSpend("agent-2", 20, config);
    expect(store.authorizePassportSpend("agent-2", 20, config)).toEqual({
      ok: false,
      reason: "daily_limit_exceeded",
    });
  });

  it("resets at UTC midnight", () => {
    store = new PassportStore();
    const now = new Date("2025-06-26T12:00:00Z").getTime();
    vi.useFakeTimers({ now });

    for (let i = 0; i < 5; i++)
      store.authorizePassportSpend("agent-3", 20, config);
    expect(store.authorizePassportSpend("agent-3", 20, config)).toEqual({
      ok: false,
      reason: "daily_limit_exceeded",
    });

    vi.setSystemTime(new Date("2025-06-27T00:00:01Z").getTime());
    expect(store.authorizePassportSpend("agent-3", 20, config)).toEqual({
      ok: true,
    });

    vi.useRealTimers();
  });

  it("passes without spendLimits (no cap)", () => {
    store = new PassportStore();
    expect(store.authorizePassportSpend("agent-4", 1e9)).toEqual({ ok: true });
  });
});

describe("PassportStore — spend analytics", () => {
  let store: PassportStore;

  const config = {
    spendLimits: {
      dailyMaxXlm: 50_000_000,
      weeklyMaxXlm: 100_000_000,
    },
  };

  beforeEach(() => {
    store = new PassportStore();
    vi.useFakeTimers({
      now: new Date("2026-06-26T12:00:00.000Z").getTime(),
    });
  });

  afterEach(() => {
    store.reset();
    vi.useRealTimers();
  });

  it("sums successful authorize events and computes remaining stroops", () => {
    store.authorizePassportSpend("bot-42", 5_000_000, config);
    store.authorizePassportSpend("bot-42", 4_000_000, config);
    store.authorizePassportSpend("bot-42", 5_500_000, config);

    expect(store.getSpendAnalytics("bot-42")).toEqual({
      agentId: "bot-42",
      period: {
        dayStart: "2026-06-26T00:00:00.000Z",
        weekStart: "2026-06-22T00:00:00.000Z",
      },
      spent: {
        daily: "14500000",
        weekly: "14500000",
      },
      limits: {
        dailyMaxXlm: "50000000",
        weeklyMaxXlm: "100000000",
      },
      remaining: {
        daily: "35500000",
        weekly: "85500000",
      },
    });
  });

  it("resets daily totals at UTC midnight and weekly totals on Monday UTC", () => {
    vi.setSystemTime(new Date("2026-06-21T23:59:59.000Z"));
    store.authorizePassportSpend("bot-42", 1_000_000, config);
    vi.setSystemTime(new Date("2026-06-22T00:00:00.000Z"));
    store.authorizePassportSpend("bot-42", 2_000_000, config);
    vi.setSystemTime(new Date("2026-06-23T00:00:00.000Z"));
    store.authorizePassportSpend("bot-42", 3_000_000, config);

    expect(store.getSpendAnalytics("bot-42")).toMatchObject({
      period: {
        dayStart: "2026-06-23T00:00:00.000Z",
        weekStart: "2026-06-22T00:00:00.000Z",
      },
      spent: {
        daily: "3000000",
        weekly: "5000000",
      },
    });
  });

  it("returns zero totals for a known passport without spend events", () => {
    store.issuePassport("known-agent", 100_000_000, "hash");

    expect(store.getSpendAnalytics("known-agent")).toMatchObject({
      spent: { daily: "0", weekly: "0" },
      remaining: { daily: "0", weekly: "0" },
    });
  });

  it("returns undefined when the agent has no passport or spend history", () => {
    expect(store.getSpendAnalytics("missing-agent")).toBeUndefined();
  });
});

describe("PassportStore — circuit breaker", () => {
  let store: PassportStore;

  afterEach(() => store.reset());

  it("resets consecutive failures on success", () => {
    store = new PassportStore();
    const config = {
      spendLimits: { dailyMaxXlm: 100 },
      circuitBreaker: { maxConsecutiveFailures: 10 },
    };
    store.authorizePassportSpend("42", 200, config);
    store.authorizePassportSpend("42", 200, config);
    store.authorizePassportSpend("42", 50, config); // success, resets

    for (let i = 0; i < 9; i++) store.authorizePassportSpend("42", 200, config);

    expect(store.authorizePassportSpend("42", 200, config)).toEqual({
      ok: false,
      reason: "circuit_breaker_tripped",
    });
  });

  it("trips after max consecutive failures", () => {
    store = new PassportStore();
    const config = {
      spendLimits: { dailyMaxXlm: 100 },
      circuitBreaker: { maxConsecutiveFailures: 3 },
    };

    store.authorizePassportSpend("42", 200, config);
    store.authorizePassportSpend("42", 200, config);
    expect(store.authorizePassportSpend("42", 200, config)).toEqual({
      ok: false,
      reason: "circuit_breaker_tripped",
    });
  });

  it("returns passport_revoked after trip", () => {
    store = new PassportStore();
    const config = {
      spendLimits: { dailyMaxXlm: 100 },
      circuitBreaker: { maxConsecutiveFailures: 1 },
    };

    store.authorizePassportSpend("42", 200, config);
    expect(store.authorizePassportSpend("42", 200, config)).toEqual({
      ok: false,
      reason: "passport_revoked",
    });
  });

  it("9 failures still active, 10th trips", () => {
    store = new PassportStore();
    const config = {
      spendLimits: { dailyMaxXlm: 100 },
      circuitBreaker: { maxConsecutiveFailures: 10 },
    };

    for (let i = 0; i < 9; i++) {
      store.authorizePassportSpend("42", 200, config);
    }

    expect(store.authorizePassportSpend("42", 200, config)).toEqual({
      ok: false,
      reason: "circuit_breaker_tripped",
    });
  });

  it("success at attempt 5 resets counter", () => {
    store = new PassportStore();
    const config = {
      spendLimits: { dailyMaxXlm: 1000 },
      circuitBreaker: { maxConsecutiveFailures: 10 },
    };

    for (let i = 0; i < 4; i++) store.authorizePassportSpend("42", 200, config);

    store.authorizePassportSpend("42", 50, config);

    for (let i = 0; i < 9; i++) store.authorizePassportSpend("42", 200, config);

    expect(store.authorizePassportSpend("42", 200, config)).toEqual({
      ok: false,
      reason: "circuit_breaker_tripped",
    });
  });
});

describe("PassportStore — expiry", () => {
  let store: PassportStore;

  afterEach(() => {
    store.reset();
    vi.useRealTimers();
  });

  it("issues a passport with correct issuedAt and expiresAt (30-day default TTL)", () => {
    store = new PassportStore();
    vi.useFakeTimers({ now: new Date("2025-01-01T00:00:00.000Z").getTime() });

    const record = store.issuePassport("agent-exp-1", 100, "hash1");

    expect(record.issuedAt).toBe("2025-01-01T00:00:00.000Z");
    expect(record.expiresAt).toBe("2025-01-31T00:00:00.000Z");
    expect(record.spendCapXlm).toBe(100);
    expect(record.agentId).toBe("agent-exp-1");
  });

  it("issues a passport with a custom TTL", () => {
    store = new PassportStore();
    vi.useFakeTimers({ now: new Date("2025-01-01T00:00:00.000Z").getTime() });

    const record = store.issuePassport("agent-exp-ttl", 50, "hash-ttl", 7);

    expect(record.expiresAt).toBe("2025-01-08T00:00:00.000Z");
  });

  it("authorizes spend for a valid (non-expired) passport", () => {
    store = new PassportStore();
    vi.useFakeTimers({ now: new Date("2025-01-01T00:00:00.000Z").getTime() });
    store.issuePassport("agent-exp-2", 100, "hash2");

    // Still within 30-day window
    vi.setSystemTime(new Date("2025-01-15T00:00:00.000Z").getTime());

    expect(store.authorizePassportSpend("agent-exp-2", 50)).toEqual({
      ok: true,
    });
  });

  it("rejects spend for an expired passport", () => {
    store = new PassportStore();
    vi.useFakeTimers({ now: new Date("2025-01-01T00:00:00.000Z").getTime() });
    store.issuePassport("agent-exp-3", 100, "hash3");

    // Advance past the 30-day expiry
    vi.setSystemTime(new Date("2025-02-05T00:00:00.000Z").getTime());

    const result = store.authorizePassportSpend("agent-exp-3", 50);
    expect(result).toEqual({
      ok: false,
      reason: "PassportExpired",
      expiredAt: "2025-01-31T00:00:00.000Z",
    });
  });

  it("does not apply expiry check for agents without a stored passport", () => {
    // Existing tests create stores without calling issuePassport — they must
    // still pass spend-limit / circuit-breaker checks unaffected.
    store = new PassportStore();
    expect(store.authorizePassportSpend("agent-no-record", 10)).toEqual({
      ok: true,
    });
  });

  it("getPassport returns the stored record", () => {
    store = new PassportStore();
    vi.useFakeTimers({ now: new Date("2025-03-01T00:00:00.000Z").getTime() });
    store.issuePassport("agent-get", 200, "hashGet");

    const p = store.getPassport("agent-get");
    expect(p).toBeDefined();
    expect(p!.zkProofHash).toBe("hashGet");
    expect(p!.spendCapXlm).toBe(200);
  });

  it("getPassport returns undefined for unknown agentId", () => {
    store = new PassportStore();
    expect(store.getPassport("nobody")).toBeUndefined();
  });
});

describe("PassportStore — renewal", () => {
  let store: PassportStore;

  afterEach(() => {
    store.reset();
    vi.useRealTimers();
  });

  it("extends expiresAt without changing spendCapXlm", () => {
    store = new PassportStore();
    vi.useFakeTimers({ now: new Date("2025-01-01T00:00:00.000Z").getTime() });
    store.issuePassport("agent-renew-1", 200, "hashR1");

    // Advance past expiry then renew
    vi.setSystemTime(new Date("2025-02-05T00:00:00.000Z").getTime());
    const result = store.renewPassport("agent-renew-1", "hashR1");

    // 2025-02-05 + 30 days = 2025-03-07
    expect(result).toEqual({ ok: true, expiresAt: "2025-03-07T00:00:00.000Z" });

    const passport = store.getPassport("agent-renew-1")!;
    expect(passport.spendCapXlm).toBe(200);
    expect(passport.expiresAt).toBe("2025-03-07T00:00:00.000Z");
  });

  it("authorizes spend after renewal of an expired passport", () => {
    store = new PassportStore();
    vi.useFakeTimers({ now: new Date("2025-01-01T00:00:00.000Z").getTime() });
    store.issuePassport("agent-renew-2", 100, "hashR2");

    vi.setSystemTime(new Date("2025-02-05T00:00:00.000Z").getTime());

    // Confirm expired
    expect(store.authorizePassportSpend("agent-renew-2", 50)).toMatchObject({
      ok: false,
      reason: "PassportExpired",
    });

    // Renew
    const renewal = store.renewPassport("agent-renew-2", "hashR2");
    expect(renewal.ok).toBe(true);

    // Now should pass
    expect(store.authorizePassportSpend("agent-renew-2", 50)).toEqual({
      ok: true,
    });
  });

  it("supports a custom TTL on renewal", () => {
    store = new PassportStore();
    vi.useFakeTimers({ now: new Date("2025-01-01T00:00:00.000Z").getTime() });
    store.issuePassport("agent-renew-ttl", 100, "hashRttl");

    vi.setSystemTime(new Date("2025-02-05T00:00:00.000Z").getTime());
    const result = store.renewPassport("agent-renew-ttl", "hashRttl", 7);

    // 2025-02-05 + 7 days = 2025-02-12
    expect(result).toEqual({ ok: true, expiresAt: "2025-02-12T00:00:00.000Z" });
  });

  it("rejects renewal with wrong zkProofHash", () => {
    store = new PassportStore();
    store.issuePassport("agent-renew-3", 100, "hashR3");

    expect(store.renewPassport("agent-renew-3", "wrongHash")).toEqual({
      ok: false,
      reason: "InvalidProofHash",
    });
  });

  it("rejects renewal for unknown agentId", () => {
    store = new PassportStore();

    expect(store.renewPassport("unknown-agent", "anyHash")).toEqual({
      ok: false,
      reason: "PassportNotFound",
    });
  });
});

describe("PassportStore — revocation via revocation-store", () => {
  let store: PassportStore;

  beforeEach(() => {
    _resetRevocation();
  });

  afterEach(() => {
    store?.reset();
    _resetRevocation();
    vi.useRealTimers();
  });

  it("authorizes spend before passport is revoked", () => {
    store = new PassportStore();
    expect(store.authorizePassportSpend("agent-rv-1", 10)).toEqual({
      ok: true,
    });
  });

  it("returns PassportRevoked after revokePassport() is called", () => {
    store = new PassportStore();
    revocationStoreRevoke("agent-rv-2");
    expect(store.authorizePassportSpend("agent-rv-2", 10)).toEqual({
      ok: false,
      reason: "PassportRevoked",
    });
  });

  it("revocation takes priority over expiry check", () => {
    store = new PassportStore();
    vi.useFakeTimers({ now: new Date("2025-01-01T00:00:00.000Z").getTime() });
    store.issuePassport("agent-rv-3", 100, "hash-rv-3");
    vi.setSystemTime(new Date("2025-02-05T00:00:00.000Z").getTime()); // past expiry
    revocationStoreRevoke("agent-rv-3");
    // Should see PassportRevoked, not PassportExpired
    expect(store.authorizePassportSpend("agent-rv-3", 10)).toEqual({
      ok: false,
      reason: "PassportRevoked",
    });
  });

  it("revocation is case-insensitive and whitespace-tolerant", () => {
    store = new PassportStore();
    revocationStoreRevoke("  AGENT-RV-4  ");
    expect(store.authorizePassportSpend("agent-rv-4", 10)).toEqual({
      ok: false,
      reason: "PassportRevoked",
    });
  });
});
