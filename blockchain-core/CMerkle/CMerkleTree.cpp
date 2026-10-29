#include "CMerkleTree.h"
#include "CCommon/Serializer.h"

namespace CMerkle {

CMerkleTree::CMerkleTree(const std::vector<std::string>& leafHashes) {
    build(leafHashes);
}

void CMerkleTree::build(const std::vector<std::string>& leafHashes) {
    m_levels.clear();
    m_leafCount = leafHashes.size();

    if (leafHashes.empty()) {
        m_levels.push_back({CCrypto::Sha256::hashHex("EMPTY_TX_POOL")});
        return;
    }

    // Level 0 contains the transaction leaf hashes
    m_levels.push_back(leafHashes);

    while (m_levels.back().size() > 1) {
        const auto& currentLevel = m_levels.back();
        std::vector<std::string> nextLevel;
        nextLevel.reserve((currentLevel.size() + 1) / 2);

        for (size_t i = 0; i < currentLevel.size(); i += 2) {
            std::string left = currentLevel[i];
            // If odd number of nodes at this level, duplicate the last node
            std::string right = (i + 1 < currentLevel.size()) ? currentLevel[i + 1] : left;
            nextLevel.push_back(CCrypto::Sha256::hashHex(left + right));
        }

        m_levels.push_back(std::move(nextLevel));
    }
}

std::string CMerkleTree::getRoot() const {
    if (m_levels.empty() || m_levels.back().empty()) {
        return CCrypto::Sha256::hashHex("EMPTY_TX_POOL");
    }
    return m_levels.back()[0];
}

MerkleProof CMerkleTree::getProof(uint32_t leafIndex) const {
    if (leafIndex >= m_leafCount || m_levels.empty()) {
        throw std::out_of_range("getProof: leaf index out of range in Merkle tree");
    }

    MerkleProof proof;
    proof.leafIndex = leafIndex;
    proof.leafHash = m_levels[0][leafIndex];
    proof.expectedRoot = getRoot();

    uint32_t currentIdx = leafIndex;

    // Traverse upwards from level 0 to the level just below the root
    for (size_t l = 0; l + 1 < m_levels.size(); ++l) {
        const auto& levelNodes = m_levels[l];
        MerkleProofStep step;

        if (currentIdx % 2 == 0) {
            // Sibling is to the right
            step.isLeftSibling = false;
            if (currentIdx + 1 < levelNodes.size()) {
                step.siblingHash = levelNodes[currentIdx + 1];
            } else {
                // Duplicated odd last leaf
                step.siblingHash = levelNodes[currentIdx];
            }
        } else {
            // Sibling is to the left
            step.isLeftSibling = true;
            step.siblingHash = levelNodes[currentIdx - 1];
        }

        proof.steps.push_back(std::move(step));
        currentIdx /= 2;
    }

    return proof;
}

bool CMerkleTree::verifyProof(const std::string& leafHash,
                             const MerkleProof& proof,
                             const std::string& expectedRoot) {
    if (proof.leafHash != leafHash) {
        return false;
    }
    return proof.verify(expectedRoot);
}

std::vector<uint8_t> CMerkleTree::serialize() const {
    ByteWriter w;
    w.writeU32(static_cast<uint32_t>(m_leafCount));
    w.writeU32(static_cast<uint32_t>(m_levels.size()));

    for (const auto& level : m_levels) {
        w.writeU32(static_cast<uint32_t>(level.size()));
        for (const auto& hash : level) {
            w.writeString(hash);
        }
    }
    return std::move(w.data());
}

CMerkleTree CMerkleTree::deserialize(const uint8_t* data, size_t size) {
    ByteReader r(data, size);
    CMerkleTree tree;
    tree.m_leafCount = r.readU32();
    uint32_t numLevels = r.readU32();

    tree.m_levels.resize(numLevels);
    for (uint32_t l = 0; l < numLevels; ++l) {
        uint32_t levelSize = r.readU32();
        tree.m_levels[l].resize(levelSize);
        for (uint32_t i = 0; i < levelSize; ++i) {
            tree.m_levels[l][i] = r.readString();
        }
    }
    return tree;
}

size_t CMerkleTree::estimateMemoryBytes() const {
    size_t sz = sizeof(CMerkleTree);
    for (const auto& lvl : m_levels) {
        sz += sizeof(std::vector<std::string>);
        for (const auto& h : lvl) {
            sz += h.capacity();
        }
    }
    return sz;
}

} // namespace CMerkle
