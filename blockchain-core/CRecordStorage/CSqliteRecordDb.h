#pragma once

#include <string>
#include <map>
#include <vector>
#include <filesystem>
#include <mutex>
#include "IRecordDatabase.h"

namespace CRecordStorage {

// Relational storage driver managing SQLite .db files for schemas
class CSqliteRecordDb : public IRecordDatabase {
public:
    explicit CSqliteRecordDb(std::filesystem::path storageDir);
    ~CSqliteRecordDb() override = default;

    void createSchemaTable(const std::string& schemaName,
                           const std::vector<std::string>& fieldNames) override;

    bool insertRecord(const std::string& schemaName,
                      const std::string& dataId,
                      const std::string& patientId,
                      const std::string& doctorId,
                      const std::map<std::string, std::string>& fields,
                      const std::string& dataHash) override;

    std::optional<std::map<std::string, std::string>> getRecord(const std::string& schemaName,
                                                                const std::string& dataId) override;

    bool hasRecord(const std::string& schemaName, const std::string& dataId) override;
    DatabaseType getDatabaseType() const override { return DatabaseType::RELATIONAL_SQLITE; }

    std::vector<std::map<std::string, std::string>> queryRecords(
        const std::string& schemaName,
        const std::map<std::string, std::string>& matchFilters = {});

    // Active record queries (filtering out deleted records for up-to-date display)
    std::optional<std::map<std::string, std::string>> getActiveRecord(const std::string& schemaName, const std::string& dataId);
    std::vector<std::map<std::string, std::string>> getActiveRecords(const std::string& schemaName);
    bool markDeleted(const std::string& schemaName, const std::string& dataId, uint64_t blockHeight, uint32_t txOrder, const std::string& reason, const std::string& signer);

    std::filesystem::path getDatabasePath(const std::string& schemaName) const;

private:
    std::filesystem::path m_storageDir;
    mutable std::mutex m_mutex;

    // Cache of table columns
    std::map<std::string, std::vector<std::string>> m_tableColumns;
    // In-memory indexing of rows for fast O(1) query + disk persistence in .db
    std::map<std::string, std::map<std::string, std::map<std::string, std::string>>> m_cache;

    void loadExistingDb(const std::string& schemaName);
    void appendSqlRow(const std::string& schemaName,
                      const std::string& dataId,
                      const std::string& patientId,
                      const std::string& doctorId,
                      const std::string& dataHash,
                      const std::map<std::string, std::string>& fields);
};

} // namespace CRecordStorage
