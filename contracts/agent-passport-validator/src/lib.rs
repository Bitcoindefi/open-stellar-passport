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
//! Auditors can enumerate the small registry-root allow-list with
//! `list_registry_roots`. Spent nullifiers remain event-sourced from
//! `PassportRegistered` events to avoid an unbounded on-chain list, while
//! `is_nullifier_used` provides point-in-time cross-checks.
//!
//! Public-input layout (must match the circuit's `main {public [...]}`):
//!   [0] registryRoot   [1] nullifierHash   [2] agentId   [3] spendCap

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, BytesN, Env,
    Symbol, Vec, U256,
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
const MAX_VERIFICATIONS_PER_LEDGER: u32 = 5;
const VERIFY_COUNT_TTL_LEDGERS: u32 = 1;

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
    /// The registry root is not in the approved allow-list.
    UnknownRegistryRoot = 6,
    /// Batch size exceeds the limit of 8.
    BatchTooLarge = 7,
    /// This wallet exceeded the per-ledger credential verification limit.
    RateLimitExceeded = 8,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct AdminChanged {
    pub old: Option<Address>,
    pub new: Address,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct VerifierChanged {
    pub old: Address,
    pub new: Address,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct AdminTransferStarted {
    pub old: Address,
    pub new: Address,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct AdminRenounced {
    pub old: Address,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct PassportRegistered {
    pub agent_id: U256,
    pub nullifier: U256,
    pub spend_cap: U256,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct RateLimited {
    pub wallet: Address,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct AuditRecord {
    pub action: Symbol,
    pub actor: Address,
    pub root: BytesN<32>,
    pub ledger: u32,
    pub success: bool,
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
    PendingAdmin,
    Initialized,
    Verifier,
    /// nullifierHash -> spent (presence == spent).
    Nullifier(U256),
    /// agentId -> latest attestation.
    Passport(U256),
    /// Approved Merkle root of the identity registry.
    RegistryRoot(U256),
    /// Small enumerated index of approved registry roots for audit reads.
    RegistryRoots,
    AuditEntry(u64),
    AuditSequence,
    VerifyCount(Address, u32),
}

#[contract]
pub struct AgentPassportValidator;

#[contractimpl]
impl AgentPassportValidator {
    /// One-time wiring: who can re-point the verifier, and the verifier's
    /// contract address. Panics on a second call.
    pub fn init(env: Env, admin: Address, verifier: Address, initial_root: U256) {
        let storage = env.storage().instance();
        if storage.has(&DataKey::Initialized) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        storage.set(&DataKey::Initialized, &true);
        storage.set(&DataKey::Admin, &admin);
        storage.set(&DataKey::Verifier, &verifier);
        storage.set(&DataKey::RegistryRoot(initial_root.clone()), &true);
        storage.set(
            &DataKey::RegistryRoots,
            &Vec::from_array(&env, [initial_root]),
        );

        env.events().publish(
            (Symbol::new(&env, "AdminChanged"),),
            AdminChanged {
                old: None,
                new: admin,
            },
        );
    }

    /// Internal logic for verifying a single passport proof.
    fn verify_internal(
        env: &Env,
        proof: &Groth16Proof,
        public_inputs: &Vec<U256>,
    ) -> Result<Attestation, Error> {
        extend_instance_ttl(&env);

        if public_inputs.len() != N_PUBLIC_INPUTS {
            return Err(Error::BadPublicInputs);
        }

        let nullifier = public_inputs.get_unchecked(IDX_NULLIFIER);
        let agent_id = public_inputs.get_unchecked(IDX_AGENT_ID);
        let registry_root = public_inputs.get_unchecked(0);
        let spend_cap = public_inputs.get_unchecked(IDX_SPEND_CAP);

        // (0) check registry root allow-list — personhood check.
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
            (Symbol::new(&env, "PassportRegistered"),),
            PassportRegistered {
                agent_id,
                nullifier,
                spend_cap,
            },
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
            let root = input
                .public_inputs
                .get(0)
                .unwrap_or(U256::from_u32(&env, 0));
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
                        Error::UnknownRegistryRoot => {
                            Some(Symbol::new(&env, "UnknownRegistryRoot"))
                        }
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

        let old: Address = env
            .storage()
            .instance()
            .get(&DataKey::Verifier)
            .ok_or(Error::NotInitialized)?;

        env.storage().instance().set(&DataKey::Verifier, &verifier);

        env.events().publish(
            (Symbol::new(&env, "VerifierChanged"),),
            VerifierChanged { old, new: verifier },
        );

        extend_instance_ttl(&env);
        Ok(())
    }

    /// Admin-only: add a new trusted registry root to the allow-list.
    pub fn add_registry_root(env: Env, root: U256) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        let instance = env.storage().instance();
        let root_key = DataKey::RegistryRoot(root.clone());
        if !instance.has(&root_key) {
            instance.set(&root_key, &true);

            let mut roots: Vec<U256> = instance
                .get(&DataKey::RegistryRoots)
                .unwrap_or(Vec::new(&env));
            roots.push_back(root);
            instance.set(&DataKey::RegistryRoots, &roots);
        }
        extend_instance_ttl(&env);
        Ok(())
    }

    /// Admin-only: remove a registry root from the allow-list.
    pub fn remove_registry_root(env: Env, root: U256) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        let instance = env.storage().instance();
        instance.remove(&DataKey::RegistryRoot(root.clone()));

        let roots: Vec<U256> = instance
            .get(&DataKey::RegistryRoots)
            .unwrap_or(Vec::new(&env));
        let mut filtered = Vec::new(&env);
        for approved_root in roots.iter() {
            if approved_root != root {
                filtered.push_back(approved_root);
            }
        }
        instance.set(&DataKey::RegistryRoots, &filtered);
        extend_instance_ttl(&env);
        Ok(())
    }

    /// Admin-only: Propose a new admin.
    pub fn transfer_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &new_admin);

        env.events().publish(
            (Symbol::new(&env, "AdminTransferStarted"),),
            AdminTransferStarted {
                old: admin,
                new: new_admin,
            },
        );

        Ok(())
    }

    /// The proposed admin accepts the role.
    pub fn accept_admin(env: Env) -> Result<(), Error> {
        let pending_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .ok_or(Error::NotInitialized)?;
        pending_admin.require_auth();

        let old_admin: Option<Address> = env.storage().instance().get(&DataKey::Admin);

        env.storage()
            .instance()
            .set(&DataKey::Admin, &pending_admin);
        env.storage().instance().remove(&DataKey::PendingAdmin);

        env.events().publish(
            (Symbol::new(&env, "AdminChanged"),),
            AdminChanged {
                old: old_admin,
                new: pending_admin,
            },
        );

        Ok(())
    }

    /// Admin-only: Renounce the admin role.
    pub fn renounce_admin(env: Env) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        env.storage().instance().remove(&DataKey::Admin);
        env.storage().instance().remove(&DataKey::PendingAdmin);

        env.events().publish(
            (Symbol::new(&env, "AdminRenounced"),),
            AdminRenounced { old: admin },
        );

        Ok(())
    }

    /// True iff `root` is in the approved allow-list.
    pub fn is_registry_root_approved(env: Env, root: U256) -> bool {
        env.storage().instance().has(&DataKey::RegistryRoot(root))
    }

    /// List currently approved registry roots for auditors and indexers.
    pub fn list_registry_roots(env: Env) -> Vec<U256> {
        env.storage()
            .instance()
            .get(&DataKey::RegistryRoots)
            .unwrap_or(Vec::new(&env))
    }

    /// Explicitly bump the TTL of the contract instance.
    pub fn bump_ttl(env: Env) {
        extend_instance_ttl(&env);
    }

    pub fn issue_credential(env: Env, actor: Address, root: BytesN<32>) -> Result<(), Error> {
        actor.require_auth();

        let instance = env.storage().instance();
        let seq: u64 = instance.get(&DataKey::AuditSequence).unwrap_or(0);

        let record = AuditRecord {
            action: Symbol::new(&env, "issue"),
            actor: actor.clone(),
            root,
            ledger: env.ledger().sequence(),
            success: true,
        };

        let persistent = env.storage().persistent();
        let key = DataKey::AuditEntry(seq);
        persistent.set(&key, &record);
        persistent.extend_ttl(&key, TTL_THRESHOLD, TTL_BUMP);

        instance.set(&DataKey::AuditSequence, &(seq + 1));
        extend_instance_ttl(&env);

        Ok(())
    }

    pub fn verify_credential(
        env: Env,
        actor: Address,
        root: BytesN<32>,
        success: bool,
    ) -> Result<bool, Error> {
        actor.require_auth();

        let ledger_sequence = env.ledger().sequence();
        let count_key = DataKey::VerifyCount(actor.clone(), ledger_sequence);
        let temporary = env.storage().temporary();
        let verify_count: u32 = temporary.get(&count_key).unwrap_or(0);
        if verify_count >= MAX_VERIFICATIONS_PER_LEDGER {
            env.events().publish(
                (Symbol::new(&env, "rate_limited"),),
                RateLimited {
                    wallet: actor.clone(),
                },
            );
            return Err(Error::RateLimitExceeded);
        }
        temporary.set(&count_key, &(verify_count + 1));
        temporary.extend_ttl(
            &count_key,
            VERIFY_COUNT_TTL_LEDGERS,
            VERIFY_COUNT_TTL_LEDGERS,
        );

        let instance = env.storage().instance();
        let seq: u64 = instance.get(&DataKey::AuditSequence).unwrap_or(0);

        let action = if success {
            Symbol::new(&env, "verify_ok")
        } else {
            Symbol::new(&env, "verify_fail")
        };

        let record = AuditRecord {
            action,
            actor: actor.clone(),
            root,
            ledger: ledger_sequence,
            success,
        };

        let persistent = env.storage().persistent();
        let key = DataKey::AuditEntry(seq);
        persistent.set(&key, &record);
        persistent.extend_ttl(&key, TTL_THRESHOLD, TTL_BUMP);

        instance.set(&DataKey::AuditSequence, &(seq + 1));
        extend_instance_ttl(&env);

        Ok(success)
    }

    pub fn revoke_credential(env: Env, actor: Address, root: BytesN<32>) -> Result<(), Error> {
        actor.require_auth();

        let instance = env.storage().instance();
        let seq: u64 = instance.get(&DataKey::AuditSequence).unwrap_or(0);

        let record = AuditRecord {
            action: Symbol::new(&env, "revoke"),
            actor: actor.clone(),
            root,
            ledger: env.ledger().sequence(),
            success: true,
        };

        let persistent = env.storage().persistent();
        let key = DataKey::AuditEntry(seq);
        persistent.set(&key, &record);
        persistent.extend_ttl(&key, TTL_THRESHOLD, TTL_BUMP);

        instance.set(&DataKey::AuditSequence, &(seq + 1));
        extend_instance_ttl(&env);

        Ok(())
    }

    pub fn get_audit_entry(env: Env, seq: u64) -> Option<AuditRecord> {
        env.storage().persistent().get(&DataKey::AuditEntry(seq))
    }

    pub fn audit_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::AuditSequence)
            .unwrap_or(0)
    }
}

fn extend_instance_ttl(env: &Env) {
    env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_BUMP);
}

#[cfg(test)]
mod test;
