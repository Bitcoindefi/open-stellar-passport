#![no_std]
//! AgentPassportValidator
//!
//! The stateful policy layer on top of the stateless `circom-groth16-verifier`.
//!
//! A holder presents a Groth16 proof that, in zero knowledge, attests their
//! agent is (a) backed by a member of an attested-identity registry, (b) bound
//! to a Sybil-resistant nullifier, and (c) solvent for a declared spend cap —
//! see `circuits/agent_passport.circom`. This contract:
//!
//!   1. cross-contract calls the verifier to check the proof is sound,
//!   2. enforces the nullifier has never been spent (anti-replay / anti-Sybil),
//!   3. records a "zk-passport" attestation for the agent that an x402 settle
//!      gate (or any caller) can later read with `get_passport` / `is_registered`.
//!
//! Public-input layout (must match the circuit's `main {public [...]}`):
//!   [0] registryRoot   [1] nullifierHash   [2] agentId   [3] spendCap

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    BytesN, Env, Symbol, U256, Vec,
};

/// Generates a typed client for the already-deployed verifier straight from its
/// compiled WASM, so the proof and public-input encodings are guaranteed to
/// match the on-chain contract.
mod verifier {
    soroban_sdk::contractimport!(file = "verifier.wasm");
}

/// Groth16 proof over BN254, re-declared in *this* contract's spec (the
/// imported one isn't exported) so SDKs/CLI can build the argument directly.
/// Byte layout: G1 `a`/`c` = x||y (32B BE each); G2 `b` = x.c1||x.c0||y.c1||y.c0.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Groth16Proof {
    pub a: BytesN<64>,
    pub b: BytesN<128>,
    pub c: BytesN<64>,
}

const N_PUBLIC_INPUTS: u32 = 4;
const IDX_NULLIFIER: u32 = 1;
const IDX_AGENT_ID: u32 = 2;
const IDX_SPEND_CAP: u32 = 3;

/// ~30 days of ledgers (5s close time) — keep attestations & spent nullifiers
/// alive well past a typical agent session without unbounded rent.
const TTL_BUMP: u32 = 518_400;
const TTL_THRESHOLD: u32 = 17_280;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    /// Wrong number of public inputs for the agent_passport circuit.
    BadPublicInputs = 3,
    /// This nullifier was already spent — replay / Sybil attempt.
    NullifierUsed = 4,
    /// The Groth16 proof did not verify against the embedded key.
    InvalidProof = 5,
    /// Batch size exceeds the limit of 8.
    BatchTooLarge = 6,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Attestation {
    pub agent_id: U256,
    pub nullifier: U256,
    pub registry_root: U256,
    pub spend_cap: U256,
    /// Ledger sequence at which the passport was minted.
    pub ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct VerifyInput {
    pub proof: Groth16Proof,
    pub public_inputs: Vec<U256>,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct VerifyResult {
    pub root: U256,
    pub success: bool,
    pub error: Option<Symbol>,
}

#[contracttype]
enum DataKey {
    Admin,
    Verifier,
    /// nullifierHash -> spent (presence == spent).
    Nullifier(U256),
    /// agentId -> latest attestation.
    Passport(U256),
}

#[contract]
pub struct AgentPassportValidator;

#[contractimpl]
impl AgentPassportValidator {
    /// One-time wiring: who can re-point the verifier, and the verifier's
    /// contract address. Panics on a second call.
    pub fn init(env: Env, admin: Address, verifier: Address) {
        let storage = env.storage().instance();
        if storage.has(&DataKey::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        storage.set(&DataKey::Admin, &admin);
        storage.set(&DataKey::Verifier, &verifier);
    }

    /// Internal logic for verifying a single passport proof.
    fn verify_internal(
        env: &Env,
        proof: &Groth16Proof,
        public_inputs: &Vec<U256>,
    ) -> Result<Attestation, Error> {
        if public_inputs.len() != N_PUBLIC_INPUTS {
            return Err(Error::BadPublicInputs);
        }

        let nullifier = public_inputs.get_unchecked(IDX_NULLIFIER);
        let agent_id = public_inputs.get_unchecked(IDX_AGENT_ID);
        let registry_root = public_inputs.get_unchecked(0);
        let spend_cap = public_inputs.get_unchecked(IDX_SPEND_CAP);

        // (1) anti-replay / anti-Sybil — reject a nullifier we've already seen.
        let persistent = env.storage().persistent();
        let nf_key = DataKey::Nullifier(nullifier.clone());
        if persistent.has(&nf_key) {
            return Err(Error::NullifierUsed);
        }

        // (2) cross-contract soundness check. `try_verify` so an invalid proof
        // surfaces as our typed error instead of trapping the whole tx.
        let verifier_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Verifier)
            .ok_or(Error::NotInitialized)?;
        let client = verifier::Client::new(&env, &verifier_addr);
        let vproof = verifier::Groth16Proof {
            a: proof.a.clone(),
            b: proof.b.clone(),
            c: proof.c.clone(),
        };
        match client.try_verify(&vproof, &public_inputs) {
            Ok(Ok(true)) => {}
            _ => return Err(Error::InvalidProof),
        }

        // (3) commit: burn the nullifier and record the attestation.
        persistent.set(&nf_key, &true);
        persistent.extend_ttl(&nf_key, TTL_THRESHOLD, TTL_BUMP);

        let attestation = Attestation {
            agent_id: agent_id.clone(),
            nullifier: nullifier.clone(),
            registry_root,
            spend_cap: spend_cap.clone(),
            ledger: env.ledger().sequence(),
        };
        let pass_key = DataKey::Passport(agent_id.clone());
        persistent.set(&pass_key, &attestation);
        persistent.extend_ttl(&pass_key, TTL_THRESHOLD, TTL_BUMP);

        env.events().publish(
            (symbol_short!("passport"), agent_id),
            (nullifier, spend_cap),
        );

        Ok(attestation)
    }

    /// Verify a passport proof and, if sound and unspent, mint the attestation.
    ///
    /// This is the load-bearing entry point: the proof *is* the authorization,
    /// so no `require_auth` is needed — anyone relaying a valid, fresh proof
    /// registers the agent. Returns the freshly stored [`Attestation`].
    pub fn verify_and_register(
        env: Env,
        proof: Groth16Proof,
        public_inputs: Vec<U256>,
    ) -> Result<Attestation, Error> {
        Self::verify_internal(&env, &proof, &public_inputs)
    }

    /// Verify multiple proofs in a single call.
    ///
    /// Returns results for all proofs; doesn't short-circuit on first failure.
    /// Each proof is validated independently. Max batch size is 8.
    pub fn verify_batch(env: Env, proofs: Vec<VerifyInput>) -> Result<Vec<VerifyResult>, Error> {
        if proofs.len() > 8 {
            return Err(Error::BatchTooLarge);
        }

        let mut results = Vec::new(&env);
        for input in proofs.iter() {
            let root = input.public_inputs.get(0).unwrap_or(U256::from_u32(&env, 0));
            match Self::verify_internal(&env, &input.proof, &input.public_inputs) {
                Ok(_) => {
                    results.push_back(VerifyResult {
                        root,
                        success: true,
                        error: None,
                    });
                }
                Err(e) => {
                    let error_sym = match e {
                        Error::BadPublicInputs => Some(Symbol::new(&env, "BadPublicInputs")),
                        Error::NullifierUsed => Some(Symbol::new(&env, "NullifierUsed")),
                        Error::InvalidProof => Some(Symbol::new(&env, "InvalidProof")),
                        Error::NotInitialized => Some(Symbol::new(&env, "NotInitialized")),
                        _ => Some(Symbol::new(&env, "Error")),
                    };
                    results.push_back(VerifyResult {
                        root,
                        success: false,
                        error: error_sym,
                    });
                }
            }
        }
        Ok(results)
    }

    /// True iff `agent_id` holds a minted zk-passport.
    pub fn is_registered(env: Env, agent_id: U256) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Passport(agent_id))
    }

    /// Fetch the stored attestation for an agent, if any.
    pub fn get_passport(env: Env, agent_id: U256) -> Option<Attestation> {
        env.storage()
            .persistent()
            .get(&DataKey::Passport(agent_id))
    }

    /// True iff this nullifier has already been spent.
    pub fn is_nullifier_used(env: Env, nullifier: U256) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Nullifier(nullifier))
    }

    /// The verifier contract this validator delegates proof-checking to.
    pub fn verifier(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Verifier)
            .ok_or(Error::NotInitialized)
    }

    /// Admin-only: re-point to a new verifier (e.g. after a circuit upgrade).
    pub fn set_verifier(env: Env, verifier: Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage().instance().set(&DataKey::Verifier, &verifier);
        Ok(())
    }
}

#[cfg(test)]
mod test;
