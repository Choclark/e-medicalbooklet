#include "KsmCluster.h"
#include "../CCrypto/AesGcmCipher.h"
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <stdexcept>
#include <iostream>
#include <sstream>

namespace CKsm {

KsmCluster::KsmCluster(uint32_t thresholdT, uint32_t totalN, std::filesystem::path storageDir)
    : m_thresholdT(thresholdT), m_totalN(totalN), m_storageDir(std::move(storageDir)), m_sss() {
    if (!std::filesystem::exists(m_storageDir)) {
        std::filesystem::create_directories(m_storageDir);
    }
    // Default standalone ksm_core daemon TCP endpoints (HOSPITAL_A..D -> 127.0.0.1:9101..9104)
    m_nodeEndpoints["HOSPITAL_A"] = {"127.0.0.1", 9101};
    m_nodeEndpoints["HOSPITAL_B"] = {"127.0.0.1", 9102};
    m_nodeEndpoints["HOSPITAL_C"] = {"127.0.0.1", 9103};
    m_nodeEndpoints["HOSPITAL_D"] = {"127.0.0.1", 9104};
}

void KsmCluster::registerNode(const std::string& nodeId, uint8_t shareIndex) {
    auto node = std::make_unique<KsmNode>(nodeId, shareIndex, m_storageDir);
    m_nodes[nodeId] = std::move(node);
    if (m_nodeEndpoints.find(nodeId) == m_nodeEndpoints.end()) {
        m_nodeEndpoints[nodeId] = {"127.0.0.1", static_cast<uint16_t>(9100 + shareIndex)};
    }
}

void KsmCluster::registerNodeEndpoint(const std::string& nodeId, const std::string& host, uint16_t port) {
    m_nodeEndpoints[nodeId] = {host, port};
}

bool KsmCluster::sendRemoteShareStore(const std::string& nodeId,
                                      const std::string& txId,
                                      const KeyShare& share,
                                      const std::string& patientId,
                                      const std::string& doctorId) const {
    auto it = m_nodeEndpoints.find(nodeId);
    if (it == m_nodeEndpoints.end()) return false;

    SOCKET sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (sock == INVALID_SOCKET) return false;

    DWORD timeoutMs = 120;
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, reinterpret_cast<const char*>(&timeoutMs), sizeof(timeoutMs));
    setsockopt(sock, SOL_SOCKET, SO_SNDTIMEO, reinterpret_cast<const char*>(&timeoutMs), sizeof(timeoutMs));

    u_long nonBlocking = 1;
    ioctlsocket(sock, FIONBIO, &nonBlocking);

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    inet_pton(AF_INET, it->second.host.c_str(), &addr.sin_addr);
    addr.sin_port = htons(it->second.port);

    connect(sock, reinterpret_cast<sockaddr*>(&addr), sizeof(addr));

    fd_set writeSet;
    FD_ZERO(&writeSet);
    FD_SET(sock, &writeSet);
    timeval tv{0, 60000}; // 60ms connect timeout
    if (select(0, nullptr, &writeSet, nullptr, &tv) <= 0) {
        closesocket(sock);
        return false;
    }

    nonBlocking = 0;
    ioctlsocket(sock, FIONBIO, &nonBlocking);

    std::ostringstream payload;
    payload << "{\"action\":\"STORE_SHARE\",\"tx_id\":\"" << txId
            << "\",\"data_id\":\"" << txId
            << "\",\"patient_id\":\"" << patientId
            << "\",\"doctor_id\":\"" << doctorId
            << "\",\"share_index\":" << static_cast<int>(share.index)
            << ",\"share_hex\":\"" << share.toHex()
            << "\",\"threshold\":" << m_thresholdT
            << ",\"total_nodes\":" << m_nodes.size()
            << ",\"status\":\"ACTIVE\"}\n";
    std::string req = payload.str();
    send(sock, req.c_str(), static_cast<int>(req.size()), 0);

    char buf[2048] = {0};
    int r = recv(sock, buf, sizeof(buf) - 1, 0);
    closesocket(sock);
    if (r <= 0) return false;
    std::string resp(buf, r);
    return resp.find("SHARE_STORED_ACK") != std::string::npos;
}

std::optional<KeyShare> KsmCluster::fetchRemoteShare(const std::string& nodeId,
                                                     const std::string& txId) const {
    auto it = m_nodeEndpoints.find(nodeId);
    if (it == m_nodeEndpoints.end()) return std::nullopt;

    SOCKET sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (sock == INVALID_SOCKET) return std::nullopt;

    DWORD timeoutMs = 120;
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, reinterpret_cast<const char*>(&timeoutMs), sizeof(timeoutMs));
    setsockopt(sock, SOL_SOCKET, SO_SNDTIMEO, reinterpret_cast<const char*>(&timeoutMs), sizeof(timeoutMs));

    u_long nonBlocking = 1;
    ioctlsocket(sock, FIONBIO, &nonBlocking);

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    inet_pton(AF_INET, it->second.host.c_str(), &addr.sin_addr);
    addr.sin_port = htons(it->second.port);

    connect(sock, reinterpret_cast<sockaddr*>(&addr), sizeof(addr));

    fd_set writeSet;
    FD_ZERO(&writeSet);
    FD_SET(sock, &writeSet);
    timeval tv{0, 60000};
    if (select(0, nullptr, &writeSet, nullptr, &tv) <= 0) {
        closesocket(sock);
        return std::nullopt;
    }

    nonBlocking = 0;
    ioctlsocket(sock, FIONBIO, &nonBlocking);

    std::ostringstream payload;
    payload << "{\"action\":\"GET_SHARE\",\"tx_id\":\"" << txId << "\"}\n";
    std::string req = payload.str();
    send(sock, req.c_str(), static_cast<int>(req.size()), 0);

    char buf[4096] = {0};
    int r = recv(sock, buf, sizeof(buf) - 1, 0);
    closesocket(sock);
    if (r <= 0) return std::nullopt;

    std::string resp(buf, r);
    auto hexPos = resp.find("\"share_hex\":\"");
    auto idxPos = resp.find("\"share_index\":");
    if (hexPos == std::string::npos || idxPos == std::string::npos) return std::nullopt;

    hexPos += 13;
    auto hexEnd = resp.find('"', hexPos);
    if (hexEnd == std::string::npos) return std::nullopt;
    std::string shareHex = resp.substr(hexPos, hexEnd - hexPos);

    idxPos += 14;
    uint8_t shareIdx = static_cast<uint8_t>(std::stoi(resp.substr(idxPos, 4)));
    return KeyShare::fromHex(shareIdx, shareHex);
}

void KsmCluster::addNode(std::unique_ptr<KsmNode> node) {
    m_nodes[node->getNodeId()] = std::move(node);
    m_totalN = static_cast<uint32_t>(m_nodes.size());
}

KsmNode* KsmCluster::getNode(const std::string& nodeId) {
    auto it = m_nodes.find(nodeId);
    return (it != m_nodes.end()) ? it->second.get() : nullptr;
}

const KsmNode* KsmCluster::getNode(const std::string& nodeId) const {
    auto it = m_nodes.find(nodeId);
    return (it != m_nodes.end()) ? it->second.get() : nullptr;
}

std::vector<std::string> KsmCluster::getNodeIds() const {
    std::vector<std::string> ids;
    ids.reserve(m_nodes.size());
    for (const auto& [id, _] : m_nodes) {
        ids.push_back(id);
    }
    return ids;
}

EncryptedTxEnvelope KsmCluster::encryptRecord(
    const std::string& schemaType,
    const std::map<std::string, std::string>& fullRecord,
    const std::string& signerType,
    const std::string& senderAddress,
    const std::string& senderPublicKey,
    const std::string& signature) {

    // 1. Separate transaction into Unencrypted Metadata and Clinical Body Payload
    UnencryptedMetadata meta;
    ClinicalBodyPayload body;
    SchemaSplitter::split(schemaType, fullRecord, signerType, senderAddress, senderPublicKey, signature, meta, body);

    meta.thresholdT = m_thresholdT;
    meta.totalN = static_cast<uint32_t>(m_nodes.size());
    meta.participantNodes = getNodeIds();

    // 2. Generate a 256-bit ephemeral Data Encryption Key (DEK)
    std::vector<uint8_t> ephemeralDek = AesGcmCipher::generateRandom(32);

    // 3. Shamir's Secret Sharing: Split DEK into N shares with threshold T (e.g. 3-of-4)
    std::vector<KeyShare> shares = m_sss.splitSecret(ephemeralDek, m_thresholdT, static_cast<uint32_t>(m_nodes.size()), 1);

    // 4. Distribute and store each share in the respective KSM node (via TCP to standalone ksm_core daemon + local SQLite replica)
    size_t shareIdx = 0;
    for (const auto& [nodeId, nodePtr] : m_nodes) {
        if (shareIdx < shares.size()) {
            sendRemoteShareStore(nodeId, meta.txId, shares[shareIdx], meta.patientId, meta.doctorId);
            nodePtr->receiveAndStoreShare(meta.txId, shares[shareIdx], m_thresholdT, static_cast<uint32_t>(m_nodes.size()));
            ++shareIdx;
        }
    }

    // 5. Encrypt the Clinical Body Payload using AES-256-GCM with the DEK
    std::vector<uint8_t> bodyPlaintext = body.serialize();
    AesGcmResult encryptedBody = AesGcmCipher::encrypt(ephemeralDek, bodyPlaintext);

    // 6. Zero out and wipe the ephemeral DEK from memory (Defense in Depth)
    SecureZeroMemory(ephemeralDek.data(), ephemeralDek.size());
    ephemeralDek.clear();

    EncryptedTxEnvelope envelope;
    envelope.metadata = std::move(meta);
    envelope.encryptedBody = std::move(encryptedBody);

    return envelope;
}

std::map<std::string, std::string> KsmCluster::decryptRecord(
    const EncryptedTxEnvelope& envelope,
    const std::vector<std::string>& participatingNodeIds) {

    if (participatingNodeIds.size() < envelope.metadata.thresholdT) {
        throw std::runtime_error("decryptRecord: insufficient participating nodes (provided " +
                                 std::to_string(participatingNodeIds.size()) + ", required threshold " +
                                 std::to_string(envelope.metadata.thresholdT) + ")");
    }

    // 1. Gather shares from the participating hospital nodes (query remote ksm_core daemon first, fallback to local node)
    std::vector<KeyShare> collectedShares;
    collectedShares.reserve(participatingNodeIds.size());

    for (const auto& nodeId : participatingNodeIds) {
        auto shareOpt = fetchRemoteShare(nodeId, envelope.metadata.txId);
        if (!shareOpt) {
            auto nodePtr = getNode(nodeId);
            if (!nodePtr) {
                throw std::runtime_error("decryptRecord: participating node '" + nodeId + "' not found in cluster");
            }
            shareOpt = nodePtr->provideShareForDecryption(envelope.metadata.txId);
        }
        if (!shareOpt) {
            throw std::runtime_error("decryptRecord: node '" + nodeId + "' does not possess a share for tx " + envelope.metadata.txId);
        }
        collectedShares.push_back(*shareOpt);
    }

    // 2. Reconstruct DEK using Lagrange polynomial interpolation over GF(256)
    std::vector<uint8_t> reconstructedDek = m_sss.reconstructSecret(collectedShares, envelope.metadata.thresholdT);

    // 3. Decrypt the AES-256-GCM ciphertext
    std::vector<uint8_t> decryptedPlaintext;
    try {
        decryptedPlaintext = AesGcmCipher::decrypt(
            reconstructedDek,
            envelope.encryptedBody.iv,
            envelope.encryptedBody.tag,
            envelope.encryptedBody.ciphertext
        );
    } catch (const std::exception& ex) {
        SecureZeroMemory(reconstructedDek.data(), reconstructedDek.size());
        throw std::runtime_error(std::string("Threshold Decryption Failed: ") + ex.what());
    }

    // 4. Securely wipe the reconstructed DEK immediately after decryption
    SecureZeroMemory(reconstructedDek.data(), reconstructedDek.size());
    reconstructedDek.clear();

    // 5. Deserialize clinical body and verify cryptographic hash binding
    ClinicalBodyPayload body = ClinicalBodyPayload::deserialize(decryptedPlaintext);
    std::string computedHash = body.computeHash();
    if (computedHash != envelope.metadata.bodyDataHash) {
        throw std::runtime_error("decryptRecord: body data hash integrity mismatch! Expected " +
                                 envelope.metadata.bodyDataHash + " but got " + computedHash);
    }

    // 6. Reassemble full medical record
    return SchemaSplitter::reassemble(envelope.metadata, body);
}

std::vector<uint8_t> KsmCluster::reconstructKeyForTx(
    const std::string& txId,
    const std::vector<std::string>& participatingNodeIds) {

    if (participatingNodeIds.size() < m_thresholdT) {
        throw std::runtime_error("reconstructKeyForTx: insufficient participating nodes");
    }

    std::vector<KeyShare> collectedShares;
    collectedShares.reserve(participatingNodeIds.size());
    for (const auto& nodeId : participatingNodeIds) {
        auto shareOpt = fetchRemoteShare(nodeId, txId);
        if (!shareOpt) {
            auto nodePtr = getNode(nodeId);
            if (!nodePtr) {
                throw std::runtime_error("reconstructKeyForTx: participating node '" + nodeId + "' not found");
            }
            shareOpt = nodePtr->provideShareForDecryption(txId);
        }
        if (!shareOpt) {
            throw std::runtime_error("reconstructKeyForTx: node '" + nodeId + "' missing share for tx " + txId);
        }
        collectedShares.push_back(*shareOpt);
    }

    return m_sss.reconstructSecret(collectedShares, m_thresholdT);
}

} // namespace CKsm
