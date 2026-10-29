#include "COnChainTxRecord.h"
#include "CCrypto/Sha256.h"
#include "CCrypto/CryptoSigner.h"
#include "CCommon/Serializer.h"
#include <sstream>

bool COnChainTxRecord::verifySignature() const {
    if (signature.empty() || senderPublicKey.empty()) {
        return false;
    }
    return CCrypto::CryptoSigner::verify(senderPublicKey, txId, signature);
}

bool COnChainTxRecord::verifyCoSignature() const {
    if (coSignature.empty() || coSignerPublicKey.empty()) {
        return false;
    }
    return CCrypto::CryptoSigner::verify(coSignerPublicKey, txId, coSignature);
}

std::string COnChainTxRecord::calculateHash() const {
    std::stringstream ss;
    ss << txId << "|"
       << schemaType << "|"
       << txOrder << "|"
       << patientId << "|"
       << doctorId << "|"
       << dataId << "|"
       << dbType << "|"
       << dataHash << "|"
       << timestamp << "|"
       << signerType << "|"
       << senderPublicKey << "|"
       << signature << "|"
       << coSignerId << "|"
       << coSignerPublicKey << "|"
       << coSignature;
    return CCrypto::Sha256::hashHex(ss.str());
}

std::vector<uint8_t> COnChainTxRecord::serialize() const {
    ByteWriter w;
    w.reserve(380);
    w.writeString(txId);
    w.writeString(schemaType);
    w.writeU32(txOrder);
    w.writeString(patientId);
    w.writeString(doctorId);
    w.writeString(dataId);
    w.writeString(dbType);
    w.writeString(dataHash);
    w.writeI64(timestamp);
    w.writeString(signerType);
    w.writeString(senderPublicKey);
    w.writeString(signature);
    w.writeString(coSignerId);
    w.writeString(coSignerPublicKey);
    w.writeString(coSignature);
    return std::move(w.data());
}

COnChainTxRecord COnChainTxRecord::deserialize(const uint8_t* data, size_t size) {
    ByteReader r(data, size);
    COnChainTxRecord rec;
    rec.txId = r.readString();
    rec.schemaType = r.readString();
    rec.txOrder = r.readU32();
    rec.patientId = r.readString();
    rec.doctorId = r.readString();
    rec.dataId = r.readString();
    rec.dbType = r.readString();
    rec.dataHash = r.readString();
    rec.timestamp = r.readI64();
    rec.signerType = r.readString();
    rec.senderPublicKey = r.readString();
    rec.signature = r.readString();
    if (r.remaining() > 0) {
        rec.coSignerId = r.readString();
        rec.coSignerPublicKey = r.readString();
        rec.coSignature = r.readString();
    }
    return rec;
}

std::string COnChainTxRecord::toString() const {
    std::stringstream ss;
    ss << "[OnChainTx #" << txOrder << "] "
       << "Schema=" << schemaType << " | "
       << "Signer=" << signerType << " | "
       << "TxID=" << (txId.size() > 12 ? txId.substr(0, 12) + "..." : txId) << " | "
       << "Patient=" << patientId << " | "
       << "Doctor=" << doctorId << " | "
       << "DB=" << dbType << " | "
       << "DataID=" << dataId << " | "
       << "PubKey=" << (senderPublicKey.size() > 16 ? senderPublicKey.substr(0, 16) + "..." : senderPublicKey) << " | "
       << "Sig=" << (signature.size() > 16 ? signature.substr(0, 16) + "..." : signature);
    return ss.str();
}
