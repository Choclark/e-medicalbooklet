#include "CCouchDbRecordDb.h"
#include <fstream>
#include <iostream>
#include <sstream>

namespace CRecordStorage {

CCouchDbRecordDb::CCouchDbRecordDb(std::filesystem::path storageDir)
    : m_storageDir(std::move(storageDir)) {
    std::filesystem::create_directories(m_storageDir);
}

std::filesystem::path CCouchDbRecordDb::getDatabaseDir(const std::string& schemaName) const {
    return m_storageDir / (schemaName + "_couchdb");
}

void CCouchDbRecordDb::createSchemaTable(const std::string& schemaName,
                                         const std::vector<std::string>& /*fieldNames*/) {
    std::lock_guard<std::mutex> lock(m_mutex);
    std::filesystem::path collDir = getDatabaseDir(schemaName);
    std::filesystem::create_directories(collDir);

    // Create database metadata / design document
    std::filesystem::path metaFile = collDir / "_design_metadata.json";
    if (!std::filesystem::exists(metaFile)) {
        std::ofstream out(metaFile);
        out << "{\n"
            << "  \"_id\": \"_design/" << schemaName << "\",\n"
            << "  \"db_type\": \"COUCHDB_NON_RELATIONAL\",\n"
            << "  \"schema\": \"" << schemaName << "\",\n"
            << "  \"language\": \"javascript\"\n"
            << "}\n";
        out.close();
        std::cout << "[CouchDB] Initialized document database collection at " << collDir.string() << "\n";
    }

    loadExistingDocs(schemaName);
}

void CCouchDbRecordDb::loadExistingDocs(const std::string& schemaName) {
    std::filesystem::path collDir = getDatabaseDir(schemaName);
    if (!std::filesystem::exists(collDir)) return;

    for (const auto& entry : std::filesystem::directory_iterator(collDir)) {
        if (entry.is_regular_file() && entry.path().extension() == ".json") {
            if (entry.path().filename() == "_design_metadata.json") continue;

            std::ifstream in(entry.path());
            if (!in.is_open()) continue;

            std::string line;
            std::map<std::string, std::string> docFields;
            std::string dataId = entry.path().stem().string();

            while (std::getline(in, line)) {
                size_t colon = line.find(':');
                if (colon != std::string::npos) {
                    size_t kStart = line.find('"');
                    size_t kEnd = line.find('"', kStart + 1);
                    if (kStart != std::string::npos && kEnd != std::string::npos && kEnd < colon) {
                        std::string k = line.substr(kStart + 1, kEnd - kStart - 1);

                        size_t vStart = line.find('"', colon);
                        size_t vEnd = line.find('"', vStart + 1);
                        if (vStart != std::string::npos && vEnd != std::string::npos) {
                            std::string v = line.substr(vStart + 1, vEnd - vStart - 1);
                            docFields[k] = v;
                        }
                    }
                }
            }

            if (!docFields.empty()) {
                m_documents[schemaName][dataId] = docFields;
            }
        }
    }
}

std::string CCouchDbRecordDb::serializeToJson(const std::string& dataId,
                                              const std::string& patientId,
                                              const std::string& doctorId,
                                              const std::string& dataHash,
                                              const std::map<std::string, std::string>& fields) const {
    std::stringstream ss;
    ss << "{\n"
       << "  \"_id\": \"" << dataId << "\",\n"
       << "  \"_rev\": \"1-couchrev" << dataHash.substr(0, 8) << "\",\n"
       << "  \"patient_id\": \"" << patientId << "\",\n"
       << "  \"doctor_id\": \"" << doctorId << "\",\n"
       << "  \"data_hash\": \"" << dataHash << "\"";

    for (const auto& [k, v] : fields) {
        ss << ",\n  \"" << k << "\": \"" << v << "\"";
    }
    ss << "\n}\n";
    return ss.str();
}

bool CCouchDbRecordDb::insertRecord(const std::string& schemaName,
                                    const std::string& dataId,
                                    const std::string& patientId,
                                    const std::string& doctorId,
                                    const std::map<std::string, std::string>& fields,
                                    const std::string& dataHash) {
    std::lock_guard<std::mutex> lock(m_mutex);

    std::filesystem::path collDir = getDatabaseDir(schemaName);
    std::filesystem::create_directories(collDir);

    std::filesystem::path docPath = collDir / (dataId + ".json");
    std::string jsonContent = serializeToJson(dataId, patientId, doctorId, dataHash, fields);

    std::ofstream out(docPath);
    if (!out.is_open()) {
        std::cerr << "[CouchDB] Error writing document to " << docPath.string() << "\n";
        return false;
    }
    out << jsonContent;
    out.close();

    std::map<std::string, std::string> doc = fields;
    doc["_id"] = dataId;
    doc["patient_id"] = patientId;
    doc["doctor_id"] = doctorId;
    doc["data_hash"] = dataHash;
    m_documents[schemaName][dataId] = doc;

    std::cout << "[CouchDB] Stored JSON document ID=" << dataId << " at " << docPath.string() << "\n";
    return true;
}

std::optional<std::map<std::string, std::string>> CCouchDbRecordDb::getRecord(const std::string& schemaName,
                                                                              const std::string& dataId) {
    std::lock_guard<std::mutex> lock(m_mutex);
    auto schemaIt = m_documents.find(schemaName);
    if (schemaIt != m_documents.end()) {
        auto docIt = schemaIt->second.find(dataId);
        if (docIt != schemaIt->second.end()) {
            return docIt->second;
        }
    }
    return std::nullopt;
}

bool CCouchDbRecordDb::hasRecord(const std::string& schemaName, const std::string& dataId) {
    std::lock_guard<std::mutex> lock(m_mutex);
    auto schemaIt = m_documents.find(schemaName);
    if (schemaIt != m_documents.end()) {
        return schemaIt->second.find(dataId) != schemaIt->second.end();
    }
    return false;
}

} // namespace CRecordStorage
