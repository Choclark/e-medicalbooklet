#pragma once

#include <cstdint>
#include <string>
#include <filesystem>

struct BlockchainConfig {
    // Memory budgets in bytes (default configured as requested)
    uint64_t blockchainMemoryLimitBytes{4ULL * 1024 * 1024 * 1024}; // 4 GB for blockchain blocks
    uint64_t blockHeaderMemoryLimitBytes{2ULL * 1024 * 1024 * 1024}; // 2 GB for block headers
    uint64_t schemaMemoryLimitBytes{1ULL * 1024 * 1024 * 1024};     // 1 GB for schemas

    // Frame size definitions
    uint32_t maxBlockSizeBytes{32 * 1024};                           // 32 KB max block size
    uint32_t headerSizeBytes{160};                                   // ~160 B average header frame

    // File storage configuration
    uint64_t maxBlockFileSizeBytes{128ULL * 1024 * 1024};            // 128 MB per block storage file
    std::string dataDir{"chaindata"};
    std::string configPath{"blockchain.conf"};

    // PBFT Consensus settings
    uint32_t consensusQuorumCount{3};                                // 2f+1 default for 4 nodes
    uint32_t maxTransactionsPerBlock{256};
    int64_t maxFutureDriftSeconds{120};                              // Max 2 mins clock skew

    // Calculated frame capacities for LRU caches:
    // frames = memory_budget / frame_size
    size_t getBlockCacheCapacity() const {
        return static_cast<size_t>(blockchainMemoryLimitBytes / maxBlockSizeBytes);
    }

    size_t getHeaderCacheCapacity() const {
        return static_cast<size_t>(blockHeaderMemoryLimitBytes / headerSizeBytes);
    }
};

class CConfig {
public:
    static BlockchainConfig load(const std::string& configFilePath = "blockchain.conf");
    static void saveDefault(const std::string& configFilePath = "blockchain.conf");
};
