pragma circom 2.2.2;

include "./lib/merkleProof.circom";

// Multi-credential proof helper.
// Proves that N attribute hashes are members of N credential roots in one proof.
//
// Public inputs:
//   - credentialRoots[N]
//   - attributeHashes[N]
// Private inputs:
//   - witnesses[N][depth]
//   - pathIndices[N]
//
// Each credential is verified independently and the resulting single proof
// attests all memberships together.
template MultiCredentialVerifier(n, depth) {
    signal input credentialRoots[n];
    signal input attributeHashes[n];

    signal input witnesses[n][depth];
    signal input pathIndices[n];

    component trees[n];

    for (var i = 0; i < n; i++) {
        trees[i] = MerkleProof(depth);
        trees[i].leaf <== attributeHashes[i];
        trees[i].pathIndices <== pathIndices[i];

        for (var j = 0; j < depth; j++) {
            trees[i].pathElements[j] <== witnesses[i][j];
        }

        trees[i].root === credentialRoots[i];
    }
}

component main {public [credentialRoots, attributeHashes]} =
    MultiCredentialVerifier(2, 20);
