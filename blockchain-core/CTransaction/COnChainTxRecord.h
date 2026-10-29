#pragma once

#include <string>
#include <vector>
#include <cstdint>

class CTransaction;

// ========================================================
// On-chain Block Transaction Record
// The block anchors only identity, database pointer, and
// cryptographic hash, while sensitive medical data stays off-chain.
// ========================================================
struct COnChainTxRecord {
    std::string txId;          // Canonical SHA-256 ID of the transaction
    std::string schemaType;    // e.g. "EHR_RECORD", "PRESCRIPTION"
    uint32_t txOrder{0};       // Transaction order/index in the block
    std::string patientId;     // Patient ID
    std::string doctorId;      // Doctor or practitioner ID
    std::string dataId;        // Off-chain record primary key / document _id
    std::string dbType;        // "RELATIONAL_SQLITE" or "NON_RELATIONAL_COUCHDB"
    std::string dataHash;      // SHA-256 hash of off-chain record data
    int64_t timestamp{0};
    std::string signerType;    // Schema-enforced signer role ("DOCTOR", "PATIENT", etc.)
    std::string senderPublicKey; // Asymmetric ECDSA public key (hex)
    std::string signature;     // Asymmetric ECDSA signature (hex)
    std::string coSignerId;    // Co-signer identity (e.g. Patient)
    std::string coSignerPublicKey; // Co-signer public key
    std::string coSignature;   // Co-signer signature

    bool verifySignature() const;
    bool verifyCoSignature() const;
    std::string calculateHash() const;
    std::vector<uint8_t> serialize() const;
    static COnChainTxRecord deserialize(const uint8_t* data, size_t size);
    std::string toString() const;
};
