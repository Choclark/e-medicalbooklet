#include "Cblock.h"
#include "CCrypto/Sha256.h"
#include "CCommon/Serializer.h"
#include <iostream>
#include <sstream>
#include <iomanip>

// ========================================================
// BlockHeader Serialization
// ========================================================
std::vector<uint8_t> BlockHeader::serialize() const {
    ByteWriter w;
    w.reserve(160);
    w.writeU32(version);
    w.writeU64(height);
    w.writeString(prevBlockHash);
    w.writeString(merkleRoot);
    w.writeI64(timestamp);
    w.writeString(blockHash);
    w.writeU64(consensus.viewNumber);
    w.writeU64(consensus.sequenceNumber);
    w.writeString(consensus.proposerId);
    w.writeString(consensus.commitCertificate);
    return std::move(w.data());
}

BlockHeader BlockHeader::deserialize(const uint8_t* data, size_t size) {
    ByteReader r(data, size);
    BlockHeader h;
    h.version = r.readU32();
    h.height = r.readU64();
    h.prevBlockHash = r.readString();
    h.merkleRoot = r.readString();
    h.timestamp = r.readI64();
    h.blockHash = r.readString();
    h.consensus.viewNumber = r.readU64();
    h.consensus.sequenceNumber = r.readU64();
    h.consensus.proposerId = r.readString();
    h.consensus.commitCertificate = r.readString();
    return h;
}

// ========================================================
// CBlock Constructors
// ========================================================
CBlock::CBlock() {
    m_header.version = 1;
    m_header.height = 0;
    m_header.prevBlockHash = std::string(64, '0');
    m_header.timestamp = std::time(nullptr);
    finalizeBlock();
}

CBlock::CBlock(uint64_t height,
               const std::string& prevBlockHash,
               const std::vector<COnChainTxRecord>& transactions,
               const ConsensusMetadata& consensus,
               uint32_t version)
    : m_txs(transactions) {
    m_header.version = version;
    m_header.height = height;
    m_header.prevBlockHash = prevBlockHash.empty() ? std::string(64, '0') : prevBlockHash;
    m_header.timestamp = std::time(nullptr);
    m_header.consensus = consensus;

    finalizeBlock();
}

CBlock::CBlock(const BlockHeader& header, std::vector<COnChainTxRecord> transactions)
    : m_header(header), m_txs(std::move(transactions)) {}

// 4. Compute Merkle Root using pairwise SHA-256 tree over transaction record hashes
std::string CBlock::computeMerkleRoot(const std::vector<COnChainTxRecord>& txs) {
    if (txs.empty()) {
        return CCrypto::Sha256::hashHex("EMPTY_TX_POOL");
    }

    std::vector<std::string> currentLevel;
    currentLevel.reserve(txs.size());
    for (const auto& tx : txs) {
        currentLevel.push_back(tx.calculateHash());
    }

    while (currentLevel.size() > 1) {
        if (currentLevel.size() % 2 != 0) {
            currentLevel.push_back(currentLevel.back()); // Duplicate last if odd
        }

        std::vector<std::string> nextLevel;
        nextLevel.reserve(currentLevel.size() / 2);

        for (size_t i = 0; i < currentLevel.size(); i += 2) {
            std::string combined = currentLevel[i] + currentLevel[i + 1];
            nextLevel.push_back(CCrypto::Sha256::hashHex(combined));
        }

        currentLevel = std::move(nextLevel);
    }

    return currentLevel[0];
}

// 6. Canonical Header Hash using SHA-256
std::string CBlock::calculateHeaderHash() const {
    std::stringstream ss;
    ss << m_header.version << "|"
       << m_header.height << "|"
       << m_header.prevBlockHash << "|"
       << m_header.merkleRoot << "|"
       << m_header.timestamp << "|"
       << m_header.consensus.viewNumber << "|"
       << m_header.consensus.sequenceNumber << "|"
       << m_header.consensus.proposerId << "|"
       << m_header.consensus.commitCertificate;

    return CCrypto::Sha256::hashHex(ss.str());
}

void CBlock::finalizeBlock() {
    m_header.merkleRoot = computeMerkleRoot(m_txs);
    m_header.blockHash = calculateHeaderHash();
}

void CBlock::addTransaction(const COnChainTxRecord& tx) {
    m_txs.push_back(tx);
    finalizeBlock();
}

void CBlock::setConsensusMetadata(const ConsensusMetadata& consensus) {
    m_header.consensus = consensus;
    m_header.blockHash = calculateHeaderHash();
}

bool CBlock::verifyHeaderHash() const {
    return m_header.blockHash == calculateHeaderHash();
}

bool CBlock::verifyMerkleRoot() const {
    return m_header.merkleRoot == computeMerkleRoot(m_txs);
}

bool CBlock::isValid() const {
    return verifyHeaderHash() && verifyMerkleRoot();
}

size_t CBlock::getEstimatedSizeBytes() const {
    size_t sz = sizeof(BlockHeader) + m_header.prevBlockHash.capacity() + m_header.merkleRoot.capacity() +
                m_header.blockHash.capacity() + m_header.consensus.proposerId.capacity() +
                m_header.consensus.commitCertificate.capacity();
    for (const auto& tx : m_txs) {
        sz += sizeof(COnChainTxRecord) + tx.txId.capacity() + tx.schemaType.capacity() +
              tx.patientId.capacity() + tx.doctorId.capacity() + tx.dataId.capacity() +
              tx.dbType.capacity() + tx.dataHash.capacity() + tx.signature.capacity();
    }
    return sz;
}

void CBlock::printBlock() const {
    std::cout << "============================================================\n";
    std::cout << " [A. BLOCK HEADER]\n";
    std::cout << "  1. Version:           " << m_header.version << "\n";
    std::cout << "  2. Height:            " << m_header.height << (m_header.height == 0 ? " (Genesis Block)" : "") << "\n";
    std::cout << "  3. Prev Block Hash:   " << m_header.prevBlockHash << "\n";
    std::cout << "  4. Merkle Root:       " << m_header.merkleRoot << "\n";
    std::cout << "  5. Timestamp:         " << m_header.timestamp << "\n";
    std::cout << "  6. Block Hash:        " << m_header.blockHash << "\n";
    std::cout << "  7. Consensus Metadata (PBFT):\n";
    std::cout << "       - View Number:   " << m_header.consensus.viewNumber << "\n";
    std::cout << "       - Sequence No:   " << m_header.consensus.sequenceNumber << "\n";
    std::cout << "       - Proposer ID:   " << m_header.consensus.proposerId << "\n";
    std::cout << "       - Certificate:   " << m_header.consensus.commitCertificate << "\n";
    std::cout << "------------------------------------------------------------\n";
    std::cout << " [B. BLOCK BODY]\n";
    std::cout << "  8. Transaction Count: " << getTransactionCount() << "\n";
    std::cout << "  9. Transactions:\n";
    for (size_t i = 0; i < m_txs.size(); ++i) {
        std::cout << "       [" << i << "] " << m_txs[i].toString() << "\n";
    }
    std::cout << "  Estimated Size:       " << getEstimatedSizeBytes() << " bytes\n";
    std::cout << "  Validation Status:    " << (isValid() ? "VALID (SHA-256 Canonical & Merkle Verified)" : "INVALID") << "\n";
    std::cout << "============================================================\n\n";
}
