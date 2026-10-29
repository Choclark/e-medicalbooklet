#pragma once

#include <string>
#include <map>
#include <vector>
#include <cstdint>
#include "../CCrypto/AesGcmCipher.h"

namespace CKsm {

// ============================================================================
// Unencrypted Metadata: Used by blockchain nodes for consensus, PBFT,
// schema law verification, and identity routing. MUST NOT BE ENCRYPTED.
// ============================================================================
struct UnencryptedMetadata {
    std::string txId;                           // Canonical Transaction Hash
    std::string schemaType;                     // "EHR_RECORD", "PRESCRIPTION", etc.
    uint32_t schemaVersion{1};
    int64_t timestamp{0};
    std::string patientId;                      // Patient identifier (e.g. PAT-9942)
    std::string doctorId;                       // Attending doctor / practitioner ID
    std::string signerType;                     // "DOCTOR", "PATIENT", "NURSE", "LAB_TECHNICIAN"
    std::string senderAddress;                  // Ethereum-style 0x address
    std::string senderPublicKey;                // 128-hex uncompressed ECDSA public key
    std::string signature;                      // Asymmetric digital signature
    std::string bodyDataHash;                   // SHA-256 hash of cleartext body (cryptographic binding)

    // Threshold DEK metadata reference
    uint32_t thresholdT{3};
    uint32_t totalN{4};
    std::vector<std::string> participantNodes;  // e.g. {"HOSPITAL_A", "HOSPITAL_B", ...}

    std::string toString() const;
};

// ============================================================================
// Clinical Body Payload: Real sensitive medical data (diagnosis, medication,
// lab values, clinical notes). Sent to KSM for AES-256-GCM encryption with DEK.
// ============================================================================
class ClinicalBodyPayload {
public:
    ClinicalBodyPayload() = default;
    explicit ClinicalBodyPayload(std::map<std::string, std::string> clinicalFields);

    const std::map<std::string, std::string>& getFields() const { return m_fields; }
    std::string get(const std::string& key, const std::string& defaultVal = "") const;
    void set(const std::string& key, const std::string& val);

    // Serialization for encryption
    std::vector<uint8_t> serialize() const;
    static ClinicalBodyPayload deserialize(const std::vector<uint8_t>& data);

    // Cryptographic hash of clinical contents
    std::string computeHash() const;
    std::string toJson() const;

private:
    std::map<std::string, std::string> m_fields;
};

// ============================================================================
// Encrypted Transaction Envelope: Ready to be sent to blockchain network / mempool
// via socket port.
// ============================================================================
struct EncryptedTxEnvelope {
    UnencryptedMetadata metadata;
    AesGcmResult encryptedBody;

    // Returns canonical wire payload format (for socket transmission to mempool)
    std::string toSocketWireJson() const;
    std::vector<uint8_t> toSocketWireBytes() const;
    static EncryptedTxEnvelope fromSocketWireBytes(const uint8_t* data, size_t size);
};

// ============================================================================
// SchemaSplitter: Separates cleartext clinical record into Metadata and Body
// ============================================================================
class SchemaSplitter {
public:
    static void split(const std::string& schemaType,
                      const std::map<std::string, std::string>& fullInputRecord,
                      const std::string& signerType,
                      const std::string& senderAddress,
                      const std::string& senderPublicKey,
                      const std::string& signature,
                      UnencryptedMetadata& outMeta,
                      ClinicalBodyPayload& outBody);

    static std::map<std::string, std::string> reassemble(const UnencryptedMetadata& meta,
                                                         const ClinicalBodyPayload& body);
};

} // namespace CKsm
