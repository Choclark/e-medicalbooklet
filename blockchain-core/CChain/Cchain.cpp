#include "Cchain.h"
#include <iostream>
#include <algorithm>
#include <filesystem>
#include <stdexcept>

#ifdef DELETE
#undef DELETE
#endif

CChain::CChain(const std::string& configFile)
    : CChain(0, "MainChain-PatientRecords", configFile, "") {}

CChain::CChain(uint32_t channelId,
               const std::string& channelName,
               const std::string& configFile,
               const std::string& overrideDataDir)
    : m_channelId(channelId),
      m_channelName(channelName),
      m_config([&]() {
          auto cfg = CConfig::load(configFile);
          if (!overrideDataDir.empty()) {
              cfg.dataDir = overrideDataDir;
          }
          return cfg;
      }()),
      m_recordStorage(m_config.dataDir),
      m_schemaRegistry(m_config.schemaMemoryLimitBytes),
      m_rules(m_config, m_schemaRegistry),
      m_store(std::make_unique<CBlockStore>(m_config.dataDir, m_config.maxBlockFileSizeBytes)),
      m_merkleStore(std::filesystem::path(m_config.dataDir) / "merkle_trees"),
      m_blockCache(m_config.getBlockCacheCapacity()),
      m_headerCache(m_config.getHeaderCacheCapacity()) {

    // Register storage manager to schema registry so tables/collections are created at schema creation
    m_schemaRegistry.setRecordStorageManager(&m_recordStorage);

    std::cout << "[ChainInit] Channel " << m_channelId << " ('" << m_channelName
              << "') loaded configuration from " << configFile << ":\n";
    std::cout << "  - Data Directory:           " << m_config.dataDir << "\n";
    std::cout << "  - Blockchain Memory Limit:  " << (m_config.blockchainMemoryLimitBytes / (1024 * 1024 * 1024)) << " GB\n";
    std::cout << "  - Max Block Size (Frame):    " << (m_config.maxBlockSizeBytes / 1024) << " KB\n";
    std::cout << "  - Block LRU Cache Capacity:  " << m_config.getBlockCacheCapacity() << " frames\n";
    std::cout << "  - BlockHeader Memory Limit: " << (m_config.blockHeaderMemoryLimitBytes / (1024 * 1024 * 1024)) << " GB\n";
    std::cout << "  - Header LRU Cache Capacity: " << m_config.getHeaderCacheCapacity() << " frames\n";
    std::cout << "  - Schema Memory Limit:      " << (m_config.schemaMemoryLimitBytes / (1024 * 1024 * 1024)) << " GB (Registered: "
              << m_schemaRegistry.getSchemaCount() << " schemas)\n";

    if (m_store->empty()) {
        initializeGenesisBlock();
        std::cout << "[Storage] Channel " << m_channelId << " ('" << m_channelName
                  << "') Genesis block established at height 0.\n\n";
    } else {
        uint64_t count = m_store->getBlockCount();
        m_chainHeight = count - 1;

        auto optLatest = m_store->readBlock(m_chainHeight);
        if (!optLatest) {
            throw std::runtime_error("[Storage] Failed to read tip block #" + std::to_string(m_chainHeight));
        }

        m_latestBlock = *optLatest;
        m_latestHeader = m_latestBlock.getHeader();

        // Warm up cache with latest block
        m_blockCache.put(m_chainHeight, m_latestBlock);
        m_headerCache.put(m_chainHeight, m_latestHeader);

        std::cout << "[Storage] Channel " << m_channelId << " ('" << m_channelName
                  << "') loaded from disk (" << m_config.dataDir << "). Tip at height " << m_chainHeight
                  << " (Hash: " << m_latestHeader.blockHash.substr(0, 16) << "...)\n\n";
    }
}

CChain::~CChain() {
    std::lock_guard<std::recursive_mutex> lock(m_chainMutex);
    if (!m_pendingTransactions.empty()) {
        std::cout << "[Mempool] Purging " << m_pendingTransactions.size()
                  << " uncommitted pending transaction(s) from memory (not persisted to disk).\n";
        m_pendingTransactions.clear();
        m_pendingTransactions.shrink_to_fit();
    }
    m_stagedPayloads.clear();
    m_blockCache.clear();
    m_headerCache.clear();
    if (m_store) {
        m_store->syncToDisk();
        m_store.reset();
    }
    std::cout << "[Chain] CChain cleanly shut down: storage synced, in-memory caches deallocated.\n";
}

void CChain::initializeGenesisBlock() {
    ConsensusMetadata genesisConsensus{
        0,                                 // viewNumber = 0
        0,                                 // sequenceNumber = 0
        m_pbft.getPrimaryNode(),           // proposerId
        "GENESIS_CH" + std::to_string(m_channelId) + "_2F+1_COMMITTED_ROOT" // commitCertificate
    };

    std::string netName = "EMedicalBooklet-Channel" + std::to_string(m_channelId) + "-" + m_channelName;
    std::string policy = (m_channelId == 1) ? "PBFT-2F+1-Identity-Governance" : "PBFT-2F+1-Strict-Privacy";
    std::string genesisDataId = "GENESIS_REC_CH" + std::to_string(m_channelId);
    std::string genesisTxId = "GENESIS-TX-CH" + std::to_string(m_channelId) + "-000000000000000000";

    std::map<std::string, std::string> genesisPayload = {
        {"network_name", netName},
        {"channel_id", std::to_string(m_channelId)},
        {"channel_name", m_channelName},
        {"policy", policy}
    };
    std::string genesisDataHash = CRecordStorage::CRecordStorageManager::calculateDataHash(genesisPayload);

    // Persist real genesis payload to Relational SQLite DB (.db file)
    m_recordStorage.persistRecord("GENESIS", genesisDataId, "SYSTEM", "GOVERNANCE", genesisPayload, genesisDataHash);

    // On-chain Genesis block transaction reference
    COnChainTxRecord genesisTx{
        genesisTxId,
        "GENESIS",
        0,                          // txOrder
        "SYSTEM",                   // patientId
        "GOVERNANCE",               // doctorId
        genesisDataId,              // dataId in DB
        "RELATIONAL_SQLITE",        // dbType
        genesisDataHash,            // dataHash
        std::time(nullptr),
        "NETWORK_AUTHORITY",        // signerType
        "",                         // senderPublicKey
        "ROOT_GENESIS_SIG_CH" + std::to_string(m_channelId),
        "",                         // coSignerId
        "",                         // coSignerPublicKey
        ""                          // coSignature
    };

    CBlock genesisBlock(0, std::string(64, '0'), { genesisTx }, genesisConsensus);

    auto validRes = m_rules.validateGenesisBlock(genesisBlock);
    if (!validRes) {
        throw std::runtime_error("Genesis validation failed: " + validRes.toString());
    }

    if (!m_store->appendBlock(genesisBlock)) {
        throw std::runtime_error("Failed to write Genesis block to disk");
    }

    // Build and save Genesis Merkle tree (RAM LRU Cache + Disk)
    CMerkle::CMerkleTree genesisTree({ genesisTx.calculateHash() });
    m_merkleStore.saveTree(0, genesisTree);

    m_latestBlock = genesisBlock;
    m_latestHeader = genesisBlock.getHeader();
    m_chainHeight = 0;

    m_blockCache.put(0, genesisBlock);
    m_headerCache.put(0, m_latestHeader);
}

// ---------------------------------------------------------
// Transaction Pool (Mempool)
// ---------------------------------------------------------
ValidationResult CChain::addTransaction(const CTransaction& tx) {
    std::lock_guard<std::recursive_mutex> lock(m_chainMutex);

    // LAW 1: SCHEMA VALIDATION - Every transaction must adhere to its registered schema
    auto res = m_rules.validateTransaction(tx);
    if (!res) {
        std::cerr << "[Mempool Error] Rejected tx: " << res.toString() << "\n";
        return res;
    }

    m_pendingTransactions.push_back(tx);
    std::cout << "[Mempool] Accepted: " << tx.toString() << "\n";
    return ValidationResult::success();
}

std::vector<CTransaction> CChain::getPendingTransactions() const {
    std::lock_guard<std::recursive_mutex> lock(m_chainMutex);
    return m_pendingTransactions;
}

void CChain::clearPendingTransactions() {
    std::lock_guard<std::recursive_mutex> lock(m_chainMutex);
    m_pendingTransactions.clear();
}

// ---------------------------------------------------------
// PBFT Block Lifecycle
// ---------------------------------------------------------
CBlock CChain::proposeBlock(const std::string& proposerId) {
    std::lock_guard<std::recursive_mutex> lock(m_chainMutex);

    uint64_t nextHeight = m_chainHeight + 1;
    std::string prevHash = m_latestHeader.blockHash;

    std::vector<COnChainTxRecord> onChainRecords;
    onChainRecords.reserve(m_pendingTransactions.size());

    for (size_t i = 0; i < m_pendingTransactions.size(); ++i) {
        const auto& tx = m_pendingTransactions[i];

        std::string patientId = tx.getField("patient_id", "ANONYMOUS_PATIENT");
        std::string doctorId = tx.getField("doctor_id", tx.senderId);
        std::string dataId = tx.hasField("target_data_id") ? tx.getField("target_data_id") :
                             (tx.hasField("data_id") ? tx.getField("data_id") :
                             (tx.schemaType == "REGISTER_DOCTOR" && tx.hasField("doctor_id") ? tx.getField("doctor_id") :
                             (tx.schemaType == "REGISTER_PATIENT" && tx.hasField("patient_id") ? tx.getField("patient_id") : ("REC-" + tx.txId.substr(0, 16)))));

        auto schemaOpt = m_schemaRegistry.getSchema(tx.schemaType);
        CRecordStorage::DatabaseType dbType = schemaOpt ? schemaOpt->storageType : CRecordStorage::DatabaseType::RELATIONAL_SQLITE;
        std::string dbTypeStr = CRecordStorage::to_string(dbType);

        std::string dataHash = CRecordStorage::CRecordStorageManager::calculateDataHash(tx.fields);

        COnChainTxRecord rec{
            tx.txId,
            tx.schemaType,
            static_cast<uint32_t>(i),
            patientId,
            doctorId,
            dataId,
            dbTypeStr,
            dataHash,
            tx.timestamp,
            CSchemaDef::signerTypeToString(tx.signerType),
            tx.senderPublicKey,
            tx.signature,
            tx.coSignerId,
            tx.coSignerPublicKey,
            tx.coSignature
        };

        // Stage full clinical payload until block validation & commit
        m_stagedPayloads[dataId] = StagedPayload{
            tx.schemaType,
            patientId,
            doctorId,
            tx.fields,
            dataHash
        };

        onChainRecords.push_back(std::move(rec));
    }

    // Build block with on-chain reference records
    CBlock proposed(nextHeight, prevHash, onChainRecords);

    // Generate PBFT commit certificate from quorum
    ConsensusMetadata meta = m_pbft.createCommitProof(nextHeight, proposed.getBlockHash());
    proposed.setConsensusMetadata(meta);

    return proposed;
}

ValidationResult CChain::commitBlock(const CBlock& newBlock) {
    std::lock_guard<std::recursive_mutex> lock(m_chainMutex);

    // 1. Evaluate all 7 consensus laws (Law 1 Schema/Storage, Law 2 Size, Law 3 Link, Law 4 Integrity, etc.)
    auto valRes = m_rules.validateBlock(newBlock, m_latestBlock, std::time(nullptr));
    if (!valRes) {
        std::cerr << "[Consensus Rejection] Block #" << newBlock.getHeight()
                  << " failed validation: " << valRes.toString() << "\n";
        return valRes;
    }

    // 2. DISPATCH REAL CLINICAL DATA TO DESIGNATED DATABASES (SQLite or CouchDB)
    // After the block is validated, all real transaction data is sent to their respective databases.
    // The DB saves block_height and tx_order (transaction index) to enable Merkle sibling proof retrieval!
    // Note: Past blocks are NEVER modified on EDIT or DELETE. The event is anchored in this new block,
    // and off-chain DB records state transition (updates/soft-delete).
    for (const auto& rec : newBlock.getTransactions()) {
        auto it = m_stagedPayloads.find(rec.dataId);
        if (it != m_stagedPayloads.end()) {
            auto payload = it->second;
            payload.fields["block_height"] = std::to_string(newBlock.getHeight());
            payload.fields["tx_order"] = std::to_string(rec.txOrder);
            payload.fields["tx_id"] = rec.txId;

            auto schemaOpt = m_schemaRegistry.getSchema(rec.schemaType);
            bool isDelete = (schemaOpt && schemaOpt->operation == CSchemaDef::SchemaOperation::DELETE) ||
                            (rec.schemaType.find("DELETE") != std::string::npos);

            if (isDelete) {
                std::string targetSchema = "CREATE_EHR_RECORD";
                if (rec.schemaType == "DELETE_PRESCRIPTION") targetSchema = "CREATE_PRESCRIPTION";
                else if (rec.schemaType == "DELETE_DOCTOR_REGISTRATION") targetSchema = "REGISTER_DOCTOR";
                else if (rec.schemaType == "DELETE_PATIENT_REGISTRATION") targetSchema = "REGISTER_PATIENT";
                std::string reason = payload.fields.count("deletion_reason") ? payload.fields["deletion_reason"] : "Administrative deletion";
                m_recordStorage.markDeleted(targetSchema, rec.dataId, newBlock.getHeight(), rec.txOrder, reason, rec.doctorId);
            } else {
                bool isEdit = (schemaOpt && schemaOpt->operation == CSchemaDef::SchemaOperation::EDIT) ||
                              (rec.schemaType.find("EDIT") != std::string::npos);
                std::string targetSchema = payload.schemaName;
                if (isEdit) {
                    if (rec.schemaType == "EDIT_EHR_RECORD") targetSchema = "CREATE_EHR_RECORD";
                    else if (rec.schemaType == "EDIT_PRESCRIPTION") targetSchema = "CREATE_PRESCRIPTION";
                    else if (rec.schemaType == "EDIT_DOCTOR_REGISTRATION") targetSchema = "REGISTER_DOCTOR";
                    else if (rec.schemaType == "EDIT_PATIENT_REGISTRATION") targetSchema = "REGISTER_PATIENT";
                    payload.fields["last_modified_block"] = std::to_string(newBlock.getHeight());
                    payload.fields["last_modified_tx_order"] = std::to_string(rec.txOrder);
                    payload.fields["operation"] = "EDIT";
                }
                bool ok = m_recordStorage.persistRecord(
                    targetSchema,
                    rec.dataId,
                    payload.patientId,
                    payload.doctorId,
                    payload.fields,
                    payload.dataHash
                );
                if (!ok) {
                    std::cerr << "[Storage Warning] Failed to persist transaction record to " << rec.dbType
                              << " for data ID: " << rec.dataId << "\n";
                }
            }
        }
    }

    // 3. Persist on-chain block to disk (block + isolated header + index with physical FlushFileBuffers/fsync)
    if (!m_store->appendBlock(newBlock)) {
        return ValidationResult::failure("STORAGE", "Failed to write block to physical disk");
    }

    // 3b. Build and save block Merkle tree into 2GB RAM LRU cache + persistent disk
    std::vector<std::string> leafHashes;
    leafHashes.reserve(newBlock.getTransactions().size());
    for (const auto& tx : newBlock.getTransactions()) {
        leafHashes.push_back(tx.calculateHash());
    }
    CMerkle::CMerkleTree blockTree(leafHashes);
    m_merkleStore.saveTree(newBlock.getHeight(), blockTree);

    // 4. Update in-memory tip and LRU caches
    m_latestBlock = newBlock;
    m_latestHeader = newBlock.getHeader();
    m_chainHeight = newBlock.getHeight();

    // Cache the new frames
    m_blockCache.put(m_chainHeight, m_latestBlock);
    m_headerCache.put(m_chainHeight, m_latestHeader);

    // Clear mempool and staged payloads
    m_pendingTransactions.clear();
    m_stagedPayloads.clear();

    std::cout << "[Ledger] Block #" << newBlock.getHeight()
              << " COMMITTED to disk! (Hash: " << newBlock.getBlockHash().substr(0, 16)
              << "... | On-chain TXs: " << newBlock.getTransactionCount()
              << " | Size: " << newBlock.getEstimatedSizeBytes() << " B)\n";

    return ValidationResult::success();
}

// ---------------------------------------------------------
// Cache & Disk Queries
// ---------------------------------------------------------
std::optional<CBlock> CChain::getBlockByHeight(uint64_t height) {
    std::lock_guard<std::recursive_mutex> lock(m_chainMutex);

    // 1. Check LRU Cache
    auto cached = m_blockCache.get(height);
    if (cached) {
        return cached;
    }

    // 2. Cache miss -> Read from disk
    auto fromDisk = m_store->readBlock(height);
    if (fromDisk) {
        m_blockCache.put(height, *fromDisk); // Cache the frame (evicts LRU if full)
        return fromDisk;
    }

    return std::nullopt;
}

std::optional<BlockHeader> CChain::getHeaderByHeight(uint64_t height) {
    std::lock_guard<std::recursive_mutex> lock(m_chainMutex);

    // 1. Check LRU Header Cache
    auto cached = m_headerCache.get(height);
    if (cached) {
        return cached;
    }

    // 2. Cache miss -> Read from headers.dat on disk (without reading block body!)
    auto fromDisk = m_store->readHeader(height);
    if (fromDisk) {
        m_headerCache.put(height, *fromDisk);
        return fromDisk;
    }

    return std::nullopt;
}

std::optional<CBlock> CChain::getBlockByHash(const std::string& hash) {
    std::lock_guard<std::recursive_mutex> lock(m_chainMutex);
    auto fromDisk = m_store->readBlockByHash(hash);
    if (fromDisk) {
        m_blockCache.put(fromDisk->getHeight(), *fromDisk);
        return fromDisk;
    }
    return std::nullopt;
}

CBlock CChain::getLatestBlock() const {
    std::lock_guard<std::recursive_mutex> lock(m_chainMutex);
    return m_latestBlock;
}

BlockHeader CChain::getLatestHeader() const {
    std::lock_guard<std::recursive_mutex> lock(m_chainMutex);
    return m_latestHeader;
}

uint64_t CChain::getChainHeight() const {
    std::lock_guard<std::recursive_mutex> lock(m_chainMutex);
    return m_chainHeight;
}

size_t CChain::getTotalBlocks() const {
    std::lock_guard<std::recursive_mutex> lock(m_chainMutex);
    return static_cast<size_t>(m_chainHeight + 1);
}

// ---------------------------------------------------------
// Off-Chain Database Retrieval & Verification
// ---------------------------------------------------------
std::optional<FullMedicalRecord> CChain::retrieveFullRecord(uint64_t height, uint32_t txOrder) {
    std::lock_guard<std::recursive_mutex> lock(m_chainMutex);

    // 1. Retrieve block saved in the chain (from memory LRU frame or disk)
    auto blkOpt = getBlockByHeight(height);
    if (!blkOpt) return std::nullopt;

    const auto& txs = blkOpt->getTransactions();
    if (txOrder >= txs.size()) return std::nullopt;

    const auto& onChainRec = txs[txOrder];

    // 2. Fetch the off-chain real data from SQLite (.db) or CouchDB (JSON)
    auto dataOpt = m_recordStorage.retrieveRecord(onChainRec.schemaType, onChainRec.dataId);
    if (!dataOpt) {
        return FullMedicalRecord{onChainRec, {}, false};
    }

    // 3. Cryptographic tamper verification: compare DB stored hash with on-chain committed dataHash
    bool verified = false;
    auto itHash = dataOpt->find("data_hash");
    if (itHash != dataOpt->end() && itHash->second == onChainRec.dataHash) {
        verified = true;
    }

    return FullMedicalRecord{onChainRec, std::move(*dataOpt), verified};
}

std::vector<FullMedicalRecord> CChain::retrieveBlockRecords(uint64_t height) {
    std::lock_guard<std::recursive_mutex> lock(m_chainMutex);

    std::vector<FullMedicalRecord> records;
    auto blkOpt = getBlockByHeight(height);
    if (!blkOpt) return records;

    for (const auto& rec : blkOpt->getTransactions()) {
        auto dataOpt = m_recordStorage.retrieveRecord(rec.schemaType, rec.dataId);
        if (dataOpt) {
            bool verified = false;
            auto itHash = dataOpt->find("data_hash");
            if (itHash != dataOpt->end() && itHash->second == rec.dataHash) {
                verified = true;
            }
            records.push_back({rec, std::move(*dataOpt), verified});
        } else {
            records.push_back({rec, {}, false});
        }
    }
    return records;
}

std::vector<std::string> CChain::searchTransactions(const std::string& keyword) {
    std::lock_guard<std::recursive_mutex> lock(m_chainMutex);
    std::vector<std::string> results;

    uint64_t total = m_chainHeight + 1;
    for (uint64_t h = 0; h < total; ++h) {
        // Read block (via cache or disk)
        auto cached = m_blockCache.get(h);
        CBlock blk = cached ? *cached : *m_store->readBlock(h);

        for (const auto& tx : blk.getTransactions()) {
            std::string txStr = tx.toString();
            if (txStr.find(keyword) != std::string::npos ||
                tx.patientId.find(keyword) != std::string::npos ||
                tx.doctorId.find(keyword) != std::string::npos ||
                tx.dataId.find(keyword) != std::string::npos) {
                results.push_back("[Block #" + std::to_string(h) + "] " + txStr);
            }
        }
    }
    return results;
}

bool CChain::isChainValid() {
    std::lock_guard<std::recursive_mutex> lock(m_chainMutex);
    uint64_t total = m_chainHeight + 1;
    if (total == 0) return false;

    auto optPrev = m_store->readBlock(0);
    if (!optPrev || !m_rules.validateGenesisBlock(*optPrev)) return false;

    for (uint64_t h = 1; h < total; ++h) {
        auto optCur = m_store->readBlock(h);
        if (!optCur) return false;

        auto res = m_rules.validateBlock(*optCur, *optPrev);
        if (!res) {
            std::cerr << "[Validation Failure] Block #" << h << ": " << res.toString() << "\n";
            return false;
        }
        optPrev = optCur;
    }
    return true;
}

void CChain::printChainSummary() {
    std::lock_guard<std::recursive_mutex> lock(m_chainMutex);
    auto bStats = m_blockCache.stats();
    auto hStats = m_headerCache.stats();

    std::cout << "\n============================================================\n";
    std::cout << "           HEALTHCARE BLOCKCHAIN SUMMARY & MEMORY           \n";
    std::cout << "============================================================\n";
    std::cout << " Total Committed Blocks:    " << (m_chainHeight + 1) << "\n";
    std::cout << " Current Chain Tip Height:  " << m_chainHeight << "\n";
    std::cout << " Pending Mempool Count:     " << m_pendingTransactions.size() << "\n";
    std::cout << " Chain Cryptographic State: " << (isChainValid() ? "SECURE (SHA-256 Validated)" : "COMPROMISED") << "\n";
    std::cout << " Latest Block Hash:         " << m_latestHeader.blockHash << "\n";
    std::cout << "------------------------------------------------------------\n";
    std::cout << " [BLOCK LRU CACHE (Limit: 4 GB / 32 KB frame)]\n";
    std::cout << "   - Cache Frames in RAM:   " << bStats.size << " / " << bStats.capacity << "\n";
    std::cout << "   - Cache Hits:            " << bStats.hits << " | Misses: " << bStats.misses << "\n";
    std::cout << "   - Evictions to Disk:     " << bStats.evictions << "\n";
    std::cout << " [HEADER LRU CACHE (Limit: 2 GB / 160 B frame)]\n";
    std::cout << "   - Header Frames in RAM:  " << hStats.size << " / " << hStats.capacity << "\n";
    std::cout << "   - Cache Hits:            " << hStats.hits << " | Misses: " << hStats.misses << "\n";
    std::cout << " [SCHEMA REGISTRY (Limit: 1 GB)]\n";
    std::cout << "   - Active Schemas:        " << m_schemaRegistry.getSchemaCount() << "\n";
    std::cout << "   - Schema Memory Used:    " << m_schemaRegistry.getMemoryUsedBytes() << " bytes\n";
    std::cout << "============================================================\n\n";
}
