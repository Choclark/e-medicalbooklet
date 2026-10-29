#pragma once

#include <string>
#include <vector>
#include <map>
#include <mutex>
#include <filesystem>
#include <optional>
#include "../CShamir/ShamirSecretSharing.h"

namespace CKsm {

struct StoredShareRecord {
    std::string txId;
    std::string dataId;
    std::string doctorId;
    std::string patientId;
    uint8_t shareIndex{0};
    std::string shareHex;       // encryption key share
    int64_t accessKeyTime{0};   // access key expiration / validity window
    uint32_t thresholdT{3};
    uint32_t totalN{4};
    int64_t createdAt{0};
    std::string status{"ACTIVE"};
};

class KsmShareStorage {
public:
    explicit KsmShareStorage(std::filesystem::path dbPath);
    ~KsmShareStorage() = default;

    // Store a share in the SQLite database associated with txId, doctorId, patientId, accessKeyTime
    bool storeShare(const std::string& txId,
                    const KeyShare& share,
                    uint32_t thresholdT,
                    uint32_t totalN,
                    const std::string& doctorId = "",
                    const std::string& patientId = "",
                    const std::string& dataId = "",
                    int64_t accessKeyTime = 0,
                    const std::string& status = "ACTIVE");

    // Retrieve a share for a given txId
    std::optional<KeyShare> getShare(const std::string& txId) const;

    // Check if node holds a share for txId
    bool hasShare(const std::string& txId) const;

    // Check share validity window for access
    bool isShareAccessValid(const std::string& txId, const std::string& doctorId, int64_t currentTime) const;

    // Get metadata record for txId
    std::optional<StoredShareRecord> getRecord(const std::string& txId) const;

    // List all stored transaction IDs
    std::vector<std::string> getAllTxIds() const;

    // Get count of stored shares
    size_t getShareCount() const;

    std::filesystem::path getDatabasePath() const { return m_dbPath; }

private:
    std::filesystem::path m_dbPath;
    mutable std::mutex m_mutex;
    std::map<std::string, StoredShareRecord> m_cache;

    void initializeDb();
    void loadFromDisk();
    void appendSqlRow(const StoredShareRecord& record);
};

} // namespace CKsm
