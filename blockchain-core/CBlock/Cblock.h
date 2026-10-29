#pragma once

#include <string>
#include <vector>
#include <cstdint>
#include <ctime>
#include "CTransaction/COnChainTxRecord.h"

// ========================================================
// 7. Consensus Metadata (PBFT Protocol)
// ========================================================
struct ConsensusMetadata {
    uint64_t viewNumber{0};             // PBFT view number
    uint64_t sequenceNumber{0};         // PBFT assigned sequence number
    std::string proposerId;             // Leader/Primary replica ID (e.g. "node-01")
    std::string commitCertificate;      // Commit certificate / 2f+1 signatures proof
};

// ========================================================
// A. Block Header
// ========================================================
struct BlockHeader {
    uint32_t version{1};                // 1. Block version
    uint64_t height{0};                 // 2. Block height (Genesis = 0)
    std::string prevBlockHash;          // 3. Previous block SHA-256 hash
    std::string merkleRoot;             // 4. Merkle root of transactions
    int64_t timestamp{0};               // 5. Proposed/assigned Unix timestamp
    std::string blockHash;              // 6. Canonical header SHA-256 hash
    ConsensusMetadata consensus;        // 7. Consensus metadata (PBFT)

    std::vector<uint8_t> serialize() const;
    static BlockHeader deserialize(const uint8_t* data, size_t size);
};

// ========================================================
// Block (Header + On-Chain Reference Body)
// Sensitive medical data stays off-chain in SQLite / CouchDB.
// The block body only anchors patient ID, doctor ID, data ID,
// DB type, transaction order, cryptographic data hash, and consensus metadata.
// ========================================================
class CBlock {
private:
    BlockHeader m_header;                      // A. Block Header
    std::vector<COnChainTxRecord> m_txs;       // B.8 On-chain transaction records (Body)

public:
    // Constructors
    CBlock();
    CBlock(uint64_t height,
           const std::string& prevBlockHash,
           const std::vector<COnChainTxRecord>& transactions,
           const ConsensusMetadata& consensus = {0, 0, "primary-node", "VALID_COMMIT_CERT"},
           uint32_t version = 1);

    // Restore constructor for storage loader
    CBlock(const BlockHeader& header, std::vector<COnChainTxRecord> transactions);

    // Cryptographic calculation helpers (SHA-256)
    static std::string computeMerkleRoot(const std::vector<COnChainTxRecord>& txs);
    std::string calculateHeaderHash() const;
    void finalizeBlock();
    void addTransaction(const COnChainTxRecord& tx);

    // Getters - Header (1-7)
    const BlockHeader& getHeader() const { return m_header; }
    uint32_t getVersion() const { return m_header.version; }
    uint64_t getHeight() const { return m_header.height; }
    const std::string& getPrevBlockHash() const { return m_header.prevBlockHash; }
    const std::string& getMerkleRoot() const { return m_header.merkleRoot; }
    int64_t getTimestamp() const { return m_header.timestamp; }
    const std::string& getBlockHash() const { return m_header.blockHash; }
    const ConsensusMetadata& getConsensusMetadata() const { return m_header.consensus; }

    // Getters - Body (8-9)
    const std::vector<COnChainTxRecord>& getTransactions() const { return m_txs; }
    size_t getTransactionCount() const { return m_txs.size(); } // 9. Transaction count

    // Setters
    void setConsensusMetadata(const ConsensusMetadata& consensus);

    // Verification & Integrity
    bool verifyHeaderHash() const;
    bool verifyMerkleRoot() const;
    bool isValid() const;
    size_t getEstimatedSizeBytes() const;

    // Display
    void printBlock() const;
};
