#include "KsmNode.h"
#include <iostream>

namespace CKsm {

KsmNode::KsmNode(std::string nodeId, uint8_t shareIndex, std::filesystem::path storageDir)
    : m_nodeId(std::move(nodeId)), m_shareIndex(shareIndex) {
    std::filesystem::path dbFile = storageDir / (m_nodeId + "_shares.db");
    m_storage = std::make_unique<KsmShareStorage>(dbFile);
}

bool KsmNode::receiveAndStoreShare(const std::string& txId,
                                  const KeyShare& share,
                                  uint32_t thresholdT,
                                  uint32_t totalN,
                                  const std::string& doctorId,
                                  const std::string& patientId,
                                  const std::string& dataId,
                                  int64_t accessKeyTime,
                                  const std::string& status) {
    if (!m_isOnline) {
        std::cerr << "[KsmNode " << m_nodeId << "] Rejecting share: node is offline.\n";
        return false;
    }
    return m_storage->storeShare(txId, share, thresholdT, totalN, doctorId, patientId, dataId, accessKeyTime, status);
}

bool KsmNode::isShareAccessValid(const std::string& txId, const std::string& doctorId, int64_t currentTime) const {
    if (!m_isOnline) return false;
    return m_storage->isShareAccessValid(txId, doctorId, currentTime);
}

std::optional<KeyShare> KsmNode::provideShareForDecryption(const std::string& txId) const {
    if (!m_isOnline) {
        std::cerr << "[KsmNode " << m_nodeId << "] Cannot provide share: node is offline.\n";
        return std::nullopt;
    }
    return m_storage->getShare(txId);
}

std::optional<KeyShare> KsmNode::provideShareForCatchup(const std::string& txId) const {
    if (!m_isOnline) {
        return std::nullopt;
    }
    return m_storage->getShare(txId);
}

bool KsmNode::hasShare(const std::string& txId) const {
    return m_storage->hasShare(txId);
}

size_t KsmNode::getStoredShareCount() const {
    return m_storage->getShareCount();
}

std::vector<std::string> KsmNode::getAllTxIds() const {
    return m_storage->getAllTxIds();
}

std::filesystem::path KsmNode::getDatabasePath() const {
    return m_storage->getDatabasePath();
}

} // namespace CKsm
