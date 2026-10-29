import { StoredCredential } from "./webauthn";

export interface ClaimItem {
  id: string;
  service: string;
  decisionDate: string;
  provider: string;
  insurerPaid: string;
  totalBill: string;
  status: "Approved" | "Rejected" | "Pending";
  blockchainTxHash: string;
  blockNumber: number;
  digitalSignature: string;
}

export interface InsurancePolicy {
  providerName: string;
  isPrimary: boolean;
  policyNumber: string;
  holder: string;
  coverage: string;
  validTo: string;
  deductibleRemaining: string;
}

export interface PatientProfile {
  name: string;
  email: string;
  role: "patient" | "doctor" | "admin";
  bloodType: string;
  dateOfBirth: string;
  emergencyContact: string;
  allergies: string[];
  blockchainAddress: string;
  did: string;
  credentialId: string;
  publicKeyHex: string;
  keyAlgorithm: string;
}

export const INITIAL_POLICY: InsurancePolicy = {
  providerName: "Allianz Care & CNPS Santé",
  isPrimary: true,
  policyNumber: "AC-449-20115",
  holder: "Alex Mensah (the patient)",
  coverage: "80% after $250 deductible",
  validTo: "31 Dec 2026",
  deductibleRemaining: "$0.00 (Met)",
};

export const INITIAL_CLAIMS: ClaimItem[] = [
  {
    id: "CLM-001",
    service: "Lipid panel",
    decisionDate: "18 Jul 2026",
    provider: "Meridian Diagnostics",
    insurerPaid: "$48.00",
    totalBill: "$60.00",
    status: "Approved",
    blockchainTxHash: "0x89e24f7b11d4e0c384218841d1aa5683907c1264b",
    blockNumber: 4829104,
    digitalSignature: "0x77ab41f99c2d1b70...",
  },
  {
    id: "CLM-002",
    service: "Consultation with Dr Whitfield",
    decisionDate: "30 Jun 2026",
    provider: "-",
    insurerPaid: "$52.00",
    totalBill: "$65.00",
    status: "Approved",
    blockchainTxHash: "0x44d18fa7b49231fca1209b0c291845bb08a73921b",
    blockNumber: 4828750,
    digitalSignature: "0x33cf81a20e981244...",
  },
  {
    id: "CLM-003",
    service: "Annual physical",
    decisionDate: "12 Jun 2026",
    provider: "-",
    insurerPaid: "$96.00",
    totalBill: "$120.00",
    status: "Approved",
    blockchainTxHash: "0x12a9bc417629bde0941a87b2169994c9a871034f1",
    blockNumber: 4827991,
    digitalSignature: "0x88ea9121fc0028a7...",
  },
  {
    id: "CLM-004",
    service: "HbA1c panel",
    decisionDate: "20 Jan 2026",
    provider: "Fell inside your deductible",
    insurerPaid: "$0.00",
    totalBill: "$45.00",
    status: "Rejected",
    blockchainTxHash: "0x99fe102834c9ab17826194bca0716492381640192",
    blockNumber: 4820112,
    digitalSignature: "0x55bc1184712ef901...",
  },
  {
    id: "CLM-005",
    service: "MRI scan – lumbar spine",
    decisionDate: "05 May 2026",
    provider: "City Medical Imaging",
    insurerPaid: "$320.00",
    totalBill: "$400.00",
    status: "Approved",
    blockchainTxHash: "0x76bca928374182937461938bdfae0918237461928",
    blockNumber: 4825633,
    digitalSignature: "0x66fe49201948ba28...",
  },
  {
    id: "CLM-006",
    service: "Physical therapy session",
    decisionDate: "22 Apr 2026",
    provider: "Healing Hands Clinic",
    insurerPaid: "$75.00",
    totalBill: "$95.00",
    status: "Approved",
    blockchainTxHash: "0x321948abfe9012847291039847192837461928374",
    blockNumber: 4824901,
    digitalSignature: "0x11cb789201847293...",
  },
  {
    id: "CLM-007",
    service: "Chest X-ray",
    decisionDate: "15 Mar 2026",
    provider: "Radiology Associates",
    insurerPaid: "$55.00",
    totalBill: "$70.00",
    status: "Pending",
    blockchainTxHash: "0x55019283746192837461928374619283746192837",
    blockNumber: 4823419,
    digitalSignature: "0x99ee716254381920...",
  },
];

// Pre-seeded demo user (Alex Mensah) - Standard Patient Booklet
export const DEFAULT_DEMO_USER: StoredCredential = {
  id: "cred-pulse-alex-mensah",
  rawId: "cred-pulse-alex-mensah",
  publicKeyHex: "0489f7a20c918274bfae901827364510928374610928374610928374610928374610928374610928374610928374610928374610928374610928374610928374",
  publicKeyBase64: "BIn3ogwt6rV1v66QGCd0VRCcg3RhCSg3RhCSg3RhCSg3RhCSg3RhCSg3RhCSg3RhCSg=",
  algorithm: "ES256 (ECDSA P-256 / SHA-256)",
  blockchainAddress: "0x71c84f938217e90c6b553912a76f28d8419b33a1",
  did: "did:pulse:0x71c84f938217e90c6b553912a76f28d8419b33a1",
  user: {
    id: "usr-alex-mensah-2026",
    name: "Alex Mensah",
    email: "alex.mensah@pulseclinic.health",
    role: "patient",
  },
  createdAt: "2026-01-15T09:00:00.000Z",
  counter: 42,
  transports: ["internal"],
  type: "webauthn-hardware",
  roles: ["PATIENT"],
};

// Doctor Practitioner Credential (Connected to Cameroon Hospitals)
export const DEMO_DOCTOR_USER: StoredCredential = {
  id: "cred-doc-martin-kamga",
  rawId: "cred-doc-martin-kamga",
  publicKeyHex: "0493b7f11a48c201e74921b3394a819b48c71920aa89102938471625341829304958172635491028374619283746192837461928374619283746192837461928",
  publicKeyBase64: "BJO38RpIwh55IbM5SoGbSMcZIqqJEkkwR2JTRBgpMEla...",
  algorithm: "ES256 (ECDSA P-256 / SHA-256)",
  blockchainAddress: "0x93b7f11a48c201e74921b3394a819b48c71920aa",
  did: "did:pulse:doc:0x93b7f11a48c201e74921b3394a819b48c71920aa",
  user: {
    id: "doc-martin",
    name: "Dr. Martin Kamga",
    email: "martin.kamga@pulseclinic.cm",
    role: "doctor",
  },
  createdAt: "2026-02-10T11:00:00.000Z",
  counter: 128,
  transports: ["internal"],
  type: "webauthn-hardware",
  roles: ["PATIENT", "DOCTOR"],
  hospitalId: "hosp-yaounde-central",
  hospitalName: "Hôpital Central de Yaoundé (HCY)",
};

// Hospital Staff / Manager Credential (Tenant Admin)
export const DEMO_HOSPITAL_USER: StoredCredential = {
  id: "cred-staff-elena-rostova",
  rawId: "cred-staff-elena-rostova",
  publicKeyHex: "0499fe102834c9ab17826194bca07164923816401923847102938471928374619283746192837461928374619283746192837461928374619283746192837461",
  publicKeyBase64: "BJn+ECg0yauXgmGUvKRxZJI4FkAZI4RxApsUceKjdGGSI...",
  algorithm: "ES256 (ECDSA P-256 / SHA-256)",
  blockchainAddress: "0x55bc1184712ef901827364109283746192837461",
  did: "did:pulse:staff:0x55bc1184712ef901827364109283746192837461",
  user: {
    id: "stf-03",
    name: "Elena Rostova",
    email: "rostova@pulseclinic.cm",
    role: "admin",
  },
  createdAt: "2026-03-01T08:30:00.000Z",
  counter: 95,
  transports: ["internal"],
  type: "webauthn-hardware",
  roles: ["PATIENT", "HOSPITAL_STAFF"],
  hospitalId: "hosp-yaounde-central",
  hospitalName: "Hôpital Central de Yaoundé (HCY)",
};

// System Admin / MINSANTÉ National Health Board Credential (Platform Level)
export const DEMO_SYSADMIN_USER: StoredCredential = {
  id: "cred-admin-minsante",
  rawId: "cred-admin-minsante",
  publicKeyHex: "0488f1c4029182746192837461928374619283746192837461928374619283746192837461928374619283746192837461928374619283746192837461928374",
  publicKeyBase64: "BIjxxAKRg3RhCSg3RhCSg3RhCSg3RhCSg3RhCSg3RhCSg...",
  algorithm: "ES256 (ECDSA P-256 / SHA-256)",
  blockchainAddress: "0x12a9bc417629bde0941a87b2169994c9a871034f1",
  did: "did:pulse:gov:0x12a9bc417629bde0941a87b2169994c9a871034f1",
  user: {
    id: "usr-minsante-admin",
    name: "Dr. Samuel Eto'o (MINSANTÉ)",
    email: "admin.minsante@gov.cm",
    role: "admin",
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  counter: 350,
  transports: ["internal"],
  type: "webauthn-hardware",
  roles: ["PATIENT", "SYSTEM_ADMIN"],
};

export const ALL_DEMO_CREDENTIALS: StoredCredential[] = [
  DEFAULT_DEMO_USER,
  DEMO_DOCTOR_USER,
  DEMO_HOSPITAL_USER,
  DEMO_SYSADMIN_USER,
];

// Helper to reliably extract active roles from a credential
export function getRolesForCredential(cred?: StoredCredential | null): string[] {
  if (!cred) return ["PATIENT"];
  if (cred.roles && Array.isArray(cred.roles) && cred.roles.length > 0) {
    return cred.roles;
  }
  const name = cred.user?.name?.toLowerCase() || "";
  const role = cred.user?.role?.toLowerCase() || "";
  if (name.includes("martin") || role === "doctor") {
    return ["PATIENT", "DOCTOR"];
  }
  if (name.includes("rostova") || name.includes("hospital") || role === "hospital_staff") {
    return ["PATIENT", "HOSPITAL_STAFF"];
  }
  if (name.includes("minsanté") || name.includes("sysadmin") || name.includes("eto'o")) {
    return ["PATIENT", "SYSTEM_ADMIN"];
  }
  return ["PATIENT"];
}
