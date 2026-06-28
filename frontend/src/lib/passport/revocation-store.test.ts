import { describe, expect, it, beforeEach } from "vitest";
import { revokePassport, isRevoked, _reset } from "./revocation-store";

describe("revocation-store", () => {
  beforeEach(() => _reset());

  it("returns false for an agent that has not been revoked", () => {
    expect(isRevoked("agent-1")).toBe(false);
  });

  it("returns true immediately after revoking an agent", () => {
    revokePassport("agent-2");
    expect(isRevoked("agent-2")).toBe(true);
  });

  it("is idempotent — revoking twice does not throw and stays revoked", () => {
    revokePassport("agent-3");
    revokePassport("agent-3");
    expect(isRevoked("agent-3")).toBe(true);
  });

  it("is case-insensitive on isRevoked", () => {
    revokePassport("Agent-4");
    expect(isRevoked("agent-4")).toBe(true);
    expect(isRevoked("AGENT-4")).toBe(true);
    expect(isRevoked("Agent-4")).toBe(true);
  });

  it("is case-insensitive on revokePassport", () => {
    revokePassport("AGENT-5");
    expect(isRevoked("agent-5")).toBe(true);
  });

  it("trims whitespace from agentId before checking revocation", () => {
    revokePassport("  agent-6  ");
    expect(isRevoked("agent-6")).toBe(true);
    expect(isRevoked("  agent-6  ")).toBe(true);
  });

  it("trims whitespace from agentId before revoking", () => {
    revokePassport("agent-7");
    expect(isRevoked("  agent-7  ")).toBe(true);
  });

  it("does not affect other agents when one is revoked", () => {
    revokePassport("agent-8");
    expect(isRevoked("agent-9")).toBe(false);
  });

  it("does not affect other service contexts for the same agent", () => {
    revokePassport("agent-8", "data-access");
    expect(isRevoked("agent-8", "data-access")).toBe(true);
    expect(isRevoked("agent-8", "payment-routing")).toBe(false);
    expect(isRevoked("agent-8")).toBe(false);
  });

  it("_reset clears the registry between tests", () => {
    revokePassport("agent-10");
    _reset();
    expect(isRevoked("agent-10")).toBe(false);
  });
});
