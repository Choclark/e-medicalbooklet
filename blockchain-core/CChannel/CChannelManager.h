#pragma once

#include <vector>
#include <memory>
#include <string>
#include <optional>
#include <mutex>
#include <map>
#include "CChain/Cchain.h"
#include "CCrypto/CryptoSigner.h"
#include "CMerkle/CMerkleTree.h"

namespace CChannel {

// Channel index constants in the multi-channel vector
enum ChannelIndex : size_t {
    CHANNEL_MAIN_PATIENT_RECORDS = 0,    // Chain 0: Main Medical/Patient Record Ledger
    CHANNEL_REGISTRATION_RECORDS = 1     // Chain 1: Patient and Doctor Identity Registration Ledger
};

// -------------------------------------------------------------
// Registration Request & Response Models (Channel 1)
// -------------------------------------------------------------
struct DoctorRegistrationRequest {
    std::string doctorId;
    std::string fullName;
    std::string licenseNumber;
    std::string specialty;
    std::string hospitalId;
    CCrypto::KeyPair doctorKeyPair;
    CCrypto::KeyPair authorityKeyPair;
    std::string status{"ACTIVE"};
};

struct PatientRegistrationRequest {
    std::string patientId;
    std::string fullName;
    std::string dob;
    std::string gender;
    std::string nationalIdHash;
    std::string emergencyContact;
    CCrypto::KeyPair patientKeyPair;
    CCrypto::KeyPair authorityKeyPair;
    std::string status{"ACTIVE"};
};

struct RegistrationQueryResult {
    bool found{false};
    bool isDeleted{false};
    bool merkleVerified{false};
    std::string role; // "DOCTOR" or "PATIENT"
    std::string subjectId;
    std::string publicKey;
    std::string status;
    uint64_t blockHeight{0};
    uint32_t txOrder{0};
    std::string txId;
    CMerkle::MerkleProof merkleProof;
    std::string expectedMerkleRoot;
    std::map<std::string, std::string> fields;
    std::string deletionReason;
};

// -------------------------------------------------------------
// CChannelManager: Coordinates multiple blockchain ledgers (channels)
// running concurrently using the same underlying CChain technology.
// Contains a vector of chains:
//   - Chain 0: Main Chain (Patient Records)
//   - Chain 1: Registration Record (Patients and Doctors)
// -------------------------------------------------------------
class CChannelManager {
public:
    explicit CChannelManager(const std::string& configFile = "blockchain.conf",
                            const std::string& baseDataDir = "chaindata");
    ~CChannelManager() = default;

    CChannelManager(const CChannelManager&) = delete;
    CChannelManager& operator=(const CChannelManager&) = delete;

    // ---------------------------------------------------------
    // Channel Vector Accessors
    // ---------------------------------------------------------
    CChain& getChain(size_t index);
    const CChain& getChain(size_t index) const;

    CChain& getMainChain() { return getChain(CHANNEL_MAIN_PATIENT_RECORDS); }
    const CChain& getMainChain() const { return getChain(CHANNEL_MAIN_PATIENT_RECORDS); }

    CChain& getRegistrationChain() { return getChain(CHANNEL_REGISTRATION_RECORDS); }
    const CChain& getRegistrationChain() const { return getChain(CHANNEL_REGISTRATION_RECORDS); }

    CChain& operator[](size_t index) { return getChain(index); }
    const CChain& operator[](size_t index) const { return getChain(index); }

    size_t getChannelCount() const;
    std::string getChannelName(size_t index) const;

    const std::vector<std::unique_ptr<CChain>>& getChains() const { return m_chains; }

    // Dynamic channel addition if needed in future
    size_t addChannel(const std::string& channelName, const std::string& customDataDir = "");

    // ---------------------------------------------------------
    // Channel 1: Patient and Doctor Registration Operations
    // ---------------------------------------------------------
    std::string registerDoctor(const DoctorRegistrationRequest& req, std::string& outTxId, std::string& outError);
    std::string registerPatient(const PatientRegistrationRequest& req, std::string& outTxId, std::string& outError);

    bool editDoctorRegistration(const std::string& doctorId,
                                const std::string& updatedHospital,
                                const std::string& updatedSpecialty,
                                const std::string& updatedStatus,
                                const std::string& editReason,
                                const CCrypto::KeyPair& doctorKeyPair,
                                const CCrypto::KeyPair& authorityKeyPair,
                                std::string& outTxId,
                                std::string& outError);

    bool editPatientRegistration(const std::string& patientId,
                                 const std::string& updatedFullName,
                                 const std::string& updatedContact,
                                 const std::string& updatedStatus,
                                 const std::string& editReason,
                                 const CCrypto::KeyPair& patientKeyPair,
                                 const CCrypto::KeyPair& authorityKeyPair,
                                 std::string& outTxId,
                                 std::string& outError);

    bool deregisterDoctor(const std::string& doctorId,
                          const std::string& reason,
                          const CCrypto::KeyPair& doctorKeyPair,
                          const CCrypto::KeyPair& authorityKeyPair,
                          std::string& outTxId,
                          std::string& outError);

    bool deregisterPatient(const std::string& patientId,
                           const std::string& reason,
                           const CCrypto::KeyPair& patientKeyPair,
                           const CCrypto::KeyPair& authorityKeyPair,
                           std::string& outTxId,
                           std::string& outError);

    // Query registration on Channel 1 with Merkle inclusion proof verification
    RegistrationQueryResult queryRegistration(const std::string& subjectId, bool isDoctor, bool includeDeleted = false);

    // Display Filtered Queries: retrieves only active identities (soft-deleted identities filtered out)
    std::vector<std::map<std::string, std::string>> getActiveDoctorsForDisplay();
    std::vector<std::map<std::string, std::string>> getActivePatientsForDisplay();

    // Fast Cross-Channel Active Identity Validation
    bool isDoctorActive(const std::string& doctorId, std::string* outPublicKey = nullptr) const;
    bool isPatientActive(const std::string& patientId, std::string* outPublicKey = nullptr) const;

private:
    std::string m_configFile;
    std::string m_baseDataDir;
    std::vector<std::unique_ptr<CChain>> m_chains;
    std::vector<std::string> m_channelNames;
    mutable std::mutex m_mutex;
};

} // namespace CChannel
