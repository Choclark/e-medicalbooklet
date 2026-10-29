#pragma once

#include <string>
#include <map>
#include <vector>
#include <optional>
#include "StorageType.h"

namespace CRecordStorage {

class IRecordDatabase {
public:
    virtual ~IRecordDatabase() = default;

    // Called on schema creation to initialize the table or collection
    virtual void createSchemaTable(const std::string& schemaName,
                                   const std::vector<std::string>& fieldNames) = 0;

    // Insert payload after block validation
    virtual bool insertRecord(const std::string& schemaName,
                              const std::string& dataId,
                              const std::string& patientId,
                              const std::string& doctorId,
                              const std::map<std::string, std::string>& fields,
                              const std::string& dataHash) = 0;

    // Retrieve off-chain medical record payload by dataId
    virtual std::optional<std::map<std::string, std::string>> getRecord(const std::string& schemaName,
                                                                        const std::string& dataId) = 0;

    virtual bool hasRecord(const std::string& schemaName, const std::string& dataId) = 0;
    virtual DatabaseType getDatabaseType() const = 0;
};

} // namespace CRecordStorage
