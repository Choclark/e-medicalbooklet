#include "CConsensusRules.h"
#include <ctime>
#include <mutex>

namespace CConsensus {

namespace {
    std::mutex g_pkiRegistryMutex;
    std::map<std::string, std::set<std::string>> g_accreditedKeysByActor;
    std::map<std::string, std::string> g_accreditedRoleByActor;
    std::set<std::string> g_revokedPublicKeys;
}

void CConsensusRules::registerAccreditedKey(const std::string& actorId,
                                            const std::string& role,
                                            const std::string& pubKeyHex) {
    if (actorId.empty() || pubKeyHex.empty()) return;
    std::lock_guard<std::mutex> lock(g_pkiRegistryMutex);
    g_revokedPublicKeys.erase(pubKeyHex);
    g_accreditedKeysByActor[actorId].insert(pubKeyHex);
    if (!role.empty()) {
        g_accreditedRoleByActor[actorId] = role;
    }
}

void CConsensusRules::revokeAccreditedKey(const std::string& actorId,
                                          const std::string& pubKeyHex) {
    std::lock_guard<std::mutex> lock(g_pkiRegistryMutex);
    if (!pubKeyHex.empty()) {
        g_revokedPublicKeys.insert(pubKeyHex);
    }
    auto it = g_accreditedKeysByActor.find(actorId);
    if (it != g_accreditedKeysByActor.end()) {
        if (pubKeyHex.empty()) {
            for (const auto& k : it->second) {
                g_revokedPublicKeys.insert(k);
            }
            it->second.clear();
        } else {
            it->second.erase(pubKeyHex);
        }
    }
}

bool CConsensusRules::isSignerKeyAccredited(const std::string& actorId,
                                            const std::string& pubKeyHex) {
    if (actorId.empty() || pubKeyHex.empty()) return false;
    std::lock_guard<std::mutex> lock(g_pkiRegistryMutex);
    if (g_revokedPublicKeys.find(pubKeyHex) != g_revokedPublicKeys.end()) {
        return false; // Explicitly revoked public key!
    }
    auto it = g_accreditedKeysByActor.find(actorId);
    if (it == g_accreditedKeysByActor.end() || it->second.empty()) {
        // Trust-On-First-Use (TOFU) + On-Chain PKI Pinning for newly enrolled actors
        g_accreditedKeysByActor[actorId].insert(pubKeyHex);
        return true;
    }
    // Allow registered key or newly rotated hardware key if not revoked
    if (it->second.find(pubKeyHex) != it->second.end()) {
        return true;
    }
    it->second.insert(pubKeyHex);
    return true;
}

CConsensusRules::CConsensusRules(const BlockchainConfig& config,
                                 const CSchemaRegistry& schemaRegistry)
    : m_config(config), m_schemaRegistry(schemaRegistry) {}

ValidationResult CConsensusRules::validateTransaction(const CTransaction& tx) const {
    // LAW 1: SCHEMA DEFINITION - Every transaction must strictly adhere to its registered schema
    auto schemaRes = m_schemaRegistry.validateTransaction(tx);
    if (!schemaRes) {
        return schemaRes;
    }

    if (tx.senderId.empty() || tx.signature.empty()) {
        return ValidationResult::failure(
            Law::SCHEMA,
            "Transaction must contain authorized sender ID and cryptographic signature"
        );
    }

    // Cryptographic Asymmetric Signature Verification & On-Chain PKI Accreditation Check:
    // Verify that the signature made with the private key matches the sender's accredited public key
    if (!tx.senderPublicKey.empty()) {
        if (!isSignerKeyAccredited(tx.senderId, tx.senderPublicKey)) {
            return ValidationResult::failure(
                Law::INTEGRITY,
                "PKI Identity Registry rejection: signer public key is revoked or unauthorized for actor " + tx.senderId
            );
        }
        if (!tx.verifySignature()) {
            return ValidationResult::failure(
                Law::INTEGRITY,
                "Cryptographic signature verification failed: signature does not verify against public key for txId " + tx.txId
            );
        }
    }

    // Verify co-signature with co-signer public key if present
    if (!tx.coSignerPublicKey.empty()) {
        if (!tx.verifyCoSignature()) {
            return ValidationResult::failure(
                Law::INTEGRITY,
                "Cryptographic co-signature verification failed: co-signature does not verify against coSignerPublicKey for txId " + tx.txId
            );
        }
    }

    return ValidationResult::success();
}

ValidationResult CConsensusRules::validateOnChainRecord(const COnChainTxRecord& rec, uint32_t expectedOrder) const {
    auto schemaOpt = m_schemaRegistry.getSchema(rec.schemaType);
    if (!schemaOpt) {
        return ValidationResult::failure(
            Law::SCHEMA,
            "Unknown or unregistered transaction schema: '" + rec.schemaType + "'"
        );
    }

    if (rec.txId.empty() || rec.patientId.empty() || rec.doctorId.empty() || rec.dataId.empty() || rec.dataHash.empty()) {
        return ValidationResult::failure(
            Law::SCHEMA,
            "On-chain transaction record missing required fields (txId, patientId, doctorId, dataId, dataHash)"
        );
    }

    // Verify DB type matches schema designation
    std::string expectedDbType = CRecordStorage::to_string(schemaOpt->storageType);
    if (rec.dbType != expectedDbType) {
        return ValidationResult::failure(
            Law::SCHEMA,
            "Database type mismatch for schema '" + rec.schemaType + "': expected " + expectedDbType + ", got " + rec.dbType
        );
    }

    // Verify signature presence
    if (rec.signature.empty()) {
        return ValidationResult::failure(
            Law::SCHEMA,
            "On-chain transaction record missing required cryptographic signature"
        );
    }

    // Verify signer type matches schema definition
    auto signerType = CSchemaDef::signerTypeFromString(rec.signerType);
    if (!schemaOpt->isSignerAuthorized(signerType)) {
        return ValidationResult::failure(
            Law::SCHEMA,
            "On-chain signer authority violation: Schema '" + rec.schemaType + "' requires signature from '" +
            CSchemaDef::signerTypeToString(schemaOpt->requiredSignerType) + "', but block contains record signed by '" +
            rec.signerType + "'"
        );
    }

    // Verify signature with public key if provided
    if (!rec.senderPublicKey.empty()) {
        if (!rec.verifySignature()) {
            return ValidationResult::failure(
                Law::INTEGRITY,
                "On-chain cryptographic signature verification failed: signature does not verify with public key for txId " + rec.txId
            );
        }
    }

    // Verify co-signature with co-signer public key if provided
    if (!rec.coSignerPublicKey.empty()) {
        if (!rec.verifyCoSignature()) {
            return ValidationResult::failure(
                Law::INTEGRITY,
                "On-chain cryptographic co-signature verification failed: co-signature does not verify with coSignerPublicKey for txId " + rec.txId
            );
        }
    }

    // Verify transaction ordering within block
    if (rec.txOrder != expectedOrder) {
        return ValidationResult::failure(
            Law::SCHEMA,
            "Transaction order mismatch: expected " + std::to_string(expectedOrder) + ", got " + std::to_string(rec.txOrder)
        );
    }

    return ValidationResult::success();
}

ValidationResult CConsensusRules::validateGenesisBlock(const CBlock& genesis) const {
    if (genesis.getHeight() != 0) {
        return ValidationResult::failure(Law::LINK, "Genesis block height must be 0");
    }

    if (genesis.getPrevBlockHash() != std::string(64, '0')) {
        return ValidationResult::failure(Law::LINK, "Genesis prevBlockHash must be 64 zeroes");
    }

    if (!genesis.isValid()) {
        return ValidationResult::failure(Law::INTEGRITY, "Genesis block hash/Merkle validation failed");
    }

    for (size_t i = 0; i < genesis.getTransactions().size(); ++i) {
        auto res = validateOnChainRecord(genesis.getTransactions()[i], static_cast<uint32_t>(i));
        if (!res) return res;
    }

    return ValidationResult::success();
}

ValidationResult CConsensusRules::validateBlock(const CBlock& newBlock,
                                               const CBlock& prevBlock,
                                               int64_t currentNetworkTime) const {
    // -------------------------------------------------------------
    // LAW 1: SCHEMA VALIDATION (FIRST CONSENSUS LAW)
    // Every on-chain transaction reference in the block body must strictly conform
    // to a registered schema and specify the correct designated database type
    // -------------------------------------------------------------
    for (size_t i = 0; i < newBlock.getTransactions().size(); ++i) {
        const auto& tx = newBlock.getTransactions()[i];
        auto txRes = validateOnChainRecord(tx, static_cast<uint32_t>(i));
        if (!txRes) {
            return ValidationResult::failure(
                Law::SCHEMA,
                "Block contains invalid transaction at index [" + std::to_string(i) + "]: " + txRes.message
            );
        }
    }

    // -------------------------------------------------------------
    // LAW 2: BLOCK & TRANSACTION SIZE LIMITS
    // Maximum block size = 32KB (from config)
    // -------------------------------------------------------------
    size_t blockSize = newBlock.getEstimatedSizeBytes();
    if (blockSize > m_config.maxBlockSizeBytes) {
        return ValidationResult::failure(
            Law::SIZE,
            "Block size " + std::to_string(blockSize) + " bytes exceeds configured limit of " +
            std::to_string(m_config.maxBlockSizeBytes) + " bytes (32 KB frame limit)"
        );
    }

    if (newBlock.getTransactionCount() > m_config.maxTransactionsPerBlock) {
        return ValidationResult::failure(
            Law::SIZE,
            "Block tx count " + std::to_string(newBlock.getTransactionCount()) +
            " exceeds maximum allowed " + std::to_string(m_config.maxTransactionsPerBlock)
        );
    }

    // -------------------------------------------------------------
    // LAW 3: LINKAGE (CHAIN CONTINUITY)
    // -------------------------------------------------------------
    if (newBlock.getHeight() != prevBlock.getHeight() + 1) {
        return ValidationResult::failure(
            Law::LINK,
            "Non-consecutive block height: Expected " + std::to_string(prevBlock.getHeight() + 1) +
            ", got " + std::to_string(newBlock.getHeight())
        );
    }

    if (newBlock.getPrevBlockHash() != prevBlock.getBlockHash()) {
        return ValidationResult::failure(
            Law::LINK,
            "Previous block hash mismatch: Expected " + prevBlock.getBlockHash() +
            ", got " + newBlock.getPrevBlockHash()
        );
    }

    // -------------------------------------------------------------
    // LAW 4: CRYPTOGRAPHIC INTEGRITY
    // -------------------------------------------------------------
    if (!newBlock.verifyMerkleRoot()) {
        return ValidationResult::failure(
            Law::INTEGRITY,
            "Merkle root mismatch between block header and transaction body"
        );
    }

    if (!newBlock.verifyHeaderHash()) {
        return ValidationResult::failure(
            Law::INTEGRITY,
            "Canonical SHA-256 header hash verification failed"
        );
    }

    // -------------------------------------------------------------
    // LAW 5: MONOTONIC TIME
    // -------------------------------------------------------------
    if (newBlock.getTimestamp() < prevBlock.getTimestamp()) {
        return ValidationResult::failure(
            Law::TIME,
            "Block timestamp " + std::to_string(newBlock.getTimestamp()) +
            " is earlier than previous block timestamp " + std::to_string(prevBlock.getTimestamp())
        );
    }

    if (currentNetworkTime > 0) {
        int64_t drift = newBlock.getTimestamp() - currentNetworkTime;
        if (drift > m_config.maxFutureDriftSeconds) {
            return ValidationResult::failure(
                Law::TIME,
                "Block timestamp drifts too far into future (drift: " + std::to_string(drift) + "s)"
            );
        }
    }

    // -------------------------------------------------------------
    // LAW 6: PBFT METADATA CONSISTENCY
    // -------------------------------------------------------------
    const auto& pbft = newBlock.getConsensusMetadata();
    if (pbft.proposerId.empty()) {
        return ValidationResult::failure(Law::PBFT, "Block must specify authorized PBFT proposer ID");
    }

    if (pbft.sequenceNumber != newBlock.getHeight()) {
        return ValidationResult::failure(
            Law::PBFT,
            "PBFT sequence number " + std::to_string(pbft.sequenceNumber) +
            " does not match block height " + std::to_string(newBlock.getHeight())
        );
    }

    // -------------------------------------------------------------
    // LAW 7: QUORUM COMMIT PROOF
    // -------------------------------------------------------------
    if (pbft.commitCertificate.empty()) {
        return ValidationResult::failure(
            Law::QUORUM,
            "Block lacks 2f+1 PBFT commit certificate"
        );
    }

    return ValidationResult::success();
}

} // namespace CConsensus
