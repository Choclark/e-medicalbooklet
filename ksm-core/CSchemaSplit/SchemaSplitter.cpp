#include "SchemaSplitter.h"
#include "../CCrypto/Sha256.h"
#include <sstream>
#include <ctime>
#include <stdexcept>

namespace CKsm {

std::string UnencryptedMetadata::toString() const {
    std::ostringstream ss;
    ss << "TxID=" << txId.substr(0, 16) << "... | Schema=" << schemaType
       << " | Signer=" << signerType << " | Patient=" << patientId
       << " | Doctor=" << doctorId.substr(0, 12) << "..."
       << " | DEK-Threshold=" << thresholdT << "-of-" << totalN;
    return ss.str();
}

ClinicalBodyPayload::ClinicalBodyPayload(std::map<std::string, std::string> clinicalFields)
    : m_fields(std::move(clinicalFields)) {}

std::string ClinicalBodyPayload::get(const std::string& key, const std::string& defaultVal) const {
    auto it = m_fields.find(key);
    return (it != m_fields.end()) ? it->second : defaultVal;
}

void ClinicalBodyPayload::set(const std::string& key, const std::string& val) {
    m_fields[key] = val;
}

std::vector<uint8_t> ClinicalBodyPayload::serialize() const {
    std::vector<uint8_t> buf;
    // Format: [u32 count] for each: [u32 key_len][key_bytes] [u32 val_len][val_bytes]
    uint32_t count = static_cast<uint32_t>(m_fields.size());
    auto writeU32 = [&buf](uint32_t val) {
        for (int i = 0; i < 4; ++i) buf.push_back(static_cast<uint8_t>(val >> (8 * i)));
    };
    auto writeString = [&buf, &writeU32](const std::string& str) {
        writeU32(static_cast<uint32_t>(str.size()));
        buf.insert(buf.end(), str.begin(), str.end());
    };

    writeU32(count);
    for (const auto& [k, v] : m_fields) {
        writeString(k);
        writeString(v);
    }
    return buf;
}

ClinicalBodyPayload ClinicalBodyPayload::deserialize(const std::vector<uint8_t>& data) {
    ClinicalBodyPayload payload;
    size_t pos = 0;
    auto readU32 = [&data, &pos]() -> uint32_t {
        if (pos + 4 > data.size()) throw std::runtime_error("ClinicalBodyPayload: buffer underrun reading u32");
        uint32_t val = 0;
        for (int i = 0; i < 4; ++i) val |= static_cast<uint32_t>(data[pos + i]) << (8 * i);
        pos += 4;
        return val;
    };
    auto readString = [&data, &pos, &readU32]() -> std::string {
        uint32_t len = readU32();
        if (pos + len > data.size()) throw std::runtime_error("ClinicalBodyPayload: buffer underrun reading string");
        std::string s(reinterpret_cast<const char*>(data.data() + pos), len);
        pos += len;
        return s;
    };

    uint32_t count = readU32();
    for (uint32_t i = 0; i < count; ++i) {
        std::string k = readString();
        std::string v = readString();
        payload.m_fields[k] = v;
    }
    return payload;
}

std::string ClinicalBodyPayload::computeHash() const {
    auto bytes = serialize();
    return Sha256::hashHex(bytes.data(), bytes.size());
}

std::string ClinicalBodyPayload::toJson() const {
    std::ostringstream ss;
    ss << "{";
    bool first = true;
    for (const auto& [k, v] : m_fields) {
        if (!first) ss << ", ";
        first = false;
        ss << "\"" << k << "\": \"" << v << "\"";
    }
    ss << "}";
    return ss.str();
}

std::string EncryptedTxEnvelope::toSocketWireJson() const {
    std::ostringstream ss;
    ss << "{\n"
       << "  \"packet_type\": \"ENCRYPTED_TRANSACTION_SUBMISSION\",\n"
       << "  \"metadata\": {\n"
       << "    \"tx_id\": \"" << metadata.txId << "\",\n"
       << "    \"schema_type\": \"" << metadata.schemaType << "\",\n"
       << "    \"schema_version\": " << metadata.schemaVersion << ",\n"
       << "    \"timestamp\": " << metadata.timestamp << ",\n"
       << "    \"patient_id\": \"" << metadata.patientId << "\",\n"
       << "    \"doctor_id\": \"" << metadata.doctorId << "\",\n"
       << "    \"signer_type\": \"" << metadata.signerType << "\",\n"
       << "    \"sender_address\": \"" << metadata.senderAddress << "\",\n"
       << "    \"sender_public_key\": \"" << metadata.senderPublicKey << "\",\n"
       << "    \"signature\": \"" << metadata.signature << "\",\n"
       << "    \"body_data_hash\": \"" << metadata.bodyDataHash << "\",\n"
       << "    \"threshold_t\": " << metadata.thresholdT << ",\n"
       << "    \"total_n\": " << metadata.totalN << "\n"
       << "  },\n"
       << "  \"encrypted_body\": {\n"
       << "    \"iv_hex\": \"" << encryptedBody.ivHex() << "\",\n"
       << "    \"tag_hex\": \"" << encryptedBody.tagHex() << "\",\n"
       << "    \"ciphertext_hex\": \"" << encryptedBody.ciphertextHex() << "\"\n"
       << "  }\n"
       << "}";
    return ss.str();
}

std::vector<uint8_t> EncryptedTxEnvelope::toSocketWireBytes() const {
    std::string json = toSocketWireJson();
    std::vector<uint8_t> wire;
    // Magic: "KSM1" (0x4B, 0x53, 0x4D, 0x31)
    wire.push_back('K'); wire.push_back('S'); wire.push_back('M'); wire.push_back('1');
    uint32_t len = static_cast<uint32_t>(json.size());
    for (int i = 0; i < 4; ++i) wire.push_back(static_cast<uint8_t>(len >> (8 * i)));
    wire.insert(wire.end(), json.begin(), json.end());
    return wire;
}

void SchemaSplitter::split(const std::string& schemaType,
                          const std::map<std::string, std::string>& fullInputRecord,
                          const std::string& signerType,
                          const std::string& senderAddress,
                          const std::string& senderPublicKey,
                          const std::string& signature,
                          UnencryptedMetadata& outMeta,
                          ClinicalBodyPayload& outBody) {
    outMeta.schemaType = schemaType;
    outMeta.schemaVersion = 1;
    outMeta.timestamp = std::time(nullptr);
    outMeta.signerType = signerType;
    outMeta.senderAddress = senderAddress;
    outMeta.senderPublicKey = senderPublicKey;
    outMeta.signature = signature;

    // Extract consensus metadata fields
    auto itPat = fullInputRecord.find("patient_id");
    outMeta.patientId = (itPat != fullInputRecord.end()) ? itPat->second : "ANON_PATIENT";

    auto itDoc = fullInputRecord.find("doctor_id");
    outMeta.doctorId = (itDoc != fullInputRecord.end()) ? itDoc->second : senderAddress;

    // Everything clinical and sensitive goes into the Body Payload
    std::map<std::string, std::string> bodyFields;
    for (const auto& [k, v] : fullInputRecord) {
        // Exclude system fields from body payload
        if (k == "signature" || k == "sender_public_key") continue;
        bodyFields[k] = v;
    }
    outBody = ClinicalBodyPayload(bodyFields);
    outMeta.bodyDataHash = outBody.computeHash();

    // Canonical Transaction ID calculated over metadata and body hash
    std::ostringstream ss;
    ss << outMeta.schemaType << "|"
       << outMeta.schemaVersion << "|"
       << outMeta.timestamp << "|"
       << outMeta.patientId << "|"
       << outMeta.doctorId << "|"
       << outMeta.signerType << "|"
       << outMeta.senderPublicKey << "|"
       << outMeta.bodyDataHash;
    outMeta.txId = Sha256::hashHex(ss.str());
}

std::map<std::string, std::string> SchemaSplitter::reassemble(const UnencryptedMetadata& meta,
                                                             const ClinicalBodyPayload& body) {
    std::map<std::string, std::string> fullRecord = body.getFields();
    fullRecord["patient_id"] = meta.patientId;
    fullRecord["doctor_id"] = meta.doctorId;
    fullRecord["signer_type"] = meta.signerType;
    fullRecord["schema_type"] = meta.schemaType;
    fullRecord["tx_id"] = meta.txId;
    return fullRecord;
}

} // namespace CKsm
