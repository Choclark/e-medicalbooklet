#pragma once

#include <string>
#include <map>
#include <vector>
#include <cstdint>
#include <ctime>
#include "SignerType.h"

class CTransaction {
public:
    std::string txId;                           // SHA-256 hash of canonical tx data
    std::string schemaType;                     // e.g. "EHR_RECORD", "PRESCRIPTION"
    uint32_t schemaVersion{1};
    int64_t timestamp{0};
    std::string senderId;                       // Node or practitioner public key / ID
    std::string senderPublicKey;                // Asymmetric ECDSA public key (hex)
    std::string signature;                      // Practitioner / node signature
    CSchemaDef::SignerType signerType{CSchemaDef::SignerType::DOCTOR}; // Role/type of the signer

    // Co-Signer / Multi-signature support (e.g. Patient co-signing with Doctor)
    std::string coSignerId;
    std::string coSignerPublicKey;
    std::string coSignature;

    bool hasCustomTxId{false};

    std::map<std::string, std::string> fields;  // Structured key-value payload

    CTransaction() = default;
    CTransaction(std::string schema,
                 std::map<std::string, std::string> payload,
                 std::string sender = "hospital_node_1",
                 std::string sig = "SIG_VALID_ED25519",
                 CSchemaDef::SignerType signer = CSchemaDef::SignerType::DOCTOR,
                 std::string pubKey = "");

    // Digitally sign this transaction with an asymmetric private key
    void sign(const std::string& privateKeyHex, const std::string& publicKeyHex = "");

    // Attach an external ECDSA P-256 signature computed by the Portal over externalTxIdHash
    void attachExternalSignature(const std::string& externalTxIdHash,
                                 const std::string& publicKeyHex,
                                 const std::string& signatureHex);

    // Add co-signature (e.g. patient co-signing for create, edit, or delete)
    void addCoSignature(const std::string& signerId,
                        const std::string& privateKeyHex,
                        const std::string& publicKeyHex = "");

    // Verify cryptographic signature against transaction txId using senderPublicKey
    bool verifySignature() const;

    // Verify co-signer cryptographic signature against transaction txId using coSignerPublicKey
    bool verifyCoSignature() const;
    bool hasCoSigner() const { return !coSignature.empty(); }

    // Cryptographic calculation using SHA-256
    std::string calculateTxId() const;
    void finalize();

    // Field accessors
    bool hasField(const std::string& key) const;
    std::string getField(const std::string& key, const std::string& defVal = "") const;
    void setField(const std::string& key, const std::string& val);

    // Serialization for disk and network
    std::vector<uint8_t> serialize() const;
    static CTransaction deserialize(const uint8_t* data, size_t size);

    // Human-readable string
    std::string toString() const;
    size_t estimateMemoryBytes() const;
};
