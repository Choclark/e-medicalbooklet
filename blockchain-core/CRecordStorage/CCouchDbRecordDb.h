#pragma once

#include <string>
#include <map>
#include <vector>
#include <filesystem>
#include <mutex>
#include "IRecordDatabase.h"

namespace CRecordStorage {

// Non-relational document database driver managing CouchDB JSON document collections
class CCouchDbRecordDb : public IRecordDatabase {
public:
    explicit CCouchDbRecordDb(std::filesystem::path storageDir);
    ~CCouchDbRecordDb() override = default;

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
    DatabaseType getDatabaseType() const override { return DatabaseType::NON_RELATIONAL_COUCHDB; }

    std::filesystem::path getDatabaseDir(const std::string& schemaName) const;

private:
    std::filesystem::path m_storageDir;
    mutable std::mutex m_mutex;

    // Cache of documents
    std::map<std::string, std::map<std::string, std::map<std::string, std::string>>> m_documents;

    void loadExistingDocs(const std::string& schemaName);
    std::string serializeToJson(const std::string& dataId,
                                const std::string& patientId,
                                const std::string& doctorId,
                                const std::string& dataHash,
                                const std::map<std::string, std::string>& fields) const;
};

} // namespace CRecordStorage
