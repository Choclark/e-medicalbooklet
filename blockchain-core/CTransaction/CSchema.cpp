#include "CSchema.h"
#include <algorithm>
#include <cctype>

namespace CSchemaDef {

CSchema::CSchema(std::string name, uint32_t ver, std::string desc, CRecordStorage::DatabaseType dbType, SignerType signer, SchemaOperation op)
    : schemaName(std::move(name)), version(ver), description(std::move(desc)), storageType(dbType), requiredSignerType(signer), operation(op) {
    allowedSigners.push_back(signer);
}

void CSchema::setRequiredSigner(SignerType type) {
    requiredSignerType = type;
    allowedSigners.clear();
    allowedSigners.push_back(type);
}

void CSchema::addAllowedSigner(SignerType type) {
    if (std::find(allowedSigners.begin(), allowedSigners.end(), type) == allowedSigners.end()) {
        allowedSigners.push_back(type);
    }
}

bool CSchema::isSignerAuthorized(SignerType type) const {
    if (allowedSigners.empty()) {
        return type == requiredSignerType;
    }
    return std::find(allowedSigners.begin(), allowedSigners.end(), type) != allowedSigners.end();
}

void CSchema::addField(const std::string& fieldName, FieldType type, bool required, std::string desc) {
    rules[fieldName] = FieldRule{fieldName, type, required, std::move(desc)};
}

std::vector<std::string> CSchema::getFieldNames() const {
    std::vector<std::string> names;
    names.reserve(rules.size());
    for (const auto& [name, _] : rules) {
        names.push_back(name);
    }
    return names;
}

ValidationResult CSchema::validate(const CTransaction& tx) const {
    if (tx.schemaType != schemaName) {
        return ValidationResult::failure(
            Law::SCHEMA,
            "Transaction schema mismatch: expected '" + schemaName + "', got '" + tx.schemaType + "'"
        );
    }

    // 1. Signature & Signer Role Authority Enforcement (Defined only in the schema)
    if (tx.signature.empty()) {
        return ValidationResult::failure(
            Law::SCHEMA,
            "Schema '" + schemaName + "' violation: Missing required cryptographic signature"
        );
    }

    if (!isSignerAuthorized(tx.signerType)) {
        return ValidationResult::failure(
            Law::SCHEMA,
            "Schema '" + schemaName + "' signature authority violation: Schema strictly requires signature from role '" +
            signerTypeToString(requiredSignerType) + "', but transaction was signed by '" +
            signerTypeToString(tx.signerType) + "' (sender: " + tx.senderId + ")"
        );
    }

    // 1. Check all required fields exist
    for (const auto& [name, rule] : rules) {
        if (rule.required) {
            if (!tx.hasField(name)) {
                return ValidationResult::failure(
                    Law::SCHEMA,
                    "Schema '" + schemaName + "' violation: Missing required field '" + name + "'"
                );
            }
        }
    }

    // 2. Validate field data types
    for (const auto& [key, val] : tx.fields) {
        auto it = rules.find(key);
        if (it == rules.end()) {
            continue; // Allow unconstrained auxiliary fields or strict check
        }

        const auto& rule = it->second;
        if (val.empty() && rule.required) {
            return ValidationResult::failure(
                Law::SCHEMA,
                "Schema '" + schemaName + "' violation: Required field '" + key + "' cannot be empty"
            );
        }

        if (rule.type == FieldType::Integer) {
            bool allDigits = !val.empty() && std::all_of(val.begin(), val.end(), [](char c) {
                return std::isdigit(static_cast<unsigned char>(c)) || c == '-';
            });
            if (!allDigits) {
                return ValidationResult::failure(
                    Law::SCHEMA,
                    "Schema '" + schemaName + "' violation: Field '" + key + "' must be an integer, got: " + val
                );
            }
        } else if (rule.type == FieldType::HexHash) {
            bool isHex = (val.size() == 64) && std::all_of(val.begin(), val.end(), [](char c) {
                return std::isxdigit(static_cast<unsigned char>(c));
            });
            if (!isHex) {
                return ValidationResult::failure(
                    Law::SCHEMA,
                    "Schema '" + schemaName + "' violation: Field '" + key + "' must be 64-char hex hash"
                );
            }
        }
    }

    return ValidationResult::success();
}

size_t CSchema::estimateMemoryBytes() const {
    size_t bytes = sizeof(CSchema) + schemaName.capacity() + description.capacity();
    for (const auto& [name, rule] : rules) {
        bytes += name.capacity() + rule.name.capacity() + rule.description.capacity() + sizeof(FieldRule) + 32;
    }
    return bytes;
}

} // namespace CSchemaDef
