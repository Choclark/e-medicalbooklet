#pragma once

#include <string>
#include <filesystem>
#include <memory>
#include <mutex>
#include <optional>
#include "CMerkleTree.h"
#include "CCommon/LruCache.h"

namespace CMerkle {

class CMerkleStore {
public:
    explicit CMerkleStore(std::filesystem::path storageDir = "chaindata/merkle_trees",
                          uint64_t memoryLimitBytes = 2ULL * 1024 * 1024 * 1024); // 2GB memory limit

    ~CMerkleStore() = default;

    // Save a block's Merkle tree to disk and memory cache
    bool saveTree(uint64_t blockHeight, const CMerkleTree& tree);

    // Retrieve a block's Merkle tree (from 2GB RAM cache or disk)
    std::optional<CMerkleTree> getTree(uint64_t blockHeight);

    // Check if tree exists
    bool hasTree(uint64_t blockHeight);

    // Convenience: Generate Merkle proof for a specific transaction order in a block
    std::optional<MerkleProof> getProof(uint64_t blockHeight, uint32_t txOrder);

    // Cache metrics
    LruCache<uint64_t, CMerkleTree>::Stats getCacheStats() const { return m_cache.stats(); }
    size_t getCachedCount() const { return m_cache.size(); }

    std::filesystem::path getStoragePath(uint64_t blockHeight) const;

private:
    std::filesystem::path m_storageDir;
    uint64_t m_memoryLimitBytes;
    mutable std::mutex m_mutex;
    LruCache<uint64_t, CMerkleTree> m_cache;

    bool writeToDisk(uint64_t blockHeight, const CMerkleTree& tree);
    std::optional<CMerkleTree> readFromDisk(uint64_t blockHeight);
};

} // namespace CMerkle
