#pragma once

#include <string>
#include <map>
#include <memory>
#include <filesystem>
#include <mutex>
#include "StorageType.h"
#include "IRecordDatabase.h"
#include "CSqliteRecordDb.h"
#include "CCouchDbRecordDb.h"

namespace CRecordStorage {

class CRecordStorageManager {
public:
    explicit CRecordStorageManager(const std::filesystem::path& baseDataDir);

    // Register a schema and create its table in either SQLite (.db) or CouchDB
    void registerSchemaStorage(const std::string& schemaName,
                               DatabaseType dbType,
                               const std::vector<std::string>& fieldNames);

    DatabaseType getSchemaDatabaseType(const std::string& schemaName) const;

    // Dispatches a record to its designated database (SQLite or CouchDB)
    bool persistRecord(const std::string& schemaName,
                       const std::string& dataId,
                       const std::string& patientId,
                       const std::string& doctorId,
                       const std::map<std::string, std::string>& fields,
                       const std::string& dataHash);

    // Retrieve off-chain record data from the appropriate database
    std::optional<std::map<std::string, std::string>> retrieveRecord(const std::string& schemaName,
                                                                     const std::string& dataId);

    // Query records in relational SQLite matching filters
    std::vector<std::map<std::string, std::string>> queryRecords(
        const std::string& schemaName,
        const std::map<std::string, std::string>& matchFilters = {});

    // Active record retrieval (filtering out deleted records)
    std::optional<std::map<std::string, std::string>> getActiveRecord(const std::string& schemaName, const std::string& dataId);
    std::vector<std::map<std::string, std::string>> getActiveRecords(const std::string& schemaName);
    bool markDeleted(const std::string& schemaName, const std::string& dataId, uint64_t blockHeight, uint32_t txOrder, const std::string& reason, const std::string& signer);

    // Compute cryptographic hash of off-chain payload
    static std::string calculateDataHash(const std::map<std::string, std::string>& fields);

private:
    std::filesystem::path m_baseDataDir;
    std::unique_ptr<CSqliteRecordDb> m_sqliteDb;
    std::unique_ptr<CCouchDbRecordDb> m_couchDb;

    std::map<std::string, DatabaseType> m_schemaDbMapping;
    mutable std::mutex m_mutex;
};

} // namespace CRecordStorage
