SHELL := /bin/bash

BUILD_DIR := build
CONTRACT_TARGET := wasm32v1-none
VALIDATOR_CRATE := contracts/agent-passport-validator
VALIDATOR_WASM := contracts/validator-wasm/agent_passport_validator.wasm
VERIFIER_WASM := contracts/verifier-wasm/circom_groth16_verifier.wasm
COMMITTED_ZK_DIR := frontend/public/zk
STELLAR_NETWORK ?= testnet
STELLAR_SOURCE ?=
STELLAR_ADMIN ?=
POT14 ?= $(BUILD_DIR)/pot14_final.ptau
ZKEY_ENTROPY ?= open-stellar-passport-local-build

.PHONY: help check-build-tools npm-ci prepare-committed-zk verify-committed-zk build-circuit circuit-setup build-contracts build-contracts-stellar build-verifier-contract gen-bindings deploy-verifier deploy-validator clean-build

help:
	@printf '%s\n' 'Portable build targets:'
	@printf '%s\n' '  make check-build-tools     Check required and optional local build tools'
	@printf '%s\n' '  make verify-committed-zk   Verify the committed zkey exports the committed VK and proves locally'
	@printf '%s\n' '  make build-circuit         Compile the Circom circuits into build/ (requires circom)'
	@printf '%s\n' '  make circuit-setup         Build a fresh local zkey from build/agent_passport.r1cs and POT14'
	@printf '%s\n' '  make build-contracts       Test and compile the validator contract with Cargo'
	@printf '%s\n' '  make build-contracts-stellar Build the validator release artifact with stellar CLI'
	@printf '%s\n' '  make build-verifier-contract Build circom-groth16-verifier from the committed VK'
	@printf '%s\n' '  make gen-bindings          Regenerate sdk/bindings from deploy/validator-contract-id.txt'

check-build-tools:
	@command -v node >/dev/null || { echo 'missing required tool: node'; exit 127; }
	@command -v npm >/dev/null || { echo 'missing required tool: npm'; exit 127; }
	@command -v cargo >/dev/null || { echo 'missing required tool: cargo'; exit 127; }
	@command -v rustup >/dev/null || { echo 'missing required tool: rustup'; exit 127; }
	@echo "node: $$(node --version)"
	@echo "npm: $$(npm --version)"
	@echo "cargo: $$(cargo --version)"
	@echo "rustup: $$(rustup --version | head -1)"
	@if command -v circom >/dev/null; then echo "circom: $$(circom --version)"; else echo 'optional tool missing: circom (needed by build-circuit)'; fi
	@if command -v stellar >/dev/null; then echo "stellar: $$(stellar --version)"; else echo 'optional tool missing: stellar (needed by release contract builds, deploys, and bindings)'; fi

npm-ci:
	npm ci

prepare-committed-zk: npm-ci
	mkdir -p "$(BUILD_DIR)/passport_witness_js" "$(BUILD_DIR)/agent_passport_js"
	cp "$(COMMITTED_ZK_DIR)/passport_witness.wasm" "$(BUILD_DIR)/passport_witness_js/passport_witness.wasm"
	cp "$(COMMITTED_ZK_DIR)/agent_passport.wasm" "$(BUILD_DIR)/agent_passport_js/agent_passport.wasm"
	cp "$(COMMITTED_ZK_DIR)/agent_passport_final.zkey" "$(BUILD_DIR)/agent_passport_final.zkey"
	cp "$(COMMITTED_ZK_DIR)/verification_key.json" "$(BUILD_DIR)/verification_key.json"

verify-committed-zk: prepare-committed-zk
	npx snarkjs zkey export verificationkey "$(COMMITTED_ZK_DIR)/agent_passport_final.zkey" "$(BUILD_DIR)/verification_key.from-zkey.json"
	node scripts/compare-json.mjs "$(COMMITTED_ZK_DIR)/verification_key.json" "$(BUILD_DIR)/verification_key.from-zkey.json" verification-key
	node scripts/smoke.mjs

build-circuit: npm-ci
	@command -v circom >/dev/null || { echo 'circom 2.2.x is required to compile circuits'; exit 127; }
	mkdir -p "$(BUILD_DIR)"
	circom circuits/passport_witness.circom --r1cs --wasm --sym -o "$(BUILD_DIR)"
	circom circuits/agent_passport.circom --r1cs --wasm --sym -o "$(BUILD_DIR)"

circuit-setup: build-circuit
	@test -f "$(POT14)" || { echo "missing powers-of-tau file: $(POT14)"; echo 'pass POT14=/path/to/pot14_final.ptau or place it at build/pot14_final.ptau'; exit 2; }
	npx snarkjs groth16 setup "$(BUILD_DIR)/agent_passport.r1cs" "$(POT14)" "$(BUILD_DIR)/agent_passport_0000.zkey"
	npx snarkjs zkey contribute "$(BUILD_DIR)/agent_passport_0000.zkey" "$(BUILD_DIR)/agent_passport_final.zkey" -e="$(ZKEY_ENTROPY)" -v
	npx snarkjs zkey export verificationkey "$(BUILD_DIR)/agent_passport_final.zkey" "$(BUILD_DIR)/verification_key.json"
	@echo 'Built a fresh local zkey. It is expected to differ from the committed ceremony artifact unless the original contribution transcript and entropy are reused.'

build-contracts:
	rustup target add "$(CONTRACT_TARGET)"
	cargo test --manifest-path "$(VALIDATOR_CRATE)/Cargo.toml"
	cargo build --manifest-path "$(VALIDATOR_CRATE)/Cargo.toml" --target "$(CONTRACT_TARGET)" --release
	mkdir -p "$(BUILD_DIR)/contracts"
	cp "$(VALIDATOR_CRATE)/target/$(CONTRACT_TARGET)/release/agent_passport_validator.wasm" "$(BUILD_DIR)/contracts/agent_passport_validator.cargo.wasm"
	node scripts/compare-files.mjs "$(VALIDATOR_WASM)" "$(BUILD_DIR)/contracts/agent_passport_validator.cargo.wasm" --warn-only
	@if command -v stellar >/dev/null; then $(MAKE) build-contracts-stellar; else echo 'stellar CLI not found; skipped release artifact parity build'; fi

build-contracts-stellar:
	@command -v stellar >/dev/null || { echo 'stellar CLI is required for release contract artifact builds'; exit 127; }
	mkdir -p "$(BUILD_DIR)/contracts"
	cd "$(VALIDATOR_CRATE)" && stellar contract build --out-dir "../../$(BUILD_DIR)/contracts"
	node scripts/compare-files.mjs "$(VALIDATOR_WASM)" "$(BUILD_DIR)/contracts/agent_passport_validator.wasm"

build-verifier-contract:
	@command -v git >/dev/null || { echo 'git is required to fetch NethermindEth/stellar-private-payments'; exit 127; }
	@command -v stellar >/dev/null || { echo 'stellar CLI is required to build the verifier contract'; exit 127; }
	mkdir -p "$(BUILD_DIR)/external" "$(BUILD_DIR)/contracts"
	@if [ ! -d "$(BUILD_DIR)/external/stellar-private-payments/.git" ]; then git clone --depth 1 https://github.com/NethermindEth/stellar-private-payments.git "$(BUILD_DIR)/external/stellar-private-payments"; fi
	cp "$(COMMITTED_ZK_DIR)/verification_key.json" "$(BUILD_DIR)/agent_vk.json"
	cd "$(BUILD_DIR)/external/stellar-private-payments" && VERIFIER_VK_JSON="$$(cd ../../.. && pwd)/$(BUILD_DIR)/agent_vk.json" stellar contract build --package circom-groth16-verifier --out-dir "$$(cd ../../.. && pwd)/$(BUILD_DIR)/contracts"
	node scripts/compare-files.mjs "$(VERIFIER_WASM)" "$(BUILD_DIR)/contracts/circom_groth16_verifier.wasm" --warn-only

gen-bindings:
	@command -v stellar >/dev/null || { echo 'stellar CLI is required to generate bindings'; exit 127; }
	@test -s deploy/validator-contract-id.txt || { echo 'missing deploy/validator-contract-id.txt'; exit 2; }
	rm -rf sdk/bindings
	stellar contract bindings typescript --network "$(STELLAR_NETWORK)" --id "$$(tr -d '\r\n' < deploy/validator-contract-id.txt)" --output-dir sdk/bindings --overwrite

deploy-verifier:
	@command -v stellar >/dev/null || { echo 'stellar CLI is required to deploy contracts'; exit 127; }
	@test -n "$(STELLAR_SOURCE)" || { echo 'set STELLAR_SOURCE to a local stellar identity name'; exit 2; }
	@test -s "$(VERIFIER_WASM)" || { echo "missing $(VERIFIER_WASM); run make build-verifier-contract first"; exit 2; }
	mkdir -p deploy
	stellar contract deploy --wasm "$(VERIFIER_WASM)" --source "$(STELLAR_SOURCE)" --network "$(STELLAR_NETWORK)" | tee deploy/verifier-contract-id.txt

deploy-validator:
	@command -v stellar >/dev/null || { echo 'stellar CLI is required to deploy contracts'; exit 127; }
	@test -n "$(STELLAR_SOURCE)" || { echo 'set STELLAR_SOURCE to a local stellar identity name'; exit 2; }
	@test -s deploy/verifier-contract-id.txt || { echo 'missing deploy/verifier-contract-id.txt'; exit 2; }
	@test -s "$(VALIDATOR_WASM)" || { echo "missing $(VALIDATOR_WASM); run make build-contracts-stellar first"; exit 2; }
	mkdir -p deploy
	VID=$$(stellar contract deploy --wasm "$(VALIDATOR_WASM)" --source "$(STELLAR_SOURCE)" --network "$(STELLAR_NETWORK)"); echo "$$VID" | tee deploy/validator-contract-id.txt
	ADMIN="$(STELLAR_ADMIN)"; if [ -z "$$ADMIN" ]; then ADMIN=$$(stellar keys address "$(STELLAR_SOURCE)"); fi; stellar contract invoke --id "$$VID" --source "$(STELLAR_SOURCE)" --network "$(STELLAR_NETWORK)" -- init --admin "$$ADMIN" --verifier "$$(tr -d '\r\n' < deploy/verifier-contract-id.txt)"

clean-build:
	rm -rf "$(BUILD_DIR)"
