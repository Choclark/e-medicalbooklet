#pragma once

#include <string>
#include <vector>
#include <map>
#include <memory>
#include <filesystem>
#include "CChain/Cchain.h"
#include "CTransaction/CTransaction.h"
#include "../../ksm-core/CSchemaSplit/SchemaSplitter.h"
#include "../../ksm-core/CDkg/KsmCluster.h"

namespace CAccessControl {

enum class AuditPolicy {
    REALTIME_BLOCKCHAIN,  // Immediately commit audit event to blockchain mempool/consensus
    OFFCHAIN_BATCHED      // Log off-chain for frequent reads, periodically batch to chain
};

inline std::string auditPolicyToString(AuditPolicy policy) {
    return (policy == AuditPolicy::REALTIME_BLOCKCHAIN) ? "REALTIME_BLOCKCHAIN" : "OFFCHAIN_BATCHED";
}

struct AccessRequest {
    std::string recordId;              // Target medical record ID / Data ID
    std::string patientId;             // Patient owner of the record
    std::string doctorId;              // Requesting Doctor's address / ID
    std::string doctorPrivateKeyHex;   // Doctor's private key for signing request
    std::string doctorPublicKeyHex;    // Doctor's ECDSA public key
    std::string requesterRole{"DOCTOR"};
    std::string purpose{"CLINICAL_TREATMENT"};
    std::string requiredScope{"CardiologyClinicalHistoryRead"};
    AuditPolicy auditPolicy{AuditPolicy::REALTIME_BLOCKCHAIN};
};

struct AccessResult {
    bool authorized{false};
    std::string decision;              // "APPROVED" or "DENIED"
    std::string reason;                // Explanation (e.g. "PATIENT_CONSENT_VERIFIED")
    std::string consentTxId{"NONE"};   // On-chain PERMISSION transaction ID
    std::string auditTxId;             // Transaction ID of the ACCESS_AUDIT event
    std::string auditMode;             // "REALTIME_BLOCKCHAIN" or "OFFCHAIN_BATCHED"
    std::map<std::string, std::string> decryptedClinicalRecord;
};

class AccessManager {
public:
    AccessManager(CChain& chain, std::filesystem::path offchainAuditDir = "chaindata/audit_logs");

    // 5-Step Access & Auditing Workflow:
    // 1. Doctor requests a record (AccessRequest)
    // 2. Authorization: Verifies doctor's identity, permissions, and patient consent on-chain
    // 3. Blockchain transaction: Records access request or decision as an ACCESS_AUDIT transaction
    //    (Guarantees NO plaintext medical record or DEK is stored in the audit transaction)
    // 4. KMS: Performs authorized threshold cryptographic operation to recover the DEK
    // 5. Record retrieval: Decrypts medical record and returns it to the authorized doctor
    AccessResult executeAccessWorkflow(
        const AccessRequest& request,
        const CKsm::EncryptedTxEnvelope& encryptedEnvelope,
        CKsm::KsmCluster& ksmCluster,
        const std::vector<std::string>& hospitalQuorum);

    // Verifies whether active patient consent exists on-chain for the requesting doctor
    bool verifyPatientConsent(const std::string& patientId,
                              const std::string& doctorAddress,
                              const std::string& scope,
                              std::string& outConsentTxId);

    // Creates an immutable ACCESS_AUDIT transaction (contains only audit metadata, NO clinical body, NO DEK)
    CTransaction createAuditTransaction(const AccessRequest& req,
                                       const std::string& decision,
                                       const std::string& reason,
                                       const std::string& consentTxId);

    // Flush off-chain audit events to the blockchain ledger
    size_t flushOffchainAuditsToBlockchain();

    // Query on-chain audit history for a patient or record
    std::vector<std::map<std::string, std::string>> getAuditHistoryForRecord(const std::string& recordId);
    std::vector<std::map<std::string, std::string>> getAuditHistoryForPatient(const std::string& patientId);

    void logOffchainEvent(const CTransaction& auditTx);

private:
    CChain& m_chain;
    std::filesystem::path m_offchainAuditDir;
    std::filesystem::path m_offchainLogFile;
    std::vector<CTransaction> m_batchedOffchainAudits;
    std::mutex m_mutex;
};

} // namespace CAccessControl
