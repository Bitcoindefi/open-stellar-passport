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

/// Deploy the real verifier WASM + our validator, init the wiring (attesting
/// the real proof's registry root), return the client. `mock_all_auths` so
/// admin-gated calls in tests don't need explicit signatures.
fn setup(env: &Env) -> AgentPassportValidatorClient<'static> {
    setup_with_admin(env).0
}

fn setup_with_admin(env: &Env) -> (AgentPassportValidatorClient<'static>, Address) {
    env.mock_all_auths();
    let verifier_addr = env.register(verifier::WASM, ());
    let validator_addr = env.register(AgentPassportValidator, ());
    let client = AgentPassportValidatorClient::new(env, &validator_addr);
    let admin = Address::generate(env);
    client.init(&admin, &verifier_addr, &u256(env, PI_ROOT));
    (client, admin)
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
    client.init(&admin, &verifier_addr, &u256(&env, PI_ROOT));
}

/// #1: a proof whose registryRoot isn't attested is rejected *before* the
/// pairing check — defeats the "bring your own Merkle tree" forgery.
#[test]
fn rejects_unknown_registry_root() {
    let env = Env::default();
    let client = setup(&env);

    let mut inputs = real_public_inputs(&env);
    // Swap in a root that was never attested (still a valid field element).
    inputs.set(0, u256(&env, PI_NULLIFIER));

    let res = client.try_verify_and_register(&real_proof(&env), &inputs);
    assert_eq!(res, Err(Ok(Error::UnknownRegistryRoot)));
    // Rejected before any state change.
    assert!(!client.is_nullifier_used(&u256(&env, PI_NULLIFIER)));
}

/// #1: admin can attest and later revoke registry roots.
#[test]
fn admin_manages_registry_roots() {
    let env = Env::default();
    let client = setup(&env);

    let new_root = u256(&env, PI_AGENT);
    assert!(!client.is_registry_root_allowed(&new_root));
    client.add_registry_root(&new_root);
    assert!(client.is_registry_root_allowed(&new_root));
    client.remove_registry_root(&new_root);
    assert!(!client.is_registry_root_allowed(&new_root));
}

/// #6: two-step admin transfer, then the old admin can no longer administer.
#[test]
fn two_step_admin_transfer() {
    let env = Env::default();
    let (client, old_admin) = setup_with_admin(&env);
    let new_admin = Address::generate(&env);

    assert_eq!(client.admin(), Some(old_admin.clone()));
    client.transfer_admin(&new_admin);
    // Not effective until accepted.
    assert_eq!(client.admin(), Some(old_admin.clone()));
    client.accept_admin();
    assert_eq!(client.admin(), Some(new_admin));
}

/// #6: accepting with nothing pending is a typed error.
#[test]
fn accept_admin_without_pending_errs() {
    let env = Env::default();
    let client = setup(&env);
    let res = client.try_accept_admin();
    assert_eq!(res, Err(Ok(Error::NoPendingAdmin)));
}

/// #6: renounce freezes the verifier/roots permanently.
#[test]
fn renounce_freezes_admin() {
    let env = Env::default();
    let client = setup(&env);
    client.renounce_admin();
    assert_eq!(client.admin(), None);
    let res = client.try_set_verifier(&Address::generate(&env));
    assert_eq!(res, Err(Ok(Error::NotInitialized)));
}

/// #10: spends accumulate against the proven cap and are rejected past it.
#[test]
fn spend_gate_enforces_cap() {
    let env = Env::default();
    let client = setup(&env);

    // Mint the passport (cap = PI_CAP = 500_000_000).
    client.verify_and_register(&real_proof(&env), &real_public_inputs(&env));
    let agent_id = u256(&env, PI_AGENT);
    let cap = u256(&env, PI_CAP);
    assert_eq!(client.remaining_cap(&agent_id), cap);

    // Spend 200M, then 200M more -> 400M used, 100M remaining.
    let amount = U256::from_u32(&env, 200_000_000);
    let rem = client.authorize_spend(&agent_id, &amount);
    assert_eq!(rem, U256::from_u32(&env, 300_000_000));
    client.authorize_spend(&agent_id, &amount);
    assert_eq!(client.remaining_cap(&agent_id), U256::from_u32(&env, 100_000_000));

    // A spend that would exceed the cap is rejected; state unchanged.
    let res = client.try_authorize_spend(&agent_id, &amount);
    assert_eq!(res, Err(Ok(Error::SpendCapExceeded)));
    assert_eq!(client.remaining_cap(&agent_id), U256::from_u32(&env, 100_000_000));
}

/// #10: spending for an unregistered agent is a typed error.
#[test]
fn spend_for_unregistered_agent_errs() {
    let env = Env::default();
    let client = setup(&env);
    let res = client.try_authorize_spend(&u256(&env, PI_AGENT), &U256::from_u32(&env, 1));
    assert_eq!(res, Err(Ok(Error::NotRegistered)));
}
