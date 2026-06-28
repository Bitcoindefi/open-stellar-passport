import { describe, expect, it } from "vitest";
import type { Groth16Proof as SnarkProof } from "snarkjs";
import {
  buildMultiCredentialWitness,
  flattenSorobanProof,
  toSorobanProof,
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

describe("flattenSorobanProof", () => {
  it("concatenates the proof parts into a single buffer", () => {
    const encoded = toSorobanProof(sampleProof, ["11", "12", "13", "14"]);
    const flattened = flattenSorobanProof(encoded);

    expect(flattened.toString("hex")).toBe(
      encoded.proofHex.a + encoded.proofHex.b + encoded.proofHex.c,
    );
  });
});

describe("buildMultiCredentialWitness", () => {
  it("builds a combined witness for multiple credentials", () => {
    expect(
      buildMultiCredentialWitness([
        {
          root: "101",
          attributeHash: "202",
          witness: ["11", "12"],
          pathIndices: "1",
          artifacts: { wasm: "multi.wasm", zkey: "multi.zkey", vk: {} },
        },
        {
          root: "303",
          attributeHash: "404",
          witness: ["21", "22"],
          pathIndices: "0",
        },
      ]),
    ).toEqual({
      credentialRoots: ["101", "303"],
      attributeHashes: ["202", "404"],
      witnesses: [
        ["11", "12"],
        ["21", "22"],
      ],
      pathIndices: ["1", "0"],
    });
  });

  it("requires at least one credential", () => {
    expect(() => buildMultiCredentialWitness([])).toThrow(
      /at least one credential/i,
    );
  });
});
