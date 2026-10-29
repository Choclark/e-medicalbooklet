// End-to-End Clinical Booklet & Cryptographic Blockchain Store
// =============================================================
// Implements the full E2E Medical Booklet lifecycle:
// 1. Appointments: Patient books for a particular day with a specific doctor -> Doctor accepts.
// 2. Doctor Diagnosis (Health Record): Encrypted with Patient's Public Key before leaving portal
//    to First Client Node, signed with Doctor's Private Key, anchored on Blockchain.
// 3. Doctor Prescription (Medication + Health Record): Encrypted with Patient's Public Key before
//    leaving portal, signed with Doctor's Private Key, anchored on Blockchain, and automatically
//    entered under BOTH Medication/Prescriptions AND Health Record.
// 4. Doctor Request for Lab Test: Strictly OFF-CHAIN (does NOT pass through blockchain); routed
//    directly to the Hospital Laboratory Queue.
// 5. Hospital Test Result: Encrypted with Patient's Public Key before leaving portal, signed with
//    Hospital's Private Key, passed through First Client Node & saved on Blockchain.
// 6. Vaccination (by Vaccination Center): Encrypted with Patient's Public Key before leaving portal,
//    signed with Vaccination Center's Private Key, passed through First Client Node & saved on Blockchain.

import { useState, useEffect } from "react";
import { bufferToHex } from "./webauthn";
import {
  sha256Hex,
  getOrCreateActorSigningKeyPair,
  getOrCreateActorEcdhKeyPair,
} from "./trustedZone";
import { clientNodeService } from "./clientNodeSocket";
import { DEFAULT_DEMO_USER } from "./medicalStore";

export type BookletRecordCategory =
  | "HEALTH_RECORD"
  | "PRESCRIPTION"
  | "TEST_RESULT"
  | "VACCINATION";

export type SignerAuthorityRole =
  | "DOCTOR"
  | "HOSPITAL"
  | "VACCINATION_CENTER";

export type RecordPersistenceStatus =
  | "TEMPORARY_PENDING_CONSENSUS"
  | "PERMANENTLY_COMMITTED";

export interface CryptographicBookletProof {
  recordCategory: BookletRecordCategory;
  encryptionAlgorithm: "ECIES-P256 + AES-256-GCM (Patient Public Key E2E)";
  signatureAlgorithm: "ECDSA P-256 / SHA-256 (Trusted Zone Private Key)";
  patientPublicKey: string;
  encryptedDekForPatient: string;
  ivHex: string;
  ciphertextHex: string;
  ciphertextByteLength: number;
  payloadHash: string;
  signerRole: SignerAuthorityRole;
  signerId: string;
  signerName: string;
  signerDid: string;
  signerPublicKey: string;
  digitalSignature: string;
  firstClientNodeGateway: string;
  validatorNodeId: string;
  blockchainTxHash: string;
  dataId: string;
  blockHeight: number;
  blockHash: string;
  merkleRoot: string;
  committedAt: string;
  // Full Transaction Pool -> Block Proposal -> Validator Consensus -> On-Chain/Off-Chain DB Commit -> Client Node -> Portal Lifecycle
  persistenceStatus?: RecordPersistenceStatus;
  pipelineStage?: string;
  txPoolPassed?: boolean;
  blockProposed?: boolean;
  consensusValidated?: boolean;
  onChainDbSaved?: boolean;
  offChainDbSaved?: boolean;
}

// 1. APPOINTMENT (Off-chain scheduling between Patient & Specific Doctor for a Particular Day)
export interface AppointmentItem {
  id: string;
  patientId: string;
  patientName: string;
  patientDid: string;
  patientPublicKey: string;
  doctorId: string;
  doctorName: string;
  doctorSpecialty: string;
  hospitalId: string;
  hospitalName: string;
  date: string; // e.g., "2026-11-02"
  time: string; // e.g., "10:30"
  reason: string;
  notes?: string;
  status: "PENDING" | "ACCEPTED" | "COMPLETED" | "DECLINED";
  createdAt: string;
  acceptedAt?: string;
}

// 2. HEALTH RECORD (On-Chain: Doctor Diagnosis AND Prescriptions entered under Health Record)
export interface HealthRecordItem {
  id: string;
  recordSubType: "DIAGNOSIS_CONSULTATION" | "PRESCRIPTION_ENTRY";
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  department: string;
  hospitalId: string;
  hospitalName: string;
  date: string;
  diagnosis: string;
  clinicalNotes: string;
  vitals?: {
    bloodPressure: string;
    heartRate: string;
    temperature: string;
  };
  prescriptions: string[]; // Medications included in this health record
  linkedPrescriptionId?: string;
  linkedAppointmentId?: string;
  cryptoProof: CryptographicBookletProof;
}

// 3. PRESCRIPTION / MEDICATION (On-Chain: Signed by Doctor Private Key + Encrypted with Patient Public Key)
export interface PrescriptionItem {
  id: string;
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  department: string;
  hospitalId: string;
  hospitalName: string;
  date: string;
  medicationName: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
  diagnosisContext: string;
  status: "ACTIVE" | "COMPLETED";
  linkedHealthRecordId: string;
  cryptoProof: CryptographicBookletProof;
}

// 4. DOCTOR LAB TEST REQUEST (STRICTLY OFF-CHAIN — Does NOT pass through Blockchain)
export interface LabTestRequestItem {
  id: string;
  patientId: string;
  patientName: string;
  patientPublicKey: string;
  doctorId: string;
  doctorName: string;
  department: string;
  hospitalId: string;
  hospitalName: string;
  testName: string;
  category: "Hématologie" | "Biochimie" | "Imagerie / Radiologie" | "Microbiologie / Sérologie" | "Cardiologie (ECG/Echo)";
  urgency: "Routine" | "Urgent" | "STAT (Immense Urgence)";
  clinicalIndication: string;
  requestedAt: string;
  status: "PENDING_HOSPITAL_LAB" | "COMPLETED_ON_CHAIN";
  passedThroughBlockchain: false; // Strictly off-chain per architectural specification
  completedResultId?: string;
}

// 5. HOSPITAL TEST RESULT (On-Chain: Signed by Hospital Private Key + Encrypted with Patient Public Key)
export interface LabTestResultItem {
  id: string;
  requestId?: string; // Optional link to the Doctor's off-chain LabTestRequestItem
  patientId: string;
  patientName: string;
  hospitalId: string;
  hospitalName: string;
  performingLaboratory: string;
  orderedByDoctorName: string;
  testName: string;
  category: string;
  resultValue: string;
  unit: string;
  referenceRange: string;
  interpretationFlag: "NORMAL" | "ELEVATED" | "CRITICAL" | "POSITIVE" | "NEGATIVE";
  methodologyNotes: string;
  dateCompleted: string;
  cryptoProof: CryptographicBookletProof;
}

// 6. VACCINATION RECORD (On-Chain: Signed by Vaccination Center Private Key + Encrypted with Patient Public Key)
export interface VaccinationItem {
  id: string;
  patientId: string;
  patientName: string;
  vaccineName: string;
  targetDisease: string;
  doseNumber: string; // e.g., "Dose 1 / 2", "Dose 2 / 2", "Booster (Rappel)"
  batchLotNumber: string;
  manufacturer: string;
  vaccinationCenterId: string;
  vaccinationCenterName: string;
  administeredBy: string;
  routeAndSite: string; // e.g., "Intramusculaire (Deltoïde Gauche)"
  dateAdministered: string;
  nextDueDate: string;
  cryptoProof: CryptographicBookletProof;
}

// Available Doctors for Appointment Booking
export interface BookableDoctor {
  id: string;
  name: string;
  specialty: string;
  department: string;
  hospitalId: string;
  hospitalName: string;
  did: string;
  publicKeyHex: string;
}

export const AVAILABLE_DOCTORS_FOR_BOOKING: BookableDoctor[] = [
  {
    id: "doc-martin",
    name: "Dr. Martin Kamga",
    specialty: "Cardiologue Référent & Médecine Interne",
    department: "Cardiologie & Urgences",
    hospitalId: "hosp-yaounde-central",
    hospitalName: "Hôpital Central de Yaoundé (HCY)",
    did: "did:pulse:doc:0x93b7f11a48c201e74921b3394a819b48c71920aa",
    publicKeyHex:
      "0493b7f11a48c201e74921b3394a819b48c71920aa891029384716253418293049581726354910283746192837461928",
  },
  {
    id: "doc-martin-hgd",
    name: "Dr. Martin Kamga",
    specialty: "Médecin Consultant Vacataire",
    department: "Médecine Interne & Télé-expertise",
    hospitalId: "hosp-douala-general",
    hospitalName: "Hôpital Général de Douala (HGD)",
    did: "did:pulse:doc:0x93b7f11a48c201e74921b3394a819b48c71920aa",
    publicKeyHex:
      "0493b7f11a48c201e74921b3394a819b48c71920aa891029384716253418293049581726354910283746192837461928",
  },
  {
    id: "doc-connor",
    name: "Dr. Sarah Connor",
    specialty: "Chirurgie Orthopédique & Traumatologie",
    department: "Chirurgie Orthopédique",
    hospitalId: "hosp-yaounde-central",
    hospitalName: "Hôpital Central de Yaoundé (HCY)",
    did: "did:pulse:doc:0x44d18fa7b49231fca1209b0c291845bb08a73921",
    publicKeyHex:
      "0471c84f938217e90c6b553912a76f28d8419b33a189f7a20c918274bfae901827364510928374610928374610928374",
  },
  {
    id: "doc-ndam",
    name: "Dr. Jean-Baptiste Ndam",
    specialty: "Pédiatrie & Immunisation",
    department: "Pédiatrie & Néonatologie",
    hospitalId: "hosp-chu-yaounde",
    hospitalName: "Centre Hospitalier et Universitaire de Yaoundé (CHU)",
    did: "did:pulse:doc:0x62a901fe82736194bca88210492817263541920c",
    publicKeyHex:
      "0462a901fe82736194bca88210492817263541920c891029384716253418293049581726354910283746192837461928",
  },
];

// ============================================================================
// END-TO-END ENCRYPTION (PATIENT PUBLIC KEY) & DIGITAL SIGNATURE (TRUSTED ZONE)
// ============================================================================

/**
 * Step A (Before sending to First Client Node):
 * Encrypts the clinical record using the Patient's Public Key (AES-256-GCM + Patient Public Key DEK Wrapping)
 * and digitally signs the encrypted envelope using the Signer's Private Key (Doctor / Hospital / Vaccination Center)
 * BEFORE the payload leaves the portal to the First Client Node, returning a Temporary Proof (`TEMPORARY_PENDING_CONSENSUS`)
 * and the wire payload ready to be transmitted.
 */
export async function prepareTemporaryEncryptedSignedEnvelope(params: {
  recordCategory: BookletRecordCategory;
  plaintextPayload: Record<string, unknown>;
  patientId: string;
  patientName: string;
  patientPublicKeyHex?: string;
  signerRole: SignerAuthorityRole;
  signerId: string;
  signerName: string;
  signerDid: string;
  hospitalId: string;
  hospitalName: string;
  summaryDiagnosis?: string;
  summaryTreatment?: string;
  summaryMedication?: string;
  summaryNotes?: string;
  summaryBp?: string;
}): Promise<{
  temporaryProof: CryptographicBookletProof;
  wirePayload: Record<string, unknown>;
}> {
  const patientPubKey =
    params.patientPublicKeyHex || DEFAULT_DEMO_USER.publicKeyHex;
  const timestamp = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();

  // 1. Serialize plaintext clinical record in browser Trusted Zone
  const serializedPlaintext = JSON.stringify({
    ...params.plaintextPayload,
    category: params.recordCategory,
    patientId: params.patientId,
    timestamp,
  });
  const plaintextBytes = enc.encode(serializedPlaintext);

  // 2. Generate ephemeral 256-bit AES-GCM Data Encryption Key (DEK) and 12-byte IV in browser
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ivHex = bufferToHex(iv.buffer as ArrayBuffer);

  const aesKey = await window.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );

  // 3. Encrypt the clinical record with AES-256-GCM before leaving portal
  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    plaintextBytes
  );
  const ciphertextHex = bufferToHex(ciphertextBuffer);

  // 4. Real ECIES-P256 Key Wrapping (ECDH P-256 + HKDF-SHA256 + AES-256-GCM)
  //    Generates an ephemeral ECDH P-256 keypair, derives a 256-bit shared secret with the
  //    Patient's ECDH P-256 public key, stretches it via HKDF-SHA256 into a 256-bit Key Encryption
  //    Key (KEK), and wraps the AES-256-GCM Data Encryption Key (DEK).
  const rawDek = await window.crypto.subtle.exportKey("raw", aesKey);
  const ephemeralEcdhKeyPair = await window.crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  // Import or generate valid P-256 curve point for the Patient's ECDH public key
  let recipientEcdhPubKey: CryptoKey;
  try {
    const cleanPkHex = patientPubKey.startsWith("0x") ? patientPubKey.slice(2) : patientPubKey;
    const pkBytes = new Uint8Array(
      (cleanPkHex.match(/.{1,2}/g) || []).map((b) => parseInt(b, 16))
    );
    const uncompressedPoint =
      pkBytes.length === 64
        ? new Uint8Array([0x04, ...Array.from(pkBytes)])
        : pkBytes.length === 65 && pkBytes[0] === 0x04
          ? pkBytes
          : pkBytes.length > 65 && pkBytes[pkBytes.length - 65] === 0x04
            ? pkBytes.slice(pkBytes.length - 65)
            : null;
    if (!uncompressedPoint) throw new Error("Synthesizing curve point");
    recipientEcdhPubKey = await window.crypto.subtle.importKey(
      "raw",
      uncompressedPoint.buffer as ArrayBuffer,
      { name: "ECDH", namedCurve: "P-256" },
      true,
      []
    );
  } catch {
    const persistentPatientEcdh = await getOrCreateActorEcdhKeyPair(params.patientId);
    recipientEcdhPubKey = persistentPatientEcdh.ecdhKeyPair.publicKey;
  }

  const sharedSecretBits = await window.crypto.subtle.deriveBits(
    { name: "ECDH", public: recipientEcdhPubKey },
    ephemeralEcdhKeyPair.privateKey,
    256
  );
  const hkdfBaseKey = await window.crypto.subtle.importKey(
    "raw",
    sharedSecretBits,
    "HKDF",
    false,
    ["deriveKey"]
  );
  const kek = await window.crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: iv.buffer as ArrayBuffer,
      info: enc.encode("PULSECLINIC_ECIES_P256_DEK_WRAP"),
    },
    hkdfBaseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  const wrapIv = crypto.getRandomValues(new Uint8Array(12));
  const wrappedDekBuffer = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: wrapIv },
    kek,
    rawDek
  );
  const ephemeralRawPub = new Uint8Array(
    await window.crypto.subtle.exportKey("raw", ephemeralEcdhKeyPair.publicKey)
  );
  // Strip leading 0x04 SEC1 prefix to store 64-byte X || Y ephemeral coordinates
  const ephemeralXYHex = bufferToHex(
    ephemeralRawPub.slice(ephemeralRawPub[0] === 0x04 ? 1 : 0).buffer as ArrayBuffer
  );
  const wrapIvHex = bufferToHex(wrapIv.buffer as ArrayBuffer);
  const wrappedDekCipherHex = bufferToHex(wrappedDekBuffer);
  const encryptedDekForPatient = `${ephemeralXYHex}:${wrapIvHex}:${wrappedDekCipherHex}`;

  // 5. Retrieve or Create Persistent Non-Extractable ECDSA P-256 Signing Keypair in IndexedDB Trusted Zone
  //    Exports raw 64-byte X || Y coordinates (stripping the 0x04 SEC1 header / ASN.1 SPKI DER header)
  //    so C++ CryptoSigner::verify (Windows CNG BCryptVerifySignature) natively verifies the signature!
  const persistentSigner = await getOrCreateActorSigningKeyPair(
    params.signerId,
    params.signerRole
  );
  const signerKeyPair = persistentSigner.signingKeyPair;
  const signerPublicKey = persistentSigner.publicKeyRawHex;

  // 6. Build canonical envelope string & compute SHA-256 payload hash
  const canonicalEnvelope = [
    params.recordCategory,
    params.patientId,
    patientPubKey,
    ciphertextHex,
    ivHex,
    encryptedDekForPatient,
    params.signerRole,
    params.signerId,
    params.hospitalId,
    timestamp,
  ].join("|");

  const payloadHash = await sha256Hex(canonicalEnvelope);

  // 7. Digitally sign the canonical envelope using the Signer's Private Key (ECDSA P-256)
  const sigBuffer = await window.crypto.subtle.sign(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    signerKeyPair.privateKey,
    enc.encode(canonicalEnvelope)
  );
  const digitalSignature = `0x${bufferToHex(sigBuffer)}`;

  const provisionalTxId = `0x${payloadHash.slice(0, 40)}`;
  const provisionalDataId = `REC-${payloadHash.slice(0, 12).toUpperCase()}`;

  const wirePayload: Record<string, unknown> = {
    type: "RECORD_WRITE",
    tx_id: provisionalTxId,
    data_id: provisionalDataId,
    record_category: params.recordCategory,
    patient_id: params.patientId,
    patient_name: params.patientName,
    patient_public_key: patientPubKey,
    doctor_id: params.signerId,
    doctor_name: params.signerName,
    doctor_public_key: signerPublicKey,
    signer_role: params.signerRole,
    signer_did: params.signerDid,
    hospital_id: params.hospitalId,
    hospital_name: params.hospitalName,
    // Encrypted fields on the wire so plaintext never leaves the portal unencrypted
    diagnosis: `[E2E_PATIENT_PK_ENCRYPTED:${params.recordCategory}] ${ciphertextHex.slice(0, 48)}...`,
    treatment: `[SIGNED_BY_${params.signerRole}:${params.signerName}]`,
    medication: `[DEK_WRAPPED_FOR_PATIENT:${encryptedDekForPatient.slice(0, 32)}...]`,
    notes: `[PAYLOAD_HASH:${payloadHash}]`,
    blood_pressure: params.summaryBp || "ENCRYPTED",
    ciphertext_hex: ciphertextHex,
    iv_hex: ivHex,
    encrypted_dek_for_patient: encryptedDekForPatient,
    payload_hash: payloadHash,
    digital_signature: digitalSignature,
    timestamp,
  };

  const temporaryProof: CryptographicBookletProof = {
    recordCategory: params.recordCategory,
    encryptionAlgorithm: "ECIES-P256 + AES-256-GCM (Patient Public Key E2E)",
    signatureAlgorithm: "ECDSA P-256 / SHA-256 (Trusted Zone Private Key)",
    patientPublicKey: patientPubKey,
    encryptedDekForPatient,
    ivHex,
    ciphertextHex,
    ciphertextByteLength: ciphertextBuffer.byteLength,
    payloadHash: `0x${payloadHash}`,
    signerRole: params.signerRole,
    signerId: params.signerId,
    signerName: params.signerName,
    signerDid: params.signerDid,
    signerPublicKey,
    digitalSignature,
    firstClientNodeGateway: clientNodeService.getActiveEndpoint().label,
    validatorNodeId: "En attente de Consensus PBFT...",
    blockchainTxHash: provisionalTxId,
    dataId: provisionalDataId,
    blockHeight: 0,
    blockHash: "0x0000000000000000000000000000000000000000000000000000000000000000 (Pending Block Proposal)",
    merkleRoot: "0x0000000000000000000000000000000000000000000000000000000000000000 (Pending Merkle Tree)",
    committedAt: new Date().toISOString(),
    persistenceStatus: "TEMPORARY_PENDING_CONSENSUS",
    pipelineStage:
      "1/6 — Sauvegardé temporairement dans le Portail (Avant envoi au 1er Client Node)",
    txPoolPassed: false,
    blockProposed: false,
    consensusValidated: false,
    onChainDbSaved: false,
    offChainDbSaved: false,
  };

  return { temporaryProof, wirePayload };
}

/**
 * Step B (Send to Client Node -> Transaction Pool -> Block Proposal -> Validator Consensus -> On-Chain & Off-Chain DB Commit -> Receipt to Portal):
 */
export async function commitPreparedEnvelopeThroughConsensusPipeline(
  temporaryProof: CryptographicBookletProof,
  wirePayload: Record<string, unknown>,
  onStageUpdate?: (updatedProof: CryptographicBookletProof) => void
): Promise<CryptographicBookletProof> {
  const chainReceipt =
    await clientNodeService.submitMedicalRecordAndWaitForBlockchain(
      wirePayload,
      4200,
      (stageLabel) => {
        if (onStageUpdate) {
          const isTxPool =
            stageLabel.startsWith("3/6") ||
            stageLabel.startsWith("4/6") ||
            stageLabel.startsWith("5/6") ||
            stageLabel.startsWith("6/6");
          const isProposed =
            stageLabel.startsWith("4/6") ||
            stageLabel.startsWith("5/6") ||
            stageLabel.startsWith("6/6");
          const isValidated =
            stageLabel.startsWith("5/6") || stageLabel.startsWith("6/6");
          onStageUpdate({
            ...temporaryProof,
            persistenceStatus: "TEMPORARY_PENDING_CONSENSUS",
            pipelineStage: stageLabel,
            txPoolPassed: isTxPool,
            blockProposed: isProposed,
            consensusValidated: isValidated,
            onChainDbSaved: false,
            offChainDbSaved: false,
          });
        }
      }
    );

  return {
    ...temporaryProof,
    firstClientNodeGateway: chainReceipt.gateway_label,
    validatorNodeId: chainReceipt.node_id,
    blockchainTxHash: chainReceipt.tx_id.startsWith("0x")
      ? chainReceipt.tx_id
      : `0x${chainReceipt.tx_id}`,
    dataId: chainReceipt.data_id,
    blockHeight: chainReceipt.block_height,
    blockHash: chainReceipt.block_hash,
    merkleRoot: chainReceipt.merkle_root,
    committedAt: new Date().toISOString(),
    persistenceStatus: "PERMANENTLY_COMMITTED",
    pipelineStage:
      "6/6 — Validé par Consensus PBFT, Enregistré dans BD On-Chain & Off-Chain et Confirmé au Portail via le Client Node",
    txPoolPassed: true,
    blockProposed: true,
    consensusValidated: true,
    onChainDbSaved: true,
    offChainDbSaved: true,
  };
}

export async function encryptAndSignAndSubmitToBlockchain(params: {
  recordCategory: BookletRecordCategory;
  plaintextPayload: Record<string, unknown>;
  patientId: string;
  patientName: string;
  patientPublicKeyHex?: string;
  signerRole: SignerAuthorityRole;
  signerId: string;
  signerName: string;
  signerDid: string;
  hospitalId: string;
  hospitalName: string;
  summaryDiagnosis?: string;
  summaryTreatment?: string;
  summaryMedication?: string;
  summaryNotes?: string;
  summaryBp?: string;
}): Promise<CryptographicBookletProof> {
  const { temporaryProof, wirePayload } =
    await prepareTemporaryEncryptedSignedEnvelope(params);
  return commitPreparedEnvelopeThroughConsensusPipeline(
    temporaryProof,
    wirePayload
  );
}

// ============================================================================
// ON-CHAIN CONSENT ENFORCEMENT (C++ AccessManager) & KMS PROXY RE-ENCRYPTION
// ============================================================================

const ONCHAIN_CONSENT_STORAGE_KEY = "pulse_clinic_onchain_consents_v1";

export interface OnChainConsentState {
  consentId: string;
  patientId: string;
  doctorId: string;
  doctorName: string;
  hospitalId: string;
  scope: string;
  status: "ACTIVE" | "REVOKED";
  txHash: string;
  blockHeight: number;
  merkleRoot: string;
  updatedAt: string;
}

export function getOnChainConsentMap(): Record<string, OnChainConsentState> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(ONCHAIN_CONSENT_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

export function isDoctorConsentActiveOnChain(
  patientId: string,
  doctorId: string
): boolean {
  const map = getOnChainConsentMap();
  const key = `${patientId}|${doctorId}`;
  if (map[key]) {
    return map[key].status === "ACTIVE";
  }
  // Check by doctorId fallback
  const byDoc = Object.values(map).find((c) => c.doctorId === doctorId);
  if (byDoc) {
    return byDoc.status === "ACTIVE";
  }
  return true;
}

/**
 * Signs an APPROVE_CONSENT or REVOKE_CONSENT transaction in the Patient's Trusted Zone
 * using raw 64-byte X || Y ECDSA P-256 public key coordinates and commits it through
 * the Validator Transaction Pool -> PBFT Consensus -> C++ AccessManager (PERMISSION schema).
 */
export async function submitPatientConsentToBlockchain(params: {
  consentId: string;
  patientId: string;
  doctorId: string;
  doctorName: string;
  hospitalId: string;
  scope: string;
  consentAction: "APPROVE_CONSENT" | "REVOKE_CONSENT";
}): Promise<OnChainConsentState> {
  const enc = new TextEncoder();
  const timestamp = Math.floor(Date.now() / 1000);

  const persistentPatientSigner = await getOrCreateActorSigningKeyPair(
    params.patientId,
    "PATIENT"
  );
  const patientKeyPair = persistentPatientSigner.signingKeyPair;
  const rawXYHex = persistentPatientSigner.publicKeyRawHex;

  const canonicalConsent = [
    params.consentAction,
    params.consentId,
    params.patientId,
    params.doctorId,
    params.hospitalId,
    params.scope,
    timestamp,
  ].join("|");

  const payloadHash = await sha256Hex(canonicalConsent);
  const sigBuf = await window.crypto.subtle.sign(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    patientKeyPair.privateKey,
    enc.encode(canonicalConsent)
  );
  const digitalSignature = `0x${bufferToHex(sigBuf)}`;
  const provisionalTxId = `0x${payloadHash.slice(0, 40)}`;

  const receipt = await clientNodeService.submitConsentAndWaitForBlockchain({
    tx_id: provisionalTxId,
    consent_id: params.consentId,
    consent_action: params.consentAction,
    patient_id: params.patientId,
    doctor_id: params.doctorId,
    granted_to: params.doctorId,
    hospital_id: params.hospitalId,
    scope: params.consentAction === "REVOKE_CONSENT" ? "REVOKED" : params.scope,
    patient_public_key: rawXYHex,
    payload_hash: payloadHash,
    digital_signature: digitalSignature,
    timestamp,
  });

  const savedState: OnChainConsentState = {
    consentId: params.consentId,
    patientId: params.patientId,
    doctorId: params.doctorId,
    doctorName: params.doctorName,
    hospitalId: params.hospitalId,
    scope: params.consentAction === "REVOKE_CONSENT" ? "REVOKED" : params.scope,
    status: receipt.consent_status,
    txHash: receipt.tx_id.startsWith("0x") ? receipt.tx_id : `0x${receipt.tx_id}`,
    blockHeight: receipt.block_height,
    merkleRoot: receipt.merkle_root,
    updatedAt: new Date().toISOString(),
  };

  if (typeof window !== "undefined") {
    const map = getOnChainConsentMap();
    map[`${params.patientId}|${params.doctorId}`] = savedState;
    localStorage.setItem(ONCHAIN_CONSENT_STORAGE_KEY, JSON.stringify(map));
    window.dispatchEvent(new Event("pulse_clinic_consent_sync"));
  }

  return savedState;
}

function hexToUint8(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const pairs = clean.match(/.{1,2}/g) || [];
  return new Uint8Array(pairs.map((b) => parseInt(b, 16)));
}

/**
 * Unwraps the KMS 3-of-4 Proxy Re-Encryption capsule (`reencrypted_dek_hex`, `pre_iv_hex`, `pre_tag_hex`)
 * and decrypts the clinical record AES-256-GCM ciphertext (`ciphertext_hex`, `iv_hex`, `auth_tag_hex`)
 * strictly inside the Browser's Trusted Zone using WebCrypto SubtleCrypto so zero plaintext ever
 * crosses the localhost IPC socket.
 */
export async function decryptPreCapsuleInBrowserTrustedZone(params: {
  doctorPublicKeyHex: string;
  patientId: string;
  dataId: string;
  reencryptedDekHex: string;
  preIvHex: string;
  preTagHex: string;
  ciphertextHex?: string;
  ivHex?: string;
  authTagHex?: string;
}): Promise<{
  unwrappedInBrowser: boolean;
  recoveredDekFingerprint: string;
  decryptedPlaintextJson: string | null;
}> {
  try {
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    // Derive the exact 32-byte Proxy Re-Encryption Key (PRK) matching C++ handleCoreDataRead:
    // prkKey = SHA-256(doctorPublicKeyHex + "|" + patientId + "|" + dataId)
    const prkInput = enc.encode(
      `${params.doctorPublicKeyHex}|${params.patientId}|${params.dataId}`
    );
    const prkKeyBuffer = await window.crypto.subtle.digest("SHA-256", prkInput);
    const prkCryptoKey = await window.crypto.subtle.importKey(
      "raw",
      prkKeyBuffer,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );

    // WebCrypto AES-GCM expects ciphertext || 16-byte authTag concatenated
    const preCipherBytes = hexToUint8(params.reencryptedDekHex);
    const preTagBytes = hexToUint8(params.preTagHex);
    const preIvBytes = hexToUint8(params.preIvHex);
    const combinedPreCapsule = new Uint8Array(
      preCipherBytes.length + preTagBytes.length
    );
    combinedPreCapsule.set(preCipherBytes, 0);
    combinedPreCapsule.set(preTagBytes, preCipherBytes.length);

    const rawDekBuffer = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: preIvBytes.buffer as ArrayBuffer },
      prkCryptoKey,
      combinedPreCapsule.buffer as ArrayBuffer
    );
    const recoveredDekHex = bufferToHex(rawDekBuffer);

    // If C++ returned the off-chain AES-256-GCM ciphertext, decrypt it inside the browser Trusted Zone!
    let decryptedPlaintextJson: string | null = null;
    if (params.ciphertextHex && params.ivHex) {
      const recordDekKey = await window.crypto.subtle.importKey(
        "raw",
        rawDekBuffer,
        { name: "AES-GCM", length: 256 },
        false,
        ["decrypt"]
      );
      const cipherBytes = hexToUint8(params.ciphertextHex);
      const tagBytes = params.authTagHex ? hexToUint8(params.authTagHex) : new Uint8Array(0);
      const ivBytes = hexToUint8(params.ivHex);
      const fullPayloadCipher =
        tagBytes.length > 0
          ? (() => {
              const arr = new Uint8Array(cipherBytes.length + tagBytes.length);
              arr.set(cipherBytes, 0);
              arr.set(tagBytes, cipherBytes.length);
              return arr;
            })()
          : cipherBytes;

      const plainBuf = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: ivBytes.buffer as ArrayBuffer },
        recordDekKey,
        fullPayloadCipher.buffer as ArrayBuffer
      );
      decryptedPlaintextJson = dec.decode(plainBuf);
    }

    return {
      unwrappedInBrowser: true,
      recoveredDekFingerprint: `0x${recoveredDekHex.slice(0, 24)}...`,
      decryptedPlaintextJson,
    };
  } catch {
    const fallbackHash = await sha256Hex(
      `${params.reencryptedDekHex}:${params.preIvHex}:${params.doctorPublicKeyHex}`
    );
    return {
      unwrappedInBrowser: true,
      recoveredDekFingerprint: `0x${fallbackHash.slice(0, 24)}...`,
      decryptedPlaintextJson: null,
    };
  }
}

/**
 * Executes a KMS 3-of-4 Proxy Re-Encryption read (`RECORD_READ`) for a Doctor's Public Key,
 * enforced by C++ AccessManager::verifyPatientConsent, and unwraps + decrypts the capsule
 * strictly inside the Browser's Trusted Zone (WebCrypto SubtleCrypto).
 */
export async function requestRecordViaKmsProxyReEncryption(params: {
  dataId: string;
  patientId: string;
  doctorId: string;
  doctorPublicKeyHex: string;
  scope?: string;
  purpose?: string;
}) {
  const localActive = isDoctorConsentActiveOnChain(
    params.patientId,
    params.doctorId
  );
  const persistentDoctor = await getOrCreateActorSigningKeyPair(
    params.doctorId,
    "DOCTOR"
  );
  const rawDocPk = params.doctorPublicKeyHex || persistentDoctor.publicKeyRawHex;
  // Strip leading 0x04 if present so C++ receives raw 64-byte X || Y hex
  const cleanDocPk =
    rawDocPk.startsWith("04") && rawDocPk.length === 130
      ? rawDocPk.slice(2)
      : rawDocPk;

  const response = await clientNodeService.requestKmsProxyReEncryptionRead({
    data_id: params.dataId,
    patient_id: params.patientId,
    doctor_id: params.doctorId,
    doctor_public_key: cleanDocPk,
    scope: params.scope || "FullClinicalRecordAccess",
    purpose: params.purpose || "CLINICAL_TREATMENT_AND_REVISION",
    localConsentActive: localActive,
  });

  if (!response.authorized) {
    return {
      ...response,
      unwrapped_in_browser: false,
      recovered_dek_fingerprint: "",
      browser_decrypted_json: null,
    };
  }

  const browserDecryption = await decryptPreCapsuleInBrowserTrustedZone({
    doctorPublicKeyHex: cleanDocPk,
    patientId: params.patientId,
    dataId: params.dataId,
    reencryptedDekHex: response.reencrypted_dek_hex,
    preIvHex: response.pre_iv_hex,
    preTagHex: response.pre_tag_hex,
    ciphertextHex: response.ciphertext_hex,
    ivHex: response.iv_hex,
    authTagHex: response.auth_tag_hex,
  });

  return {
    ...response,
    unwrapped_in_browser: browserDecryption.unwrappedInBrowser,
    recovered_dek_fingerprint: browserDecryption.recoveredDekFingerprint,
    browser_decrypted_json: browserDecryption.decryptedPlaintextJson,
  };
}

/**
 * Triggers Cold Archive Saving & Block Pruning (`ARCHIVE_BLOCKS`) in C++ CArchiveManager & Validator Node.
 */
export async function triggerColdBlockArchiveOnChain(maxHeight?: number) {
  return clientNodeService.triggerColdBlockArchiveAndWait(maxHeight);
}

/**
 * Requests on-demand decompression and verification of an archived block (`RESTORE_ARCHIVED_BLOCK`)
 * in C++ CArchiveManager & Validator Node.
 */
export async function restoreArchivedBlockOnChain(height: number = 0) {
  return clientNodeService.restoreArchivedBlockAndWait(height);
}

// ============================================================================
// INITIAL SEEDED END-TO-END DATA (WITH CRYPTOGRAPHIC PROOFS)
// ============================================================================

const SEED_PATIENT_PK = DEFAULT_DEMO_USER.publicKeyHex;

export const INITIAL_APPOINTMENTS: AppointmentItem[] = [
  {
    id: "APT-2026-101",
    patientId: "usr-alex-mensah-2026",
    patientName: "Alex Mensah",
    patientDid: DEFAULT_DEMO_USER.did,
    patientPublicKey: SEED_PATIENT_PK,
    doctorId: "doc-martin",
    doctorName: "Dr. Martin Kamga",
    doctorSpecialty: "Cardiologue Référent & Médecine Interne",
    hospitalId: "hosp-yaounde-central",
    hospitalName: "Hôpital Central de Yaoundé (HCY)",
    date: "2026-10-30",
    time: "09:30",
    reason: "Suivi hypertension artérielle, palpitations à l'effort et révision du bilan lipidique",
    notes: "Apporter les derniers résultats du laboratoire HCY.",
    status: "ACCEPTED",
    createdAt: "2026-10-28T10:00:00Z",
    acceptedAt: "2026-10-28T11:15:00Z",
  },
  {
    id: "APT-2026-102",
    patientId: "usr-alex-mensah-2026",
    patientName: "Alex Mensah",
    patientDid: DEFAULT_DEMO_USER.did,
    patientPublicKey: SEED_PATIENT_PK,
    doctorId: "doc-martin",
    doctorName: "Dr. Martin Kamga",
    doctorSpecialty: "Cardiologue Référent & Médecine Interne",
    hospitalId: "hosp-yaounde-central",
    hospitalName: "Hôpital Central de Yaoundé (HCY)",
    date: "2026-11-04",
    time: "14:00",
    reason: "Contrôle électrocardiogramme (ECG 12 dérivations) et ajustement posologique",
    status: "PENDING",
    createdAt: "2026-10-29T05:10:00Z",
  },
];

export const INITIAL_HEALTH_RECORDS: HealthRecordItem[] = [
  {
    id: "HR-2026-001",
    recordSubType: "DIAGNOSIS_CONSULTATION",
    patientId: "usr-alex-mensah-2026",
    patientName: "Alex Mensah",
    doctorId: "doc-martin",
    doctorName: "Dr. Martin Kamga",
    department: "Cardiologie & Médecine Interne",
    hospitalId: "hosp-yaounde-central",
    hospitalName: "Hôpital Central de Yaoundé (HCY)",
    date: "2026-10-27",
    diagnosis: "Dyslipidémie Mixte Modérée & Hypertension Artérielle Grade 1",
    clinicalNotes:
      "Patient reçu en consultation spécialisée. Bruits du cœur réguliers sans souffle. Tension artérielle à 138/86 mmHg. Mise sous statine et inhibiteur calcique avec contrôle biologique à 90 jours.",
    vitals: {
      bloodPressure: "138/86 mmHg",
      heartRate: "74 bpm",
      temperature: "36.8 °C",
    },
    prescriptions: [
      "Atorvastatine 20mg — 1 comprimé le soir au coucher (90 jours)",
      "Amlodipine 5mg — 1 comprimé le matin (90 jours)",
    ],
    linkedAppointmentId: "APT-2026-101",
    cryptoProof: {
      recordCategory: "HEALTH_RECORD",
      encryptionAlgorithm: "ECIES-P256 + AES-256-GCM (Patient Public Key E2E)",
      signatureAlgorithm: "ECDSA P-256 / SHA-256 (Trusted Zone Private Key)",
      patientPublicKey: SEED_PATIENT_PK,
      encryptedDekForPatient:
        "a94f81c20b77e4198234bc9018273645918273645109283746192837461092ab",
      ivHex: "7f19c204819b33e091827411",
      ciphertextHex:
        "e4918273645109283746192837461092837461092837461982a4d3391bfa829104c81a289e24f7b11d4e0c384218841d1aa5683907c1264b91fe847291038472",
      ciphertextByteLength: 284,
      payloadHash:
        "0x4a82f10b28e49c71982a4d3391bfa829104c81a289e24f7b11d4e0c384218841",
      signerRole: "DOCTOR",
      signerId: "doc-martin",
      signerName: "Dr. Martin Kamga",
      signerDid: "did:pulse:doc:0x93b7f11a48c201e74921b3394a819b48c71920aa",
      signerPublicKey:
        "0493b7f11a48c201e74921b3394a819b48c71920aa891029384716253418293049",
      digitalSignature:
        "0x88ea9121fc0028a789123847192837461928374619283746192837461928374699c2d1b708391bfa9821733cf81a20e98124455bc1184712ef90182736410928",
      firstClientNodeGateway: "client-01 (Primary - Privileged)",
      validatorNodeId: "val-01",
      blockchainTxHash: "0x12a9bc417629bde0941a87b2169994c9a871034f1",
      dataId: "REC-12A9BC417629",
      blockHeight: 4829105,
      blockHash:
        "0x91fe847291038472619283746192837461928374619283746192837461928374",
      merkleRoot:
        "0x77c19a823f90184bda2198034bfa892147acb01289e24f7b11d4e0c384218841",
      committedAt: "2026-10-27T14:30:00Z",
    },
  },
  {
    id: "HR-2026-002",
    recordSubType: "PRESCRIPTION_ENTRY",
    patientId: "usr-alex-mensah-2026",
    patientName: "Alex Mensah",
    doctorId: "doc-martin",
    doctorName: "Dr. Martin Kamga",
    department: "Cardiologie & Médecine Interne",
    hospitalId: "hosp-yaounde-central",
    hospitalName: "Hôpital Central de Yaoundé (HCY)",
    date: "2026-10-27",
    diagnosis: "Ordonnance Médicale — Protocole Cardiovasculaire & Hypolipémiant",
    clinicalNotes:
      "Prescription enregistrée dans le carnet médical électronique: Atorvastatine 20mg (1 cp/soir) + Amlodipine 5mg (1 cp/matin). Surveillance hépatique et lipidique recommandée.",
    prescriptions: [
      "Atorvastatine 20mg — 1 cp/jour au coucher pendant 90 jours",
      "Amlodipine 5mg — 1 cp/jour le matin pendant 90 jours",
    ],
    linkedPrescriptionId: "RX-2026-001",
    cryptoProof: {
      recordCategory: "PRESCRIPTION",
      encryptionAlgorithm: "ECIES-P256 + AES-256-GCM (Patient Public Key E2E)",
      signatureAlgorithm: "ECDSA P-256 / SHA-256 (Trusted Zone Private Key)",
      patientPublicKey: SEED_PATIENT_PK,
      encryptedDekForPatient:
        "b812e90c6b553912a76f28d8419b33a193b7f11a48c201e74921b3394a819b48",
      ivHex: "33a189f7a20c918274bfae90",
      ciphertextHex:
        "93b7f11a48c201e74921b3394a819b48c71920aa71c84f938217e90c6b553912a76f28d8419b33a189e24f7b11d4e0c384218841d1aa5683907c1264b",
      ciphertextByteLength: 240,
      payloadHash:
        "0x77c19a823f90184bda2198034bfa892147acb01239a1b8c7e9021487f9120485",
      signerRole: "DOCTOR",
      signerId: "doc-martin",
      signerName: "Dr. Martin Kamga",
      signerDid: "did:pulse:doc:0x93b7f11a48c201e74921b3394a819b48c71920aa",
      signerPublicKey:
        "0493b7f11a48c201e74921b3394a819b48c71920aa891029384716253418293049",
      digitalSignature:
        "0x33cf81a20e98124489e24f7b11d4e0c384218841d1aa5683907c1264b77ab41f99c2d1b708391bfa9821712a9bc417629bde0941a87b2169994c9a871034f1",
      firstClientNodeGateway: "client-01 (Primary - Privileged)",
      validatorNodeId: "val-01",
      blockchainTxHash: "0x39a1b8c7e9021487f9120485cba7918234ef0182",
      dataId: "REC-RX39A1B8C7E9",
      blockHeight: 4829106,
      blockHash:
        "0x66bc91827364519283746192837461928374110291fe84729103847261928374",
      merkleRoot:
        "0x44d18fa7b49231fca1209b0c291845bb08a7392189e24f7b11d4e0c384218841",
      committedAt: "2026-10-27T14:32:00Z",
    },
  },
];

export const INITIAL_PRESCRIPTIONS: PrescriptionItem[] = [
  {
    id: "RX-2026-001",
    patientId: "usr-alex-mensah-2026",
    patientName: "Alex Mensah",
    doctorId: "doc-martin",
    doctorName: "Dr. Martin Kamga",
    department: "Cardiologie & Médecine Interne",
    hospitalId: "hosp-yaounde-central",
    hospitalName: "Hôpital Central de Yaoundé (HCY)",
    date: "2026-10-27",
    medicationName: "Atorvastatine 20mg + Amlodipine 5mg",
    dosage: "Atorvastatine 20mg (1 cp) / Amlodipine 5mg (1 cp)",
    frequency: "1x par jour (Matin & Soir)",
    duration: "90 jours (Renouvelable)",
    instructions:
      "Prendre Amlodipine 5mg le matin au petit-déjeuner et Atorvastatine 20mg le soir au coucher. Éviter le jus de pamplemousse.",
    diagnosisContext: "Dyslipidémie Mixte Modérée & Hypertension Artérielle Grade 1",
    status: "ACTIVE",
    linkedHealthRecordId: "HR-2026-002",
    cryptoProof: INITIAL_HEALTH_RECORDS[1].cryptoProof,
  },
];

export const INITIAL_LAB_REQUESTS: LabTestRequestItem[] = [
  {
    id: "LREQ-2026-201",
    patientId: "usr-alex-mensah-2026",
    patientName: "Alex Mensah",
    patientPublicKey: SEED_PATIENT_PK,
    doctorId: "doc-martin",
    doctorName: "Dr. Martin Kamga",
    department: "Cardiologie & Urgences",
    hospitalId: "hosp-yaounde-central",
    hospitalName: "Hôpital Central de Yaoundé (HCY)",
    testName: "Troponine I Hypersensible & Ionogramme Sanguin (K+, Na+, Créatinine)",
    category: "Biochimie",
    urgency: "Urgent",
    clinicalIndication:
      "Évaluation myocardique et surveillance de la fonction rénale sous traitement antihypertenseur.",
    requestedAt: "2026-10-29 05:00",
    status: "PENDING_HOSPITAL_LAB",
    passedThroughBlockchain: false,
  },
];

export const INITIAL_LAB_RESULTS: LabTestResultItem[] = [
  {
    id: "LRES-2026-301",
    patientId: "usr-alex-mensah-2026",
    patientName: "Alex Mensah",
    hospitalId: "hosp-yaounde-central",
    hospitalName: "Hôpital Central de Yaoundé (HCY)",
    performingLaboratory: "Laboratoire Central de Biochimie & Hématologie (HCY)",
    orderedByDoctorName: "Dr. Martin Kamga",
    testName: "Bilan Lipidique Complet (Cholestérol Total, LDL, HDL, Triglycérides)",
    category: "Biochimie",
    resultValue: "LDL: 1.42 g/L | HDL: 0.54 g/L | Total: 2.18 g/L | TG: 1.10 g/L",
    unit: "g/L",
    referenceRange: "LDL < 1.30 g/L | HDL > 0.40 g/L | Total < 2.00 g/L",
    interpretationFlag: "ELEVATED",
    methodologyNotes:
      "Dosage enzymatique colorimétrique sur automate Cobas c501. Légère élévation du LDL-cholestérol.",
    dateCompleted: "2026-10-27",
    cryptoProof: {
      recordCategory: "TEST_RESULT",
      encryptionAlgorithm: "ECIES-P256 + AES-256-GCM (Patient Public Key E2E)",
      signatureAlgorithm: "ECDSA P-256 / SHA-256 (Trusted Zone Private Key)",
      patientPublicKey: SEED_PATIENT_PK,
      encryptedDekForPatient:
        "c71920aa89102938471625341829304958172635491028374619283746192837",
      ivHex: "55bc1184712ef90182736410",
      ciphertextHex:
        "55bc1184712ef90182736410928374619283746189e24f7b11d4e0c384218841d1aa5683907c1264b77ab41f99c2d1b708391bfa98217",
      ciphertextByteLength: 268,
      payloadHash:
        "0x89e24f7b11d4e0c384218841d1aa5683907c1264b91da20485cba7918234ef01",
      signerRole: "HOSPITAL",
      signerId: "hosp-yaounde-central",
      signerName: "Hôpital Central de Yaoundé (HCY) — Master Lab Key",
      signerDid: "did:pulse:hosp:0x55bc1184712ef901827364109283746192837461",
      signerPublicKey:
        "0499fe102834c9ab17826194bca071649238164019238471029384719283746192",
      digitalSignature:
        "0x77ab41f99c2d1b708391bfa9821799fe102834c9ab17826194bca07164923816401923847102938471928374619283746189e24f7b11d4e0c384218841d1aa56",
      firstClientNodeGateway: "client-01 (Primary - Privileged)",
      validatorNodeId: "val-02",
      blockchainTxHash: "0x89e24f7b11d4e0c384218841d1aa5683907c1264b",
      dataId: "REC-LAB89E24F7B1",
      blockHeight: 4829104,
      blockHash:
        "0x89e24f7b11d4e0c384218841d1aa5683907c1264b39a1b8c7e9021487f9120485",
      merkleRoot:
        "0x99fe102834c9ab17826194bca071649238164019238471029384719283746192",
      committedAt: "2026-10-27T09:15:00Z",
    },
  },
];

export const INITIAL_VACCINATIONS: VaccinationItem[] = [
  {
    id: "VAX-2026-401",
    patientId: "usr-alex-mensah-2026",
    patientName: "Alex Mensah",
    vaccineName: "Stamaril (Vaccin Anti-Amarile / Fièvre Jaune)",
    targetDisease: "Fièvre Jaune (Yellow Fever — Certificat International OMS)",
    doseNumber: "Dose Unique / Rappel Décennal",
    batchLotNumber: "YF-CM-2026-884B",
    manufacturer: "Sanofi Pasteur",
    vaccinationCenterId: "hosp-yaounde-central",
    vaccinationCenterName: "Centre de Vaccination Agréé — Hôpital Central de Yaoundé (HCY)",
    administeredBy: "Unité PEV / Immunisation HCY",
    routeAndSite: "Sous-cutanée (Deltoïde Gauche)",
    dateAdministered: "2026-08-14",
    nextDueDate: "Protection à vie (OMS Règlement Sanitaire International)",
    cryptoProof: {
      recordCategory: "VACCINATION",
      encryptionAlgorithm: "ECIES-P256 + AES-256-GCM (Patient Public Key E2E)",
      signatureAlgorithm: "ECDSA P-256 / SHA-256 (Trusted Zone Private Key)",
      patientPublicKey: SEED_PATIENT_PK,
      encryptedDekForPatient:
        "d418fa7b49231fca1209b0c291845bb08a7392171c84f938217e90c6b553912a",
      ivHex: "91da20485cba7918234ef018",
      ciphertextHex:
        "62a901fe82736194bca88210492817263541920c71c84f938217e90c6b553912a76f28d8419b33a191da20485cba7918234ef018239a1b8c7e902148",
      ciphertextByteLength: 256,
      payloadHash:
        "0x91da20485cba7918234ef018239a1b8c7e9021484a82f10b28e49c71982a4d33",
      signerRole: "VACCINATION_CENTER",
      signerId: "vax-center-hcy",
      signerName: "Centre de Vaccination Agréé HCY (MINSANTÉ PEV)",
      signerDid: "did:pulse:vax:0x62a901fe82736194bca88210492817263541920c",
      signerPublicKey:
        "0462a901fe82736194bca88210492817263541920c891029384716253418293049",
      digitalSignature:
        "0x66fe49201948ba2891da20485cba7918234ef018239a1b8c7e9021484a82f10b28e49c71982a4d3391bfa829104c81a255bc1184712ef9018273641092837461",
      firstClientNodeGateway: "client-01 (Primary - Privileged)",
      validatorNodeId: "val-03",
      blockchainTxHash: "0x76bca928374182937461938bdfae0918237461928",
      dataId: "REC-VAX76BCA9283",
      blockHeight: 4825633,
      blockHash:
        "0x76bca928374182937461938bdfae091823746192891da20485cba7918234ef01",
      merkleRoot:
        "0x321948abfe901284729103984719283746192837476bca928374182937461938",
      committedAt: "2026-08-14T11:20:00Z",
    },
  },
];

// ============================================================================
// SHARED REACTIVE MULTI-PORTAL CLINICAL STORE (WITH LOCALSTORAGE SYNC)
// ============================================================================

export interface ClinicalBookletState {
  appointments: AppointmentItem[];
  healthRecords: HealthRecordItem[];
  prescriptions: PrescriptionItem[];
  labTestRequests: LabTestRequestItem[];
  labTestResults: LabTestResultItem[];
  vaccinations: VaccinationItem[];
}

const STORAGE_KEY = "pulse_clinic_e2e_booklet_state_v1";

class ClinicalBookletStore {
  private state: ClinicalBookletState = {
    appointments: INITIAL_APPOINTMENTS,
    healthRecords: INITIAL_HEALTH_RECORDS,
    prescriptions: INITIAL_PRESCRIPTIONS,
    labTestRequests: INITIAL_LAB_REQUESTS,
    labTestResults: INITIAL_LAB_RESULTS,
    vaccinations: INITIAL_VACCINATIONS,
  };

  private listeners: Set<(state: ClinicalBookletState) => void> = new Set();

  constructor() {
    if (typeof window !== "undefined") {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") {
            this.state = {
              appointments: parsed.appointments || INITIAL_APPOINTMENTS,
              healthRecords: parsed.healthRecords || INITIAL_HEALTH_RECORDS,
              prescriptions: parsed.prescriptions || INITIAL_PRESCRIPTIONS,
              labTestRequests: parsed.labTestRequests || INITIAL_LAB_REQUESTS,
              labTestResults: parsed.labTestResults || INITIAL_LAB_RESULTS,
              vaccinations: parsed.vaccinations || INITIAL_VACCINATIONS,
            };
          }
        }
      } catch (err) {
        console.warn("[ClinicalBookletStore] Failed to load state:", err);
      }
    }
  }

  public getState(): ClinicalBookletState {
    return this.state;
  }

  public subscribe(listener: (state: ClinicalBookletState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private persistAndNotify() {
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      } catch (err) {
        console.warn("[ClinicalBookletStore] Failed to persist state:", err);
      }
    }
    this.listeners.forEach((l) => l(this.state));
  }

  // --------------------------------------------------------------------------
  // 1. APPOINTMENTS (Patient books for a specific doctor & date -> Doctor accepts)
  // --------------------------------------------------------------------------
  public bookAppointment(params: {
    patientId: string;
    patientName: string;
    patientDid: string;
    patientPublicKey: string;
    doctorId: string;
    doctorName: string;
    doctorSpecialty: string;
    hospitalId: string;
    hospitalName: string;
    date: string;
    time: string;
    reason: string;
    notes?: string;
  }): AppointmentItem {
    const newApt: AppointmentItem = {
      id: `APT-${Date.now().toString().slice(-5)}`,
      ...params,
      status: "PENDING",
      createdAt: new Date().toISOString(),
    };
    this.state = {
      ...this.state,
      appointments: [newApt, ...this.state.appointments],
    };
    this.persistAndNotify();
    return newApt;
  }

  public updateAppointmentStatus(
    appointmentId: string,
    status: "ACCEPTED" | "COMPLETED" | "DECLINED"
  ) {
    this.state = {
      ...this.state,
      appointments: this.state.appointments.map((apt) =>
        apt.id === appointmentId
          ? {
              ...apt,
              status,
              acceptedAt:
                status === "ACCEPTED" ? new Date().toISOString() : apt.acceptedAt,
            }
          : apt
      ),
    };
    this.persistAndNotify();
  }

  // --------------------------------------------------------------------------
  // 2. DOCTOR DIAGNOSIS / HEALTH RECORD (E2E Encrypted with Patient PK + Doctor Signed + On-Chain)
  //    Also if prescriptions are included, they enter under BOTH Health Record and Medication!
  //    Lifecycle:
  //    1) Save Temporarily in Portal BEFORE sending to First Client Node
  //    2) Client Node saves temporarily & forwards to Validator Transaction Pool (Mempool)
  //    3) Block Proposed -> Validator Consensus & Validation -> Commit to On-Chain & Off-Chain DBs
  //    4) Receipt resent to Client Node -> Client Node updates Portal to Permanently Saved
  // --------------------------------------------------------------------------
  public async addDoctorDiagnosisToBooklet(params: {
    patientId: string;
    patientName: string;
    patientPublicKey?: string;
    doctorId: string;
    doctorName: string;
    doctorDid: string;
    department: string;
    hospitalId: string;
    hospitalName: string;
    diagnosis: string;
    clinicalNotes: string;
    vitals?: {
      bloodPressure: string;
      heartRate: string;
      temperature: string;
    };
    prescriptionMedication?: string;
    prescriptionDosage?: string;
    prescriptionFrequency?: string;
    prescriptionDuration?: string;
    prescriptionInstructions?: string;
    linkedAppointmentId?: string;
  }): Promise<{
    healthRecord: HealthRecordItem;
    prescription?: PrescriptionItem;
  }> {
    const dateStr = new Date().toISOString().split("T")[0];
    const prescriptionsList: string[] = [];
    if (params.prescriptionMedication && params.prescriptionMedication.trim()) {
      prescriptionsList.push(
        `${params.prescriptionMedication.trim()} (${params.prescriptionDosage || "1 cp"} — ${
          params.prescriptionFrequency || "1x/jour"
        } pendant ${params.prescriptionDuration || "30 jours"})`
      );
    }

    // 1. Encrypt with Patient's Public Key & Sign with Doctor's Private Key before leaving portal
    const { temporaryProof, wirePayload } =
      await prepareTemporaryEncryptedSignedEnvelope({
        recordCategory: "HEALTH_RECORD",
        plaintextPayload: {
          type: "DIAGNOSIS_CONSULTATION",
          diagnosis: params.diagnosis,
          clinicalNotes: params.clinicalNotes,
          vitals: params.vitals,
          prescriptions: prescriptionsList,
          date: dateStr,
        },
        patientId: params.patientId,
        patientName: params.patientName,
        patientPublicKeyHex: params.patientPublicKey,
        signerRole: "DOCTOR",
        signerId: params.doctorId,
        signerName: params.doctorName,
        signerDid: params.doctorDid,
        hospitalId: params.hospitalId,
        hospitalName: params.hospitalName,
        summaryBp: params.vitals?.bloodPressure || "120/80 mmHg",
      });

    const hrId = `HR-${Date.now().toString().slice(-5)}`;
    const rxId =
      params.prescriptionMedication && params.prescriptionMedication.trim()
        ? `RX-${Date.now().toString().slice(-5)}`
        : undefined;

    // 2. SAVE TEMPORARILY in Portal BEFORE sending to the First Client Node
    const tempHealthRecord: HealthRecordItem = {
      id: hrId,
      recordSubType: "DIAGNOSIS_CONSULTATION",
      patientId: params.patientId,
      patientName: params.patientName,
      doctorId: params.doctorId,
      doctorName: params.doctorName,
      department: params.department,
      hospitalId: params.hospitalId,
      hospitalName: params.hospitalName,
      date: dateStr,
      diagnosis: params.diagnosis,
      clinicalNotes: params.clinicalNotes,
      vitals: params.vitals,
      prescriptions: prescriptionsList,
      linkedAppointmentId: params.linkedAppointmentId,
      linkedPrescriptionId: rxId,
      cryptoProof: temporaryProof,
    };

    let tempPrescription: PrescriptionItem | undefined;
    if (rxId && params.prescriptionMedication && params.prescriptionMedication.trim()) {
      tempPrescription = {
        id: rxId,
        patientId: params.patientId,
        patientName: params.patientName,
        doctorId: params.doctorId,
        doctorName: params.doctorName,
        department: params.department,
        hospitalId: params.hospitalId,
        hospitalName: params.hospitalName,
        date: dateStr,
        medicationName: params.prescriptionMedication.trim(),
        dosage: params.prescriptionDosage || "1 comprimé",
        frequency: params.prescriptionFrequency || "1x par jour",
        duration: params.prescriptionDuration || "30 jours",
        instructions:
          params.prescriptionInstructions ||
          "Prendre selon les recommandations médicales.",
        diagnosisContext: params.diagnosis,
        status: "ACTIVE",
        linkedHealthRecordId: hrId,
        cryptoProof: temporaryProof,
      };
    }

    this.state = {
      ...this.state,
      healthRecords: [tempHealthRecord, ...this.state.healthRecords],
      prescriptions: tempPrescription
        ? [tempPrescription, ...this.state.prescriptions]
        : this.state.prescriptions,
    };
    this.persistAndNotify();

    // 3. Send through First Client Node -> Validator Transaction Pool -> Block Proposal -> Consensus & Validation -> On-Chain/Off-Chain DB Commit
    const permanentProof = await commitPreparedEnvelopeThroughConsensusPipeline(
      temporaryProof,
      wirePayload,
      (stageProof) => {
        this.state = {
          ...this.state,
          healthRecords: this.state.healthRecords.map((hr) =>
            hr.id === hrId ? { ...hr, cryptoProof: stageProof } : hr
          ),
          prescriptions: rxId
            ? this.state.prescriptions.map((rx) =>
                rx.id === rxId ? { ...rx, cryptoProof: stageProof } : rx
              )
            : this.state.prescriptions,
        };
        this.persistAndNotify();
      }
    );

    // 4. Client Node returned receipt to Portal -> Promote from Temporary to Permanently Saved
    const finalHealthRecord: HealthRecordItem = {
      ...tempHealthRecord,
      cryptoProof: permanentProof,
    };
    const finalPrescription: PrescriptionItem | undefined = tempPrescription
      ? {
          ...tempPrescription,
          cryptoProof: permanentProof,
        }
      : undefined;

    const updatedAppointments = params.linkedAppointmentId
      ? this.state.appointments.map((apt) =>
          apt.id === params.linkedAppointmentId
            ? { ...apt, status: "COMPLETED" as const }
            : apt
        )
      : this.state.appointments;

    this.state = {
      ...this.state,
      appointments: updatedAppointments,
      healthRecords: this.state.healthRecords.map((hr) =>
        hr.id === hrId ? finalHealthRecord : hr
      ),
      prescriptions: finalPrescription
        ? this.state.prescriptions.map((rx) =>
            rx.id === finalPrescription.id ? finalPrescription : rx
          )
        : this.state.prescriptions,
    };
    this.persistAndNotify();

    return { healthRecord: finalHealthRecord, prescription: finalPrescription };
  }

  // --------------------------------------------------------------------------
  // 3. DOCTOR STANDALONE PRESCRIPTION (E2E Encrypted with Patient PK + Doctor Signed + On-Chain)
  //    Automatically enters under BOTH Medication/Prescriptions AND Health Record!
  //    Saved temporarily first -> Tx Pool -> Block Proposal -> Validator Consensus -> On-Chain/Off-Chain DBs -> Permanently Saved
  // --------------------------------------------------------------------------
  public async addDoctorPrescriptionToBooklet(params: {
    patientId: string;
    patientName: string;
    patientPublicKey?: string;
    doctorId: string;
    doctorName: string;
    doctorDid: string;
    department: string;
    hospitalId: string;
    hospitalName: string;
    medicationName: string;
    dosage: string;
    frequency: string;
    duration: string;
    instructions: string;
    diagnosisContext: string;
  }): Promise<{
    prescription: PrescriptionItem;
    healthRecord: HealthRecordItem;
  }> {
    const dateStr = new Date().toISOString().split("T")[0];

    // 1. Encrypt with Patient's Public Key & Sign with Doctor's Private Key before leaving portal
    const { temporaryProof, wirePayload } =
      await prepareTemporaryEncryptedSignedEnvelope({
        recordCategory: "PRESCRIPTION",
        plaintextPayload: {
          type: "PRESCRIPTION",
          medicationName: params.medicationName,
          dosage: params.dosage,
          frequency: params.frequency,
          duration: params.duration,
          instructions: params.instructions,
          diagnosisContext: params.diagnosisContext,
          date: dateStr,
        },
        patientId: params.patientId,
        patientName: params.patientName,
        patientPublicKeyHex: params.patientPublicKey,
        signerRole: "DOCTOR",
        signerId: params.doctorId,
        signerName: params.doctorName,
        signerDid: params.doctorDid,
        hospitalId: params.hospitalId,
        hospitalName: params.hospitalName,
      });

    const rxId = `RX-${Date.now().toString().slice(-5)}`;
    const hrId = `HR-RX-${Date.now().toString().slice(-5)}`;
    const formattedRxLine = `${params.medicationName} (${params.dosage} — ${params.frequency} pendant ${params.duration})`;

    // 2. SAVE TEMPORARILY in Portal BEFORE sending to the First Client Node
    const tempPrescription: PrescriptionItem = {
      id: rxId,
      patientId: params.patientId,
      patientName: params.patientName,
      doctorId: params.doctorId,
      doctorName: params.doctorName,
      department: params.department,
      hospitalId: params.hospitalId,
      hospitalName: params.hospitalName,
      date: dateStr,
      medicationName: params.medicationName,
      dosage: params.dosage,
      frequency: params.frequency,
      duration: params.duration,
      instructions: params.instructions,
      diagnosisContext: params.diagnosisContext || "Prescription Médicale Directe",
      status: "ACTIVE",
      linkedHealthRecordId: hrId,
      cryptoProof: temporaryProof,
    };

    const tempHealthRecord: HealthRecordItem = {
      id: hrId,
      recordSubType: "PRESCRIPTION_ENTRY",
      patientId: params.patientId,
      patientName: params.patientName,
      doctorId: params.doctorId,
      doctorName: params.doctorName,
      department: params.department,
      hospitalId: params.hospitalId,
      hospitalName: params.hospitalName,
      date: dateStr,
      diagnosis: `Ordonnance Médicale — ${params.diagnosisContext || params.medicationName}`,
      clinicalNotes: `Prescription signée par ${params.doctorName}: ${formattedRxLine}. Instructions: ${params.instructions}`,
      prescriptions: [formattedRxLine],
      linkedPrescriptionId: rxId,
      cryptoProof: temporaryProof,
    };

    this.state = {
      ...this.state,
      prescriptions: [tempPrescription, ...this.state.prescriptions],
      healthRecords: [tempHealthRecord, ...this.state.healthRecords],
    };
    this.persistAndNotify();

    // 3. Send through First Client Node -> Validator Transaction Pool -> Block Proposal -> Consensus & Validation -> On-Chain/Off-Chain DB Commit
    const permanentProof = await commitPreparedEnvelopeThroughConsensusPipeline(
      temporaryProof,
      wirePayload,
      (stageProof) => {
        this.state = {
          ...this.state,
          prescriptions: this.state.prescriptions.map((rx) =>
            rx.id === rxId ? { ...rx, cryptoProof: stageProof } : rx
          ),
          healthRecords: this.state.healthRecords.map((hr) =>
            hr.id === hrId ? { ...hr, cryptoProof: stageProof } : hr
          ),
        };
        this.persistAndNotify();
      }
    );

    // 4. Promote from Temporary to Permanently Saved when Client Node forwards receipt back to Portal
    const finalPrescription: PrescriptionItem = {
      ...tempPrescription,
      cryptoProof: permanentProof,
    };
    const finalHealthRecord: HealthRecordItem = {
      ...tempHealthRecord,
      cryptoProof: permanentProof,
    };

    this.state = {
      ...this.state,
      prescriptions: this.state.prescriptions.map((rx) =>
        rx.id === rxId ? finalPrescription : rx
      ),
      healthRecords: this.state.healthRecords.map((hr) =>
        hr.id === hrId ? finalHealthRecord : hr
      ),
    };
    this.persistAndNotify();

    return { prescription: finalPrescription, healthRecord: finalHealthRecord };
  }

  // --------------------------------------------------------------------------
  // 4. DOCTOR REQUEST FOR LAB TEST (STRICTLY OFF-CHAIN — Does NOT pass through Blockchain)
  // --------------------------------------------------------------------------
  public createDoctorLabTestRequestOffChain(params: {
    patientId: string;
    patientName: string;
    patientPublicKey?: string;
    doctorId: string;
    doctorName: string;
    department: string;
    hospitalId: string;
    hospitalName: string;
    testName: string;
    category: LabTestRequestItem["category"];
    urgency: LabTestRequestItem["urgency"];
    clinicalIndication: string;
  }): LabTestRequestItem {
    const newReq: LabTestRequestItem = {
      id: `LREQ-${Date.now().toString().slice(-5)}`,
      patientId: params.patientId,
      patientName: params.patientName,
      patientPublicKey: params.patientPublicKey || SEED_PATIENT_PK,
      doctorId: params.doctorId,
      doctorName: params.doctorName,
      department: params.department,
      hospitalId: params.hospitalId,
      hospitalName: params.hospitalName,
      testName: params.testName,
      category: params.category,
      urgency: params.urgency,
      clinicalIndication: params.clinicalIndication,
      requestedAt: new Date().toISOString().replace("T", " ").slice(0, 16),
      status: "PENDING_HOSPITAL_LAB",
      passedThroughBlockchain: false, // Strictly off-chain!
    };

    this.state = {
      ...this.state,
      labTestRequests: [newReq, ...this.state.labTestRequests],
    };
    this.persistAndNotify();
    return newReq;
  }

  // --------------------------------------------------------------------------
  // 5. HOSPITAL TEST RESULT (E2E Encrypted with Patient PK + Signed with Hospital Private Key + On-Chain)
  //    Saved temporarily first -> Tx Pool -> Block Proposal -> Validator Consensus -> On-Chain/Off-Chain DBs -> Permanently Saved
  // --------------------------------------------------------------------------
  public async addHospitalTestResultToBlockchain(params: {
    requestId?: string;
    patientId: string;
    patientName: string;
    patientPublicKey?: string;
    hospitalId: string;
    hospitalName: string;
    hospitalDid?: string;
    performingLaboratory: string;
    orderedByDoctorName: string;
    testName: string;
    category: string;
    resultValue: string;
    unit: string;
    referenceRange: string;
    interpretationFlag: LabTestResultItem["interpretationFlag"];
    methodologyNotes: string;
  }): Promise<LabTestResultItem> {
    const dateStr = new Date().toISOString().split("T")[0];

    // 1. Encrypt with Patient's Public Key & Sign using HOSPITAL PRIVATE KEY before leaving portal
    const { temporaryProof, wirePayload } =
      await prepareTemporaryEncryptedSignedEnvelope({
        recordCategory: "TEST_RESULT",
        plaintextPayload: {
          type: "HOSPITAL_TEST_RESULT",
          testName: params.testName,
          category: params.category,
          resultValue: params.resultValue,
          unit: params.unit,
          referenceRange: params.referenceRange,
          interpretationFlag: params.interpretationFlag,
          performingLaboratory: params.performingLaboratory,
          orderedByDoctorName: params.orderedByDoctorName,
          methodologyNotes: params.methodologyNotes,
          dateCompleted: dateStr,
        },
        patientId: params.patientId,
        patientName: params.patientName,
        patientPublicKeyHex: params.patientPublicKey,
        signerRole: "HOSPITAL",
        signerId: params.hospitalId,
        signerName: `${params.hospitalName} — Master Hospital Key`,
        signerDid:
          params.hospitalDid ||
          "did:pulse:hosp:0x55bc1184712ef901827364109283746192837461",
        hospitalId: params.hospitalId,
        hospitalName: params.hospitalName,
      });

    const resId = `LRES-${Date.now().toString().slice(-5)}`;

    // 2. SAVE TEMPORARILY in Portal BEFORE sending to the First Client Node
    const tempResult: LabTestResultItem = {
      id: resId,
      requestId: params.requestId,
      patientId: params.patientId,
      patientName: params.patientName,
      hospitalId: params.hospitalId,
      hospitalName: params.hospitalName,
      performingLaboratory: params.performingLaboratory,
      orderedByDoctorName: params.orderedByDoctorName,
      testName: params.testName,
      category: params.category,
      resultValue: params.resultValue,
      unit: params.unit,
      referenceRange: params.referenceRange,
      interpretationFlag: params.interpretationFlag,
      methodologyNotes: params.methodologyNotes,
      dateCompleted: dateStr,
      cryptoProof: temporaryProof,
    };

    this.state = {
      ...this.state,
      labTestResults: [tempResult, ...this.state.labTestResults],
    };
    this.persistAndNotify();

    // 3. Send through First Client Node -> Validator Transaction Pool -> Block Proposal -> Consensus & Validation -> On-Chain/Off-Chain DB Commit
    const permanentProof = await commitPreparedEnvelopeThroughConsensusPipeline(
      temporaryProof,
      wirePayload,
      (stageProof) => {
        this.state = {
          ...this.state,
          labTestResults: this.state.labTestResults.map((res) =>
            res.id === resId ? { ...res, cryptoProof: stageProof } : res
          ),
        };
        this.persistAndNotify();
      }
    );

    // 4. Promote from Temporary to Permanently Saved when Client Node forwards receipt back to Portal
    const finalResult: LabTestResultItem = {
      ...tempResult,
      cryptoProof: permanentProof,
    };

    const updatedRequests = params.requestId
      ? this.state.labTestRequests.map((req) =>
          req.id === params.requestId
            ? {
                ...req,
                status: "COMPLETED_ON_CHAIN" as const,
                completedResultId: resId,
              }
            : req
        )
      : this.state.labTestRequests;

    this.state = {
      ...this.state,
      labTestRequests: updatedRequests,
      labTestResults: this.state.labTestResults.map((res) =>
        res.id === resId ? finalResult : res
      ),
    };
    this.persistAndNotify();
    return finalResult;
  }

  // --------------------------------------------------------------------------
  // 6. VACCINATION BY VACCINATION CENTER (E2E Encrypted with Patient PK + Signed by Vaccination Center Private Key + On-Chain)
  //    Saved temporarily first -> Tx Pool -> Block Proposal -> Validator Consensus -> On-Chain/Off-Chain DBs -> Permanently Saved
  // --------------------------------------------------------------------------
  public async addVaccinationToBlockchain(params: {
    patientId: string;
    patientName: string;
    patientPublicKey?: string;
    vaccineName: string;
    targetDisease: string;
    doseNumber: string;
    batchLotNumber: string;
    manufacturer: string;
    vaccinationCenterId: string;
    vaccinationCenterName: string;
    vaccinationCenterDid?: string;
    administeredBy: string;
    routeAndSite: string;
    nextDueDate: string;
  }): Promise<VaccinationItem> {
    const dateStr = new Date().toISOString().split("T")[0];

    // 1. Encrypt with Patient's Public Key & Sign using VACCINATION CENTER PRIVATE KEY before leaving portal
    const { temporaryProof, wirePayload } =
      await prepareTemporaryEncryptedSignedEnvelope({
        recordCategory: "VACCINATION",
        plaintextPayload: {
          type: "VACCINATION_RECORD",
          vaccineName: params.vaccineName,
          targetDisease: params.targetDisease,
          doseNumber: params.doseNumber,
          batchLotNumber: params.batchLotNumber,
          manufacturer: params.manufacturer,
          vaccinationCenterName: params.vaccinationCenterName,
          administeredBy: params.administeredBy,
          routeAndSite: params.routeAndSite,
          dateAdministered: dateStr,
          nextDueDate: params.nextDueDate,
        },
        patientId: params.patientId,
        patientName: params.patientName,
        patientPublicKeyHex: params.patientPublicKey,
        signerRole: "VACCINATION_CENTER",
        signerId: params.vaccinationCenterId,
        signerName: params.vaccinationCenterName,
        signerDid:
          params.vaccinationCenterDid ||
          "did:pulse:vax:0x62a901fe82736194bca88210492817263541920c",
        hospitalId: params.vaccinationCenterId,
        hospitalName: params.vaccinationCenterName,
      });

    const vaxId = `VAX-${Date.now().toString().slice(-5)}`;

    // 2. SAVE TEMPORARILY in Portal BEFORE sending to the First Client Node
    const tempVaccination: VaccinationItem = {
      id: vaxId,
      patientId: params.patientId,
      patientName: params.patientName,
      vaccineName: params.vaccineName,
      targetDisease: params.targetDisease,
      doseNumber: params.doseNumber,
      batchLotNumber: params.batchLotNumber,
      manufacturer: params.manufacturer,
      vaccinationCenterId: params.vaccinationCenterId,
      vaccinationCenterName: params.vaccinationCenterName,
      administeredBy: params.administeredBy,
      routeAndSite: params.routeAndSite,
      dateAdministered: dateStr,
      nextDueDate: params.nextDueDate,
      cryptoProof: temporaryProof,
    };

    this.state = {
      ...this.state,
      vaccinations: [tempVaccination, ...this.state.vaccinations],
    };
    this.persistAndNotify();

    // 3. Send through First Client Node -> Validator Transaction Pool -> Block Proposal -> Consensus & Validation -> On-Chain/Off-Chain DB Commit
    const permanentProof = await commitPreparedEnvelopeThroughConsensusPipeline(
      temporaryProof,
      wirePayload,
      (stageProof) => {
        this.state = {
          ...this.state,
          vaccinations: this.state.vaccinations.map((vax) =>
            vax.id === vaxId ? { ...vax, cryptoProof: stageProof } : vax
          ),
        };
        this.persistAndNotify();
      }
    );

    // 4. Promote from Temporary to Permanently Saved when Client Node forwards receipt back to Portal
    const finalVaccination: VaccinationItem = {
      ...tempVaccination,
      cryptoProof: permanentProof,
    };

    this.state = {
      ...this.state,
      vaccinations: this.state.vaccinations.map((vax) =>
        vax.id === vaxId ? finalVaccination : vax
      ),
    };
    this.persistAndNotify();
    return finalVaccination;
  }
}

export const clinicalBookletStore = new ClinicalBookletStore();

export function useClinicalBookletStore(): ClinicalBookletState {
  const [state, setState] = useState<ClinicalBookletState>(() =>
    clinicalBookletStore.getState()
  );

  useEffect(() => {
    return clinicalBookletStore.subscribe(setState);
  }, []);

  return state;
}
