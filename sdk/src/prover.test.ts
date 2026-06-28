import { describe, expect, it } from "vitest";
import type { Groth16Proof as SnarkProof } from "snarkjs";
import {
  toSorobanProof,
  validatePassportSecretInputs,
  validatePassportWitness,
  type PassportWitness,
} from "./prover";

const field = (value: number) => value.toString();

const sampleProof = {
  pi_a: [field(1), field(2)],
  pi_b: [
    [field(3), field(4)],
    [field(5), field(6)],
  ],
  pi_c: [field(7), field(8)],
} as SnarkProof;

const word = (value: number) => value.toString(16).padStart(64, "0");

const validWitness = (): PassportWitness => ({
  registryRoot: "11",
  nullifierHash: "12",
  agentId: "42",
  spendCap: "500",
  privateKey: "123456789",
  balance: "1000",
  pathElements: Array.from({ length: 20 }, (_, i) => String(i + 1)),
  pathIndices: "0",
});

describe("toSorobanProof", () => {
  it("encodes G1 and G2 coordinates in the contract byte order", () => {
    const encoded = toSorobanProof(sampleProof, ["11", "12", "13", "14"]);

    expect(encoded.proofHex).toEqual({
      a: word(1) + word(2),
      b: word(4) + word(3) + word(6) + word(5),
      c: word(7) + word(8),
    });
    expect(Buffer.from(encoded.proof.a).toString("hex")).toBe(
      encoded.proofHex.a,
    );
    expect(Buffer.from(encoded.proof.b).toString("hex")).toBe(
      encoded.proofHex.b,
    );
    expect(Buffer.from(encoded.proof.c).toString("hex")).toBe(
      encoded.proofHex.c,
    );
    expect(encoded.publicInputs).toEqual(["11", "12", "13", "14"]);
  });

  it("rejects field elements wider than 32 bytes", () => {
    const overflowingProof = {
      ...sampleProof,
      pi_a: [`0x1${"0".repeat(64)}`, field(2)],
    } as SnarkProof;

    expect(() => toSorobanProof(overflowingProof, [])).toThrow(
      /field element overflow/i,
    );
  });
});

describe("validatePassportWitness", () => {
  it("accepts a complete, in-field witness", () => {
    expect(() => validatePassportWitness(validWitness())).not.toThrow();
  });

  it.each([
    ["spendCap", { spendCap: "0" }, /spendCap must be greater than zero/i],
    ["agentId", { agentId: "0" }, /agentId must be greater than zero/i],
    ["balance", { balance: "499" }, /balance must be greater than or equal to spendCap/i],
    ["decimal", { spendCap: "1.5" }, /spendCap must be a decimal integer string/i],
    ["negative", { balance: "-1" }, /balance must be a decimal integer string/i],
  ])("rejects invalid %s input", (_name, patch, message) => {
    expect(() => validatePassportWitness({ ...validWitness(), ...patch })).toThrow(message);
  });

  it("rejects field elements outside the circuit field", () => {
    const fieldModulus =
      "21888242871839275222246405745257275088548364400416034343698204186575808495617";

    expect(() =>
      validatePassportWitness({ ...validWitness(), registryRoot: fieldModulus }),
    ).toThrow(/registryRoot must be smaller than/i);
  });

  it("rejects malformed Merkle path inputs", () => {
    expect(() =>
      validatePassportWitness({ ...validWitness(), pathElements: ["1"] }),
    ).toThrow(/pathElements must contain exactly 20 entries/i);

    expect(() =>
      validatePassportWitness({
        ...validWitness(),
        pathElements: Array.from({ length: 20 }, () => "1"),
        pathIndices: String(1 << 20),
      }),
    ).toThrow(/pathIndices must fit in 20 bits/i);
  });
});

describe("validatePassportSecretInputs", () => {
  it("validates the helper witness inputs used to derive public inputs", () => {
    const { privateKey, agentId, pathElements, pathIndices } = validWitness();

    expect(() =>
      validatePassportSecretInputs({ privateKey, agentId, pathElements, pathIndices }),
    ).not.toThrow();
  });
});
