import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PassportStore } from "./passport-store";
import {
  _reset as resetRevocation,
  isRevoked,
  revokePassport,
} from "./passport/revocation-store";

describe("PassportStore — multi-context passports", () => {
  let store: PassportStore;

  beforeEach(() => {
    store = new PassportStore();
    resetRevocation();
    vi.useFakeTimers({ now: new Date("2026-06-27T00:00:00.000Z").getTime() });
  });

  afterEach(() => {
    store.reset();
    vi.useRealTimers();
  });

  it("lists both passports when the same agent has two service contexts", () => {
    store.issuePassport("agent-multi", 100, "hash-default");
    store.issuePassport(
      "agent-multi",
      200,
      "hash-data",
      30,
      undefined,
      "data-access",
    );

    const passports = store.listPassports("agent-multi");

    expect(passports).toHaveLength(2);
    expect(passports.map((passport) => passport.serviceContext).sort()).toEqual([
      "data-access",
      "default",
    ]);
  });

  it("keeps the other context active when one context is revoked", () => {
    store.issuePassport("agent-multi", 100, "hash-default");
    store.issuePassport(
      "agent-multi",
      200,
      "hash-data",
      30,
      undefined,
      "data-access",
    );

    revokePassport("agent-multi", "data-access");

    expect(isRevoked("agent-multi", "data-access")).toBe(true);
    expect(isRevoked("agent-multi", "default")).toBe(false);
    expect(store.getPassport("agent-multi", "default")).toMatchObject({
      serviceContext: "default",
    });
  });
});
