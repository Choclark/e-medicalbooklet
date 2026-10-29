#pragma once

#include <string>
#include <vector>
#include <map>
#include <memory>
#include <optional>
#include "CChain/Cchain.h"
#include "CTransaction/CTransaction.h"
#include "CTransaction/CSchema.h"
#include "CMerkle/CMerkleTree.h"
#include "CCrypto/CryptoSigner.h"
#include "../../ksm-core/CDkg/KsmCluster.h"
#include "../../ksm-core/CSchemaSplit/SchemaSplitter.h"

namespace CChannel {
class CChannelManager;
}

namespace CCrud {

// Query execution status
enum class QueryStatus {
    SUCCESS,
    FILTERED_DELETED,       // Record was soft-deleted in off-chain DB, filtered out from display
    MERKLE_PROOF_FAILED,    // Merkle tree verification against block header failed
    TAMPER_DETECTED,        // Data hash in DB does not match on-chain committed record
    RECORD_NOT_FOUND,       // Record ID not found in database
    KMS_DECRYPTION_FAILED,  // Threshold DEK reconstruction failed
    UNAUTHORIZED            // Signer mismatch or missing permission
};

inline std::string queryStatusToString(QueryStatus status) {
    switch (status) {
        case QueryStatus::SUCCESS: return "SUCCESS";
        case QueryStatus::FILTERED_DELETED: return "FILTERED_DELETED";
        case QueryStatus::MERKLE_PROOF_FAILED: return "MERKLE_PROOF_FAILED";
        case QueryStatus::TAMPER_DETECTED: return "TAMPER_DETECTED";
        case QueryStatus::RECORD_NOT_FOUND: return "RECORD_NOT_FOUND";
        case QueryStatus::KMS_DECRYPTION_FAILED: return "KMS_DECRYPTION_FAILED";
        case QueryStatus::UNAUTHORIZED: return "UNAUTHORIZED";
        default: return "UNKNOWN";
    }
}

// -------------------------------------------------------------
// Request and Response Structures
// -------------------------------------------------------------
struct CreateRecordRequest {
    std::string schemaName{"CREATE_EHR_RECORD"};
    std::string patientId;
    std::string doctorId;
    std::map<std::string, std::string> clinicalFields; // Sensitive fields: diagnosis, treatment, notes
    CCrypto::KeyPair doctorKeyPair;
    CCrypto::KeyPair patientKeyPair;
};

struct EditRecordRequest {
    std::string targetDataId;
    std::string editReason;
    std::map<std::string, std::string> updatedClinicalFields;
    std::string patientId; // Optional patient identifier
    CCrypto::KeyPair doctorKeyPair;
    CCrypto::KeyPair patientKeyPair;
};

struct DeleteRecordRequest {
    std::string targetDataId;
    std::string deletionReason;
    std::string patientId; // Optional patient identifier
    CCrypto::KeyPair doctorKeyPair;
    CCrypto::KeyPair patientKeyPair;
};

struct QueryRecordRequest {
    std::string targetDataId;
    std::string requesterId;
    std::string requesterRole{"DOCTOR"};
    std::string purpose{"CLINICAL_QUERY"};
    std::vector<std::string> hospitalQuorum; // Participating hospital nodes for threshold DEK recovery
    bool includeDeleted{false};              // If false, deleted records are filtered at display
};

struct QueryRecordResponse {
    QueryStatus status{QueryStatus::RECORD_NOT_FOUND};
    std::string statusMessage;
    std::string dataId;
    uint64_t blockHeight{0};
    uint32_t txOrder{0};
    std::string txId;
    bool isDeleted{false};
    std::string deletionReason;
    uint64_t deletionBlock{0};
    CMerkle::MerkleProof merkleProof;
    std::string expectedMerkleRoot;
    bool merkleProofVerified{false};
    std::map<std::string, std::string> decryptedClinicalData;
    uint32_t version{1};
};

// -------------------------------------------------------------
// CrudManager: High-level coordinator enforcing CRUD schema laws,
// co-signer consistency, Merkle inclusion verification, and KMS threshold decryption.
// -------------------------------------------------------------
class CrudManager {
public:
    CrudManager(CChain& chain, CKsm::KsmCluster& ksmCluster);

    // 1. CREATE:
    // - Splits metadata and clinical body.
    // - Generates ephemeral 256-bit DEK via DKG, splits into 3-of-4 hospital shares.
    // - Encrypts clinical body with AES-256-GCM.
    // - Constructs transaction co-signed by Doctor AND Patient.
    // - Appends new block to blockchain.
    // - DB stores record with block_height and tx_order.
    // - Merkle tree stored in 2GB RAM LRU cache + disk.
    std::string createRecord(const CreateRecordRequest& req, std::string& outTxId, std::string& outError);

    // 2. EDIT:
    // - Validates that the original creators (Doctor + Patient) are the exact signers.
    // - Past block containing the original data is NOT modified (immutable).
    // - Edit transaction is recorded in a NEW block.
    // - Encrypts updated body with new threshold DEK.
    // - In DB: record is updated with new ciphertext, new block_height, new tx_order, version incremented.
    bool editRecord(const EditRecordRequest& req, std::string& outTxId, std::string& outError);

    // 3. DELETE:
    // - Validates that the original creators (Doctor + Patient) are the exact signers.
    // - Past blocks containing previous data are NOT modified.
    // - Pre-defined deletion info: target_block_height, target_data_id, target_tx_id, deletion_reason.
    // - Soft-deleted in off-chain DB (is_deleted = 1).
    // - Deletion transaction recorded in a NEW block.
    // - Filtered at display time to show up-to-date active state.
    bool deleteRecord(const DeleteRecordRequest& req, std::string& outTxId, std::string& outError);

    // 4. QUERY (SEARCH):
    // - Data is first fetched from the off-chain DB (retrieves block_height, tx_order, ciphertext).
    // - Display filtering: if is_deleted == 1 and !includeDeleted, immediately returns FILTERED_DELETED.
    // - Retrieves the block's Merkle tree from CMerkleStore (2GB RAM limit or disk).
    // - Generates Merkle proof for tx_order (sibling hashes path).
    // - Verifies proof against block header's merkleRoot.
    // - Verifies on-chain record dataHash matches DB dataHash (tamper detection).
    // - If verified, sends ciphertext to KMS cluster for threshold DEK recovery (Lagrange interpolation).
    // - Decrypts AES-256-GCM body and returns cleartext clinical record in response!
    QueryRecordResponse queryRecord(const QueryRecordRequest& req);

    // Active records display query (automatically filters out deleted records)
    std::vector<std::map<std::string, std::string>> getActiveRecordsForDisplay(const std::string& schemaName);

    // Cross-channel identity integration
    void setChannelManager(const CChannel::CChannelManager* mgr) { m_channelManager = mgr; }
    const CChannel::CChannelManager* getChannelManager() const { return m_channelManager; }

    // Signer consistency verification
    bool verifySignersMatchOriginal(const std::string& targetDataId,
                                   const std::string& doctorId,
                                   const std::string& doctorPublicKey,
                                   const std::string& patientId,
                                   const std::string& patientPublicKey,
                                   std::string& outError);

private:
    CChain& m_chain;
    CKsm::KsmCluster& m_ksmCluster;
    const CChannel::CChannelManager* m_channelManager{nullptr};
};

} // namespace CCrud
