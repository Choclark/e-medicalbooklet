#include "CPbftEngine.h"
#include "CCrypto/Sha256.h"
#include <sstream>

namespace CConsensus {

CPbftEngine::CPbftEngine(std::vector<std::string> validators)
    : m_validators(std::move(validators)) {
    for (const auto& valId : m_validators) {
        m_validatorKeys[valId] = CCrypto::CryptoSigner::generateKeyPair();
    }
}

uint64_t CPbftEngine::getViewNumber() const {
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_viewNumber;
}

std::string CPbftEngine::getPrimaryNode() const {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (m_validators.empty()) return "standalone_node";
    return m_validators[m_viewNumber % m_validators.size()];
}

uint32_t CPbftEngine::getQuorumSize() const {
    std::lock_guard<std::mutex> lock(m_mutex);
    uint32_t n = static_cast<uint32_t>(m_validators.size());
    uint32_t f = (n >= 4) ? (n - 1) / 3 : 0;
    return 2 * f + 1;
}

void CPbftEngine::advanceView() {
    std::lock_guard<std::mutex> lock(m_mutex);
    m_viewNumber++;
}

ConsensusMetadata CPbftEngine::createCommitProof(uint64_t sequenceNumber, const std::string& blockHash) {
    std::lock_guard<std::mutex> lock(m_mutex);
    std::string primary = m_validators[m_viewNumber % m_validators.size()];

    uint32_t quorum = (static_cast<uint32_t>(m_validators.size()) >= 4)
                        ? 2 * ((static_cast<uint32_t>(m_validators.size()) - 1) / 3) + 1
                        : static_cast<uint32_t>(m_validators.size());

    std::stringstream cert;
    cert << "PBFT_COMMIT_PROOF[View=" << m_viewNumber << ",Seq=" << sequenceNumber << ",Quorum=" << quorum << "]:{";
    for (uint32_t i = 0; i < quorum; ++i) {
        if (i > 0) cert << "+";
        const std::string& valId = m_validators[i];
        std::string payload = valId + ":" + std::to_string(m_viewNumber) + ":" + std::to_string(sequenceNumber) + ":" + blockHash;
        auto itKey = m_validatorKeys.find(valId);
        if (itKey != m_validatorKeys.end()) {
            std::string sigHex = CCrypto::CryptoSigner::sign(payload, itKey->second.privateKeyHex);
            cert << "ECDSA(" << valId << "|" << itKey->second.publicKeyHex << "|" << sigHex << ")";
        } else {
            cert << "SIG(" << valId << "=" << CCrypto::Sha256::hashHex(payload).substr(0, 16) << ")";
        }
    }
    cert << "}";

    ConsensusMetadata meta;
    meta.viewNumber = m_viewNumber;
    meta.sequenceNumber = sequenceNumber;
    meta.proposerId = primary;
    meta.commitCertificate = cert.str();
    return meta;
}

bool CPbftEngine::verifyCommitProof(const ConsensusMetadata& metadata, const std::string& blockHash) const {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (metadata.commitCertificate.empty()) return false;
    if (metadata.commitCertificate.find("PBFT_COMMIT_PROOF") == std::string::npos) return false;

    uint32_t n = static_cast<uint32_t>(m_validators.size());
    uint32_t f = (n >= 4) ? (n - 1) / 3 : 0;
    uint32_t requiredQuorum = 2 * f + 1;

    // If the certificate embeds ECDSA(validatorId|pubKeyHex|sigHex) entries, cryptographically verify at least 2f + 1
    size_t searchPos = 0;
    uint32_t verifiedCount = 0;
    bool hasEcdsaEntries = (metadata.commitCertificate.find("ECDSA(") != std::string::npos);

    while (hasEcdsaEntries) {
        size_t start = metadata.commitCertificate.find("ECDSA(", searchPos);
        if (start == std::string::npos) break;
        start += 6;
        size_t end = metadata.commitCertificate.find(')', start);
        if (end == std::string::npos) break;

        std::string token = metadata.commitCertificate.substr(start, end - start);
        size_t p1 = token.find('|');
        size_t p2 = (p1 != std::string::npos) ? token.find('|', p1 + 1) : std::string::npos;
        if (p1 != std::string::npos && p2 != std::string::npos) {
            std::string valId = token.substr(0, p1);
            std::string pubKeyHex = token.substr(p1 + 1, p2 - p1 - 1);
            std::string sigHex = token.substr(p2 + 1);
            std::string payload = valId + ":" + std::to_string(metadata.viewNumber) + ":" + std::to_string(metadata.sequenceNumber) + ":" + blockHash;
            if (CCrypto::CryptoSigner::verify(payload, sigHex, pubKeyHex)) {
                verifiedCount++;
            }
        }
        searchPos = end + 1;
    }

    if (hasEcdsaEntries) {
        return verifiedCount >= requiredQuorum;
    }
    return true;
}

} // namespace CConsensus
