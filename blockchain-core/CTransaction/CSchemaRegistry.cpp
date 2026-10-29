#include "CSchemaRegistry.h"
#include "CRecordStorage/CRecordStorageManager.h"
#include <iostream>

#ifdef DELETE
#undef DELETE
#endif

CSchemaRegistry::CSchemaRegistry(uint64_t memoryLimitBytes)
    : m_memoryLimitBytes(memoryLimitBytes) {
    loadStandardMedicalSchemas();
    loadRegistrationSchemas();
}

void CSchemaRegistry::setRecordStorageManager(CRecordStorage::CRecordStorageManager* mgr) {
    std::lock_guard<std::mutex> lock(m_mutex);
    m_storageManager = mgr;
    if (m_storageManager) {
        for (const auto& entry : m_schemas) {
            const auto& schema = entry.second;
            m_storageManager->registerSchemaStorage(schema.schemaName, schema.storageType, schema.getFieldNames());
        }
    }
}

bool CSchemaRegistry::registerSchema(const CSchemaDef::CSchema& schema) {
    std::lock_guard<std::mutex> lock(m_mutex);
    size_t schemaSize = schema.estimateMemoryBytes();

    if (m_currentMemoryUsed + schemaSize > m_memoryLimitBytes) {
        std::cerr << "[SchemaRegistry] Cannot register schema '" << schema.schemaName 
                  << "': Exceeds 1GB memory limit (Used: " << m_currentMemoryUsed 
                  << " B, Limit: " << m_memoryLimitBytes << " B)\n";
        return false;
    }

    auto it = m_schemas.find(schema.schemaName);
    if (it != m_schemas.end()) {
        m_currentMemoryUsed -= it->second.estimateMemoryBytes();
    }

    m_schemas[schema.schemaName] = schema;
    m_currentMemoryUsed += schemaSize;

    // Immediately trigger table/collection creation in the designated database
    if (m_storageManager) {
        m_storageManager->registerSchemaStorage(schema.schemaName, schema.storageType, schema.getFieldNames());
    }

    return true;
}

std::optional<CSchemaDef::CSchema> CSchemaRegistry::getSchema(const std::string& schemaName) const {
    std::lock_guard<std::mutex> lock(m_mutex);
    auto it = m_schemas.find(schemaName);
    if (it != m_schemas.end()) return it->second;
    return std::nullopt;
}

bool CSchemaRegistry::hasSchema(const std::string& schemaName) const {
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_schemas.find(schemaName) != m_schemas.end();
}

ValidationResult CSchemaRegistry::validateTransaction(const CTransaction& tx) const {
    std::lock_guard<std::mutex> lock(m_mutex);
    auto it = m_schemas.find(tx.schemaType);
    if (it == m_schemas.end()) {
        return ValidationResult::failure(
            Law::SCHEMA,
            "Unknown or unregistered transaction schema: '" + tx.schemaType + "'"
        );
    }

    auto res = it->second.validate(tx);
    if (!res) return res;

    // LAW 1 SCHEMA ENFORCEMENT:
    // If schema requires original signer match (e.g. EDIT and DELETE), verify against original record!
    if (it->second.requiresOriginalSignerMatch && m_storageManager && tx.hasField("target_data_id")) {
        std::string targetDataId = tx.getField("target_data_id");
        auto origRec = m_storageManager->retrieveRecord("CREATE_EHR_RECORD", targetDataId);
        if (!origRec) origRec = m_storageManager->retrieveRecord("EHR_RECORD", targetDataId);
        if (!origRec) origRec = m_storageManager->retrieveRecord("REGISTER_DOCTOR", targetDataId);
        if (!origRec) origRec = m_storageManager->retrieveRecord("REGISTER_PATIENT", targetDataId);
        if (!origRec) origRec = m_storageManager->retrieveRecord("CREATE_PRESCRIPTION", targetDataId);
        if (origRec) {
            std::string origDoctor = origRec->count("doctor_id") ? origRec->at("doctor_id") : "";
            std::string origPatient = origRec->count("patient_id") ? origRec->at("patient_id") : "";
            std::string origAuth = origRec->count("governance_authority") ? origRec->at("governance_authority") :
                                  (origRec->count("registrar_id") ? origRec->at("registrar_id") : "");

            if (tx.schemaType == "EDIT_DOCTOR_REGISTRATION" || tx.schemaType == "DELETE_DOCTOR_REGISTRATION") {
                if (!origDoctor.empty() && tx.senderId != origDoctor && tx.senderPublicKey != origDoctor) {
                    return ValidationResult::failure(
                        Law::SCHEMA,
                        "Consensus Law 1 Violation: Signer (" + tx.senderId + ") does not match original doctor (" + origDoctor + ")"
                    );
                }
                if (!origAuth.empty() && tx.coSignerId != origAuth && tx.coSignerPublicKey != origAuth) {
                    return ValidationResult::failure(
                        Law::SCHEMA,
                        "Consensus Law 1 Violation: Co-signer (" + tx.coSignerId + ") does not match original authority (" + origAuth + ")"
                    );
                }
            } else if (tx.schemaType == "EDIT_PATIENT_REGISTRATION" || tx.schemaType == "DELETE_PATIENT_REGISTRATION") {
                if (!origPatient.empty() && tx.senderId != origPatient && tx.senderPublicKey != origPatient) {
                    return ValidationResult::failure(
                        Law::SCHEMA,
                        "Consensus Law 1 Violation: Signer (" + tx.senderId + ") does not match original patient (" + origPatient + ")"
                    );
                }
                if (!origAuth.empty() && tx.coSignerId != origAuth && tx.coSignerPublicKey != origAuth) {
                    return ValidationResult::failure(
                        Law::SCHEMA,
                        "Consensus Law 1 Violation: Co-signer (" + tx.coSignerId + ") does not match original authority (" + origAuth + ")"
                    );
                }
            } else {
                // Clinical EHR / Prescription records: requires original doctor + original patient
                if (!origDoctor.empty() && tx.senderId != origDoctor && tx.senderPublicKey != origDoctor) {
                    return ValidationResult::failure(
                        Law::SCHEMA,
                        "Consensus Law 1 Violation: Signer (" + tx.senderId + ") does not match original creator (" + origDoctor + ")"
                    );
                }
                if (!origPatient.empty() && origPatient != "ANONYMOUS_PATIENT" &&
                    tx.coSignerId != origPatient && tx.coSignerPublicKey != origPatient) {
                    return ValidationResult::failure(
                        Law::SCHEMA,
                        "Consensus Law 1 Violation: Co-signer (" + tx.coSignerId + ") does not match original patient (" + origPatient + ")"
                    );
                }
            }
        }
    }

    return ValidationResult::success();
}

size_t CSchemaRegistry::getSchemaCount() const {
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_schemas.size();
}

uint64_t CSchemaRegistry::getMemoryUsedBytes() const {
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_currentMemoryUsed;
}

void CSchemaRegistry::loadStandardMedicalSchemas() {
    using namespace CSchemaDef;
    using CRecordStorage::DatabaseType;

    // 1. GENESIS schema -> Relational SQLite (.db file) | Signer: NETWORK_AUTHORITY / GOVERNANCE
    {
        CSchema s("GENESIS", 1, "Healthcare Network Ledger Genesis Block initialization",
                  DatabaseType::RELATIONAL_SQLITE, SignerType::NETWORK_AUTHORITY);
        s.addField("network_name", FieldType::String, true, "Network Identifier");
        s.addField("policy", FieldType::String, true, "Consensus and governance policy");
        registerSchema(s);
    }

    // 2. PATIENT_ADMIT schema -> Relational SQLite (.db file) | Signer: NURSE / INTAKE STAFF
    {
        CSchema s("PATIENT_ADMIT", 1, "Patient hospital intake and department assignment",
                  DatabaseType::RELATIONAL_SQLITE, SignerType::NURSE);
        s.addField("patient_id", FieldType::String, true, "Unique Patient Medical Identifier");
        s.addField("hospital", FieldType::String, true, "Hospital or Clinic ID");
        s.addField("dept", FieldType::String, true, "Department (e.g., Cardiology, ER)");
        s.addField("admit_date", FieldType::String, false, "Admission timestamp or string");
        registerSchema(s);
    }

    // 3. EHR_RECORD schema -> Non-Relational CouchDB (JSON) | Signer: DOCTOR / PHYSICIAN
    {
        CSchema s("EHR_RECORD", 1, "Electronic Health Record examination and diagnosis",
                  DatabaseType::NON_RELATIONAL_COUCHDB, SignerType::DOCTOR);
        s.addField("patient_id", FieldType::String, true, "Unique Patient Identifier");
        s.addField("doctor_id", FieldType::String, true, "Doctor or Specialist ID");
        s.addField("diagnosis", FieldType::String, true, "Clinical diagnosis / observation");
        s.addField("treatment", FieldType::String, false, "Prescribed medical treatment plan");
        registerSchema(s);
    }

    // 4. PRESCRIPTION schema -> Relational SQLite (.db file) | Signer: DOCTOR / PRESCRIBER
    {
        CSchema s("PRESCRIPTION", 1, "Authorized pharmacy medication order",
                  DatabaseType::RELATIONAL_SQLITE, SignerType::DOCTOR);
        s.addField("patient_id", FieldType::String, true, "Patient ID");
        s.addField("doctor_id", FieldType::String, true, "Prescribing Doctor");
        s.addField("rx_name", FieldType::String, true, "Drug or medication name");
        s.addField("dosage", FieldType::String, true, "Dosage schedule");
        s.addField("pharmacy", FieldType::String, true, "Dispensing Pharmacy");
        registerSchema(s);
    }

    // 5. LAB_RESULT schema -> Non-Relational CouchDB (JSON) | Signer: LAB_TECHNICIAN / PATHOLOGY
    {
        CSchema s("LAB_RESULT", 1, "Laboratory diagnostic analysis and biomarker readings",
                  DatabaseType::NON_RELATIONAL_COUCHDB, SignerType::LAB_TECHNICIAN);
        s.addField("patient_id", FieldType::String, true, "Patient ID");
        s.addField("lab_id", FieldType::String, true, "Accredited Laboratory ID");
        s.addField("test_name", FieldType::String, true, "Diagnostic test name (e.g. LipidPanel)");
        s.addField("result_value", FieldType::String, true, "Quantitative reading and units");
        registerSchema(s);
    }

    // 6. PERMISSION schema -> Relational SQLite (.db file) | Signer: PATIENT
    {
        CSchema s("PERMISSION", 1, "Patient consent and access control delegation",
                  DatabaseType::RELATIONAL_SQLITE, SignerType::PATIENT);
        s.addField("patient_id", FieldType::String, true, "Patient ID");
        s.addField("granted_to", FieldType::String, true, "Entity receiving read or write rights");
        s.addField("scope", FieldType::String, true, "Scope of authorization (e.g., ReadBloodwork)");
        registerSchema(s);
    }

    // 7. ACCESS_AUDIT schema -> Relational SQLite (.db file) | Signer: DOCTOR (or NETWORK_AUTHORITY / NURSE)
    {
        CSchema s("ACCESS_AUDIT", 1, "Immutable audit trail of clinical record access events",
                  DatabaseType::RELATIONAL_SQLITE, SignerType::DOCTOR);
        s.addAllowedSigner(SignerType::NETWORK_AUTHORITY);
        s.addAllowedSigner(SignerType::NURSE);
        s.addField("record_id", FieldType::String, true, "Target medical record ID or transaction ID");
        s.addField("patient_id", FieldType::String, true, "Patient ID whose data was accessed");
        s.addField("doctor_id", FieldType::String, true, "Identity of the requesting doctor or practitioner");
        s.addField("requester_role", FieldType::String, true, "Role of the requester (e.g. DOCTOR, SPECIALIST)");
        s.addField("purpose", FieldType::String, true, "Clinical purpose for record access");
        s.addField("access_decision", FieldType::String, true, "Authorization decision (APPROVED or DENIED)");
        s.addField("decision_reason", FieldType::String, true, "Policy explanation or validation result");
        s.addField("consent_tx_id", FieldType::String, true, "On-chain PERMISSION transaction ID, or NONE");
        s.addField("audit_mode", FieldType::String, false, "REALTIME_BLOCKCHAIN or OFFCHAIN_BATCHED");
        registerSchema(s);
    }

    // =========================================================================
    // CATEGORIZED SCHEMAS: CREATE, EDIT, DELETE, SEARCH
    // =========================================================================

    // 8. CREATE_EHR_RECORD (Category: CREATE) | Signers: DOCTOR (+ optional PATIENT co-signer)
    {
        CSchema s("CREATE_EHR_RECORD", 1, "Creates a new Electronic Health Record",
                  DatabaseType::RELATIONAL_SQLITE, SignerType::DOCTOR, SchemaOperation::CREATE);
        s.addAllowedSigner(SignerType::PATIENT);
        s.addField("patient_id", FieldType::String, true, "Patient ID");
        s.addField("doctor_id", FieldType::String, true, "Attending Doctor ID");
        s.addField("diagnosis", FieldType::String, true, "Clinical diagnosis");
        s.addField("treatment", FieldType::String, true, "Treatment plan");
        registerSchema(s);
    }

    // 9. EDIT_EHR_RECORD (Category: EDIT) | Signers: Original Creator(s) required!
    {
        CSchema s("EDIT_EHR_RECORD", 1, "Edits an existing EHR record in off-chain DB, anchors event in new block",
                  DatabaseType::RELATIONAL_SQLITE, SignerType::DOCTOR, SchemaOperation::EDIT);
        s.addAllowedSigner(SignerType::PATIENT);
        s.requiresOriginalSignerMatch = true;
        s.addField("target_data_id", FieldType::String, true, "Database ID of target record being edited");
        s.addField("target_block_height", FieldType::Integer, true, "Block number where record was created/anchored");
        s.addField("target_tx_id", FieldType::String, true, "Transaction ID of target record");
        s.addField("patient_id", FieldType::String, true, "Patient ID");
        s.addField("doctor_id", FieldType::String, true, "Doctor ID");
        s.addField("diagnosis", FieldType::String, true, "Updated diagnosis");
        s.addField("treatment", FieldType::String, true, "Updated treatment plan");
        s.addField("edit_reason", FieldType::String, true, "Reason for clinical record modification");
        registerSchema(s);
    }

    // 10. DELETE_EHR_RECORD (Category: DELETE) | Signers: Original Creator(s) required!
    {
        CSchema s("DELETE_EHR_RECORD", 1, "Deletes an EHR record in off-chain DB, anchors event in new block",
                  DatabaseType::RELATIONAL_SQLITE, SignerType::DOCTOR, SchemaOperation::DELETE);
        s.addAllowedSigner(SignerType::PATIENT);
        s.requiresOriginalSignerMatch = true;
        s.addField("target_data_id", FieldType::String, true, "Database ID of target record being deleted");
        s.addField("target_block_height", FieldType::Integer, true, "Block number where record was created/anchored");
        s.addField("target_tx_id", FieldType::String, true, "Transaction ID of target record");
        s.addField("patient_id", FieldType::String, true, "Patient ID");
        s.addField("doctor_id", FieldType::String, true, "Doctor ID");
        s.addField("deletion_reason", FieldType::String, true, "Mandatory justification for record deletion");
        registerSchema(s);
    }

    // 11. CREATE_PRESCRIPTION (Category: CREATE) | Signers: DOCTOR
    {
        CSchema s("CREATE_PRESCRIPTION", 1, "Creates a new medication prescription",
                  DatabaseType::RELATIONAL_SQLITE, SignerType::DOCTOR, SchemaOperation::CREATE);
        s.addField("patient_id", FieldType::String, true, "Patient ID");
        s.addField("doctor_id", FieldType::String, true, "Prescribing Doctor ID");
        s.addField("rx_name", FieldType::String, true, "Medication name");
        s.addField("dosage", FieldType::String, true, "Dosage instructions");
        s.addField("pharmacy", FieldType::String, true, "Fulfilling pharmacy");
        registerSchema(s);
    }

    // 12. EDIT_PRESCRIPTION (Category: EDIT) | Signers: Original Creator(s) required!
    {
        CSchema s("EDIT_PRESCRIPTION", 1, "Edits a prescription in off-chain DB, anchors event in new block",
                  DatabaseType::RELATIONAL_SQLITE, SignerType::DOCTOR, SchemaOperation::EDIT);
        s.requiresOriginalSignerMatch = true;
        s.addField("target_data_id", FieldType::String, true, "Database ID of target prescription");
        s.addField("target_block_height", FieldType::Integer, true, "Block number where prescription was created");
        s.addField("target_tx_id", FieldType::String, true, "Transaction ID of target prescription");
        s.addField("patient_id", FieldType::String, true, "Patient ID");
        s.addField("doctor_id", FieldType::String, true, "Doctor ID");
        s.addField("rx_name", FieldType::String, true, "Updated medication name");
        s.addField("dosage", FieldType::String, true, "Updated dosage instructions");
        s.addField("pharmacy", FieldType::String, true, "Updated pharmacy");
        s.addField("edit_reason", FieldType::String, true, "Clinical justification for prescription edit");
        registerSchema(s);
    }

    // 13. DELETE_PRESCRIPTION (Category: DELETE) | Signers: Original Creator(s) required!
    {
        CSchema s("DELETE_PRESCRIPTION", 1, "Cancels/Deletes a prescription in off-chain DB, anchors in new block",
                  DatabaseType::RELATIONAL_SQLITE, SignerType::DOCTOR, SchemaOperation::DELETE);
        s.requiresOriginalSignerMatch = true;
        s.addField("target_data_id", FieldType::String, true, "Database ID of target prescription");
        s.addField("target_block_height", FieldType::Integer, true, "Block number where prescription was created");
        s.addField("target_tx_id", FieldType::String, true, "Transaction ID of target prescription");
        s.addField("patient_id", FieldType::String, true, "Patient ID");
        s.addField("doctor_id", FieldType::String, true, "Doctor ID");
        s.addField("deletion_reason", FieldType::String, true, "Cancellation reason (e.g. adverse reaction, therapy concluded)");
        registerSchema(s);
    }

    // 14. QUERY_RECORD (Category: SEARCH) | Signers: DOCTOR / PATIENT / AUDITOR
    {
        CSchema s("QUERY_RECORD", 1, "Search and retrieval schema with Merkle proof verification",
                  DatabaseType::RELATIONAL_SQLITE, SignerType::DOCTOR, SchemaOperation::SEARCH);
        s.addAllowedSigner(SignerType::PATIENT);
        s.addAllowedSigner(SignerType::NETWORK_AUTHORITY);
        s.addField("target_data_id", FieldType::String, true, "Database ID of record being queried");
        s.addField("patient_id", FieldType::String, true, "Patient ID");
        s.addField("requester_id", FieldType::String, true, "Identity of requester");
        s.addField("purpose", FieldType::String, true, "Search purpose");
        registerSchema(s);
    }

    // 15. BREAK_GLASS_TRIGGER schema -> Relational SQLite | Signer: DOCTOR (ER Emergency)
    {
        CSchema s("BREAK_GLASS_TRIGGER", 1, "Authorized ER Emergency Break-Glass access trigger",
                  DatabaseType::RELATIONAL_SQLITE, SignerType::DOCTOR, SchemaOperation::CREATE);
        s.addField("patient_id", FieldType::String, true, "Target unconscious patient ID");
        s.addField("doctor_id", FieldType::String, true, "Requesting ER Doctor ID");
        s.addField("hospital_id", FieldType::String, true, "Hospital or ER facility ID");
        s.addField("declaration", FieldType::String, true, "Emergency reason (Emergency: Patient Unconscious)");
        s.addField("department", FieldType::String, true, "Clinical department (e.g. ER, Intensive Care)");
        s.addField("license_number", FieldType::String, false, "Doctor Medical Board License Number");
        registerSchema(s);
    }

    // 16. BREAK_GLASS_AUDIT schema -> Relational SQLite | Signer: DOCTOR / NETWORK_AUTHORITY
    {
        CSchema s("BREAK_GLASS_AUDIT", 1, "Permanent on-chain audit log of emergency break-glass event",
                  DatabaseType::RELATIONAL_SQLITE, SignerType::DOCTOR);
        s.addAllowedSigner(SignerType::NETWORK_AUTHORITY);
        s.addField("break_glass_id", FieldType::String, true, "Unique break-glass trigger ID");
        s.addField("tx_id", FieldType::String, true, "Emergency transaction hash");
        s.addField("patient_id", FieldType::String, true, "Patient ID whose record was decrypted");
        s.addField("doctor_id", FieldType::String, true, "Attending ER doctor");
        s.addField("hospital_id", FieldType::String, true, "Emergency hospital");
        s.addField("reason", FieldType::String, true, "Clinical justification (Emergency: Patient Unconscious)");
        s.addField("escrow_quorum", FieldType::String, true, "Quorum of participating escrow nodes (KMS, Validator, Archive)");
        s.addField("legal_audit_status", FieldType::String, true, "FLAGGED_FOR_LEGAL_AUDIT");
        s.addField("patient_alert_status", FieldType::String, true, "ALERT_PENDING");
        registerSchema(s);
    }
}

void CSchemaRegistry::loadRegistrationSchemas() {
    using namespace CSchemaDef;
    using CRecordStorage::DatabaseType;

    // 1. REGISTER_DOCTOR (Category: CREATE) | Signers: DOCTOR, NETWORK_AUTHORITY
    {
        CSchema s("REGISTER_DOCTOR", 1, "Registers licensed doctor identity credentials",
                  DatabaseType::RELATIONAL_SQLITE, SignerType::DOCTOR, SchemaOperation::CREATE);
        s.addAllowedSigner(SignerType::NETWORK_AUTHORITY);
        s.addField("doctor_id", FieldType::String, true, "Doctor Identifier / Address");
        s.addField("license_number", FieldType::String, true, "Medical Board License Number");
        s.addField("full_name", FieldType::String, true, "Doctor Full Legal Name");
        s.addField("specialty", FieldType::String, true, "Medical Specialty");
        s.addField("hospital_id", FieldType::String, true, "Primary Hospital Affiliation");
        s.addField("public_key", FieldType::String, true, "Doctor ECDSA Public Key");
        s.addField("status", FieldType::String, true, "Credential Status (ACTIVE / SUSPENDED)");
        s.addField("governance_authority", FieldType::String, true, "Accreditation Authority ID");
        registerSchema(s);
    }

    // 2. REGISTER_PATIENT (Category: CREATE) | Signers: PATIENT, NETWORK_AUTHORITY, NURSE
    {
        CSchema s("REGISTER_PATIENT", 1, "Registers patient identity and digital health booklet credentials",
                  DatabaseType::RELATIONAL_SQLITE, SignerType::PATIENT, SchemaOperation::CREATE);
        s.addAllowedSigner(SignerType::NETWORK_AUTHORITY);
        s.addAllowedSigner(SignerType::NURSE);
        s.addField("patient_id", FieldType::String, true, "Patient Medical Identifier");
        s.addField("full_name", FieldType::String, true, "Patient Full Legal Name");
        s.addField("dob", FieldType::String, true, "Date of Birth (YYYY-MM-DD)");
        s.addField("gender", FieldType::String, true, "Biological Sex / Gender");
        s.addField("public_key", FieldType::String, true, "Patient ECDSA Public Key");
        s.addField("national_id_hash", FieldType::String, true, "SHA-256 Hash of National ID / SSN");
        s.addField("emergency_contact", FieldType::String, false, "Emergency Contact Details");
        s.addField("status", FieldType::String, true, "Registration Status (ACTIVE / INACTIVE)");
        s.addField("registrar_id", FieldType::String, true, "Registrar or Clinic Identity");
        registerSchema(s);
    }

    // 3. EDIT_DOCTOR_REGISTRATION (Category: EDIT) | Signers: Original Doctor + Authority
    {
        CSchema s("EDIT_DOCTOR_REGISTRATION", 1, "Edits doctor credentials, updates off-chain DB, anchors in new block",
                  DatabaseType::RELATIONAL_SQLITE, SignerType::DOCTOR, SchemaOperation::EDIT);
        s.addAllowedSigner(SignerType::NETWORK_AUTHORITY);
        s.requiresOriginalSignerMatch = true;
        s.addField("target_data_id", FieldType::String, true, "Doctor ID being updated");
        s.addField("target_block_height", FieldType::Integer, true, "Block number where doctor was registered");
        s.addField("target_tx_id", FieldType::String, true, "Registration Transaction ID");
        s.addField("doctor_id", FieldType::String, true, "Doctor ID");
        s.addField("hospital_id", FieldType::String, true, "Updated Hospital Affiliation");
        s.addField("specialty", FieldType::String, true, "Updated Specialty");
        s.addField("status", FieldType::String, true, "Updated Status");
        s.addField("edit_reason", FieldType::String, true, "Justification for credential update");
        registerSchema(s);
    }

    // 4. EDIT_PATIENT_REGISTRATION (Category: EDIT) | Signers: Original Patient + Authority
    {
        CSchema s("EDIT_PATIENT_REGISTRATION", 1, "Edits patient demographics/contact info, anchors in new block",
                  DatabaseType::RELATIONAL_SQLITE, SignerType::PATIENT, SchemaOperation::EDIT);
        s.addAllowedSigner(SignerType::NETWORK_AUTHORITY);
        s.addAllowedSigner(SignerType::NURSE);
        s.requiresOriginalSignerMatch = true;
        s.addField("target_data_id", FieldType::String, true, "Patient ID being updated");
        s.addField("target_block_height", FieldType::Integer, true, "Block number where patient was registered");
        s.addField("target_tx_id", FieldType::String, true, "Registration Transaction ID");
        s.addField("patient_id", FieldType::String, true, "Patient ID");
        s.addField("full_name", FieldType::String, true, "Updated Full Name");
        s.addField("emergency_contact", FieldType::String, false, "Updated Emergency Contact");
        s.addField("status", FieldType::String, true, "Updated Status");
        s.addField("edit_reason", FieldType::String, true, "Justification for demographic update");
        registerSchema(s);
    }

    // 5. DELETE_DOCTOR_REGISTRATION (Category: DELETE) | Signers: Doctor + Authority
    {
        CSchema s("DELETE_DOCTOR_REGISTRATION", 1, "Deregisters / revokes doctor credentials, soft-deletes in DB, anchors in new block",
                  DatabaseType::RELATIONAL_SQLITE, SignerType::DOCTOR, SchemaOperation::DELETE);
        s.addAllowedSigner(SignerType::NETWORK_AUTHORITY);
        s.requiresOriginalSignerMatch = true;
        s.addField("target_data_id", FieldType::String, true, "Doctor ID being deregistered");
        s.addField("target_block_height", FieldType::Integer, true, "Block number where doctor was registered");
        s.addField("target_tx_id", FieldType::String, true, "Registration Transaction ID");
        s.addField("doctor_id", FieldType::String, true, "Doctor ID");
        s.addField("deletion_reason", FieldType::String, true, "Reason for license revocation or retirement");
        registerSchema(s);
    }

    // 6. DELETE_PATIENT_REGISTRATION (Category: DELETE) | Signers: Patient + Authority
    {
        CSchema s("DELETE_PATIENT_REGISTRATION", 1, "Deregisters patient from network, soft-deletes in DB, anchors in new block",
                  DatabaseType::RELATIONAL_SQLITE, SignerType::PATIENT, SchemaOperation::DELETE);
        s.addAllowedSigner(SignerType::NETWORK_AUTHORITY);
        s.requiresOriginalSignerMatch = true;
        s.addField("target_data_id", FieldType::String, true, "Patient ID being deregistered");
        s.addField("target_block_height", FieldType::Integer, true, "Block number where patient was registered");
        s.addField("target_tx_id", FieldType::String, true, "Registration Transaction ID");
        s.addField("patient_id", FieldType::String, true, "Patient ID");
        s.addField("deletion_reason", FieldType::String, true, "Reason for deregistration (e.g., patient moved or requested right-to-be-forgotten)");
        registerSchema(s);
    }

    // 7. QUERY_REGISTRATION (Category: SEARCH) | Signers: DOCTOR, PATIENT, NETWORK_AUTHORITY
    {
        CSchema s("QUERY_REGISTRATION", 1, "Queries identity registration with Merkle proof verification",
                  DatabaseType::RELATIONAL_SQLITE, SignerType::DOCTOR, SchemaOperation::SEARCH);
        s.addAllowedSigner(SignerType::PATIENT);
        s.addAllowedSigner(SignerType::NETWORK_AUTHORITY);
        s.addField("target_data_id", FieldType::String, true, "Subject ID being queried");
        s.addField("subject_id", FieldType::String, true, "Doctor or Patient ID");
        s.addField("requester_id", FieldType::String, true, "Identity of requester");
        s.addField("purpose", FieldType::String, true, "Query justification");
        registerSchema(s);
    }
}


