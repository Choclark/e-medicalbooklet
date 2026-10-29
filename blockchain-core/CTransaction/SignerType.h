#pragma once

#include <string>

namespace CSchemaDef {

// Identity role authorized to sign a medical blockchain transaction
enum class SignerType {
    PATIENT,           // Patient self-signature (consent, access delegation, revocations)
    DOCTOR,            // Licensed Medical Doctor / Physician (EHR examination, diagnoses, prescriptions)
    NURSE,             // Intake Nurse / Hospital Triage Admin (Admissions, room assignment, vitals)
    LAB_TECHNICIAN,    // Accredited Laboratory Technologist (Pathology, diagnostic biomarkers, panels)
    PHARMACIST,        // Registered Pharmacist (Fulfillment, dispensation)
    NETWORK_AUTHORITY  // Blockchain Protocol Validator / Root Governance (Genesis, policy parameters)
};

inline std::string signerTypeToString(SignerType type) {
    switch (type) {
        case SignerType::PATIENT:           return "PATIENT";
        case SignerType::DOCTOR:            return "DOCTOR";
        case SignerType::NURSE:             return "NURSE";
        case SignerType::LAB_TECHNICIAN:    return "LAB_TECHNICIAN";
        case SignerType::PHARMACIST:        return "PHARMACIST";
        case SignerType::NETWORK_AUTHORITY: return "NETWORK_AUTHORITY";
        default:                            return "UNKNOWN";
    }
}

inline SignerType signerTypeFromString(const std::string& str) {
    if (str == "PATIENT") return SignerType::PATIENT;
    if (str == "DOCTOR") return SignerType::DOCTOR;
    if (str == "NURSE") return SignerType::NURSE;
    if (str == "LAB_TECHNICIAN") return SignerType::LAB_TECHNICIAN;
    if (str == "PHARMACIST") return SignerType::PHARMACIST;
    if (str == "NETWORK_AUTHORITY" || str == "SYSTEM" || str == "GOVERNANCE") return SignerType::NETWORK_AUTHORITY;
    return SignerType::DOCTOR;
}

} // namespace CSchemaDef
