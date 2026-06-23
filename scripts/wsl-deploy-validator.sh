#!/usr/bin/env bash
# Deploy AgentPassportValidator to testnet, wire it to the verifier, and run a
# full on-chain end-to-end: register a real proof, read it back, reject replay.
set -uo pipefail
source "$HOME/.cargo/env"

WIN="/mnt/c/Users/usuario/OneDrive/Documentos/ZK STELLAR/open-stellar-passport"
WASM="$WIN/contracts/validator-wasm/agent_passport_validator.wasm"
VERIFIER=$(tr -d '\r\n' < "$WIN/deploy/verifier-contract-id.txt")
DEPLOYER=$(tr -d '\r\n' < "$WIN/deploy/deployer.txt")
PROOF=$(tr -d '\r\n' < "$WIN/build/arg_proof.json")
PUBLIC=$(tr -d '\r\n' < "$WIN/build/arg_public.json")
# First public input is the registry root we attest at init (#1 allow-list).
REGISTRY_ROOT=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))[0])' "$WIN/build/arg_public.json")

echo "=== verifier:  $VERIFIER"
echo "=== deployer:  $DEPLOYER"
echo "=== root:      $REGISTRY_ROOT"

echo "=== (1) deploy validator ==="
VID=$(stellar contract deploy --wasm "$WASM" --source passport-deployer --network testnet 2>"$WIN/build/.deploy.err")
echo "validator contract id: $VID"
echo -n "$VID" > "$WIN/deploy/validator-contract-id.txt"

echo "=== (2) init(admin=deployer, verifier, registry_root) ==="
stellar contract invoke --id "$VID" --source passport-deployer --network testnet \
  -- init --admin "$DEPLOYER" --verifier "$VERIFIER" --registry_root "$REGISTRY_ROOT" 2>&1 | tail -3

echo "=== (3) is_registered(42) BEFORE (expect false) ==="
stellar contract invoke --id "$VID" --source passport-deployer --network testnet \
  -- is_registered --agent_id 42 2>&1 | tail -2

echo "=== (4) verify_and_register(real proof) — state-changing, --send=yes ==="
stellar contract invoke --id "$VID" --source passport-deployer --network testnet --send=yes \
  -- verify_and_register --proof "$PROOF" --public_inputs "$PUBLIC" 2>&1 | tail -6

echo "=== (5) is_registered(42) AFTER (expect true) ==="
stellar contract invoke --id "$VID" --source passport-deployer --network testnet \
  -- is_registered --agent_id 42 2>&1 | tail -2

echo "=== (6) get_passport(42) ==="
stellar contract invoke --id "$VID" --source passport-deployer --network testnet \
  -- get_passport --agent_id 42 2>&1 | tail -4

echo "=== (7) REPLAY verify_and_register (expect NullifierUsed = Error #4) ==="
stellar contract invoke --id "$VID" --source passport-deployer --network testnet --send=yes \
  -- verify_and_register --proof "$PROOF" --public_inputs "$PUBLIC" 2>&1 | tail -5

echo "DEPLOY_VALIDATOR_DONE"
