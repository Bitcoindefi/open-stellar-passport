import { readFile } from "node:fs/promises";
import * as snarkjs from "snarkjs";

const zkeyPath = "frontend/public/zk/agent_passport_final.zkey";
const verificationKeyPath = "frontend/public/zk/verification_key.json";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

const committed = JSON.parse(await readFile(verificationKeyPath, "utf8"));
const exported = await snarkjs.zKey.exportVerificationKey(zkeyPath);

const committedJson = JSON.stringify(canonical(committed), null, 2);
const exportedJson = JSON.stringify(canonical(exported), null, 2);

if (committedJson !== exportedJson) {
  console.error(`${verificationKeyPath} does not match ${zkeyPath}.`);
  console.error(
    "Regenerate or review the verification key before merging circuit/artifact changes.",
  );
  process.exit(1);
}

console.log(`Verified ${verificationKeyPath} matches ${zkeyPath}.`);
process.exit(0);
