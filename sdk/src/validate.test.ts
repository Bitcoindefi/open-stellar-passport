import { describe, expect, it } from "vitest";
import {
  AGENT_ID_MAX,
  LEAF_INDEX_MAX,
  SPEND_CAP_MAX,
  ValidationError,
  validateMerkleRootHex,
  validatePassportWitness,
} from "./validate";

const valid = {
  agentId: "42",
  spendCap: "1000",
  registryRoot: "12345678901234567890123456789012345678901234567890123456789012345",
  pathIndices: "7",
};

describe("validatePassportWitness", () => {
  it("accepts a fully valid witness", () => {
    expect(() => validatePassportWitness(valid)).not.toThrow();
  });

  it("rejects a negative spendCap", () => {
    expect(() => validatePassportWitness({ ...valid, spendCap: "-5" })).toThrow(
      new RegExp("ValidationError\\[spendCap\\]"),
    );
  });

  it("rejects a zero spendCap", () => {
    try {
      validatePassportWitness({ ...valid, spendCap: "0" });
      expect.unreachable("zero spendCap must throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const e = err as ValidationError;
      expect(e.field).toBe("spendCap");
      expect(e.message).toContain("greater than zero");
      expect(e.received).toBe("0");
    }
  });

  it("rejects a spendCap at the 2^64 boundary and above", () => {
    const overflow = (SPEND_CAP_MAX + 1n).toString();
    expect(() => validatePassportWitness({ ...valid, spendCap: overflow })).toThrow(
      /must be < 2\^64/,
    );
    expect(() =>
      validatePassportWitness({ ...valid, spendCap: SPEND_CAP_MAX.toString() }),
    ).not.toThrow();
  });

  it("rejects a non-numeric spendCap", () => {
    expect(() => validatePassportWitness({ ...valid, spendCap: "lots" })).toThrow(
      /expected a non-negative decimal integer string/,
    );
  });

  it("rejects an agentId >= 2^32", () => {
    const tooBig = (AGENT_ID_MAX + 1n).toString();
    try {
      validatePassportWitness({ ...valid, agentId: tooBig });
      expect.unreachable("agentId >= 2^32 must throw");
    } catch (err) {
      const e = err as ValidationError;
      expect(e.field).toBe("agentId");
      expect(e.message).toMatch(/must be < 2\^32/);
      expect(e.received).toBe(tooBig);
    }
    expect(() => validatePassportWitness({ ...valid, agentId: AGENT_ID_MAX.toString() })).not.toThrow();
  });

  it("rejects a leafIndex beyond the tree depth (2^20)", () => {
    const tooDeep = (LEAF_INDEX_MAX + 1n).toString();
    try {
      validatePassportWitness({ ...valid, pathIndices: tooDeep });
      expect.unreachable("leafIndex beyond depth must throw");
    } catch (err) {
      const e = err as ValidationError;
      expect(e.field).toBe("leafIndex");
      expect(e.message).toMatch(/2\^20/);
      expect(e.received).toBe(tooDeep);
    }
  });

  it("rejects a registryRoot wider than a BN254 field element", () => {
    const huge = `1${"0".repeat(80)}`;
    expect(() => validatePassportWitness({ ...valid, registryRoot: huge })).toThrow(
      /field element range/,
    );
  });
});

describe("validateMerkleRootHex", () => {
  it("accepts 64 hex chars with and without 0x", () => {
    const root = "ab".repeat(32);
    expect(() => validateMerkleRootHex(root)).not.toThrow();
    expect(() => validateMerkleRootHex(`0x${root}`)).not.toThrow();
  });

  it("rejects short, long, non-hex and non-string values", () => {
    expect(() => validateMerkleRootHex("abcd")).toThrow(/64 hex characters/);
    expect(() => validateMerkleRootHex("ab".repeat(33))).toThrow(/64 hex characters/);
    expect(() => validateMerkleRootHex("zz".repeat(32))).toThrow(/64 hex characters/);
    // @ts-expect-error deliberate wrong type
    expect(() => validateMerkleRootHex(12345)).toThrow(/64 hex characters/);
  });
});
