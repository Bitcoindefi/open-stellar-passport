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
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, Address,
    BytesN, Env, Vec, U256,
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
#[derive(Clone)]
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

#[contractevent(topics = ["passport"], data_format = "vec")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PassportRegistered {
    #[topic]
    pub agent_id: U256,
    pub nullifier: U256,
    pub spend_cap: U256,
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
            a: proof.a,
            b: proof.b,
            c: proof.c,
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

        PassportRegistered {
            agent_id,
            nullifier,
            spend_cap,
        }
        .publish(&env);

        Ok(attestation)
    }

    /// True iff `agent_id` holds a minted zk-passport.
    pub fn is_registered(env: Env, agent_id: U256) -> bool {
        env.storage().persistent().has(&DataKey::Passport(agent_id))
    }

    /// Fetch the stored attestation for an agent, if any.
    pub fn get_passport(env: Env, agent_id: U256) -> Option<Attestation> {
        env.storage().persistent().get(&DataKey::Passport(agent_id))
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
