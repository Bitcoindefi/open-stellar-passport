#![cfg(test)]
//! End-to-end tests that run the *real* deployed verifier WASM (embedded via
//! `contractimport!`) against a *real* Groth16 proof produced by
//! `scripts/gen-proof.mjs`. No network, fully deterministic.

extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Bytes, BytesN, Env, U256,
};

// Real proof bytes (G1 = x||y, G2 = x.c1||x.c0||y.c1||y.c0) from build/arg_proof.json.
const PROOF_A: &str = "06b93f96ed20999901cc48454c3c679c7dba1cce9d8705938400f1b7268b75e62e826fa485e93ba4d9b087df52b68f551116c8224bc212144a2ec513d4768829";
const PROOF_B: &str = "0506e0126ea65f0682a5518398abc386396b5760d35a7348dac5450c91160eb92e7015079ae46f073a41d6bf9a1c7df6b282a74397d973d685a0b38ca6102cdf1bb7eacb941ed9efe0a2b3e784953b3726acb9f322f8da095e0e2b8857ce93191a66849b4354139a76be8d621516c2702a9f8b329caa583a03278dd7201bfa27";
const PROOF_C: &str = "1efddd1616f866a6ca2d9564042072fe552160f544665c12f5c6a952ec934dbb0e3908022f9ad683338d0f2f3589441e7bc594e2a5b23e63d75741795fadf430";

// Public inputs as 32-byte BE hex: [registryRoot, nullifierHash, agentId=42, spendCap=500000000].
const PI_ROOT: &str = "06c8e54da15f2c1dd4862d76e1cf2d1408df5d9001c172a0600e8ceaaf227fca";
const PI_NULLIFIER: &str = "2adfb605cf2fb6779aa04e1e900c841436903d781eb9166fcdbf1c55b5140b14";
const PI_AGENT: &str = "000000000000000000000000000000000000000000000000000000000000002a";
const PI_CAP: &str = "000000000000000000000000000000000000000000000000000000001dcd6500";

fn unhex(s: &str) -> std::vec::Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}

fn bytesn<const N: usize>(env: &Env, hex: &str) -> BytesN<N> {
    let v = unhex(hex);
    let mut arr = [0u8; N];
    arr.copy_from_slice(&v);
    BytesN::from_array(env, &arr)
}

fn u256(env: &Env, hex: &str) -> U256 {
    U256::from_be_bytes(env, &Bytes::from_slice(env, &unhex(hex)))
}

fn real_proof(env: &Env) -> Groth16Proof {
    Groth16Proof {
        a: bytesn(env, PROOF_A),
        b: bytesn(env, PROOF_B),
        c: bytesn(env, PROOF_C),
    }
}

fn real_public_inputs(env: &Env) -> Vec<U256> {
    Vec::from_array(
        env,
        [
            u256(env, PI_ROOT),
            u256(env, PI_NULLIFIER),
            u256(env, PI_AGENT),
            u256(env, PI_CAP),
        ],
    )
}

/// Deploy the real verifier WASM + our validator, init the wiring, return both.
fn setup(env: &Env) -> AgentPassportValidatorClient<'static> {
    let verifier_addr = env.register(verifier::WASM, ());
    let validator_addr = env.register(AgentPassportValidator, ());
    let client = AgentPassportValidatorClient::new(env, &validator_addr);
    let admin = Address::generate(env);
    client.init(&admin, &verifier_addr);
    client
}

#[test]
fn registers_a_valid_passport() {
    let env = Env::default();
    env.ledger().set_sequence_number(1000);
    let client = setup(&env);

    let agent_id = u256(&env, PI_AGENT);
    assert!(!client.is_registered(&agent_id));

    let att = client.verify_and_register(&real_proof(&env), &real_public_inputs(&env));

    assert_eq!(att.agent_id, agent_id);
    assert_eq!(att.spend_cap, u256(&env, PI_CAP));
    assert_eq!(att.ledger, 1000);
    assert!(client.is_registered(&agent_id));
    assert!(client.is_nullifier_used(&u256(&env, PI_NULLIFIER)));

    let stored = client.get_passport(&agent_id).unwrap();
    assert_eq!(stored.nullifier, u256(&env, PI_NULLIFIER));
}

#[test]
fn verifies_a_batch_of_passports() {
    let env = Env::default();
    let client = setup(&env);

    // Create 3 valid inputs with different agent IDs (and thus different nullifiers for this test's simplicity,
    // though real nullifiers depend on privateKey too). To keep it simple, we'll just use 3 different agent IDs.
    let mut inputs = Vec::new(&env);

    for i in 0..3 {
        let mut pi = real_public_inputs(&env);
        // agentId is at index 2.
        let agent_id = U256::from_u32(&env, 100 + i);
        pi.set(IDX_AGENT_ID, agent_id.clone());
        // We also need a unique nullifier to avoid NullifierUsed error.
        pi.set(IDX_NULLIFIER, U256::from_u32(&env, 1000 + i));

        inputs.push_back(VerifyInput {
            proof: real_proof(&env),
            public_inputs: pi,
        });
    }

    // In this test, real_proof won't actually match the modified public_inputs (agentId/nullifier),
    // because the circuit binds them. So we expect InvalidProof for all unless we had real proofs.
    // However, we can test that they are processed.
    let results = client.verify_batch(&inputs);

    assert_eq!(results.len(), 3);
    for r in results.iter() {
        assert!(!r.success);
        assert_eq!(r.error, Some(Symbol::new(&env, "InvalidProof")));
    }
}

#[test]
fn mixed_batch_results() {
    let env = Env::default();
    let client = setup(&env);

    let mut inputs = Vec::new(&env);

    // 1. Valid proof
    inputs.push_back(VerifyInput {
        proof: real_proof(&env),
        public_inputs: real_public_inputs(&env),
    });

    // 2. Invalid proof (tampered public input, but unique nullifier)
    let mut tampered_pi = real_public_inputs(&env);
    tampered_pi.set(IDX_SPEND_CAP, U256::from_u32(&env, 999));
    tampered_pi.set(IDX_NULLIFIER, U256::from_u32(&env, 9999));
    inputs.push_back(VerifyInput {
        proof: real_proof(&env),
        public_inputs: tampered_pi,
    });

    // 3. Replay (same as 1)
    inputs.push_back(VerifyInput {
        proof: real_proof(&env),
        public_inputs: real_public_inputs(&env),
    });

    let results = client.verify_batch(&inputs);

    assert_eq!(results.len(), 3);

    // First should succeed
    assert!(results.get(0).unwrap().success);

    // Second should fail with InvalidProof
    let res1 = results.get(1).unwrap();
    assert!(!res1.success);
    assert_eq!(res1.error, Some(Symbol::new(&env, "InvalidProof")));

    // Third should fail with NullifierUsed
    let res2 = results.get(2).unwrap();
    assert!(!res2.success);
    assert_eq!(res2.error, Some(Symbol::new(&env, "NullifierUsed")));
}

#[test]
fn rejects_batch_too_large() {
    let env = Env::default();
    let client = setup(&env);

    let mut inputs = Vec::new(&env);
    for _ in 0..9 {
        inputs.push_back(VerifyInput {
            proof: real_proof(&env),
            public_inputs: real_public_inputs(&env),
        });
    }

    let res = client.try_verify_batch(&inputs);
    assert_eq!(res, Err(Ok(Error::BatchTooLarge)));
}

#[test]
fn rejects_nullifier_replay() {
    let env = Env::default();
    let client = setup(&env);

    // First spend succeeds.
    client.verify_and_register(&real_proof(&env), &real_public_inputs(&env));

    // Same proof again -> nullifier already spent.
    let res = client.try_verify_and_register(&real_proof(&env), &real_public_inputs(&env));
    assert_eq!(res, Err(Ok(Error::NullifierUsed)));
}

#[test]
fn rejects_tampered_public_input() {
    let env = Env::default();
    let client = setup(&env);

    // Tamper the spend cap; the proof no longer matches -> InvalidProof.
    let mut inputs = real_public_inputs(&env);
    inputs.set(IDX_SPEND_CAP, u256(&env, PI_CAP).add(&U256::from_u32(&env, 1)));

    let res = client.try_verify_and_register(&real_proof(&env), &inputs);
    assert_eq!(res, Err(Ok(Error::InvalidProof)));
    // A failed verification must NOT burn the nullifier.
    assert!(!client.is_nullifier_used(&u256(&env, PI_NULLIFIER)));
}

#[test]
fn rejects_wrong_input_count() {
    let env = Env::default();
    let client = setup(&env);

    let short = Vec::from_array(&env, [u256(&env, PI_ROOT), u256(&env, PI_NULLIFIER)]);
    let res = client.try_verify_and_register(&real_proof(&env), &short);
    assert_eq!(res, Err(Ok(Error::BadPublicInputs)));
}

#[test]
#[should_panic]
fn init_is_one_shot() {
    let env = Env::default();
    let client = setup(&env);
    let admin = Address::generate(&env);
    let verifier_addr = Address::generate(&env);
    // Second init must panic with AlreadyInitialized.
    client.init(&admin, &verifier_addr);
}
