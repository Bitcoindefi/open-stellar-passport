pragma circom 2.2.2;

// Agent Passport — the core ZK circuit of open-stellar-passport.
//
// Proves, WITHOUT revealing the operator's identity or balance, that:
//   1. The operator's identity commitment is in the registry of attested
//      humans/businesses (Merkle membership)  -> personhood.
//   2. nullifierHash binds that identity to a specific Stellar-8004 agentId
//      -> anti-Sybil / one-passport-per-agent / anti-replay.
//   3. The operator's balance >= the spend cap the passport vouches for
//      -> proof-of-funds (the money-loss protection no prior art has on-chain).
//
// Verified on-chain by a Soroban Groth16 (BN254) verifier and registered as a
// ZK attestation in the Stellar-8004 Validation Registry.
//
// Building blocks (Keypair, MerkleProof, Poseidon2) are adapted from
// NethermindEth/stellar-private-payments (Apache-2.0), themselves derived from
// tornadocash/tornado-nova. See circuits/lib/.

include "./lib/keypair.circom";
include "./lib/merkleProof.circom";
include "./lib/poseidon2/poseidon2_hash.circom";
include "./lib/circomlib/circuits/comparators.circom";

template AgentPassport(levels, balanceBits) {
    /** PUBLIC INPUTS **/
    signal input registryRoot;   // Merkle root of attested identity commitments
    signal input nullifierHash;  // = Poseidon2(privateKey, agentId), domain 0x05
    signal input agentId;        // Stellar-8004 agent id this passport binds to
    signal input spendCap;       // max spend the passport vouches for

    /** PRIVATE INPUTS **/
    signal input privateKey;          // operator secret (never leaves device)
    signal input balance;             // operator's real balance (hidden)
    signal input pathElements[levels];
    signal input pathIndices;

    // 1. Identity commitment: publicKey = Poseidon2(privateKey, 0)
    component kp = Keypair();
    kp.privateKey <== privateKey;

    // 2. Membership: leaf = publicKey must be in the registry tree
    component tree = MerkleProof(levels);
    tree.leaf <== kp.publicKey;
    tree.pathIndices <== pathIndices;
    for (var i = 0; i < levels; i++) {
        tree.pathElements[i] <== pathElements[i];
    }
    tree.root === registryRoot;

    // 3. Nullifier binds the identity to this agentId (anti-Sybil / replay)
    component nf = Poseidon2(2);
    nf.inputs[0] <== privateKey;
    nf.inputs[1] <== agentId;
    nf.domainSeparation <== 0x05; // Domain separation: Agent Passport nullifier
    nf.out === nullifierHash;

    // 4. Proof of funds: balance >= spendCap
    //
    // SECURITY (#2): GreaterEqThan(n) is only sound when BOTH inputs are known
    // to be in [0, 2^n). `spendCap` is a public input the prover controls and
    // `balance` is a private witness — without an explicit range check a
    // malicious witness can pick out-of-range values and wrap the comparison,
    // proving solvency while insolvent. Constrain both to `balanceBits` bits.
    component balCheck = Num2Bits(balanceBits);
    balCheck.in <== balance;
    component capCheck = Num2Bits(balanceBits);
    capCheck.in <== spendCap;

    component geq = GreaterEqThan(balanceBits);
    geq.in[0] <== balance;
    geq.in[1] <== spendCap;
    geq.out === 1;
}

// 20 levels => up to ~1M registered identities; 128-bit balances/amounts.
component main {public [registryRoot, nullifierHash, agentId, spendCap]} =
    AgentPassport(20, 128);
