import { describe, expect, it } from "vitest";
import { PassportError, parsePassportError } from "./errors";

describe("PassportError enum", () => {
  it("matches the contract error codes one-to-one", () => {
    expect(PassportError.NotInitialized).toBe(1);
    expect(PassportError.AlreadyInitialized).toBe(2);
    expect(PassportError.BadPublicInputs).toBe(3);
    expect(PassportError.NullifierUsed).toBe(4);
    expect(PassportError.InvalidProof).toBe(5);
    expect(PassportError.UnknownRegistryRoot).toBe(6);
    expect(PassportError.BatchTooLarge).toBe(7);
    expect(PassportError.RateLimitExceeded).toBe(8);
  });
});

describe("parsePassportError", () => {
  it.each([
    ["ContractError(1)", PassportError.NotInitialized],
    ["ContractError(2)", PassportError.AlreadyInitialized],
    ["ContractError(3)", PassportError.BadPublicInputs],
    ["contract error 4: nullifier replay", PassportError.NullifierUsed],
    ["HostError — ContractError(5)", PassportError.InvalidProof],
    ["Error(6)", PassportError.UnknownRegistryRoot],
  ])('parses "%s" to %s', (message, expected) => {
    expect(parsePassportError(new Error(message))).toBe(expected);
  });

  it("parses a raw number code", () => {
    expect(parsePassportError(7)).toBe(PassportError.BatchTooLarge);
  });

  it("parses an object carrying a numeric code", () => {
    expect(parsePassportError({ code: 8 })).toBe(PassportError.RateLimitExceeded);
  });

  it("returns null for non-passport errors", () => {
    expect(parsePassportError(new Error("network timeout"))).toBeNull();
    expect(parsePassportError(new Error("connection refused"))).toBeNull();
    expect(parsePassportError(undefined)).toBeNull();
    expect(parsePassportError(null)).toBeNull();
  });

  it("returns null for out-of-range contract codes", () => {
    expect(parsePassportError(new Error("ContractError(99)"))).toBeNull();
    expect(parsePassportError(0)).toBeNull();
  });
});
