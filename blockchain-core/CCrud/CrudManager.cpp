#include "CrudManager.h"
#include "CChannel/CChannelManager.h"
#include <iostream>
#include <sstream>

#ifdef DELETE
#undef DELETE
#endif

namespace CCrud {

CrudManager::CrudManager(CChain& chain, CKsm::KsmCluster& ksmCluster)
    : m_chain(chain), m_ksmCluster(ksmCluster) {}

bool CrudManager::verifySignersMatchOriginal(const std::string& targetDataId,
                                            const std::string& doctorId,
                                            const std::string& doctorPublicKey,
                                            const std::string& patientId,
                                            const std::string& patientPublicKey,
                                            std::string& outError) {
    auto recOpt = m_chain.getRecordStorage().retrieveRecord("CREATE_EHR_RECORD", targetDataId);
    if (!recOpt) {
        recOpt = m_chain.getRecordStorage().retrieveRecord("EHR_RECORD", targetDataId);
    }
    if (!recOpt) {
        outError = "Target record ID not found in database: " + targetDataId;
        return false;
    }

    const auto& orig = *recOpt;
    std::string origDoctor = orig.count("doctor_id") ? orig.at("doctor_id") : "";
    std::string origPatient = orig.count("patient_id") ? orig.at("patient_id") : "";
    std::string origDoctorPubKey = orig.count("doctor_public_key") ? orig.at("doctor_public_key") : "";
    std::string origPatientPubKey = orig.count("patient_public_key") ? orig.at("patient_public_key") : "";

    // Creator match: doctor must match
    if (!origDoctor.empty() && doctorId != origDoctor && doctorPublicKey != origDoctor) {
        outError = "Signer mismatch: Primary creator (" + origDoctor + ") does not match candidate (" + doctorId + ")";
        return false;
    }
    if (!origDoctorPubKey.empty() && !doctorPublicKey.empty() && doctorPublicKey != origDoctorPubKey) {
        outError = "Signer mismatch: Doctor public key does not match creator";
        return false;
    }

    // Co-signer match: patient must match
    if (!origPatient.empty() && !patientId.empty() && patientId != origPatient && patientPublicKey != origPatient) {
        outError = "Signer mismatch: Patient co-signer (" + origPatient + ") does not match candidate (" + patientId + ")";
        return false;
    }
    if (!origPatientPubKey.empty() && !patientPublicKey.empty() && patientPublicKey != origPatientPubKey) {
        outError = "Signer mismatch: Patient public key does not match creator";
        return false;
    }

    return true;
}

std::string CrudManager::createRecord(const CreateRecordRequest& req,
                                     std::string& outTxId,
                                     std::string& outError) {
    if (req.patientId.empty() || req.doctorId.empty()) {
        outError = "Patient ID and Doctor ID cannot be empty";
        return "";
    }
    if (req.doctorKeyPair.privateKeyHex.empty() || req.patientKeyPair.privateKeyHex.empty()) {
        outError = "Both Doctor signature and Patient co-signature private keys are required";
        return "";
    }

    // Cross-channel identity verification: Check if Doctor and Patient are active on Channel 1 (Registration Chain)
    if (m_channelManager) {
        if (!m_channelManager->isDoctorActive(req.doctorId)) {
            outError = "Cross-Channel Verification Failed: Doctor '" + req.doctorId + "' is not registered or active on Channel 1 (Registration Chain).";
            return "";
        }
        if (!m_channelManager->isPatientActive(req.patientId)) {
            outError = "Cross-Channel Verification Failed: Patient '" + req.patientId + "' is not registered or active on Channel 1 (Registration Chain).";
            return "";
        }
    }

    // 1. Threshold Encryption via KMS:
    // Splits cleartext body, generates 256-bit DEK, splits into 3-of-4 shares for hospitals,
    // stores in hospital node SQLite stores, encrypts body with AES-256-GCM, and wipes DEK.
    CKsm::EncryptedTxEnvelope envelope;
    try {
        envelope = m_ksmCluster.encryptRecord(
            req.schemaName,
            req.clinicalFields,
            "DOCTOR",
            req.doctorKeyPair.address,
            req.doctorKeyPair.publicKeyHex,
            ""
        );
    } catch (const std::exception& ex) {
        outError = std::string("KMS Encryption failed: ") + ex.what();
        return "";
    }

    std::string dataId = "REC-" + envelope.metadata.txId.substr(0, 16);

    // 2. Build On-Chain Transaction:
    // Signed by Doctor AND Co-Signed by Patient
    CTransaction tx;
    tx.schemaType = req.schemaName;
    tx.senderId = req.doctorId;
    tx.senderPublicKey = req.doctorKeyPair.publicKeyHex;
    tx.signerType = CSchemaDef::SignerType::DOCTOR;
    tx.timestamp = std::time(nullptr);

    // Populate transaction payload with encrypted ciphertext and metadata
    tx.setField("target_data_id", dataId);
    tx.setField("data_id", dataId);
    tx.setField("patient_id", req.patientId);
    tx.setField("doctor_id", req.doctorId);
    tx.setField("doctor_public_key", req.doctorKeyPair.publicKeyHex);
    tx.setField("patient_public_key", req.patientKeyPair.publicKeyHex);
    tx.setField("ksm_tx_id", envelope.metadata.txId);
    tx.setField("ciphertext_hex", CCrypto::CryptoSigner::toHex(envelope.encryptedBody.ciphertext.data(), envelope.encryptedBody.ciphertext.size()));
    tx.setField("iv_hex", CCrypto::CryptoSigner::toHex(envelope.encryptedBody.iv.data(), envelope.encryptedBody.iv.size()));
    tx.setField("auth_tag_hex", CCrypto::CryptoSigner::toHex(envelope.encryptedBody.tag.data(), envelope.encryptedBody.tag.size()));
    tx.setField("body_data_hash", envelope.metadata.bodyDataHash);
    tx.setField("version", "1");
    tx.setField("is_deleted", "0");
    tx.setField("operation", "CREATE");

    // Copy clinical schema field names for schema validator acceptance
    for (const auto& [k, v] : req.clinicalFields) {
        if (k != "patient_id" && k != "doctor_id" && k != "target_data_id" && k != "data_id") {
            tx.setField(k, "[ENCRYPTED_FIELD]");
        }
    }

    // Sign with Doctor's private key
    tx.sign(req.doctorKeyPair.privateKeyHex, req.doctorKeyPair.publicKeyHex);

    // Add Patient co-signature
    tx.addCoSignature(req.patientId, req.patientKeyPair.privateKeyHex, req.patientKeyPair.publicKeyHex);

    // 3. Add to Blockchain Mempool & Commit to Block
    auto addRes = m_chain.addTransaction(tx);
    if (!addRes) {
        outError = "Mempool rejection: " + addRes.toString();
        return "";
    }

    CBlock proposed = m_chain.proposeBlock(req.doctorId);
    auto commitRes = m_chain.commitBlock(proposed);
    if (!commitRes) {
        outError = "Commit rejection: " + commitRes.toString();
        return "";
    }

    outTxId = tx.txId;
    std::cout << "[CRUD CREATE] Record " << dataId << " committed in Block #"
              << proposed.getHeight() << " (TxID: " << outTxId.substr(0, 12) << "...)\n";

    return dataId;
}

bool CrudManager::editRecord(const EditRecordRequest& req,
                             std::string& outTxId,
                             std::string& outError) {
    if (req.targetDataId.empty()) {
        outError = "targetDataId cannot be empty";
        return false;
    }

    // 1. Fetch original record from off-chain database
    auto origOpt = m_chain.getRecordStorage().retrieveRecord("CREATE_EHR_RECORD", req.targetDataId);
    if (!origOpt) {
        origOpt = m_chain.getRecordStorage().retrieveRecord("EHR_RECORD", req.targetDataId);
    }
    if (!origOpt) {
        outError = "Target record ID " + req.targetDataId + " not found in database";
        return false;
    }
    const auto& orig = *origOpt;

    std::string origDoctor = orig.count("doctor_id") ? orig.at("doctor_id") : "";
    std::string origPatient = orig.count("patient_id") ? orig.at("patient_id") : "";
    std::string candidateDoctor = origDoctor.empty() ? req.doctorKeyPair.address : origDoctor;
    std::string candidatePatient = req.patientId.empty() ? origPatient : req.patientId;

    if (m_channelManager) {
        if (!m_channelManager->isDoctorActive(candidateDoctor)) {
            outError = "Cross-Channel Verification Failed: Doctor '" + candidateDoctor + "' is not active on Channel 1 (Registration Chain).";
            return false;
        }
        if (!m_channelManager->isPatientActive(candidatePatient)) {
            outError = "Cross-Channel Verification Failed: Patient '" + candidatePatient + "' is not active on Channel 1 (Registration Chain).";
            return false;
        }
    }

    if (!verifySignersMatchOriginal(req.targetDataId, candidateDoctor, req.doctorKeyPair.publicKeyHex,
                                   candidatePatient, req.patientKeyPair.publicKeyHex, outError)) {
        return false;
    }

    // 3. Encrypt updated clinical body with new DEK generated via KMS DKG
    CKsm::EncryptedTxEnvelope envelope;
    try {
        envelope = m_ksmCluster.encryptRecord(
            "EDIT_EHR_RECORD",
            req.updatedClinicalFields,
            "DOCTOR",
            req.doctorKeyPair.address,
            req.doctorKeyPair.publicKeyHex,
            ""
        );
    } catch (const std::exception& ex) {
        outError = std::string("KMS Encryption failed: ") + ex.what();
        return false;
    }

    uint32_t currentVer = orig.count("version") ? std::stoul(orig.at("version")) : 1;
    std::string nextVer = std::to_string(currentVer + 1);

    // 4. Build EDIT transaction
    CTransaction tx;
    tx.schemaType = "EDIT_EHR_RECORD";
    tx.senderId = candidateDoctor;
    tx.senderPublicKey = req.doctorKeyPair.publicKeyHex;
    tx.signerType = CSchemaDef::SignerType::DOCTOR;
    tx.timestamp = std::time(nullptr);

    // Pre-defined EDIT metadata:
    // target_data_id, target_block_height, target_tx_id, edit_reason
    tx.setField("target_data_id", req.targetDataId);
    tx.setField("target_block_height", orig.at("block_height"));
    tx.setField("target_tx_id", orig.count("tx_id") ? orig.at("tx_id") : "NONE");
    tx.setField("patient_id", candidatePatient);
    tx.setField("doctor_id", candidateDoctor);
    tx.setField("edit_reason", req.editReason);
    tx.setField("ksm_tx_id", envelope.metadata.txId);
    tx.setField("ciphertext_hex", CCrypto::CryptoSigner::toHex(envelope.encryptedBody.ciphertext.data(), envelope.encryptedBody.ciphertext.size()));
    tx.setField("iv_hex", CCrypto::CryptoSigner::toHex(envelope.encryptedBody.iv.data(), envelope.encryptedBody.iv.size()));
    tx.setField("auth_tag_hex", CCrypto::CryptoSigner::toHex(envelope.encryptedBody.tag.data(), envelope.encryptedBody.tag.size()));
    tx.setField("body_data_hash", envelope.metadata.bodyDataHash);
    tx.setField("version", nextVer);
    tx.setField("is_deleted", "0");
    tx.setField("operation", "EDIT");

    // Copy clinical schema field names for schema validator acceptance
    for (const auto& [k, v] : req.updatedClinicalFields) {
        if (k != "patient_id" && k != "doctor_id" && k != "target_data_id" && k != "data_id") {
            tx.setField(k, "[UPDATED_ENCRYPTED_FIELD]");
        }
    }

    // Sign with Doctor key
    tx.sign(req.doctorKeyPair.privateKeyHex, req.doctorKeyPair.publicKeyHex);

    // Patient co-signs the modification
    tx.addCoSignature(candidatePatient, req.patientKeyPair.privateKeyHex, req.patientKeyPair.publicKeyHex);

    // 5. Add to mempool & commit in a NEW BLOCK (previous block is 100% immutable!)
    auto addRes = m_chain.addTransaction(tx);
    if (!addRes) {
        outError = "Mempool rejection: " + addRes.toString();
        return false;
    }

    CBlock proposed = m_chain.proposeBlock(candidateDoctor);
    auto commitRes = m_chain.commitBlock(proposed);
    if (!commitRes) {
        outError = "Commit rejection: " + commitRes.toString();
        return false;
    }

    outTxId = tx.txId;
    std::cout << "[CRUD EDIT] Record " << req.targetDataId << " updated to version "
              << nextVer << " in NEW Block #" << proposed.getHeight()
              << " (Previous Block #" << orig.at("block_height") << " remains completely immutable!)\n";

    return true;
}

bool CrudManager::deleteRecord(const DeleteRecordRequest& req,
                               std::string& outTxId,
                               std::string& outError) {
    if (req.targetDataId.empty()) {
        outError = "targetDataId cannot be empty";
        return false;
    }

    // 1. Fetch original record from off-chain database
    auto origOpt = m_chain.getRecordStorage().retrieveRecord("CREATE_EHR_RECORD", req.targetDataId);
    if (!origOpt) {
        origOpt = m_chain.getRecordStorage().retrieveRecord("EHR_RECORD", req.targetDataId);
    }
    if (!origOpt) {
        outError = "Target record ID " + req.targetDataId + " not found in database";
        return false;
    }
    const auto& orig = *origOpt;

    std::string origDoctor = orig.count("doctor_id") ? orig.at("doctor_id") : "";
    std::string origPatient = orig.count("patient_id") ? orig.at("patient_id") : "";
    std::string candidateDoctor = origDoctor.empty() ? req.doctorKeyPair.address : origDoctor;
    std::string candidatePatient = req.patientId.empty() ? origPatient : req.patientId;

    if (m_channelManager) {
        if (!m_channelManager->isDoctorActive(candidateDoctor)) {
            outError = "Cross-Channel Verification Failed: Doctor '" + candidateDoctor + "' is not active on Channel 1 (Registration Chain).";
            return false;
        }
        if (!m_channelManager->isPatientActive(candidatePatient)) {
            outError = "Cross-Channel Verification Failed: Patient '" + candidatePatient + "' is not active on Channel 1 (Registration Chain).";
            return false;
        }
    }

    if (!verifySignersMatchOriginal(req.targetDataId, candidateDoctor, req.doctorKeyPair.publicKeyHex,
                                   candidatePatient, req.patientKeyPair.publicKeyHex, outError)) {
        return false;
    }

    // 3. Build DELETE transaction with pre-defined info:
    // target_block_height, target_data_id, target_tx_id, deletion_reason
    std::string origBlockHeight = orig.count("block_height") ? orig.at("block_height") : "0";
    std::string origTxId = orig.count("tx_id") ? orig.at("tx_id") : "NONE";

    CTransaction tx;
    tx.schemaType = "DELETE_EHR_RECORD";
    tx.senderId = candidateDoctor;
    tx.senderPublicKey = req.doctorKeyPair.publicKeyHex;
    tx.signerType = CSchemaDef::SignerType::DOCTOR;
    tx.timestamp = std::time(nullptr);

    tx.setField("target_data_id", req.targetDataId);
    tx.setField("target_block_height", origBlockHeight);
    tx.setField("target_tx_id", origTxId);
    tx.setField("patient_id", candidatePatient);
    tx.setField("doctor_id", candidateDoctor);
    tx.setField("deletion_reason", req.deletionReason);

    // Sign with Doctor key
    tx.sign(req.doctorKeyPair.privateKeyHex, req.doctorKeyPair.publicKeyHex);

    // Patient co-signs deletion
    tx.addCoSignature(candidatePatient, req.patientKeyPair.privateKeyHex, req.patientKeyPair.publicKeyHex);

    // 4. Add to mempool & commit in a NEW BLOCK (previous blocks are 100% immutable!)
    auto addRes = m_chain.addTransaction(tx);
    if (!addRes) {
        outError = "Mempool rejection: " + addRes.toString();
        return false;
    }

    CBlock proposed = m_chain.proposeBlock(candidateDoctor);
    auto commitRes = m_chain.commitBlock(proposed);
    if (!commitRes) {
        outError = "Commit rejection: " + commitRes.toString();
        return false;
    }

    outTxId = tx.txId;
    std::cout << "[CRUD DELETE] Record " << req.targetDataId
              << " marked deleted in off-chain DB, deletion transaction anchored in NEW Block #"
              << proposed.getHeight() << " (Past blocks unchanged!)\n";

    return true;
}

QueryRecordResponse CrudManager::queryRecord(const QueryRecordRequest& req) {
    QueryRecordResponse resp;
    resp.dataId = req.targetDataId;

    // STEP 1: Fetch data first from the off-chain database
    auto dbRecOpt = m_chain.getRecordStorage().retrieveRecord("CREATE_EHR_RECORD", req.targetDataId);
    if (!dbRecOpt) {
        dbRecOpt = m_chain.getRecordStorage().retrieveRecord("EHR_RECORD", req.targetDataId);
    }
    if (!dbRecOpt) {
        resp.status = QueryStatus::RECORD_NOT_FOUND;
        resp.statusMessage = "Record ID not found in off-chain database";
        return resp;
    }

    const auto& dbRec = *dbRecOpt;

    // STEP 2: Display Filtering
    // Filter at display to know which data is up to date
    bool isDeleted = (dbRec.count("is_deleted") && dbRec.at("is_deleted") == "1");
    resp.isDeleted = isDeleted;
    if (isDeleted) {
        resp.deletionReason = dbRec.count("deletion_reason") ? dbRec.at("deletion_reason") : "Deleted";
        resp.deletionBlock = dbRec.count("deletion_block") ? std::stoull(dbRec.at("deletion_block")) : 0;

        if (!req.includeDeleted) {
            resp.status = QueryStatus::FILTERED_DELETED;
            resp.statusMessage = "Record was deleted in Block #" + std::to_string(resp.deletionBlock) +
                                 " (Reason: " + resp.deletionReason + ") - Filtered at display.";
            return resp;
        }
    }

    resp.blockHeight = dbRec.count("block_height") ? std::stoull(dbRec.at("block_height")) : 0;
    resp.txOrder = dbRec.count("tx_order") ? std::stoul(dbRec.at("tx_order")) : 0;
    resp.txId = dbRec.count("tx_id") ? dbRec.at("tx_id") : "";
    resp.version = dbRec.count("version") ? std::stoul(dbRec.at("version")) : 1;

    // STEP 3: Retrieve the block's Merkle tree (from 2GB RAM LRU cache or disk)
    auto treeOpt = m_chain.getMerkleStore().getTree(resp.blockHeight);
    if (!treeOpt) {
        resp.status = QueryStatus::MERKLE_PROOF_FAILED;
        resp.statusMessage = "Merkle tree not found for Block #" + std::to_string(resp.blockHeight);
        return resp;
    }

    // STEP 4: Generate Merkle inclusion proof for tx_order (sibling hashes path)
    CMerkle::MerkleProof proof = treeOpt->getProof(resp.txOrder);
    resp.merkleProof = proof;

    // STEP 5: Verify Merkle proof against Block Header root
    auto headerOpt = m_chain.getHeaderByHeight(resp.blockHeight);
    if (!headerOpt) {
        resp.status = QueryStatus::MERKLE_PROOF_FAILED;
        resp.statusMessage = "Block header not found for Block #" + std::to_string(resp.blockHeight);
        return resp;
    }
    resp.expectedMerkleRoot = headerOpt->merkleRoot;

    bool proofValid = proof.verify(headerOpt->merkleRoot);
    resp.merkleProofVerified = proofValid;
    if (!proofValid) {
        resp.status = QueryStatus::MERKLE_PROOF_FAILED;
        resp.statusMessage = "Cryptographic Merkle inclusion proof FAILED against block header root!";
        return resp;
    }

    // STEP 6: Cryptographic Tamper Verification:
    // Verify that the on-chain committed dataHash matches the DB record dataHash
    auto blockOpt = m_chain.getBlockByHeight(resp.blockHeight);
    if (!blockOpt || resp.txOrder >= blockOpt->getTransactionCount()) {
        resp.status = QueryStatus::TAMPER_DETECTED;
        resp.statusMessage = "On-chain transaction index invalid";
        return resp;
    }
    const auto& onChainTx = blockOpt->getTransactions()[resp.txOrder];
    std::string dbDataHash = dbRec.count("data_hash") ? dbRec.at("data_hash") : "";

    if (onChainTx.dataHash != dbDataHash || onChainTx.calculateHash() != proof.leafHash) {
        resp.status = QueryStatus::TAMPER_DETECTED;
        resp.statusMessage = "Tamper detected! DB record hash does not match immutable on-chain record!";
        return resp;
    }

    // STEP 7: Reconstruct encrypted envelope and send for threshold KMS decryption
    CKsm::EncryptedTxEnvelope envelope;
    envelope.metadata.txId = dbRec.count("ksm_tx_id") ? dbRec.at("ksm_tx_id") : onChainTx.txId;
    envelope.metadata.schemaType = onChainTx.schemaType;
    envelope.metadata.patientId = onChainTx.patientId;
    envelope.metadata.doctorId = onChainTx.doctorId;
    envelope.metadata.bodyDataHash = dbRec.count("body_data_hash") ? dbRec.at("body_data_hash") : "";
    envelope.metadata.thresholdT = 3;
    envelope.metadata.totalN = 4;

    std::string cipherHex = dbRec.count("ciphertext_hex") ? dbRec.at("ciphertext_hex") : "";
    std::string ivHex = dbRec.count("iv_hex") ? dbRec.at("iv_hex") : "";
    std::string tagHex = dbRec.count("auth_tag_hex") ? dbRec.at("auth_tag_hex") : "";

    envelope.encryptedBody.ciphertext = CCrypto::CryptoSigner::fromHex(cipherHex);
    envelope.encryptedBody.iv = CCrypto::CryptoSigner::fromHex(ivHex);
    envelope.encryptedBody.tag = CCrypto::CryptoSigner::fromHex(tagHex);

    std::vector<std::string> quorum = req.hospitalQuorum;
    if (quorum.empty()) {
        quorum = {"HOSPITAL_A", "HOSPITAL_B", "HOSPITAL_C"};
    }

    try {
        resp.decryptedClinicalData = m_ksmCluster.decryptRecord(envelope, quorum);
    } catch (const std::exception& ex) {
        resp.status = QueryStatus::KMS_DECRYPTION_FAILED;
        resp.statusMessage = std::string("KMS threshold decryption failed: ") + ex.what();
        return resp;
    }

    resp.status = QueryStatus::SUCCESS;
    resp.statusMessage = "Query successful: Merkle inclusion verified against Block #" +
                         std::to_string(resp.blockHeight) + " root, DEK recovered from KMS hospital quorum.";

    return resp;
}

std::vector<std::map<std::string, std::string>> CrudManager::getActiveRecordsForDisplay(const std::string& schemaName) {
    return m_chain.getRecordStorage().getActiveRecords(schemaName);
}

} // namespace CCrud
