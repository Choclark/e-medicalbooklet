#pragma once

#include <string>

namespace CRecordStorage {

enum class DatabaseType {
    RELATIONAL_SQLITE,
    NON_RELATIONAL_COUCHDB
};

inline std::string databaseTypeToString(DatabaseType type) {
    switch (type) {
        case DatabaseType::RELATIONAL_SQLITE:
            return "RELATIONAL_SQLITE";
        case DatabaseType::NON_RELATIONAL_COUCHDB:
            return "NON_RELATIONAL_COUCHDB";
        default:
            return "UNKNOWN";
    }
}

inline std::string to_string(DatabaseType type) {
    return databaseTypeToString(type);
}

inline DatabaseType databaseTypeFromString(const std::string& str) {
    if (str == "NON_RELATIONAL_COUCHDB") {
        return DatabaseType::NON_RELATIONAL_COUCHDB;
    }
    return DatabaseType::RELATIONAL_SQLITE;
}

} // namespace CRecordStorage
