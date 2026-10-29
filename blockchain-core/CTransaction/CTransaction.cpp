#include "CTransaction.h"
#include "CCrypto/Sha256.h"
#include "CCrypto/CryptoSigner.h"
#include "CCommon/Serializer.h"
#include <sstream>

CTransaction::CTransaction(std::string schema,
                           std::map<std::string, std::string> payload,
                           std::string sender,
                           std::string sig,
                           CSchemaDef::SignerType signer,
                           std::string pubKey)
    : schemaType(std::move(schema)),
      schemaVersion(1),
      timestamp(std::time(nullptr)),
      senderId(std::move(sender)),
      senderPublicKey(std::move(pubKey)),
      signature(std::move(sig)),
      signerType(signer),
      fields(std::move(payload)) {
    finalize();
}

std::string CTransaction::calculateTxId() const {
    std::stringstream ss;
    ss << schemaType << "|"
       << schemaVersion << "|"
       << timestamp << "|"
       << senderId << "|"
       << senderPublicKey << "|"
       << CSchemaDef::signerTypeToString(signerType);

    for (const auto& [k, v] : fields) {
        ss << "|" << k << ":" << v;
    }
    return CCrypto::Sha256::hashHex(ss.str());
}

void CTransaction::finalize() {
    if (!hasCustomTxId || txId.empty()) {
        txId = calculateTxId();
    }
}

void CTransaction::sign(const std::string& privateKeyHex, const std::string& publicKeyHex) {
    if (!publicKeyHex.empty()) {
        senderPublicKey = publicKeyHex;
    }
    hasCustomTxId = false;
    finalize();
    signature = CCrypto::CryptoSigner::sign(privateKeyHex, txId);
}

void CTransaction::attachExternalSignature(const std::string& externalTxIdHash,
                                           const std::string& publicKeyHex,
                                           const std::string& signatureHex) {
    if (!publicKeyHex.empty()) {
        senderPublicKey = publicKeyHex;
    }
    if (!externalTxIdHash.empty()) {
        txId = externalTxIdHash;
        hasCustomTxId = true;
    } else {
        hasCustomTxId = false;
        finalize();
    }
    signature = signatureHex;
}

void CTransaction::addCoSignature(const std::string& signerId,
                                  const std::string& privateKeyHex,
                                  const std::string& publicKeyHex) {
    coSignerId = signerId;
    if (!publicKeyHex.empty()) {
        coSignerPublicKey = publicKeyHex;
    }
    // Signs the finalized transaction ID
    coSignature = CCrypto::CryptoSigner::sign(privateKeyHex, txId);
}

bool CTransaction::verifySignature() const {
    if (signature.empty() || senderPublicKey.empty()) {
        return false;
    }
    return CCrypto::CryptoSigner::verify(senderPublicKey, txId, signature);
}

bool CTransaction::verifyCoSignature() const {
    if (coSignature.empty() || coSignerPublicKey.empty()) {
        return false;
    }
    return CCrypto::CryptoSigner::verify(coSignerPublicKey, txId, coSignature);
}

bool CTransaction::hasField(const std::string& key) const {
    return fields.find(key) != fields.end();
}

std::string CTransaction::getField(const std::string& key, const std::string& defVal) const {
    auto it = fields.find(key);
    if (it != fields.end()) return it->second;
    return defVal;
}

void CTransaction::setField(const std::string& key, const std::string& val) {
    fields[key] = val;
    finalize();
}

std::vector<uint8_t> CTransaction::serialize() const {
    ByteWriter w;
    w.reserve(320);
    w.writeString(txId);
    w.writeString(schemaType);
    w.writeU32(schemaVersion);
    w.writeI64(timestamp);
    w.writeString(senderId);
    w.writeString(senderPublicKey);
    w.writeString(signature);
    w.writeString(CSchemaDef::signerTypeToString(signerType));
    w.writeString(coSignerId);
    w.writeString(coSignerPublicKey);
    w.writeString(coSignature);

    w.writeU32(static_cast<uint32_t>(fields.size()));
    for (const auto& [k, v] : fields) {
        w.writeString(k);
        w.writeString(v);
    }
    return std::move(w.data());
}

CTransaction CTransaction::deserialize(const uint8_t* data, size_t size) {
    ByteReader r(data, size);
    CTransaction tx;
    tx.txId = r.readString();
    tx.schemaType = r.readString();
    tx.schemaVersion = r.readU32();
    tx.timestamp = r.readI64();
    tx.senderId = r.readString();
    tx.senderPublicKey = r.readString();
    tx.signature = r.readString();
    tx.signerType = CSchemaDef::signerTypeFromString(r.readString());
    if (r.remaining() > 0) {
        tx.coSignerId = r.readString();
        tx.coSignerPublicKey = r.readString();
        tx.coSignature = r.readString();
    }

    uint32_t count = r.readU32();
    for (uint32_t i = 0; i < count; ++i) {
        std::string k = r.readString();
        std::string v = r.readString();
        tx.fields[k] = v;
    }
    return tx;
}

std::string CTransaction::toString() const {
    std::stringstream ss;
    ss << "[" << schemaType << "] Signer=" << CSchemaDef::signerTypeToString(signerType)
       << " Sender=" << senderId
       << " ID=" << txId.substr(0, 12) << "...";
    for (const auto& [k, v] : fields) {
        ss << " " << k << "=\"" << v << "\"";
    }
    return ss.str();
}

size_t CTransaction::estimateMemoryBytes() const {
    size_t bytes = sizeof(CTransaction) + txId.capacity() + schemaType.capacity() + senderId.capacity() + signature.capacity();
    for (const auto& [k, v] : fields) {
        bytes += k.capacity() + v.capacity() + 32; // Map node overhead
    }
    return bytes;
}
