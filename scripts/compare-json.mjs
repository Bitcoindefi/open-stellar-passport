import { readFileSync } from "node:fs";

const [expectedPath, actualPath, label = "JSON"] = process.argv.slice(2);

if (!expectedPath || !actualPath) {
  console.error(
    "usage: node scripts/compare-json.mjs <expected> <actual> [label]",
  );
  process.exit(2);
}

const normalize = (value) => {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]),
    );
  }
  return value;
};

const readJson = (path) => normalize(JSON.parse(readFileSync(path, "utf8")));
const expected = JSON.stringify(readJson(expectedPath));
const actual = JSON.stringify(readJson(actualPath));

if (expected !== actual) {
  console.error(`${label} mismatch`);
  console.error(`expected: ${expectedPath}`);
  console.error(`actual:   ${actualPath}`);
  process.exit(1);
}

console.log(`${label} OK: ${actualPath} matches ${expectedPath}`);
