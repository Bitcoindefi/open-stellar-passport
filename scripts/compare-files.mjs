import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const warnOnly = args.includes("--warn-only");
const [expectedPath, actualPath] = args.filter((arg) => arg !== "--warn-only");

if (!expectedPath || !actualPath) {
  console.error(
    "usage: node scripts/compare-files.mjs <expected> <actual> [--warn-only]",
  );
  process.exit(2);
}

const sha256 = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

const expectedHash = sha256(expectedPath);
const actualHash = sha256(actualPath);

console.log(`expected ${expectedHash}  ${expectedPath}`);
console.log(`actual   ${actualHash}  ${actualPath}`);

if (expectedHash !== actualHash) {
  const message = "artifact hash mismatch";
  if (warnOnly) {
    console.warn(`${message} (continuing because --warn-only was set)`);
    process.exit(0);
  }
  console.error(message);
  process.exit(1);
}

console.log("artifact hash OK");
