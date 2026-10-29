#pragma once

#include <string>
#include <memory>
#include <vector>
#include "KsmShareStorage.h"

namespace CKsm {

class KsmNode {
public:
    KsmNode(std::string nodeId, uint8_t shareIndex, std::filesystem::path storageDir);

    const std::string& getNodeId() const { return m_nodeId; }
    uint8_t getShareIndex() const { return m_shareIndex; }
    bool isOnline() const { return m_isOnline; }
    void setOnline(bool online) { m_isOnline = online; }

    // Store a newly generated or catch-up share with doctor/patient/access validity
    bool receiveAndStoreShare(const std::string& txId,
                              const KeyShare& share,
                              uint32_t thresholdT,
                              uint32_t totalN,
                              const std::string& doctorId = "",
                              const std::string& patientId = "",
                              const std::string& dataId = "",
                              int64_t accessKeyTime = 0,
                              const std::string& status = "ACTIVE");

    // Check share access validity window
    bool isShareAccessValid(const std::string& txId, const std::string& doctorId, int64_t currentTime) const;

    // Provide share to threshold coordinator for decryption
    std::optional<KeyShare> provideShareForDecryption(const std::string& txId) const;

    // Provide share to quorum for dynamic catchup of a new incoming node
    std::optional<KeyShare> provideShareForCatchup(const std::string& txId) const;

    bool hasShare(const std::string& txId) const;
    size_t getStoredShareCount() const;
    std::vector<std::string> getAllTxIds() const;
    std::filesystem::path getDatabasePath() const;

private:
    std::string m_nodeId;
    uint8_t m_shareIndex;
    bool m_isOnline{true};
    std::unique_ptr<KsmShareStorage> m_storage;
};

} // namespace CKsm
