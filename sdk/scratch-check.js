import * as sdk from "@stellar/stellar-sdk";
const { nativeToScVal } = sdk;

const verifyInput = {
  proof: {
    a: Buffer.alloc(64),
    b: Buffer.alloc(128),
    c: Buffer.alloc(64)
  },
  public_inputs: [123n, 456n]
};

console.dir(nativeToScVal(verifyInput), { depth: null });
