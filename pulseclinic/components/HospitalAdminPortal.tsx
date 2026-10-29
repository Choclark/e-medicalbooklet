"use client";

import React, { useState } from "react";
import {
  Building2,
  Users,
  UserPlus,
  ShieldAlert,
  Activity,
  CheckCircle2,
  Download,
  Key,
  Package,
  Plus,
  FlaskConical,
  Syringe,
  Lock,
  Radio,
  X,
} from "lucide-react";
import {
  PortalType,
  HospitalStaffItem,
  INITIAL_HOSPITAL_STAFF,
  INITIAL_AUDIT_LOGS,
  AuditLogEntry,
  LocalTenantServiceTariff,
  INITIAL_LOCAL_TARIFFS,
} from "@/lib/multiPortalStore";
import {
  clinicalBookletStore,
  useClinicalBookletStore,
  LabTestResultItem,
  CryptographicBookletProof,
} from "@/lib/clinicalBookletStore";
import { StoredCredential } from "@/lib/webauthn";

interface HospitalAdminPortalProps {
  credential: StoredCredential;
  onSwitchPortal: (portal: PortalType) => void;
  availableRoles: string[];
  onInviteStaff?: (email: string, role: "DOCTOR" | "HOSPITAL_STAFF", department: string) => void;
}

export default function HospitalAdminPortal({
  credential,
  onSwitchPortal,
  availableRoles = [],
  onInviteStaff,
}: HospitalAdminPortalProps) {
  const [activeTab, setActiveTab] = useState<
    "lab_results" | "vaccinations" | "staff" | "admissions" | "catalog" | "audit"
  >("lab_results");
  const [staffList, setStaffList] = useState<HospitalStaffItem[]>(INITIAL_HOSPITAL_STAFF);
  const [auditLogs] = useState<AuditLogEntry[]>(INITIAL_AUDIT_LOGS);
  const [localTariffs, setLocalTariffs] = useState<LocalTenantServiceTariff[]>(INITIAL_LOCAL_TARIFFS);
  const bookletState = useClinicalBookletStore();
  const [inspectedProof, setInspectedProof] = useState<CryptographicBookletProof | null>(null);

  // Hospital Lab Result Form (On-Chain: Encrypted with Patient PK + Signed with Hospital Private Key)
  const [selectedLabRequestId, setSelectedLabRequestId] = useState<string>("");
  const [labPatientName, setLabPatientName] = useState("Alex Mensah");
  const [labOrderedBy, setLabOrderedBy] = useState("Dr. Martin Kamga");
  const [labTestName, setLabTestName] = useState("Bilan Lipidique Complet + Troponine I (hs-cTnI)");
  const [labCategory, setLabCategory] = useState("Biochimie");
  const [labResultValue, setLabResultValue] = useState("LDL: 1.05 g/L | HDL: 0.58 g/L | Troponine I: 4.1 ng/L");
  const [labUnit, setLabUnit] = useState("g/L & ng/L");
  const [labRefRange, setLabRefRange] = useState("LDL < 1.30 g/L | Troponine I < 14.0 ng/L");
  const [labFlag, setLabFlag] = useState<LabTestResultItem["interpretationFlag"]>("NORMAL");
  const [labNotes, setLabNotes] = useState(
    "Analyse automatisée Cobas 8000 validée par le Laboratoire Central HCY. Aucune nécrose myocardique."
  );
  const [isSubmittingLab, setIsSubmittingLab] = useState(false);
  const [labSuccessBanner, setLabSuccessBanner] = useState<{
    message: string;
    txHash: string;
    gateway: string;
  } | null>(null);

  // Vaccination Center Form (On-Chain: Encrypted with Patient PK + Signed with Vaccination Center Private Key)
  const [vaxPatientName, setVaxPatientName] = useState("Alex Mensah");
  const [vaxName, setVaxName] = useState("Vaccin Hépatite B Recombiné (Engerix-B 20 µg)");
  const [vaxDisease, setVaxDisease] = useState("Hépatite Virale B (VHB)");
  const [vaxDose, setVaxDose] = useState("Dose Rappel (3 / 3)");
  const [vaxBatch, setVaxBatch] = useState("lot-AHB2026-CM88");
  const [vaxManufacturer, setVaxManufacturer] = useState("GSK Biologicals / Institut Pasteur");
  const [vaxCenterName, setVaxCenterName] = useState(
    "Centre de Vaccination Agréé — Hôpital Central de Yaoundé (PEV)"
  );
  const [vaxAdministeredBy, setVaxAdministeredBy] = useState("Dr. Jean-Baptiste Ndam (Unité Immunisation)");
  const [vaxRouteSite, setVaxRouteSite] = useState("Intramusculaire (Deltoïde Droit)");
  const [vaxNextDue, setVaxNextDue] = useState("Immunité consolidée (Contrôle 2031)");
  const [isSubmittingVax, setIsSubmittingVax] = useState(false);
  const [vaxSuccessBanner, setVaxSuccessBanner] = useState<{
    message: string;
    txHash: string;
    gateway: string;
  } | null>(null);

  // Role connection checks for portal switching
  const hasDoctorRole = availableRoles.includes("DOCTOR");
  const hasSysAdminRole = availableRoles.includes("SYSTEM_ADMIN");

  // New Staff Invite Form
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"DOCTOR" | "HOSPITAL_STAFF">("DOCTOR");
  const [inviteDepartment, setInviteDepartment] = useState("Cardiology");
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  // Triage / Admission State
  const [patientName, setPatientName] = useState("Kofi Mensah");
  const [selectedDoctor, setSelectedDoctor] = useState("Dr. Martin Kamga");
  const [triagePriority, setTriagePriority] = useState<"Routine" | "Urgent" | "Emergency">("Urgent");
  const [triageStatus, setTriageStatus] = useState<string | null>(null);

  // Local Catalog Form
  const [newTariffName, setNewTariffName] = useState("");
  const [newTariffCategory, setNewTariffCategory] =
    useState<LocalTenantServiceTariff["category"]>("CONSULTATION");
  const [newTariffPrice, setNewTariffPrice] = useState("15000");
  const [newTariffStock, setNewTariffStock] = useState("Disponible");
  const [catalogNotice, setCatalogNotice] = useState<string | null>(null);

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteName || !inviteEmail) return;

    const newStaff: HospitalStaffItem = {
      id: `stf-${Date.now().toString().slice(-4)}`,
      name: inviteName,
      email: inviteEmail,
      role: inviteRole,
      department: inviteDepartment,
      status: "PENDING_APPROVAL",
      publicKey: "Pending acceptance by practitioner...",
      blockchainAddress: "did:pulse:pending",
      patientsServed: 0,
    };

    setStaffList([newStaff, ...staffList]);
    if (onInviteStaff) {
      onInviteStaff(inviteEmail, inviteRole, inviteDepartment);
    }
    setInviteSuccess(
      `Local ward invitation dispatched to ${inviteEmail} as ${inviteRole} (${inviteDepartment}). Once accepted, their facility-scoped role keypair will be anchored.`
    );
    setInviteName("");
    setInviteEmail("");
    setTimeout(() => setInviteSuccess(null), 6000);
  };

  const handleTriageAdmission = (e: React.FormEvent) => {
    e.preventDefault();
    setTriageStatus(
      `Patient ${patientName} admitted (${triagePriority} priority) and assigned to ${selectedDoctor}!`
    );
    setTimeout(() => setTriageStatus(null), 4000);
  };

  const handleAddLocalTariff = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTariffName.trim()) return;
    const item: LocalTenantServiceTariff = {
      id: `loc-${Date.now().toString().slice(-4)}`,
      category: newTariffCategory,
      itemName: newTariffName.trim(),
      localCode: `HCY-${newTariffCategory.slice(0, 4)}-${Date.now().toString().slice(-3)}`,
      unitPriceXaf: Number(newTariffPrice) || 0,
      stockOrCapacity: newTariffStock,
      status: "AVAILABLE",
    };
    setLocalTariffs([item, ...localTariffs]);
    setNewTariffName("");
    setCatalogNotice(`Updated local hospital tariff & stock item: ${item.itemName}.`);
    setTimeout(() => setCatalogNotice(null), 4000);
  };

  // Submit Hospital Test Result -> E2E Encrypted with Patient Public Key + Signed with Hospital Private Key -> First Client Node -> Blockchain
  const handleSubmitHospitalTestResult = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!labTestName.trim() || !labResultValue.trim()) return;

    setIsSubmittingLab(true);
    setLabSuccessBanner(null);

    try {
      const result = await clinicalBookletStore.addHospitalTestResultToBlockchain({
        requestId: selectedLabRequestId || undefined,
        patientId: "usr-alex-mensah",
        patientName: labPatientName,
        hospitalId: "hosp-yaounde-central",
        hospitalName: "Hôpital Central de Yaoundé (HCY)",
        hospitalDid: "did:pulse:hosp:0x892a019b",
        performingLaboratory: "Laboratoire Central de Biologie & Hématologie (HCY)",
        orderedByDoctorName: labOrderedBy,
        testName: labTestName.trim(),
        category: labCategory,
        resultValue: labResultValue.trim(),
        unit: labUnit,
        referenceRange: labRefRange,
        interpretationFlag: labFlag,
        methodologyNotes: labNotes,
      });

      setIsSubmittingLab(false);
      setSelectedLabRequestId("");
      setLabSuccessBanner({
        message: `Résultat d'analyse (${result.testName}) chiffré de bout en bout avec la Clé Publique du Patient, signé avec la Clé Privée de l'Hôpital (${result.cryptoProof.signerName}), transmis au 1er Client Node et ancré sur la Blockchain (Bloc #${result.cryptoProof.blockHeight}) !`,
        txHash: result.cryptoProof.blockchainTxHash,
        gateway: result.cryptoProof.firstClientNodeGateway,
      });
    } catch (err) {
      setIsSubmittingLab(false);
      console.error("Failed to anchor hospital test result on blockchain:", err);
    }
  };

  // Submit Vaccination -> E2E Encrypted with Patient Public Key + Signed with Vaccination Center Private Key -> First Client Node -> Blockchain
  const handleSubmitVaccination = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vaxName.trim() || !vaxBatch.trim()) return;

    setIsSubmittingVax(true);
    setVaxSuccessBanner(null);

    try {
      const vax = await clinicalBookletStore.addVaccinationToBlockchain({
        patientId: "usr-alex-mensah",
        patientName: vaxPatientName,
        vaccineName: vaxName.trim(),
        targetDisease: vaxDisease,
        doseNumber: vaxDose,
        batchLotNumber: vaxBatch,
        manufacturer: vaxManufacturer,
        vaccinationCenterId: "vax-center-hcy",
        vaccinationCenterName: vaxCenterName,
        vaccinationCenterDid: "did:pulse:vax:0x62a901fe82736194bca88210492817263541920c",
        administeredBy: vaxAdministeredBy,
        routeAndSite: vaxRouteSite,
        nextDueDate: vaxNextDue,
      });

      setIsSubmittingVax(false);
      setVaxSuccessBanner({
        message: `Certificat de Vaccination (${vax.vaccineName}) chiffré avec la Clé Publique du Patient avant de quitter le portail, signé avec la Clé Privée du Centre de Vaccination, transmis au 1er Client Node et ancré sur la Blockchain (Bloc #${vax.cryptoProof.blockHeight}) !`,
        txHash: vax.cryptoProof.blockchainTxHash,
        gateway: vax.cryptoProof.firstClientNodeGateway,
      });
    } catch (err) {
      setIsSubmittingVax(false);
      console.error("Failed to anchor vaccination on blockchain:", err);
    }
  };

  const handleExportAuditProof = () => {
    const proof = {
      facility: "Hôpital Central de Yaoundé (HCY)",
      facilityDid: "did:pulse:hosp:0x892a019b",
      exportedBy: credential.user.name,
      exportedAt: new Date().toISOString(),
      auditTrail: auditLogs,
    };
    const blob = new Blob([JSON.stringify(proof, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hospital-audit-proof-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-screen bg-[#F4F5F7] font-sans antialiased text-zinc-900 overflow-hidden">
      {/* LEFT SIDEBAR - HOSPITAL MANAGER (TENANT LEVEL) */}
      <aside className="w-64 bg-transparent flex flex-col shrink-0 p-4 select-none">
        {/* Brand */}
        <div className="flex items-center gap-3 px-3 py-3 mb-5">
          <div className="w-9 h-9 rounded-2xl bg-zinc-900 text-white flex items-center justify-center shadow-xs">
            <Building2 className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <span className="font-bold text-[16px] tracking-tight text-zinc-900 block leading-tight">
              Hôpital Central (HCY)
            </span>
            <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
              Hospital & Vaccination Center
            </span>
          </div>
        </div>

        {/* Portal Switcher */}
        <div className="mb-4 px-2">
          <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">
            Switch Portal View
          </label>
          <div className="flex flex-col gap-1 bg-white p-1.5 rounded-2xl border border-zinc-200/90 shadow-2xs">
            <button
              onClick={() => onSwitchPortal("patient")}
              className="text-left px-3 py-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 rounded-xl transition-all"
            >
              Patient Booklet Portal
            </button>
            {hasDoctorRole && (
              <button
                onClick={() => onSwitchPortal("doctor")}
                className="text-left px-3 py-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 rounded-xl transition-all"
              >
                Practitioner Portal
              </button>
            )}
            <button
              disabled
              className="text-left px-3 py-1.5 text-xs font-bold text-zinc-900 bg-zinc-100 rounded-xl flex items-center justify-between"
            >
              <span>Hospital Manager (Tenant)</span>
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
            </button>
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

        {/* Navigation Tabs */}
        <div className="space-y-1 px-1 text-xs">
          <button
            onClick={() => setActiveTab("lab_results")}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl transition-all ${
              activeTab === "lab_results"
                ? "bg-white text-zinc-900 font-bold shadow-2xs"
                : "text-zinc-600 hover:bg-black/5"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <FlaskConical className="w-4 h-4 text-emerald-600" />
              <span>Lab & Test Results (On-Chain)</span>
            </div>
            {bookletState.labTestRequests.filter((r) => r.status === "PENDING_HOSPITAL_LAB").length >
              0 && (
              <span className="text-[10px] font-bold bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded-full">
                {
                  bookletState.labTestRequests.filter((r) => r.status === "PENDING_HOSPITAL_LAB")
                    .length
                }
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab("vaccinations")}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all ${
              activeTab === "vaccinations"
                ? "bg-white text-zinc-900 font-bold shadow-2xs"
                : "text-zinc-600 hover:bg-black/5"
            }`}
          >
            <Syringe className="w-4 h-4 text-blue-600" />
            <span>Vaccination Center (On-Chain)</span>
          </button>

          <button
            onClick={() => setActiveTab("staff")}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all ${
              activeTab === "staff"
                ? "bg-white text-zinc-900 font-bold shadow-2xs"
                : "text-zinc-600 hover:bg-black/5"
            }`}
          >
            <Users className="w-4 h-4 text-zinc-500" />
            <span>Local Staff & Shifts ({staffList.length})</span>
          </button>
          <button
            onClick={() => setActiveTab("admissions")}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all ${
              activeTab === "admissions"
                ? "bg-white text-zinc-900 font-bold shadow-2xs"
                : "text-zinc-600 hover:bg-black/5"
            }`}
          >
            <Activity className="w-4 h-4 text-zinc-500" />
            <span>Admissions & Triage</span>
          </button>
          <button
            onClick={() => setActiveTab("catalog")}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all ${
              activeTab === "catalog"
                ? "bg-white text-zinc-900 font-bold shadow-2xs"
                : "text-zinc-600 hover:bg-black/5"
            }`}
          >
            <Package className="w-4 h-4 text-zinc-500" />
            <span>Tariffs & Pharmacy Stock</span>
          </button>
          <button
            onClick={() => setActiveTab("audit")}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all ${
              activeTab === "audit"
                ? "bg-white text-zinc-900 font-bold shadow-2xs"
                : "text-zinc-600 hover:bg-black/5"
            }`}
          >
            <ShieldAlert className="w-4 h-4 text-zinc-500" />
            <span>Facility Workflow & Audit</span>
          </button>
        </div>

        {/* Facility Info */}
        <div className="mt-auto pt-3 border-t border-zinc-200/70">
          <div className="p-3 rounded-2xl bg-white border border-zinc-200 shadow-2xs space-y-1">
            <span className="text-xs font-bold text-zinc-900 block">
              Hôpital Central de Yaoundé
            </span>
            <p className="text-[10px] text-zinc-500">Hospital Key & Vaccination Key Active</p>
            <p className="text-[10px] font-mono text-zinc-400">DID: did:pulse:hosp:0x892a019b</p>
          </div>
        </div>
      </aside>

      {/* MAIN HOSPITAL MANAGER WORKSPACE */}
      <main className="flex-1 flex flex-col min-w-0 h-screen p-4 pl-0">
        <div className="flex-1 bg-white rounded-3xl border border-zinc-200 shadow-sm flex flex-col overflow-hidden">
          {/* Top Bar */}
          <header className="h-16 px-8 border-b border-zinc-100 flex items-center justify-between shrink-0 bg-white">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Hospital & Vaccination Authority
              </span>
              <span className="text-zinc-300">›</span>
              <span className="text-zinc-900 font-bold text-sm">
                {activeTab === "lab_results" &&
                  "Laboratoire Hospitalier : Résultats d'Examens (Signés avec la Clé Privée de l'Hôpital & Chiffrés Clé Publique Patient)"}
                {activeTab === "vaccinations" &&
                  "Centre de Vaccination : Certificats Vaccinaux (Signés Clé Privée Centre Vaccination & Chiffrés Clé Publique Patient)"}
                {activeTab === "staff" && "Local Department & Shift Onboarding"}
                {activeTab === "admissions" && "Patient Reception, Triage & Roster"}
                {activeTab === "catalog" && "Local Service Prices, Room Rates & Pharmacy Stock"}
                {activeTab === "audit" && "Local Facility Compliance & Workflow Audit"}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                <Radio className="w-3.5 h-3.5 text-emerald-600" />
                E2E Patient Public Key + Authority Private Key
              </span>
            </div>
          </header>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar">
            {/* TAB A: HOSPITAL LABORATORY & TEST RESULTS (ON-CHAIN SIGNED BY HOSPITAL PRIVATE KEY) */}
            {activeTab === "lab_results" && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Left Column: Off-Chain Doctor Lab Requests Queue + Hospital Result Form (6 cols) */}
                <div className="lg:col-span-6 space-y-6">
                  {/* Incoming Off-Chain Doctor Lab Requests */}
                  <div className="bg-amber-50/50 rounded-2xl border border-amber-200 p-5 space-y-3 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FlaskConical className="w-4 h-4 text-amber-600" />
                        <h3 className="text-xs font-bold text-zinc-900">
                          File d'Attente Demandes d'Analyses Médecin (Reçues Hors-Chaîne / Off-Chain)
                        </h3>
                      </div>
                      <span className="text-[10px] font-mono font-bold bg-amber-100 text-amber-900 px-2 py-0.5 rounded-full">
                        {bookletState.labTestRequests.length} demandes
                      </span>
                    </div>
                    <p className="text-[11px] text-amber-900 leading-relaxed">
                      Conformément à l'architecture, les demandes d'examens du médecin arrivent ici <strong>sans passer par la blockchain</strong>. Cliquez sur une demande pour saisir le résultat, le chiffrer avec la <strong>Clé Publique du Patient</strong> et le signer avec la <strong>Clé Privée de l'Hôpital</strong> avant envoi sur la Blockchain.
                    </p>

                    <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                      {bookletState.labTestRequests.map((req) => (
                        <div
                          key={req.id}
                          className={`p-3 rounded-xl border text-xs transition-all ${
                            selectedLabRequestId === req.id
                              ? "border-zinc-900 bg-white ring-1 ring-zinc-900"
                              : "border-amber-200/90 bg-white/90"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-bold text-zinc-900">
                              {req.testName} ({req.patientName})
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                req.status === "COMPLETED_ON_CHAIN"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-amber-100 text-amber-800"
                              }`}
                            >
                              {req.status === "COMPLETED_ON_CHAIN"
                                ? "✓ Résultat Publié On-Chain"
                                : "⏳ En attente Labo (Off-Chain)"}
                            </span>
                          </div>
                          <p className="text-[11px] text-zinc-500">
                            Prescrit par : <strong>{req.doctorName}</strong> • {req.category} ({req.urgency})
                          </p>
                          <div className="mt-2 pt-2 border-t border-zinc-100 flex items-center justify-between">
                            <span className="text-[10px] font-mono text-zinc-400">
                              ID: {req.id} • Blockchain: NON (Off-Chain)
                            </span>
                            {req.status === "PENDING_HOSPITAL_LAB" && (
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedLabRequestId(req.id);
                                  setLabPatientName(req.patientName);
                                  setLabOrderedBy(req.doctorName);
                                  setLabTestName(req.testName);
                                  setLabCategory(req.category);
                                }}
                                className="px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 text-white rounded-lg text-[10px] font-bold cursor-pointer"
                              >
                                Saisir & Signer le Résultat →
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Hospital Test Result Entry & Cryptographic Signing Form */}
                  <div className="bg-white rounded-2xl border border-zinc-200 p-6 space-y-4 shadow-2xs">
                    <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
                      <div className="flex items-center gap-2">
                        <Lock className="w-4 h-4 text-emerald-600" />
                        <h3 className="font-bold text-sm text-zinc-900">
                          Publier un Résultat de Test Hospitalier (On-Chain)
                        </h3>
                      </div>
                      <span className="text-[10px] font-mono font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded">
                        Signé Clé Privée Hôpital
                      </span>
                    </div>

                    {labSuccessBanner && (
                      <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 text-xs space-y-1">
                        <div className="flex items-start gap-2 font-semibold">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                          <span>{labSuccessBanner.message}</span>
                        </div>
                        <div className="pl-6 text-[10px] font-mono text-emerald-800">
                          Tx: {labSuccessBanner.txHash.slice(0, 26)}... • Gateway: {labSuccessBanner.gateway}
                        </div>
                      </div>
                    )}

                    <form onSubmit={handleSubmitHospitalTestResult} className="space-y-3.5 text-xs">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="font-semibold text-zinc-700 block mb-1">Patient</label>
                          <input
                            type="text"
                            value={labPatientName}
                            onChange={(e) => setLabPatientName(e.target.value)}
                            className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs"
                            required
                          />
                        </div>
                        <div>
                          <label className="font-semibold text-zinc-700 block mb-1">
                            Médecin Prescripteur
                          </label>
                          <input
                            type="text"
                            value={labOrderedBy}
                            onChange={(e) => setLabOrderedBy(e.target.value)}
                            className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs"
                            required
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="font-semibold text-zinc-700 block mb-1">
                            Intitulé de l'Examen / Analyse
                          </label>
                          <input
                            type="text"
                            value={labTestName}
                            onChange={(e) => setLabTestName(e.target.value)}
                            className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs"
                            required
                          />
                        </div>
                        <div>
                          <label className="font-semibold text-zinc-700 block mb-1">
                            Interprétation Biologique
                          </label>
                          <select
                            value={labFlag}
                            onChange={(e) =>
                              setLabFlag(e.target.value as LabTestResultItem["interpretationFlag"])
                            }
                            className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs font-bold"
                          >
                            <option value="NORMAL">NORMAL (Dans les normes)</option>
                            <option value="ELEVATED">ELEVATED (Valeur élevée)</option>
                            <option value="CRITICAL">CRITICAL (Alerte critique)</option>
                            <option value="NEGATIVE">NEGATIVE (Négatif)</option>
                            <option value="POSITIVE">POSITIVE (Positif)</option>
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        <div className="col-span-2">
                          <label className="font-semibold text-zinc-700 block mb-1">
                            Valeur / Résultat Mesuré
                          </label>
                          <input
                            type="text"
                            value={labResultValue}
                            onChange={(e) => setLabResultValue(e.target.value)}
                            className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs font-semibold"
                            required
                          />
                        </div>
                        <div>
                          <label className="font-semibold text-zinc-700 block mb-1">Unité</label>
                          <input
                            type="text"
                            value={labUnit}
                            onChange={(e) => setLabUnit(e.target.value)}
                            className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs"
                            required
                          />
                        </div>
                      </div>

                      <div>
                        <label className="font-semibold text-zinc-700 block mb-1">
                          Valeurs de Référence & Normes
                        </label>
                        <input
                          type="text"
                          value={labRefRange}
                          onChange={(e) => setLabRefRange(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs"
                        />
                      </div>

                      <div>
                        <label className="font-semibold text-zinc-700 block mb-1">
                          Conclusion & Méthodologie du Laboratoire Hospitalier
                        </label>
                        <textarea
                          rows={2}
                          value={labNotes}
                          onChange={(e) => setLabNotes(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={isSubmittingLab}
                        className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl font-semibold text-xs flex items-center justify-center gap-2 shadow-xs cursor-pointer"
                      >
                        <Key className="w-3.5 h-3.5 text-emerald-400" />
                        <span>
                          {isSubmittingLab
                            ? "Chiffrement Clé Publique Patient & Signature Clé Privée Hôpital..."
                            : "Chiffrer (Clé Publique Patient), Signer (Clé Privée Hôpital) & Ancrer sur Blockchain"}
                        </span>
                      </button>
                    </form>
                  </div>
                </div>

                {/* Right Column: Ledger of On-Chain Hospital Test Results (6 cols) */}
                <div className="lg:col-span-6 bg-white rounded-2xl border border-zinc-200 p-6 space-y-4 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-bold text-zinc-900 text-sm">
                        Registre Blockchain des Résultats d'Examens Hospitaliers
                      </h3>
                      <p className="text-xs text-zinc-500">
                        Signés par la Clé Privée de l'Hôpital & Chiffrés avec la Clé Publique du Patient
                      </p>
                    </div>
                    <span className="text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 px-2.5 py-1 rounded-full">
                      {bookletState.labTestResults.length} Résultats On-Chain
                    </span>
                  </div>

                  <div className="space-y-3">
                    {bookletState.labTestResults.map((res) => {
                      const isTemp =
                        res.cryptoProof.persistenceStatus === "TEMPORARY_PENDING_CONSENSUS";
                      return (
                        <div
                          key={res.id}
                          className={`p-4 rounded-xl border space-y-2 text-xs transition-all ${
                            isTemp
                              ? "border-amber-300 bg-amber-50/20"
                              : "border-zinc-200 bg-zinc-50/50"
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <span className="font-bold text-zinc-900 text-sm block">
                                {res.testName}
                              </span>
                              <span className="text-[11px] text-zinc-500">
                                Patient : <strong>{res.patientName}</strong> • Prescrit par {res.orderedByDoctorName}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  isTemp
                                    ? "bg-amber-100 text-amber-900 border border-amber-300 animate-pulse"
                                    : "bg-emerald-50 text-emerald-800 border border-emerald-200"
                                }`}
                              >
                                {isTemp
                                  ? "⏳ TEMPORAIRE (Tx Pool → Consensus...)"
                                  : "✓ PERMANENT (BD On-Chain + Off-Chain)"}
                              </span>
                              <span
                                className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                                  res.interpretationFlag === "NORMAL" ||
                                  res.interpretationFlag === "NEGATIVE"
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-amber-100 text-amber-800"
                                }`}
                              >
                                {res.interpretationFlag}
                              </span>
                            </div>
                          </div>

                          {res.cryptoProof.pipelineStage && (
                            <div
                              className={`px-3 py-1.5 rounded-lg border text-[10px] font-mono ${
                                isTemp
                                  ? "bg-amber-50 border-amber-200 text-amber-900"
                                  : "bg-zinc-900 border-zinc-800 text-emerald-400"
                              }`}
                            >
                              {res.cryptoProof.pipelineStage}
                            </div>
                          )}

                          <div className="p-2.5 rounded-lg bg-white border border-zinc-200/80 font-mono text-xs text-zinc-900">
                            <strong>Résultat :</strong> {res.resultValue} ({res.unit})
                            <div className="text-[10px] text-zinc-500 mt-0.5">
                              Réf: {res.referenceRange}
                            </div>
                          </div>

                          <p className="text-[11px] text-zinc-600">{res.methodologyNotes}</p>

                          <div className="pt-2 border-t border-zinc-200/70 flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-zinc-500">
                            <span>
                              Signé par : <strong>{res.cryptoProof.signerRole}</strong> •{" "}
                              {isTemp ? "En cours de validation..." : `Bloc #${res.cryptoProof.blockHeight}`}
                            </span>
                            <button
                              type="button"
                              onClick={() => setInspectedProof(res.cryptoProof)}
                              className="text-emerald-700 hover:text-emerald-900 font-sans font-bold underline cursor-pointer"
                            >
                              Inspecter Signature Hôpital, Consensus & BD →
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* TAB B: VACCINATION CENTER (ON-CHAIN SIGNED BY VACCINATION CENTER PRIVATE KEY) */}
            {activeTab === "vaccinations" && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Left Column: Vaccination Administration Form (5 cols) */}
                <div className="lg:col-span-5 bg-zinc-50/70 rounded-2xl border border-zinc-200 p-6 space-y-4 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-zinc-900 font-bold text-sm">
                      <Syringe className="w-4 h-4 text-blue-600" />
                      <h3>Enregistrer un Acte de Vaccination (On-Chain)</h3>
                    </div>
                    <span className="text-[10px] font-mono font-bold bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                      Clé Privée Centre Vaccination
                    </span>
                  </div>

                  <p className="text-xs text-zinc-600 leading-relaxed">
                    Avant de quitter le portail vers le <strong>1er Client Node</strong>, le certificat vaccinal est chiffré avec la <strong>Clé Publique du Patient</strong> et signé cryptographiquement avec la <strong>Clé Privée du Centre de Vaccination</strong>.
                  </p>

                  {vaxSuccessBanner && (
                    <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 text-xs space-y-1">
                      <div className="flex items-start gap-2 font-semibold">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                        <span>{vaxSuccessBanner.message}</span>
                      </div>
                      <div className="pl-6 text-[10px] font-mono text-emerald-800">
                        Tx: {vaxSuccessBanner.txHash.slice(0, 26)}... • Gateway: {vaxSuccessBanner.gateway}
                      </div>
                    </div>
                  )}

                  <form onSubmit={handleSubmitVaccination} className="space-y-3 text-xs">
                    <div>
                      <label className="font-semibold text-zinc-700 block mb-1">Nom du Patient</label>
                      <input
                        type="text"
                        value={vaxPatientName}
                        onChange={(e) => setVaxPatientName(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs"
                        required
                      />
                    </div>

                    <div>
                      <label className="font-semibold text-zinc-700 block mb-1">Nom du Vaccin</label>
                      <input
                        type="text"
                        value={vaxName}
                        onChange={(e) => setVaxName(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs"
                        required
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="font-semibold text-zinc-700 block mb-1">Maladie Ciblée</label>
                        <input
                          type="text"
                          value={vaxDisease}
                          onChange={(e) => setVaxDisease(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs"
                          required
                        />
                      </div>
                      <div>
                        <label className="font-semibold text-zinc-700 block mb-1">Numéro de Dose</label>
                        <input
                          type="text"
                          value={vaxDose}
                          onChange={(e) => setVaxDose(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs"
                          required
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="font-semibold text-zinc-700 block mb-1">N° de Lot (Batch)</label>
                        <input
                          type="text"
                          value={vaxBatch}
                          onChange={(e) => setVaxBatch(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs font-mono"
                          required
                        />
                      </div>
                      <div>
                        <label className="font-semibold text-zinc-700 block mb-1">Fabricant</label>
                        <input
                          type="text"
                          value={vaxManufacturer}
                          onChange={(e) => setVaxManufacturer(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs"
                          required
                        />
                      </div>
                    </div>

                    <div>
                      <label className="font-semibold text-zinc-700 block mb-1">
                        Centre de Vaccination Signataire
                      </label>
                      <input
                        type="text"
                        value={vaxCenterName}
                        onChange={(e) => setVaxCenterName(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs"
                        required
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="font-semibold text-zinc-700 block mb-1">Voie & Site</label>
                        <input
                          type="text"
                          value={vaxRouteSite}
                          onChange={(e) => setVaxRouteSite(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs"
                        />
                      </div>
                      <div>
                        <label className="font-semibold text-zinc-700 block mb-1">Prochain Rappel</label>
                        <input
                          type="text"
                          value={vaxNextDue}
                          onChange={(e) => setVaxNextDue(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={isSubmittingVax}
                      className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl font-semibold text-xs flex items-center justify-center gap-2 shadow-xs cursor-pointer"
                    >
                      <Lock className="w-3.5 h-3.5 text-emerald-400" />
                      <span>
                        {isSubmittingVax
                          ? "Chiffrement Clé Publique Patient & Signature Centre Vaccination..."
                          : "Chiffrer (Clé Publique Patient), Signer (Centre Vaccination) & Ancrer On-Chain"}
                      </span>
                    </button>
                  </form>
                </div>

                {/* Right Column: On-Chain Vaccination Certificates (7 cols) */}
                <div className="lg:col-span-7 bg-white rounded-2xl border border-zinc-200 p-6 space-y-4 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-bold text-zinc-900 text-sm">
                        Registre Blockchain des Vaccinations Certifiées
                      </h3>
                      <p className="text-xs text-zinc-500">
                        Chiffrées avec la Clé Publique du Patient & Signées par le Centre de Vaccination
                      </p>
                    </div>
                    <span className="text-xs font-bold bg-blue-50 text-blue-800 border border-blue-200 px-2.5 py-1 rounded-full">
                      {bookletState.vaccinations.length} Vaccins On-Chain
                    </span>
                  </div>

                  <div className="space-y-3">
                    {bookletState.vaccinations.map((v) => {
                      const isTemp =
                        v.cryptoProof.persistenceStatus === "TEMPORARY_PENDING_CONSENSUS";
                      return (
                        <div
                          key={v.id}
                          className={`p-4 rounded-xl border space-y-2 text-xs transition-all ${
                            isTemp
                              ? "border-amber-300 bg-amber-50/20"
                              : "border-zinc-200 bg-zinc-50/50"
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <span className="font-bold text-zinc-900 text-sm block">
                                {v.vaccineName}
                              </span>
                              <span className="text-[11px] text-zinc-500">
                                Cible : <strong>{v.targetDisease}</strong> • Patient : {v.patientName}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  isTemp
                                    ? "bg-amber-100 text-amber-900 border border-amber-300 animate-pulse"
                                    : "bg-emerald-50 text-emerald-800 border border-emerald-200"
                                }`}
                              >
                                {isTemp
                                  ? "⏳ TEMPORAIRE (Tx Pool → Consensus...)"
                                  : "✓ PERMANENT (BD On-Chain + Off-Chain)"}
                              </span>
                              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                {v.doseNumber}
                              </span>
                            </div>
                          </div>

                          {v.cryptoProof.pipelineStage && (
                            <div
                              className={`px-3 py-1.5 rounded-lg border text-[10px] font-mono ${
                                isTemp
                                  ? "bg-amber-50 border-amber-200 text-amber-900"
                                  : "bg-zinc-900 border-zinc-800 text-emerald-400"
                              }`}
                            >
                              {v.cryptoProof.pipelineStage}
                            </div>
                          )}

                          <div className="grid grid-cols-2 gap-2 p-2.5 rounded-lg bg-white border border-zinc-200/80 text-[11px]">
                            <div>
                              <span className="text-zinc-400">Lot :</span>{" "}
                              <strong className="font-mono">{v.batchLotNumber}</strong> ({v.manufacturer})
                            </div>
                            <div>
                              <span className="text-zinc-400">Prochain Rappel :</span>{" "}
                              <strong>{v.nextDueDate}</strong>
                            </div>
                            <div className="col-span-2">
                              <span className="text-zinc-400">Centre :</span>{" "}
                              <strong>{v.vaccinationCenterName}</strong> ({v.administeredBy})
                            </div>
                          </div>

                          <div className="pt-2 border-t border-zinc-200/70 flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-zinc-500">
                            <span>
                              Signataire : <strong>{v.cryptoProof.signerRole}</strong> •{" "}
                              {isTemp ? "En cours de validation..." : `Bloc #${v.cryptoProof.blockHeight}`}
                            </span>
                            <button
                              type="button"
                              onClick={() => setInspectedProof(v.cryptoProof)}
                              className="text-emerald-700 hover:text-emerald-900 font-sans font-bold underline cursor-pointer"
                            >
                              Vérifier Signature Centre Vaccination, Consensus & BD →
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
            {/* TAB 1: STAFF & RESOURCE MANAGEMENT */}
            {activeTab === "staff" && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Invite Staff Form (5 cols) */}
                <div className="lg:col-span-5 bg-zinc-50/70 rounded-2xl border border-zinc-200 p-6 space-y-4 shadow-2xs">
                  <div className="flex items-center gap-2 text-zinc-900 font-bold text-sm">
                    <UserPlus className="w-4 h-4 text-emerald-600" />
                    <h3>Assign Verified Practitioner or Staff to Ward</h3>
                  </div>
                  <p className="text-xs text-zinc-500 leading-snug">
                    Assign globally verified practitioners or nurses to local hospital departments and shifts. An on-chain affiliation invitation will be dispatched to their portal.
                  </p>

                  {inviteSuccess && (
                    <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <span>{inviteSuccess}</span>
                    </div>
                  )}

                  <form onSubmit={handleInvite} className="space-y-3.5 text-xs">
                    <div>
                      <label className="font-semibold text-zinc-700 block mb-1">Full Name</label>
                      <input
                        type="text"
                        value={inviteName}
                        onChange={(e) => setInviteName(e.target.value)}
                        placeholder="e.g. Dr. Jean-Baptiste Ndam"
                        className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 bg-white focus:outline-none focus:border-zinc-900 text-xs"
                        required
                      />
                    </div>

                    <div>
                      <label className="font-semibold text-zinc-700 block mb-1">
                        Email Address
                      </label>
                      <input
                        type="email"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="e.g. practitioner@pulseclinic.cm"
                        className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 bg-white focus:outline-none focus:border-zinc-900 text-xs"
                        required
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="font-semibold text-zinc-700 block mb-1">Role</label>
                        <select
                          value={inviteRole}
                          onChange={(e) =>
                            setInviteRole(e.target.value as "DOCTOR" | "HOSPITAL_STAFF")
                          }
                          className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs"
                        >
                          <option value="DOCTOR">Doctor</option>
                          <option value="HOSPITAL_STAFF">Hospital Staff / Nurse</option>
                        </select>
                      </div>

                      <div>
                        <label className="font-semibold text-zinc-700 block mb-1">
                          Local Department
                        </label>
                        <select
                          value={inviteDepartment}
                          onChange={(e) => setInviteDepartment(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs"
                        >
                          <option value="Cardiology">Cardiology</option>
                          <option value="Orthopedics">Orthopedics</option>
                          <option value="Radiology">Radiology</option>
                          <option value="Emergency & Triage">Emergency</option>
                          <option value="Pediatrics">Pediatrics</option>
                        </select>
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl font-semibold text-xs transition-colors flex items-center justify-center gap-2 shadow-xs"
                    >
                      <Key className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Dispatch Local Facility Role Grant</span>
                    </button>
                  </form>
                </div>

                {/* Staff Roster Table (7 cols) */}
                <div className="lg:col-span-7 bg-white rounded-2xl border border-zinc-200 p-6 space-y-4 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-bold text-zinc-900 text-sm">
                        Local Facility Staff Roster
                      </h3>
                      <p className="text-xs text-zinc-500">
                        Personnel affiliated with Hôpital Central de Yaoundé
                      </p>
                    </div>
                    <span className="text-xs font-semibold bg-zinc-100 text-zinc-700 px-2.5 py-1 rounded-full">
                      {staffList.length} Active Personnel
                    </span>
                  </div>

                  <div className="divide-y divide-zinc-100 text-xs">
                    {staffList.map((stf) => (
                      <div key={stf.id} className="py-3.5 flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-bold text-zinc-900">{stf.name}</h4>
                            <span className="text-[10px] font-semibold bg-zinc-100 text-zinc-600 px-1.5 py-0.2 rounded">
                              {stf.department}
                            </span>
                          </div>
                          <p className="text-zinc-500 text-[11px]">{stf.email}</p>
                          <p className="text-zinc-400 font-mono text-[10px] truncate max-w-xs">
                            {stf.blockchainAddress}
                          </p>
                        </div>

                        <div className="text-right space-y-1">
                          {stf.status === "ACTIVE" ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                              ● Enclave Verified
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                              ● Pending Acceptance
                            </span>
                          )}
                          <p className="text-[10px] text-zinc-400">
                            {stf.patientsServed} Patients treated
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: ADMISSIONS & TRIAGE */}
            {activeTab === "admissions" && (
              <div className="max-w-2xl mx-auto bg-white rounded-2xl border border-zinc-200 p-8 space-y-6 shadow-2xs">
                <div>
                  <h3 className="font-bold text-zinc-900 text-base">
                    Patient Reception & Emergency Triage
                  </h3>
                  <p className="text-xs text-zinc-500 mt-1">
                    Check in walk-in or emergency patients to the local roster and assign them to an attending physician on shift.
                  </p>
                </div>

                {triageStatus && (
                  <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{triageStatus}</span>
                  </div>
                )}

                <form onSubmit={handleTriageAdmission} className="space-y-4 text-xs">
                  <div>
                    <label className="font-semibold text-zinc-700 block mb-1">Patient Name</label>
                    <input
                      type="text"
                      value={patientName}
                      onChange={(e) => setPatientName(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 focus:outline-none focus:border-zinc-900"
                      required
                    />
                  </div>

                  <div>
                    <label className="font-semibold text-zinc-700 block mb-1">
                      Assign Attending Doctor
                    </label>
                    <select
                      value={selectedDoctor}
                      onChange={(e) => setSelectedDoctor(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 bg-white"
                    >
                      <option value="Dr. Martin Kamga">
                        Dr. Martin Kamga (Cardiologie & Médecine Interne)
                      </option>
                      <option value="Dr. Sarah Connor">
                        Dr. Sarah Connor (Chirurgie Orthopédique)
                      </option>
                    </select>
                  </div>

                  <div>
                    <label className="font-semibold text-zinc-700 block mb-1">
                      Triage Priority
                    </label>
                    <div className="grid grid-cols-3 gap-3">
                      {(["Routine", "Urgent", "Emergency"] as const).map((p) => (
                        <button
                          type="button"
                          key={p}
                          onClick={() => setTriagePriority(p)}
                          className={`p-3 rounded-xl border text-center font-semibold transition-all ${
                            triagePriority === p
                              ? "border-zinc-900 bg-zinc-900 text-white"
                              : "border-zinc-200 hover:border-zinc-400 text-zinc-700"
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full py-3 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl font-semibold text-xs shadow-sm transition-colors"
                  >
                    Complete Triage Admission & Dispatch Ward Notification
                  </button>
                </form>
              </div>
            )}

            {/* TAB 3: LOCAL CATALOGS, SERVICE PRICES, ROOM RATES & PHARMACY STOCK */}
            {activeTab === "catalog" && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                <div className="lg:col-span-5 bg-zinc-50/70 rounded-2xl border border-zinc-200 p-6 space-y-4 shadow-2xs">
                  <div className="flex items-center gap-2 text-zinc-900 font-bold text-sm">
                    <Plus className="w-4 h-4 text-emerald-600" />
                    <h3>Configure Local Tariff or Pharmacy Stock</h3>
                  </div>
                  <p className="text-xs text-zinc-500">
                    Manage tenant-specific consultation rates, ward room tariffs, and local pharmacy stock levels.
                  </p>

                  {catalogNotice && (
                    <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>{catalogNotice}</span>
                    </div>
                  )}

                  <form onSubmit={handleAddLocalTariff} className="space-y-3.5 text-xs">
                    <div>
                      <label className="font-semibold text-zinc-700 block mb-1">Category</label>
                      <select
                        value={newTariffCategory}
                        onChange={(e) => setNewTariffCategory(e.target.value as any)}
                        className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white font-semibold"
                      >
                        <option value="CONSULTATION">Consultation Tariff</option>
                        <option value="ROOM_RATE">Hospitalization / Ward Room Rate</option>
                        <option value="PHARMACY_STOCK">Local Pharmacy Stock Item</option>
                        <option value="DIAGNOSTIC_LAB">Local Diagnostic / Lab Service</option>
                      </select>
                    </div>

                    <div>
                      <label className="font-semibold text-zinc-700 block mb-1">
                        Service or Medication Name
                      </label>
                      <input
                        type="text"
                        value={newTariffName}
                        onChange={(e) => setNewTariffName(e.target.value)}
                        placeholder="e.g. Échocardiographie Doppler Couleur"
                        className="w-full px-3.5 py-2 rounded-xl border border-zinc-200 bg-white"
                        required
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="font-semibold text-zinc-700 block mb-1">
                          Unit Price (FCFA / XAF)
                        </label>
                        <input
                          type="number"
                          value={newTariffPrice}
                          onChange={(e) => setNewTariffPrice(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white"
                          required
                        />
                      </div>
                      <div>
                        <label className="font-semibold text-zinc-700 block mb-1">
                          Stock / Ward Capacity
                        </label>
                        <input
                          type="text"
                          value={newTariffStock}
                          onChange={(e) => setNewTariffStock(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white"
                          required
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl font-semibold text-xs"
                    >
                      Save Local Facility Item
                    </button>
                  </form>
                </div>

                <div className="lg:col-span-7 bg-white rounded-2xl border border-zinc-200 p-6 space-y-4 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-bold text-zinc-900 text-sm">
                        Facility Service Prices, Room Rates & Stock
                      </h3>
                      <p className="text-xs text-zinc-500">
                        Scoped to Hôpital Central de Yaoundé (HCY)
                      </p>
                    </div>
                  </div>

                  <div className="divide-y divide-zinc-100 text-xs">
                    {localTariffs.map((item) => (
                      <div key={item.id} className="py-3.5 flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono bg-zinc-100 text-zinc-700 px-2 py-0.5 rounded font-semibold">
                              {item.category}
                            </span>
                            <h4 className="font-bold text-zinc-900">{item.itemName}</h4>
                          </div>
                          <p className="text-[11px] text-zinc-500 mt-0.5">
                            Code: <span className="font-mono">{item.localCode}</span> •{" "}
                            {item.stockOrCapacity}
                          </p>
                        </div>

                        <div className="text-right">
                          <span className="font-bold text-zinc-900 block">
                            {item.unitPriceXaf.toLocaleString()} FCFA
                          </span>
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                              item.status === "AVAILABLE"
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-amber-50 text-amber-700"
                            }`}
                          >
                            {item.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: BLOCKCHAIN AUDIT & COMPLIANCE */}
            {activeTab === "audit" && (
              <div className="space-y-6">
                <div className="bg-zinc-50 rounded-2xl border border-zinc-200 p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                      <h3 className="font-bold text-zinc-900 text-sm">
                        Local Facility Audit & Cryptographic Proof Export
                      </h3>
                    </div>
                    <p className="text-xs text-zinc-500 max-w-xl leading-relaxed">
                      All local dossier consultations, prescription signatures, and consent revocations within this hospital branch are logged on the blockchain ledger.
                    </p>
                  </div>

                  <button
                    onClick={handleExportAuditProof}
                    className="px-4 py-2.5 bg-white border border-zinc-200 text-zinc-800 rounded-xl font-semibold text-xs hover:bg-zinc-50 transition-colors flex items-center gap-2 shadow-2xs shrink-0"
                  >
                    <Download className="w-3.5 h-3.5 text-zinc-600" />
                    <span>Export Ledger Proof (JSON)</span>
                  </button>
                </div>

                {/* Audit Logs Table */}
                <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden shadow-2xs">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-zinc-100 bg-zinc-50/50 text-[11px] text-zinc-400 font-semibold">
                        <th className="py-3 px-5">Timestamp</th>
                        <th className="py-3 px-4">Actor & Role</th>
                        <th className="py-3 px-4">Action</th>
                        <th className="py-3 px-4">Patient / Resource</th>
                        <th className="py-3 px-4">Block #</th>
                        <th className="py-3 px-5 text-right">Blockchain Tx</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {auditLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-zinc-50/60 transition-colors">
                          <td className="py-3.5 px-5 font-mono text-zinc-500 whitespace-nowrap">
                            {log.timestamp}
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="font-bold text-zinc-900">{log.actorName}</span>
                            <span className="text-[10px] text-zinc-400 ml-1.5 font-medium">
                              ({log.actorRole})
                            </span>
                          </td>
                          <td className="py-3.5 px-4 font-semibold text-zinc-800">{log.action}</td>
                          <td className="py-3.5 px-4 text-zinc-600">{log.resource}</td>
                          <td className="py-3.5 px-4 font-mono text-zinc-500">
                            #{log.blockNumber}
                          </td>
                          <td className="py-3.5 px-5 text-right font-mono text-[11px] text-emerald-700">
                            {log.blockchainTxHash.slice(0, 10)}...{log.blockchainTxHash.slice(-6)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* MODAL: CRYPTOGRAPHIC PROOF INSPECTOR (HOSPITAL / VACCINATION CENTER) */}
      {inspectedProof && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-zinc-200 overflow-hidden">
            <div className="px-6 py-4 bg-zinc-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-emerald-400" />
                <h3 className="font-bold text-sm">
                  Preuve Cryptographique ({inspectedProof.signerRole}), Consensus PBFT & BD On-Chain / Off-Chain
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
                <strong>Cycle de Sauvegarde Temporaire → Permanente :</strong> L'enregistrement ({inspectedProof.recordCategory}) est sauvegardé temporairement dans le Portail et le 1er Client Node, passe par le <strong>Transaction Pool</strong>, la <strong>Proposition de Bloc</strong>, la <strong>Validation par Consensus</strong>, puis l'enregistrement dans les <strong>BD On-Chain et Off-Chain</strong> avant mise à jour permanente.
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
                <div><span className="text-zinc-400">Autorité Signataire :</span> <strong>{inspectedProof.signerName} ({inspectedProof.signerRole})</strong></div>
                <div><span className="text-zinc-400">Signature ECDSA :</span> {inspectedProof.digitalSignature}</div>
                <div><span className="text-zinc-400">Clé Publique Patient :</span> {inspectedProof.patientPublicKey.slice(0, 48)}...</div>
                <div><span className="text-zinc-400">DEK Chiffrée (Patient PK) :</span> {inspectedProof.encryptedDekForPatient.slice(0, 48)}...</div>
                <div><span className="text-zinc-400">1er Client Node :</span> {inspectedProof.firstClientNodeGateway}</div>
                <div><span className="text-zinc-400">Transaction Hash :</span> {inspectedProof.blockchainTxHash}</div>
                <div><span className="text-zinc-400">Bloc :</span> #{inspectedProof.blockHeight} ({inspectedProof.validatorNodeId})</div>
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
    </div>
  );
}
