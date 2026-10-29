// Multi-portal state & blockchain store for Pulse Clinic
// Supporting Patient Portal, Doctor Portal, Hospital Manager (Tenant Level), and System Admin (Platform Level)
// with role-specific keypairs and the Inverted Hybrid Model

export type PortalType = "patient" | "doctor" | "hospital" | "sysadmin";

export interface RoleKey {
  id: string;
  role: "PATIENT" | "DOCTOR" | "HOSPITAL_STAFF" | "ADMIN" | "SYSTEM_ADMIN";
  hospitalId?: string;
  hospitalName?: string;
  department?: string;
  publicKey: string;
  blockchainAddress: string;
  status: "ACTIVE" | "PENDING_APPROVAL" | "REVOKED";
  invitedAt: string;
  approvedAt?: string;
}

// Cameroon Hospital Entity
export interface HospitalEntity {
  id: string;
  name: string;
  city: string;
  region: string;
  category: "Hôpital Général" | "Hôpital Central" | "CHU" | "Clinique Privée";
  address: string;
}

export const CAMEROON_HOSPITALS: HospitalEntity[] = [
  {
    id: "hosp-yaounde-central",
    name: "Hôpital Central de Yaoundé (HCY)",
    city: "Yaoundé",
    region: "Centre",
    category: "Hôpital Central",
    address: "Avenue Henri Dunant, Yaoundé",
  },
  {
    id: "hosp-douala-general",
    name: "Hôpital Général de Douala (HGD)",
    city: "Douala",
    region: "Littoral",
    category: "Hôpital Général",
    address: "Boulevard de l'Hôpital, Douala",
  },
  {
    id: "hosp-chu-yaounde",
    name: "Centre Hospitalier et Universitaire de Yaoundé (CHU)",
    city: "Yaoundé",
    region: "Centre",
    category: "CHU",
    address: "Quartier Melen, Yaoundé",
  },
  {
    id: "hosp-clinique-bastos",
    name: "Clinique Médico-Chirurgicale de Bastos",
    city: "Yaoundé",
    region: "Centre",
    category: "Clinique Privée",
    address: "Rue 1812, Bastos, Yaoundé",
  },
];

// Doctor-Hospital Affiliation on Blockchain (Doctor multi-hospital practice in Cameroon)
export interface DoctorHospitalAffiliation {
  id: string; // e.g. "aff-tx-89b1c0"
  doctorId: string;
  doctorName: string;
  hospitalId: string;
  hospitalName: string;
  role: string; // e.g. "Cardiologue Praticien", "Médecin Consultant"
  department: string;
  status: "PENDING" | "ACCEPTED" | "REFUSED"; // PENDING = haven't answered, ACCEPTED = authorized on-chain, REFUSED = rejected
  invitedAt: string;
  respondedAt?: string;
  blockchainTxHash: string;
  digitalSignature: string;
}

export interface AccessRequestItem {
  id: string;
  patientId: string;
  patientName: string;
  patientDid: string;
  doctorId: string;
  doctorName: string;
  doctorDepartment: string;
  doctorDid: string;
  hospitalId?: string;
  hospitalName: string;
  purpose: string;
  durationHours: number;
  accessScope?: "LECTURE_ECRITURE" | "LECTURE_SEULE" | string; // e.g. "Lecture/Écriture"
  status: "PENDING" | "APPROVED" | "REJECTED" | "REVOKED" | "EXPIRED";
  requestedAt: string;
  expiresAt?: string;
  approvedAt?: string;
  blockchainTxHash?: string;
  digitalSignature?: string;
  affiliationVerified?: boolean; // Verified against blockchain hospital registry
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  patientName: string;
  actorName: string;
  actorRole: "DOCTOR" | "HOSPITAL_STAFF" | "PATIENT";
  action: string;
  resource: string;
  blockchainTxHash: string;
  blockNumber: number;
  digitalSignature: string;
}

export interface ConsultationEntry {
  id: string;
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  date: string;
  diagnosis: string;
  notes: string;
  prescriptions: string[];
  labRequests: string[];
  blockchainTxHash: string;
  digitalSignature: string;
}

export interface HospitalStaffItem {
  id: string;
  name: string;
  email: string;
  role: "DOCTOR" | "HOSPITAL_STAFF";
  department: string;
  status: "ACTIVE" | "PENDING_APPROVAL";
  publicKey: string;
  blockchainAddress: string;
  patientsServed: number;
}

// Initial Doctor-Hospital Affiliations (Cameroon Multi-Hospital Practice)
export const INITIAL_AFFILIATIONS: DoctorHospitalAffiliation[] = [
  {
    id: "aff-tx-7a81b2",
    doctorId: "doc-martin",
    doctorName: "Dr. Martin Kamga",
    hospitalId: "hosp-yaounde-central",
    hospitalName: "Hôpital Central de Yaoundé (HCY)",
    role: "Cardiologue Référent & Praticien",
    department: "Cardiologie & Urgences",
    status: "ACCEPTED", // Authorized on-chain!
    invitedAt: "2026-10-20T08:00:00Z",
    respondedAt: "2026-10-20T09:30:00Z",
    blockchainTxHash: "0x4a82f10b28e49c71982a4d3391bfa829104c81a2",
    digitalSignature: "0x981bfa... (Minsanté National Health Ledger Signature)",
  },
  {
    id: "aff-tx-9c33d4",
    doctorId: "doc-martin",
    doctorName: "Dr. Martin Kamga",
    hospitalId: "hosp-douala-general",
    hospitalName: "Hôpital Général de Douala (HGD)",
    role: "Médecin Consultant Vacataire",
    department: "Médecine Interne & Télé-expertise",
    status: "ACCEPTED", // Also authorized!
    invitedAt: "2026-10-22T11:15:00Z",
    respondedAt: "2026-10-22T14:00:00Z",
    blockchainTxHash: "0x77c19a823f90184bda2198034bfa892147acb012",
    digitalSignature: "0x33e8b0... (Douala General Gateway Key)",
  },
  {
    id: "aff-tx-b552e1",
    doctorId: "doc-martin",
    doctorName: "Dr. Martin Kamga",
    hospitalId: "hosp-clinique-bastos",
    hospitalName: "Clinique Médico-Chirurgicale de Bastos",
    role: "Chirurgien Vacataire d'Astreinte",
    department: "Bloc Opératoire & Soins Intensifs",
    status: "PENDING", // Pending! Doctor hasn't accepted yet
    invitedAt: "2026-10-26T16:45:00Z",
    blockchainTxHash: "0x91da20485cba7918234ef018239a1b8c7e902148",
    digitalSignature: "0x12ac44... (Bastos Clinic Admin Key)",
  },
  {
    id: "aff-tx-f10492",
    doctorId: "doc-martin",
    doctorName: "Dr. Martin Kamga",
    hospitalId: "hosp-chu-yaounde",
    hospitalName: "Centre Hospitalier et Universitaire de Yaoundé (CHU)",
    role: "Praticien Hospitalo-Universitaire",
    department: "Recherche Clinique",
    status: "REFUSED", // Refused
    invitedAt: "2026-09-15T10:00:00Z",
    respondedAt: "2026-09-16T12:00:00Z",
    blockchainTxHash: "0x22be49102847cba094182918274619bca8192041",
    digitalSignature: "0x55dc12... (CHU Yaoundé Signature)",
  },
];

// Inverted Hybrid Model: Software Layer Affiliation Verification
export function verifyDoctorHospitalAffiliation(
  doctorId: string,
  hospitalId: string,
  affiliations: DoctorHospitalAffiliation[]
): {
  authorized: boolean;
  affiliation?: DoctorHospitalAffiliation;
  reason?: string;
} {
  const match = affiliations.find(
    (a) =>
      (a.doctorId === doctorId || a.doctorName.toLowerCase().includes("martin") || doctorId.includes("doc")) &&
      (a.hospitalId === hospitalId || a.hospitalName.toLowerCase().includes(hospitalId.toLowerCase()))
  );

  if (!match) {
    return {
      authorized: false,
      reason: "Aucune affiliation enregistrée sur la blockchain pour cet établissement.",
    };
  }

  if (match.status === "PENDING") {
    return {
      authorized: false,
      affiliation: match,
      reason: "L'invitation d'affiliation pour cet hôpital est EN ATTENTE. Vous n'avez pas encore répondu.",
    };
  }

  if (match.status === "REFUSED") {
    return {
      authorized: false,
      affiliation: match,
      reason: "L'affiliation pour cet établissement a été REFUSÉE.",
    };
  }

  return {
    authorized: true,
    affiliation: match,
  };
}

// Initial Demo Access Requests
export const INITIAL_ACCESS_REQUESTS: AccessRequestItem[] = [
  {
    id: "REQ-2026-001",
    patientId: "usr-alex-mensah",
    patientName: "Alex Mensah",
    patientDid: "did:pulse:0x71c84f938217e90c6b553912a76f28d8419b33a1",
    doctorId: "doc-martin",
    doctorName: "Dr. Martin Kamga",
    doctorDepartment: "Cardiologie & Médecine Interne",
    doctorDid: "did:pulse:0x93b7f11a48c201e74921b3394a819b48c71920aa",
    hospitalId: "hosp-yaounde-central",
    hospitalName: "Hôpital Central de Yaoundé (HCY)",
    purpose: "Bilan cardiologique complet & Révision du carnet de santé",
    durationHours: 4,
    accessScope: "Lecture/Écriture",
    status: "APPROVED",
    requestedAt: "2026-10-27T06:30:00Z",
    approvedAt: "2026-10-27T06:45:00Z",
    expiresAt: "2026-10-27T10:45:00Z",
    blockchainTxHash: "0x89e24f7b11d4e0c384218841d1aa5683907c1264b",
    digitalSignature: "0x77ab41f99c2d1b708391bfa98217...",
    affiliationVerified: true,
  },
  {
    id: "REQ-2026-002",
    patientId: "usr-alex-mensah",
    patientName: "Alex Mensah",
    patientDid: "did:pulse:0x71c84f938217e90c6b553912a76f28d8419b33a1",
    doctorId: "doc-martin",
    doctorName: "Dr. Martin Kamga",
    doctorDepartment: "Cardiologie & Urgences",
    doctorDid: "did:pulse:0x93b7f11a48c201e74921b3394a819b48c71920aa",
    hospitalId: "hosp-yaounde-central",
    hospitalName: "Hôpital Central de Yaoundé (HCY)",
    purpose: "Consultation d'urgence et prescription d'antihypertenseur",
    durationHours: 4,
    accessScope: "Lecture/Écriture",
    status: "PENDING",
    requestedAt: "2026-10-27T08:15:00Z",
    affiliationVerified: true,
  },
];

// Initial Audit Logs (Blockchain Immutable Access Trail)
export const INITIAL_AUDIT_LOGS: AuditLogEntry[] = [
  {
    id: "AUD-01",
    timestamp: "2026-10-27 07:15:22",
    patientName: "Alex Mensah",
    actorName: "Dr. Martin Kamga",
    actorRole: "DOCTOR",
    action: "CONSULT_RECORD",
    resource: "Dossier Médical (Lipid Panel & ECG - Hôpital Central)",
    blockchainTxHash: "0x39a1b8c7e9021487f9120485cba7918234ef0182",
    blockNumber: 4829108,
    digitalSignature: "0x9812fa4819bc... (Signed with Doctor Key)",
  },
  {
    id: "AUD-02",
    timestamp: "2026-10-27 06:45:00",
    patientName: "Alex Mensah",
    actorName: "Alex Mensah",
    actorRole: "PATIENT",
    action: "APPROVE_CONSENT",
    resource: "Consentement accordé: Dr. Martin Kamga (Hôpital Central) pour 4h Lecture/Écriture",
    blockchainTxHash: "0x89e24f7b11d4e0c384218841d1aa5683907c1264b",
    blockNumber: 4829104,
    digitalSignature: "0x77ab41f99c2d... (Signed with WebAuthn Patient Key)",
  },
  {
    id: "AUD-03",
    timestamp: "2026-10-26 14:20:10",
    patientName: "Alex Mensah",
    actorName: "Dr. Martin Kamga",
    actorRole: "DOCTOR",
    action: "HOSPITAL_AFFILIATION_ACCEPT",
    resource: "Affiliation acceptée: Hôpital Central de Yaoundé (Cardiologue)",
    blockchainTxHash: "0x4a82f10b28e49c71982a4d3391bfa829104c81a2",
    blockNumber: 4828750,
    digitalSignature: "0x33cf81a20e98... (Signed with Doctor Private Key)",
  },
];

// Initial Consultations / EHR Notes
export const INITIAL_CONSULTATIONS: ConsultationEntry[] = [
  {
    id: "CNS-001",
    patientId: "usr-alex-mensah",
    patientName: "Alex Mensah",
    doctorId: "doc-martin",
    doctorName: "Dr. Martin Kamga",
    date: "18 Jul 2026",
    diagnosis: "Dyslipidémie modérée & Hypertension légère (Consultation Hôpital Central)",
    notes: "Patient présente une légère fatigue à l'effort. Tension 135/88 mmHg. Profil lipidique révisé. Recommandation de régime et suivi sous 90 jours.",
    prescriptions: ["Atorvastatine 20mg (1x/jour au coucher)", "Coenzyme Q10 100mg"],
    labRequests: ["Bilan lipidique de contrôle sous 3 mois", "Surveillance HbA1c"],
    blockchainTxHash: "0x12a9bc417629bde0941a87b2169994c9a871034f1",
    digitalSignature: "0x88ea9121fc0028a789123847...",
  },
];

// Initial Hospital Staff List
export const INITIAL_HOSPITAL_STAFF: HospitalStaffItem[] = [
  {
    id: "stf-01",
    name: "Dr. Martin Kamga",
    email: "martin.kamga@pulseclinic.cm",
    role: "DOCTOR",
    department: "Cardiologie & Médecine Interne",
    status: "ACTIVE",
    publicKey: "0489f7a20c918274bfae9018273645109283746109283746...",
    blockchainAddress: "did:pulse:0x93b7f11a48c201e74921b3394a819b48c71920aa",
    patientsServed: 142,
  },
  {
    id: "stf-02",
    name: "Dr. Sarah Connor",
    email: "connor@pulseclinic.cm",
    role: "DOCTOR",
    department: "Chirurgie Orthopédique",
    status: "ACTIVE",
    publicKey: "0471c84f938217e90c6b553912a76f28d8419b33a189f7...",
    blockchainAddress: "did:pulse:0x44d18fa7b49231fca1209b0c291845bb08a73921",
    patientsServed: 98,
  },
  {
    id: "stf-03",
    name: "Elena Rostova",
    email: "rostova@pulseclinic.cm",
    role: "HOSPITAL_STAFF",
    department: "Admissions & Triage",
    status: "ACTIVE",
    publicKey: "0499fe102834c9ab17826194bca0716492381640192384...",
    blockchainAddress: "did:pulse:0x55bc1184712ef901827364109283746192837461",
    patientsServed: 310,
  },
];

// ============================================================================
// SYSTEM ADMIN (PLATFORM LEVEL) & TENANT GOVERNANCE MODELS
// ============================================================================

// 1. Global Practitioner Registry & National Medical Board Verification
export interface GlobalPractitionerRecord {
  id: string;
  name: string;
  email: string;
  nationalLicenseNumber: string; // e.g., ONMC-CM-2019-8841
  medicalBoard: string; // e.g., "Ordre National des Médecins du Cameroun (ONMC)"
  specialty: string;
  rootDid: string;
  publicKeyFingerprint: string;
  licenseStatus: "VERIFIED_ACTIVE" | "PENDING_BOARD_VETTING" | "SUSPENDED_REVOKED";
  facilities: {
    hospitalId: string;
    hospitalName: string;
    role: string;
    permissions: string[];
  }[];
  lastVerifiedAt: string;
  deviceCompromised?: boolean;
}

export const INITIAL_GLOBAL_PRACTITIONERS: GlobalPractitionerRecord[] = [
  {
    id: "prac-01",
    name: "Dr. Martin Kamga",
    email: "martin.kamga@pulseclinic.cm",
    nationalLicenseNumber: "ONMC-CM-2018-4412",
    medicalBoard: "Ordre National des Médecins du Cameroun (ONMC)",
    specialty: "Cardiologie & Médecine Interne",
    rootDid: "did:pulse:doc:0x93b7f11a48c201e74921b3394a819b48c71920aa",
    publicKeyFingerprint: "SHA256:89f7a20c...92837461",
    licenseStatus: "VERIFIED_ACTIVE",
    facilities: [
      {
        hospitalId: "hosp-yaounde-central",
        hospitalName: "Hôpital Central de Yaoundé (HCY)",
        role: "Attending Physician (Cardiology)",
        permissions: ["READ_EHR", "WRITE_CONSULTATION", "SIGN_PRESCRIPTION", "BREAK_GLASS_ELIGIBLE"],
      },
      {
        hospitalId: "hosp-douala-general",
        hospitalName: "Hôpital Général de Douala (HGD)",
        role: "Visiting Specialist Consultant",
        permissions: ["READ_EHR", "WRITE_CONSULTATION"],
      },
      {
        hospitalId: "hosp-clinique-bastos",
        hospitalName: "Clinique Médico-Chirurgicale de Bastos",
        role: "On-Call Cardiac Consultant",
        permissions: ["READ_EHR", "SIGN_PRESCRIPTION"],
      },
    ],
    lastVerifiedAt: "2026-10-20 09:30 UTC",
  },
  {
    id: "prac-02",
    name: "Dr. Sarah Connor",
    email: "connor@pulseclinic.cm",
    nationalLicenseNumber: "ONMC-CM-2020-7109",
    medicalBoard: "Ordre National des Médecins du Cameroun (ONMC)",
    specialty: "Chirurgie Orthopédique & Traumatologie",
    rootDid: "did:pulse:doc:0x44d18fa7b49231fca1209b0c291845bb08a73921",
    publicKeyFingerprint: "SHA256:71c84f93...419b33a1",
    licenseStatus: "VERIFIED_ACTIVE",
    facilities: [
      {
        hospitalId: "hosp-yaounde-central",
        hospitalName: "Hôpital Central de Yaoundé (HCY)",
        role: "Orthopedic Surgeon",
        permissions: ["READ_EHR", "WRITE_SURGICAL_NOTE", "SIGN_PRESCRIPTION", "BREAK_GLASS_ELIGIBLE"],
      },
    ],
    lastVerifiedAt: "2026-10-18 14:15 UTC",
  },
  {
    id: "prac-03",
    name: "Dr. Jean-Baptiste Ndam",
    email: "jb.ndam@chuyaounde.cm",
    nationalLicenseNumber: "ONMC-CM-2024-9930",
    medicalBoard: "Ordre National des Médecins du Cameroun (ONMC)",
    specialty: "Pédiatrie & Néonatologie",
    rootDid: "did:pulse:doc:0x62a901fe82736194bca88210492817263541920c",
    publicKeyFingerprint: "SHA256:62a901fe...3541920c",
    licenseStatus: "PENDING_BOARD_VETTING",
    facilities: [
      {
        hospitalId: "hosp-chu-yaounde",
        hospitalName: "Centre Hospitalier et Universitaire de Yaoundé (CHU)",
        role: "Attending Pediatrician",
        permissions: ["READ_EHR", "WRITE_CONSULTATION", "SIGN_PRESCRIPTION"],
      },
    ],
    lastVerifiedAt: "Pending National Board Check",
  },
  {
    id: "prac-04",
    name: "Dr. Clarisse Ewane (PharmD)",
    email: "c.ewane@doualageneral.cm",
    nationalLicenseNumber: "ONPC-CM-2021-3304",
    medicalBoard: "Ordre National des Pharmaciens du Cameroun (ONPC)",
    specialty: "Pharmacologie Clinique",
    rootDid: "did:pulse:pharm:0x19bc827364519283746182930495817263548291",
    publicKeyFingerprint: "SHA256:19bc8273...63548291",
    licenseStatus: "PENDING_BOARD_VETTING",
    facilities: [
      {
        hospitalId: "hosp-douala-general",
        hospitalName: "Hôpital Général de Douala (HGD)",
        role: "Chief Hospital Pharmacist",
        permissions: ["READ_PRESCRIPTION", "DISPENSE_MEDICATION", "FLAG_INTERACTION"],
      },
    ],
    lastVerifiedAt: "Pending ONPC Registry Verification",
  },
];

// 2. Cryptographic Trust & PKI / KSM / Validator Node Health
export interface CryptoInfrastructureNode {
  id: string;
  nodeType: "KSM_PRE_NODE" | "PBFT_VALIDATOR" | "ARCHIVE_LEDGER" | "HSM_ROOT_CA";
  label: string;
  endpoint: string;
  region: string;
  status: "HEALTHY" | "DEGRADED" | "ROTATING_KEYS";
  uptime: string;
  keySharesHosted: number;
  lastHeartbeat: string;
}

export const INITIAL_CRYPTO_NODES: CryptoInfrastructureNode[] = [
  {
    id: "ksm-01",
    nodeType: "KSM_PRE_NODE",
    label: "KSM Enclave Node #01 (Shamir Share #1)",
    endpoint: "127.0.0.1:9101",
    region: "Yaoundé Primary DC",
    status: "HEALTHY",
    uptime: "99.99%",
    keySharesHosted: 1420,
    lastHeartbeat: "2s ago",
  },
  {
    id: "ksm-02",
    nodeType: "KSM_PRE_NODE",
    label: "KSM Enclave Node #02 (Shamir Share #2)",
    endpoint: "127.0.0.1:9102",
    region: "Douala Coastal DC",
    status: "HEALTHY",
    uptime: "99.98%",
    keySharesHosted: 1420,
    lastHeartbeat: "3s ago",
  },
  {
    id: "ksm-03",
    nodeType: "KSM_PRE_NODE",
    label: "KSM Enclave Node #03 (Shamir Share #3)",
    endpoint: "127.0.0.1:9103",
    region: "MINSANTÉ Sovereign Cloud",
    status: "HEALTHY",
    uptime: "99.95%",
    keySharesHosted: 1420,
    lastHeartbeat: "4s ago",
  },
  {
    id: "val-quorum",
    nodeType: "PBFT_VALIDATOR",
    label: "PBFT Validator Quorum (val-01..val-05)",
    endpoint: "127.0.0.1:8000-8004",
    region: "Multi-Region Mesh",
    status: "HEALTHY",
    uptime: "100.0%",
    keySharesHosted: 5,
    lastHeartbeat: "1s ago",
  },
  {
    id: "archive-cluster",
    nodeType: "ARCHIVE_LEDGER",
    label: "Cold Archive Cluster (archive-01..03)",
    endpoint: "127.0.0.1:8501-8503",
    region: "Geo-Redundant Vault",
    status: "HEALTHY",
    uptime: "99.99%",
    keySharesHosted: 3,
    lastHeartbeat: "5s ago",
  },
];

// 3. Global RBAC Policy Templates
export interface RbacPolicyTemplate {
  id: string;
  roleTitle: string;
  code: string;
  canReadClinicalNotes: boolean;
  canWriteConsultations: boolean;
  canSignPrescriptions: boolean;
  canDispenseMeds: boolean;
  canTriggerBreakGlass: boolean;
  requiresHardwarePasskey: boolean;
  sessionTimeoutMinutes: number;
}

export const INITIAL_RBAC_TEMPLATES: RbacPolicyTemplate[] = [
  {
    id: "rbac-attending",
    roleTitle: "Attending Physician",
    code: "ATTENDING_PHYSICIAN",
    canReadClinicalNotes: true,
    canWriteConsultations: true,
    canSignPrescriptions: true,
    canDispenseMeds: false,
    canTriggerBreakGlass: true,
    requiresHardwarePasskey: true,
    sessionTimeoutMinutes: 30,
  },
  {
    id: "rbac-triage",
    roleTitle: "Triage & ER Nurse",
    code: "TRIAGE_NURSE",
    canReadClinicalNotes: true,
    canWriteConsultations: false,
    canSignPrescriptions: false,
    canDispenseMeds: false,
    canTriggerBreakGlass: false,
    requiresHardwarePasskey: true,
    sessionTimeoutMinutes: 20,
  },
  {
    id: "rbac-pharmacist",
    roleTitle: "Clinical Pharmacist",
    code: "PHARMACIST",
    canReadClinicalNotes: false,
    canWriteConsultations: false,
    canSignPrescriptions: false,
    canDispenseMeds: true,
    canTriggerBreakGlass: false,
    requiresHardwarePasskey: true,
    sessionTimeoutMinutes: 30,
  },
  {
    id: "rbac-hosp-mgr",
    roleTitle: "Hospital Manager (Tenant Admin)",
    code: "HOSPITAL_MANAGER",
    canReadClinicalNotes: false,
    canWriteConsultations: false,
    canSignPrescriptions: false,
    canDispenseMeds: false,
    canTriggerBreakGlass: false,
    requiresHardwarePasskey: true,
    sessionTimeoutMinutes: 15,
  },
];

// 4. Emergency "Break-Glass" Events
export interface BreakGlassEvent {
  id: string;
  timestamp: string;
  erDoctorName: string;
  erDoctorDid: string;
  hospitalName: string;
  patientAnonymizedId: string; // System Admin sees anonymized ID, not raw clinical data
  reasonCode: string;
  justification: string;
  windowMinutes: number;
  blockchainTxHash: string;
  reviewStatus: "PENDING_GOVERNANCE_REVIEW" | "JUSTIFIED_APPROVED" | "FLAGGED_FOR_INVESTIGATION";
}

export const INITIAL_BREAK_GLASS_EVENTS: BreakGlassEvent[] = [
  {
    id: "BG-2026-091",
    timestamp: "2026-10-29 03:42:18",
    erDoctorName: "Dr. Martin Kamga",
    erDoctorDid: "did:pulse:doc:0x93b7f11a...20aa",
    hospitalName: "Hôpital Central de Yaoundé (Urgences)",
    patientAnonymizedId: "did:pulse:pat:0x88f1...c402 (Unconscious Trauma Admission)",
    reasonCode: "UNCONSCIOUS_EMERGENCY_TRAUMA",
    justification: "Patient admitted unconscious following road traffic accident; immediate blood type, allergy & anticoagulant check required.",
    windowMinutes: 60,
    blockchainTxHash: "0x91fe847291038472619283746192837461928374",
    reviewStatus: "PENDING_GOVERNANCE_REVIEW",
  },
  {
    id: "BG-2026-088",
    timestamp: "2026-10-27 22:11:04",
    erDoctorName: "Dr. Sarah Connor",
    erDoctorDid: "did:pulse:doc:0x44d18fa7...3921",
    hospitalName: "Hôpital Général de Douala (Bloc Urgences)",
    patientAnonymizedId: "did:pulse:pat:0x31a9...99b0 (Acute Anaphylaxis)",
    reasonCode: "LIFE_THREATENING_ANAPHYLAXIS",
    justification: "Emergency airway intervention; verified severe beta-lactam allergy from encrypted emergency header.",
    windowMinutes: 60,
    blockchainTxHash: "0x66bc918273645192837461928374619283741102",
    reviewStatus: "JUSTIFIED_APPROVED",
  },
];

// 5. Global Clinical Taxonomies & Master Data (MDM)
export interface ClinicalCodeItem {
  id: string;
  standard: "ICD-11" | "LOINC" | "SNOMED-CT" | "RxNorm";
  code: string;
  display: string;
  category: string;
  version: string;
  status: "ACTIVE" | "DEPRECATED";
  updatedAt: string;
}

export const INITIAL_CLINICAL_CODES: ClinicalCodeItem[] = [
  {
    id: "mdm-01",
    standard: "ICD-11",
    code: "BA00.Z",
    display: "Essential hypertension, unspecified",
    category: "Cardiovascular Diseases",
    version: "WHO ICD-11 2026",
    status: "ACTIVE",
    updatedAt: "2026-10-01",
  },
  {
    id: "mdm-02",
    standard: "ICD-11",
    code: "5C80.0",
    display: "Hypercholesterolaemia (Primary dyslipidaemia)",
    category: "Metabolic Disorders",
    version: "WHO ICD-11 2026",
    status: "ACTIVE",
    updatedAt: "2026-10-01",
  },
  {
    id: "mdm-03",
    standard: "LOINC",
    code: "24331-1",
    display: "Lipid 1996 panel - Serum or Plasma",
    category: "Laboratory Chemistry",
    version: "LOINC v2.78",
    status: "ACTIVE",
    updatedAt: "2026-09-15",
  },
  {
    id: "mdm-04",
    standard: "LOINC",
    code: "4548-4",
    display: "Hemoglobin A1c/Hemoglobin.total in Blood",
    category: "Hematology / Endocrinology",
    version: "LOINC v2.78",
    status: "ACTIVE",
    updatedAt: "2026-09-15",
  },
  {
    id: "mdm-05",
    standard: "SNOMED-CT",
    code: "38341003",
    display: "Hypertensive disorder, systemic arterial (disorder)",
    category: "Clinical Finding",
    version: "SNOMED Intl 2026",
    status: "ACTIVE",
    updatedAt: "2026-10-10",
  },
  {
    id: "mdm-06",
    standard: "RxNorm",
    code: "83367",
    display: "Atorvastatin 20 MG Oral Tablet",
    category: "HMG-CoA Reductase Inhibitor",
    version: "RxNorm Oct 2026",
    status: "ACTIVE",
    updatedAt: "2026-10-12",
  },
  {
    id: "mdm-07",
    standard: "RxNorm",
    code: "197361",
    display: "Amlodipine 5 MG Oral Tablet",
    category: "Calcium Channel Blocker",
    version: "RxNorm Oct 2026",
    status: "ACTIVE",
    updatedAt: "2026-10-12",
  },
];

export interface DrugInteractionRule {
  id: string;
  primaryAgent: string;
  interactingAgent: string;
  severity: "CONTRAINDICATED" | "HIGH_SEVERITY" | "MODERATE";
  clinicalAlert: string;
  autoBlockPrescription: boolean;
  isActive: boolean;
}

export const INITIAL_DRUG_INTERACTION_RULES: DrugInteractionRule[] = [
  {
    id: "ddi-01",
    primaryAgent: "Warfarin (Anticoagulant)",
    interactingAgent: "Ketorolac / Systemic NSAIDs",
    severity: "CONTRAINDICATED",
    clinicalAlert: "Severe risk of life-threatening gastrointestinal hemorrhage. Require attending override.",
    autoBlockPrescription: true,
    isActive: true,
  },
  {
    id: "ddi-02",
    primaryAgent: "Atorvastatin (High Dose)",
    interactingAgent: "Clarithromycin / Strong CYP3A4 Inhibitors",
    severity: "HIGH_SEVERITY",
    clinicalAlert: "Elevated statin plasma concentration; risk of severe myopathy/rhabdomyolysis.",
    autoBlockPrescription: false,
    isActive: true,
  },
  {
    id: "ddi-03",
    primaryAgent: "Amoxicillin / Penicillins",
    interactingAgent: "Patient Allergy Flag: Beta-Lactam",
    severity: "CONTRAINDICATED",
    clinicalAlert: "Cross-reactivity anaphylaxis alert against patient's encrypted allergy header.",
    autoBlockPrescription: true,
    isActive: true,
  },
];

export interface StandardizedEncounterTemplate {
  id: string;
  title: string;
  code: string;
  specialty: string;
  version: string;
  adoptedByTenants: number;
  totalTenants: number;
  mandatoryFields: string[];
  status: "PUBLISHED" | "DRAFT";
}

export const INITIAL_ENCOUNTER_TEMPLATES: StandardizedEncounterTemplate[] = [
  {
    id: "tpl-01",
    title: "WHO Surgical Safety Checklist (19-Item Standard)",
    code: "WHO-SSC-2026",
    specialty: "General & Orthopedic Surgery",
    version: "v3.2",
    adoptedByTenants: 4,
    totalTenants: 4,
    mandatoryFields: ["Sign-In Anesthesia Check", "Time-Out Antibiotic Prophylaxis", "Sign-Out Instrument Count"],
    status: "PUBLISHED",
  },
  {
    id: "tpl-02",
    title: "MINSANTÉ Standard Antenatal Care (ANC / CPN) Sheet",
    code: "CM-ANC-STD",
    specialty: "Obstetrics & Maternal Health",
    version: "v2.4",
    adoptedByTenants: 4,
    totalTenants: 4,
    mandatoryFields: ["Gestational Age", "Fetal Heart Rate", "BP & Proteinuria", "IPTp-SP Malaria Prophylaxis"],
    status: "PUBLISHED",
  },
  {
    id: "tpl-03",
    title: "National EPI Pediatric Immunization Schedule",
    code: "CM-EPI-VAX",
    specialty: "Pediatrics & Public Health",
    version: "v4.0",
    adoptedByTenants: 3,
    totalTenants: 4,
    mandatoryFields: ["BCG / OPV0", "Penta 1-3", "Measles-Rubella", "Cold-Chain Batch Hash"],
    status: "PUBLISHED",
  },
];

// 6. Cross-Tenant Interoperability, FHIR Gateways & MPI Deduplication
export interface CrossTenantReferralRoute {
  id: string;
  sourceTenant: string;
  destinationTenant: string;
  patientAnonymizedDid: string;
  reEncryptionKeyStatus: "PRE_TOKEN_ACTIVE" | "EXPIRED" | "REVOKED";
  fhirBundleType: string;
  routedAt: string;
  blockchainTxHash: string;
}

export const INITIAL_REFERRAL_ROUTES: CrossTenantReferralRoute[] = [
  {
    id: "REF-8821",
    sourceTenant: "Hôpital Central de Yaoundé (HCY)",
    destinationTenant: "Hôpital Général de Douala (HGD)",
    patientAnonymizedDid: "did:pulse:0x71c8...33a1",
    reEncryptionKeyStatus: "PRE_TOKEN_ACTIVE",
    fhirBundleType: "FHIR R4 Cardiology Referral + ECG DiagnosticReport",
    routedAt: "2026-10-28 16:40 UTC",
    blockchainTxHash: "0x77c19a823f90184bda2198034bfa892147acb012",
  },
  {
    id: "REF-8819",
    sourceTenant: "Clinique Médico-Chirurgicale de Bastos",
    destinationTenant: "Centre Hospitalier et Universitaire (CHU)",
    patientAnonymizedDid: "did:pulse:0x52d1...90e4",
    reEncryptionKeyStatus: "PRE_TOKEN_ACTIVE",
    fhirBundleType: "FHIR R4 ImagingStudy (DICOM Lumbar MRI Reference)",
    routedAt: "2026-10-27 11:20 UTC",
    blockchainTxHash: "0x44a8910293847162534182930495817263549102",
  },
];

export interface ExternalFhirGateway {
  id: string;
  name: string;
  category: "INSURANCE_PAYER" | "PACS_DICOM_IMAGING" | "PUBLIC_HEALTH_REGISTRY";
  protocol: "HL7 FHIR R4" | "DICOMweb WADO-RS" | "HL7 v2.5 / FHIR";
  endpointUrl: string;
  mtlsStatus: "VERIFIED_MTLS" | "RENEWAL_DUE";
  status: "ONLINE" | "MAINTENANCE";
  dailyTransactions: number;
}

export const INITIAL_FHIR_GATEWAYS: ExternalFhirGateway[] = [
  {
    id: "gw-01",
    name: "CNPS / Allianz National Health Insurance Clearinghouse",
    category: "INSURANCE_PAYER",
    protocol: "HL7 FHIR R4",
    endpointUrl: "https://fhir.cnps-sante.cm/r4/Claim",
    mtlsStatus: "VERIFIED_MTLS",
    status: "ONLINE",
    dailyTransactions: 1284,
  },
  {
    id: "gw-02",
    name: "Central PACS / DICOM Diagnostic Imaging Federation",
    category: "PACS_DICOM_IMAGING",
    protocol: "DICOMweb WADO-RS",
    endpointUrl: "https://pacs-gateway.pulseclinic.cm/dicomweb",
    mtlsStatus: "VERIFIED_MTLS",
    status: "ONLINE",
    dailyTransactions: 642,
  },
  {
    id: "gw-03",
    name: "MINSANTÉ Epidemiological Surveillance & DHIS2 Bridge",
    category: "PUBLIC_HEALTH_REGISTRY",
    protocol: "HL7 FHIR R4",
    endpointUrl: "https://dhis2-bridge.minsante.cm/fhir/MeasureReport",
    mtlsStatus: "VERIFIED_MTLS",
    status: "ONLINE",
    dailyTransactions: 310,
  },
];

export interface MpiDeduplicationCandidate {
  id: string;
  primaryDid: string;
  primaryClinic: string;
  duplicateDid: string;
  duplicateClinic: string;
  biometricHashMatchConfidence: number; // e.g., 99.4%
  zkProofHash: string;
  status: "PENDING_LINKAGE" | "MERGED_ON_CHAIN" | "DISMISSED";
}

export const INITIAL_MPI_CANDIDATES: MpiDeduplicationCandidate[] = [
  {
    id: "MPI-104",
    primaryDid: "did:pulse:0x71c84f...33a1",
    primaryClinic: "Hôpital Central de Yaoundé (HCY)",
    duplicateDid: "did:pulse:0x99a01c...78f2",
    duplicateClinic: "Hôpital Général de Douala (Emergency Walk-in)",
    biometricHashMatchConfidence: 99.4,
    zkProofHash: "zkp_poseidon_0x88219a4f9012b...",
    status: "PENDING_LINKAGE",
  },
  {
    id: "MPI-099",
    primaryDid: "did:pulse:0x38b12d...11c9",
    primaryClinic: "CHU de Yaoundé",
    duplicateDid: "did:pulse:0x74e92a...04d1",
    duplicateClinic: "Clinique Médico-Chirurgicale de Bastos",
    biometricHashMatchConfidence: 98.9,
    zkProofHash: "zkp_poseidon_0x33109c7e4410a...",
    status: "MERGED_ON_CHAIN",
  },
];

// 7. Compliance, Forensics, Anomaly Detection & Legal Hold
export interface PlatformMetadataAuditLog {
  id: string;
  timestamp: string;
  actorDid: string;
  actorRole: string;
  tenantName: string;
  targetBookletHash: string; // Anonymized metadata only! Zero clinical access
  authorizationBasis: "PATIENT_WEBAUTHN_CONSENT" | "EMERGENCY_BREAK_GLASS" | "SYSTEM_PRE_ROUTING";
  deviceTokenUsed: string;
  ipSubnet: string;
  blockNumber: number;
  blockchainTxHash: string;
  legalHoldFrozen: boolean;
}

export const INITIAL_PLATFORM_METADATA_LOGS: PlatformMetadataAuditLog[] = [
  {
    id: "SYS-AUD-901",
    timestamp: "2026-10-29 03:42:18",
    actorDid: "did:pulse:doc:0x93b7...20aa",
    actorRole: "ATTENDING_PHYSICIAN",
    tenantName: "Hôpital Central de Yaoundé",
    targetBookletHash: "sha256:pat_88f1c402 (Clinical Payload Redacted)",
    authorizationBasis: "EMERGENCY_BREAK_GLASS",
    deviceTokenUsed: "dev_tok_hcy_er_04",
    ipSubnet: "197.159.22.x",
    blockNumber: 4829120,
    blockchainTxHash: "0x91fe847291038472619283746192837461928374",
    legalHoldFrozen: true,
  },
  {
    id: "SYS-AUD-900",
    timestamp: "2026-10-28 16:40:05",
    actorDid: "did:pulse:broker:pre-01",
    actorRole: "PRE_REFERRAL_BROKER",
    tenantName: "HCY → Hôpital Général de Douala",
    targetBookletHash: "sha256:pat_71c833a1 (Clinical Payload Redacted)",
    authorizationBasis: "SYSTEM_PRE_ROUTING",
    deviceTokenUsed: "dev_tok_ksm_quorum",
    ipSubnet: "10.24.0.x",
    blockNumber: 4829115,
    blockchainTxHash: "0x77c19a823f90184bda2198034bfa892147acb012",
    legalHoldFrozen: false,
  },
  {
    id: "SYS-AUD-899",
    timestamp: "2026-10-27 07:15:22",
    actorDid: "did:pulse:doc:0x93b7...20aa",
    actorRole: "ATTENDING_PHYSICIAN",
    tenantName: "Hôpital Central de Yaoundé",
    targetBookletHash: "sha256:pat_71c833a1 (Clinical Payload Redacted)",
    authorizationBasis: "PATIENT_WEBAUTHN_CONSENT",
    deviceTokenUsed: "dev_tok_9f81c204",
    ipSubnet: "197.159.18.x",
    blockNumber: 4829108,
    blockchainTxHash: "0x39a1b8c7e9021487f9120485cba7918234ef0182",
    legalHoldFrozen: false,
  },
];

export interface SecurityAnomalyAlert {
  id: string;
  timestamp: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  tenantName: string;
  suspectActorDid: string;
  patternType: "BULK_EXPORT_ATTEMPT" | "REPEATED_DECRYPTION_FAILURE" | "ABNORMAL_OFF_HOURS_QUERY";
  description: string;
  status: "ACTIVE_ALERT" | "QUARANTINED" | "DISMISSED";
}

export const INITIAL_ANOMALY_ALERTS: SecurityAnomalyAlert[] = [
  {
    id: "ANOM-401",
    timestamp: "2026-10-29 02:14:50",
    severity: "CRITICAL",
    tenantName: "Clinique Médico-Chirurgicale de Bastos",
    suspectActorDid: "did:pulse:staff:0x81d4...19b2",
    patternType: "BULK_EXPORT_ATTEMPT",
    description: "47 consecutive FHIR Booklet queries within 90 seconds from a single workstation outside scheduled shift hours.",
    status: "ACTIVE_ALERT",
  },
  {
    id: "ANOM-398",
    timestamp: "2026-10-28 21:05:12",
    severity: "HIGH",
    tenantName: "Hôpital Général de Douala",
    suspectActorDid: "did:pulse:doc:0x55e2...88a1",
    patternType: "REPEATED_DECRYPTION_FAILURE",
    description: "6 failed Shamir KSM re-encryption challenge signatures (expired consent token).",
    status: "QUARANTINED",
  },
];

// 8. Multi-Tenant Operations, Quotas, Feature Flags & Billing
export interface HospitalTenantQuota {
  id: string;
  name: string;
  code: string;
  city: string;
  tier: "NATIONAL_REFERENCE_ENTERPRISE" | "UNIVERSITY_HOSPITAL" | "PRIVATE_CLINIC_PRO";
  isolationMode: "DEDICATED_SCHEMA_RLS" | "ROW_LEVEL_SECURITY";
  operationalState: "ACTIVE" | "READ_ONLY_COMPLIANCE_MODE"; // Delinquent tenants switch to read-only compliance mode rather than deleting clinical data
  billingStatus: "CURRENT" | "DELINQUENT_PAST_DUE";
  imagingStorageUsedGb: number;
  imagingStorageQuotaGb: number;
  rateLimitReqPerMin: number;
  currentLoadReqPerMin: number;
  featureFlags: {
    telemedicineModule: boolean;
    pharmacyInventory: boolean;
    aiTriageAssistant: boolean;
    pacsDicomGateway: boolean;
  };
  lastColdBackupAt: string;
}

export const INITIAL_TENANT_QUOTAS: HospitalTenantQuota[] = [
  {
    id: "hosp-yaounde-central",
    name: "Hôpital Central de Yaoundé (HCY)",
    code: "CM-YDE-HCY-01",
    city: "Yaoundé",
    tier: "NATIONAL_REFERENCE_ENTERPRISE",
    isolationMode: "DEDICATED_SCHEMA_RLS",
    operationalState: "ACTIVE",
    billingStatus: "CURRENT",
    imagingStorageUsedGb: 3420,
    imagingStorageQuotaGb: 5000,
    rateLimitReqPerMin: 2500,
    currentLoadReqPerMin: 840,
    featureFlags: {
      telemedicineModule: true,
      pharmacyInventory: true,
      aiTriageAssistant: true,
      pacsDicomGateway: true,
    },
    lastColdBackupAt: "2026-10-29 03:00 UTC (Geo-Replicated)",
  },
  {
    id: "hosp-douala-general",
    name: "Hôpital Général de Douala (HGD)",
    code: "CM-DLA-HGD-01",
    city: "Douala",
    tier: "NATIONAL_REFERENCE_ENTERPRISE",
    isolationMode: "DEDICATED_SCHEMA_RLS",
    operationalState: "ACTIVE",
    billingStatus: "CURRENT",
    imagingStorageUsedGb: 4110,
    imagingStorageQuotaGb: 5000,
    rateLimitReqPerMin: 2500,
    currentLoadReqPerMin: 920,
    featureFlags: {
      telemedicineModule: true,
      pharmacyInventory: true,
      aiTriageAssistant: false,
      pacsDicomGateway: true,
    },
    lastColdBackupAt: "2026-10-29 03:00 UTC (Geo-Replicated)",
  },
  {
    id: "hosp-chu-yaounde",
    name: "Centre Hospitalier et Universitaire de Yaoundé (CHU)",
    code: "CM-YDE-CHU-01",
    city: "Yaoundé",
    tier: "UNIVERSITY_HOSPITAL",
    isolationMode: "DEDICATED_SCHEMA_RLS",
    operationalState: "ACTIVE",
    billingStatus: "CURRENT",
    imagingStorageUsedGb: 1890,
    imagingStorageQuotaGb: 3000,
    rateLimitReqPerMin: 1800,
    currentLoadReqPerMin: 410,
    featureFlags: {
      telemedicineModule: true,
      pharmacyInventory: true,
      aiTriageAssistant: true,
      pacsDicomGateway: true,
    },
    lastColdBackupAt: "2026-10-29 03:00 UTC (Geo-Replicated)",
  },
  {
    id: "hosp-clinique-bastos",
    name: "Clinique Médico-Chirurgicale de Bastos",
    code: "CM-YDE-CMB-04",
    city: "Yaoundé",
    tier: "PRIVATE_CLINIC_PRO",
    isolationMode: "ROW_LEVEL_SECURITY",
    operationalState: "READ_ONLY_COMPLIANCE_MODE",
    billingStatus: "DELINQUENT_PAST_DUE",
    imagingStorageUsedGb: 780,
    imagingStorageQuotaGb: 1000,
    rateLimitReqPerMin: 600,
    currentLoadReqPerMin: 45,
    featureFlags: {
      telemedicineModule: false,
      pharmacyInventory: true,
      aiTriageAssistant: false,
      pacsDicomGateway: false,
    },
    lastColdBackupAt: "2026-10-29 03:00 UTC (Geo-Replicated)",
  },
];

// 9. Hospital Manager (Tenant Level) Local Catalog, Room Rates & Pharmacy Stock
export interface LocalTenantServiceTariff {
  id: string;
  category: "CONSULTATION" | "ROOM_RATE" | "PHARMACY_STOCK" | "DIAGNOSTIC_LAB";
  itemName: string;
  localCode: string;
  unitPriceXaf: number;
  stockOrCapacity: string;
  status: "AVAILABLE" | "LOW_STOCK" | "FULL_CAPACITY";
}

export const INITIAL_LOCAL_TARIFFS: LocalTenantServiceTariff[] = [
  {
    id: "loc-01",
    category: "CONSULTATION",
    itemName: "Consultation Cardiologie Spécialisée",
    localCode: "HCY-CONS-CARD",
    unitPriceXaf: 15000,
    stockOrCapacity: "4 Praticiens en service",
    status: "AVAILABLE",
  },
  {
    id: "loc-02",
    category: "ROOM_RATE",
    itemName: "Chambre Individuelle Soins Intensifs (USIC)",
    localCode: "HCY-WARD-USIC",
    unitPriceXaf: 45000,
    stockOrCapacity: "11 / 12 Lits occupés",
    status: "LOW_STOCK",
  },
  {
    id: "loc-03",
    category: "PHARMACY_STOCK",
    itemName: "Atorvastatine 20mg (Boîte de 30 cp)",
    localCode: "HCY-PHARM-ATOR20",
    unitPriceXaf: 6500,
    stockOrCapacity: "240 boîtes en stock",
    status: "AVAILABLE",
  },
  {
    id: "loc-04",
    category: "PHARMACY_STOCK",
    itemName: "Amlodipine 5mg (Boîte de 30 cp)",
    localCode: "HCY-PHARM-AMLO5",
    unitPriceXaf: 4200,
    stockOrCapacity: "18 boîtes restantes",
    status: "LOW_STOCK",
  },
  {
    id: "loc-05",
    category: "DIAGNOSTIC_LAB",
    itemName: "Bilan Lipidique Complet + ECG 12 Dérivations",
    localCode: "HCY-LAB-LIPECG",
    unitPriceXaf: 22000,
    stockOrCapacity: "Automate Biochimie Actif",
    status: "AVAILABLE",
  },
];

