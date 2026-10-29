#pragma once

#include <string>
#include <unordered_map>
#include <mutex>
#include <memory>
#include <optional>
#include "CSchema.h"
#include "CCommon/ValidationResult.h"

namespace CRecordStorage {
class CRecordStorageManager;
}

class CSchemaRegistry {
public:
    explicit CSchemaRegistry(uint64_t memoryLimitBytes = 1ULL * 1024 * 1024 * 1024);

    bool registerSchema(const CSchemaDef::CSchema& schema);
    std::optional<CSchemaDef::CSchema> getSchema(const std::string& schemaName) const;
    bool hasSchema(const std::string& schemaName) const;

    // Evaluates LAW-1 SCHEMA for incoming transactions
    ValidationResult validateTransaction(const CTransaction& tx) const;

    size_t getSchemaCount() const;
    uint64_t getMemoryUsedBytes() const;
    uint64_t getMemoryLimitBytes() const { return m_memoryLimitBytes; }

    void setRecordStorageManager(CRecordStorage::CRecordStorageManager* mgr);
    void loadStandardMedicalSchemas();
    void loadRegistrationSchemas();

private:
    uint64_t m_memoryLimitBytes;
    uint64_t m_currentMemoryUsed{0};
    std::unordered_map<std::string, CSchemaDef::CSchema> m_schemas;
    CRecordStorage::CRecordStorageManager* m_storageManager{nullptr};
    mutable std::mutex m_mutex;
};
