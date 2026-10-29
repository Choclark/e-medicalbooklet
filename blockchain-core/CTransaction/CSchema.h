#pragma once

#ifdef DELETE
#undef DELETE
#endif

#include <string>
#include <vector>
#include <map>
#include <cstdint>
#include "CTransaction.h"
#include "SignerType.h"
#include "CCommon/ValidationResult.h"
#include "CRecordStorage/StorageType.h"

namespace CSchemaDef {

enum class FieldType {
    String,
    Integer,
    Boolean,
    Timestamp,
    HexHash
};

// CRUD Operation categorization for schemas
enum class SchemaOperation {
    CREATE,   // Creates a new clinical record
    EDIT,     // Updates existing record, anchored as an event in a new block
    DELETE,   // Soft-deletes record in DB, anchored as an event in a new block
    SEARCH    // Queries data, verifies Merkle inclusion proof, decrypts via KMS
};

inline std::string schemaOperationToString(SchemaOperation op) {
    switch (op) {
        case SchemaOperation::CREATE: return "CREATE";
        case SchemaOperation::EDIT:   return "EDIT";
        case SchemaOperation::DELETE: return "DELETE";
        case SchemaOperation::SEARCH: return "SEARCH";
        default: return "CREATE";
    }
}

struct FieldRule {
    std::string name;
    FieldType type;
    bool required{true};
    std::string description;
};

class CSchema {
public:
    std::string schemaName;
    uint32_t version{1};
    std::string description;
    CRecordStorage::DatabaseType storageType{CRecordStorage::DatabaseType::RELATIONAL_SQLITE};
    SignerType requiredSignerType{SignerType::DOCTOR}; // Who is authorized to sign this schema
    std::vector<SignerType> allowedSigners;             // Allowed signer types
    SchemaOperation operation{SchemaOperation::CREATE}; // CREATE, EDIT, DELETE, SEARCH
    bool requiresOriginalSignerMatch{false};           // For EDIT and DELETE: must match creator
    std::map<std::string, FieldRule> rules;

    CSchema() = default;
    CSchema(std::string name, uint32_t ver, std::string desc,
            CRecordStorage::DatabaseType dbType = CRecordStorage::DatabaseType::RELATIONAL_SQLITE,
            SignerType signer = SignerType::DOCTOR,
            SchemaOperation op = SchemaOperation::CREATE);

    void setRequiredSigner(SignerType type);
    void addAllowedSigner(SignerType type);
    bool isSignerAuthorized(SignerType type) const;
    SignerType getRequiredSigner() const { return requiredSignerType; }

    void addField(const std::string& fieldName, FieldType type, bool required, std::string desc = "");
    std::vector<std::string> getFieldNames() const;
    ValidationResult validate(const CTransaction& tx) const;
    size_t estimateMemoryBytes() const;
};

} // namespace CSchemaDef
