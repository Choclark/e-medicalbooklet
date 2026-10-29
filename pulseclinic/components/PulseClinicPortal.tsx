"use client";

import React, { useState } from "react";
import {
  Heart,
  Calendar,
  Activity,
  Pill,
  FlaskConical,
  Syringe,
  Users,
  Receipt,
  Shield,
  Sparkles,
  Bell,
  Settings,
  Search,
  MoreHorizontal,
  Key,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
  ChevronRight,
  LogOut,
  UserCheck,
  Hash,
  Database,
  Menu,
  Plus,
  Lock,
  Stethoscope,
  Building2,
  UserPlus,
  AlertTriangle,
} from "lucide-react";
import { StoredCredential } from "@/lib/webauthn";
import { PortalType, AccessRequestItem, INITIAL_ACCESS_REQUESTS, INITIAL_AUDIT_LOGS, AuditLogEntry } from "@/lib/multiPortalStore";
import {
  clinicalBookletStore,
  useClinicalBookletStore,
  AVAILABLE_DOCTORS_FOR_BOOKING,
  CryptographicBookletProof,
  submitPatientConsentToBlockchain,
} from "@/lib/clinicalBookletStore";
import BlockchainKeyDrawer from "./BlockchainKeyDrawer";

interface PulseClinicPortalProps {
  credential: StoredCredential;
  onSignOut: () => void;
  onOpenAuthModal: () => void;
  onSwitchPortal: (portal: PortalType) => void;
  availableRoles: string[];
  pendingRoleInvitations: { id: string; hospitalName: string; role: "DOCTOR" | "HOSPITAL_STAFF"; department: string }[];
  onApproveRoleInvitation: (invitationId: string, role: "DOCTOR" | "HOSPITAL_STAFF", department: string) => void;
}

export default function PulseClinicPortal({
  credential,
  onSignOut,
  onOpenAuthModal,
  onSwitchPortal,
  availableRoles,
  pendingRoleInvitations,
  onApproveRoleInvitation,
}: PulseClinicPortalProps) {
  const [activeNav, setActiveNav] = useState("My health");
  const [isKeyDrawerOpen, setIsKeyDrawerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showNotificationToast, setShowNotificationToast] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // E2E Clinical Booklet Store (Appointments, Health Records, Prescriptions, Test Results, Vaccinations)
  const bookletState = useClinicalBookletStore();
  const [inspectedProof, setInspectedProof] = useState<CryptographicBookletProof | null>(null);

  // Appointment Booking State (for a particular day & specific doctor)
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>(
    AVAILABLE_DOCTORS_FOR_BOOKING[0].id
  );
  const [aptDate, setAptDate] = useState<string>("2026-11-05");
  const [aptTime, setAptTime] = useState<string>("09:30");
  const [aptReason, setAptReason] = useState<string>(
    "Consultation de suivi cardiologique, révision de l'ordonnance et contrôle tensionnel"
  );
  const [aptBookingNotice, setAptBookingNotice] = useState<string | null>(null);

  const handleBookAppointment = (e: React.FormEvent) => {
    e.preventDefault();
    const doc =
      AVAILABLE_DOCTORS_FOR_BOOKING.find((d) => d.id === selectedDoctorId) ||
      AVAILABLE_DOCTORS_FOR_BOOKING[0];

    const created = clinicalBookletStore.bookAppointment({
      patientId: credential.user.id || "usr-alex-mensah",
      patientName: credential.user.name,
      patientDid: credential.did,
      patientPublicKey: credential.publicKeyHex,
      doctorId: doc.id,
      doctorName: doc.name,
      doctorSpecialty: doc.specialty,
      hospitalId: doc.hospitalId,
      hospitalName: doc.hospitalName,
      date: aptDate,
      time: aptTime,
      reason: aptReason,
    });

    setAptBookingNotice(
      `✅ Rendez-vous réservé (${created.id}) pour le ${created.date} à ${created.time} avec ${created.doctorName} (${created.hospitalName}). En attente d'acceptation par le médecin dans son Espace Praticien.`
    );
    setTimeout(() => setAptBookingNotice(null), 6000);
  };

  // Consent Management State
  const [accessRequests, setAccessRequests] = useState<AccessRequestItem[]>(INITIAL_ACCESS_REQUESTS);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(INITIAL_AUDIT_LOGS);
  const [consentActionNotice, setConsentActionNotice] = useState<string | null>(null);

  // Role & Hospital connection checks
  const hasDoctorRole = availableRoles.includes("DOCTOR");
  const hasHospitalRole =
    availableRoles.includes("HOSPITAL_STAFF") ||
    availableRoles.includes("ADMIN") ||
    availableRoles.includes("HOSPITAL_ADMIN");
  const hasSysAdminRole = availableRoles.includes("SYSTEM_ADMIN");
  const canSwitchPortal = hasDoctorRole || hasHospitalRole || hasSysAdminRole;

  const handleApproveConsent = async (reqId: string) => {
    const approvedReq = accessRequests.find((r) => r.id === reqId);
    if (!approvedReq) return;

    setConsentActionNotice(
      `⏳ Signature ECDSA P-256 (Raw 64B X||Y) et envoi de APPROVE_CONSENT vers le Transaction Pool -> Consensus PBFT -> C++ AccessManager...`
    );

    const onChainState = await submitPatientConsentToBlockchain({
      consentId: reqId,
      patientId: credential.user.id || "usr-alex-mensah-2026",
      doctorId: approvedReq.doctorId || "doc-martin",
      doctorName: approvedReq.doctorName,
      hospitalId: approvedReq.hospitalId || "hosp-yaounde-central",
      scope: "FullClinicalRecordAccess",
      consentAction: "APPROVE_CONSENT",
    });

    setAccessRequests((prev) =>
      prev.map((r) =>
        r.id === reqId
          ? {
              ...r,
              status: "APPROVED",
              approvedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + r.durationHours * 3600000).toISOString(),
              blockchainTxHash: onChainState.txHash,
              digitalSignature: `${onChainState.txHash.slice(0, 18)}... (ECDSA P-256 Raw X||Y Verified in C++ Core)`,
            }
          : r
      )
    );

    const newAudit: AuditLogEntry = {
      id: `AUD-${Date.now().toString().slice(-4)}`,
      timestamp: new Date().toLocaleTimeString(),
      patientName: credential.user.name,
      actorName: credential.user.name,
      actorRole: "PATIENT",
      action: "APPROVE_CONSENT",
      resource: `Granted ${approvedReq.doctorName} access for ${approvedReq.durationHours}h (C++ AccessManager PERMISSION #${onChainState.blockHeight})`,
      blockchainTxHash: onChainState.txHash,
      blockNumber: onChainState.blockHeight,
      digitalSignature: `${onChainState.txHash.slice(0, 14)}... (Signed with Patient Trusted Zone ECDSA P-256)`,
    };
    setAuditLogs((prev) => [newAudit, ...prev]);

    setConsentActionNotice(
      `✅ Consentement APPROVE_CONSENT validé par Consensus PBFT (Bloc #${onChainState.blockHeight}, Tx ${onChainState.txHash.slice(0, 14)}...) et activé dans C++ AccessManager pour ${approvedReq.doctorName} !`
    );
    setTimeout(() => setConsentActionNotice(null), 5000);
  };

  const handleRevokeConsent = async (reqId: string) => {
    const revokedReq = accessRequests.find((r) => r.id === reqId);
    if (!revokedReq) return;

    setConsentActionNotice(
      `⏳ Signature ECDSA P-256 et envoi de REVOKE_CONSENT vers le Transaction Pool -> Consensus PBFT -> C++ AccessManager...`
    );

    const onChainState = await submitPatientConsentToBlockchain({
      consentId: reqId,
      patientId: credential.user.id || "usr-alex-mensah-2026",
      doctorId: revokedReq.doctorId || "doc-martin",
      doctorName: revokedReq.doctorName,
      hospitalId: revokedReq.hospitalId || "hosp-yaounde-central",
      scope: "REVOKED",
      consentAction: "REVOKE_CONSENT",
    });

    setAccessRequests((prev) =>
      prev.map((r) =>
        r.id === reqId
          ? {
              ...r,
              status: "REVOKED",
              blockchainTxHash: onChainState.txHash,
            }
          : r
      )
    );

    const newAudit: AuditLogEntry = {
      id: `AUD-${Date.now().toString().slice(-4)}`,
      timestamp: new Date().toLocaleTimeString(),
      patientName: credential.user.name,
      actorName: credential.user.name,
      actorRole: "PATIENT",
      action: "REVOKE_CONSENT",
      resource: `Revoked access from ${revokedReq.doctorName} on-chain (KMS Proxy Re-Encryption blocked at Block #${onChainState.blockHeight})`,
      blockchainTxHash: onChainState.txHash,
      blockNumber: onChainState.blockHeight,
      digitalSignature: `${onChainState.txHash.slice(0, 14)}... (Signed with Patient Trusted Zone ECDSA P-256)`,
    };
    setAuditLogs((prev) => [newAudit, ...prev]);

    setConsentActionNotice(
      `⛔ Consentement REVOKE_CONSENT engagé sur la Blockchain (Bloc #${onChainState.blockHeight}, Tx ${onChainState.txHash.slice(0, 14)}...). C++ AccessManager et le Quorum KMS 3-sur-4 refusent désormais tout Re-Chiffrement Proxy pour ${revokedReq.doctorName}.`
    );
    setTimeout(() => setConsentActionNotice(null), 5500);
  };

  return (
    <div className="flex h-screen bg-[#F4F5F7] font-sans antialiased text-zinc-900 overflow-hidden">
      {/* LEFT SIDEBAR */}
      <aside
        className={`${
          sidebarOpen ? "w-64" : "w-20"
        } transition-all duration-300 bg-transparent flex flex-col shrink-0 p-4 select-none`}
      >
        {/* Brand Logo matching screenshot */}
        <div className="flex items-center gap-3 px-3 py-3 mb-4">
          <div className="flex items-center text-zinc-900">
            <svg
              className="w-6 h-6 stroke-[2.2]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </div>
          {sidebarOpen && (
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-[17px] tracking-tight text-zinc-900">Pulse Clinic</span>
            </div>
          )}
        </div>

        {/* PORTAL SWITCHER: ONLY appears if you have a role connected to a hospital or system admin */}
        {sidebarOpen && canSwitchPortal && (
          <div className="mb-4 px-2 animate-in fade-in duration-200">
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">
              Portal Workspace
            </label>
            <div className="flex flex-col gap-1 bg-white p-1.5 rounded-2xl border border-zinc-200/90 shadow-2xs">
              <button
                disabled
                className="text-left px-3 py-1.5 text-xs font-bold text-zinc-900 bg-zinc-100 rounded-xl flex items-center justify-between"
              >
                <span>Patient Portal</span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              </button>

              {hasDoctorRole && (
                <button
                  onClick={() => onSwitchPortal("doctor")}
                  className="text-left px-3 py-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 rounded-xl transition-all flex items-center justify-between"
                >
                  <span>Doctor Portal</span>
                  <span className="text-[9px] bg-emerald-100 text-emerald-800 font-semibold px-1 rounded">Affiliated</span>
                </button>
              )}

              {hasHospitalRole && (
                <button
                  onClick={() => onSwitchPortal("hospital")}
                  className="text-left px-3 py-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 rounded-xl transition-all flex items-center justify-between"
                >
                  <span>Hospital Manager</span>
                  <span className="text-[9px] bg-blue-100 text-blue-800 font-semibold px-1 rounded">Tenant</span>
                </button>
              )}

              {hasSysAdminRole && (
                <button
                  onClick={() => onSwitchPortal("sysadmin")}
                  className="text-left px-3 py-1.5 text-xs font-medium text-purple-700 hover:text-purple-900 hover:bg-purple-50 rounded-xl transition-all flex items-center justify-between"
                >
                  <span>System Admin</span>
                  <span className="text-[9px] bg-purple-100 text-purple-800 font-semibold px-1 rounded">Platform</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Navigation Categories */}
        <div className="flex-1 overflow-y-auto space-y-5 pr-1 custom-scrollbar text-xs">
          {/* OVERVIEW */}
          <div>
            {sidebarOpen && (
              <h4 className="px-3 text-[10px] font-bold tracking-wider text-zinc-400 uppercase mb-2">
                Overview
              </h4>
            )}
            <nav className="space-y-0.5">
              <button
                type="button"
                onClick={() => setActiveNav("My health")}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
                  activeNav === "My health"
                    ? "bg-white text-zinc-900 shadow-xs font-semibold"
                    : "text-zinc-600 hover:text-zinc-900 hover:bg-black/5"
                }`}
              >
                <Heart className="w-4 h-4 shrink-0 text-zinc-500" />
                {sidebarOpen && <span>My health</span>}
              </button>
            </nav>
          </div>

          {/* MY CARE */}
          <div>
            {sidebarOpen && (
              <h4 className="px-3 text-[10px] font-bold tracking-wider text-zinc-400 uppercase mb-2">
                My Care
              </h4>
            )}
            <nav className="space-y-0.5">
              {[
                { name: "Appointments", icon: Calendar },
                { name: "Health record", icon: Activity },
                { name: "Medication", icon: Pill },
                { name: "Test results", icon: FlaskConical },
                { name: "Vaccinations", icon: Syringe },
                { name: "Consent & Privacy", icon: ShieldCheck, badge: accessRequests.filter(r => r.status === "PENDING").length },
              ].map((item) => {
                const Icon = item.icon;
                const isActive = activeNav === item.name;
                return (
                  <button
                    type="button"
                    key={item.name}
                    onClick={() => setActiveNav(item.name)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-all ${
                      isActive
                        ? "bg-white text-zinc-900 shadow-xs font-semibold"
                        : "text-zinc-600 hover:text-zinc-900 hover:bg-black/5"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Icon
                        className={`w-4 h-4 shrink-0 ${
                          isActive ? "text-zinc-900 stroke-[2.2]" : "text-zinc-500"
                        }`}
                      />
                      {sidebarOpen && <span>{item.name}</span>}
                    </div>
                    {sidebarOpen && item.badge && item.badge > 0 ? (
                      <span className="w-4 h-4 rounded-full bg-amber-500 text-white text-[9px] font-bold flex items-center justify-center">
                        {item.badge}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* ACCOUNT */}
          <div>
            {sidebarOpen && (
              <h4 className="px-3 text-[10px] font-bold tracking-wider text-zinc-400 uppercase mb-2">
                Account
              </h4>
            )}
            <nav className="space-y-0.5">
              <button
                type="button"
                onClick={() => setActiveNav("Role Delegations")}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-colors ${
                  activeNav === "Role Delegations"
                    ? "bg-white text-zinc-900 shadow-xs font-semibold"
                    : "text-zinc-600 hover:text-zinc-900 hover:bg-black/5"
                }`}
              >
                <div className="flex items-center gap-3">
                  <UserPlus className="w-4 h-4 shrink-0 text-zinc-500" />
                  {sidebarOpen && <span>Hospital Roles</span>}
                </div>
                {sidebarOpen && pendingRoleInvitations.length > 0 && (
                  <span className="w-4 h-4 rounded-full bg-emerald-600 text-white text-[9px] font-bold flex items-center justify-center">
                    {pendingRoleInvitations.length}
                  </span>
                )}
              </button>
            </nav>
          </div>
        </div>

        {/* BOTTOM USER / WEBAUTHN BADGE */}
        <div className="pt-3 border-t border-zinc-200/70">
          <div
            onClick={() => setIsKeyDrawerOpen(true)}
            className="p-2.5 rounded-2xl bg-white border border-zinc-200/90 shadow-2xs hover:border-zinc-400 cursor-pointer transition-all flex items-center gap-2.5"
            title="Inspect WebAuthn Key & Blockchain Identity"
          >
            <div className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </div>
            {sidebarOpen && (
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-zinc-900 truncate">{credential.user.name}</p>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                </div>
                <p className="text-[10px] text-zinc-400 font-mono truncate">{credential.did}</p>
              </div>
            )}
          </div>

          {sidebarOpen && (
            <div className="flex items-center justify-between mt-2 px-1 text-[11px] text-zinc-500">
              <button
                onClick={() => setIsKeyDrawerOpen(true)}
                className="hover:text-zinc-900 flex items-center gap-1 font-medium"
              >
                <Key className="w-3 h-3 text-zinc-400" />
                Inspect Key
              </button>
              <button
                onClick={onSignOut}
                className="hover:text-red-600 flex items-center gap-1 font-medium transition-colors"
              >
                <LogOut className="w-3 h-3" />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* MAIN CONTAINER */}
      <main className="flex-1 flex flex-col min-w-0 h-screen p-4 pl-0">
        <div className="flex-1 bg-white rounded-3xl border border-zinc-200 shadow-sm flex flex-col overflow-hidden">
          {/* TOP HEADER BAR */}
          <header className="h-16 px-8 border-b border-zinc-100 flex items-center justify-between shrink-0 bg-white">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="text-zinc-400 hover:text-zinc-800 transition-colors p-1.5 rounded-lg hover:bg-zinc-100"
                title="Toggle Sidebar"
              >
                <Menu className="w-4 h-4" />
              </button>

              {/* Breadcrumb matching design */}
              <div className="flex items-center gap-2 text-xs font-medium">
                <span className="text-zinc-400 uppercase tracking-wider text-[11px] font-semibold">
                  My Care
                </span>
                <span className="text-zinc-300">›</span>
                <span className="text-zinc-900 font-semibold">{activeNav}</span>
              </div>
            </div>

            {/* Right side controls */}
            <div className="flex items-center gap-3">
              {/* Search Bar */}
              <div className="relative">
                <div className="flex items-center bg-zinc-50 border border-zinc-200/80 rounded-xl px-3 py-1.5 gap-2 w-56 focus-within:w-72 focus-within:border-zinc-400 transition-all">
                  <Search className="w-3.5 h-3.5 text-zinc-400" />
                  <input
                    type="text"
                    placeholder="Go to..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="bg-transparent text-xs w-full focus:outline-none placeholder:text-zinc-400"
                  />
                  <kbd className="text-[10px] bg-white border border-zinc-200 text-zinc-400 px-1.5 py-0.5 rounded font-mono">
                    ⌘K
                  </kbd>
                </div>
              </div>

              {/* Notification Bell */}
              <button
                type="button"
                onClick={() => setShowNotificationToast(!showNotificationToast)}
                className="relative p-2 rounded-xl text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"
                title="3 Notifications"
              >
                <Bell className="w-4 h-4" />
                <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center border-2 border-white">
                  3
                </span>
              </button>

              {/* WebAuthn Key status badge */}
              <button
                type="button"
                onClick={() => setIsKeyDrawerOpen(true)}
                className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl border border-emerald-200 bg-emerald-50/70 hover:bg-emerald-100/70 text-emerald-800 text-xs font-medium transition-colors"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>Patient Master Key (Enclave)</span>
              </button>
            </div>
          </header>

          {/* MAIN SCROLLABLE CONTENT */}
          <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar bg-white">
            {/* VIEW 2: GESTION DU CONSENTEMENT (BLOCKCHAIN CORE) */}
            {activeNav === "Consent & Privacy" && (
              <div className="space-y-6">
                <div>
                  <span className="text-[11px] font-bold tracking-wider text-zinc-400 uppercase">
                    Blockchain Access Control
                  </span>
                  <h1 className="text-3xl font-extrabold text-zinc-900 tracking-tight mt-0.5">
                    Consent Management
                  </h1>
                  <p className="text-xs text-zinc-500 mt-1">
                    You hold sovereign control over your medical booklet. Approve or instantly revoke temporary doctor
                    access at any time.
                  </p>
                </div>

                {consentActionNotice && (
                  <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{consentActionNotice}</span>
                  </div>
                )}

                {/* Active and Pending Requests */}
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-zinc-900">Doctor Access Requests</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {accessRequests.map((req) => (
                      <div
                        key={req.id}
                        className="bg-white rounded-2xl border border-zinc-200 p-5 space-y-3.5 shadow-2xs"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <div className="w-9 h-9 rounded-xl bg-zinc-900 text-white flex items-center justify-center font-bold text-xs">
                              <Stethoscope className="w-4 h-4 text-emerald-400" />
                            </div>
                            <div>
                              <h4 className="font-bold text-xs text-zinc-900">{req.doctorName}</h4>
                              <p className="text-[11px] text-zinc-500">{req.doctorDepartment}</p>
                            </div>
                          </div>

                          {req.status === "APPROVED" && (
                            <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full">
                              ● Active ({req.durationHours}h)
                            </span>
                          )}
                          {req.status === "PENDING" && (
                            <span className="text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
                              ● Pending Consent
                            </span>
                          )}
                          {req.status === "REVOKED" && (
                            <span className="text-[10px] font-semibold bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 rounded-full">
                              ● Revoked
                            </span>
                          )}
                        </div>

                        <div className="text-xs space-y-1 bg-zinc-50 p-3 rounded-xl border border-zinc-200/70">
                          <span className="text-[10px] uppercase font-bold text-zinc-400 block">Requested Purpose</span>
                          <p className="text-zinc-700 font-medium">{req.purpose}</p>
                          <p className="text-[10px] text-zinc-400 font-mono pt-1">Doctor DID: {req.doctorDid}</p>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 pt-1">
                          {req.status === "PENDING" && (
                            <>
                              <button
                                onClick={() => handleApproveConsent(req.id)}
                                className="flex-1 py-2 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-xs"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                Approve with WebAuthn Key
                              </button>
                              <button
                                onClick={() => handleRevokeConsent(req.id)}
                                className="px-3 py-2 border border-zinc-200 text-zinc-600 hover:text-red-600 rounded-xl text-xs font-medium"
                              >
                                Reject
                              </button>
                            </>
                          )}

                          {req.status === "APPROVED" && (
                            <button
                              onClick={() => handleRevokeConsent(req.id)}
                              className="w-full py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                            >
                              <Lock className="w-3.5 h-3.5" />
                              Revoke Access Immediately
                            </button>
                          )}

                          {req.status === "REVOKED" && (
                            <p className="text-[11px] text-zinc-400 italic text-center w-full">
                              Access terminated before expiration. Blockchain revoke event logged.
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Immutable Access Audit History */}
                <div className="bg-white rounded-2xl border border-zinc-200 p-6 space-y-4 shadow-2xs">
                  <div>
                    <h3 className="text-sm font-bold text-zinc-900">Immutable Access Audit Trail</h3>
                    <p className="text-xs text-zinc-500">
                      Every time a practitioner or clinic queries your booklet, an indelible cryptographic proof is
                      recorded on the blockchain ledger.
                    </p>
                  </div>

                  <div className="divide-y divide-zinc-100 text-xs">
                    {auditLogs.map((log) => (
                      <div key={log.id} className="py-3 flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-zinc-900">{log.action}</span>
                            <span className="text-zinc-400 text-[10px]">by {log.actorName}</span>
                          </div>
                          <p className="text-zinc-600 text-[11px]">{log.resource}</p>
                          <p className="text-zinc-400 font-mono text-[10px]">{log.digitalSignature}</p>
                        </div>
                        <div className="text-right">
                          <span className="font-mono text-zinc-500 text-[10px] block">{log.timestamp}</span>
                          <span className="font-mono text-[10px] text-emerald-700">
                            Tx: {log.blockchainTxHash.slice(0, 10)}...
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* VIEW 3: ROLE INVITATIONS & DELEGATED KEYS */}
            {activeNav === "Role Delegations" && (
              <div className="space-y-6">
                <div>
                  <span className="text-[11px] font-bold tracking-wider text-zinc-400 uppercase">
                    Hospital Staff Affiliations
                  </span>
                  <h1 className="text-3xl font-extrabold text-zinc-900 tracking-tight mt-0.5">
                    Hospital Role Delegations
                  </h1>
                  <p className="text-xs text-zinc-500 mt-1">
                    When an authorized hospital invites you to join as a Doctor or Staff member, accept the invite to
                    derive and mint your role-specific public/private keypair.
                  </p>
                </div>

                {/* Invitations List */}
                {pendingRoleInvitations.length > 0 ? (
                  <div className="space-y-3">
                    {pendingRoleInvitations.map((inv) => (
                      <div
                        key={inv.id}
                        className="bg-white rounded-2xl border-2 border-emerald-500/50 p-6 space-y-4 shadow-sm"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
                              <Building2 className="w-5 h-5 text-emerald-700" />
                            </div>
                            <div>
                              <h4 className="font-bold text-sm text-zinc-900">{inv.hospitalName}</h4>
                              <p className="text-xs text-zinc-500">
                                Invitation to join as <strong className="text-emerald-700">{inv.role}</strong> (
                                {inv.department})
                              </p>
                            </div>
                          </div>
                          <span className="text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-full">
                            Pending Your Approval
                          </span>
                        </div>

                        <div className="p-3 bg-zinc-50 rounded-xl text-xs text-zinc-600 leading-relaxed border border-zinc-200/70">
                          Approving this delegation will generate a new public key pair from your master identity
                          specifically bound to <strong>{inv.role}</strong> and register it with the hospital on-chain
                          registry.
                        </div>

                        <div className="flex gap-3">
                          <button
                            onClick={() => onApproveRoleInvitation(inv.id, inv.role, inv.department)}
                            className="flex-1 py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2 shadow-sm transition-colors"
                          >
                            <Key className="w-4 h-4 text-emerald-400" />
                            <span>Approve & Mint {inv.role} Keypair</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-zinc-50 rounded-2xl border border-zinc-200 p-8 text-center space-y-2">
                    <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
                    <h4 className="font-bold text-sm text-zinc-900">
                      {canSwitchPortal ? "Hospital Role Delegations Active" : "Universal Patient Identity"}
                    </h4>
                    <p className="text-xs text-zinc-500 max-w-sm mx-auto">
                      {canSwitchPortal
                        ? `You are currently active with: ${availableRoles.join(", ")}. The portal switcher is active in the top bar and sidebar.`
                        : "You are currently active with standard PATIENT privileges. Once invited and delegated by an authorized hospital, your doctor or staff keypair will activate and unlock the portal switcher."}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* VIEW 4: MY HEALTH OVERVIEW (END-TO-END MEDICAL BOOKLET DASHBOARD) */}
            {activeNav === "My health" && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <span className="text-[11px] font-bold tracking-wider text-zinc-400 uppercase">
                      Carnet Médical Électronique Chiffré de Bout en Bout (E2E)
                    </span>
                    <h1 className="text-3xl font-extrabold text-zinc-900 tracking-tight mt-0.5">
                      My Health Booklet
                    </h1>
                    <p className="text-xs text-zinc-500 mt-1">
                      Tous vos dossiers de santé, ordonnances, résultats de laboratoire et vaccinations sont chiffrés avec votre <strong>Clé Publique Patient</strong> avant de quitter le portail vers le 1er Client Node.
                    </p>
                  </div>

                  <div className="bg-emerald-50 border border-emerald-200 px-3.5 py-2 rounded-2xl text-xs text-emerald-900 flex items-center gap-2">
                    <Lock className="w-4 h-4 text-emerald-600 shrink-0" />
                    <div>
                      <span className="font-bold block">Déchiffrement Local Actif (Clé Privée Patient)</span>
                      <span className="text-[10px] font-mono text-emerald-700">
                        PubKey: {credential.publicKeyHex.slice(0, 22)}...
                      </span>
                    </div>
                  </div>
                </div>

                {/* 5 Summary Cards across the E2E Clinical Modules */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                  <button
                    type="button"
                    onClick={() => setActiveNav("Appointments")}
                    className="bg-white hover:bg-zinc-50/80 transition-all text-left p-4 rounded-2xl border border-zinc-200 shadow-2xs space-y-2 cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      <Calendar className="w-5 h-5 text-emerald-600" />
                      <span className="text-[10px] font-bold bg-emerald-50 text-emerald-800 px-2 py-0.5 rounded-full">
                        {bookletState.appointments.filter((a) => a.status === "ACCEPTED").length} Acceptés
                      </span>
                    </div>
                    <div className="text-2xl font-extrabold text-zinc-900">
                      {bookletState.appointments.length}
                    </div>
                    <div className="text-xs font-bold text-zinc-700">Appointments →</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveNav("Health record")}
                    className="bg-white hover:bg-zinc-50/80 transition-all text-left p-4 rounded-2xl border border-zinc-200 shadow-2xs space-y-2 cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      <Activity className="w-5 h-5 text-emerald-600" />
                      <span className="text-[10px] font-mono font-bold bg-zinc-900 text-emerald-400 px-2 py-0.5 rounded">
                        ON-CHAIN
                      </span>
                    </div>
                    <div className="text-2xl font-extrabold text-zinc-900">
                      {bookletState.healthRecords.length}
                    </div>
                    <div className="text-xs font-bold text-zinc-700">Health Record (Diag + Rx) →</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveNav("Medication")}
                    className="bg-white hover:bg-zinc-50/80 transition-all text-left p-4 rounded-2xl border border-zinc-200 shadow-2xs space-y-2 cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      <Pill className="w-5 h-5 text-purple-600" />
                      <span className="text-[10px] font-mono font-bold bg-zinc-900 text-emerald-400 px-2 py-0.5 rounded">
                        ON-CHAIN
                      </span>
                    </div>
                    <div className="text-2xl font-extrabold text-zinc-900">
                      {bookletState.prescriptions.length}
                    </div>
                    <div className="text-xs font-bold text-zinc-700">Medication / Prescriptions →</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveNav("Test results")}
                    className="bg-white hover:bg-zinc-50/80 transition-all text-left p-4 rounded-2xl border border-zinc-200 shadow-2xs space-y-2 cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      <FlaskConical className="w-5 h-5 text-amber-600" />
                      <span className="text-[10px] font-mono font-bold bg-zinc-900 text-emerald-400 px-2 py-0.5 rounded">
                        HOSPITAL KEY
                      </span>
                    </div>
                    <div className="text-2xl font-extrabold text-zinc-900">
                      {bookletState.labTestResults.length}
                    </div>
                    <div className="text-xs font-bold text-zinc-700">Test Results →</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveNav("Vaccinations")}
                    className="bg-white hover:bg-zinc-50/80 transition-all text-left p-4 rounded-2xl border border-zinc-200 shadow-2xs space-y-2 cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      <Syringe className="w-5 h-5 text-blue-600" />
                      <span className="text-[10px] font-mono font-bold bg-zinc-900 text-emerald-400 px-2 py-0.5 rounded">
                        VAX KEY
                      </span>
                    </div>
                    <div className="text-2xl font-extrabold text-zinc-900">
                      {bookletState.vaccinations.length}
                    </div>
                    <div className="text-xs font-bold text-zinc-700">Vaccinations →</div>
                  </button>
                </div>

                {/* Recent Longitudinal Activity */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="bg-white rounded-2xl border border-zinc-200 p-5 space-y-3 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-sm text-zinc-900">
                        Derniers Diagnostics & Ordonnances (Carnet de Santé On-Chain)
                      </h3>
                      <button
                        type="button"
                        onClick={() => setActiveNav("Health record")}
                        className="text-xs font-bold text-emerald-700 hover:underline"
                      >
                        Voir tout →
                      </button>
                    </div>
                    <div className="space-y-2.5">
                      {bookletState.healthRecords.slice(0, 3).map((hr) => (
                        <div
                          key={hr.id}
                          className="p-3.5 rounded-xl border border-zinc-200 bg-zinc-50/50 text-xs space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-zinc-900">{hr.diagnosis}</span>
                            <span className="text-[10px] font-mono text-zinc-400">{hr.date}</span>
                          </div>
                          <p className="text-[11px] text-zinc-600 line-clamp-2">{hr.clinicalNotes}</p>
                          <div className="text-[10px] font-mono text-emerald-700 pt-1 flex items-center justify-between">
                            <span>Signé par {hr.doctorName}</span>
                            <span>Bloc #{hr.cryptoProof.blockHeight}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl border border-zinc-200 p-5 space-y-3 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-sm text-zinc-900">
                        Derniers Résultats Labo (Hôpital) & Vaccinations
                      </h3>
                      <button
                        type="button"
                        onClick={() => setActiveNav("Test results")}
                        className="text-xs font-bold text-emerald-700 hover:underline"
                      >
                        Voir tout →
                      </button>
                    </div>
                    <div className="space-y-2.5">
                      {bookletState.labTestResults.slice(0, 2).map((lr) => (
                        <div
                          key={lr.id}
                          className="p-3.5 rounded-xl border border-zinc-200 bg-zinc-50/50 text-xs space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-zinc-900">{lr.testName}</span>
                            <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                              {lr.interpretationFlag}
                            </span>
                          </div>
                          <p className="text-[11px] font-mono text-zinc-700">
                            {lr.resultValue} ({lr.unit})
                          </p>
                          <div className="text-[10px] font-mono text-blue-700 pt-1 flex items-center justify-between">
                            <span>Signé Clé Privée Hôpital ({lr.hospitalName})</span>
                            <span>Bloc #{lr.cryptoProof.blockHeight}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* VIEW 5: APPOINTMENTS (BOOK FOR A PARTICULAR DAY & SPECIFIC DOCTOR -> DOCTOR ACCEPTS) */}
            {activeNav === "Appointments" && (
              <div className="space-y-6">
                <div>
                  <span className="text-[11px] font-bold tracking-wider text-zinc-400 uppercase">
                    Planification Médicale
                  </span>
                  <h1 className="text-3xl font-extrabold text-zinc-900 tracking-tight mt-0.5">
                    Appointments
                  </h1>
                  <p className="text-xs text-zinc-500 mt-1">
                    Réservez un rendez-vous pour un jour précis avec un médecin spécifique. Le médecin reçoit la demande dans son Espace Praticien et l'accepte.
                  </p>
                </div>

                {aptBookingNotice && (
                  <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center gap-2.5 animate-in fade-in">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span className="font-medium">{aptBookingNotice}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                  {/* Left: Book Appointment Form (5 cols) */}
                  <div className="lg:col-span-5 bg-zinc-50/70 rounded-2xl border border-zinc-200 p-6 space-y-4 shadow-2xs">
                    <div className="flex items-center gap-2 text-zinc-900 font-bold text-sm">
                      <Calendar className="w-4 h-4 text-emerald-600" />
                      <h3>Prendre un Rendez-vous avec un Médecin</h3>
                    </div>

                    <form onSubmit={handleBookAppointment} className="space-y-4 text-xs">
                      <div>
                        <label className="font-semibold text-zinc-700 block mb-1">
                          Choisir un Médecin Spécifique & Établissement
                        </label>
                        <select
                          value={selectedDoctorId}
                          onChange={(e) => setSelectedDoctorId(e.target.value)}
                          className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 bg-white font-semibold text-xs"
                        >
                          {AVAILABLE_DOCTORS_FOR_BOOKING.map((doc) => (
                            <option key={doc.id} value={doc.id}>
                              {doc.name} — {doc.specialty} ({doc.hospitalName})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="font-semibold text-zinc-700 block mb-1">
                            Jour du Rendez-vous
                          </label>
                          <input
                            type="date"
                            value={aptDate}
                            onChange={(e) => setAptDate(e.target.value)}
                            className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs font-semibold"
                            required
                          />
                        </div>
                        <div>
                          <label className="font-semibold text-zinc-700 block mb-1">
                            Heure Souhaitée
                          </label>
                          <input
                            type="time"
                            value={aptTime}
                            onChange={(e) => setAptTime(e.target.value)}
                            className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs font-semibold"
                            required
                          />
                        </div>
                      </div>

                      <div>
                        <label className="font-semibold text-zinc-700 block mb-1">
                          Motif de la Consultation
                        </label>
                        <textarea
                          rows={3}
                          value={aptReason}
                          onChange={(e) => setAptReason(e.target.value)}
                          placeholder="Décrivez vos symptômes ou le motif du rendez-vous..."
                          className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs"
                          required
                        />
                      </div>

                      <button
                        type="submit"
                        className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl font-semibold text-xs flex items-center justify-center gap-2 shadow-xs cursor-pointer"
                      >
                        <Plus className="w-4 h-4 text-emerald-400" />
                        <span>Confirmer la Demande de Rendez-vous</span>
                      </button>
                    </form>
                  </div>

                  {/* Right: Appointments List & Doctor Acceptance Status (7 cols) */}
                  <div className="lg:col-span-7 bg-white rounded-2xl border border-zinc-200 p-6 space-y-4 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-sm text-zinc-900">
                        Mes Rendez-vous Programmés ({bookletState.appointments.length})
                      </h3>
                      <span className="text-[11px] text-zinc-500">
                        Synchronisé en temps réel avec le Portail Médecin
                      </span>
                    </div>

                    <div className="space-y-3">
                      {bookletState.appointments.map((apt) => (
                        <div
                          key={apt.id}
                          className={`p-4 rounded-2xl border text-xs space-y-2.5 ${
                            apt.status === "ACCEPTED"
                              ? "border-emerald-200 bg-emerald-50/30"
                              : "border-amber-200 bg-amber-50/30"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <span className="font-bold text-zinc-900 text-sm block">
                                {apt.doctorName}
                              </span>
                              <span className="text-[11px] text-zinc-500">
                                {apt.doctorSpecialty} • <strong>{apt.hospitalName}</strong>
                              </span>
                            </div>
                            <span
                              className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                                apt.status === "ACCEPTED"
                                  ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                                  : "bg-amber-100 text-amber-800 border border-amber-300"
                              }`}
                            >
                              {apt.status === "ACCEPTED"
                                ? "✓ Accepté par le Médecin"
                                : "⏳ En attente d'acceptation du Médecin"}
                            </span>
                          </div>

                          <div className="flex items-center gap-4 bg-white px-3 py-2 rounded-xl border border-zinc-200/80 text-xs font-semibold text-zinc-800">
                            <span className="flex items-center gap-1.5 text-emerald-700">
                              <Calendar className="w-3.5 h-3.5" />
                              Date : {apt.date}
                            </span>
                            <span>•</span>
                            <span className="flex items-center gap-1.5">
                              <Clock className="w-3.5 h-3.5 text-zinc-400" />
                              Heure : {apt.time}
                            </span>
                          </div>

                          <p className="text-zinc-600 text-xs">
                            <strong className="text-zinc-800">Motif :</strong> {apt.reason}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* VIEW 6: HEALTH RECORD (ON-CHAIN: INCLUDES BOTH DOCTOR DIAGNOSES AND PRESCRIPTIONS) */}
            {activeNav === "Health record" && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <span className="text-[11px] font-bold tracking-wider text-zinc-400 uppercase">
                      Carnet de Santé Longitudinal (Blockchain + Chiffrement Clé Publique Patient)
                    </span>
                    <h1 className="text-3xl font-extrabold text-zinc-900 tracking-tight mt-0.5">
                      Health Record
                    </h1>
                    <p className="text-xs text-zinc-500 mt-1">
                      Regroupe les <strong>Diagnostics Médicaux</strong> ainsi que toutes les <strong>Ordonnances / Prescriptions</strong>. Avant l'envoi au 1er Client Node, l'enregistrement est <strong>sauvegardé temporairement</strong>, passe par le <strong>Transaction Pool</strong>, la <strong>Proposition de Bloc</strong>, le <strong>Consensus & Validation des Nœuds Validateurs</strong>, puis l'écriture dans les <strong>BD On-Chain et Off-Chain</strong> avant mise à jour en <strong>Sauvegarde Permanente</strong>.
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  {bookletState.healthRecords.map((rec) => {
                    const isTemp =
                      rec.cryptoProof.persistenceStatus === "TEMPORARY_PENDING_CONSENSUS";
                    return (
                      <div
                        key={rec.id}
                        className={`bg-white rounded-2xl border p-6 space-y-4 shadow-2xs transition-all ${
                          isTemp
                            ? "border-amber-300 bg-amber-50/15"
                            : "border-zinc-200"
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                                  rec.recordSubType === "PRESCRIPTION_ENTRY"
                                    ? "bg-purple-100 text-purple-800 border border-purple-200"
                                    : "bg-emerald-100 text-emerald-800 border border-emerald-200"
                                }`}
                              >
                                {rec.recordSubType === "PRESCRIPTION_ENTRY"
                                  ? "Ordonnance Médicale (Entrée Carnet de Santé)"
                                  : "Diagnostic & Consultation Médicale"}
                              </span>
                              <span
                                className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                                  isTemp
                                    ? "bg-amber-100 text-amber-900 border border-amber-300 animate-pulse"
                                    : "bg-emerald-50 text-emerald-800 border border-emerald-200"
                                }`}
                              >
                                {isTemp
                                  ? "⏳ TEMPORAIRE — En cours de Consensus (Tx Pool -> Bloc -> Validation)"
                                  : "✓ PERMANENT — Validé par Consensus & Enregistré (BD On-Chain + Off-Chain)"}
                              </span>
                              <span className="text-xs font-mono text-zinc-400">{rec.id}</span>
                            </div>
                            <h3 className="text-base font-bold text-zinc-900">{rec.diagnosis}</h3>
                            <p className="text-xs text-zinc-500">
                              Médecin Signataire : <strong className="text-zinc-800">{rec.doctorName}</strong> ({rec.department}) •{" "}
                              <span className="font-semibold text-zinc-700">{rec.hospitalName}</span>
                            </p>
                          </div>

                          <div className="text-right text-xs">
                            <span className="font-bold text-zinc-900 block">{rec.date}</span>
                            <span className="text-[10px] font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 inline-block mt-1">
                              Déchiffré E2E (Clé Patient)
                            </span>
                          </div>
                        </div>

                        {rec.cryptoProof.pipelineStage && (
                          <div
                            className={`px-3.5 py-2 rounded-xl border text-[11px] font-mono flex items-center justify-between ${
                              isTemp
                                ? "bg-amber-50 border-amber-200 text-amber-900"
                                : "bg-zinc-900 border-zinc-800 text-emerald-400"
                            }`}
                          >
                            <span>Pipeline : {rec.cryptoProof.pipelineStage}</span>
                            <span className="text-[10px] font-bold">
                              {isTemp ? "PASSAGE TX POOL & CONSENSUS..." : "ON-CHAIN DB + OFF-CHAIN DB OK"}
                            </span>
                          </div>
                        )}

                        {rec.vitals && (
                          <div className="grid grid-cols-3 gap-3 p-3 rounded-xl bg-zinc-50 border border-zinc-200/70 text-xs">
                            <div>
                              <span className="text-zinc-400 text-[10px] block">Tension Artérielle</span>
                              <span className="font-bold text-zinc-900">{rec.vitals.bloodPressure}</span>
                            </div>
                            <div>
                              <span className="text-zinc-400 text-[10px] block">Fréquence Cardiaque</span>
                              <span className="font-bold text-zinc-900">{rec.vitals.heartRate}</span>
                            </div>
                            <div>
                              <span className="text-zinc-400 text-[10px] block">Température</span>
                              <span className="font-bold text-zinc-900">{rec.vitals.temperature}</span>
                            </div>
                          </div>
                        )}

                        <p className="text-xs text-zinc-700 leading-relaxed bg-zinc-50/60 p-3.5 rounded-xl border border-zinc-100">
                          {rec.clinicalNotes}
                        </p>

                        {rec.prescriptions.length > 0 && (
                          <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200 flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2 text-emerald-900">
                              <Pill className="w-4 h-4 text-emerald-600 shrink-0" />
                              <div>
                                <span className="font-bold block">Prescription Associée :</span>
                                <span>{rec.prescriptions.join(" • ")}</span>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => setActiveNav("Medication")}
                              className="text-[11px] font-bold text-emerald-800 underline shrink-0 cursor-pointer"
                            >
                              Voir dans Médicaments →
                            </button>
                          </div>
                        )}

                        <div className="pt-3 border-t border-zinc-100 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-zinc-500">
                          <div className="flex flex-wrap items-center gap-3">
                            <span className="text-emerald-700 font-bold">
                              ✓ Signé par Médecin ({rec.cryptoProof.signerRole})
                            </span>
                            <span>•</span>
                            <span>Gateway: {rec.cryptoProof.firstClientNodeGateway}</span>
                            <span>•</span>
                            <span>
                              {isTemp
                                ? "Bloc en cours de proposition..."
                                : `Bloc #${rec.cryptoProof.blockHeight}`}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setInspectedProof(rec.cryptoProof)}
                            className="text-zinc-900 hover:text-emerald-700 font-sans font-bold underline cursor-pointer"
                          >
                            Vérifier Preuve Blockchain, Consensus & BD →
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* VIEW 7: MEDICATION / PRESCRIPTIONS (ON-CHAIN: SIGNED BY DOCTOR PRIVATE KEY + ENCRYPTED WITH PATIENT PUBLIC KEY) */}
            {activeNav === "Medication" && (
              <div className="space-y-6">
                <div>
                  <span className="text-[11px] font-bold tracking-wider text-zinc-400 uppercase">
                    Ordonnances Médicales Chiffrées E2E & Ancrées sur la Blockchain
                  </span>
                  <h1 className="text-3xl font-extrabold text-zinc-900 tracking-tight mt-0.5">
                    Medication & Prescriptions
                  </h1>
                  <p className="text-xs text-zinc-500 mt-1">
                    Chaque prescription est sauvegardée temporairement avant envoi au 1er Client Node, passe par le <strong>Transaction Pool</strong>, la <strong>Proposition de Bloc</strong> et la <strong>Validation par Consensus</strong>, puis est enregistrée de façon permanente dans les BD On-Chain & Off-Chain.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {bookletState.prescriptions.map((rx) => {
                    const isTemp =
                      rx.cryptoProof.persistenceStatus === "TEMPORARY_PENDING_CONSENSUS";
                    return (
                      <div
                        key={rx.id}
                        className={`bg-white rounded-2xl border p-6 space-y-4 shadow-2xs flex flex-col justify-between ${
                          isTemp ? "border-amber-300 bg-amber-50/15" : "border-zinc-200"
                        }`}
                      >
                        <div className="space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2.5">
                              <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
                                <Pill className="w-5 h-5 text-emerald-700" />
                              </div>
                              <div>
                                <h3 className="font-bold text-base text-zinc-900">
                                  {rx.medicationName} — {rx.dosage}
                                </h3>
                                <span className="text-xs text-zinc-500">
                                  Prescrit par <strong>{rx.doctorName}</strong> ({rx.hospitalName})
                                </span>
                              </div>
                            </div>
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                                isTemp
                                  ? "bg-amber-100 text-amber-900 border border-amber-300 animate-pulse"
                                  : "bg-emerald-100 text-emerald-800 border border-emerald-300"
                              }`}
                            >
                              {isTemp ? "⏳ TEMPORAIRE (Consensus...)" : "✓ PERMANENT (On-Chain + Off-Chain)"}
                            </span>
                          </div>

                          {rx.cryptoProof.pipelineStage && (
                            <div
                              className={`px-3 py-1.5 rounded-xl border text-[10px] font-mono ${
                                isTemp
                                  ? "bg-amber-50 border-amber-200 text-amber-900"
                                  : "bg-zinc-900 border-zinc-800 text-emerald-400"
                              }`}
                            >
                              {rx.cryptoProof.pipelineStage}
                            </div>
                          )}

                          <div className="grid grid-cols-2 gap-2 p-3 rounded-xl bg-zinc-50 border border-zinc-200/80 text-xs">
                            <div>
                              <span className="text-[10px] text-zinc-400 block">Posologie / Fréquence</span>
                              <span className="font-bold text-zinc-900">{rx.frequency}</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-zinc-400 block">Durée</span>
                              <span className="font-bold text-zinc-900">{rx.duration}</span>
                            </div>
                            <div className="col-span-2 pt-1 border-t border-zinc-200/60">
                              <span className="text-[10px] text-zinc-400 block">Contexte Diagnostique</span>
                              <span className="font-semibold text-zinc-800">{rx.diagnosisContext}</span>
                            </div>
                          </div>

                          <p className="text-xs text-zinc-600">
                            <strong>Instructions :</strong> {rx.instructions}
                          </p>
                        </div>

                        <div className="pt-3 border-t border-zinc-100 flex items-center justify-between text-[10px] font-mono text-zinc-500">
                          <span>
                            {isTemp
                              ? "En attente de commit bloc..."
                              : `Bloc #${rx.cryptoProof.blockHeight}`}{" "}
                            • Tx: {rx.cryptoProof.blockchainTxHash.slice(0, 14)}...
                          </span>
                          <button
                            type="button"
                            onClick={() => setInspectedProof(rx.cryptoProof)}
                            className="text-emerald-700 hover:text-emerald-900 font-sans font-bold underline cursor-pointer"
                          >
                            Preuve Signature & Consensus →
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* VIEW 8: TEST RESULTS (ON-CHAIN SIGNED BY HOSPITAL PRIVATE KEY + OFF-CHAIN DOCTOR LAB REQUESTS) */}
            {activeNav === "Test results" && (
              <div className="space-y-6">
                <div>
                  <span className="text-[11px] font-bold tracking-wider text-zinc-400 uppercase">
                    Résultats de Laboratoire Certifiés par l'Hôpital (On-Chain)
                  </span>
                  <h1 className="text-3xl font-extrabold text-zinc-900 tracking-tight mt-0.5">
                    Test Results
                  </h1>
                  <p className="text-xs text-zinc-500 mt-1">
                    Les demandes d'examen du médecin restent <strong>Hors-Chaîne (Off-Chain)</strong>. Dès que l'hôpital publie le résultat d'analyse, il est sauvegardé temporairement, passe par le <strong>Transaction Pool</strong>, la <strong>Proposition de Bloc</strong> et la <strong>Validation par Consensus</strong>, puis est commis dans les BD On-Chain & Off-Chain.
                  </p>
                </div>

                {/* Pending Off-Chain Doctor Lab Requests */}
                {bookletState.labTestRequests.length > 0 && (
                  <div className="bg-amber-50/60 rounded-2xl border border-amber-200 p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-amber-950">
                        Demandes d'Analyses Prescrites par le Médecin (Routage Off-Chain — Non passées sur Blockchain)
                      </span>
                      <span className="text-[10px] font-mono font-bold bg-amber-200/80 text-amber-950 px-2 py-0.5 rounded">
                        OFF-CHAIN DOCTOR ORDER
                      </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {bookletState.labTestRequests.map((req) => (
                        <div
                          key={req.id}
                          className="p-3.5 rounded-xl bg-white border border-amber-200 text-xs flex items-center justify-between"
                        >
                          <div>
                            <span className="font-bold text-zinc-900 block">{req.testName}</span>
                            <span className="text-[11px] text-zinc-500">
                              Demandé par {req.doctorName} • {req.hospitalName}
                            </span>
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              req.status === "COMPLETED_ON_CHAIN"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {req.status === "COMPLETED_ON_CHAIN"
                              ? "✓ Résultat sur Blockchain"
                              : "En cours au Labo"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* On-Chain Hospital Test Results */}
                <div className="space-y-4">
                  {bookletState.labTestResults.map((res) => {
                    const isTemp =
                      res.cryptoProof.persistenceStatus === "TEMPORARY_PENDING_CONSENSUS";
                    return (
                      <div
                        key={res.id}
                        className={`bg-white rounded-2xl border p-6 space-y-4 shadow-2xs ${
                          isTemp ? "border-amber-300 bg-amber-50/15" : "border-zinc-200"
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[10px] font-mono font-bold bg-blue-100 text-blue-800 px-2.5 py-0.5 rounded-full">
                                Signé Clé Privée Hôpital ({res.cryptoProof.signerRole})
                              </span>
                              <span
                                className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                                  isTemp
                                    ? "bg-amber-100 text-amber-900 border border-amber-300 animate-pulse"
                                    : "bg-emerald-50 text-emerald-800 border border-emerald-200"
                                }`}
                              >
                                {isTemp
                                  ? "⏳ TEMPORAIRE — En cours de Consensus"
                                  : "✓ PERMANENT — Enregistré BD On-Chain & Off-Chain"}
                              </span>
                              <span className="text-xs font-mono text-zinc-400">{res.id}</span>
                            </div>
                            <h3 className="text-base font-bold text-zinc-900 mt-1">{res.testName}</h3>
                            <p className="text-xs text-zinc-500">
                              Laboratoire : <strong className="text-zinc-800">{res.performingLaboratory}</strong> ({res.hospitalName}) • Prescrit par {res.orderedByDoctorName}
                            </p>
                          </div>

                          <div className="text-right">
                            <span
                              className={`px-3 py-1 rounded-full text-xs font-bold ${
                                res.interpretationFlag === "NORMAL" ||
                                res.interpretationFlag === "NEGATIVE"
                                  ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                                  : "bg-amber-100 text-amber-800 border border-amber-300"
                              }`}
                            >
                              {res.interpretationFlag}
                            </span>
                            <span className="block text-[11px] text-zinc-400 mt-1">{res.dateCompleted}</span>
                          </div>
                        </div>

                        {res.cryptoProof.pipelineStage && (
                          <div
                            className={`px-3.5 py-2 rounded-xl border text-[11px] font-mono flex items-center justify-between ${
                              isTemp
                                ? "bg-amber-50 border-amber-200 text-amber-900"
                                : "bg-zinc-900 border-zinc-800 text-emerald-400"
                            }`}
                          >
                            <span>Pipeline : {res.cryptoProof.pipelineStage}</span>
                            <span className="text-[10px] font-bold">
                              {isTemp ? "TX POOL -> CONSENSUS..." : "COMMITTED"}
                            </span>
                          </div>
                        )}

                        <div className="p-4 rounded-xl bg-zinc-50 border border-zinc-200/80 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                          <div>
                            <span className="text-[10px] text-zinc-400 uppercase font-bold block">
                              Valeur Mesurée (Déchiffrée E2E)
                            </span>
                            <span className="font-mono font-bold text-sm text-zinc-900">
                              {res.resultValue} <span className="text-xs font-normal text-zinc-500">({res.unit})</span>
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-zinc-400 uppercase font-bold block">
                              Valeurs de Référence
                            </span>
                            <span className="font-mono text-xs text-zinc-700">{res.referenceRange}</span>
                          </div>
                        </div>

                        <p className="text-xs text-zinc-600">{res.methodologyNotes}</p>

                        <div className="pt-3 border-t border-zinc-100 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-zinc-500">
                          <span>
                            Signataire : <strong>{res.cryptoProof.signerName}</strong> •{" "}
                            {isTemp
                              ? "Bloc en cours de validation..."
                              : `Bloc #${res.cryptoProof.blockHeight}`}
                          </span>
                          <button
                            type="button"
                            onClick={() => setInspectedProof(res.cryptoProof)}
                            className="text-emerald-700 hover:text-emerald-900 font-sans font-bold underline cursor-pointer"
                          >
                            Vérifier Signature Privée Hôpital, Consensus & BD →
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* VIEW 9: VACCINATIONS (ON-CHAIN SIGNED BY VACCINATION CENTER PRIVATE KEY + ENCRYPTED WITH PATIENT PUBLIC KEY) */}
            {activeNav === "Vaccinations" && (
              <div className="space-y-6">
                <div>
                  <span className="text-[11px] font-bold tracking-wider text-zinc-400 uppercase">
                    Certificats d'Immunisation On-Chain (Signés par le Centre de Vaccination)
                  </span>
                  <h1 className="text-3xl font-extrabold text-zinc-900 tracking-tight mt-0.5">
                    Vaccinations
                  </h1>
                  <p className="text-xs text-zinc-500 mt-1">
                    Chaque acte vaccinal est chiffré avec votre <strong>Clé Publique Patient</strong>, signé avec la <strong>Clé Privée du Centre de Vaccination</strong>, sauvegardé temporairement puis validé par Consensus (Tx Pool → Proposition → Validation → BD On-Chain & Off-Chain).
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {bookletState.vaccinations.map((vax) => {
                    const isTemp =
                      vax.cryptoProof.persistenceStatus === "TEMPORARY_PENDING_CONSENSUS";
                    return (
                      <div
                        key={vax.id}
                        className={`bg-white rounded-2xl border p-6 space-y-4 shadow-2xs flex flex-col justify-between ${
                          isTemp ? "border-amber-300 bg-amber-50/15" : "border-zinc-200"
                        }`}
                      >
                        <div className="space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2.5">
                              <div className="w-10 h-10 rounded-2xl bg-blue-100 text-blue-800 flex items-center justify-center shrink-0">
                                <Syringe className="w-5 h-5 text-blue-700" />
                              </div>
                              <div>
                                <h3 className="font-bold text-base text-zinc-900">{vax.vaccineName}</h3>
                                <span className="text-xs text-zinc-500">
                                  Maladie ciblée : <strong>{vax.targetDisease}</strong>
                                </span>
                              </div>
                            </div>
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                                isTemp
                                  ? "bg-amber-100 text-amber-900 border border-amber-300 animate-pulse"
                                  : "bg-emerald-100 text-emerald-800 border border-emerald-300"
                              }`}
                            >
                              {isTemp ? "⏳ TEMPORAIRE (Consensus...)" : `✓ PERMANENT (${vax.doseNumber})`}
                            </span>
                          </div>

                          {vax.cryptoProof.pipelineStage && (
                            <div
                              className={`px-3 py-1.5 rounded-xl border text-[10px] font-mono ${
                                isTemp
                                  ? "bg-amber-50 border-amber-200 text-amber-900"
                                  : "bg-zinc-900 border-zinc-800 text-emerald-400"
                              }`}
                            >
                              {vax.cryptoProof.pipelineStage}
                            </div>
                          )}

                          <div className="grid grid-cols-2 gap-2.5 p-3.5 rounded-xl bg-zinc-50 border border-zinc-200/80 text-xs">
                            <div>
                              <span className="text-[10px] text-zinc-400 block">Lot / Batch</span>
                              <span className="font-mono font-bold text-zinc-900">{vax.batchLotNumber}</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-zinc-400 block">Fabricant</span>
                              <span className="font-semibold text-zinc-800">{vax.manufacturer}</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-zinc-400 block">Date d'Administration</span>
                              <span className="font-semibold text-zinc-800">{vax.dateAdministered}</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-zinc-400 block">Prochain Rappel</span>
                              <span className="font-bold text-emerald-700">{vax.nextDueDate}</span>
                            </div>
                            <div className="col-span-2 pt-1.5 border-t border-zinc-200/60">
                              <span className="text-[10px] text-zinc-400 block">
                                Centre de Vaccination Signataire
                              </span>
                              <span className="font-bold text-zinc-900">{vax.vaccinationCenterName}</span>
                              <span className="block text-[11px] text-zinc-500">
                                Administré par {vax.administeredBy} ({vax.routeAndSite})
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="pt-3 border-t border-zinc-100 flex items-center justify-between text-[10px] font-mono text-zinc-500">
                          <span>
                            Signé : <strong>{vax.cryptoProof.signerRole}</strong> •{" "}
                            {isTemp ? "Validation en cours..." : `Bloc #${vax.cryptoProof.blockHeight}`}
                          </span>
                          <button
                            type="button"
                            onClick={() => setInspectedProof(vax.cryptoProof)}
                            className="text-emerald-700 hover:text-emerald-900 font-sans font-bold underline cursor-pointer"
                          >
                            Vérifier Signature & Consensus →
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          </div>
        </div>
      </main>

      {/* CRYPTOGRAPHIC BOOKLET PROOF MODAL (E2E PATIENT PUBLIC KEY ENCRYPTION + AUTHORITY SIGNATURE + CONSENSUS & DB PIPELINE) */}
      {inspectedProof && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-zinc-200 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 bg-zinc-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Lock className="w-4 h-4 text-emerald-400" />
                <div>
                  <h3 className="font-bold text-sm">
                    Vérification Cryptographique E2E, Consensus PBFT & Bases On-Chain / Off-Chain ({inspectedProof.recordCategory})
                  </h3>
                  <p className="text-[10px] text-zinc-400">
                    Chiffré avec la Clé Publique du Patient avant le 1er Client Node • Signé par {inspectedProof.signerRole}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setInspectedProof(null)}
                className="text-zinc-400 hover:text-white p-1 rounded-lg text-sm"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-3.5 text-xs font-mono overflow-y-auto">
              <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 font-sans text-xs leading-relaxed">
                <strong>Cycle Complet de Persistance & Consensus :</strong> Avant d'être envoyé au 1er Client Node, l'enregistrement est <strong>sauvegardé temporairement</strong>. Il traverse ensuite le <strong>Transaction Pool (Mempool)</strong>, la <strong>Proposition de Bloc</strong> et la <strong>Validation par Consensus des Nœuds Validateurs</strong> avant d'être commis simultanément dans la <strong>BD On-Chain</strong> (en-tête de bloc, Merkle Root, hash, signatures) et la <strong>BD Off-Chain</strong> (payload clinique chiffré E2E), puis confirmé au Portail par le Client Node en <strong>Sauvegarde Permanente</strong>.
              </div>

              {/* 6-Stage Pipeline Verification Box */}
              <div className="p-3.5 rounded-xl bg-zinc-900 text-zinc-100 space-y-1.5 text-[11px]">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5 mb-1">
                  <span className="font-sans font-bold text-emerald-400">
                    Statut de Persistance Actuel :
                  </span>
                  <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold">
                    {inspectedProof.persistenceStatus === "TEMPORARY_PENDING_CONSENSUS"
                      ? "TEMPORARY_PENDING_CONSENSUS (En cours)"
                      : "PERMANENTLY_COMMITTED (Sauvegardé en Permanence)"}
                  </span>
                </div>
                <div>
                  1. Sauvegarde Temporaire (Portail & 1er Client Node) :{" "}
                  <span className="text-emerald-400 font-bold">✓ OUI</span>
                </div>
                <div>
                  2. Passage par le Transaction Pool (Mempool Validateur) :{" "}
                  <span className="text-emerald-400 font-bold">
                    {inspectedProof.txPoolPassed !== false ? "✓ OUI (QUEUED_IN_TRANSACTION_POOL)" : "⏳ En cours..."}
                  </span>
                </div>
                <div>
                  3. Proposition de Bloc (PBFT Pre-Prepare) :{" "}
                  <span className="text-emerald-400 font-bold">
                    {inspectedProof.blockProposed !== false ? "✓ OUI (BLOCK_PROPOSED)" : "⏳ En cours..."}
                  </span>
                </div>
                <div>
                  4. Consensus & Validation par Nœuds Validateurs (PBFT Commit) :{" "}
                  <span className="text-emerald-400 font-bold">
                    {inspectedProof.consensusValidated !== false ? "✓ OUI (QUORUM VALIDATED)" : "⏳ En cours..."}
                  </span>
                </div>
                <div>
                  5. Enregistrement BD On-Chain (blocks.dat + onchain_committed_ledger) :{" "}
                  <span className="text-emerald-400 font-bold">
                    {inspectedProof.onChainDbSaved !== false ? "✓ COMMITTED ON-CHAIN DB" : "⏳ En attente..."}
                  </span>
                </div>
                <div>
                  6. Enregistrement BD Off-Chain (records.db + offchain_clinical_records) & Retour Client Node → Portail :{" "}
                  <span className="text-emerald-400 font-bold">
                    {inspectedProof.offChainDbSaved !== false ? "✓ COMMITTED OFF-CHAIN DB & PORTAL UPDATED" : "⏳ En attente..."}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5 bg-zinc-50 p-4 rounded-xl border border-zinc-200 text-[11px] break-all">
                <div>
                  <span className="text-zinc-400">Autorité Signataire :</span>{" "}
                  <strong>{inspectedProof.signerName} ({inspectedProof.signerRole})</strong>
                </div>
                <div>
                  <span className="text-zinc-400">DID Signataire :</span> {inspectedProof.signerDid}
                </div>
                <div>
                  <span className="text-zinc-400">Signature Numérique ECDSA :</span>{" "}
                  <span className="text-emerald-700 font-semibold">{inspectedProof.digitalSignature}</span>
                </div>
                <div>
                  <span className="text-zinc-400">Clé Publique Patient (Destinataire E2E) :</span>{" "}
                  {inspectedProof.patientPublicKey.slice(0, 52)}...
                </div>
                <div>
                  <span className="text-zinc-400">Clé AES-256 Enveloppée (DEK) :</span>{" "}
                  {inspectedProof.encryptedDekForPatient.slice(0, 52)}...
                </div>
                <div>
                  <span className="text-zinc-400">1er Client Node Gateway :</span>{" "}
                  <strong>{inspectedProof.firstClientNodeGateway}</strong>
                </div>
                <div>
                  <span className="text-zinc-400">Blockchain Tx Hash :</span>{" "}
                  <span className="text-zinc-900 font-bold">{inspectedProof.blockchainTxHash}</span>
                </div>
                <div>
                  <span className="text-zinc-400">Bloc & Validateur :</span> Bloc #{inspectedProof.blockHeight} ({inspectedProof.validatorNodeId})
                </div>
                <div>
                  <span className="text-zinc-400">Merkle Root :</span> {inspectedProof.merkleRoot}
                </div>
              </div>

              <div className="flex justify-end pt-2 font-sans">
                <button
                  onClick={() => setInspectedProof(null)}
                  className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl text-xs font-semibold"
                >
                  Fermer la Preuve
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* KEY DRAWER / INSPECTOR */}
      <BlockchainKeyDrawer
        credential={credential}
        isOpen={isKeyDrawerOpen}
        onClose={() => setIsKeyDrawerOpen(false)}
      />
    </div>
  );
}
