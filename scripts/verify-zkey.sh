#!/usr/bin/env bash
# Reproducible trusted-setup sanity check (issue #3).
#
# Anyone can run this to confirm the proving key shipped in the frontend
# (`agent_passport_final.zkey`) really corresponds to the verification key the
# browser and the on-chain Soroban verifier use — i.e. the zkey was not swapped
# for one over a different circuit.
#
#   1. Export the VK straight from the committed zkey.
#   2. Diff it against the committed `verification_key.json`.
#
# A full ceremony check additionally needs the circuit `.r1cs` and the Powers-of-Tau
# `.ptau` file:  snarkjs zkey verify circuit.r1cs pot_final.ptau final.zkey
# Document the ptau source + hash in SECURITY.md so that step is reproducible too.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ZK="$ROOT/frontend/public/zk"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "=== exporting VK from agent_passport_final.zkey ==="
npx snarkjs zkey export verificationkey \
  "$ZK/agent_passport_final.zkey" "$TMP/vk_from_zkey.json" >/dev/null

# Normalize (key order / whitespace) before comparing.
norm() { node -e 'process.stdout.write(JSON.stringify(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))))' "$1"; }

if [ "$(norm "$TMP/vk_from_zkey.json")" = "$(norm "$ZK/verification_key.json")" ]; then
  echo "OK — committed verification_key.json matches the zkey."
else
  echo "MISMATCH — the zkey does NOT correspond to verification_key.json!" >&2
  exit 1
fi
