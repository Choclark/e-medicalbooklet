"use client";

import React, { useState } from "react";
import {
  Stethoscope,
  Search,
  Clock,
  ShieldCheck,
  FileText,
  Plus,
  Send,
  AlertCircle,
  CheckCircle2,
  Lock,
  User,
  Activity,
  Pill,
  ExternalLink,
  ClipboardList,
  Sparkles,
  ChevronRight,
  Shield,
  Key,
  Building2,
  Check,
  X,
  AlertTriangle,
  RefreshCw,
  BadgeCheck,
  FileWarning,
  Calendar,
  FlaskConical,
  Cpu,
  Radio,
} from "lucide-react";
import {
  PortalType,
  AccessRequestItem,
  DoctorHospitalAffiliation,
  CAMEROON_HOSPITALS,
  INITIAL_AFFILIATIONS,
  INITIAL_ACCESS_REQUESTS,
  verifyDoctorHospitalAffiliation,
} from "@/lib/multiPortalStore";
import {
  clinicalBookletStore,
  useClinicalBookletStore,
  LabTestRequestItem,
  CryptographicBookletProof,
  requestRecordViaKmsProxyReEncryption,
  isDoctorConsentActiveOnChain,
} from "@/lib/clinicalBookletStore";
import { StoredCredential } from "@/lib/webauthn";
import { deviceBroadcastService } from "@/lib/deviceToken";

interface DoctorPortalProps {
  credential: StoredCredential;
  onSwitchPortal: (portal: PortalType) => void;
  availableRoles: string[];
}

export default function DoctorPortal({
  credential,
  onSwitchPortal,
  availableRoles,
}: DoctorPortalProps) {
  // Access Requests & Clinical Booklet E2E Store
  const [accessRequests, setAccessRequests] = useState<AccessRequestItem[]>(INITIAL_ACCESS_REQUESTS);
  const bookletState = useClinicalBookletStore();

  // Cameroon Multi-Hospital Practice State
  const [affiliations, setAffiliations] = useState<DoctorHospitalAffiliation[]>(INITIAL_AFFILIATIONS);
  const [activeHospitalId, setActiveHospitalId] = useState<string>("hosp-yaounde-central");
  const [isAffiliationModalOpen, setIsAffiliationModalOpen] = useState(false);
  const [affiliationNotice, setAffiliationNotice] = useState<string | null>(null);

  // New Request Form (Inverted Hybrid Model)
  const [searchPatient, setSearchPatient] = useState("Alex Mensah");
  const [purpose, setPurpose] = useState("Consultation d'urgence cardiologique & Révision du carnet");
  const [duration, setDuration] = useState(4);
  const [accessScope, setAccessScope] = useState<"Lecture/Écriture" | "Lecture Seule">("Lecture/Écriture");
  const [isSubmittingReq, setIsSubmittingReq] = useState(false);
  const [requestSuccess, setRequestSuccess] = useState<string | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);

  // Clinical Action Tabs: Diagnosis (On-Chain), Prescription (On-Chain + Health Record), Lab Request (Off-Chain)
  const [activeClinicalTab, setActiveClinicalTab] = useState<
    "diagnosis" | "prescription" | "lab_request"
  >("diagnosis");

  // Active Patient & Proof Modal
  const [activePatient, setActivePatient] = useState<AccessRequestItem | null>(accessRequests[0]);
  const [inspectedProof, setInspectedProof] = useState<CryptographicBookletProof | null>(null);

  // 1. Diagnosis Form (On-Chain -> Encrypted with Patient PK + Signed by Doctor Private Key)
  const [newDiagnosis, setNewDiagnosis] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [vitalBp, setVitalBp] = useState("126/82 mmHg");
  const [vitalHr, setVitalHr] = useState("72 bpm");
  const [vitalTemp, setVitalTemp] = useState("36.8 °C");
  const [includeRxInDiagnosis, setIncludeRxInDiagnosis] = useState(true);
  const [diagMedName, setDiagMedName] = useState("");
  const [diagMedDosage, setDiagMedDosage] = useState("5 mg");
  const [diagMedFreq, setDiagMedFreq] = useState("1 comprimé / jour (Matin)");
  const [diagMedDur, setDiagMedDur] = useState("30 jours");
  const [diagMedInstr, setDiagMedInstr] = useState("Prendre avec un grand verre d'eau");

  // 2. Standalone Prescription Form (On-Chain -> Entered in BOTH Medication & Health Record)
  const [rxMedName, setRxMedName] = useState("");
  const [rxDosage, setRxDosage] = useState("500 mg");
  const [rxFrequency, setRxFrequency] = useState("1 comprimé matin et soir");
  const [rxDuration, setRxDuration] = useState("14 jours");
  const [rxInstructions, setRxInstructions] = useState("Prendre pendant les repas");
  const [rxDiagnosisContext, setRxDiagnosisContext] = useState("Suivi thérapeutique & renouvellement");

  // 3. Doctor Lab Test Request Form (STRICTLY OFF-CHAIN — Does NOT pass through Blockchain)
  const [labTestName, setLabTestName] = useState("Bilan Lipidique Complet + Troponine I");
  const [labCategory, setLabCategory] = useState<LabTestRequestItem["category"]>("Biochimie");
  const [labUrgency, setLabUrgency] = useState<LabTestRequestItem["urgency"]>("Urgent");
  const [labIndication, setLabIndication] = useState(
    "Évaluation risque cardiovasculaire et contrôle sous traitement antihypertenseur"
  );

  const [isSavingNote, setIsSavingNote] = useState(false);
  const [clinicalActionBanner, setClinicalActionBanner] = useState<{
    type: "onchain" | "offchain";
    message: string;
    txHash?: string;
    gateway?: string;
  } | null>(null);

  // KMS 3-of-4 Proxy Re-Encryption & C++ AccessManager On-Chain Consent State
  const [isRequestingPre, setIsRequestingPre] = useState(false);
  const [kmsPreResult, setKmsPreResult] = useState<{
    recordId: string;
    authorized: boolean;
    decision: "APPROVED" | "DENIED";
    reason: string;
    consentTxId: string;
    auditTxId: string;
    ksmQuorum: string[];
    reencryptedDekHex: string;
    preIvHex: string;
    preTagHex: string;
    merkleVerified: boolean;
    nodeId: string;
  } | null>(null);

  const handleRequestKmsProxyReEncryption = async (recordId: string, dataId: string) => {
    setIsRequestingPre(true);
    const res = await requestRecordViaKmsProxyReEncryption({
      dataId,
      patientId: "usr-alex-mensah-2026",
      doctorId: credential.user.id || "doc-martin",
      doctorPublicKeyHex: credential.publicKeyHex,
      scope: "FullClinicalRecordAccess",
      purpose: purpose || "CLINICAL_TREATMENT_AND_REVISION",
    });
    setKmsPreResult({
      recordId,
      authorized: res.authorized,
      decision: res.decision,
      reason: res.reason,
      consentTxId: res.consent_tx_id,
      auditTxId: res.audit_tx_id,
      ksmQuorum: res.ksm_quorum,
      reencryptedDekHex: res.reencrypted_dek_hex,
      preIvHex: res.pre_iv_hex,
      preTagHex: res.pre_tag_hex,
      merkleVerified: res.merkle_verified,
      nodeId: res.node_id,
    });
    setIsRequestingPre(false);
  };

  // Role checks for portal switching
  const hasHospitalRole =
    availableRoles.includes("HOSPITAL_STAFF") ||
    availableRoles.includes("ADMIN") ||
    availableRoles.includes("HOSPITAL_ADMIN");
  const hasSysAdminRole = availableRoles.includes("SYSTEM_ADMIN");

  // Find active hospital & affiliation
  const currentHospital =
    CAMEROON_HOSPITALS.find((h) => h.id === activeHospitalId) || CAMEROON_HOSPITALS[0];
  const activeAffiliation = affiliations.find((a) => a.hospitalId === activeHospitalId);

  // Doctor Name (e.g. Dr. Martin Kamga)
  const doctorDisplayName = credential.user.name.toLowerCase().includes("martin")
    ? credential.user.name
    : `Dr. Martin (${credential.user.name})`;

  // Handle Accepting a Hospital Invitation on Blockchain
  const handleAcceptAffiliation = (invitationId: string) => {
    setAffiliations((prev) =>
      prev.map((aff) =>
        aff.id === invitationId
          ? {
              ...aff,
              status: "ACCEPTED",
              respondedAt: new Date().toISOString(),
              blockchainTxHash: `0x${Array.from(crypto.getRandomValues(new Uint8Array(20)))
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("")}`,
            }
          : aff
      )
    );

    const accepted = affiliations.find((a) => a.id === invitationId);
    setAffiliationNotice(
      `✅ Affiliation acceptée avec succès pour ${accepted?.hospitalName}! Ancrée sur la blockchain. Vous êtes maintenant habilité à opérer sous cet hôpital.`
    );
    setTimeout(() => setAffiliationNotice(null), 5000);
  };

  // Handle Refusing a Hospital Invitation on Blockchain
  const handleRefuseAffiliation = (invitationId: string) => {
    setAffiliations((prev) =>
      prev.map((aff) =>
        aff.id === invitationId
          ? {
              ...aff,
              status: "REFUSED",
              respondedAt: new Date().toISOString(),
              blockchainTxHash: `0x${Array.from(crypto.getRandomValues(new Uint8Array(20)))
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("")}`,
            }
          : aff
      )
    );

    const refused = affiliations.find((a) => a.id === invitationId);
    setAffiliationNotice(`❌ Invitation refusée pour ${refused?.hospitalName}. Statut enregistré sur la blockchain.`);
    setTimeout(() => setAffiliationNotice(null), 4000);
  };

  // Handle Creating Request under Inverted Hybrid Model (Software verification)
  const handleCreateRequest = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingReq(true);
    setRequestSuccess(null);
    setVerificationError(null);

    // Step 2 of Inverted Hybrid Model: Software Layer Verification
    // Verify that the doctor has an ACCEPTED affiliation with this active hospital on the blockchain
    const verifyResult = verifyDoctorHospitalAffiliation(
      credential.user.id,
      activeHospitalId,
      affiliations
    );

    if (!verifyResult.authorized) {
      setTimeout(() => {
        setIsSubmittingReq(false);
        setVerificationError(
          `⛔ Blocage Contrat Intelligent : Autorisation refusée pour ${currentHospital.name}. ${verifyResult.reason} Vous devez disposer d'une affiliation ACCEPTÉE et vérifiée sur la blockchain pour opérer sous cet établissement.`
        );
      }, 500);
      return;
    }

    setTimeout(() => {
      const newReq: AccessRequestItem = {
        id: `REQ-${Date.now().toString().slice(-4)}`,
        patientId: "usr-alex-mensah",
        patientName: searchPatient,
        patientDid: "did:pulse:0x71c84f938217e90c6b553912a76f28d8419b33a1",
        doctorId: credential.user.id,
        doctorName: doctorDisplayName,
        doctorDepartment: verifyResult.affiliation?.department || "Médecine Interne & Urgences",
        doctorDid: `did:pulse:doc:${credential.blockchainAddress.slice(-8)}`,
        hospitalId: currentHospital.id,
        hospitalName: currentHospital.name,
        purpose,
        durationHours: duration,
        accessScope,
        status: "PENDING",
        requestedAt: new Date().toISOString(),
        affiliationVerified: true,
      };

      setAccessRequests([newReq, ...accessRequests]);
      setIsSubmittingReq(false);
      setRequestSuccess(
        `Demande d'accès transmise avec succès sous l'affiliation vérifiée de ${currentHospital.name}! La notification a été diffusée au patient.`
      );

      // Broadcast real-time confirmation request to the patient's device token
      // Exact prompt requested: « Dr. Martin (Hôpital Central) demande un accès en Lecture/Écriture pour 4 heures »
      const hospitalShortName = currentHospital.name.includes("Hôpital Central")
        ? "Hôpital Central"
        : currentHospital.name.includes("Hôpital Général")
        ? "Hôpital Général"
        : currentHospital.name.split(" ")[0];

      deviceBroadcastService.broadcastMessage({
        id: `bc-req-${Date.now()}`,
        type: "DOCTOR_ACCESS_REQUEST",
        title: `Demande d'accès au carnet médical`,
        description: `Dr. Martin (${hospitalShortName}) demande un accès en ${accessScope} pour ${duration} heures.`,
        requesterName: doctorDisplayName,
        requesterRole: `Médecin (${verifyResult.affiliation?.role || "Praticien"})`,
        hospitalName: currentHospital.name,
        durationHours: duration,
        payload: {
          requestId: newReq.id,
          patientName: searchPatient,
          accessScope,
          hospitalId: currentHospital.id,
          blockchainVerified: true,
        },
        createdAt: new Date().toISOString(),
        status: "PENDING",
      });
    }, 600);
  };

  // 1. Accept Appointment booked by Patient for a particular day with this Doctor
  const handleAcceptAppointment = (aptId: string, patientName: string) => {
    clinicalBookletStore.updateAppointmentStatus(aptId, "ACCEPTED");
    setAffiliationNotice(
      `✅ Rendez-vous médical accepté pour ${patientName}. Le patient a été notifié dans son espace rendez-vous.`
    );
    setTimeout(() => setAffiliationNotice(null), 4500);
  };

  // 2. Doctor Diagnosis -> Encrypted with Patient's Public Key before leaving portal to First Client Node + Signed with Doctor's Private Key -> Blockchain
  const handleSaveDiagnosisOnChain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDiagnosis || !newNotes) return;

    setIsSavingNote(true);
    setClinicalActionBanner(null);

    try {
      const doctorDid = credential.did || `did:pulse:doc:${credential.blockchainAddress.slice(-8)}`;
      const { healthRecord, prescription } = await clinicalBookletStore.addDoctorDiagnosisToBooklet({
        patientId: activePatient?.patientId || "usr-alex-mensah",
        patientName: activePatient?.patientName || "Alex Mensah",
        doctorId: credential.user.id,
        doctorName: doctorDisplayName,
        doctorDid,
        department: activeAffiliation?.department || "Cardiologie & Médecine Interne",
        hospitalId: currentHospital.id,
        hospitalName: currentHospital.name,
        diagnosis: newDiagnosis,
        clinicalNotes: `[Établissement: ${currentHospital.name}] ${newNotes}`,
        vitals: {
          bloodPressure: vitalBp,
          heartRate: vitalHr,
          temperature: vitalTemp,
        },
        prescriptionMedication:
          includeRxInDiagnosis && diagMedName.trim() ? diagMedName.trim() : undefined,
        prescriptionDosage: diagMedDosage,
        prescriptionFrequency: diagMedFreq,
        prescriptionDuration: diagMedDur,
        prescriptionInstructions: diagMedInstr,
      });

      setIsSavingNote(false);
      setClinicalActionBanner({
        type: "onchain",
        message: prescription
          ? `Diagnostic + Ordonnance (${prescription.medicationName}) chiffrés avec la Clé Publique du Patient, signés avec votre Clé Privée Médecin, transmis au 1er Client Node et ancrés sur la Blockchain (Bloc #${healthRecord.cryptoProof.blockHeight}) ! Enregistrés dans Carnet de Santé ET Médicaments.`
          : `Diagnostic chiffré de bout en bout (Clé Publique Patient), signé avec votre Clé Privée Médecin, transmis au 1er Client Node et ancré sur la Blockchain (Bloc #${healthRecord.cryptoProof.blockHeight}) !`,
        txHash: healthRecord.cryptoProof.blockchainTxHash,
        gateway: healthRecord.cryptoProof.firstClientNodeGateway,
      });

      setNewDiagnosis("");
      setNewNotes("");
      setDiagMedName("");
    } catch (err) {
      setIsSavingNote(false);
      console.error("Failed to save diagnosis on chain:", err);
    }
  };

  // 3. Doctor Prescription -> Encrypted with Patient's Public Key + Signed with Doctor's Private Key -> Blockchain (Entered in BOTH Medication & Health Record)
  const handleSavePrescriptionOnChain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rxMedName.trim() || !rxDosage.trim()) return;

    setIsSavingNote(true);
    setClinicalActionBanner(null);

    try {
      const doctorDid = credential.did || `did:pulse:doc:${credential.blockchainAddress.slice(-8)}`;
      const { prescription } = await clinicalBookletStore.addDoctorPrescriptionToBooklet({
        patientId: activePatient?.patientId || "usr-alex-mensah",
        patientName: activePatient?.patientName || "Alex Mensah",
        doctorId: credential.user.id,
        doctorName: doctorDisplayName,
        doctorDid,
        department: activeAffiliation?.department || "Cardiologie & Médecine Interne",
        hospitalId: currentHospital.id,
        hospitalName: currentHospital.name,
        medicationName: rxMedName.trim(),
        dosage: rxDosage,
        frequency: rxFrequency,
        duration: rxDuration,
        instructions: rxInstructions,
        diagnosisContext: rxDiagnosisContext,
      });

      setIsSavingNote(false);
      setClinicalActionBanner({
        type: "onchain",
        message: `Ordonnance (${prescription.medicationName} ${prescription.dosage}) chiffrée avec la Clé Publique du Patient avant de quitter le portail, signée avec votre Clé Privée Médecin, transmise au 1er Client Node et ancrée sur la Blockchain (Bloc #${prescription.cryptoProof.blockHeight}) ! Ajoutée automatiquement dans « Médicaments » ET « Carnet de Santé ».`,
        txHash: prescription.cryptoProof.blockchainTxHash,
        gateway: prescription.cryptoProof.firstClientNodeGateway,
      });

      setRxMedName("");
    } catch (err) {
      setIsSavingNote(false);
      console.error("Failed to save prescription on chain:", err);
    }
  };

  // 4. Doctor Request for Lab Test -> STRICTLY OFF-CHAIN (Does NOT pass through Blockchain)
  const handleCreateOffChainLabRequest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!labTestName.trim()) return;

    const newReq = clinicalBookletStore.createDoctorLabTestRequestOffChain({
      patientId: activePatient?.patientId || "usr-alex-mensah",
      patientName: activePatient?.patientName || "Alex Mensah",
      doctorId: credential.user.id,
      doctorName: doctorDisplayName,
      department: activeAffiliation?.department || "Cardiologie & Médecine Interne",
      hospitalId: currentHospital.id,
      hospitalName: currentHospital.name,
      testName: labTestName.trim(),
      category: labCategory,
      urgency: labUrgency,
      clinicalIndication: labIndication,
    });

    setClinicalActionBanner({
      type: "offchain",
      message: `Demande d'examen labo (${newReq.id} : ${newReq.testName}) transmise HORS-CHAÎNE (Off-Chain) directement au laboratoire de ${currentHospital.name}. Conformément au protocole architectural, la demande du médecin ne passe PAS par la blockchain ; seul le résultat final signé par la clé privée de l'hôpital sera ancré sur la blockchain.`,
    });
  };

  return (
    <div className="flex h-screen bg-[#F4F5F7] font-sans antialiased text-zinc-900 overflow-hidden">
      {/* LEFT SIDEBAR - DOCTOR CLINICAL WORKSPACE */}
      <aside className="w-64 bg-transparent flex flex-col shrink-0 p-4 select-none">
        {/* Brand */}
        <div className="flex items-center gap-3 px-3 py-3 mb-6">
          <div className="w-9 h-9 rounded-2xl bg-zinc-900 text-white flex items-center justify-center shadow-xs">
            <Stethoscope className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <span className="font-bold text-[17px] tracking-tight text-zinc-900 block leading-tight">
              Pulse Clinic
            </span>
            <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
              Espace Médecin
            </span>
          </div>
        </div>

        {/* Portal Switcher */}
        <div className="mb-4 px-2">
          <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">
            Changer d'Espace
          </label>
          <div className="flex flex-col gap-1 bg-white p-1.5 rounded-2xl border border-zinc-200/90 shadow-2xs">
            <button
              onClick={() => onSwitchPortal("patient")}
              className="text-left px-3 py-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 rounded-xl transition-all"
            >
              ← Espace Patient
            </button>
            <button
              disabled
              className="text-left px-3 py-1.5 text-xs font-bold text-zinc-900 bg-zinc-100 rounded-xl flex items-center justify-between"
            >
              <span>Espace Médecin</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            </button>
            {hasHospitalRole && (
              <button
                onClick={() => onSwitchPortal("hospital")}
                className="text-left px-3 py-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 rounded-xl transition-all"
              >
                Hospital Manager (Tenant) →
              </button>
            )}
            {hasSysAdminRole && (
              <button
                onClick={() => onSwitchPortal("sysadmin")}
                className="text-left px-3 py-1.5 text-xs font-medium text-purple-700 hover:text-purple-900 hover:bg-purple-50 rounded-xl transition-all"
              >
                System Admin (Platform) →
              </button>
            )}
          </div>
        </div>

        {/* Cameroon Multi-Hospital Practice Quick Status */}
        <div className="mb-4 px-2">
          <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">
            Pratique Multi-Hôpitaux (Cameroun)
          </label>
          <div className="bg-white p-3 rounded-2xl border border-zinc-200 shadow-2xs space-y-2">
            <div className="flex items-center gap-2 text-zinc-800 font-bold text-xs">
              <Building2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="truncate">{currentHospital.name}</span>
            </div>

            {activeAffiliation?.status === "ACCEPTED" ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <BadgeCheck className="w-3 h-3 text-emerald-600" />
                Affiliation Validée On-Chain
              </span>
            ) : activeAffiliation?.status === "PENDING" ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                <Clock className="w-3 h-3 text-amber-600" />
                Invitation en Attente
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-red-50 text-red-700 border border-red-200">
                <FileWarning className="w-3 h-3 text-red-600" />
                Non Autorisé
              </span>
            )}

            <button
              onClick={() => setIsAffiliationModalOpen(true)}
              className="w-full mt-1 py-1.5 px-2 bg-zinc-50 hover:bg-zinc-100 text-zinc-700 rounded-lg text-[11px] font-semibold border border-zinc-200 flex items-center justify-center gap-1.5 transition-colors"
            >
              <span>Gérer les Hôpitaux ({affiliations.length})</span>
              <ChevronRight className="w-3 h-3 text-zinc-400" />
            </button>
          </div>
        </div>

        {/* Doctor Key & Identity */}
        <div className="mt-auto pt-3 border-t border-zinc-200/70">
          <div className="p-3 rounded-2xl bg-white border border-zinc-200 shadow-2xs space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-zinc-900 truncate">{doctorDisplayName}</span>
              <span className="text-[10px] bg-emerald-100 text-emerald-800 font-semibold px-1.5 py-0.2 rounded">
                Agréé
              </span>
            </div>
            <p className="text-[10px] text-zinc-500">Praticien Multi-Établissements (Cameroun)</p>
            <p className="text-[10px] font-mono text-zinc-400 truncate">
              {credential.did || `did:pulse:doc:${credential.blockchainAddress.slice(-8)}`}
            </p>
          </div>
        </div>
      </aside>

      {/* MAIN CLINICAL CONTENT */}
      <main className="flex-1 flex flex-col min-w-0 h-screen p-4 pl-0">
        <div className="flex-1 bg-white rounded-3xl border border-zinc-200 shadow-sm flex flex-col overflow-hidden">
          {/* Top Bar with Dynamic Hospital Switcher */}
          <header className="px-8 py-3.5 border-b border-zinc-100 flex flex-wrap items-center justify-between gap-4 shrink-0 bg-white">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Espace Praticien
              </span>
              <span className="text-zinc-300">›</span>
              <span className="text-zinc-900 font-bold text-sm">
                Rendez-Vous, Diagnostic E2E, Ordonnances & Demandes Labo
              </span>
            </div>

            {/* DYNAMIC HOSPITAL PRACTICE SWITCHER (Cameroun) */}
            <div className="flex items-center gap-3 bg-zinc-50 p-1.5 px-3 rounded-2xl border border-zinc-200">
              <div className="flex items-center gap-1.5 text-xs text-zinc-600">
                <Building2 className="w-4 h-4 text-emerald-600" />
                <span className="font-semibold text-zinc-500 text-[11px]">Exercice Actif :</span>
              </div>

              <select
                value={activeHospitalId}
                onChange={(e) => {
                  setActiveHospitalId(e.target.value);
                  setVerificationError(null);
                  setRequestSuccess(null);
                }}
                className="bg-white border border-zinc-200 text-xs font-bold text-zinc-900 rounded-xl px-2.5 py-1 focus:outline-none focus:ring-1 focus:ring-zinc-900"
              >
                {CAMEROON_HOSPITALS.map((h) => {
                  const aff = affiliations.find((a) => a.hospitalId === h.id);
                  const statusLabel =
                    aff?.status === "ACCEPTED"
                      ? "✅ Agréé"
                      : aff?.status === "PENDING"
                      ? "⏳ En attente"
                      : "❌ Non affilié";
                  return (
                    <option key={h.id} value={h.id}>
                      {h.name} ({statusLabel})
                    </option>
                  );
                })}
              </select>

              {activeAffiliation?.status === "ACCEPTED" ? (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                  Habilité
                </span>
              ) : (
                <button
                  onClick={() => setIsAffiliationModalOpen(true)}
                  className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-200 transition-colors"
                >
                  Activer
                </button>
              )}
            </div>
          </header>

          {/* Banner notification */}
          {affiliationNotice && (
            <div className="mx-8 mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-900 flex items-center justify-between animate-in fade-in">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{affiliationNotice}</span>
              </div>
              <button onClick={() => setAffiliationNotice(null)} className="text-zinc-400 hover:text-zinc-700">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Grid Layout: Left Column = Appointments, Access Request & Patients; Right Column = Dossier, E2E Diagnosis, Prescription & Lab Request */}
          <div className="flex-1 overflow-y-auto p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 custom-scrollbar">
            {/* COLUMN 1: APPOINTMENTS FOR SPECIFIC DAY + ACCESS REQUEST (5 cols) */}
            <div className="lg:col-span-5 space-y-6">
              {/* 1. RENDEZ-VOUS PATIENTS (APPOINTMENTS FOR A PARTICULAR DAY & SPECIFIC DOCTOR) */}
              <div className="bg-white rounded-2xl border border-zinc-200 p-5 space-y-3.5 shadow-2xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-emerald-600" />
                    <h3 className="text-xs font-bold text-zinc-900">
                      Rendez-vous Patients (Par Jour & Médecin)
                    </h3>
                  </div>
                  <span className="text-[10px] font-bold bg-emerald-50 text-emerald-800 px-2 py-0.5 rounded-full border border-emerald-200">
                    {bookletState.appointments.filter((a) => a.status === "PENDING").length} en attente
                  </span>
                </div>

                <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                  {bookletState.appointments.map((apt) => (
                    <div
                      key={apt.id}
                      className={`p-3.5 rounded-xl border text-xs transition-all ${
                        apt.status === "PENDING"
                          ? "border-amber-200 bg-amber-50/40"
                          : "border-emerald-200 bg-emerald-50/30"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div>
                          <span className="font-bold text-zinc-900 block">{apt.patientName}</span>
                          <span className="text-[10px] text-zinc-500">
                            Médecin demandé : <strong className="text-zinc-700">{apt.doctorName}</strong>
                          </span>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                            apt.status === "ACCEPTED"
                              ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                              : apt.status === "PENDING"
                              ? "bg-amber-100 text-amber-800 border border-amber-300"
                              : "bg-zinc-100 text-zinc-600"
                          }`}
                        >
                          {apt.status === "ACCEPTED"
                            ? "✓ Accepté par Médecin"
                            : apt.status === "PENDING"
                            ? "⏳ À Confirmer"
                            : apt.status}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 text-[11px] font-semibold text-zinc-700 bg-white/90 px-2.5 py-1.5 rounded-lg border border-zinc-200/70 mb-2">
                        <span className="flex items-center gap-1 text-emerald-700">
                          <Calendar className="w-3.5 h-3.5" />
                          Jour : {apt.date}
                        </span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-zinc-400" />
                          {apt.time}
                        </span>
                      </div>

                      <p className="text-[11px] text-zinc-600 mb-2">
                        <span className="font-semibold text-zinc-700">Motif :</span> {apt.reason}
                      </p>

                      <div className="flex items-center justify-between pt-2 border-t border-zinc-200/60">
                        <span className="text-[10px] text-zinc-400 truncate max-w-[170px]">
                          {apt.hospitalName}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {apt.status === "PENDING" && (
                            <button
                              type="button"
                              onClick={() => handleAcceptAppointment(apt.id, apt.patientName)}
                              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold flex items-center gap-1 shadow-2xs cursor-pointer"
                            >
                              <Check className="w-3 h-3" />
                              Accepter le RDV
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setActivePatient({
                                id: apt.id,
                                patientId: apt.patientId,
                                patientName: apt.patientName,
                                patientDid: apt.patientDid,
                                doctorId: apt.doctorId,
                                doctorName: apt.doctorName,
                                doctorDepartment: apt.doctorSpecialty,
                                doctorDid: `did:pulse:doc:${credential.blockchainAddress.slice(-8)}`,
                                hospitalId: apt.hospitalId,
                                hospitalName: apt.hospitalName,
                                purpose: apt.reason,
                                durationHours: 4,
                                accessScope: "Lecture/Écriture",
                                status: "APPROVED",
                                requestedAt: apt.createdAt,
                                affiliationVerified: true,
                              })
                            }
                            className="px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 text-white rounded-lg text-[10px] font-semibold cursor-pointer"
                          >
                            Ouvrir Dossier →
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Request New Access Card (Modèle Hybride Inversé) */}
              <div className="bg-zinc-50/70 rounded-2xl border border-zinc-200 p-5 space-y-4 shadow-2xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-zinc-900 font-bold text-sm">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <h3>Demande d'Accès au Carnet Médical</h3>
                  </div>
                  <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100/80 px-2 py-0.5 rounded-full border border-emerald-300">
                    Modèle Inversé
                  </span>
                </div>

                <div className="bg-white p-3 rounded-xl border border-zinc-200 text-xs space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-zinc-500">
                    <span>Hôpital Déclarant :</span>
                    <span className="font-bold text-zinc-900">{currentHospital.name}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-zinc-500">
                    <span>Vérification d'Affiliation :</span>
                    {activeAffiliation?.status === "ACCEPTED" ? (
                      <span className="font-bold text-emerald-700 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        Validée sur Contrat Intelligent
                      </span>
                    ) : (
                      <span className="font-bold text-amber-700 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3 text-amber-600" />
                        Non autorisée ({activeAffiliation?.status || "Absente"})
                      </span>
                    )}
                  </div>
                </div>

                {/* Error Banner if verification layer blocks request */}
                {verificationError && (
                  <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-900 text-xs flex items-start gap-2.5 animate-in fade-in">
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <span className="font-bold block">Contrôle d'Affiliation Échoué</span>
                      <p className="text-[11px] leading-relaxed text-red-800">{verificationError}</p>
                      <button
                        type="button"
                        onClick={() => setIsAffiliationModalOpen(true)}
                        className="mt-1 text-[11px] font-bold text-red-900 underline hover:no-underline"
                      >
                        Accepter l'affiliation sur la blockchain →
                      </button>
                    </div>
                  </div>
                )}

                {/* Success Banner */}
                {requestSuccess && (
                  <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center gap-2 animate-in fade-in">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{requestSuccess}</span>
                  </div>
                )}

                <form onSubmit={handleCreateRequest} className="space-y-3.5 text-xs">
                  <div>
                    <label className="font-semibold text-zinc-700 block mb-1">Nom du Patient ou DID</label>
                    <input
                      type="text"
                      value={searchPatient}
                      onChange={(e) => setSearchPatient(e.target.value)}
                      placeholder="Ex: Alex Mensah ou did:pulse:0x..."
                      className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white focus:outline-none focus:border-zinc-900 text-xs"
                      required
                    />
                  </div>

                  <div>
                    <label className="font-semibold text-zinc-700 block mb-1">Motif de la Consultation</label>
                    <input
                      type="text"
                      value={purpose}
                      onChange={(e) => setPurpose(e.target.value)}
                      placeholder="Ex: Consultation d'urgence cardiologique"
                      className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white focus:outline-none focus:border-zinc-900 text-xs"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-semibold text-zinc-700 block mb-1">Niveau d'Accès</label>
                      <select
                        value={accessScope}
                        onChange={(e) => setAccessScope(e.target.value as any)}
                        className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white focus:outline-none focus:border-zinc-900 text-xs font-semibold"
                      >
                        <option value="Lecture/Écriture">Lecture / Écriture (Dossier & Rx)</option>
                        <option value="Lecture Seule">Lecture Seule (Consultation)</option>
                      </select>
                    </div>

                    <div>
                      <label className="font-semibold text-zinc-700 block mb-1">Durée Demandée</label>
                      <div className="grid grid-cols-3 gap-1">
                        {[2, 4, 8].map((hrs) => (
                          <button
                            type="button"
                            key={hrs}
                            onClick={() => setDuration(hrs)}
                            className={`py-1.5 rounded-lg border font-medium text-xs transition-colors ${
                              duration === hrs
                                ? "bg-zinc-900 text-white border-zinc-900"
                                : "bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50"
                            }`}
                          >
                            {hrs}h
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmittingReq}
                    className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl font-semibold text-xs transition-colors flex items-center justify-center gap-2 shadow-xs cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Initier la Demande (Vérification Blockchain & Notification)</span>
                  </button>
                </form>
              </div>
            </div>

            {/* COLUMN 2: CLINICAL DOSSIER, E2E DIAGNOSIS, PRESCRIPTIONS & OFF-CHAIN LAB REQUEST (7 cols) */}
            <div className="lg:col-span-7 space-y-6">
              {/* Patient Banner with Public Key Encryption Indicator */}
              <div className="bg-zinc-900 text-white rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4 shadow-xs">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 flex items-center justify-center font-bold text-sm">
                    {activePatient?.patientName.charAt(0) || "A"}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-sm text-white">
                        {activePatient?.patientName || "Alex Mensah"}
                      </h3>
                      <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 px-2 py-0.5 rounded-full font-semibold">
                        Clé Publique Patient Chargée (E2E)
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 font-mono mt-0.5">
                      DID: {activePatient?.patientDid || "did:pulse:0x71c84f938217e90c6b553912a76f28d8419b33a1"}
                    </p>
                  </div>
                </div>

                <div className="text-right text-xs">
                  <span className="text-zinc-400 block text-[10px]">Passerelle Cryptographique</span>
                  <span className="font-bold text-emerald-400 flex items-center gap-1.5 justify-end">
                    <Radio className="w-3.5 h-3.5" />
                    Chiffrement E2E avant 1er Client Node
                  </span>
                </div>
              </div>

              {/* Action Tabs: 1. Diagnosis (On-Chain), 2. Prescription (On-Chain + Health Record), 3. Lab Request (Off-Chain) */}
              <div className="bg-white rounded-2xl border border-zinc-200 p-6 space-y-5 shadow-2xs">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 pb-4">
                  <div className="flex items-center gap-1.5 bg-zinc-100 p-1 rounded-xl">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveClinicalTab("diagnosis");
                        setClinicalActionBanner(null);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                        activeClinicalTab === "diagnosis"
                          ? "bg-zinc-900 text-white shadow-2xs"
                          : "text-zinc-600 hover:text-zinc-900"
                      }`}
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>1. Diagnostic & Carnet (On-Chain)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setActiveClinicalTab("prescription");
                        setClinicalActionBanner(null);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                        activeClinicalTab === "prescription"
                          ? "bg-emerald-700 text-white shadow-2xs"
                          : "text-zinc-600 hover:text-zinc-900"
                      }`}
                    >
                      <Pill className="w-3.5 h-3.5" />
                      <span>2. Ordonnance / Rx (On-Chain)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setActiveClinicalTab("lab_request");
                        setClinicalActionBanner(null);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                        activeClinicalTab === "lab_request"
                          ? "bg-amber-600 text-white shadow-2xs"
                          : "text-zinc-600 hover:text-zinc-900"
                      }`}
                    >
                      <FlaskConical className="w-3.5 h-3.5" />
                      <span>3. Demande Labo (Off-Chain)</span>
                    </button>
                  </div>
                </div>

                {/* Feedback Banner */}
                {clinicalActionBanner && (
                  <div
                    className={`p-4 rounded-2xl border text-xs space-y-1.5 animate-in fade-in ${
                      clinicalActionBanner.type === "onchain"
                        ? "bg-emerald-50 border-emerald-200 text-emerald-950"
                        : "bg-amber-50 border-amber-200 text-amber-950"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <CheckCircle2
                        className={`w-4 h-4 shrink-0 mt-0.5 ${
                          clinicalActionBanner.type === "onchain" ? "text-emerald-600" : "text-amber-600"
                        }`}
                      />
                      <span className="font-semibold leading-relaxed">{clinicalActionBanner.message}</span>
                    </div>
                    {clinicalActionBanner.txHash && (
                      <div className="pl-6 text-[10px] font-mono text-emerald-800 flex flex-wrap items-center gap-3">
                        <span>Tx Blockchain: {clinicalActionBanner.txHash.slice(0, 26)}...</span>
                        <span>•</span>
                        <span>Gateway: {clinicalActionBanner.gateway}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 1: DOCTOR DIAGNOSIS -> E2E ENCRYPTED WITH PATIENT PUBLIC KEY + DOCTOR SIGNATURE -> BLOCKCHAIN */}
                {activeClinicalTab === "diagnosis" && (
                  <form onSubmit={handleSaveDiagnosisOnChain} className="space-y-4 text-xs">
                    <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200/80 text-[11px] text-emerald-900 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Lock className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span>
                          <strong>Pipeline E2E :</strong> Chiffré avec la <strong>Clé Publique du Patient</strong> avant de quitter ce portail vers le <strong>1er Client Node</strong>, et signé avec votre <strong>Clé Privée Médecin</strong>.
                        </span>
                      </div>
                      <span className="px-2 py-0.5 rounded bg-emerald-200/70 text-emerald-900 font-mono font-bold text-[10px] shrink-0">
                        ON-CHAIN
                      </span>
                    </div>

                    <div>
                      <label className="font-semibold text-zinc-700 block mb-1">
                        Diagnostic Clinique (Carnet de Santé)
                      </label>
                      <input
                        type="text"
                        value={newDiagnosis}
                        onChange={(e) => setNewDiagnosis(e.target.value)}
                        placeholder="Ex: Hypertension artérielle de grade 1 & Contrôle bilan lipidique"
                        className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white focus:outline-none focus:border-zinc-900 text-xs"
                        required
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="font-semibold text-zinc-700 block mb-1">Tension Artérielle</label>
                        <input
                          type="text"
                          value={vitalBp}
                          onChange={(e) => setVitalBp(e.target.value)}
                          className="w-full px-3 py-1.5 rounded-xl border border-zinc-200 bg-white text-xs"
                        />
                      </div>
                      <div>
                        <label className="font-semibold text-zinc-700 block mb-1">Fréquence Cardiaque</label>
                        <input
                          type="text"
                          value={vitalHr}
                          onChange={(e) => setVitalHr(e.target.value)}
                          className="w-full px-3 py-1.5 rounded-xl border border-zinc-200 bg-white text-xs"
                        />
                      </div>
                      <div>
                        <label className="font-semibold text-zinc-700 block mb-1">Température</label>
                        <input
                          type="text"
                          value={vitalTemp}
                          onChange={(e) => setVitalTemp(e.target.value)}
                          className="w-full px-3 py-1.5 rounded-xl border border-zinc-200 bg-white text-xs"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="font-semibold text-zinc-700 block mb-1">
                        Observations Médicales & Évolution
                      </label>
                      <textarea
                        rows={3}
                        value={newNotes}
                        onChange={(e) => setNewNotes(e.target.value)}
                        placeholder="Observations cliniques, auscultation, recommandations thérapeutiques..."
                        className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white focus:outline-none focus:border-zinc-900 text-xs leading-relaxed"
                        required
                      ></textarea>
                    </div>

                    {/* Optional embedded prescription that writes to BOTH Health Record and Medication */}
                    <div className="p-3.5 rounded-xl border border-zinc-200 bg-zinc-50/70 space-y-3">
                      <label className="flex items-center gap-2 font-bold text-zinc-800 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={includeRxInDiagnosis}
                          onChange={(e) => setIncludeRxInDiagnosis(e.target.checked)}
                          className="rounded border-zinc-300"
                        />
                        <Pill className="w-3.5 h-3.5 text-emerald-600" />
                        <span>
                          Joindre une Prescription Médicamenteuse (Sera inscrite dans Médicaments ET Carnet de Santé)
                        </span>
                      </label>

                      {includeRxInDiagnosis && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1">
                          <input
                            type="text"
                            value={diagMedName}
                            onChange={(e) => setDiagMedName(e.target.value)}
                            placeholder="Médicament (ex: Amlodipine)"
                            className="px-3 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs"
                          />
                          <input
                            type="text"
                            value={diagMedDosage}
                            onChange={(e) => setDiagMedDosage(e.target.value)}
                            placeholder="Dosage (ex: 5 mg)"
                            className="px-3 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs"
                          />
                          <input
                            type="text"
                            value={diagMedFreq}
                            onChange={(e) => setDiagMedFreq(e.target.value)}
                            placeholder="Fréquence (ex: 1 cp / jour)"
                            className="px-3 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs"
                          />
                          <input
                            type="text"
                            value={diagMedDur}
                            onChange={(e) => setDiagMedDur(e.target.value)}
                            placeholder="Durée (ex: 30 jours)"
                            className="px-3 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs"
                          />
                        </div>
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={isSavingNote}
                      className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl font-semibold text-xs transition-colors flex items-center justify-center gap-2 shadow-xs cursor-pointer"
                    >
                      <Lock className="w-3.5 h-3.5 text-emerald-400" />
                      <span>
                        {isSavingNote
                          ? "Chiffrement Clé Publique Patient & Signature Médecin vers 1er Client Node..."
                          : "Chiffrer (Clé Publique Patient), Signer (Clé Privée Médecin) & Ancrer sur Blockchain"}
                      </span>
                    </button>
                  </form>
                )}

                {/* TAB 2: DOCTOR PRESCRIPTION -> E2E ENCRYPTED + DOCTOR SIGNED -> SAVED IN BOTH MEDICATION & HEALTH RECORD */}
                {activeClinicalTab === "prescription" && (
                  <form onSubmit={handleSavePrescriptionOnChain} className="space-y-4 text-xs">
                    <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200/80 text-[11px] text-emerald-900 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Pill className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span>
                          <strong>Double Inscription On-Chain :</strong> Toute ordonnance signée par le médecin est chiffrée avec la <strong>Clé Publique du Patient</strong>, envoyée au <strong>1er Client Node</strong>, ancrée sur la Blockchain, et enregistrée sous <strong>Médicaments</strong> ET sous <strong>Carnet de Santé</strong>.
                        </span>
                      </div>
                      <span className="px-2 py-0.5 rounded bg-emerald-200/70 text-emerald-900 font-mono font-bold text-[10px] shrink-0">
                        ON-CHAIN
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="font-semibold text-zinc-700 block mb-1">Nom du Médicament</label>
                        <input
                          type="text"
                          value={rxMedName}
                          onChange={(e) => setRxMedName(e.target.value)}
                          placeholder="Ex: Bisoprolol Fumarate / Metformine"
                          className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs"
                          required
                        />
                      </div>
                      <div>
                        <label className="font-semibold text-zinc-700 block mb-1">Dosage</label>
                        <input
                          type="text"
                          value={rxDosage}
                          onChange={(e) => setRxDosage(e.target.value)}
                          placeholder="Ex: 5 mg / 500 mg"
                          className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs"
                          required
                        />
                      </div>
                      <div>
                        <label className="font-semibold text-zinc-700 block mb-1">Posologie / Fréquence</label>
                        <input
                          type="text"
                          value={rxFrequency}
                          onChange={(e) => setRxFrequency(e.target.value)}
                          placeholder="Ex: 1 comprimé matin et soir"
                          className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs"
                          required
                        />
                      </div>
                      <div>
                        <label className="font-semibold text-zinc-700 block mb-1">Durée du Traitement</label>
                        <input
                          type="text"
                          value={rxDuration}
                          onChange={(e) => setRxDuration(e.target.value)}
                          placeholder="Ex: 30 jours"
                          className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs"
                          required
                        />
                      </div>
                    </div>

                    <div>
                      <label className="font-semibold text-zinc-700 block mb-1">
                        Indication Diagnostique (Pour entrée Carnet de Santé)
                      </label>
                      <input
                        type="text"
                        value={rxDiagnosisContext}
                        onChange={(e) => setRxDiagnosisContext(e.target.value)}
                        placeholder="Ex: Stabilisation tensionnelle & prévention cardiovasculaire"
                        className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs"
                        required
                      />
                    </div>

                    <div>
                      <label className="font-semibold text-zinc-700 block mb-1">
                        Instructions au Patient & Pharmacien
                      </label>
                      <input
                        type="text"
                        value={rxInstructions}
                        onChange={(e) => setRxInstructions(e.target.value)}
                        placeholder="Ex: Prendre au cours du repas, surveiller la tension"
                        className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={isSavingNote}
                      className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold text-xs transition-colors flex items-center justify-center gap-2 shadow-xs cursor-pointer"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>
                        {isSavingNote
                          ? "Chiffrement E2E & Signature Ordonnance en cours..."
                          : "Signer l'Ordonnance (Clé Privée Médecin), Chiffrer (Clé Publique Patient) & Ancrer On-Chain"}
                      </span>
                    </button>
                  </form>
                )}

                {/* TAB 3: DOCTOR REQUEST FOR LAB TEST -> STRICTLY OFF-CHAIN */}
                {activeClinicalTab === "lab_request" && (
                  <form onSubmit={handleCreateOffChainLabRequest} className="space-y-4 text-xs">
                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-950 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FlaskConical className="w-4 h-4 text-amber-600 shrink-0" />
                        <span>
                          <strong>Règle Architecturale :</strong> La demande d'analyse du médecin <strong>NE PASSE PAS par la Blockchain</strong> (routage interne hors-chaîne vers le laboratoire de l'hôpital). Seul le <strong>résultat d'examen</strong> final sera chiffré et signé par la <strong>Clé Privée de l'Hôpital</strong> sur la Blockchain.
                        </span>
                      </div>
                      <span className="px-2 py-0.5 rounded bg-amber-200/80 text-amber-950 font-mono font-bold text-[10px] shrink-0">
                        OFF-CHAIN ONLY
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="font-semibold text-zinc-700 block mb-1">Examen Demandé</label>
                        <input
                          type="text"
                          value={labTestName}
                          onChange={(e) => setLabTestName(e.target.value)}
                          placeholder="Ex: Bilan Lipidique Complet / NFS / Troponine"
                          className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs"
                          required
                        />
                      </div>
                      <div>
                        <label className="font-semibold text-zinc-700 block mb-1">Catégorie Laboratoire</label>
                        <select
                          value={labCategory}
                          onChange={(e) => setLabCategory(e.target.value as LabTestRequestItem["category"])}
                          className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs font-semibold"
                        >
                          <option value="Biochimie">Biochimie</option>
                          <option value="Hématologie">Hématologie</option>
                          <option value="Microbiologie / Sérologie">Microbiologie / Sérologie</option>
                          <option value="Cardiologie (ECG/Echo)">Cardiologie (ECG/Echo)</option>
                          <option value="Imagerie / Radiologie">Imagerie / Radiologie</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="font-semibold text-zinc-700 block mb-1">Niveau d'Urgence</label>
                        <select
                          value={labUrgency}
                          onChange={(e) => setLabUrgency(e.target.value as LabTestRequestItem["urgency"])}
                          className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs font-semibold"
                        >
                          <option value="Routine">Routine</option>
                          <option value="Urgent">Urgent</option>
                          <option value="STAT (Immense Urgence)">STAT (Urgence Absolue)</option>
                        </select>
                      </div>
                      <div>
                        <label className="font-semibold text-zinc-700 block mb-1">Indication Clinique</label>
                        <input
                          type="text"
                          value={labIndication}
                          onChange={(e) => setLabIndication(e.target.value)}
                          placeholder="Motif clinique pour le biologiste..."
                          className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs"
                          required
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="w-full py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-semibold text-xs transition-colors flex items-center justify-center gap-2 shadow-xs cursor-pointer"
                    >
                      <FlaskConical className="w-3.5 h-3.5" />
                      <span>Transmettre la Demande d'Examen au Laboratoire (Hors-Chaîne / Sans Blockchain)</span>
                    </button>
                  </form>
                )}
              </div>

              {/* LIVE FEED: ON-CHAIN HEALTH RECORDS & OFF-CHAIN LAB REQUESTS */}
              <div className="bg-white rounded-2xl border border-zinc-200 p-5 space-y-4 shadow-2xs">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-zinc-900">
                    Journal du Carnet Médical (On-Chain) & Demandes Labo (Off-Chain)
                  </h4>
                  <span className="text-[10px] text-zinc-500 font-mono">
                    {bookletState.healthRecords.length} entrées On-Chain • {bookletState.labTestRequests.length} demandes Labo Off-Chain
                  </span>
                </div>

                {/* Off-Chain Lab Test Requests Summary */}
                {bookletState.labTestRequests.length > 0 && (
                  <div className="space-y-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 block">
                      Demandes d'Analyses Labo (Off-Chain — Non passées sur Blockchain)
                    </span>
                    {bookletState.labTestRequests.map((lreq) => (
                      <div
                        key={lreq.id}
                        className="p-3 rounded-xl border border-amber-200 bg-amber-50/40 flex flex-wrap items-center justify-between gap-2 text-xs"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-zinc-900">{lreq.testName}</span>
                            <span className="text-[10px] px-2 py-0.2 rounded bg-amber-100 text-amber-900 font-mono font-semibold">
                              OFF-CHAIN ({lreq.id})
                            </span>
                          </div>
                          <p className="text-[11px] text-zinc-600">
                            Patient: {lreq.patientName} • {lreq.category} ({lreq.urgency})
                          </p>
                        </div>
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            lreq.status === "COMPLETED_ON_CHAIN"
                              ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                              : "bg-amber-100 text-amber-800 border border-amber-300"
                          }`}
                        >
                          {lreq.status === "COMPLETED_ON_CHAIN"
                            ? "✓ Résultat publié On-Chain par Hôpital"
                            : "En attente Résultat Hôpital"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* On-Chain Health Records & Prescriptions */}
                <div className="space-y-3 pt-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 block">
                      Diagnostics & Ordonnances Chiffrés E2E (ECDH P-256 + HKDF + AES-256-GCM • KMS Proxy Re-Encryption)
                    </span>
                    <span
                      className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold border ${
                        isDoctorConsentActiveOnChain("usr-alex-mensah-2026", credential.user.id || "doc-martin")
                          ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                          : "bg-red-50 text-red-800 border-red-200"
                      }`}
                    >
                      {isDoctorConsentActiveOnChain("usr-alex-mensah-2026", credential.user.id || "doc-martin")
                        ? "✓ Consentement Patient On-Chain (C++ AccessManager): ACTIF"
                        : "⛔ Consentement Patient On-Chain (C++ AccessManager): RÉVOQUÉ"}
                    </span>
                  </div>

                  {kmsPreResult && (
                    <div
                      className={`p-3.5 rounded-xl border text-xs font-mono space-y-1 animate-in fade-in ${
                        kmsPreResult.authorized
                          ? "bg-zinc-900 border-emerald-500/40 text-zinc-100"
                          : "bg-red-950 border-red-500 text-red-100"
                      }`}
                    >
                      <div className="flex items-center justify-between font-sans">
                        <strong className={kmsPreResult.authorized ? "text-emerald-400" : "text-red-300"}>
                          {kmsPreResult.authorized
                            ? `✓ KMS 3-of-4 Proxy Re-Encryption Capsule (Dossier ${kmsPreResult.recordId})`
                            : `⛔ Accès Refusé par C++ AccessManager::verifyPatientConsent (${kmsPreResult.recordId})`}
                        </strong>
                        <button
                          type="button"
                          onClick={() => setKmsPreResult(null)}
                          className="text-zinc-400 hover:text-white text-[10px]"
                        >
                          Fermer ✕
                        </button>
                      </div>
                      <div>Décision On-Chain : <strong>{kmsPreResult.decision}</strong> ({kmsPreResult.reason})</div>
                      <div>Consentement Tx : {kmsPreResult.consentTxId} • Audit Tx : {kmsPreResult.auditTxId}</div>
                      {kmsPreResult.authorized ? (
                        <>
                          <div>Quorum KMS (Shamir GF(2^8)) : {kmsPreResult.ksmQuorum.join(", ")}</div>
                          <div className="truncate text-emerald-300">
                            DEK Re-Chiffrée (Clé Publique Médecin) : 0x{kmsPreResult.reencryptedDekHex}
                          </div>
                          <div>
                            PRE IV : 0x{kmsPreResult.preIvHex} • PRE Auth Tag : 0x{kmsPreResult.preTagHex} • Merkle Proof :{" "}
                            {kmsPreResult.merkleVerified ? "VERIFIED" : "PENDING"}
                          </div>
                        </>
                      ) : (
                        <div className="font-sans text-red-200">
                          Les nœuds hospitaliers KMS (HOSPITAL_A..C) ont refusé de combiner les parts Shamir car le patient a révoqué le consentement sur la blockchain.
                        </div>
                      )}
                    </div>
                  )}

                  {bookletState.healthRecords.map((rec) => {
                    const isTemp =
                      rec.cryptoProof.persistenceStatus === "TEMPORARY_PENDING_CONSENSUS";
                    return (
                      <div
                        key={rec.id}
                        className={`p-4 rounded-xl border space-y-2 text-xs transition-all ${
                          isTemp
                            ? "border-amber-300 bg-amber-50/20"
                            : "border-zinc-200 bg-zinc-50/50"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-zinc-900">{rec.diagnosis}</span>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                                rec.recordSubType === "PRESCRIPTION_ENTRY"
                                  ? "bg-purple-100 text-purple-800"
                                  : "bg-emerald-100 text-emerald-800"
                              }`}
                            >
                              {rec.recordSubType === "PRESCRIPTION_ENTRY"
                                ? "Ordonnance (Carnet + Médicaments)"
                                : "Diagnostic Médical"}
                            </span>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                                isTemp
                                  ? "bg-amber-100 text-amber-900 border border-amber-300 animate-pulse"
                                  : "bg-emerald-50 text-emerald-800 border border-emerald-200"
                              }`}
                            >
                              {isTemp
                                ? "⏳ TEMPORAIRE — En cours de Consensus"
                                : "✓ PERMANENT — Validé & Enregistré (On-Chain + Off-Chain DB)"}
                            </span>
                          </div>
                          <span className="text-[10px] text-zinc-400 font-mono">{rec.date}</span>
                        </div>

                        {rec.cryptoProof.pipelineStage && (
                          <div
                            className={`px-3 py-1.5 rounded-lg border text-[10px] font-mono ${
                              isTemp
                                ? "bg-amber-50 border-amber-200 text-amber-900"
                                : "bg-zinc-900 border-zinc-800 text-emerald-400"
                            }`}
                          >
                            {rec.cryptoProof.pipelineStage}
                          </div>
                        )}

                        <p className="text-zinc-600 text-xs leading-relaxed">{rec.clinicalNotes}</p>

                        {rec.prescriptions.length > 0 && (
                          <div className="bg-emerald-50/80 p-2 rounded-lg border border-emerald-100 flex items-center gap-2 text-emerald-800 text-[11px]">
                            <Pill className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span className="font-semibold">{rec.prescriptions.join(", ")}</span>
                          </div>
                        )}

                        <div className="pt-2 border-t border-zinc-200/60 flex flex-wrap items-center justify-between gap-2 text-[10px] text-zinc-500 font-mono">
                          <span>
                            {isTemp
                              ? "En attente de validation bloc..."
                              : `Bloc #${rec.cryptoProof.blockHeight}`}{" "}
                            • Tx: {rec.cryptoProof.blockchainTxHash.slice(0, 16)}...
                          </span>
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              disabled={isRequestingPre}
                              onClick={() =>
                                handleRequestKmsProxyReEncryption(rec.id, rec.cryptoProof.dataId)
                              }
                              className="text-purple-700 hover:text-purple-900 font-sans font-bold underline cursor-pointer"
                            >
                              {isRequestingPre
                                ? "Re-Chiffrement KMS..."
                                : "Re-Chiffrer DEK (KMS Proxy Re-Encryption) →"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setInspectedProof(rec.cryptoProof)}
                              className="text-emerald-700 hover:text-emerald-900 font-sans font-bold underline cursor-pointer"
                            >
                              Vérifier Preuve E2E, Consensus & BD →
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* MODAL: CRYPTOGRAPHIC PROOF INSPECTOR */}
      {inspectedProof && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-zinc-200 overflow-hidden">
            <div className="px-6 py-4 bg-zinc-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-emerald-400" />
                <h3 className="font-bold text-sm">
                  Preuve Cryptographique E2E, Consensus PBFT & BD On-Chain / Off-Chain
                </h3>
              </div>
              <button
                onClick={() => setInspectedProof(null)}
                className="text-zinc-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-3 text-xs font-mono">
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 font-sans">
                <strong>Cycle de Sauvegarde Temporaire → Permanente :</strong> Le dossier est d'abord sauvegardé temporairement dans le Portail et le 1er Client Node, passe par le <strong>Transaction Pool</strong>, la <strong>Proposition de Bloc</strong>, la <strong>Validation par Consensus</strong>, puis l'enregistrement dans les <strong>BD On-Chain et Off-Chain</strong> avant que le Client Node ne renvoie la confirmation au Portail.
              </div>
              <div className="p-3 rounded-xl bg-zinc-900 text-zinc-100 space-y-1 text-[11px]">
                <div>
                  Statut :{" "}
                  <strong className="text-emerald-400">
                    {inspectedProof.persistenceStatus === "TEMPORARY_PENDING_CONSENSUS"
                      ? "TEMPORARY_PENDING_CONSENSUS (Sauvegarde Temporaire)"
                      : "PERMANENTLY_COMMITTED (Sauvegarde Permanente)"}
                  </strong>
                </div>
                <div>1. Transaction Pool (Mempool) : <span className="text-emerald-400">✓ Passé</span></div>
                <div>2. Proposition de Bloc (PBFT Pre-Prepare) : <span className="text-emerald-400">✓ Proposé</span></div>
                <div>3. Validation & Consensus (Nœuds Validateurs) : <span className="text-emerald-400">✓ Validé</span></div>
                <div>4. BD On-Chain (blocks.dat / onchain_committed_ledger) : <span className="text-emerald-400">✓ Enregistré</span></div>
                <div>5. BD Off-Chain (records.db / offchain_clinical_records) : <span className="text-emerald-400">✓ Enregistré</span></div>
              </div>
              <div className="space-y-1.5 bg-zinc-50 p-3.5 rounded-xl border border-zinc-200 text-[11px] break-all">
                <div><span className="text-zinc-400">Signataire :</span> <strong>{inspectedProof.signerName} ({inspectedProof.signerRole})</strong></div>
                <div><span className="text-zinc-400">Signature ECDSA :</span> {inspectedProof.digitalSignature}</div>
                <div><span className="text-zinc-400">Clé Publique Patient (Destinataire) :</span> {inspectedProof.patientPublicKey.slice(0, 48)}...</div>
                <div><span className="text-zinc-400">DEK Enveloppée (Patient PK) :</span> {inspectedProof.encryptedDekForPatient.slice(0, 48)}...</div>
                <div><span className="text-zinc-400">1er Client Node Gateway :</span> {inspectedProof.firstClientNodeGateway}</div>
                <div><span className="text-zinc-400">Transaction Hash :</span> {inspectedProof.blockchainTxHash}</div>
                <div><span className="text-zinc-400">Hauteur de Bloc :</span> #{inspectedProof.blockHeight} ({inspectedProof.validatorNodeId})</div>
                <div><span className="text-zinc-400">Merkle Root :</span> {inspectedProof.merkleRoot}</div>
              </div>
              <div className="flex justify-end pt-2 font-sans">
                <button
                  onClick={() => setInspectedProof(null)}
                  className="px-4 py-2 bg-zinc-900 text-white rounded-xl font-semibold text-xs"
                >
                  Fermer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CAMEROON MULTI-HOSPITAL AFFILIATIONS & INVITATIONS (BLOCKCHAIN) */}
      {isAffiliationModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-zinc-200 overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="px-6 py-4 bg-zinc-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                  <Building2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white">Registre des Affiliations Hospitalières</h3>
                  <p className="text-[10px] text-zinc-400">
                    Pratique Multi-Établissements (Cameroun) & Contrôle Smart Contract
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsAffiliationModalOpen(false)}
                className="text-zinc-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 overflow-y-auto space-y-4 text-xs">
              <div className="bg-blue-50 border border-blue-200 p-3.5 rounded-2xl text-blue-900 text-xs space-y-1">
                <span className="font-bold block">Règle de Fonctionnement en Milieu Hospitalier (Cameroun) :</span>
                <p className="text-[11px] leading-relaxed text-blue-800">
                  Un médecin peut exercer dans plusieurs hôpitaux simultanément. Le contrat intelligent vérifie
                  automatiquement son affiliation avant toute demande de carnet. Lorsqu'un hôpital envoie une
                  invitation, elle est enregistrée sur la blockchain avec son statut : <strong>PENDING</strong> (En attente),{" "}
                  <strong>ACCEPTED</strong> (Agréé) ou <strong>REFUSED</strong> (Refusé).
                </p>
              </div>

              <div className="space-y-3">
                {affiliations.map((aff) => (
                  <div
                    key={aff.id}
                    className={`p-4 rounded-2xl border transition-all ${
                      aff.hospitalId === activeHospitalId
                        ? "border-emerald-500 bg-emerald-50/20 ring-1 ring-emerald-500"
                        : "border-zinc-200 bg-zinc-50/50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-zinc-900 text-sm">{aff.hospitalName}</h4>
                          {aff.hospitalId === activeHospitalId && (
                            <span className="text-[9px] bg-emerald-600 text-white font-bold px-1.5 py-0.2 rounded">
                              Actif
                            </span>
                          )}
                        </div>
                        <p className="text-zinc-600 font-medium text-xs mt-0.5">
                          Rôle : <span className="text-zinc-900 font-semibold">{aff.role}</span> ({aff.department})
                        </p>
                      </div>

                      {/* Status Badge */}
                      <div>
                        {aff.status === "ACCEPTED" ? (
                          <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                            <BadgeCheck className="w-3 h-3 text-emerald-600" />
                            ACCEPTED (Agréé)
                          </span>
                        ) : aff.status === "PENDING" ? (
                          <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300 flex items-center gap-1">
                            <Clock className="w-3 h-3 text-amber-600" />
                            PENDING (En attente)
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-red-100 text-red-800 border border-red-300 flex items-center gap-1">
                            <X className="w-3 h-3 text-red-600" />
                            REFUSED (Refusé)
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-[10px] text-zinc-400 font-mono pt-2 border-t border-zinc-200/60 flex items-center justify-between">
                      <span>Tx: {aff.blockchainTxHash.slice(0, 24)}...</span>
                      <span>Reçu le : {new Date(aff.invitedAt).toLocaleDateString("fr-FR")}</span>
                    </div>

                    {/* Action buttons for pending invitation */}
                    {aff.status === "PENDING" && (
                      <div className="mt-3 pt-3 border-t border-amber-200/60 flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleRefuseAffiliation(aff.id)}
                          className="px-3 py-1.5 rounded-xl border border-zinc-200 text-zinc-700 hover:bg-zinc-100 font-semibold text-xs transition-colors"
                        >
                          Refuser
                        </button>
                        <button
                          onClick={() => handleAcceptAffiliation(aff.id)}
                          className="px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white font-semibold text-xs transition-colors flex items-center gap-1.5 shadow-xs"
                        >
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Accepter l'Affiliation (Signer sur Blockchain)</span>
                        </button>
                      </div>
                    )}

                    {/* Switch to this hospital button if accepted and not currently active */}
                    {aff.status === "ACCEPTED" && aff.hospitalId !== activeHospitalId && (
                      <div className="mt-2.5 pt-2 border-t border-zinc-200/50 flex justify-end">
                        <button
                          onClick={() => {
                            setActiveHospitalId(aff.hospitalId);
                            setIsAffiliationModalOpen(false);
                          }}
                          className="text-[11px] font-bold text-emerald-700 hover:text-emerald-900 flex items-center gap-1"
                        >
                          <span>Basculer sur cet hôpital pour mes consultations</span>
                          <ChevronRight className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-3 bg-zinc-50 border-t border-zinc-200 flex items-center justify-between text-[11px] text-zinc-500">
              <span>Smart Contract Habilitations V2.0</span>
              <button
                onClick={() => setIsAffiliationModalOpen(false)}
                className="px-4 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl font-semibold text-xs"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
