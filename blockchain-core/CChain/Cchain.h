#pragma once

#include <vector>
#include <string>
#include <memory>
#include <mutex>
#include <optional>

#include "CBlock/Cblock.h"
#include "CConfig/CConfig.h"
#include "CCommon/LruCache.h"
#include "CCommon/ValidationResult.h"
#include "CTransaction/CSchemaRegistry.h"
#include "CConsensus/CConsensusRules.h"
#include "CConsensus/CPbftEngine.h"
#include "CStorage/CBlockStore.h"
#include "CRecordStorage/CRecordStorageManager.h"
#include "CMerkle/CMerkleStore.h"
#include <unordered_map>

// Resolved Medical Record linking on-chain cryptographic reference with off-chain database data
struct FullMedicalRecord {
    COnChainTxRecord onChainRef;
    std::map<std::string, std::string> clinicalData;
    bool integrityVerified{false};
};

class CChain {
public:
    explicit CChain(const std::string& configFile = "blockchain.conf");
    CChain(uint32_t channelId,
           const std::string& channelName,
           const std::string& configFile = "blockchain.conf",
           const std::string& overrideDataDir = "");
    ~CChain();

    CChain(const CChain&) = delete;
    CChain& operator=(const CChain&) = delete;

    // -----------------------------------------------------
    // Transaction Pool (Mempool) - Enforces LAW-1 SCHEMA
    // -----------------------------------------------------
    ValidationResult addTransaction(const CTransaction& tx);
    std::vector<CTransaction> getPendingTransactions() const;
    void clearPendingTransactions();

    // -----------------------------------------------------
    // Block Lifecycle (PBFT Proposal & Commit)
    // -----------------------------------------------------
    CBlock proposeBlock(const std::string& proposerId = "");
    ValidationResult commitBlock(const CBlock& newBlock);

    // -----------------------------------------------------
    // Cache & Disk Queries (O(1) Memory Frame Architecture)
    // -----------------------------------------------------
    std::optional<CBlock> getBlockByHeight(uint64_t height);
    std::optional<BlockHeader> getHeaderByHeight(uint64_t height);
    std::optional<CBlock> getBlockByHash(const std::string& hash);
    CBlock getLatestBlock() const;
    BlockHeader getLatestHeader() const;

    uint64_t getChainHeight() const;
    size_t getTotalBlocks() const;

    // -----------------------------------------------------
    // Off-Chain Database Retrieval & Verification
    // -----------------------------------------------------
    std::optional<FullMedicalRecord> retrieveFullRecord(uint64_t height, uint32_t txOrder);
    std::vector<FullMedicalRecord> retrieveBlockRecords(uint64_t height);

    // Query medical history across blocks
    std::vector<std::string> searchTransactions(const std::string& keyword);

    // -----------------------------------------------------
    // Module Accessors
    // -----------------------------------------------------
    const BlockchainConfig& getConfig() const { return m_config; }
    CSchemaRegistry& getSchemaRegistry() { return m_schemaRegistry; }
    const CBlockStore& getStore() const { return *m_store; }
    CBlockStore& getBlockStore() { return *m_store; }
    CConsensus::CPbftEngine& getPbftEngine() { return m_pbft; }
    CRecordStorage::CRecordStorageManager& getRecordStorage() { return m_recordStorage; }
    CMerkle::CMerkleStore& getMerkleStore() { return m_merkleStore; }
    const CMerkle::CMerkleStore& getMerkleStore() const { return m_merkleStore; }

    // Cache Statistics (Hits / Misses / Evictions / Capacity)
    LruCache<uint64_t, CBlock>::Stats getBlockCacheStats() const { return m_blockCache.stats(); }
    LruCache<uint64_t, BlockHeader>::Stats getHeaderCacheStats() const { return m_headerCache.stats(); }

    // Channel Information
    uint32_t getChannelId() const { return m_channelId; }
    const std::string& getChannelName() const { return m_channelName; }

    void printChainSummary();
    bool isChainValid();

private:
    void initializeGenesisBlock();

    struct StagedPayload {
        std::string schemaName;
        std::string patientId;
        std::string doctorId;
        std::map<std::string, std::string> fields;
        std::string dataHash;
    };

    uint32_t m_channelId{0};
    std::string m_channelName{"MainChain-PatientRecords"};
    BlockchainConfig m_config;
    CRecordStorage::CRecordStorageManager m_recordStorage;
    CSchemaRegistry m_schemaRegistry;
    CConsensus::CConsensusRules m_rules;
    CConsensus::CPbftEngine m_pbft;
    std::unique_ptr<CBlockStore> m_store;
    CMerkle::CMerkleStore m_merkleStore; // 2GB LRU RAM Cache + Disk Merkle store

    // Fixed-frame LRU caches: capacity = memory_budget / frame_size
    LruCache<uint64_t, CBlock> m_blockCache;
    LruCache<uint64_t, BlockHeader> m_headerCache;

    // Latest tip cached
    CBlock m_latestBlock;
    BlockHeader m_latestHeader;
    uint64_t m_chainHeight{0};
    std::vector<CTransaction> m_pendingTransactions;
    std::unordered_map<std::string, StagedPayload> m_stagedPayloads;
    mutable std::recursive_mutex m_chainMutex;
};
