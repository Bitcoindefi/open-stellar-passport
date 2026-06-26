import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluatePaymentAuthorization, parseContractError } from "./passport";
import { PassportStore } from "./passport-store";

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
    expect(evaluatePaymentAuthorization({ spend_cap: "500" }, "500")).toEqual({
      authorized: true,
      cap: "500",
      reason: "Within proven spend cap",
    });
  });

  it("rejects amounts above the proven spend cap", () => {
    expect(evaluatePaymentAuthorization({ spend_cap: "500" }, "501")).toEqual({
      authorized: false,
      cap: "500",
      reason: "Exceeds proven spend cap",
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
      expect(evaluatePaymentAuthorization({ spend_cap: "500" }, amount)).toEqual({
        authorized: false,
        cap: "500",
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

    for (let i = 0; i < 9; i++)
      store.authorizePassportSpend("42", 200, config);

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

    for (let i = 0; i < 4; i++)
      store.authorizePassportSpend("42", 200, config);

    store.authorizePassportSpend("42", 50, config);

    for (let i = 0; i < 9; i++)
      store.authorizePassportSpend("42", 200, config);

    expect(store.authorizePassportSpend("42", 200, config)).toEqual({
      ok: false,
      reason: "circuit_breaker_tripped",
    });
  });
});
