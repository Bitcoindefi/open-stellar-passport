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
    BytesN, Env, U256, Vec,
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
    /// The proof's `registryRoot` is not in the attested allow-list. Without
    /// this check, a prover could build their own Merkle tree and forge
    /// membership — see issue #1.
    UnknownRegistryRoot = 6,
    /// `accept_admin` was called but no transfer is pending.
    NoPendingAdmin = 7,
    /// `authorize_spend` for an agent that holds no passport (#10).
    NotRegistered = 8,
    /// The requested spend would exceed the agent's proven spend cap (#10).
    SpendCapExceeded = 9,
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
enum DataKey {
    Admin,
    /// Proposed next admin, pending its own `accept_admin` (two-step transfer).
    PendingAdmin,
    Verifier,
    /// Operational role allowed to record spends (#10). Defaults to Admin.
    Settler,
    /// A registry root the contract will accept (presence == allowed).
    RegistryRoot(U256),
    /// nullifierHash -> spent (presence == spent).
    Nullifier(U256),
    /// agentId -> latest attestation.
    Passport(U256),
    /// agentId -> cumulative amount already authorized against its spend cap (#10).
    Spent(U256),
}

#[contract]
pub struct AgentPassportValidator;

#[contractimpl]
impl AgentPassportValidator {
    /// One-time wiring: who can administer the contract, the verifier's
    /// contract address, and the first attested `registry_root` the contract
    /// will accept proofs against. Panics on a second call.
    pub fn init(env: Env, admin: Address, verifier: Address, registry_root: U256) {
        let storage = env.storage().instance();
        if storage.has(&DataKey::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        storage.set(&DataKey::Admin, &admin);
        storage.set(&DataKey::Verifier, &verifier);
        storage.set(&DataKey::RegistryRoot(registry_root.clone()), &true);
        env.events()
            .publish((symbol_short!("root_add"),), registry_root);
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

        // (0) personhood — the proof only attests membership in the tree whose
        // root is `registry_root`, but the prover supplies that root. Unless we
        // pin it to an attested allow-list, anyone can prove membership in a
        // tree they built themselves. Reject before the (costly) pairing check.
        if !env
            .storage()
            .instance()
            .has(&DataKey::RegistryRoot(registry_root.clone()))
        {
            return Err(Error::UnknownRegistryRoot);
        }

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

        env.events().publish(
            (symbol_short!("passport"), agent_id),
            (nullifier, spend_cap),
        );

        Ok(attestation)
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
    /// Emits a `verifier` event (old, new) so the swap is observable on-chain.
    pub fn set_verifier(env: Env, verifier: Address) -> Result<(), Error> {
        require_admin(&env)?;
        let instance = env.storage().instance();
        let old: Address = instance.get(&DataKey::Verifier).ok_or(Error::NotInitialized)?;
        instance.set(&DataKey::Verifier, &verifier);
        env.events()
            .publish((symbol_short!("verifier"),), (old, verifier));
        Ok(())
    }

    // ---- registry-root allow-list (#1) ---------------------------------

    /// True iff proofs against this `registry_root` are currently accepted.
    pub fn is_registry_root_allowed(env: Env, registry_root: U256) -> bool {
        env.storage()
            .instance()
            .has(&DataKey::RegistryRoot(registry_root))
    }

    /// Admin-only: attest an additional registry root.
    pub fn add_registry_root(env: Env, registry_root: U256) -> Result<(), Error> {
        require_admin(&env)?;
        env.storage()
            .instance()
            .set(&DataKey::RegistryRoot(registry_root.clone()), &true);
        env.events()
            .publish((symbol_short!("root_add"),), registry_root);
        Ok(())
    }

    /// Admin-only: revoke a previously attested registry root.
    pub fn remove_registry_root(env: Env, registry_root: U256) -> Result<(), Error> {
        require_admin(&env)?;
        env.storage()
            .instance()
            .remove(&DataKey::RegistryRoot(registry_root.clone()));
        env.events()
            .publish((symbol_short!("root_del"),), registry_root);
        Ok(())
    }

    // ---- admin lifecycle (#6) ------------------------------------------

    /// The current admin, if the contract is initialized and not renounced.
    pub fn admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Admin)
    }

    /// Admin-only: propose a new admin. The transfer only takes effect once the
    /// proposed account calls `accept_admin` (two-step, avoids fat-fingering an
    /// unusable address).
    pub fn transfer_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        require_admin(&env)?;
        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &new_admin);
        env.events()
            .publish((symbol_short!("admin_prp"),), new_admin);
        Ok(())
    }

    /// Accept a pending admin transfer. Must be called (and authorized) by the
    /// account named in `transfer_admin`.
    pub fn accept_admin(env: Env) -> Result<(), Error> {
        let instance = env.storage().instance();
        let pending: Address = instance
            .get(&DataKey::PendingAdmin)
            .ok_or(Error::NoPendingAdmin)?;
        pending.require_auth();
        instance.set(&DataKey::Admin, &pending);
        instance.remove(&DataKey::PendingAdmin);
        env.events()
            .publish((symbol_short!("admin_new"),), pending);
        Ok(())
    }

    /// Admin-only: permanently renounce admin. After this the verifier and
    /// registry roots are frozen — no one can change them again.
    pub fn renounce_admin(env: Env) -> Result<(), Error> {
        let admin = require_admin(&env)?;
        let instance = env.storage().instance();
        instance.remove(&DataKey::Admin);
        instance.remove(&DataKey::PendingAdmin);
        env.events().publish((symbol_short!("admin_rnc"),), admin);
        Ok(())
    }

    // ---- on-chain spend gate (#10) -------------------------------------

    /// The settle role allowed to record spends. Defaults to the admin until a
    /// dedicated settler is configured.
    pub fn settler(env: Env) -> Result<Address, Error> {
        settler_addr(&env)
    }

    /// Admin-only: set the operational settle role (kept separate from admin so
    /// a hot facilitator key can't change the verifier or roots).
    pub fn set_settler(env: Env, settler: Address) -> Result<(), Error> {
        require_admin(&env)?;
        env.storage().instance().set(&DataKey::Settler, &settler);
        env.events()
            .publish((symbol_short!("settler"),), settler);
        Ok(())
    }

    /// Amount of an agent's proven spend cap that is still unspent.
    pub fn remaining_cap(env: Env, agent_id: U256) -> Result<U256, Error> {
        let passport: Attestation = env
            .storage()
            .persistent()
            .get(&DataKey::Passport(agent_id.clone()))
            .ok_or(Error::NotRegistered)?;
        let spent = spent_so_far(&env, &agent_id);
        Ok(saturating_sub(&env, &passport.spend_cap, &spent))
    }

    /// Settle-gate entry point (the x402 facilitator calls this before settling
    /// a payment). Records `amount` against the agent's proven spend cap,
    /// rejecting any spend that would push the running total over the cap.
    /// Returns the cap still remaining after this authorization.
    pub fn authorize_spend(env: Env, agent_id: U256, amount: U256) -> Result<U256, Error> {
        settler_addr(&env)?.require_auth();

        let passport: Attestation = env
            .storage()
            .persistent()
            .get(&DataKey::Passport(agent_id.clone()))
            .ok_or(Error::NotRegistered)?;

        let spent = spent_so_far(&env, &agent_id);
        let new_spent = spent.add(&amount);
        if new_spent.gt(&passport.spend_cap) {
            return Err(Error::SpendCapExceeded);
        }

        let persistent = env.storage().persistent();
        let key = DataKey::Spent(agent_id.clone());
        persistent.set(&key, &new_spent);
        persistent.extend_ttl(&key, TTL_THRESHOLD, TTL_BUMP);

        let remaining = saturating_sub(&env, &passport.spend_cap, &new_spent);
        env.events()
            .publish((symbol_short!("spend"), agent_id), (amount, remaining.clone()));
        Ok(remaining)
    }
}

/// Load the admin and require its authorization, or surface `NotInitialized`
/// (also the post-renounce state).
fn require_admin(env: &Env) -> Result<Address, Error> {
    let admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(Error::NotInitialized)?;
    admin.require_auth();
    Ok(admin)
}

/// The configured settler, falling back to the admin when unset.
fn settler_addr(env: &Env) -> Result<Address, Error> {
    let instance = env.storage().instance();
    match instance.get(&DataKey::Settler) {
        Some(s) => Ok(s),
        None => instance.get(&DataKey::Admin).ok_or(Error::NotInitialized),
    }
}

fn spent_so_far(env: &Env, agent_id: &U256) -> U256 {
    env.storage()
        .persistent()
        .get(&DataKey::Spent(agent_id.clone()))
        .unwrap_or_else(|| U256::from_u32(env, 0))
}

/// `a - b`, clamped at zero (cap is always >= spent, but stay total).
fn saturating_sub(env: &Env, a: &U256, b: &U256) -> U256 {
    if a.gt(b) || a == b {
        a.sub(b)
    } else {
        U256::from_u32(env, 0)
    }
}

#[cfg(test)]
mod test;
