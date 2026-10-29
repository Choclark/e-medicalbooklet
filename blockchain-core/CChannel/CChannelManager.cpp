#include "CChannelManager.h"
#include <iostream>
#include <stdexcept>
#include <ctime>

#ifdef DELETE
#undef DELETE
#endif

namespace CChannel {

CChannelManager::CChannelManager(const std::string& configFile, const std::string& baseDataDir)
    : m_configFile(configFile), m_baseDataDir(baseDataDir) {
    std::lock_guard<std::mutex> lock(m_mutex);

    // Channel 0: Main Medical Record Ledger (EHR, Prescriptions, Lab Results, Access Audits)
    std::string ch0Dir = baseDataDir + "/channel_0";
    m_chains.push_back(std::make_unique<CChain>(
        CHANNEL_MAIN_PATIENT_RECORDS,
        "MainChain-PatientRecords",
        m_configFile,
        ch0Dir
    ));
    m_channelNames.push_back("MainChain-PatientRecords");

    // Channel 1: Registration Record Ledger (Patient & Doctor Identity Credentials)
    std::string ch1Dir = baseDataDir + "/channel_1";
    m_chains.push_back(std::make_unique<CChain>(
        CHANNEL_REGISTRATION_RECORDS,
        "RegistrationChain-PatientsAndDoctors",
        m_configFile,
        ch1Dir
    ));
    m_channelNames.push_back("RegistrationChain-PatientsAndDoctors");

    std::cout << "======================================================================\n";
    std::cout << "  CChannelManager: Multi-Channel Architecture Initialized (" << m_chains.size() << " Chains)\n";
    std::cout << "  - Vector Index [0] (Channel 0): " << m_channelNames[0] << "\n";
    std::cout << "    Storage Directory: " << ch0Dir << "\n";
    std::cout << "  - Vector Index [1] (Channel 1): " << m_channelNames[1] << "\n";
    std::cout << "    Storage Directory: " << ch1Dir << "\n";
    std::cout << "======================================================================\n\n";
}

CChain& CChannelManager::getChain(size_t index) {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (index >= m_chains.size()) {
        throw std::out_of_range("[ChannelManager] Channel index out of range: " + std::to_string(index) +
                                " (Available: 0 to " + std::to_string(m_chains.size() - 1) + ")");
    }
    return *m_chains[index];
}

const CChain& CChannelManager::getChain(size_t index) const {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (index >= m_chains.size()) {
        throw std::out_of_range("[ChannelManager] Channel index out of range: " + std::to_string(index) +
                                " (Available: 0 to " + std::to_string(m_chains.size() - 1) + ")");
    }
    return *m_chains[index];
}

size_t CChannelManager::getChannelCount() const {
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_chains.size();
}

std::string CChannelManager::getChannelName(size_t index) const {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (index >= m_channelNames.size()) return "UNKNOWN_CHANNEL";
    return m_channelNames[index];
}

size_t CChannelManager::addChannel(const std::string& channelName, const std::string& customDataDir) {
    std::lock_guard<std::mutex> lock(m_mutex);
    size_t newId = m_chains.size();
    std::string dir = customDataDir.empty() ? (m_baseDataDir + "/channel_" + std::to_string(newId)) : customDataDir;

    m_chains.push_back(std::make_unique<CChain>(
        static_cast<uint32_t>(newId),
        channelName,
        m_configFile,
        dir
    ));
    m_channelNames.push_back(channelName);

    std::cout << "[ChannelManager] New channel instantiated at index [" << newId << "]: "
              << channelName << " (Dir: " << dir << ")\n";
    return newId;
}

// -----------------------------------------------------------------------------
// CHANNEL 1: Doctor Registration
// -----------------------------------------------------------------------------
std::string CChannelManager::registerDoctor(const DoctorRegistrationRequest& req, std::string& outTxId, std::string& outError) {
    auto& regChain = getRegistrationChain();

    // Check if doctor is already active in Channel 1 off-chain database
    auto existingRec = regChain.getRecordStorage().retrieveRecord("REGISTER_DOCTOR", req.doctorId);
    if (existingRec && (!existingRec->count("is_deleted") || existingRec->at("is_deleted") != "1")) {
        outError = "Doctor '" + req.doctorId + "' is already registered and active on Channel 1.";
        return "";
    }

    std::string timestampStr = std::to_string(std::time(nullptr));
    outTxId = "TX-REG-DOC-" + req.doctorId + "-" + timestampStr.substr(timestampStr.size() - 6);

    CTransaction tx;
    tx.txId = outTxId;
    tx.schemaType = "REGISTER_DOCTOR";
    tx.senderId = req.doctorId;
    tx.signerType = CSchemaDef::SignerType::DOCTOR;
    tx.timestamp = std::time(nullptr);

    tx.fields = {
        {"doctor_id", req.doctorId},
        {"license_number", req.licenseNumber},
        {"full_name", req.fullName},
        {"specialty", req.specialty},
        {"hospital_id", req.hospitalId},
        {"public_key", req.doctorKeyPair.publicKeyHex},
        {"status", req.status.empty() ? "ACTIVE" : req.status},
        {"governance_authority", req.authorityKeyPair.address}
    };

    // Doctor signs transaction
    tx.sign(req.doctorKeyPair.privateKeyHex, req.doctorKeyPair.publicKeyHex);
    // Governance Authority co-signs transaction
    tx.addCoSignature(req.authorityKeyPair.address, req.authorityKeyPair.privateKeyHex, req.authorityKeyPair.publicKeyHex);

    // Validate against Channel 1 schema and consensus laws
    auto valRes = regChain.addTransaction(tx);
    if (!valRes) {
        outError = "Channel 1 Schema/Consensus Rejection: " + valRes.toString();
        return "";
    }

    // Propose and commit new block on Channel 1
    CBlock block = regChain.proposeBlock("VALIDATOR_NODE_0");
    auto commitRes = regChain.commitBlock(block);
    if (!commitRes) {
        outError = "Channel 1 Block Commit Rejection: " + commitRes.toString();
        return "";
    }

    std::cout << "[Channel 1: Registration] Doctor " << req.fullName << " (" << req.doctorId
              << ") registered in Block #" << block.getHeight() << " (Tx: " << outTxId << ")\n";

    return outTxId;
}

// -----------------------------------------------------------------------------
// CHANNEL 1: Patient Registration
// -----------------------------------------------------------------------------
std::string CChannelManager::registerPatient(const PatientRegistrationRequest& req, std::string& outTxId, std::string& outError) {
    auto& regChain = getRegistrationChain();

    // Check if patient is already active in Channel 1 off-chain database
    auto existingRec = regChain.getRecordStorage().retrieveRecord("REGISTER_PATIENT", req.patientId);
    if (existingRec && (!existingRec->count("is_deleted") || existingRec->at("is_deleted") != "1")) {
        outError = "Patient '" + req.patientId + "' is already registered and active on Channel 1.";
        return "";
    }

    std::string timestampStr = std::to_string(std::time(nullptr));
    outTxId = "TX-REG-PAT-" + req.patientId + "-" + timestampStr.substr(timestampStr.size() - 6);

    CTransaction tx;
    tx.txId = outTxId;
    tx.schemaType = "REGISTER_PATIENT";
    tx.senderId = req.patientId;
    tx.signerType = CSchemaDef::SignerType::PATIENT;
    tx.timestamp = std::time(nullptr);

    tx.fields = {
        {"patient_id", req.patientId},
        {"full_name", req.fullName},
        {"dob", req.dob},
        {"gender", req.gender},
        {"public_key", req.patientKeyPair.publicKeyHex},
        {"national_id_hash", req.nationalIdHash},
        {"emergency_contact", req.emergencyContact},
        {"status", req.status.empty() ? "ACTIVE" : req.status},
        {"registrar_id", req.authorityKeyPair.address}
    };

    // Patient signs registration transaction
    tx.sign(req.patientKeyPair.privateKeyHex, req.patientKeyPair.publicKeyHex);
    // Registrar/Authority co-signs registration transaction
    tx.addCoSignature(req.authorityKeyPair.address, req.authorityKeyPair.privateKeyHex, req.authorityKeyPair.publicKeyHex);

    // Validate against Channel 1 schema and consensus laws
    auto valRes = regChain.addTransaction(tx);
    if (!valRes) {
        outError = "Channel 1 Schema/Consensus Rejection: " + valRes.toString();
        return "";
    }

    // Propose and commit new block on Channel 1
    CBlock block = regChain.proposeBlock("VALIDATOR_NODE_0");
    auto commitRes = regChain.commitBlock(block);
    if (!commitRes) {
        outError = "Channel 1 Block Commit Rejection: " + commitRes.toString();
        return "";
    }

    std::cout << "[Channel 1: Registration] Patient " << req.fullName << " (" << req.patientId
              << ") registered in Block #" << block.getHeight() << " (Tx: " << outTxId << ")\n";

    return outTxId;
}

// -----------------------------------------------------------------------------
// CHANNEL 1: Edit Doctor Registration
// -----------------------------------------------------------------------------
bool CChannelManager::editDoctorRegistration(const std::string& doctorId,
                                            const std::string& updatedHospital,
                                            const std::string& updatedSpecialty,
                                            const std::string& updatedStatus,
                                            const std::string& editReason,
                                            const CCrypto::KeyPair& doctorKeyPair,
                                            const CCrypto::KeyPair& authorityKeyPair,
                                            std::string& outTxId,
                                            std::string& outError) {
    auto& regChain = getRegistrationChain();

    auto origRec = regChain.getRecordStorage().retrieveRecord("REGISTER_DOCTOR", doctorId);
    if (!origRec) {
        outError = "Doctor registration record '" + doctorId + "' not found on Channel 1.";
        return false;
    }
    if (origRec->count("is_deleted") && origRec->at("is_deleted") == "1") {
        outError = "Doctor '" + doctorId + "' is deregistered; cannot edit.";
        return false;
    }

    // Signer consistency: Doctor must be the exact original doctor
    std::string origDoc = origRec->count("doctor_id") ? origRec->at("doctor_id") : "";
    std::string origPubKey = origRec->count("public_key") ? origRec->at("public_key") : "";
    if (origDoc != doctorId) {
        outError = "Signer mismatch: Editing doctor must match registered doctor ID.";
        return false;
    }
    if (!origPubKey.empty() && origPubKey != doctorKeyPair.publicKeyHex) {
        outError = "Signer mismatch: Doctor public key does not match registered key.";
        return false;
    }

    uint64_t origBlockHeight = origRec->count("block_height") ? std::stoull(origRec->at("block_height")) : 0;
    std::string origTxId = origRec->count("tx_id") ? origRec->at("tx_id") : "ORIG_REG_TX";

    std::string timestampStr = std::to_string(std::time(nullptr));
    outTxId = "TX-EDIT-DOC-" + doctorId + "-" + timestampStr.substr(timestampStr.size() - 6);

    CTransaction tx;
    tx.txId = outTxId;
    tx.schemaType = "EDIT_DOCTOR_REGISTRATION";
    tx.senderId = doctorId;
    tx.signerType = CSchemaDef::SignerType::DOCTOR;
    tx.timestamp = std::time(nullptr);

    tx.fields = {
        {"target_data_id", doctorId},
        {"target_block_height", std::to_string(origBlockHeight)},
        {"target_tx_id", origTxId},
        {"doctor_id", doctorId},
        {"hospital_id", updatedHospital.empty() ? origRec->at("hospital_id") : updatedHospital},
        {"specialty", updatedSpecialty.empty() ? origRec->at("specialty") : updatedSpecialty},
        {"status", updatedStatus.empty() ? origRec->at("status") : updatedStatus},
        {"edit_reason", editReason}
    };

    tx.sign(doctorKeyPair.privateKeyHex, doctorKeyPair.publicKeyHex);
    tx.addCoSignature(authorityKeyPair.address, authorityKeyPair.privateKeyHex, authorityKeyPair.publicKeyHex);

    auto valRes = regChain.addTransaction(tx);
    if (!valRes) {
        outError = "Channel 1 Rejection: " + valRes.toString();
        return false;
    }

    // Immutability: Previous block containing registration is NEVER modified.
    // The edit is committed in a NEW block on Channel 1.
    CBlock newBlock = regChain.proposeBlock("VALIDATOR_NODE_0");
    auto commitRes = regChain.commitBlock(newBlock);
    if (!commitRes) {
        outError = "Channel 1 Commit Rejection: " + commitRes.toString();
        return false;
    }

    std::cout << "[Channel 1: Edit] Doctor " << doctorId << " credentials modified in new Block #"
              << newBlock.getHeight() << " (Old Block #" << origBlockHeight << " remains untouched)\n";

    return true;
}

// -----------------------------------------------------------------------------
// CHANNEL 1: Edit Patient Registration
// -----------------------------------------------------------------------------
bool CChannelManager::editPatientRegistration(const std::string& patientId,
                                             const std::string& updatedFullName,
                                             const std::string& updatedContact,
                                             const std::string& updatedStatus,
                                             const std::string& editReason,
                                             const CCrypto::KeyPair& patientKeyPair,
                                             const CCrypto::KeyPair& authorityKeyPair,
                                             std::string& outTxId,
                                             std::string& outError) {
    auto& regChain = getRegistrationChain();

    auto origRec = regChain.getRecordStorage().retrieveRecord("REGISTER_PATIENT", patientId);
    if (!origRec) {
        outError = "Patient registration record '" + patientId + "' not found on Channel 1.";
        return false;
    }
    if (origRec->count("is_deleted") && origRec->at("is_deleted") == "1") {
        outError = "Patient '" + patientId + "' is deregistered; cannot edit.";
        return false;
    }

    std::string origPat = origRec->count("patient_id") ? origRec->at("patient_id") : "";
    std::string origPubKey = origRec->count("public_key") ? origRec->at("public_key") : "";
    if (origPat != patientId) {
        outError = "Signer mismatch: Editing patient must match registered patient ID.";
        return false;
    }
    if (!origPubKey.empty() && origPubKey != patientKeyPair.publicKeyHex) {
        outError = "Signer mismatch: Patient public key does not match registered key.";
        return false;
    }

    uint64_t origBlockHeight = origRec->count("block_height") ? std::stoull(origRec->at("block_height")) : 0;
    std::string origTxId = origRec->count("tx_id") ? origRec->at("tx_id") : "ORIG_REG_TX";

    std::string timestampStr = std::to_string(std::time(nullptr));
    outTxId = "TX-EDIT-PAT-" + patientId + "-" + timestampStr.substr(timestampStr.size() - 6);

    CTransaction tx;
    tx.txId = outTxId;
    tx.schemaType = "EDIT_PATIENT_REGISTRATION";
    tx.senderId = patientId;
    tx.signerType = CSchemaDef::SignerType::PATIENT;
    tx.timestamp = std::time(nullptr);

    tx.fields = {
        {"target_data_id", patientId},
        {"target_block_height", std::to_string(origBlockHeight)},
        {"target_tx_id", origTxId},
        {"patient_id", patientId},
        {"full_name", updatedFullName.empty() ? origRec->at("full_name") : updatedFullName},
        {"emergency_contact", updatedContact.empty() ? origRec->at("emergency_contact") : updatedContact},
        {"status", updatedStatus.empty() ? origRec->at("status") : updatedStatus},
        {"edit_reason", editReason}
    };

    tx.sign(patientKeyPair.privateKeyHex, patientKeyPair.publicKeyHex);
    tx.addCoSignature(authorityKeyPair.address, authorityKeyPair.privateKeyHex, authorityKeyPair.publicKeyHex);

    auto valRes = regChain.addTransaction(tx);
    if (!valRes) {
        outError = "Channel 1 Rejection: " + valRes.toString();
        return false;
    }

    CBlock newBlock = regChain.proposeBlock("VALIDATOR_NODE_0");
    auto commitRes = regChain.commitBlock(newBlock);
    if (!commitRes) {
        outError = "Channel 1 Commit Rejection: " + commitRes.toString();
        return false;
    }

    std::cout << "[Channel 1: Edit] Patient " << patientId << " demographics modified in new Block #"
              << newBlock.getHeight() << " (Old Block #" << origBlockHeight << " remains untouched)\n";

    return true;
}

// -----------------------------------------------------------------------------
// CHANNEL 1: Deregister Doctor
// -----------------------------------------------------------------------------
bool CChannelManager::deregisterDoctor(const std::string& doctorId,
                                      const std::string& reason,
                                      const CCrypto::KeyPair& doctorKeyPair,
                                      const CCrypto::KeyPair& authorityKeyPair,
                                      std::string& outTxId,
                                      std::string& outError) {
    auto& regChain = getRegistrationChain();

    auto origRec = regChain.getRecordStorage().retrieveRecord("REGISTER_DOCTOR", doctorId);
    if (!origRec) {
        outError = "Doctor '" + doctorId + "' not found on Channel 1.";
        return false;
    }
    if (origRec->count("is_deleted") && origRec->at("is_deleted") == "1") {
        outError = "Doctor '" + doctorId + "' is already deregistered.";
        return false;
    }

    std::string origDoc = origRec->count("doctor_id") ? origRec->at("doctor_id") : "";
    std::string origPubKey = origRec->count("public_key") ? origRec->at("public_key") : "";
    if (origDoc != doctorId) {
        outError = "Signer mismatch: Deregistering doctor must match registered doctor ID.";
        return false;
    }
    if (!origPubKey.empty() && origPubKey != doctorKeyPair.publicKeyHex) {
        outError = "Signer mismatch: Doctor public key does not match registered key.";
        return false;
    }

    uint64_t origBlockHeight = origRec->count("block_height") ? std::stoull(origRec->at("block_height")) : 0;
    std::string origTxId = origRec->count("tx_id") ? origRec->at("tx_id") : "ORIG_REG_TX";

    std::string timestampStr = std::to_string(std::time(nullptr));
    outTxId = "TX-DEL-DOC-" + doctorId + "-" + timestampStr.substr(timestampStr.size() - 6);

    CTransaction tx;
    tx.txId = outTxId;
    tx.schemaType = "DELETE_DOCTOR_REGISTRATION";
    tx.senderId = doctorId;
    tx.signerType = CSchemaDef::SignerType::DOCTOR;
    tx.timestamp = std::time(nullptr);

    tx.fields = {
        {"target_data_id", doctorId},
        {"target_block_height", std::to_string(origBlockHeight)},
        {"target_tx_id", origTxId},
        {"doctor_id", doctorId},
        {"deletion_reason", reason}
    };

    tx.sign(doctorKeyPair.privateKeyHex, doctorKeyPair.publicKeyHex);
    tx.addCoSignature(authorityKeyPair.address, authorityKeyPair.privateKeyHex, authorityKeyPair.publicKeyHex);

    auto valRes = regChain.addTransaction(tx);
    if (!valRes) {
        outError = "Channel 1 Rejection: " + valRes.toString();
        return false;
    }

    // Commit deletion event in a NEW block on Channel 1 (old block is untouched!)
    CBlock newBlock = regChain.proposeBlock("VALIDATOR_NODE_0");
    auto commitRes = regChain.commitBlock(newBlock);
    if (!commitRes) {
        outError = "Channel 1 Commit Rejection: " + commitRes.toString();
        return false;
    }

    std::cout << "[Channel 1: Deregistration] Doctor " << doctorId << " deregistered in Block #"
              << newBlock.getHeight() << " (Historical Block #" << origBlockHeight << " remains untouched)\n";

    return true;
}

// -----------------------------------------------------------------------------
// CHANNEL 1: Deregister Patient
// -----------------------------------------------------------------------------
bool CChannelManager::deregisterPatient(const std::string& patientId,
                                       const std::string& reason,
                                       const CCrypto::KeyPair& patientKeyPair,
                                       const CCrypto::KeyPair& authorityKeyPair,
                                       std::string& outTxId,
                                       std::string& outError) {
    auto& regChain = getRegistrationChain();

    auto origRec = regChain.getRecordStorage().retrieveRecord("REGISTER_PATIENT", patientId);
    if (!origRec) {
        outError = "Patient '" + patientId + "' not found on Channel 1.";
        return false;
    }
    if (origRec->count("is_deleted") && origRec->at("is_deleted") == "1") {
        outError = "Patient '" + patientId + "' is already deregistered.";
        return false;
    }

    std::string origPat = origRec->count("patient_id") ? origRec->at("patient_id") : "";
    std::string origPubKey = origRec->count("public_key") ? origRec->at("public_key") : "";
    if (origPat != patientId) {
        outError = "Signer mismatch: Deregistering patient must match registered patient ID.";
        return false;
    }
    if (!origPubKey.empty() && origPubKey != patientKeyPair.publicKeyHex) {
        outError = "Signer mismatch: Patient public key does not match registered key.";
        return false;
    }

    uint64_t origBlockHeight = origRec->count("block_height") ? std::stoull(origRec->at("block_height")) : 0;
    std::string origTxId = origRec->count("tx_id") ? origRec->at("tx_id") : "ORIG_REG_TX";

    std::string timestampStr = std::to_string(std::time(nullptr));
    outTxId = "TX-DEL-PAT-" + patientId + "-" + timestampStr.substr(timestampStr.size() - 6);

    CTransaction tx;
    tx.txId = outTxId;
    tx.schemaType = "DELETE_PATIENT_REGISTRATION";
    tx.senderId = patientId;
    tx.signerType = CSchemaDef::SignerType::PATIENT;
    tx.timestamp = std::time(nullptr);

    tx.fields = {
        {"target_data_id", patientId},
        {"target_block_height", std::to_string(origBlockHeight)},
        {"target_tx_id", origTxId},
        {"patient_id", patientId},
        {"deletion_reason", reason}
    };

    tx.sign(patientKeyPair.privateKeyHex, patientKeyPair.publicKeyHex);
    tx.addCoSignature(authorityKeyPair.address, authorityKeyPair.privateKeyHex, authorityKeyPair.publicKeyHex);

    auto valRes = regChain.addTransaction(tx);
    if (!valRes) {
        outError = "Channel 1 Rejection: " + valRes.toString();
        return false;
    }

    CBlock newBlock = regChain.proposeBlock("VALIDATOR_NODE_0");
    auto commitRes = regChain.commitBlock(newBlock);
    if (!commitRes) {
        outError = "Channel 1 Commit Rejection: " + commitRes.toString();
        return false;
    }

    std::cout << "[Channel 1: Deregistration] Patient " << patientId << " deregistered in Block #"
              << newBlock.getHeight() << " (Historical Block #" << origBlockHeight << " remains untouched)\n";

    return true;
}

// -----------------------------------------------------------------------------
// CHANNEL 1: Query Registration with Merkle Inclusion Proof
// -----------------------------------------------------------------------------
RegistrationQueryResult CChannelManager::queryRegistration(const std::string& subjectId, bool isDoctor, bool includeDeleted) {
    RegistrationQueryResult res;
    res.subjectId = subjectId;
    res.role = isDoctor ? "DOCTOR" : "PATIENT";

    auto& regChain = getRegistrationChain();
    std::string schemaName = isDoctor ? "REGISTER_DOCTOR" : "REGISTER_PATIENT";

    // 1. Fetch record from off-chain SQLite database on Channel 1
    auto recOpt = regChain.getRecordStorage().retrieveRecord(schemaName, subjectId);
    if (!recOpt) {
        res.found = false;
        return res;
    }

    res.found = true;
    res.fields = *recOpt;
    res.publicKey = recOpt->count("public_key") ? recOpt->at("public_key") : "";
    res.status = recOpt->count("status") ? recOpt->at("status") : "ACTIVE";

    // 2. Display filtering: Check soft deletion status
    if (recOpt->count("is_deleted") && recOpt->at("is_deleted") == "1") {
        res.isDeleted = true;
        res.deletionReason = recOpt->count("deletion_reason") ? recOpt->at("deletion_reason") : "Deregistered";
        if (!includeDeleted) {
            // Filtered out at display time
            return res;
        }
    }

    // 3. Extract block_height and tx_order stored in off-chain DB
    if (!recOpt->count("block_height") || !recOpt->count("tx_order")) {
        return res;
    }

    res.blockHeight = std::stoull(recOpt->at("block_height"));
    res.txOrder = std::stoul(recOpt->at("tx_order"));
    res.txId = recOpt->count("tx_id") ? recOpt->at("tx_id") : "";

    // 4. Retrieve Merkle tree from Channel 1's CMerkleStore (2GB RAM limit or disk)
    auto proofOpt = regChain.getMerkleStore().getProof(res.blockHeight, res.txOrder);
    if (!proofOpt) {
        res.merkleVerified = false;
        return res;
    }

    res.merkleProof = *proofOpt;

    // 5. Verify Merkle proof against Channel 1 block header's merkleRoot
    auto headerOpt = regChain.getHeaderByHeight(res.blockHeight);
    if (!headerOpt) {
        res.merkleVerified = false;
        return res;
    }

    res.expectedMerkleRoot = headerOpt->merkleRoot;
    res.merkleVerified = res.merkleProof.verify(res.expectedMerkleRoot);

    return res;
}

// -----------------------------------------------------------------------------
// Display Filtered Queries: Active Doctors and Patients
// -----------------------------------------------------------------------------
std::vector<std::map<std::string, std::string>> CChannelManager::getActiveDoctorsForDisplay() {
    auto& regChain = getRegistrationChain();
    auto allRecs = regChain.getRecordStorage().getActiveRecords("REGISTER_DOCTOR");
    std::vector<std::map<std::string, std::string>> active;
    for (const auto& r : allRecs) {
        if (!r.count("is_deleted") || r.at("is_deleted") != "1") {
            active.push_back(r);
        }
    }
    return active;
}

std::vector<std::map<std::string, std::string>> CChannelManager::getActivePatientsForDisplay() {
    auto& regChain = getRegistrationChain();
    auto allRecs = regChain.getRecordStorage().getActiveRecords("REGISTER_PATIENT");
    std::vector<std::map<std::string, std::string>> active;
    for (const auto& r : allRecs) {
        if (!r.count("is_deleted") || r.at("is_deleted") != "1") {
            active.push_back(r);
        }
    }
    return active;
}

// -----------------------------------------------------------------------------
// Cross-Channel Validation Helpers
// -----------------------------------------------------------------------------
bool CChannelManager::isDoctorActive(const std::string& doctorId, std::string* outPublicKey) const {
    const auto& regChain = getRegistrationChain();
    auto recOpt = const_cast<CChain&>(regChain).getRecordStorage().retrieveRecord("REGISTER_DOCTOR", doctorId);
    if (!recOpt) return false;

    // If marked deleted, identity is revoked / inactive
    if (recOpt->count("is_deleted") && recOpt->at("is_deleted") == "1") return false;

    std::string status = recOpt->count("status") ? recOpt->at("status") : "ACTIVE";
    if (status != "ACTIVE") return false;

    if (outPublicKey && recOpt->count("public_key")) {
        *outPublicKey = recOpt->at("public_key");
    }
    return true;
}

bool CChannelManager::isPatientActive(const std::string& patientId, std::string* outPublicKey) const {
    const auto& regChain = getRegistrationChain();
    auto recOpt = const_cast<CChain&>(regChain).getRecordStorage().retrieveRecord("REGISTER_PATIENT", patientId);
    if (!recOpt) return false;

    if (recOpt->count("is_deleted") && recOpt->at("is_deleted") == "1") return false;

    std::string status = recOpt->count("status") ? recOpt->at("status") : "ACTIVE";
    if (status != "ACTIVE") return false;

    if (outPublicKey && recOpt->count("public_key")) {
        *outPublicKey = recOpt->at("public_key");
    }
    return true;
}

} // namespace CChannel
