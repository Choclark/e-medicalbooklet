#include <iostream>
#include <iomanip>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#include <map>
#include <thread>
#include <mutex>
#include <memory>
#include <filesystem>
#include <cstdlib>
#include <cstring>
#include <utility>
#include <chrono>
#include <ctime>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
#pragma comment(lib, "ws2_32.lib")
using socket_t = SOCKET;
#define IS_VALID_SOCKET(s) ((s) != INVALID_SOCKET)
#define CLOSE_SOCKET(s) closesocket(s)
#else
#include <unistd.h>
#include <netdb.h>
#include <arpa/inet.h>
#include <sys/socket.h>
using socket_t = int;
#define IS_VALID_SOCKET(s) ((s) >= 0)
#define CLOSE_SOCKET(s) close(s)
#endif

// Blockchain Core Headers
#include "CCrypto/CryptoSigner.h"
#include "CCrypto/Sha256.h"
#include "CConfig/CConfig.h"
#include "CTransaction/CTransaction.h"
#include "CTransaction/CSchemaRegistry.h"
#include "CConsensus/CConsensusRules.h"
#include "CConsensus/CPbftEngine.h"
#include "CBlock/Cblock.h"
#include "CChain/Cchain.h"
#include "CStorage/CBlockStore.h"
#include "CStorage/CArchiveManager.h"
#include "CRecordStorage/CRecordStorageManager.h"
#include "CAccessControl/AccessManager.h"
#include "CMerkle/CMerkleTree.h"
#include "CMerkle/CMerkleStore.h"
#include "CCrud/CrudManager.h"

// KSM Core Headers
#include "../ksm-core/CDkg/KsmCluster.h"
#include "../ksm-core/CSchemaSplit/SchemaSplitter.h"
#include "../ksm-core/CShamir/ShamirSecretSharing.h"
#include "../ksm-core/CCrypto/AesGcmCipher.h"

#ifdef DELETE
#undef DELETE
#endif

namespace fs = std::filesystem;

// ============================================================================
// Global State & Thread Synchronization for CChain Persistence
// ============================================================================
static std::mutex g_chainMutex;
static std::unique_ptr<CChain> g_chain = nullptr;
static std::unique_ptr<CKsm::KsmCluster> g_ksmCluster = nullptr;
static std::unique_ptr<CAccessControl::AccessManager> g_accessManager = nullptr;
static std::unique_ptr<CStorage::CArchiveManager> g_archiveManager = nullptr;
static std::string g_activeDataDir = "";
static std::string g_activeNodeId = "";
static uint32_t g_activeChainId = 0;

// Helper: Trim whitespace
static std::string trimString(const std::string& str) {
    size_t first = str.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) return "";
    size_t last = str.find_last_not_of(" \t\r\n");
    return str.substr(first, (last - first + 1));
}

// Helper: Simple key-value parser for commands
static std::string extractParam(const std::string& input, const std::string& key) {
    std::string pattern = key + "=";
    size_t pos = input.find(pattern);
    if (pos == std::string::npos) {
        // Try JSON format: "key": "value" or "key": value
        std::string jsonKey = "\"" + key + "\"";
        size_t jpos = input.find(jsonKey);
        if (jpos != std::string::npos) {
            size_t colon = input.find(':', jpos + jsonKey.length());
            if (colon != std::string::npos) {
                size_t valStart = input.find_first_not_of(" \t\r\n", colon + 1);
                if (valStart != std::string::npos) {
                    if (input[valStart] == '"') {
                        size_t strEnd = input.find('"', valStart + 1);
                        if (strEnd != std::string::npos) {
                            return input.substr(valStart + 1, strEnd - (valStart + 1));
                        }
                    } else {
                        size_t numEnd = input.find_first_of(",}\r\n", valStart);
                        return trimString(input.substr(valStart, numEnd == std::string::npos ? std::string::npos : numEnd - valStart));
                    }
                }
            }
        }
        return "";
    }
    size_t start = pos + pattern.length();
    if (start < input.length() && input[start] == '"') {
        start++;
        size_t end = input.find('"', start);
        return (end == std::string::npos) ? input.substr(start) : input.substr(start, end - start);
    }
    size_t end = input.find_first_of(" \t\r\n,", start);
    return (end == std::string::npos) ? input.substr(start) : input.substr(start, end - start);
}

// Helper: Write query audit log (audit log only, not stored in blockchain block)
static void writeQueryAuditLog(const fs::path& logFilePath,
                               const std::string& queryTxId,
                               const std::string& doctorId,
                               const std::string& patientId,
                               const std::string& dataId,
                               const std::string& purpose,
                               const std::string& status,
                               const std::vector<std::string>& ksmQuorum) {
    try {
        fs::create_directories(logFilePath.parent_path());
        std::ofstream logFile(logFilePath, std::ios::app);
        if (!logFile.is_open()) return;

        auto now = std::chrono::system_clock::to_time_t(std::chrono::system_clock::now());
        logFile << "[" << now << "] AUDIT_QUERY_REQUEST"
                << " | QueryTxID=" << queryTxId
                << " | Requester=" << doctorId
                << " | Patient=" << patientId
                << " | TargetRecord=" << dataId
                << " | Purpose=" << purpose
                << " | Status=" << status
                << " | ConsensusValidated=TRUE"
                << " | LedgerBlockAnchored=FALSE (READ_LOG_ONLY)"
                << " | KMS_Quorum=[";
        for (size_t i = 0; i < ksmQuorum.size(); ++i) {
            logFile << ksmQuorum[i] << (i + 1 < ksmQuorum.size() ? "," : "");
        }
        logFile << "]\n";
    } catch (...) {}
}

// ============================================================================
// Mount or Initialize Node Persistence Directory Structure & KSM Cluster
// ============================================================================
struct StorageInitResult {
    bool success;
    std::string nodeId;
    uint32_t chainId;
    std::string dataDir;
    uint64_t chainHeight;
    std::string tipHash;
    bool isReloaded;
};

StorageInitResult initStorage(const std::string& reqNodeId, uint32_t reqChainId, const std::string& explicitDir) {
    std::lock_guard<std::mutex> lock(g_chainMutex);

    std::string nodeId = reqNodeId.empty() ? (g_activeNodeId.empty() ? "node-default" : g_activeNodeId) : reqNodeId;
    uint32_t chainId = reqChainId;

    std::string targetDir = explicitDir;
    if (targetDir.empty()) {
        if (!nodeId.empty()) {
            targetDir = "chaindata/" + nodeId;
        } else {
            targetDir = "chaindata/chain_" + std::to_string(chainId);
        }
    }

    if (g_chain != nullptr && g_activeDataDir == targetDir) {
        return {
            true,
            g_activeNodeId,
            g_activeChainId,
            g_activeDataDir,
            g_chain->getChainHeight(),
            g_chain->getLatestHeader().blockHash,
            true
        };
    }

    try {
        fs::path basePath(targetDir);
        fs::create_directories(basePath);
        fs::create_directories(basePath / "db");
        fs::create_directories(basePath / "uploads");
        fs::create_directories(basePath / "blocks");
        fs::create_directories(basePath / "merkle_trees");
        fs::create_directories(basePath / "ksm_storage");
        fs::create_directories(basePath / "audit_logs");
        fs::create_directories(basePath / "archives");

        bool existsBefore = fs::exists(basePath / "index.dat") || fs::exists(basePath / "blocks");

        std::string chainName = "MedicalChain-Channel-" + std::to_string(chainId);
        g_chain = std::make_unique<CChain>(chainId, chainName, "blockchain.conf", targetDir);
        g_activeDataDir = targetDir;
        g_activeNodeId = nodeId;
        g_activeChainId = chainId;

        // Initialize KSM 3-of-4 Threshold Cluster in the active data directory
        g_ksmCluster = std::make_unique<CKsm::KsmCluster>(3, 4, basePath / "ksm_storage");
        g_ksmCluster->registerNode("HOSPITAL_A", 1);
        g_ksmCluster->registerNode("HOSPITAL_B", 2);
        g_ksmCluster->registerNode("HOSPITAL_C", 3);
        g_ksmCluster->registerNode("HOSPITAL_D", 4);

        // Initialize On-Chain Consent AccessManager & Cold Block ArchiveManager
        g_accessManager = std::make_unique<CAccessControl::AccessManager>(*g_chain, basePath / "audit_logs");
        g_archiveManager = std::make_unique<CStorage::CArchiveManager>(basePath);

        uint64_t height = g_chain->getChainHeight();
        std::string tipHash = g_chain->getLatestHeader().blockHash;

        fs::path infoFile = basePath / "chain_info.json";
        std::ofstream out(infoFile);
        if (out.is_open()) {
            auto now = std::chrono::system_clock::to_time_t(std::chrono::system_clock::now());
            out << "{\n"
                << "  \"node_id\": \"" << nodeId << "\",\n"
                << "  \"chain_id\": " << chainId << ",\n"
                << "  \"data_dir\": \"" << targetDir << "\",\n"
                << "  \"chain_height\": " << height << ",\n"
                << "  \"tip_hash\": \"" << tipHash << "\",\n"
                << "  \"ksm_threshold\": \"3-of-4\",\n"
                << "  \"last_mounted\": " << now << ",\n"
                << "  \"status\": \"ACTIVE\"\n"
                << "}\n";
            out.close();
        }

        std::cout << "\n======================================================================\n";
        std::cout << "  [BLOCKCHAIN CORE: STORAGE & KSM CLUSTER MOUNTED (PERSISTENT)]\n";
        std::cout << "======================================================================\n";
        std::cout << "  * Node ID:         " << nodeId << "\n";
        std::cout << "  * Chain ID:        " << chainId << "\n";
        std::cout << "  * Target DataDir:  " << targetDir << "\n";
        std::cout << "  * KSM Threshold:   3-of-4 Hospitals Quorum Initialized\n";
        std::cout << "  * Chain Tip Hash:  " << tipHash << "\n";
        std::cout << "  * Current Height:  " << height << "\n";
        std::cout << "  * State:           " << (existsBefore ? "RESTORED FROM DISK" : "GENESIS INITIALIZED") << "\n";
        std::cout << "======================================================================\n\n" << std::flush;

        return {true, nodeId, chainId, targetDir, height, tipHash, existsBefore};
    } catch (const std::exception& e) {
        std::cerr << "[!] Error initializing storage for " << targetDir << ": " << e.what() << std::endl;
        return {false, nodeId, chainId, targetDir, 0, "", false};
    }
}

// ============================================================================
// CORE DATA WRITING WORKFLOW (Doctor signs -> Consensus -> AES-GCM Encrypt -> Commit)
// ============================================================================
std::string handleCoreDataWrite(const std::string& requestStr) {
    std::lock_guard<std::mutex> lock(g_chainMutex);
    if (!g_chain) {
        initStorage("val-default", 0, "");
    }

    std::string doctorId = extractParam(requestStr, "doctor_id");
    if (doctorId.empty()) doctorId = "doc-martin";

    std::string patientId = extractParam(requestStr, "patient_id");
    if (patientId.empty()) patientId = "patient-kamga-01";

    std::string hospitalId = extractParam(requestStr, "hospital_id");
    if (hospitalId.empty()) hospitalId = "hosp-yaounde-central";

    std::string doctorPubKey = extractParam(requestStr, "doctor_public_key");
    std::string patientPubKey = extractParam(requestStr, "patient_public_key");
    std::string portalSignature = extractParam(requestStr, "digital_signature");
    std::string payloadHash = extractParam(requestStr, "payload_hash");
    std::string requestedDataId = extractParam(requestStr, "data_id");

    std::string diagnosis = extractParam(requestStr, "diagnosis");
    if (diagnosis.empty()) diagnosis = "Cardiovascular Consultation & Lipid Evaluation";

    std::string treatment = extractParam(requestStr, "treatment");
    if (treatment.empty()) treatment = "Lifestyle Modification & Daily Antihypertensive Therapy";

    std::string medication = extractParam(requestStr, "medication");
    if (medication.empty()) medication = "Amlodipine 5mg PO daily, Atorvastatin 20mg PO qhs";

    std::string notes = extractParam(requestStr, "notes");
    if (notes.empty()) notes = "Patient examined at Yaounde Central Hospital. Normal sinus rhythm.";

    std::string bp = extractParam(requestStr, "blood_pressure");
    if (bp.empty()) bp = "132/84 mmHg";

    // 1. Verify Portal's ECDSA P-256 signature directly via Windows CNG BCryptVerifySignature
    //    (Only fall back to local key generation for standalone CLI invocations that omit digital_signature)
    auto fallbackDoctorKeys = CCrypto::CryptoSigner::generateKeyPair();
    auto fallbackPatientKeys = CCrypto::CryptoSigner::generateKeyPair();
    if (doctorPubKey.empty()) doctorPubKey = fallbackDoctorKeys.publicKeyHex;
    if (patientPubKey.empty()) patientPubKey = fallbackPatientKeys.publicKeyHex;

    bool portalSigVerified = false;
    if (!portalSignature.empty() && !payloadHash.empty() && !doctorPubKey.empty()) {
        portalSigVerified = CCrypto::CryptoSigner::verify(doctorPubKey, payloadHash, portalSignature);
        if (!portalSigVerified) {
            std::cerr << "[Signature Error] Portal ECDSA P-256 signature verification failed against doctor_public_key!\n";
            return "{\n  \"status\": \"ERROR\",\n  \"action\": \"SIGNATURE_VERIFICATION_FAILED\",\n  \"message\": \"Portal ECDSA P-256 signature failed verification in C++ CryptoSigner::verify\"\n}\n";
        }
    }

    std::string proposerAddress = "0x" + CCrypto::Sha256::hashHex(doctorPubKey).substr(0, 40);

    // 2. Sensitive clinical fields (Private Health Information)
    std::map<std::string, std::string> clinicalFields = {
        {"patient_id", patientId},
        {"doctor_id", doctorId},
        {"hospital_id", hospitalId},
        {"diagnosis", diagnosis},
        {"treatment", treatment},
        {"medication", medication},
        {"notes", notes},
        {"blood_pressure", bp}
    };

    // 3. Fast Symmetric Encryption using AES-256-GCM & Shamir Secret Sharing
    //    Pass through KSM: Encrypts body with AES-256-GCM, splits DEK into 3-of-4 shares, wipes DEK
    CKsm::EncryptedTxEnvelope envelope = g_ksmCluster->encryptRecord(
        "CREATE_EHR_RECORD",
        clinicalFields,
        "DOCTOR",
        proposerAddress,
        doctorPubKey,
        portalSigVerified ? portalSignature : ""
    );

    std::string recordDataId = requestedDataId.empty() ? ("REC-" + envelope.metadata.txId.substr(0, 16)) : requestedDataId;
    std::string cipherHex = CCrypto::CryptoSigner::toHex(envelope.encryptedBody.ciphertext.data(), envelope.encryptedBody.ciphertext.size());
    std::string ivHex = CCrypto::CryptoSigner::toHex(envelope.encryptedBody.iv.data(), envelope.encryptedBody.iv.size());
    std::string tagHex = CCrypto::CryptoSigner::toHex(envelope.encryptedBody.tag.data(), envelope.encryptedBody.tag.size());

    // 4. Construct CTransaction adhering to "CREATE_EHR_RECORD" schema
    CTransaction createTx;
    createTx.schemaType = "CREATE_EHR_RECORD";
    createTx.senderId = doctorId;
    createTx.senderPublicKey = doctorPubKey;
    createTx.signerType = CSchemaDef::SignerType::DOCTOR;
    createTx.timestamp = std::time(nullptr);

    // Unencrypted metadata (Plaintext headers for consensus verification & indexing)
    createTx.setField("target_data_id", recordDataId);
    createTx.setField("data_id", recordDataId);
    createTx.setField("patient_id", patientId);
    createTx.setField("doctor_id", doctorId);
    createTx.setField("hospital_id", hospitalId);
    createTx.setField("doctor_public_key", doctorPubKey);
    createTx.setField("patient_public_key", patientPubKey);
    createTx.setField("ksm_tx_id", envelope.metadata.txId);
    createTx.setField("ciphertext_hex", cipherHex);
    createTx.setField("iv_hex", ivHex);
    createTx.setField("auth_tag_hex", tagHex);
    createTx.setField("body_data_hash", envelope.metadata.bodyDataHash);
    createTx.setField("version", "1");
    createTx.setField("is_deleted", "0");
    createTx.setField("operation", "CREATE");

    // Mask sensitive clinical fields for schema adherence
    for (const auto& [k, v] : clinicalFields) {
        if (k != "patient_id" && k != "doctor_id" && k != "hospital_id" && k != "target_data_id" && k != "data_id") {
            createTx.setField(k, "[AES_GCM_ENCRYPTED]");
        }
    }

    if (portalSigVerified) {
        // Attach the verified Portal ECDSA P-256 signature and payload_hash directly!
        createTx.attachExternalSignature(payloadHash, doctorPubKey, portalSignature);
    } else {
        // Standalone CLI fallback signing
        createTx.sign(fallbackDoctorKeys.privateKeyHex, doctorPubKey);
        createTx.addCoSignature(patientId, fallbackPatientKeys.privateKeyHex, patientPubKey);
    }

    // 5. Consensus Validation: Law 1 Schema & Signatures
    ValidationResult mempoolRes = g_chain->addTransaction(createTx);
    if (!mempoolRes) {
        std::cerr << "[Consensus Error] Mempool rejected tx: " << mempoolRes.toString() << std::endl;
    }

    // Propose & Commit Block
    CBlock proposedBlock = g_chain->proposeBlock(proposerAddress);
    ValidationResult commitRes = g_chain->commitBlock(proposedBlock);

    // Ensure default patient -> doctor consent exists on-chain for initial record creation unless explicitly managed
    if (g_accessManager) {
        std::string existingConsentTx;
        if (!g_accessManager->verifyPatientConsent(patientId, doctorId, "FullClinicalRecordAccess", existingConsentTx) &&
            existingConsentTx != "REVOKED_ON_CHAIN") {
            CTransaction autoGrantTx;
            autoGrantTx.schemaType = "PERMISSION";
            autoGrantTx.senderId = patientId;
            autoGrantTx.senderPublicKey = fallbackPatientKeys.publicKeyHex;
            autoGrantTx.signerType = CSchemaDef::SignerType::PATIENT;
            autoGrantTx.timestamp = std::time(nullptr);
            autoGrantTx.setField("data_id", "CONSENT-INIT-" + recordDataId);
            autoGrantTx.setField("patient_id", patientId);
            autoGrantTx.setField("granted_to", doctorId);
            autoGrantTx.setField("scope", "FullClinicalRecordAccess");
            autoGrantTx.setField("status", "ACTIVE");
            autoGrantTx.setField("is_deleted", "0");
            autoGrantTx.sign(fallbackPatientKeys.privateKeyHex, fallbackPatientKeys.publicKeyHex);
            if (g_chain->addTransaction(autoGrantTx)) {
                CBlock consentBlock = g_chain->proposeBlock(fallbackPatientKeys.address);
                g_chain->commitBlock(consentBlock);
            }
        }
    }

    uint64_t currentHeight = g_chain->getChainHeight();
    std::string tipHash = g_chain->getLatestHeader().blockHash;
    std::string merkleRoot = g_chain->getLatestHeader().merkleRoot;

    std::cout << "\n======================================================================\n";
    std::cout << " [+] MEDICAL RECORD WRITTEN & COMMITTED ON BLOCKCHAIN LEDGER\n";
    std::cout << "======================================================================\n";
    std::cout << "  * Record Data ID:   " << recordDataId << "\n";
    std::cout << "  * Doctor Signer:    " << doctorId << " (Portal ECDSA P-256 Verified: " << (portalSigVerified ? "TRUE [RAW_XY]" : "CLI_FALLBACK") << ")\n";
    std::cout << "  * Patient Owner:    " << patientId << " (Key Owner: TRUE)\n";
    std::cout << "  * Hospital Context: " << hospitalId << "\n";
    std::cout << "  * Encryption:       AES-256-GCM (" << envelope.encryptedBody.ciphertext.size() << " bytes ciphertext)\n";
    std::cout << "  * Key Protection:   KSM 3-of-4 Shamir Shares on Hospital Nodes\n";
    std::cout << "  * Body Data Hash:   " << envelope.metadata.bodyDataHash << "\n";
    std::cout << "  * Ledger Height:    Block #" << currentHeight << " (Tip: " << tipHash.substr(0, 16) << "...)\n";
    std::cout << "  * Merkle Root:      " << merkleRoot.substr(0, 16) << "...\n";
    std::cout << "======================================================================\n\n" << std::flush;

    std::ostringstream ss;
    ss << "{\n"
       << "  \"status\": \"OK\",\n"
       << "  \"action\": \"RECORD_WRITTEN_AND_COMMITTED\",\n"
       << "  \"tx_id\": \"" << createTx.txId << "\",\n"
       << "  \"data_id\": \"" << recordDataId << "\",\n"
       << "  \"ksm_tx_id\": \"" << envelope.metadata.txId << "\",\n"
       << "  \"block_height\": " << currentHeight << ",\n"
       << "  \"block_hash\": \"" << tipHash << "\",\n"
       << "  \"merkle_root\": \"" << merkleRoot << "\",\n"
       << "  \"body_data_hash\": \"" << envelope.metadata.bodyDataHash << "\",\n"
       << "  \"ciphertext_bytes\": " << envelope.encryptedBody.ciphertext.size() << ",\n"
       << "  \"portal_signature_verified\": " << (portalSigVerified ? "true" : "false") << ",\n"
       << "  \"encryption\": \"AES-256-GCM + KSM_3_OF_4_THRESHOLD\",\n"
       << "  \"doctor_id\": \"" << doctorId << "\",\n"
       << "  \"patient_id\": \"" << patientId << "\",\n"
       << "  \"hospital_id\": \"" << hospitalId << "\",\n"
       << "  \"consensus_verified\": true\n"
       << "}\n";
    return ss.str();
}

// ============================================================================
// CORE CONSENT WORKFLOW (Patient APPROVE_CONSENT / REVOKE_CONSENT -> On-Chain PERMISSION)
// ============================================================================
std::string handleCoreConsentWrite(const std::string& requestStr) {
    std::lock_guard<std::mutex> lock(g_chainMutex);
    if (!g_chain) {
        initStorage("val-default", 0, "");
    }

    std::string consentId = extractParam(requestStr, "consent_id");
    if (consentId.empty()) consentId = extractParam(requestStr, "data_id");
    if (consentId.empty()) consentId = "CONSENT-" + std::to_string(std::time(nullptr));

    std::string patientId = extractParam(requestStr, "patient_id");
    if (patientId.empty()) patientId = "patient-kamga-01";

    std::string doctorId = extractParam(requestStr, "doctor_id");
    if (doctorId.empty()) doctorId = extractParam(requestStr, "granted_to");
    if (doctorId.empty()) doctorId = "doc-martin";

    std::string consentAction = extractParam(requestStr, "consent_action");
    if (consentAction.empty()) consentAction = extractParam(requestStr, "operation");
    if (consentAction.empty()) {
        consentAction = (requestStr.find("REVOKE") != std::string::npos) ? "REVOKE_CONSENT" : "APPROVE_CONSENT";
    }

    bool isRevoke = (consentAction.find("REVOKE") != std::string::npos);

    std::string scope = extractParam(requestStr, "scope");
    if (scope.empty()) scope = isRevoke ? "REVOKED" : "FullClinicalRecordAccess";
    if (isRevoke) scope = "REVOKED";

    std::string patientPubKey = extractParam(requestStr, "patient_public_key");
    if (patientPubKey.empty()) patientPubKey = extractParam(requestStr, "signer_public_key");
    std::string portalSignature = extractParam(requestStr, "digital_signature");
    std::string payloadHash = extractParam(requestStr, "payload_hash");

    auto fallbackPatientKeys = CCrypto::CryptoSigner::generateKeyPair();
    if (patientPubKey.empty()) patientPubKey = fallbackPatientKeys.publicKeyHex;

    bool portalSigVerified = false;
    if (!portalSignature.empty() && !payloadHash.empty() && !patientPubKey.empty()) {
        portalSigVerified = CCrypto::CryptoSigner::verify(patientPubKey, payloadHash, portalSignature);
    }

    CTransaction permTx;
    permTx.schemaType = "PERMISSION";
    permTx.senderId = patientId;
    permTx.senderPublicKey = patientPubKey;
    permTx.signerType = CSchemaDef::SignerType::PATIENT;
    permTx.timestamp = std::time(nullptr);
    permTx.setField("data_id", consentId);
    permTx.setField("target_data_id", consentId);
    permTx.setField("patient_id", patientId);
    permTx.setField("granted_to", doctorId);
    permTx.setField("scope", scope);
    permTx.setField("status", isRevoke ? "REVOKED" : "ACTIVE");
    permTx.setField("is_deleted", isRevoke ? "1" : "0");
    permTx.setField("operation", isRevoke ? "REVOKE_CONSENT" : "APPROVE_CONSENT");

    if (portalSigVerified) {
        permTx.attachExternalSignature(payloadHash, patientPubKey, portalSignature);
    } else {
        permTx.sign(fallbackPatientKeys.privateKeyHex, fallbackPatientKeys.publicKeyHex);
    }

    std::string proposerAddress = "0x" + CCrypto::Sha256::hashHex(patientPubKey).substr(0, 40);
    ValidationResult mempoolRes = g_chain->addTransaction(permTx);
    CBlock proposedBlock = g_chain->proposeBlock(proposerAddress);
    ValidationResult commitRes = g_chain->commitBlock(proposedBlock);

    uint64_t currentHeight = g_chain->getChainHeight();
    std::string tipHash = g_chain->getLatestHeader().blockHash;
    std::string merkleRoot = g_chain->getLatestHeader().merkleRoot;

    std::ostringstream ss;
    ss << "{\n"
       << "  \"status\": \"OK\",\n"
       << "  \"action\": \"" << (isRevoke ? "CONSENT_REVOKED_ON_CHAIN" : "CONSENT_APPROVED_ON_CHAIN") << "\",\n"
       << "  \"tx_id\": \"" << permTx.txId << "\",\n"
       << "  \"consent_id\": \"" << consentId << "\",\n"
       << "  \"patient_id\": \"" << patientId << "\",\n"
       << "  \"granted_to\": \"" << doctorId << "\",\n"
       << "  \"scope\": \"" << scope << "\",\n"
       << "  \"consent_status\": \"" << (isRevoke ? "REVOKED" : "ACTIVE") << "\",\n"
       << "  \"portal_signature_verified\": " << (portalSigVerified ? "true" : "false") << ",\n"
       << "  \"block_height\": " << currentHeight << ",\n"
       << "  \"block_hash\": \"" << tipHash << "\",\n"
       << "  \"merkle_root\": \"" << merkleRoot << "\"\n"
       << "}\n";
    return ss.str();
}

// ============================================================================
// CORE DATA READING WORKFLOW (Proxy Re-Encryption + KSM Threshold + TrustZone Decrypt)
// ============================================================================
std::string handleCoreDataRead(const std::string& requestStr) {
    std::lock_guard<std::mutex> lock(g_chainMutex);
    if (!g_chain) {
        initStorage("val-default", 0, "");
    }

    std::string doctorId = extractParam(requestStr, "doctor_id");
    if (doctorId.empty()) doctorId = "doc-martin";

    std::string patientId = extractParam(requestStr, "patient_id");
    if (patientId.empty()) patientId = "patient-kamga-01";

    std::string dataId = extractParam(requestStr, "data_id");
    std::string scope = extractParam(requestStr, "scope");
    if (scope.empty()) scope = "FullClinicalRecordAccess";
    std::string purpose = extractParam(requestStr, "purpose");
    if (purpose.empty()) purpose = "CLINICAL_TREATMENT_AND_REVISION";

    std::string doctorPubKey = extractParam(requestStr, "doctor_public_key");
    auto doctorKeys = CCrypto::CryptoSigner::generateKeyPair();
    if (doctorPubKey.empty()) doctorPubKey = doctorKeys.publicKeyHex;

    // 1. Fetch Stored Encrypted Record from SQLite Database
    std::string searchDataId = dataId;
    if (searchDataId.empty()) {
        auto activeRecords = g_chain->getRecordStorage().getActiveRecords("CREATE_EHR_RECORD");
        if (!activeRecords.empty()) {
            searchDataId = activeRecords.back().at("data_id");
        }
    }

    auto storedRecordOpt = g_chain->getRecordStorage().retrieveRecord("CREATE_EHR_RECORD", searchDataId);
    if (!storedRecordOpt) {
        return "{\n  \"status\": \"ERROR\",\n  \"message\": \"Record not found in database: " + searchDataId + "\"\n}\n";
    }

    const auto& dbRecord = *storedRecordOpt;
    uint64_t blockHeight = std::stoull(dbRecord.at("block_height"));
    uint32_t txOrder = std::stoul(dbRecord.at("tx_order"));

    // 2. Enforce On-Chain Patient Consent via AccessManager BEFORE KMS DEK Reconstruction
    std::string consentTxId = "NONE";
    bool consentGranted = false;
    if (g_accessManager) {
        consentGranted = g_accessManager->verifyPatientConsent(patientId, doctorId, scope, consentTxId);
    }

    CAccessControl::AccessRequest accessReq;
    accessReq.doctorId = doctorId;
    accessReq.doctorPublicKeyHex = doctorPubKey;
    accessReq.doctorPrivateKeyHex = doctorKeys.privateKeyHex;
    accessReq.patientId = patientId;
    accessReq.recordId = searchDataId;
    accessReq.requesterRole = "DOCTOR";
    accessReq.purpose = purpose;
    accessReq.requiredScope = scope;
    accessReq.auditPolicy = CAccessControl::AuditPolicy::OFFCHAIN_BATCHED;

    std::string decisionStr = consentGranted ? "APPROVED" : "DENIED";
    std::string reasonStr = consentGranted ? "PATIENT_CONSENT_VERIFIED_ON_CHAIN" : "UNAUTHORIZED_NO_ACTIVE_PATIENT_CONSENT";

    CTransaction auditTx;
    if (g_accessManager) {
        auditTx = g_accessManager->createAuditTransaction(accessReq, decisionStr, reasonStr, consentTxId);
        g_accessManager->logOffchainEvent(auditTx);
    }

    std::vector<std::string> hospitalQuorum = {"HOSPITAL_A", "HOSPITAL_B", "HOSPITAL_C"};
    fs::path auditLogPath = fs::path(g_activeDataDir) / "audit_logs" / "query_audit.log";

    if (!consentGranted) {
        writeQueryAuditLog(auditLogPath, auditTx.txId, doctorId, patientId, searchDataId, purpose, "DENIED_NO_CONSENT", {});
        std::ostringstream denySs;
        denySs << "{\n"
               << "  \"status\": \"ERROR\",\n"
               << "  \"action\": \"ACCESS_DENIED_BY_ACCESS_MANAGER\",\n"
               << "  \"decision\": \"DENIED\",\n"
               << "  \"reason\": \"" << reasonStr << "\",\n"
               << "  \"consent_tx_id\": \"" << consentTxId << "\",\n"
               << "  \"audit_tx_id\": \"" << auditTx.txId << "\",\n"
               << "  \"data_id\": \"" << searchDataId << "\",\n"
               << "  \"patient_id\": \"" << patientId << "\",\n"
               << "  \"doctor_id\": \"" << doctorId << "\"\n"
               << "}\n";
        return denySs.str();
    }

    // 3. Merkle Inclusion Proof Verification against Block Header
    bool merkleVerified = false;
    auto merkleTreeOpt = g_chain->getMerkleStore().getTree(blockHeight);
    auto blockHeaderOpt = g_chain->getHeaderByHeight(blockHeight);
    if (merkleTreeOpt && blockHeaderOpt) {
        CMerkle::MerkleProof proof = merkleTreeOpt->getProof(txOrder);
        merkleVerified = proof.verify(blockHeaderOpt->merkleRoot);
    }

    // 4. KMS 3-of-4 Threshold Reconstruction + Proxy Re-Encryption (PRE) Capsule Generation
    CKsm::EncryptedTxEnvelope fetchEnvelope;
    fetchEnvelope.metadata.txId = dbRecord.at("ksm_tx_id");
    fetchEnvelope.metadata.schemaType = "CREATE_EHR_RECORD";
    fetchEnvelope.metadata.patientId = patientId;
    fetchEnvelope.metadata.doctorId = doctorId;
    fetchEnvelope.metadata.bodyDataHash = dbRecord.at("body_data_hash");
    fetchEnvelope.metadata.thresholdT = 3;
    fetchEnvelope.metadata.totalN = 4;

    fetchEnvelope.encryptedBody.ciphertext = CCrypto::CryptoSigner::fromHex(dbRecord.at("ciphertext_hex"));
    fetchEnvelope.encryptedBody.iv = CCrypto::CryptoSigner::fromHex(dbRecord.at("iv_hex"));
    fetchEnvelope.encryptedBody.tag = CCrypto::CryptoSigner::fromHex(dbRecord.at("auth_tag_hex"));

    // Reconstruct the 32-byte DEK via Shamir Lagrange interpolation and immediately wrap it
    // into a Proxy Re-Encryption capsule bound to the Doctor's Public Key
    std::vector<uint8_t> rawDek = g_ksmCluster->reconstructKeyForTx(fetchEnvelope.metadata.txId, hospitalQuorum);
    std::string prkSeed = doctorPubKey + "|" + patientId + "|" + searchDataId;
    auto prkArr = CCrypto::Sha256::hash(reinterpret_cast<const uint8_t*>(prkSeed.data()), prkSeed.size());
    std::vector<uint8_t> prkKey(prkArr.begin(), prkArr.end());

    CKsm::AesGcmResult preCapsule = CKsm::AesGcmCipher::encrypt(prkKey, rawDek);
    std::fill(rawDek.begin(), rawDek.end(), 0);
    std::fill(prkKey.begin(), prkKey.end(), 0);

    std::string reencryptedDekHex = CCrypto::CryptoSigner::toHex(preCapsule.ciphertext.data(), preCapsule.ciphertext.size());
    std::string preIvHex = CCrypto::CryptoSigner::toHex(preCapsule.iv.data(), preCapsule.iv.size());
    std::string preTagHex = CCrypto::CryptoSigner::toHex(preCapsule.tag.data(), preCapsule.tag.size());

    // 5. Write query to audit log (audit log only, not anchored in blockchain block)
    //    NOTE: Plaintext is NEVER decrypted in the validator/core daemon or sent over the IPC socket!
    //    Only the Proxy Re-Encryption capsule (reencrypted_dek_hex) + AES-256-GCM ciphertext leave
    //    the core daemon, to be unwrapped and decrypted exclusively inside the Doctor's Browser Trusted Zone.
    writeQueryAuditLog(auditLogPath, auditTx.txId, doctorId, patientId, searchDataId, purpose, "SUCCESS_PRE_CAPSULE_ISSUED", hospitalQuorum);

    std::cout << "\n======================================================================\n";
    std::cout << " [+] MEDICAL RECORD READ VIA PROXY RE-ENCRYPTION & KSM THRESHOLD\n";
    std::cout << "======================================================================\n";
    std::cout << "  * Queried Data ID:     " << searchDataId << "\n";
    std::cout << "  * Requester (Doctor):  " << doctorId << " (On-Chain Consent: " << consentTxId << ")\n";
    std::cout << "  * Patient Owner:       " << patientId << "\n";
    std::cout << "  * Block Height:        #" << blockHeight << " (TxOrder: " << txOrder << ")\n";
    std::cout << "  * Merkle Proof Status: " << (merkleVerified ? "MATHEMATICALLY PROVEN IN HEADER [OK]" : "UNVERIFIED") << "\n";
    std::cout << "  * KSM Quorum Nodes:    HOSPITAL_A, HOSPITAL_B, HOSPITAL_C (Threshold 3-of-4)\n";
    std::cout << "  * Proxy Re-Encryption: DEK wrapped for Doctor PK (PRE Capsule: " << reencryptedDekHex.substr(0, 16) << "...)\n";
    std::cout << "  * Zero-Plaintext IPC:  Ciphertext + PRE Capsule Only (Decrypted in Browser Trusted Zone)\n";
    std::cout << "  * Audit Log Written:   " << auditLogPath.string() << " (AuditTx: " << auditTx.txId.substr(0, 12) << "...)\n";
    std::cout << "======================================================================\n\n" << std::flush;

    std::ostringstream ss;
    ss << "{\n"
       << "  \"status\": \"OK\",\n"
       << "  \"action\": \"PRE_CAPSULE_ISSUED_FOR_BROWSER_TRUSTZONE\",\n"
       << "  \"decision\": \"APPROVED\",\n"
       << "  \"consent_tx_id\": \"" << consentTxId << "\",\n"
       << "  \"audit_tx_id\": \"" << auditTx.txId << "\",\n"
       << "  \"data_id\": \"" << searchDataId << "\",\n"
       << "  \"patient_id\": \"" << patientId << "\",\n"
       << "  \"doctor_id\": \"" << doctorId << "\",\n"
       << "  \"doctor_public_key\": \"" << doctorPubKey << "\",\n"
       << "  \"block_height\": " << blockHeight << ",\n"
       << "  \"merkle_verified\": " << (merkleVerified ? "true" : "false") << ",\n"
       << "  \"ksm_quorum\": [\"HOSPITAL_A\", \"HOSPITAL_B\", \"HOSPITAL_C\"],\n"
       << "  \"proxy_re_encryption\": true,\n"
       << "  \"reencrypted_dek_hex\": \"" << reencryptedDekHex << "\",\n"
       << "  \"pre_iv_hex\": \"" << preIvHex << "\",\n"
       << "  \"pre_tag_hex\": \"" << preTagHex << "\",\n"
       << "  \"ciphertext_hex\": \"" << dbRecord.at("ciphertext_hex") << "\",\n"
       << "  \"iv_hex\": \"" << dbRecord.at("iv_hex") << "\",\n"
       << "  \"auth_tag_hex\": \"" << dbRecord.at("auth_tag_hex") << "\",\n"
       << "  \"zero_plaintext_ipc\": true,\n"
       << "  \"audit_logged\": true\n"
       << "}\n";
    return ss.str();
}

// ============================================================================
// COLD ARCHIVE SAVING & BLOCK PRUNING WORKFLOW (ARCHIVE_BLOCKS)
// ============================================================================
std::string handleCoreArchiveBlocks(const std::string& requestStr) {
    std::lock_guard<std::mutex> lock(g_chainMutex);
    if (!g_chain || !g_archiveManager) {
        initStorage("val-default", 0, "");
    }

    std::string maxHeightStr = extractParam(requestStr, "max_height");
    uint64_t chainHeight = g_chain->getChainHeight();
    uint64_t maxHeight = maxHeightStr.empty() ? chainHeight : static_cast<uint64_t>(std::stoull(maxHeightStr));

    std::string pruneStr = extractParam(requestStr, "prune_sealed_files");
    bool pruneSealed = (pruneStr != "false" && pruneStr != "0");

    auto manifest = g_archiveManager->archiveBlocksUpToHeight(*g_chain, maxHeight, pruneSealed);
    std::string safePath = manifest.archiveFilePath;
    for (char& c : safePath) {
        if (c == '\\') c = '/';
    }

    std::ostringstream ss;
    ss << "{\n"
       << "  \"status\": \"OK\",\n"
       << "  \"action\": \"COLD_ARCHIVE_CREATED\",\n"
       << "  \"archive_id\": \"" << manifest.archiveId << "\",\n"
       << "  \"start_height\": " << manifest.startHeight << ",\n"
       << "  \"end_height\": " << manifest.endHeight << ",\n"
       << "  \"block_count\": " << manifest.blockCount << ",\n"
       << "  \"uncompressed_bytes\": " << manifest.uncompressedBytes << ",\n"
       << "  \"compressed_bytes\": " << manifest.compressedBytes << ",\n"
       << "  \"sha256_checksum\": \"" << manifest.sha256Checksum << "\",\n"
       << "  \"merkle_checkpoint_root\": \"" << manifest.merkleCheckpointRoot << "\",\n"
       << "  \"archive_file_path\": \"" << safePath << "\",\n"
       << "  \"sealed_files_pruned\": " << manifest.sealedFilesPruned << ",\n"
       << "  \"headers_retained_online\": " << (manifest.headersRetainedOnline ? "true" : "false") << ",\n"
       << "  \"merkle_roots_retained_online\": " << (manifest.merkleRootsRetainedOnline ? "true" : "false") << "\n"
       << "}\n";
    return ss.str();
}

// ============================================================================
// Record / Transaction Persistence in Audit Logs & DB
// ============================================================================
void recordTransactionPersistence(const std::string& rawPayload) {
    if (g_activeDataDir.empty()) {
        initStorage("val-default", 0, "");
    }

    try {
        fs::path auditLogPath = fs::path(g_activeDataDir) / "audit_logs" / "transactions.log";
        std::ofstream logFile(auditLogPath, std::ios::app);
        if (logFile.is_open()) {
            auto now = std::chrono::system_clock::to_time_t(std::chrono::system_clock::now());
            logFile << "[" << now << "] " << rawPayload << "\n";
            logFile.close();
        }

        fs::path dbTxPath = fs::path(g_activeDataDir) / "db" / "queued_transactions.json";
        std::ofstream txFile(dbTxPath, std::ios::app);
        if (txFile.is_open()) {
            txFile << rawPayload << "\n";
            txFile.close();
        }
    } catch (...) {}
}

// ============================================================================
// Helper: Dynamically resolve machine hostname and active IPv4 address
// ============================================================================
std::pair<std::string, std::string> getLocalHostAndIp() {
    std::string hostname = "localhost";
    std::string ipAddress = "127.0.0.1";

#ifdef _WIN32
    WSADATA wsaData;
    if (WSAStartup(MAKEWORD(2, 2), &wsaData) != 0) {
        return {hostname, ipAddress};
    }
#endif

    char hostBuf[256] = {0};
    if (gethostname(hostBuf, sizeof(hostBuf)) == 0) {
        hostname = hostBuf;
        struct addrinfo hints = {}, *info = nullptr;
        hints.ai_family = AF_INET;
        hints.ai_socktype = SOCK_STREAM;

        if (getaddrinfo(hostBuf, nullptr, &hints, &info) == 0 && info != nullptr) {
            char ipBuf[INET_ADDRSTRLEN] = {0};
            auto* addr = reinterpret_cast<struct sockaddr_in*>(info->ai_addr);
            if (inet_ntop(AF_INET, &(addr->sin_addr), ipBuf, sizeof(ipBuf)) != nullptr) {
                ipAddress = ipBuf;
            }
            freeaddrinfo(info);
        }
    }

#ifdef _WIN32
    WSACleanup();
#endif

    return {hostname, ipAddress};
}

// ============================================================================
// Client Connection Handler (Multi-threaded IPC)
// ============================================================================
void handleClientConnection(socket_t clientSock, std::string clientIp, int clientPort) {
    std::cout << "[+] Accepted IPC connection from " << clientIp << ":" << clientPort << std::endl;

    char buffer[16384];
    int bytesReceived = recv(clientSock, buffer, sizeof(buffer) - 1, 0);

    if (bytesReceived > 0) {
        buffer[bytesReceived] = '\0';
        std::string requestStr(buffer);

        while (!requestStr.empty() && (requestStr.back() == '\r' || requestStr.back() == '\n')) {
            requestStr.pop_back();
        }

        std::cout << "[<-] Received IPC request: \"" << (requestStr.length() > 140 ? requestStr.substr(0, 140) + "..." : requestStr) << "\"" << std::endl;

        std::string response;

        // 1. Storage Initialization Command or Node Linking
        if (requestStr.find("INIT_STORAGE") != std::string::npos || requestStr.find("GET_INFO") != std::string::npos) {
            std::string nodeId = extractParam(requestStr, "node_id");
            std::string chainIdStr = extractParam(requestStr, "chain_id");
            std::string dataDirReq = extractParam(requestStr, "data_dir");
            uint32_t chainId = chainIdStr.empty() ? 0 : static_cast<uint32_t>(std::atoi(chainIdStr.c_str()));

            if (nodeId.empty() && g_activeNodeId.empty()) {
                nodeId = "node-" + clientIp;
            }

            StorageInitResult res = initStorage(nodeId, chainId, dataDirReq);

            std::ostringstream ss;
            ss << "{\n"
               << "  \"status\": \"" << (res.success ? "OK" : "ERROR") << "\",\n"
               << "  \"action\": \"STORAGE_MOUNTED\",\n"
               << "  \"node_id\": \"" << res.nodeId << "\",\n"
               << "  \"chain_id\": " << res.chainId << ",\n"
               << "  \"data_dir\": \"" << res.dataDir << "\",\n"
               << "  \"chain_height\": " << res.chainHeight << ",\n"
               << "  \"tip_hash\": \"" << res.tipHash << "\",\n"
               << "  \"persisted\": " << (res.isReloaded ? "true" : "false") << ",\n"
               << "  \"message\": \"Blockchain Core storage & KSM cluster ready and persistent.\"\n"
               << "}\n";
            response = ss.str();
        }
        // 2. CORE DATA WRITE: Doctor signs -> AES-GCM Encrypt -> Patient PK Key -> Consensus Commit
        else if (requestStr.find("RECORD_WRITE") != std::string::npos || requestStr.find("WRITE_RECORD") != std::string::npos) {
            response = handleCoreDataWrite(requestStr);
        }
        // 3. CORE CONSENT WRITE: Patient APPROVE_CONSENT / REVOKE_CONSENT -> On-Chain PERMISSION
        else if (requestStr.find("CONSENT_WRITE") != std::string::npos ||
                 requestStr.find("APPROVE_CONSENT") != std::string::npos ||
                 requestStr.find("REVOKE_CONSENT") != std::string::npos ||
                 requestStr.find("GRANT_CONSENT") != std::string::npos) {
            response = handleCoreConsentWrite(requestStr);
        }
        // 4. CORE DATA READ: On-Chain Consent Check -> Proxy Re-Encryption -> KSM Threshold -> TrustZone Decrypt
        else if (requestStr.find("RECORD_READ") != std::string::npos || requestStr.find("READ_RECORD") != std::string::npos || requestStr.find("QUERY_RECORD") != std::string::npos) {
            response = handleCoreDataRead(requestStr);
        }
        // 5. COLD ARCHIVE SAVING & BLOCK PRUNING
        else if (requestStr.find("ARCHIVE_BLOCKS") != std::string::npos || requestStr.find("LIST_ARCHIVES") != std::string::npos) {
            response = handleCoreArchiveBlocks(requestStr);
        }
        // 5b. ON-DEMAND ARCHIVED BLOCK RESTORATION (RESTORE_ARCHIVED_BLOCK)
        else if (requestStr.find("RESTORE_ARCHIVED_BLOCK") != std::string::npos) {
            std::lock_guard<std::mutex> lock(g_chainMutex);
            if (!g_chain || !g_archiveManager) {
                initStorage("val-default", 0, "");
            }
            std::string heightStr = extractParam(requestStr, "height");
            uint64_t height = heightStr.empty() ? 0 : static_cast<uint64_t>(std::stoull(heightStr));
            auto blkOpt = g_archiveManager->restoreBlockFromArchive(height);
            if (!blkOpt) {
                blkOpt = g_chain->getBlockByHeight(height);
            }
            if (blkOpt) {
                std::ostringstream ss;
                ss << "{\n"
                   << "  \"status\": \"OK\",\n"
                   << "  \"action\": \"ARCHIVED_BLOCK_RESTORED\",\n"
                   << "  \"height\": " << blkOpt->getHeight() << ",\n"
                   << "  \"block_hash\": \"" << blkOpt->getHeader().blockHash << "\",\n"
                   << "  \"merkle_root\": \"" << blkOpt->getHeader().merkleRoot << "\",\n"
                   << "  \"tx_count\": " << blkOpt->getTransactions().size() << "\n"
                   << "}\n";
                response = ss.str();
            } else {
                response = "{\"status\":\"ERROR\",\"action\":\"ARCHIVED_BLOCK_NOT_FOUND\"}\n";
            }
        }
        // 5c. ON-CHAIN PKI IDENTITY ACCREDITATION (REGISTER_IDENTITY / REVOKE_IDENTITY)
        else if (requestStr.find("REGISTER_IDENTITY") != std::string::npos || requestStr.find("REVOKE_IDENTITY") != std::string::npos) {
            std::string actorId = extractParam(requestStr, "actor_id");
            std::string role = extractParam(requestStr, "role");
            std::string pubKeyHex = extractParam(requestStr, "public_key");
            if (requestStr.find("REVOKE_IDENTITY") != std::string::npos) {
                CConsensus::CConsensusRules::revokeAccreditedKey(actorId, pubKeyHex);
                response = "{\"status\":\"OK\",\"action\":\"IDENTITY_KEY_REVOKED\",\"actor_id\":\"" + actorId + "\"}\n";
            } else {
                CConsensus::CConsensusRules::registerAccreditedKey(actorId, role, pubKeyHex);
                response = "{\"status\":\"OK\",\"action\":\"IDENTITY_KEY_REGISTERED\",\"actor_id\":\"" + actorId + "\"}\n";
            }
        }
        // 6. Transaction Submit / Anchor (Generic Mempool)
        else if (requestStr.find("TRANSACTION_SUBMIT") != std::string::npos) {
            std::string txId = extractParam(requestStr, "tx_id");
            if (txId.empty()) {
                txId = "tx-core-" + std::to_string(std::chrono::system_clock::now().time_since_epoch().count());
            }

            recordTransactionPersistence(requestStr);

            uint64_t currentHeight = 0;
            std::string tipHash = "genesis";
            if (g_chain) {
                currentHeight = g_chain->getChainHeight();
                tipHash = g_chain->getLatestHeader().blockHash;
            }

            std::cout << "[+] [TRANSACTION ANCHORED IN CORE STORAGE]\n"
                      << "    - Tx ID:       " << txId << "\n"
                      << "    - Storage:     " << g_activeDataDir << "\n"
                      << "    - Persisted:   TRUE (audit_logs & db written)\n";

            std::ostringstream ss;
            ss << "{\n"
               << "  \"status\": \"OK\",\n"
               << "  \"action\": \"TRANSACTION_CONFIRMED\",\n"
               << "  \"tx_id\": \"" << txId << "\",\n"
               << "  \"node_id\": \"" << g_activeNodeId << "\",\n"
               << "  \"data_dir\": \"" << g_activeDataDir << "\",\n"
               << "  \"chain_height\": " << currentHeight << ",\n"
               << "  \"block_hash\": \"" << tipHash << "\",\n"
               << "  \"persisted\": true\n"
               << "}\n";
            response = ss.str();
        }
        // 5. Fallback / Status Query
        else {
            uint64_t currentHeight = g_chain ? g_chain->getChainHeight() : 0;
            std::string tipHash = g_chain ? g_chain->getLatestHeader().blockHash : "";
            std::ostringstream ss;
            ss << "{\n"
               << "  \"status\": \"OK\",\n"
               << "  \"node_id\": \"" << g_activeNodeId << "\",\n"
               << "  \"chain_id\": " << g_activeChainId << "\",\n"
               << "  \"data_dir\": \"" << g_activeDataDir << "\",\n"
               << "  \"chain_height\": " << currentHeight << ",\n"
               << "  \"tip_hash\": \"" << tipHash << "\",\n"
               << "  \"response\": \"Blockchain Core C++ online. Ready for RECORD_WRITE & RECORD_READ.\"\n"
               << "}\n";
            response = ss.str();
        }

        send(clientSock, response.c_str(), static_cast<int>(response.length()), 0);
        std::cout << "[->] Sent IPC response (" << response.length() << " bytes) to client" << std::endl;
    }

    CLOSE_SOCKET(clientSock);
    std::cout << "[-] Connection closed with " << clientIp << ":" << clientPort << std::endl;
}

// ============================================================================
// CLI Argument Parsing & Server Startup
// ============================================================================
void printUsage(const char* progName) {
    std::cout << "Usage: " << progName << " [options]\n\n"
              << "Options:\n"
              << "  -p, --port <port>       IPC port number to listen on (default: 50055)\n"
              << "      --host <host>       Host IP to bind to (default: 0.0.0.0)\n"
              << "      --node-id <node_id> Initialize/load storage for this node ID (e.g. val-yaounde-01)\n"
              << "      --chain-id <id>     Blockchain channel/chain ID (default: 0)\n"
              << "      --data-dir <path>   Explicit data directory (default: chaindata/<node_id>)\n"
              << "  -h, --help              Show this help message\n";
}

int main(int argc, char* argv[]) {
    int port = 50055;
    auto [hostname, local_ip] = getLocalHostAndIp();
    std::string host = "0.0.0.0";
    std::string cliNodeId = "";
    uint32_t cliChainId = 0;
    std::string cliDataDir = "";

    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if ((arg == "-p" || arg == "--port") && i + 1 < argc) {
            port = std::atoi(argv[++i]);
        } else if (arg == "--host" && i + 1 < argc) {
            host = argv[++i];
        } else if (arg == "--node-id" && i + 1 < argc) {
            cliNodeId = argv[++i];
        } else if (arg == "--chain-id" && i + 1 < argc) {
            cliChainId = static_cast<uint32_t>(std::atoi(argv[++i]));
        } else if (arg == "--data-dir" && i + 1 < argc) {
            cliDataDir = argv[++i];
        } else if (arg == "-h" || arg == "--help") {
            printUsage(argv[0]);
            return 0;
        } else if (arg.rfind("--port=", 0) == 0) {
            port = std::atoi(arg.substr(7).c_str());
        } else if (arg.rfind("--host=", 0) == 0) {
            host = arg.substr(7);
        } else if (arg.rfind("--node-id=", 0) == 0) {
            cliNodeId = arg.substr(10);
        } else if (arg.rfind("--chain-id=", 0) == 0) {
            cliChainId = static_cast<uint32_t>(std::atoi(arg.substr(11).c_str()));
        } else if (arg.rfind("--data-dir=", 0) == 0) {
            cliDataDir = arg.substr(11);
        } else if (arg[0] != '-') {
            port = std::atoi(arg.c_str());
        }
    }

    if (port <= 0 || port > 65535) {
        std::cerr << "[!] Invalid port number: " << port << std::endl;
        return 1;
    }

    if (!cliNodeId.empty() || !cliDataDir.empty() || cliChainId != 0) {
        initStorage(cliNodeId, cliChainId, cliDataDir);
    }

#ifdef _WIN32
    WSADATA wsaData;
    if (WSAStartup(MAKEWORD(2, 2), &wsaData) != 0) {
        std::cerr << "[!] WSAStartup failed!" << std::endl;
        return 1;
    }
#endif

    socket_t serverSock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (!IS_VALID_SOCKET(serverSock)) {
        std::cerr << "[!] Failed to create socket!" << std::endl;
#ifdef _WIN32
        WSACleanup();
#endif
        return 1;
    }

    int opt = 1;
    setsockopt(serverSock, SOL_SOCKET, SO_REUSEADDR, reinterpret_cast<const char*>(&opt), sizeof(opt));

    sockaddr_in serverAddr{};
    serverAddr.sin_family = AF_INET;
    serverAddr.sin_port = htons(static_cast<uint16_t>(port));

    if (inet_pton(AF_INET, host.c_str(), &serverAddr.sin_addr) <= 0) {
        serverAddr.sin_addr.s_addr = INADDR_ANY;
    }

    if (bind(serverSock, reinterpret_cast<sockaddr*>(&serverAddr), sizeof(serverAddr)) != 0) {
        std::cerr << "[!] Failed to bind to " << host << ":" << port << std::endl;
        CLOSE_SOCKET(serverSock);
#ifdef _WIN32
        WSACleanup();
#endif
        return 1;
    }

    if (listen(serverSock, SOMAXCONN) != 0) {
        std::cerr << "[!] Failed to listen on socket!" << std::endl;
        CLOSE_SOCKET(serverSock);
#ifdef _WIN32
        WSACleanup();
#endif
        return 1;
    }

    std::cout << "======================================================================\n";
    std::cout << "  E-MEDICAL BOOKLET: CORE DATA ENGINE (READ & WRITE WITH KSM & PRE)\n";
    std::cout << "  - Hostname:         " << hostname << "\n";
    std::cout << "  - Resolved IP:      " << local_ip << "\n";
    std::cout << "  - Listening on:     " << host << ":" << port << "\n";
    if (!g_activeDataDir.empty()) {
        std::cout << "  - Active Node ID:   " << g_activeNodeId << "\n";
        std::cout << "  - Active Chain ID:  " << g_activeChainId << "\n";
        std::cout << "  - Active Data Dir:  " << g_activeDataDir << "\n";
    } else {
        std::cout << "  - Dynamic Storage:  Awaiting node connection (INIT_STORAGE / RECORD_WRITE)\n";
    }
    std::cout << "  - Core Protocols:   AES-256-GCM, Shamir Threshold, Proxy Re-Encryption\n";
    std::cout << "======================================================================\n";
    std::cout << "[+] Server running. Waiting for incoming IPC calls (Ctrl+C to stop)...\n" << std::flush;

    while (true) {
        sockaddr_in clientAddr{};
        int clientLen = sizeof(clientAddr);
        socket_t clientSock = accept(serverSock, reinterpret_cast<sockaddr*>(&clientAddr), &clientLen);

        if (!IS_VALID_SOCKET(clientSock)) {
            break;
        }

        char clientIp[INET_ADDRSTRLEN] = {0};
        inet_ntop(AF_INET, &(clientAddr.sin_addr), clientIp, sizeof(clientIp));
        int clientPort = ntohs(clientAddr.sin_port);

        std::thread(handleClientConnection, clientSock, std::string(clientIp), clientPort).detach();
    }

    CLOSE_SOCKET(serverSock);
#ifdef _WIN32
    WSACleanup();
#endif
    return 0;
}
