#include "AccessManager.h"
#include <iostream>
#include <fstream>
#include <sstream>
#include <ctime>

namespace CAccessControl {

AccessManager::AccessManager(CChain& chain, std::filesystem::path offchainAuditDir)
    : m_chain(chain), m_offchainAuditDir(std::move(offchainAuditDir)) {
    if (!std::filesystem::exists(m_offchainAuditDir)) {
        std::filesystem::create_directories(m_offchainAuditDir);
    }
    m_offchainLogFile = m_offchainAuditDir / "offchain_access_audit.log";
}

bool AccessManager::verifyPatientConsent(const std::string& patientId,
                                        const std::string& doctorAddress,
                                        const std::string& scope,
                                        std::string& outConsentTxId) {
    // Emergency care policy bypass for life-threatening situations
    if (scope == "EMERGENCY" || scope == "EMERGENCY_CARE") {
        outConsentTxId = "CONSENT_EMERGENCY_OVERRIDE";
        return true;
    }

    // Query on-chain PERMISSION records from the ledger storage
    auto permissionRecords = m_chain.getRecordStorage().queryRecords("PERMISSION", {
        {"patient_id", patientId},
        {"granted_to", doctorAddress}
    });

    // Iterate in reverse order (most recent on-chain transaction first) so REVOKE_CONSENT
    // immediately overrides any earlier GRANT_CONSENT / APPROVE_CONSENT for this doctor
    for (auto it = permissionRecords.rbegin(); it != permissionRecords.rend(); ++it) {
        const auto& rec = *it;
        auto itDeleted = rec.find("is_deleted");
        if (itDeleted != rec.end() && itDeleted->second == "1") {
            outConsentTxId = "REVOKED_ON_CHAIN";
            return false;
        }
        auto itStatus = rec.find("status");
        if (itStatus != rec.end() && (itStatus->second == "REVOKED" || itStatus->second == "DENIED")) {
            outConsentTxId = "REVOKED_ON_CHAIN";
            return false;
        }
        auto itScope = rec.find("scope");
        if (itScope != rec.end()) {
            std::string grantedScope = itScope->second;
            if (grantedScope == "REVOKED") {
                outConsentTxId = "REVOKED_ON_CHAIN";
                return false;
            }
            if (grantedScope == scope ||
                grantedScope == "FullClinicalRecordAccess" ||
                grantedScope == "ALL" ||
                scope.empty()) {
                auto itDataId = rec.find("data_id");
                outConsentTxId = (itDataId != rec.end()) ? itDataId->second : "CONSENT_VERIFIED_ON_CHAIN";
                return true;
            }
        }
    }

    outConsentTxId = "NONE";
    return false;
}

CTransaction AccessManager::createAuditTransaction(const AccessRequest& req,
                                                  const std::string& decision,
                                                  const std::string& reason,
                                                  const std::string& consentTxId) {
    std::map<std::string, std::string> auditPayload = {
        {"record_id", req.recordId},
        {"patient_id", req.patientId},
        {"doctor_id", req.doctorId},
        {"requester_role", req.requesterRole},
        {"purpose", req.purpose},
        {"access_decision", decision},
        {"decision_reason", reason},
        {"consent_tx_id", consentTxId},
        {"audit_mode", auditPolicyToString(req.auditPolicy)}
    };

    // Construct the audit transaction
    CTransaction auditTx(
        "ACCESS_AUDIT",
        auditPayload,
        req.doctorId,
        "",
        CSchemaDef::SignerType::DOCTOR,
        req.doctorPublicKeyHex
    );

    if (!req.doctorPrivateKeyHex.empty()) {
        auditTx.sign(req.doctorPrivateKeyHex, req.doctorPublicKeyHex);
    }

    return auditTx;
}

void AccessManager::logOffchainEvent(const CTransaction& auditTx) {
    std::lock_guard<std::mutex> lock(m_mutex);
    m_batchedOffchainAudits.push_back(auditTx);

    std::ofstream ofs(m_offchainLogFile, std::ios::app);
    if (ofs.is_open()) {
        ofs << "[" << std::time(nullptr) << "] AUDIT_EVENT: TxID=" << auditTx.txId
            << " | Requester=" << auditTx.getField("doctor_id")
            << " | Patient=" << auditTx.getField("patient_id")
            << " | Record=" << auditTx.getField("record_id")
            << " | Decision=" << auditTx.getField("access_decision")
            << " | Reason=" << auditTx.getField("decision_reason")
            << " | ConsentRef=" << auditTx.getField("consent_tx_id") << "\n";
    }
}

AccessResult AccessManager::executeAccessWorkflow(
    const AccessRequest& request,
    const CKsm::EncryptedTxEnvelope& encryptedEnvelope,
    CKsm::KsmCluster& ksmCluster,
    const std::vector<std::string>& hospitalQuorum) {

    AccessResult result;
    result.auditMode = auditPolicyToString(request.auditPolicy);

    std::cout << "\n======================================================================\n";
    std::cout << "  CLINICAL RECORD ACCESS WORKFLOW: 5-STEP PROTOCOL INITIATED\n";
    std::cout << "======================================================================\n";

    // -------------------------------------------------------------------------
    // STEP 1: Doctor requests a record
    // -------------------------------------------------------------------------
    std::cout << "  [Step 1] Access Request Received:\n";
    std::cout << "    * Requester Doctor:  " << request.doctorId << "\n";
    std::cout << "    * Target Patient:    " << request.patientId << "\n";
    std::cout << "    * Target Record ID:  " << request.recordId << "\n";
    std::cout << "    * Clinical Purpose:  " << request.purpose << "\n";
    std::cout << "    * Requested Scope:   " << request.requiredScope << "\n";
    std::cout << "    * Audit Policy:      " << result.auditMode << "\n";

    // -------------------------------------------------------------------------
    // STEP 2: Authorization & Patient Consent Verification
    // -------------------------------------------------------------------------
    std::cout << "\n  [Step 2] Authorizing Requester & Verifying Patient Consent On-Chain...\n";
    std::string consentTxId = "NONE";
    bool consentGranted = verifyPatientConsent(request.patientId, request.doctorId, request.requiredScope, consentTxId);

    if (consentGranted) {
        result.authorized = true;
        result.decision = "APPROVED";
        result.reason = "PATIENT_CONSENT_VERIFIED_ON_CHAIN";
        result.consentTxId = consentTxId;
        std::cout << "    -> Status: AUTHORIZED (Patient consent active on-chain: " << consentTxId << ")\n";
    } else {
        result.authorized = false;
        result.decision = "DENIED";
        result.reason = "UNAUTHORIZED_NO_ACTIVE_PATIENT_CONSENT";
        result.consentTxId = "NONE";
        std::cout << "    -> Status: DENIED (No valid on-chain consent delegation from " 
                  << request.patientId << " to " << request.doctorId << ")\n";
    }

    // -------------------------------------------------------------------------
    // STEP 3: Record Access Request or Approved Decision on Blockchain
    // (Important: Store only metadata, NO plaintext record, NO DEK!)
    // -------------------------------------------------------------------------
    std::cout << "\n  [Step 3] Recording Auditing Event (Metadata Only, Zero Sensitive Payload)...\n";
    CTransaction auditTx = createAuditTransaction(request, result.decision, result.reason, result.consentTxId);
    result.auditTxId = auditTx.txId;

    if (request.auditPolicy == AuditPolicy::REALTIME_BLOCKCHAIN) {
        std::cout << "    * Submitting signed ACCESS_AUDIT transaction to Blockchain Mempool...\n";
        auto mempoolRes = m_chain.addTransaction(auditTx);
        std::cout << "    * Blockchain Mempool Result: " << mempoolRes.toString() << "\n";
        std::cout << "    * Immutable Audit TxID: " << auditTx.txId << "\n";
    } else {
        std::cout << "    * Logging to fast-path off-chain audit journal (Policy: OFFCHAIN_BATCHED)...\n";
        logOffchainEvent(auditTx);
        std::cout << "    * Off-chain Audit Journal Appended (Pending Batch TxID: " << auditTx.txId << ")\n";
    }

    // -------------------------------------------------------------------------
    // STEP 4: KMS Threshold Cryptographic Operation (DEK Recovery)
    // -------------------------------------------------------------------------
    std::cout << "\n  [Step 4] KMS Threshold Cryptographic Operation (DEK Recovery)...\n";
    if (!result.authorized) {
        std::cout << "    -> KMS ACCESS REFUSED: Authorization check failed!\n";
        std::cout << "    -> Hospital nodes refuse to disclose key shares. DEK remains completely unrecoverable.\n";
        std::cout << "    -> Security Policy: Confidentiality preserved.\n";
        return result;
    }

    std::cout << "    * Authorization verified! Requesting 3-of-4 hospital key shares for DEK reconstruction:\n";
    for (const auto& hospId : hospitalQuorum) {
        std::cout << "        - Participating Node: " << hospId << "\n";
    }

    try {
        result.decryptedClinicalRecord = ksmCluster.decryptRecord(encryptedEnvelope, hospitalQuorum);
        std::cout << "    -> KMS Success: 3-of-4 hospital threshold shares combined via Lagrange interpolation.\n";
        std::cout << "    -> Ephemeral DEK recovered in memory and immediately wiped after AES-256-GCM decryption.\n";
    } catch (const std::exception& ex) {
        std::cerr << "    -> KMS ERROR: " << ex.what() << "\n";
        result.authorized = false;
        result.reason = std::string("KMS_RECONSTRUCTION_FAILED: ") + ex.what();
        return result;
    }

    // -------------------------------------------------------------------------
    // STEP 5: Record Retrieval & Clinical Delivery
    // -------------------------------------------------------------------------
    std::cout << "\n  [Step 5] Record Retrieval & Delivery to Authorized Doctor:\n";
    std::cout << "    * Clinical Record successfully decrypted and delivered to " << request.doctorId << ":\n";
    for (const auto& [field, val] : result.decryptedClinicalRecord) {
        std::cout << "        - " << field << ": " << val << "\n";
    }
    std::cout << "======================================================================\n\n";

    return result;
}

size_t AccessManager::flushOffchainAuditsToBlockchain() {
    std::lock_guard<std::mutex> lock(m_mutex);
    size_t count = 0;
    std::cout << "[AccessManager] Flushing " << m_batchedOffchainAudits.size() 
              << " batched off-chain audit events to blockchain...\n";

    for (const auto& tx : m_batchedOffchainAudits) {
        auto res = m_chain.addTransaction(tx);
        if (res) {
            ++count;
        }
    }
    m_batchedOffchainAudits.clear();
    return count;
}

std::vector<std::map<std::string, std::string>> AccessManager::getAuditHistoryForRecord(const std::string& recordId) {
    return m_chain.getRecordStorage().queryRecords("ACCESS_AUDIT", {{"record_id", recordId}});
}

std::vector<std::map<std::string, std::string>> AccessManager::getAuditHistoryForPatient(const std::string& patientId) {
    return m_chain.getRecordStorage().queryRecords("ACCESS_AUDIT", {{"patient_id", patientId}});
}

} // namespace CAccessControl
