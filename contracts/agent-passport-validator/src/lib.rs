// contracts/agent-passport-validator/src/lib.rs
#![no_std]
//! AgentPassportValidator
//!
//! The stateful policy layer on top of the stateless `circom-groth16-verifier`.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, BytesN, Env,
    Symbol, Vec, U256,
};

mod verifier {
    soroban_sdk::contractimport!(file = "verifier.wasm");
}

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

/// ~30 days of ledgers (5s close time)
const TTL_BUMP: u32 = 518_400;
const TTL_THRESHOLD: u32 = 17_280;

/// Rate limit window: 10 ledgers ≈ 1 minute at 5s/ledger
const RATE_LIMIT_WINDOW: u32 = 10;
const DEFAULT_RATE_LIMIT: u32 = 10;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    BadPublicInputs = 3,
    NullifierUsed = 4,
    InvalidProof = 5,
    UnknownRegistryRoot = 6,
    BatchTooLarge = 7,
    /// Caller exceeded the rate limit for this window.
    RateLimitExceeded = 8,
    /// Only admin can perform this action.
    Unauthorized = 9,
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

/// Rate limit tracking per caller.
#[contracttype]
#[derive(Clone, Debug, Default)]
pub struct RateLimitState {
    /// Ledger sequence when the current window started.
    pub window_start: u32,
    /// Call count in the current window.
    pub count: u32,
}

/// Admin-adjustable rate limit configuration.
#[contracttype]
#[derive(Clone, Debug)]
pub struct RateLimitConfig {
    pub max_calls: u32,
    pub window_ledgers: u32,
}

#[contracttype]
enum DataKey {
    Admin,
    PendingAdmin,
    Initialized,
    Verifier,
    Nullifier(U256),
    Passport(U256),
    RegistryRoot(U256),
    RegistryRoots,
    AuditEntry(u64),
    AuditSequence,
    /// Rate limit state per caller address.
    RateLimit(Address),
    /// Global rate limit configuration.
    RateLimitConfig,
}

#[contract]
pub struct AgentPassportValidator;

#[contractimpl]
impl AgentPassportValidator {
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
        // Initialize default rate limit config
        storage.set(
            &DataKey::RateLimitConfig,
            &RateLimitConfig {
                max_calls: DEFAULT_RATE_LIMIT,
                window_ledgers: RATE_LIMIT_WINDOW,
            },
        );

        env.events().publish(
            (Symbol::new(&env, "AdminChanged"),),
            AdminChanged {
                old: None,
                new: admin,
            },
        );
    }

    /// Admin setter: adjust the max calls per window.
    pub fn set_rate_limit(env: Env, max_calls: u32) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
            .unwrap();
        admin.require_auth();

        let mut config: RateLimitConfig = env
            .storage()
            .instance()
            .get(&DataKey::RateLimitConfig)
            .unwrap_or(RateLimitConfig {
                max_calls: DEFAULT_RATE_LIMIT,
                window_ledgers: RATE_LIMIT_WINDOW,
            });
        config.max_calls = max_calls;
        env.storage().instance().set(&DataKey::RateLimitConfig, &config);
    }

    /// Read the current rate limit config.
    pub fn get_rate_limit(env: Env) -> RateLimitConfig {
        env.storage()
            .instance()
            .get(&DataKey::RateLimitConfig)
            .unwrap_or(RateLimitConfig {
                max_calls: DEFAULT_RATE_LIMIT,
                window_ledgers: RATE_LIMIT_WINDOW,
            })
    }

    fn check_rate_limit(env: &Env, caller: &Address) -> Result<(), Error> {
        let config: RateLimitConfig = env
            .storage()
            .instance()
            .get(&DataKey::RateLimitConfig)
            .unwrap_or(RateLimitConfig {
                max_calls: DEFAULT_RATE_LIMIT,
                window_ledgers: RATE_LIMIT_WINDOW,
            });

        let current_ledger = env.ledger().sequence();
        let key = DataKey::RateLimit(caller.clone());
        let persistent = env.storage().persistent();

        let mut state: RateLimitState = persistent.get(&key).unwrap_or(RateLimitState {
            window_start: current_ledger,
            count: 0,
        });

        // Reset if window has passed
        if current_ledger >= state.window_start + config.window_ledgers {
            state = RateLimitState {
                window_start: current_ledger,
                count: 0,
            };
        }

        if state.count >= config.max_calls {
            return Err(Error::RateLimitExceeded);
        }

        state.count += 1;
        persistent.set(&key, &state);
        // TTL: keep alive for the window + some buffer
        persistent.extend_ttl(&key, TTL_THRESHOLD, TTL_BUMP);

        Ok(())
    }

    fn verify_internal(
        env: &Env,
        caller: &Address,
        proof: &Groth16Proof,
        public_inputs: &Vec<U256>,
    ) -> Result<Attestation, Error> {
        extend_instance_ttl(&env);

        // Rate limit check
        Self::check_rate_limit(env, caller)?;

        if public_inputs.len() != N_PUBLIC_INPUTS {
            return Err(Error::BadPublicInputs);
        }

        let nullifier = public_inputs.get_unchecked(IDX_NULLIFIER);
        let agent_id = public_inputs.get_unchecked(IDX_AGENT_ID);
        let registry_root = public_inputs.get_unchecked(0);
        let spend_cap = public_inputs.get_unchecked(IDX_SPEND_CAP);

        // (0) check registry root allow-list
        if !env
            .storage()
            .instance()
            .has(&DataKey::RegistryRoot(registry_root.clone()))
        {
            return Err(Error::UnknownRegistryRoot);
        }

        // (1) anti-replay
        let persistent = env.storage().persistent();
        let nf_key = DataKey::Nullifier(nullifier.clone());
        if persistent.has(&nf_key) {
            return Err(Error::NullifierUsed);
        }

        // (2) cross-contract verify
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

        // (3) commit
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

    pub fn verify_and_register(
        env: Env,
        caller: Address,
        proof: Groth16Proof,
        public_inputs: Vec<U256>,
    ) -> Result<Attestation, Error> {
        Self::verify_internal(&env, &caller, &proof, &public_inputs)
    }

    pub fn verify_batch(env: Env, caller: Address, proofs: Vec<VerifyInput>) -> Result<Vec<VerifyResult>, Error> {
        if proofs.len() > 8 {
            return Err(Error::BatchTooLarge);
        }

        let mut results = Vec::new(&env);
        for input in proofs.iter() {
            let root = input
                .public_inputs
                .get(0)
                .unwrap_or(U256::from_u32(&env, 0));
            match Self::verify_internal(&env, &caller, &input.proof, &input.public_inputs) {
                Ok(_) => {
                    results.push_back(VerifyResult {
                        root,
                        success: true,
                        error: None,
                    });
                }
                Err(e) => {
                    results.push_back(VerifyResult {
                        root,
                        success: false,
                        error: Some(Symbol::new(&env, format!("{:?}", e).as_str())),
                    });
                }
            }
        }

        Ok(results)
    }

    // ... existing admin functions, getters, etc. remain unchanged ...
    // (propose_admin, accept_admin, renounce_admin, set_verifier,
    //  add_registry_root, remove_registry_root, list_registry_roots,
    //  get_passport, is_registered, is_nullifier_used, audit_log, etc.)
}

fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_BUMP);
}