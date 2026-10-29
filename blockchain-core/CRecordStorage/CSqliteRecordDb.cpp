#include "CSqliteRecordDb.h"
#include "CCommon/Serializer.h"
#include "CCommon/Crc32.h"
#include <fstream>
#include <iostream>
#include <sstream>

namespace CRecordStorage {

namespace {
constexpr uint32_t SQLITE_BIN_MAGIC = 0x5244454Du; // "MEDR"

std::string escapeSqlValue(const std::string& val) {
    std::string out;
    out.reserve(val.size());
    for (char c : val) {
        if (c == '\'') out += "''";
        else if (c == '\n' || c == '\r') out += ' ';
        else out += c;
    }
    return out;
}
} // namespace

CSqliteRecordDb::CSqliteRecordDb(std::filesystem::path storageDir)
    : m_storageDir(std::move(storageDir)) {
    std::filesystem::create_directories(m_storageDir);
}

std::filesystem::path CSqliteRecordDb::getDatabasePath(const std::string& schemaName) const {
    return m_storageDir / (schemaName + ".db");
}

void CSqliteRecordDb::createSchemaTable(const std::string& schemaName,
                                        const std::vector<std::string>& fieldNames) {
    std::lock_guard<std::mutex> lock(m_mutex);
    std::vector<std::string> allCols = fieldNames;
    auto addColIfMissing = [&](const std::string& c) {
        for (const auto& existing : allCols) {
            if (existing == c) return;
        }
        allCols.push_back(c);
    };
    addColIfMissing("block_height");
    addColIfMissing("tx_order");
    addColIfMissing("tx_id");
    addColIfMissing("is_deleted");
    addColIfMissing("version");
    addColIfMissing("operation");
    addColIfMissing("ciphertext_hex");
    addColIfMissing("iv_hex");
    addColIfMissing("auth_tag_hex");
    addColIfMissing("body_data_hash");
    addColIfMissing("deletion_reason");
    addColIfMissing("deletion_block");
    addColIfMissing("deletion_tx_order");
    addColIfMissing("deleted_by");
    addColIfMissing("last_modified_block");
    addColIfMissing("last_modified_tx_order");

    m_tableColumns[schemaName] = allCols;

    std::filesystem::path dbPath = getDatabasePath(schemaName);
    bool exists = std::filesystem::exists(dbPath);

    if (exists) {
        loadExistingDb(schemaName);
        return;
    }

    // Write initial SQLite DDL statement into the .db file
    std::ofstream out(dbPath, std::ios::app);
    if (!out.is_open()) {
        std::cerr << "[SQLite] Error creating " << dbPath.string() << "\n";
        return;
    }

    std::stringstream sql;
    sql << "-- SQLite Relational Schema Storage\n";
    sql << "CREATE TABLE IF NOT EXISTS " << schemaName << " (\n";
    sql << "    data_id TEXT PRIMARY KEY,\n";
    sql << "    patient_id TEXT NOT NULL,\n";
    sql << "    doctor_id TEXT NOT NULL,\n";
    sql << "    data_hash TEXT NOT NULL";
    for (const auto& col : allCols) {
        sql << ",\n    " << col << " TEXT";
    }
    sql << "\n);\n\n";

    out << sql.str();
    out.flush();
    std::cout << "[SQLite] Created relational database table in " << dbPath.string() << "\n";
}

void CSqliteRecordDb::loadExistingDb(const std::string& schemaName) {
    // 1. Primary Binary Length-Prefixed + CRC32-Verified Index Log (<schemaName>.bin)
    std::filesystem::path binPath = m_storageDir / (schemaName + ".bin");
    if (std::filesystem::exists(binPath)) {
        std::ifstream binIn(binPath, std::ios::binary | std::ios::ate);
        if (binIn.is_open()) {
            auto fSize = binIn.tellg();
            if (fSize > 0) {
                binIn.seekg(0, std::ios::beg);
                std::vector<uint8_t> buf(static_cast<size_t>(fSize));
                if (binIn.read(reinterpret_cast<char*>(buf.data()), fSize)) {
                    ByteReader reader(buf.data(), buf.size());
                    while (reader.remaining() >= 12) {
                        uint32_t magic = reader.readU32();
                        uint32_t payloadLen = reader.readU32();
                        uint32_t expectedCrc = reader.readU32();
                        if (magic != SQLITE_BIN_MAGIC || reader.remaining() < payloadLen) break;

                        const uint8_t* framePtr = reader.readBytes(payloadLen);
                        if (crc32(framePtr, payloadLen) != expectedCrc) {
                            std::cerr << "[SQLite] CRC32 mismatch in binary record log " << binPath.string() << "\n";
                            break;
                        }
                        ByteReader frameReader(framePtr, payloadLen);
                        std::string dataId = frameReader.readString();
                        uint32_t fieldCount = frameReader.readU32();
                        std::map<std::string, std::string> rowFields;
                        for (uint32_t i = 0; i < fieldCount; ++i) {
                            std::string k = frameReader.readString();
                            std::string v = frameReader.readString();
                            rowFields[k] = v;
                        }
                        if (!dataId.empty()) {
                            m_cache[schemaName][dataId] = std::move(rowFields);
                        }
                    }
                    return;
                }
            }
        }
    }

    // 2. Legacy Fallback: Parse human-readable SQLite .db file
    std::filesystem::path dbPath = getDatabasePath(schemaName);
    std::ifstream in(dbPath);
    if (!in.is_open()) return;

    std::string line;
    while (std::getline(in, line)) {
        if (line.rfind("INSERT INTO ", 0) == 0) {
            size_t valPos = line.find("VALUES (");
            if (valPos == std::string::npos) continue;

            std::string content = line.substr(valPos + 8);
            if (!content.empty() && content.back() == ';') content.pop_back();
            if (!content.empty() && content.back() == ')') content.pop_back();

            std::vector<std::string> values;
            std::stringstream ss(content);
            std::string token;
            while (std::getline(ss, token, '\'')) {
                if (token != ", " && !token.empty()) {
                    values.push_back(token);
                }
            }

            if (values.size() >= 4) {
                std::string dataId = values[0];
                std::string patientId = values[1];
                std::string doctorId = values[2];
                std::string dataHash = values[3];

                std::map<std::string, std::string> rowFields;
                rowFields["data_id"] = dataId;
                rowFields["patient_id"] = patientId;
                rowFields["doctor_id"] = doctorId;
                rowFields["data_hash"] = dataHash;

                const auto& cols = m_tableColumns[schemaName];
                for (size_t i = 0; i < cols.size() && (4 + i) < values.size(); ++i) {
                    rowFields[cols[i]] = values[4 + i];
                }
                m_cache[schemaName][dataId] = rowFields;
            }
        }
    }
}

void CSqliteRecordDb::appendSqlRow(const std::string& schemaName,
                                   const std::string& dataId,
                                   const std::string& patientId,
                                   const std::string& doctorId,
                                   const std::string& dataHash,
                                   const std::map<std::string, std::string>& fields) {
    // 1. Append binary length-prefixed + CRC32-verified frame to <schemaName>.bin
    std::filesystem::path binPath = m_storageDir / (schemaName + ".bin");
    {
        ByteWriter frameWriter;
        frameWriter.writeString(dataId);
        frameWriter.writeU32(static_cast<uint32_t>(fields.size()));
        for (const auto& [k, v] : fields) {
            frameWriter.writeString(k);
            frameWriter.writeString(v);
        }
        const auto& payload = frameWriter.data();
        uint32_t crc = crc32(payload.data(), payload.size());

        ByteWriter outerWriter;
        outerWriter.writeU32(SQLITE_BIN_MAGIC);
        outerWriter.writeU32(static_cast<uint32_t>(payload.size()));
        outerWriter.writeU32(crc);
        outerWriter.writeBytes(payload.data(), payload.size());

        std::ofstream binOut(binPath, std::ios::binary | std::ios::app);
        if (binOut.is_open()) {
            const auto& outBytes = outerWriter.data();
            binOut.write(reinterpret_cast<const char*>(outBytes.data()),
                         static_cast<std::streamsize>(outBytes.size()));
            binOut.flush();
        }
    }

    // 2. Append SQL statement (with escaped quotes/newlines) to <schemaName>.db
    std::filesystem::path dbPath = getDatabasePath(schemaName);
    std::ofstream out(dbPath, std::ios::app);
    if (!out.is_open()) return;

    std::stringstream sql;
    sql << "INSERT INTO " << schemaName << " VALUES ('"
        << escapeSqlValue(dataId) << "', '"
        << escapeSqlValue(patientId) << "', '"
        << escapeSqlValue(doctorId) << "', '"
        << escapeSqlValue(dataHash) << "'";

    const auto& cols = m_tableColumns[schemaName];
    for (const auto& col : cols) {
        auto it = fields.find(col);
        std::string val = (it != fields.end()) ? it->second : "";
        sql << ", '" << escapeSqlValue(val) << "'";
    }
    sql << ");\n";

    out << sql.str();
    out.flush();
}

bool CSqliteRecordDb::insertRecord(const std::string& schemaName,
                                   const std::string& dataId,
                                   const std::string& patientId,
                                   const std::string& doctorId,
                                   const std::map<std::string, std::string>& fields,
                                   const std::string& dataHash) {
    std::lock_guard<std::mutex> lock(m_mutex);

    auto& fullRecord = m_cache[schemaName][dataId];
    for (const auto& [k, v] : fields) {
        fullRecord[k] = v;
    }
    fullRecord["data_id"] = dataId;
    fullRecord["patient_id"] = patientId;
    fullRecord["doctor_id"] = doctorId;
    fullRecord["data_hash"] = dataHash;

    appendSqlRow(schemaName, dataId, patientId, doctorId, dataHash, fullRecord);

    std::cout << "[SQLite] Inserted/Updated record ID=" << dataId << " into "
              << getDatabasePath(schemaName).string() << "\n";
    return true;
}

std::optional<std::map<std::string, std::string>> CSqliteRecordDb::getRecord(const std::string& schemaName,
                                                                             const std::string& dataId) {
    std::lock_guard<std::mutex> lock(m_mutex);
    auto schemaIt = m_cache.find(schemaName);
    if (schemaIt != m_cache.end()) {
        auto recIt = schemaIt->second.find(dataId);
        if (recIt != schemaIt->second.end()) {
            return recIt->second;
        }
    }
    // Fallback: search across all cached schemas
    for (const auto& [sName, rows] : m_cache) {
        auto recIt = rows.find(dataId);
        if (recIt != rows.end()) {
            return recIt->second;
        }
    }
    return std::nullopt;
}

bool CSqliteRecordDb::hasRecord(const std::string& schemaName, const std::string& dataId) {
    std::lock_guard<std::mutex> lock(m_mutex);
    auto schemaIt = m_cache.find(schemaName);
    if (schemaIt != m_cache.end()) {
        return schemaIt->second.find(dataId) != schemaIt->second.end();
    }
    for (const auto& [sName, rows] : m_cache) {
        if (rows.find(dataId) != rows.end()) return true;
    }
    return false;
}

std::vector<std::map<std::string, std::string>> CSqliteRecordDb::queryRecords(
    const std::string& schemaName,
    const std::map<std::string, std::string>& matchFilters) {
    std::lock_guard<std::mutex> lock(m_mutex);
    std::vector<std::map<std::string, std::string>> results;
    auto itSchema = m_cache.find(schemaName);
    if (itSchema == m_cache.end()) return results;

    for (const auto& [dataId, row] : itSchema->second) {
        bool match = true;
        for (const auto& [filterKey, filterVal] : matchFilters) {
            auto itField = row.find(filterKey);
            if (itField == row.end() || itField->second != filterVal) {
                match = false;
                break;
            }
        }
        if (match) {
            results.push_back(row);
        }
    }
    return results;
}

std::optional<std::map<std::string, std::string>> CSqliteRecordDb::getActiveRecord(
    const std::string& schemaName, const std::string& dataId) {
    std::lock_guard<std::mutex> lock(m_mutex);
    auto itSchema = m_cache.find(schemaName);
    if (itSchema != m_cache.end()) {
        auto itRow = itSchema->second.find(dataId);
        if (itRow != itSchema->second.end()) {
            auto itDel = itRow->second.find("is_deleted");
            if (itDel != itRow->second.end() && itDel->second == "1") {
                return std::nullopt; // Filtered: record was deleted!
            }
            return itRow->second;
        }
    }

    // Fallback search across all schemas
    for (const auto& [sName, rows] : m_cache) {
        auto itRow = rows.find(dataId);
        if (itRow != rows.end()) {
            auto itDel = itRow->second.find("is_deleted");
            if (itDel != itRow->second.end() && itDel->second == "1") {
                return std::nullopt; // Filtered: record was deleted!
            }
            return itRow->second;
        }
    }
    return std::nullopt;
}

std::vector<std::map<std::string, std::string>> CSqliteRecordDb::getActiveRecords(const std::string& schemaName) {
    std::lock_guard<std::mutex> lock(m_mutex);
    std::vector<std::map<std::string, std::string>> results;
    auto itSchema = m_cache.find(schemaName);
    if (itSchema == m_cache.end()) return results;

    for (const auto& [dataId, row] : itSchema->second) {
        auto itDel = row.find("is_deleted");
        if (itDel != row.end() && itDel->second == "1") {
            continue; // Filter out deleted records
        }
        results.push_back(row);
    }
    return results;
}

bool CSqliteRecordDb::markDeleted(const std::string& schemaName,
                                  const std::string& dataId,
                                  uint64_t blockHeight,
                                  uint32_t txOrder,
                                  const std::string& reason,
                                  const std::string& signer) {
    std::lock_guard<std::mutex> lock(m_mutex);
    auto itSchema = m_cache.find(schemaName);
    if (itSchema != m_cache.end()) {
        auto itRow = itSchema->second.find(dataId);
        if (itRow != itSchema->second.end()) {
            itRow->second["is_deleted"] = "1";
            itRow->second["operation"] = "DELETE";
            itRow->second["deletion_block"] = std::to_string(blockHeight);
            itRow->second["deletion_tx_order"] = std::to_string(txOrder);
            itRow->second["deletion_reason"] = reason;
            itRow->second["deleted_by"] = signer;

            std::filesystem::path dbPath = getDatabasePath(schemaName);
            std::ofstream out(dbPath, std::ios::app);
            if (out.is_open()) {
                out << "-- DELETION EVENT (Soft-deleted in off-chain DB, anchored in Block #" << blockHeight << ")\n";
                out << "UPDATE " << schemaName << " SET is_deleted = 1, operation = 'DELETE' WHERE data_id = '" << dataId << "';\n";
            }
            return true;
        }
    }

    // Fallback: search across all cached schemas
    for (auto& [sName, rows] : m_cache) {
        auto itRow = rows.find(dataId);
        if (itRow != rows.end()) {
            itRow->second["is_deleted"] = "1";
            itRow->second["operation"] = "DELETE";
            itRow->second["deletion_block"] = std::to_string(blockHeight);
            itRow->second["deletion_tx_order"] = std::to_string(txOrder);
            itRow->second["deletion_reason"] = reason;
            itRow->second["deleted_by"] = signer;

            std::filesystem::path dbPath = getDatabasePath(sName);
            std::ofstream out(dbPath, std::ios::app);
            if (out.is_open()) {
                out << "-- DELETION EVENT (Soft-deleted in off-chain DB, anchored in Block #" << blockHeight << ")\n";
                out << "UPDATE " << sName << " SET is_deleted = 1, operation = 'DELETE' WHERE data_id = '" << dataId << "';\n";
            }
            return true;
        }
    }

    return false;
}

} // namespace CRecordStorage


