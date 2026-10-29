#include "CRecordStorageManager.h"
#include "CCrypto/Sha256.h"
#include <iostream>
#include <sstream>

namespace CRecordStorage {

CRecordStorageManager::CRecordStorageManager(const std::filesystem::path& baseDataDir)
    : m_baseDataDir(baseDataDir),
      m_sqliteDb(std::make_unique<CSqliteRecordDb>(baseDataDir / "sqlite_records")),
      m_couchDb(std::make_unique<CCouchDbRecordDb>(baseDataDir / "couchdb_records")) {
    std::filesystem::create_directories(m_baseDataDir);
}

void CRecordStorageManager::registerSchemaStorage(const std::string& schemaName,
                                                 DatabaseType dbType,
                                                 const std::vector<std::string>& fieldNames) {
    std::lock_guard<std::mutex> lock(m_mutex);
    m_schemaDbMapping[schemaName] = dbType;

    if (dbType == DatabaseType::RELATIONAL_SQLITE) {
        m_sqliteDb->createSchemaTable(schemaName, fieldNames);
    } else {
        m_couchDb->createSchemaTable(schemaName, fieldNames);
    }
}

DatabaseType CRecordStorageManager::getSchemaDatabaseType(const std::string& schemaName) const {
    std::lock_guard<std::mutex> lock(m_mutex);
    auto it = m_schemaDbMapping.find(schemaName);
    if (it != m_schemaDbMapping.end()) {
        return it->second;
    }
    return DatabaseType::RELATIONAL_SQLITE;
}

std::string CRecordStorageManager::calculateDataHash(const std::map<std::string, std::string>& fields) {
    std::stringstream ss;
    for (const auto& [k, v] : fields) {
        ss << k << "=" << v << ";";
    }
    return CCrypto::Sha256::hashHex(ss.str());
}

bool CRecordStorageManager::persistRecord(const std::string& schemaName,
                                         const std::string& dataId,
                                         const std::string& patientId,
                                         const std::string& doctorId,
                                         const std::map<std::string, std::string>& fields,
                                         const std::string& dataHash) {
    std::lock_guard<std::mutex> lock(m_mutex);
    DatabaseType dbType = DatabaseType::RELATIONAL_SQLITE;

    auto it = m_schemaDbMapping.find(schemaName);
    if (it != m_schemaDbMapping.end()) {
        dbType = it->second;
    }

    if (dbType == DatabaseType::RELATIONAL_SQLITE) {
        return m_sqliteDb->insertRecord(schemaName, dataId, patientId, doctorId, fields, dataHash);
    } else {
        return m_couchDb->insertRecord(schemaName, dataId, patientId, doctorId, fields, dataHash);
    }
}

std::optional<std::map<std::string, std::string>> CRecordStorageManager::retrieveRecord(
    const std::string& schemaName, const std::string& dataId) {
    std::lock_guard<std::mutex> lock(m_mutex);
    DatabaseType dbType = DatabaseType::RELATIONAL_SQLITE;

    auto it = m_schemaDbMapping.find(schemaName);
    if (it != m_schemaDbMapping.end()) {
        dbType = it->second;
    }

    if (dbType == DatabaseType::RELATIONAL_SQLITE) {
        return m_sqliteDb->getRecord(schemaName, dataId);
    } else {
        return m_couchDb->getRecord(schemaName, dataId);
    }
}

std::vector<std::map<std::string, std::string>> CRecordStorageManager::queryRecords(
    const std::string& schemaName,
    const std::map<std::string, std::string>& matchFilters) {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (m_sqliteDb) {
        return m_sqliteDb->queryRecords(schemaName, matchFilters);
    }
    return {};
}

std::optional<std::map<std::string, std::string>> CRecordStorageManager::getActiveRecord(
    const std::string& schemaName, const std::string& dataId) {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (m_sqliteDb) {
        return m_sqliteDb->getActiveRecord(schemaName, dataId);
    }
    return retrieveRecord(schemaName, dataId);
}

std::vector<std::map<std::string, std::string>> CRecordStorageManager::getActiveRecords(const std::string& schemaName) {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (m_sqliteDb) {
        return m_sqliteDb->getActiveRecords(schemaName);
    }
    return {};
}

bool CRecordStorageManager::markDeleted(const std::string& schemaName,
                                       const std::string& dataId,
                                       uint64_t blockHeight,
                                       uint32_t txOrder,
                                       const std::string& reason,
                                       const std::string& signer) {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (m_sqliteDb) {
        return m_sqliteDb->markDeleted(schemaName, dataId, blockHeight, txOrder, reason, signer);
    }
    return false;
}

} // namespace CRecordStorage


