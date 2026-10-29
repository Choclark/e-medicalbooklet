#pragma once

#include <string>
#include <vector>
#include <cstdint>
#include <stdexcept>
#include "CCrypto/Sha256.h"

namespace CMerkle {

// A single step in the Merkle audit path
struct MerkleProofStep {
    std::string siblingHash;  // Hash of the sibling node
    bool isLeftSibling;       // True if sibling is on the left, false if on the right
};

// Cryptographic Merkle Inclusion Proof
struct MerkleProof {
    uint32_t leafIndex{0};
    std::string leafHash;
    std::vector<MerkleProofStep> steps; // Sibling hashes from bottom to root
    std::string expectedRoot;

    // Mathematically verifies that leafHash is included in expectedRoot
    bool verify(const std::string& root) const {
        if (root.empty() || leafHash.empty()) return false;
        std::string current = leafHash;

        for (const auto& step : steps) {
            std::string combined;
            if (step.isLeftSibling) {
                combined = step.siblingHash + current;
            } else {
                combined = current + step.siblingHash;
            }
            current = CCrypto::Sha256::hashHex(combined);
        }

        return current == root;
    }
};

class CMerkleTree {
public:
    CMerkleTree() = default;
    explicit CMerkleTree(const std::vector<std::string>& leafHashes);

    void build(const std::vector<std::string>& leafHashes);

    std::string getRoot() const;
    size_t getLeafCount() const { return m_leafCount; }
    size_t getDepth() const { return m_levels.size(); }

    // Generates a Merkle inclusion proof for the leaf at leafIndex (tx_order)
    MerkleProof getProof(uint32_t leafIndex) const;

    // Helper: Verify any leaf against an expected root using its proof
    static bool verifyProof(const std::string& leafHash,
                            const MerkleProof& proof,
                            const std::string& expectedRoot);

    // Serialization to disk
    std::vector<uint8_t> serialize() const;
    static CMerkleTree deserialize(const uint8_t* data, size_t size);

    size_t estimateMemoryBytes() const;

private:
    size_t m_leafCount{0};
    std::vector<std::vector<std::string>> m_levels; // Level 0 = leaves, Level N = root
};

} // namespace CMerkle
