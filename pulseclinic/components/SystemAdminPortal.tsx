"use client";

import React, { useState } from "react";
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  Key,
  Users,
  Database,
  Globe,
  Activity,
  Lock,
  Unlock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  BookOpen,
  Pill,
  FileText,
  Network,
  Server,
  HardDrive,
  Scale,
  Download,
  Plus,
  Search,
  RefreshCw,
  Building2,
  Layers,
  Cpu,
  Flame,
  EyeOff,
  Check,
} from "lucide-react";
import {
  PortalType,
  GlobalPractitionerRecord,
  INITIAL_GLOBAL_PRACTITIONERS,
  CryptoInfrastructureNode,
  INITIAL_CRYPTO_NODES,
  RbacPolicyTemplate,
  INITIAL_RBAC_TEMPLATES,
  BreakGlassEvent,
  INITIAL_BREAK_GLASS_EVENTS,
  ClinicalCodeItem,
  INITIAL_CLINICAL_CODES,
  DrugInteractionRule,
  INITIAL_DRUG_INTERACTION_RULES,
  StandardizedEncounterTemplate,
  INITIAL_ENCOUNTER_TEMPLATES,
  CrossTenantReferralRoute,
  INITIAL_REFERRAL_ROUTES,
  ExternalFhirGateway,
  INITIAL_FHIR_GATEWAYS,
  MpiDeduplicationCandidate,
  INITIAL_MPI_CANDIDATES,
  PlatformMetadataAuditLog,
  INITIAL_PLATFORM_METADATA_LOGS,
  SecurityAnomalyAlert,
  INITIAL_ANOMALY_ALERTS,
  HospitalTenantQuota,
  INITIAL_TENANT_QUOTAS,
} from "@/lib/multiPortalStore";
import { StoredCredential } from "@/lib/webauthn";
import {
  triggerColdBlockArchiveOnChain,
  restoreArchivedBlockOnChain,
} from "@/lib/clinicalBookletStore";

interface SystemAdminPortalProps {
  credential: StoredCredential;
  onSwitchPortal: (portal: PortalType) => void;
  availableRoles: string[];
}

type SysAdminTab =
  | "identity"
  | "taxonomies"
  | "interoperability"
  | "compliance"
  | "tenants"
  | "boundaries";

export default function SystemAdminPortal({
  credential,
  onSwitchPortal,
  availableRoles = [],
}: SystemAdminPortalProps) {
  const [activeTab, setActiveTab] = useState<SysAdminTab>("identity");
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Role connection checks for portal switching
  const hasDoctorRole = availableRoles.includes("DOCTOR");
  const hasHospitalRole =
    availableRoles.includes("HOSPITAL_STAFF") ||
    availableRoles.includes("ADMIN") ||
    availableRoles.includes("HOSPITAL_ADMIN");

  // 1. Identity, Cryptographic Trust & Access Control State
  const [practitioners, setPractitioners] = useState<GlobalPractitionerRecord[]>(
    INITIAL_GLOBAL_PRACTITIONERS
  );
  const [cryptoNodes, setCryptoNodes] = useState<CryptoInfrastructureNode[]>(INITIAL_CRYPTO_NODES);
  const [rbacTemplates, setRbacTemplates] = useState<RbacPolicyTemplate[]>(INITIAL_RBAC_TEMPLATES);
  const [breakGlassEvents, setBreakGlassEvents] = useState<BreakGlassEvent[]>(
    INITIAL_BREAK_GLASS_EVENTS
  );
  const [enforceGlobalPasskey, setEnforceGlobalPasskey] = useState(true);
  const [breakGlassWindowMins, setBreakGlassWindowMins] = useState(60);

  // 2. Global Clinical Taxonomies & Master Data State
  const [clinicalCodes, setClinicalCodes] = useState<ClinicalCodeItem[]>(INITIAL_CLINICAL_CODES);
  const [codeFilter, setCodeFilter] = useState<"ALL" | "ICD-11" | "LOINC" | "SNOMED-CT" | "RxNorm">(
    "ALL"
  );
  const [codeSearch, setCodeSearch] = useState("");
  const [newCodeStandard, setNewCodeStandard] = useState<
    "ICD-11" | "LOINC" | "SNOMED-CT" | "RxNorm"
  >("ICD-11");
  const [newCodeVal, setNewCodeVal] = useState("");
  const [newCodeDisplay, setNewCodeDisplay] = useState("");
  const [newCodeCategory, setNewCodeCategory] = useState("Infectious Diseases");
  const [interactionRules, setInteractionRules] = useState<DrugInteractionRule[]>(
    INITIAL_DRUG_INTERACTION_RULES
  );
  const [encounterTemplates, setEncounterTemplates] = useState<StandardizedEncounterTemplate[]>(
    INITIAL_ENCOUNTER_TEMPLATES
  );

  // 3. Cross-Tenant Interoperability & Data Exchange State
  const [referralRoutes] = useState<CrossTenantReferralRoute[]>(INITIAL_REFERRAL_ROUTES);
  const [fhirGateways, setFhirGateways] = useState<ExternalFhirGateway[]>(INITIAL_FHIR_GATEWAYS);
  const [mpiCandidates, setMpiCandidates] =
    useState<MpiDeduplicationCandidate[]>(INITIAL_MPI_CANDIDATES);

  // 4. Compliance, Immutable Auditing & Forensics State
  const [metadataLogs, setMetadataLogs] = useState<PlatformMetadataAuditLog[]>(
    INITIAL_PLATFORM_METADATA_LOGS
  );
  const [anomalies, setAnomalies] = useState<SecurityAnomalyAlert[]>(INITIAL_ANOMALY_ALERTS);

  // 5. Multi-Tenant Operations, Quotas & Billing State
  const [tenants, setTenants] = useState<HospitalTenantQuota[]>(INITIAL_TENANT_QUOTAS);

  // 6. Cold Archive Saving & Block Pruning (ARCHIVE_BLOCKS -> C++ CArchiveManager)
  const [isArchivingBlocks, setIsArchivingBlocks] = useState(false);
  const [latestArchiveManifest, setLatestArchiveManifest] = useState<{
    archive_id: string;
    start_height: number;
    end_height: number;
    block_count: number;
    uncompressed_bytes: number;
    compressed_bytes: number;
    sha256_checksum: string;
    merkle_checkpoint_root: string;
    archive_file_path: string;
    sealed_files_pruned: number;
    headers_retained_online: boolean;
    merkle_roots_retained_online: boolean;
    node_id: string;
  } | null>(null);

  const [isRestoringBlock, setIsRestoringBlock] = useState(false);
  const [restoreBlockHeight, setRestoreBlockHeight] = useState<number>(0);
  const [restoredBlockResult, setRestoredBlockResult] = useState<{
    status: string;
    height: number;
    block_hash: string;
    merkle_root: string;
    tx_count: number;
    node_id: string;
    restored_from: string;
  } | null>(null);

  const handleTriggerColdArchive = async () => {
    setIsArchivingBlocks(true);
    const manifest = await triggerColdBlockArchiveOnChain();
    setLatestArchiveManifest(manifest);
    setIsArchivingBlocks(false);
    notify(
      `Cold Archive ${manifest.archive_id} sealed & compressed (${manifest.compressed_bytes}B) in ${manifest.archive_file_path}. headers.dat & Merkle roots retained online.`
    );
  };

  const handleRestoreArchivedBlock = async () => {
    setIsRestoringBlock(true);
    const result = await restoreArchivedBlockOnChain(restoreBlockHeight);
    setRestoredBlockResult(result);
    setIsRestoringBlock(false);
    notify(
      `Bloc #${result.height} restauré et décompressé avec succès depuis l'archive froide (Hash: ${result.block_hash.slice(0, 16)}...).`
    );
  };

  const notify = (msg: string) => {
    setStatusBanner(msg);
    setTimeout(() => setStatusBanner(null), 4500);
  };

  // Handlers: Domain 1
  const handleVerifyPractitionerLicense = (id: string) => {
    setPractitioners((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              licenseStatus: "VERIFIED_ACTIVE",
              lastVerifiedAt: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC",
            }
          : p
      )
    );
    const target = practitioners.find((p) => p.id === id);
    notify(
      `National Medical Board license (${target?.nationalLicenseNumber}) verified for ${target?.name}. Global root DID activated.`
    );
  };

  const handleEmergencyRevokePractitioner = (id: string) => {
    setPractitioners((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              licenseStatus: "SUSPENDED_REVOKED",
              deviceCompromised: true,
              lastVerifiedAt: "REVOKED ON-CHAIN CRL",
            }
          : p
      )
    );
    const target = practitioners.find((p) => p.id === id);
    notify(
      `Emergency PKI Certificate Revocation executed for ${target?.name} (${target?.rootDid}). All multi-hospital active tokens invalidated.`
    );
  };

  const handleRotateKsmKeys = (nodeId: string) => {
    setCryptoNodes((prev) =>
      prev.map((n) =>
        n.id === nodeId
          ? { ...n, status: "HEALTHY", lastHeartbeat: "Just now (Shamir Shares Refreshed)" }
          : n
      )
    );
    notify(`Proactive Shamir secret share refresh completed on node ${nodeId}.`);
  };

  const handleReviewBreakGlass = (
    eventId: string,
    decision: "JUSTIFIED_APPROVED" | "FLAGGED_FOR_INVESTIGATION"
  ) => {
    setBreakGlassEvents((prev) =>
      prev.map((ev) => (ev.id === eventId ? { ...ev, reviewStatus: decision } : ev))
    );
    notify(
      decision === "JUSTIFIED_APPROVED"
        ? `Break-glass override ${eventId} marked as clinically justified on compliance ledger.`
        : `Break-glass override ${eventId} escalated for forensic investigation.`
    );
  };

  // Handlers: Domain 2
  const handleAddClinicalCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCodeVal.trim() || !newCodeDisplay.trim()) return;
    const item: ClinicalCodeItem = {
      id: `mdm-${Date.now().toString().slice(-4)}`,
      standard: newCodeStandard,
      code: newCodeVal.trim().toUpperCase(),
      display: newCodeDisplay.trim(),
      category: newCodeCategory,
      version: `${newCodeStandard} 2026 Master`,
      status: "ACTIVE",
      updatedAt: new Date().toISOString().slice(0, 10),
    };
    setClinicalCodes([item, ...clinicalCodes]);
    setNewCodeVal("");
    setNewCodeDisplay("");
    notify(
      `Master Clinical Code ${item.code} (${item.standard}) published to all hospital tenants.`
    );
  };

  const handleToggleDrugRule = (ruleId: string) => {
    setInteractionRules((prev) =>
      prev.map((r) => (r.id === ruleId ? { ...r, isActive: !r.isActive } : r))
    );
    notify(`Updated national formulary drug-interaction warning rule (${ruleId}).`);
  };

  const handlePublishTemplateAllTenants = (tplId: string) => {
    setEncounterTemplates((prev) =>
      prev.map((t) =>
        t.id === tplId ? { ...t, adoptedByTenants: t.totalTenants, status: "PUBLISHED" } : t
      )
    );
    notify(`Standardized clinical encounter template synchronized across all hospital tenants.`);
  };

  // Handlers: Domain 3
  const handleToggleFhirGateway = (gwId: string) => {
    setFhirGateways((prev) =>
      prev.map((gw) =>
        gw.id === gwId
          ? { ...gw, status: gw.status === "ONLINE" ? "MAINTENANCE" : "ONLINE" }
          : gw
      )
    );
    notify(`Updated external HL7/FHIR gateway routing state.`);
  };

  const handleResolveMpiCandidate = (
    mpiId: string,
    resolution: "MERGED_ON_CHAIN" | "DISMISSED"
  ) => {
    setMpiCandidates((prev) =>
      prev.map((c) => (c.id === mpiId ? { ...c, status: resolution } : c))
    );
    notify(
      resolution === "MERGED_ON_CHAIN"
        ? `Privacy-preserving MPI linkage committed on-chain for ${mpiId}. Duplicate patient DIDs unified.`
        : `MPI candidate ${mpiId} dismissed.`
    );
  };

  // Handlers: Domain 4
  const handleToggleLegalHold = (logId: string) => {
    setMetadataLogs((prev) =>
      prev.map((l) => (l.id === logId ? { ...l, legalHoldFrozen: !l.legalHoldFrozen } : l))
    );
    notify(`Cryptographic Legal Hold status updated for audit record ${logId}.`);
  };

  const handleQuarantineAnomaly = (alertId: string) => {
    setAnomalies((prev) =>
      prev.map((a) => (a.id === alertId ? { ...a, status: "QUARANTINED" } : a))
    );
    notify(
      `Suspect actor session quarantined and rate-limited across all PBFT validator gateways.`
    );
  };

  const handleExportRegulatoryReport = () => {
    const reportPayload = {
      reportType: "MINSANTE_ANONYMIZED_EPIDEMIOLOGICAL_AND_FORENSIC_SUMMARY",
      generatedAt: new Date().toISOString(),
      clinicalDataExposed: false,
      privacyGuarantee: "ZERO_CLINICAL_ACCESS_METADATA_ONLY",
      activeTenants: tenants.length,
      breakGlassEventsReviewed: breakGlassEvents.length,
      frozenLegalHoldTrails: metadataLogs.filter((l) => l.legalHoldFrozen),
      metadataAuditSample: metadataLogs,
    };
    const blob = new Blob([JSON.stringify(reportPayload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pulse-regulatory-compliance-report-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify(`Anonymized regulatory & forensic audit proof exported as JSON.`);
  };

  // Handlers: Domain 5
  const handleToggleTenantComplianceMode = (tenantId: string) => {
    setTenants((prev) =>
      prev.map((t) => {
        if (t.id !== tenantId) return t;
        const nextState =
          t.operationalState === "ACTIVE" ? "READ_ONLY_COMPLIANCE_MODE" : "ACTIVE";
        return {
          ...t,
          operationalState: nextState,
          billingStatus: nextState === "ACTIVE" ? "CURRENT" : "DELINQUENT_PAST_DUE",
        };
      })
    );
    notify(
      `Updated tenant operational mode. Clinical records remain preserved under zero-deletion compliance policy.`
    );
  };

  const handleToggleTenantFeature = (
    tenantId: string,
    featureKey: keyof HospitalTenantQuota["featureFlags"]
  ) => {
    setTenants((prev) =>
      prev.map((t) =>
        t.id === tenantId
          ? {
              ...t,
              featureFlags: {
                ...t.featureFlags,
                [featureKey]: !t.featureFlags[featureKey],
              },
            }
          : t
      )
    );
    notify(`Updated modular feature flag (${featureKey}) for tenant.`);
  };

  const handleTriggerColdBackup = (tenantId: string) => {
    setTenants((prev) =>
      prev.map((t) =>
        t.id === tenantId
          ? {
              ...t,
              lastColdBackupAt:
                new Date().toISOString().slice(0, 16).replace("T", " ") +
                " UTC (Verified Snapshot)",
            }
          : t
      )
    );
    notify(`Encrypted geo-redundant cold backup snapshot verified for tenant ${tenantId}.`);
  };

  const filteredClinicalCodes = clinicalCodes.filter((c) => {
    const matchesStandard = codeFilter === "ALL" || c.standard === codeFilter;
    const matchesSearch =
      c.code.toLowerCase().includes(codeSearch.toLowerCase()) ||
      c.display.toLowerCase().includes(codeSearch.toLowerCase()) ||
      c.category.toLowerCase().includes(codeSearch.toLowerCase());
    return matchesStandard && matchesSearch;
  });

  return (
    <div className="flex h-screen bg-[#F4F5F7] font-sans antialiased text-zinc-900 overflow-hidden">
      {/* LEFT SIDEBAR - SYSTEM ADMIN (PLATFORM LEVEL) */}
      <aside className="w-68 bg-transparent flex flex-col shrink-0 p-4 select-none">
        {/* Brand */}
        <div className="flex items-center gap-3 px-3 py-3 mb-5">
          <div className="w-9 h-9 rounded-2xl bg-zinc-900 text-white flex items-center justify-center shadow-xs">
            <Shield className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <span className="font-bold text-[16px] tracking-tight text-zinc-900 block leading-tight">
              Pulse Sovereign Core
            </span>
            <span className="text-[10px] font-bold text-purple-800 bg-purple-100 px-1.5 py-0.5 rounded border border-purple-200">
              System Admin • Platform Level
            </span>
          </div>
        </div>

        {/* Portal Switcher */}
        <div className="mb-4 px-2">
          <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">
            Switch Workspace
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
            {hasHospitalRole && (
              <button
                onClick={() => onSwitchPortal("hospital")}
                className="text-left px-3 py-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 rounded-xl transition-all"
              >
                Hospital Manager (Tenant)
              </button>
            )}
            <button
              disabled
              className="text-left px-3 py-1.5 text-xs font-bold text-zinc-900 bg-zinc-100 rounded-xl flex items-center justify-between"
            >
              <span>System Admin (Platform)</span>
              <span className="w-1.5 h-1.5 rounded-full bg-purple-600"></span>
            </button>
          </div>
        </div>

        {/* 5 Core Domain Navigation Tabs */}
        <div className="space-y-1 px-1 text-xs flex-1 overflow-y-auto">
          <div className="px-2 py-1 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
            Platform Governance Domains
          </div>
          <button
            onClick={() => setActiveTab("identity")}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all ${
              activeTab === "identity"
                ? "bg-white text-zinc-900 font-bold shadow-2xs"
                : "text-zinc-600 hover:bg-black/5"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Key className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="truncate">1. Identity, PKI & Trust</span>
            </div>
            {breakGlassEvents.some((e) => e.reviewStatus === "PENDING_GOVERNANCE_REVIEW") && (
              <span className="w-2 h-2 rounded-full bg-rose-500"></span>
            )}
          </button>

          <button
            onClick={() => setActiveTab("taxonomies")}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all ${
              activeTab === "taxonomies"
                ? "bg-white text-zinc-900 font-bold shadow-2xs"
                : "text-zinc-600 hover:bg-black/5"
            }`}
          >
            <BookOpen className="w-4 h-4 text-blue-600 shrink-0" />
            <span className="truncate">2. Clinical Taxonomies (MDM)</span>
          </button>

          <button
            onClick={() => setActiveTab("interoperability")}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all ${
              activeTab === "interoperability"
                ? "bg-white text-zinc-900 font-bold shadow-2xs"
                : "text-zinc-600 hover:bg-black/5"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Globe className="w-4 h-4 text-cyan-600 shrink-0" />
              <span className="truncate">3. Cross-Tenant & FHIR/MPI</span>
            </div>
            {mpiCandidates.some((c) => c.status === "PENDING_LINKAGE") && (
              <span className="text-[10px] font-bold bg-amber-100 text-amber-800 px-1.5 rounded-full">
                {mpiCandidates.filter((c) => c.status === "PENDING_LINKAGE").length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab("compliance")}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all ${
              activeTab === "compliance"
                ? "bg-white text-zinc-900 font-bold shadow-2xs"
                : "text-zinc-600 hover:bg-black/5"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
              <span className="truncate">4. Forensics & Audit Logs</span>
            </div>
            {anomalies.some((a) => a.status === "ACTIVE_ALERT") && (
              <span className="w-2 h-2 rounded-full bg-red-500 animate-ping"></span>
            )}
          </button>

          <button
            onClick={() => setActiveTab("tenants")}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all ${
              activeTab === "tenants"
                ? "bg-white text-zinc-900 font-bold shadow-2xs"
                : "text-zinc-600 hover:bg-black/5"
            }`}
          >
            <Server className="w-4 h-4 text-purple-600 shrink-0" />
            <span className="truncate">5. Multi-Tenant & Quotas</span>
          </button>

          <button
            onClick={() => setActiveTab("boundaries")}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all ${
              activeTab === "boundaries"
                ? "bg-white text-zinc-900 font-bold shadow-2xs"
                : "text-zinc-600 hover:bg-black/5"
            }`}
          >
            <Layers className="w-4 h-4 text-zinc-600 shrink-0" />
            <span className="truncate">Role Boundary Architecture</span>
          </button>
        </div>

        {/* Zero Clinical Access Guarantee Footer */}
        <div className="mt-auto pt-3 border-t border-zinc-200/70">
          <div className="p-3 rounded-2xl bg-zinc-900 text-white space-y-1.5">
            <div className="flex items-center gap-1.5 text-emerald-400 text-[11px] font-bold">
              <EyeOff className="w-3.5 h-3.5 shrink-0" />
              <span>Zero Clinical Data Access</span>
            </div>
            <p className="text-[10px] text-zinc-300 leading-snug">
              System Admin inspects cryptographic metadata, PKI certificates, and anonymized audit trails only. Patient clinical payloads remain end-to-end encrypted.
            </p>
            <p className="text-[9px] font-mono text-zinc-400 truncate">
              Root Custody: {credential.did}
            </p>
          </div>
        </div>
      </aside>

      {/* MAIN SYSTEM ADMIN WORKSPACE */}
      <main className="flex-1 flex flex-col min-w-0 h-screen p-4 pl-0">
        <div className="flex-1 bg-white rounded-3xl border border-zinc-200 shadow-sm flex flex-col overflow-hidden">
          {/* Top Bar */}
          <header className="h-16 px-8 border-b border-zinc-100 flex items-center justify-between shrink-0 bg-white">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Platform-Level Governance
              </span>
              <span className="text-zinc-300">›</span>
              <span className="text-zinc-900 font-bold text-sm">
                {activeTab === "identity" && "1. Identity, Cryptographic Trust & Access Control"}
                {activeTab === "taxonomies" && "2. Global Clinical Taxonomies & Master Data (MDM)"}
                {activeTab === "interoperability" &&
                  "3. Cross-Tenant Interoperability, FHIR & MPI Deduplication"}
                {activeTab === "compliance" &&
                  "4. Compliance, Immutable Auditing & Forensics (Zero Clinical Access)"}
                {activeTab === "tenants" && "5. Multi-Tenant Operations, Quotas & Billing"}
                {activeTab === "boundaries" &&
                  "Boundary Comparison: System Admin vs. Hospital Manager"}
              </span>
            </div>

            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                PKI & Shamir KSM Quorum (3-of-5) Healthy
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-purple-50 text-purple-800 border border-purple-200">
                <EyeOff className="w-3.5 h-3.5" />
                Metadata-Only Custody
              </span>
            </div>
          </header>

          {/* Notification Toast */}
          {statusBanner && (
            <div className="mx-8 mt-4 p-3.5 rounded-2xl bg-zinc-900 text-white text-xs flex items-center justify-between shadow-md">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{statusBanner}</span>
              </div>
              <button
                onClick={() => setStatusBanner(null)}
                className="text-zinc-400 hover:text-white text-xs"
              >
                ✕
              </button>
            </div>
          )}

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
            {/* =====================================================================
                DOMAIN 1: IDENTITY, CRYPTOGRAPHIC TRUST & ACCESS CONTROL
               ===================================================================== */}
            {activeTab === "identity" && (
              <div className="space-y-8">
                {/* 1A. Practitioner Verification & Global Registry */}
                <div className="bg-white rounded-2xl border border-zinc-200 p-6 space-y-4 shadow-2xs">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-100 pb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-emerald-600" />
                        <h3 className="font-bold text-sm text-zinc-900">
                          Practitioner Verification & Global Cryptographic Registry
                        </h3>
                      </div>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        Vet medical license numbers against national medical boards (ONMC / ONPC) before activating a practitioner&apos;s global root identity across multiple clinics.
                      </p>
                    </div>
                    <span className="text-xs font-semibold bg-zinc-100 text-zinc-800 px-3 py-1 rounded-full shrink-0">
                      {practitioners.filter((p) => p.licenseStatus === "VERIFIED_ACTIVE").length} /{" "}
                      {practitioners.length} Root Identities Active
                    </span>
                  </div>

                  <div className="divide-y divide-zinc-100 text-xs">
                    {practitioners.map((prac) => (
                      <div
                        key={prac.id}
                        className="py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                      >
                        <div className="space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-sm text-zinc-900">{prac.name}</span>
                            <span className="font-mono text-[11px] bg-zinc-100 text-zinc-800 px-2 py-0.5 rounded border border-zinc-200 font-semibold">
                              {prac.nationalLicenseNumber}
                            </span>
                            <span className="text-[11px] text-zinc-500">• {prac.specialty}</span>
                            {prac.licenseStatus === "VERIFIED_ACTIVE" && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                ● Board Verified Root DID
                              </span>
                            )}
                            {prac.licenseStatus === "PENDING_BOARD_VETTING" && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                ● Pending Medical Board Vetting
                              </span>
                            )}
                            {prac.licenseStatus === "SUSPENDED_REVOKED" && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-700 border border-red-200">
                                ● Certificate Revoked (CRL)
                              </span>
                            )}
                          </div>

                          <p className="text-[11px] text-zinc-500">
                            Issuing Authority: <strong>{prac.medicalBoard}</strong> • Root DID:{" "}
                            <span className="font-mono text-zinc-700">{prac.rootDid}</span>
                          </p>

                          {/* Multi-Facility Role Separation */}
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {prac.facilities.map((fac, idx) => (
                              <div
                                key={idx}
                                className="px-2.5 py-1 rounded-lg bg-zinc-50 border border-zinc-200 text-[10px] flex items-center gap-1.5"
                              >
                                <Building2 className="w-3 h-3 text-zinc-500" />
                                <span className="font-semibold text-zinc-800">
                                  {fac.hospitalName}:
                                </span>
                                <span className="text-emerald-700 font-medium">{fac.role}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {prac.licenseStatus === "PENDING_BOARD_VETTING" && (
                            <button
                              onClick={() => handleVerifyPractitionerLicense(prac.id)}
                              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold text-xs flex items-center gap-1.5 shadow-2xs transition-colors"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Verify Board License & Activate Root DID</span>
                            </button>
                          )}
                          {prac.licenseStatus === "VERIFIED_ACTIVE" && (
                            <button
                              onClick={() => handleEmergencyRevokePractitioner(prac.id)}
                              className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl font-semibold text-xs flex items-center gap-1.5 transition-colors"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              <span>Emergency Certificate Revocation</span>
                            </button>
                          )}
                          {prac.licenseStatus === "SUSPENDED_REVOKED" && (
                            <button
                              onClick={() => handleVerifyPractitionerLicense(prac.id)}
                              className="px-3 py-2 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl font-semibold text-xs flex items-center gap-1.5 transition-colors"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              <span>Reinstate Root Certificate</span>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 1B. Key Lifecycle, PKI & Proxy Re-Encryption (KSM) Node Health */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  <div className="lg:col-span-7 bg-white rounded-2xl border border-zinc-200 p-6 space-y-4 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <Cpu className="w-4 h-4 text-blue-600" />
                          <h3 className="font-bold text-sm text-zinc-900">
                            PKI, HSM & Shamir KSM Proxy Re-Encryption Node Health
                          </h3>
                        </div>
                        <p className="text-xs text-zinc-500 mt-0.5">
                          Monitors threshold key-management enclaves and PBFT validator consensus nodes.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2.5 text-xs">
                      {cryptoNodes.map((node) => (
                        <div
                          key={node.id}
                          className="p-3.5 rounded-xl border border-zinc-200 bg-zinc-50/60 flex items-center justify-between gap-3"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                              <span className="font-bold text-zinc-900">{node.label}</span>
                              <span className="text-[10px] font-mono bg-white px-2 py-0.5 rounded border border-zinc-200 text-zinc-600">
                                {node.endpoint}
                              </span>
                            </div>
                            <p className="text-[11px] text-zinc-500 mt-1">
                              Region: {node.region} • Uptime: <strong>{node.uptime}</strong> • Heartbeat:{" "}
                              {node.lastHeartbeat}
                            </p>
                          </div>

                          <button
                            onClick={() => handleRotateKsmKeys(node.id)}
                            className="px-3 py-1.5 bg-white hover:bg-zinc-100 text-zinc-700 border border-zinc-200 rounded-xl text-[11px] font-semibold flex items-center gap-1.5 shrink-0"
                          >
                            <RefreshCw className="w-3 h-3" />
                            <span>Refresh Shares</span>
                          </button>
                        </div>
                      ))}
                    </div>

                    {/* Cold Archive Saving & Block Pruning (ARCHIVE_BLOCKS -> C++ CArchiveManager) */}
                    <div className="pt-3 border-t border-zinc-100 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <HardDrive className="w-4 h-4 text-emerald-600" />
                            <span className="font-bold text-xs text-zinc-900">
                              Cold Archive Saving & Block Pruning (C++ CArchiveManager)
                            </span>
                          </div>
                          <p className="text-[11px] text-zinc-500">
                            Seals rolled blkNNNNN.dat files, compresses into .medarch with SHA-256 & Merkle checkpoints while keeping headers.dat online.
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={isArchivingBlocks}
                          onClick={handleTriggerColdArchive}
                          className="px-3.5 py-2 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-2xs cursor-pointer"
                        >
                          <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
                          <span>
                            {isArchivingBlocks
                              ? "Sealing & Compressing Cold Blocks..."
                              : "Seal & Archive Cold Blocks (ARCHIVE_BLOCKS)"}
                          </span>
                        </button>
                      </div>

                      {latestArchiveManifest && (
                        <div className="p-3.5 rounded-xl bg-zinc-900 text-zinc-100 text-[11px] font-mono space-y-1">
                          <div className="text-emerald-400 font-bold">
                            ✓ Cold Block Archive Manifest ({latestArchiveManifest.archive_id})
                          </div>
                          <div>
                            Blocks: #{latestArchiveManifest.start_height} → #{latestArchiveManifest.end_height} ({latestArchiveManifest.block_count} blocks) • Size:{" "}
                            {latestArchiveManifest.uncompressed_bytes}B →{" "}
                            <strong className="text-emerald-300">{latestArchiveManifest.compressed_bytes}B compressed</strong>
                          </div>
                          <div className="truncate">Path: {latestArchiveManifest.archive_file_path}</div>
                          <div className="truncate">SHA-256 Checksum: 0x{latestArchiveManifest.sha256_checksum}</div>
                          <div className="truncate">Merkle Checkpoint: 0x{latestArchiveManifest.merkle_checkpoint_root}</div>
                          <div className="text-emerald-300">
                            headers.dat Online: {latestArchiveManifest.headers_retained_online ? "TRUE" : "FALSE"} • Merkle Trees Online:{" "}
                            {latestArchiveManifest.merkle_roots_retained_online ? "TRUE" : "FALSE"}
                          </div>
                        </div>
                      )}

                      {/* On-Demand Block Restoration from Cold Archive */}
                      <div className="pt-3 border-t border-zinc-200/60 space-y-2">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div>
                            <span className="font-bold text-xs text-zinc-900 block">
                              Restauration & Décompression à la Demande (RESTORE_ARCHIVED_BLOCK)
                            </span>
                            <span className="text-[11px] text-zinc-500">
                              Décompresse les blocs prunés depuis l'archive .medarch et vérifie le hash avec headers.dat.
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={0}
                              value={restoreBlockHeight}
                              onChange={(e) => setRestoreBlockHeight(Math.max(0, parseInt(e.target.value) || 0))}
                              className="w-16 px-2 py-1 text-xs border border-zinc-200 rounded-lg bg-white font-mono text-center"
                              placeholder="Bloc #"
                            />
                            <button
                              type="button"
                              disabled={isRestoringBlock}
                              onClick={handleRestoreArchivedBlock}
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-colors shrink-0"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                              <span>{isRestoringBlock ? "Décompression..." : "Restaurer Bloc"}</span>
                            </button>
                          </div>
                        </div>

                        {restoredBlockResult && (
                          <div className="p-3 rounded-xl bg-emerald-950 text-emerald-100 text-[11px] font-mono space-y-1 animate-in fade-in">
                            <div className="text-emerald-400 font-bold flex items-center gap-1.5">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Bloc #{restoredBlockResult.height} Restauré & Décompressé avec Succès</span>
                            </div>
                            <div className="truncate">Hash: {restoredBlockResult.block_hash}</div>
                            <div className="truncate">Merkle Root: {restoredBlockResult.merkle_root}</div>
                            <div>Transactions: {restoredBlockResult.tx_count} • Node: {restoredBlockResult.node_id}</div>
                            <div className="text-zinc-400 truncate">Source: {restoredBlockResult.restored_from}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 1C. Global RBAC & Authentication Policy Templates */}
                  <div className="lg:col-span-5 bg-white rounded-2xl border border-zinc-200 p-6 space-y-4 shadow-2xs">
                    <div>
                      <div className="flex items-center gap-2">
                        <Lock className="w-4 h-4 text-purple-600" />
                        <h3 className="font-bold text-sm text-zinc-900">
                          Global RBAC & Passkey Policy Templates
                        </h3>
                      </div>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        Base permission schemas enforced across all hospital tenants.
                      </p>
                    </div>

                    <div className="p-3.5 rounded-xl bg-zinc-50 border border-zinc-200 space-y-2.5 text-xs">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-bold text-zinc-900 block">
                            Mandatory FIDO2 WebAuthn Hardware Passkey
                          </span>
                          <span className="text-[11px] text-zinc-500">
                            Disallow password-only authentication across all portals
                          </span>
                        </div>
                        <button
                          onClick={() => {
                            setEnforceGlobalPasskey(!enforceGlobalPasskey);
                            notify(`Updated global WebAuthn Hardware Passkey enforcement policy.`);
                          }}
                          className={`px-3 py-1 rounded-full text-[11px] font-bold ${
                            enforceGlobalPasskey
                              ? "bg-emerald-600 text-white"
                              : "bg-zinc-200 text-zinc-700"
                          }`}
                        >
                          {enforceGlobalPasskey ? "ENFORCED" : "OPTIONAL"}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2 text-xs">
                      {rbacTemplates.map((tpl) => (
                        <div
                          key={tpl.id}
                          className="p-3 rounded-xl border border-zinc-200 space-y-1.5"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-zinc-900">{tpl.roleTitle}</span>
                            <span className="text-[10px] font-mono text-zinc-500">
                              Timeout: {tpl.sessionTimeoutMinutes}m
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {tpl.canReadClinicalNotes && (
                              <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-semibold">
                                Read EHR
                              </span>
                            )}
                            {tpl.canWriteConsultations && (
                              <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200 text-[10px] font-semibold">
                                Write Notes
                              </span>
                            )}
                            {tpl.canSignPrescriptions && (
                              <span className="px-2 py-0.5 rounded bg-purple-50 text-purple-800 border border-purple-200 text-[10px] font-semibold">
                                Sign Rx
                              </span>
                            )}
                            {tpl.canDispenseMeds && (
                              <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-semibold">
                                Dispense Formulary
                              </span>
                            )}
                            {tpl.canTriggerBreakGlass && (
                              <span className="px-2 py-0.5 rounded bg-rose-50 text-rose-800 border border-rose-200 text-[10px] font-semibold">
                                ER Break-Glass
                              </span>
                            )}
                            {!tpl.canReadClinicalNotes &&
                              !tpl.canWriteConsultations &&
                              !tpl.canDispenseMeds && (
                                <span className="px-2 py-0.5 rounded bg-zinc-100 text-zinc-700 text-[10px] font-semibold">
                                  Administrative Roster & Billing Only
                                </span>
                              )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 1D. Emergency "Break-Glass" Governance */}
                <div className="bg-white rounded-2xl border border-rose-200 p-6 space-y-4 shadow-2xs">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-100 pb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <Flame className="w-4 h-4 text-rose-600" />
                        <h3 className="font-bold text-sm text-zinc-900">
                          Emergency &ldquo;Break-Glass&rdquo; Override Governance
                        </h3>
                      </div>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        Real-time alerts triggered when an ER physician overrides an unconscious patient&apos;s locked record.
                      </p>
                    </div>

                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-zinc-500 font-medium">Max Override Window:</span>
                      <select
                        value={breakGlassWindowMins}
                        onChange={(e) => {
                          setBreakGlassWindowMins(Number(e.target.value));
                          notify(
                            `Emergency break-glass override window set to ${e.target.value} minutes.`
                          );
                        }}
                        className="px-2.5 py-1 rounded-xl border border-zinc-200 font-bold text-zinc-900 bg-zinc-50"
                      >
                        <option value={30}>30 Minutes</option>
                        <option value={60}>60 Minutes (Standard ER)</option>
                        <option value={120}>120 Minutes (Surgical Trauma)</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-3 text-xs">
                    {breakGlassEvents.map((ev) => (
                      <div
                        key={ev.id}
                        className="p-4 rounded-2xl border border-zinc-200 bg-zinc-50/70 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                      >
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded text-[11px]">
                              {ev.id} • {ev.reasonCode}
                            </span>
                            <span className="font-bold text-zinc-900">{ev.erDoctorName}</span>
                            <span className="text-zinc-500">@ {ev.hospitalName}</span>
                            <span className="text-[11px] font-mono text-zinc-400">
                              {ev.timestamp}
                            </span>
                          </div>
                          <p className="text-zinc-700 font-medium">{ev.justification}</p>
                          <p className="text-[11px] font-mono text-zinc-500">
                            Target Anonymized ID: {ev.patientAnonymizedId} • Tx:{" "}
                            {ev.blockchainTxHash.slice(0, 18)}...
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {ev.reviewStatus === "PENDING_GOVERNANCE_REVIEW" ? (
                            <>
                              <button
                                onClick={() =>
                                  handleReviewBreakGlass(ev.id, "JUSTIFIED_APPROVED")
                                }
                                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold text-xs"
                              >
                                Approve Justification
                              </button>
                              <button
                                onClick={() =>
                                  handleReviewBreakGlass(ev.id, "FLAGGED_FOR_INVESTIGATION")
                                }
                                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-semibold text-xs"
                              >
                                Flag Breach
                              </button>
                            </>
                          ) : (
                            <span
                              className={`px-3 py-1 rounded-full text-[11px] font-bold ${
                                ev.reviewStatus === "JUSTIFIED_APPROVED"
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                  : "bg-rose-50 text-rose-700 border border-rose-200"
                              }`}
                            >
                              {ev.reviewStatus === "JUSTIFIED_APPROVED"
                                ? "✓ Clinically Justified"
                                : "⚠ Under Forensic Investigation"}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* =====================================================================
                DOMAIN 2: GLOBAL CLINICAL TAXONOMIES & MASTER DATA (MDM)
               ===================================================================== */}
            {activeTab === "taxonomies" && (
              <div className="space-y-8">
                {/* 2A. Unified Medical Dictionaries (ICD-11, LOINC, SNOMED CT, RxNorm) */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  <div className="lg:col-span-8 bg-white rounded-2xl border border-zinc-200 p-6 space-y-4 shadow-2xs">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <h3 className="font-bold text-sm text-zinc-900">
                          Unified Clinical Coding Standards (ICD-11, LOINC, SNOMED CT, RxNorm)
                        </h3>
                        <p className="text-xs text-zinc-500">
                          Master medical dictionaries synchronized across all hospitals so cross-clinic patient records remain semantically interoperable.
                        </p>
                      </div>
                      <div className="flex gap-1 bg-zinc-100 p-1 rounded-xl text-[11px] font-semibold">
                        {(["ALL", "ICD-11", "LOINC", "SNOMED-CT", "RxNorm"] as const).map((std) => (
                          <button
                            key={std}
                            onClick={() => setCodeFilter(std)}
                            className={`px-2.5 py-1 rounded-lg transition-all ${
                              codeFilter === std
                                ? "bg-white text-zinc-900 shadow-2xs"
                                : "text-zinc-600 hover:text-zinc-900"
                            }`}
                          >
                            {std}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 gap-2">
                      <Search className="w-4 h-4 text-zinc-400" />
                      <input
                        type="text"
                        value={codeSearch}
                        onChange={(e) => setCodeSearch(e.target.value)}
                        placeholder="Search master clinical code, diagnosis, LOINC observation, or RxNorm medication..."
                        className="bg-transparent text-xs w-full focus:outline-none"
                      />
                    </div>

                    <div className="divide-y divide-zinc-100 text-xs">
                      {filteredClinicalCodes.map((item) => (
                        <div key={item.id} className="py-3 flex items-center justify-between gap-4">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200 font-mono font-bold text-[11px]">
                                {item.standard}: {item.code}
                              </span>
                              <span className="font-bold text-zinc-900">{item.display}</span>
                            </div>
                            <p className="text-[11px] text-zinc-500 mt-0.5">
                              Category: {item.category} • Version: {item.version}
                            </p>
                          </div>
                          <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 rounded-full shrink-0">
                            Synced Across Tenants
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Publish New Master Code Form */}
                  <div className="lg:col-span-4 bg-zinc-50/80 rounded-2xl border border-zinc-200 p-6 space-y-4 shadow-2xs">
                    <div className="flex items-center gap-2">
                      <Plus className="w-4 h-4 text-emerald-600" />
                      <h3 className="font-bold text-sm text-zinc-900">
                        Publish Master Clinical Code
                      </h3>
                    </div>
                    <p className="text-xs text-zinc-500">
                      Add a standardized diagnosis, lab observation, or medication code to the global MDM catalog.
                    </p>

                    <form onSubmit={handleAddClinicalCode} className="space-y-3 text-xs">
                      <div>
                        <label className="font-semibold text-zinc-700 block mb-1">
                          Coding Standard
                        </label>
                        <select
                          value={newCodeStandard}
                          onChange={(e) => setNewCodeStandard(e.target.value as any)}
                          className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white font-semibold"
                        >
                          <option value="ICD-11">WHO ICD-11 (Diagnosis)</option>
                          <option value="LOINC">LOINC (Lab Observation)</option>
                          <option value="SNOMED-CT">SNOMED CT (Clinical Term)</option>
                          <option value="RxNorm">RxNorm (Medication Formulary)</option>
                        </select>
                      </div>

                      <div>
                        <label className="font-semibold text-zinc-700 block mb-1">
                          Standard Code Identifier
                        </label>
                        <input
                          type="text"
                          value={newCodeVal}
                          onChange={(e) => setNewCodeVal(e.target.value)}
                          placeholder="e.g. 1F40.0 (Plasmodium falciparum malaria)"
                          className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white"
                          required
                        />
                      </div>

                      <div>
                        <label className="font-semibold text-zinc-700 block mb-1">
                          Official Clinical Term / Display Name
                        </label>
                        <input
                          type="text"
                          value={newCodeDisplay}
                          onChange={(e) => setNewCodeDisplay(e.target.value)}
                          placeholder="e.g. Malaria due to Plasmodium falciparum"
                          className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white"
                          required
                        />
                      </div>

                      <div>
                        <label className="font-semibold text-zinc-700 block mb-1">
                          Clinical Domain
                        </label>
                        <input
                          type="text"
                          value={newCodeCategory}
                          onChange={(e) => setNewCodeCategory(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white"
                        />
                      </div>

                      <button
                        type="submit"
                        className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl font-semibold text-xs transition-colors"
                      >
                        Publish to Global MDM Dictionary
                      </button>
                    </form>
                  </div>
                </div>

                {/* 2B. National Drug Formulary & Automated Interaction Warning Rules */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  <div className="lg:col-span-6 bg-white rounded-2xl border border-zinc-200 p-6 space-y-4 shadow-2xs">
                    <div className="flex items-center gap-2">
                      <Pill className="w-4 h-4 text-rose-600" />
                      <h3 className="font-bold text-sm text-zinc-900">
                        Automated Drug-Drug & Drug-Allergy Interaction Rules
                      </h3>
                    </div>
                    <p className="text-xs text-zinc-500">
                      Real-time clinical decision support rules evaluated whenever any hospital physician signs a prescription.
                    </p>

                    <div className="space-y-3 text-xs">
                      {interactionRules.map((rule) => (
                        <div
                          key={rule.id}
                          className="p-3.5 rounded-xl border border-zinc-200 bg-zinc-50/60 space-y-1.5"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-zinc-900">
                              {rule.primaryAgent} + {rule.interactingAgent}
                            </span>
                            <button
                              onClick={() => handleToggleDrugRule(rule.id)}
                              className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                                rule.isActive
                                  ? "bg-rose-100 text-rose-800 border border-rose-300"
                                  : "bg-zinc-200 text-zinc-600"
                              }`}
                            >
                              {rule.isActive ? `${rule.severity} • ACTIVE` : "DISABLED"}
                            </button>
                          </div>
                          <p className="text-[11px] text-zinc-600">{rule.clinicalAlert}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 2C. Standardized Encounter Templates */}
                  <div className="lg:col-span-6 bg-white rounded-2xl border border-zinc-200 p-6 space-y-4 shadow-2xs">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-emerald-600" />
                      <h3 className="font-bold text-sm text-zinc-900">
                        Standardized Clinical Encounter Templates
                      </h3>
                    </div>
                    <p className="text-xs text-zinc-500">
                      Baseline WHO & MINSANTÉ clinical sheets published for hospital adoption.
                    </p>

                    <div className="space-y-3 text-xs">
                      {encounterTemplates.map((tpl) => (
                        <div
                          key={tpl.id}
                          className="p-3.5 rounded-xl border border-zinc-200 bg-zinc-50/60 space-y-2"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="font-bold text-zinc-900">{tpl.title}</span>
                              <span className="ml-2 font-mono text-[10px] text-zinc-500">
                                ({tpl.code} • {tpl.version})
                              </span>
                            </div>
                            <span className="text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full">
                              {tpl.adoptedByTenants}/{tpl.totalTenants} Tenants Adopted
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {tpl.mandatoryFields.map((f, i) => (
                              <span
                                key={i}
                                className="px-2 py-0.5 rounded bg-white border border-zinc-200 text-[10px] text-zinc-600"
                              >
                                {f}
                              </span>
                            ))}
                          </div>
                          {tpl.adoptedByTenants < tpl.totalTenants && (
                            <button
                              onClick={() => handlePublishTemplateAllTenants(tpl.id)}
                              className="text-[11px] font-bold text-emerald-700 hover:underline"
                            >
                              Push Mandatory Sync to Remaining Tenants →
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* =====================================================================
                DOMAIN 3: CROSS-TENANT INTEROPERABILITY & DATA EXCHANGE
               ===================================================================== */}
            {activeTab === "interoperability" && (
              <div className="space-y-8">
                {/* 3A. Consent & Referral Routing Broker */}
                <div className="bg-white rounded-2xl border border-zinc-200 p-6 space-y-4 shadow-2xs">
                  <div>
                    <div className="flex items-center gap-2">
                      <Network className="w-4 h-4 text-cyan-600" />
                      <h3 className="font-bold text-sm text-zinc-900">
                        Cross-Tenant Consent & Proxy Re-Encryption Referral Broker
                      </h3>
                    </div>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Routes inter-hospital referrals and verifies Shamir Proxy Re-Encryption (PRE) tokens authorizing Hospital B to decrypt records originated at Hospital A.
                    </p>
                  </div>

                  <div className="divide-y divide-zinc-100 text-xs">
                    {referralRoutes.map((ref) => (
                      <div
                        key={ref.id}
                        className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-cyan-800 bg-cyan-50 border border-cyan-200 px-2 py-0.5 rounded text-[11px]">
                              {ref.id}
                            </span>
                            <span className="font-bold text-zinc-900">{ref.sourceTenant}</span>
                            <span className="text-zinc-400">→</span>
                            <span className="font-bold text-zinc-900">{ref.destinationTenant}</span>
                          </div>
                          <p className="text-[11px] text-zinc-600">
                            Payload: <strong>{ref.fhirBundleType}</strong> • Patient DID:{" "}
                            <span className="font-mono">{ref.patientAnonymizedDid}</span>
                          </p>
                        </div>

                        <div className="text-right">
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            ● {ref.reEncryptionKeyStatus}
                          </span>
                          <p className="text-[10px] font-mono text-zinc-400 mt-1">
                            Tx: {ref.blockchainTxHash.slice(0, 16)}...
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 3B. External HL7/FHIR Gateways & 3C. Master Patient Index (MPI) Deduplication */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  <div className="lg:col-span-6 bg-white rounded-2xl border border-zinc-200 p-6 space-y-4 shadow-2xs">
                    <div>
                      <h3 className="font-bold text-sm text-zinc-900">
                        External API, PACS/DICOM & HL7/FHIR Gateways
                      </h3>
                      <p className="text-xs text-zinc-500">
                        Connected national insurance clearinghouses, imaging centers, and public health surveillance endpoints.
                      </p>
                    </div>

                    <div className="space-y-3 text-xs">
                      {fhirGateways.map((gw) => (
                        <div
                          key={gw.id}
                          className="p-3.5 rounded-xl border border-zinc-200 bg-zinc-50/60 flex items-center justify-between gap-3"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-zinc-900">{gw.name}</span>
                              <span className="text-[10px] font-mono bg-white px-1.5 py-0.5 rounded border border-zinc-200">
                                {gw.protocol}
                              </span>
                            </div>
                            <p className="text-[11px] font-mono text-zinc-500">{gw.endpointUrl}</p>
                            <p className="text-[10px] text-zinc-400">
                              mTLS: {gw.mtlsStatus} • {gw.dailyTransactions} exchanges/24h
                            </p>
                          </div>

                          <button
                            onClick={() => handleToggleFhirGateway(gw.id)}
                            className={`px-3 py-1 rounded-xl text-[11px] font-bold shrink-0 ${
                              gw.status === "ONLINE"
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                : "bg-amber-50 text-amber-700 border border-amber-200"
                            }`}
                          >
                            {gw.status}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 3C. MPI Deduplication */}
                  <div className="lg:col-span-6 bg-white rounded-2xl border border-zinc-200 p-6 space-y-4 shadow-2xs">
                    <div>
                      <h3 className="font-bold text-sm text-zinc-900">
                        Master Patient Index (MPI) Privacy-Preserving Deduplication
                      </h3>
                      <p className="text-xs text-zinc-500">
                        Zero-knowledge record-linkage protocol resolving duplicate patient identities across clinics.
                      </p>
                    </div>

                    <div className="space-y-3 text-xs">
                      {mpiCandidates.map((cand) => (
                        <div
                          key={cand.id}
                          className="p-4 rounded-xl border border-zinc-200 bg-zinc-50/60 space-y-2.5"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-zinc-900">
                              {cand.id} • Match Confidence: {cand.biometricHashMatchConfidence}%
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                cand.status === "MERGED_ON_CHAIN"
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                  : cand.status === "PENDING_LINKAGE"
                                  ? "bg-amber-50 text-amber-700 border border-amber-200"
                                  : "bg-zinc-100 text-zinc-600"
                              }`}
                            >
                              {cand.status}
                            </span>
                          </div>
                          <div className="text-[11px] text-zinc-600 space-y-0.5">
                            <p>
                              Primary Booklet: <span className="font-mono">{cand.primaryDid}</span> (
                              {cand.primaryClinic})
                            </p>
                            <p>
                              Walk-in Duplicate:{" "}
                              <span className="font-mono">{cand.duplicateDid}</span> (
                              {cand.duplicateClinic})
                            </p>
                            <p className="text-[10px] font-mono text-zinc-400">
                              ZK-Proof: {cand.zkProofHash}
                            </p>
                          </div>

                          {cand.status === "PENDING_LINKAGE" && (
                            <div className="flex gap-2 pt-1">
                              <button
                                onClick={() =>
                                  handleResolveMpiCandidate(cand.id, "MERGED_ON_CHAIN")
                                }
                                className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl font-semibold text-xs"
                              >
                                Link & Merge DIDs On-Chain
                              </button>
                              <button
                                onClick={() => handleResolveMpiCandidate(cand.id, "DISMISSED")}
                                className="px-3 py-1.5 border border-zinc-200 text-zinc-600 hover:bg-zinc-100 rounded-xl font-semibold text-xs"
                              >
                                Dismiss
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* =====================================================================
                DOMAIN 4: COMPLIANCE, IMMUTABLE AUDITING & FORENSICS
               ===================================================================== */}
            {activeTab === "compliance" && (
              <div className="space-y-8">
                {/* Top Action Header */}
                <div className="bg-zinc-900 text-white rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <EyeOff className="w-4 h-4 text-emerald-400" />
                      <h3 className="font-bold text-sm">
                        Zero-Clinical-Access Forensics & Regulatory Custody
                      </h3>
                    </div>
                    <p className="text-xs text-zinc-300 max-w-2xl">
                      System Administrators inspect metadata-level access logs (Actor DID, Device Token, IP Subnet, Authorization Basis) without decrypting clinical notes. Specific audit trails can be frozen under cryptographic Legal Hold.
                    </p>
                  </div>

                  <button
                    onClick={handleExportRegulatoryReport}
                    className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-semibold text-xs flex items-center gap-2 shrink-0 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export Regulatory & Epidemiological Report (JSON)</span>
                  </button>
                </div>

                {/* 4A. Anomaly & Breach Detection */}
                <div className="bg-white rounded-2xl border border-zinc-200 p-6 space-y-4 shadow-2xs">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-600" />
                    <h3 className="font-bold text-sm text-zinc-900">
                      Cross-Tenant Anomaly & Breach Detection Engine
                    </h3>
                  </div>

                  <div className="space-y-3 text-xs">
                    {anomalies.map((anom) => (
                      <div
                        key={anom.id}
                        className="p-4 rounded-xl border border-zinc-200 bg-zinc-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                anom.severity === "CRITICAL"
                                  ? "bg-rose-100 text-rose-800 border border-rose-300"
                                  : "bg-amber-100 text-amber-800 border border-amber-300"
                              }`}
                            >
                              {anom.severity} • {anom.patternType}
                            </span>
                            <span className="font-bold text-zinc-900">{anom.tenantName}</span>
                            <span className="font-mono text-[11px] text-zinc-500">
                              Actor: {anom.suspectActorDid}
                            </span>
                          </div>
                          <p className="text-zinc-700">{anom.description}</p>
                        </div>

                        <div className="shrink-0">
                          {anom.status === "ACTIVE_ALERT" ? (
                            <button
                              onClick={() => handleQuarantineAnomaly(anom.id)}
                              className="px-3.5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-semibold text-xs"
                            >
                              Quarantine Actor & Throttle Tenant
                            </button>
                          ) : (
                            <span className="px-3 py-1 rounded-full bg-zinc-200 text-zinc-700 font-bold text-[11px]">
                              ✓ Actor Quarantined
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 4B. Metadata-Only Immutable Audit Log & Legal Hold */}
                <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden shadow-2xs">
                  <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between">
                    <h3 className="font-bold text-sm text-zinc-900">
                      Immutable Metadata Access Logs & Subpoena Legal Holds
                    </h3>
                    <span className="text-[11px] text-zinc-500">
                      Clinical Notes Redacted by Hardware Enclave
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-zinc-100 bg-zinc-50/60 text-[11px] text-zinc-400 font-semibold">
                          <th className="py-3 px-4">Timestamp</th>
                          <th className="py-3 px-4">Actor DID & Role</th>
                          <th className="py-3 px-4">Tenant</th>
                          <th className="py-3 px-4">Target Booklet Hash</th>
                          <th className="py-3 px-4">Authorization Basis</th>
                          <th className="py-3 px-4">Device / IP</th>
                          <th className="py-3 px-4 text-right">Legal Hold</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100">
                        {metadataLogs.map((log) => (
                          <tr key={log.id} className="hover:bg-zinc-50/50">
                            <td className="py-3.5 px-4 font-mono text-zinc-500 whitespace-nowrap">
                              {log.timestamp}
                            </td>
                            <td className="py-3.5 px-4">
                              <span className="font-mono font-bold text-zinc-900 block">
                                {log.actorDid}
                              </span>
                              <span className="text-[10px] text-zinc-500">{log.actorRole}</span>
                            </td>
                            <td className="py-3.5 px-4 font-semibold text-zinc-800">
                              {log.tenantName}
                            </td>
                            <td className="py-3.5 px-4 font-mono text-[11px] text-zinc-500">
                              {log.targetBookletHash}
                            </td>
                            <td className="py-3.5 px-4">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  log.authorizationBasis === "EMERGENCY_BREAK_GLASS"
                                    ? "bg-rose-50 text-rose-700 border border-rose-200"
                                    : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                }`}
                              >
                                {log.authorizationBasis}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 font-mono text-[11px] text-zinc-500">
                              {log.deviceTokenUsed} ({log.ipSubnet})
                            </td>
                            <td className="py-3.5 px-4 text-right">
                              <button
                                onClick={() => handleToggleLegalHold(log.id)}
                                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                                  log.legalHoldFrozen
                                    ? "bg-amber-100 text-amber-900 border border-amber-300"
                                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                                }`}
                              >
                                {log.legalHoldFrozen ? "🔒 Frozen (Subpoena)" : "Freeze Trail"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* =====================================================================
                DOMAIN 5: MULTI-TENANT OPERATIONS, QUOTAS & BILLING
               ===================================================================== */}
            {activeTab === "tenants" && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 gap-6">
                  {tenants.map((tenant) => {
                    const storagePct = Math.round(
                      (tenant.imagingStorageUsedGb / tenant.imagingStorageQuotaGb) * 100
                    );
                    return (
                      <div
                        key={tenant.id}
                        className="bg-white rounded-2xl border border-zinc-200 p-6 space-y-4 shadow-2xs"
                      >
                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-zinc-100 pb-4">
                          <div>
                            <div className="flex flex-wrap items-center gap-2.5">
                              <h3 className="font-bold text-base text-zinc-900">{tenant.name}</h3>
                              <span className="font-mono text-[11px] bg-zinc-100 text-zinc-700 px-2 py-0.5 rounded">
                                {tenant.code}
                              </span>
                              <span className="text-[11px] font-semibold bg-purple-50 text-purple-800 border border-purple-200 px-2.5 py-0.5 rounded-full">
                                {tenant.tier}
                              </span>
                              <span className="text-[11px] font-mono bg-blue-50 text-blue-800 border border-blue-200 px-2 py-0.5 rounded">
                                {tenant.isolationMode}
                              </span>
                            </div>
                            <p className="text-xs text-zinc-500 mt-1">
                              Last Geo-Redundant Cold Backup:{" "}
                              <strong className="text-zinc-700">{tenant.lastColdBackupAt}</strong>
                            </p>
                          </div>

                          <div className="flex items-center gap-2.5">
                            <button
                              onClick={() => handleTriggerColdBackup(tenant.id)}
                              className="px-3 py-1.5 border border-zinc-200 hover:bg-zinc-50 rounded-xl text-xs font-semibold flex items-center gap-1.5"
                            >
                              <HardDrive className="w-3.5 h-3.5 text-zinc-600" />
                              <span>Verify PITR Snapshot</span>
                            </button>

                            <button
                              onClick={() => handleToggleTenantComplianceMode(tenant.id)}
                              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                                tenant.operationalState === "ACTIVE"
                                  ? "bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-amber-50 hover:text-amber-800"
                                  : "bg-amber-100 text-amber-900 border border-amber-300"
                              }`}
                            >
                              {tenant.operationalState === "ACTIVE"
                                ? "● ACTIVE (Full Read/Write)"
                                : "⚠ READ-ONLY COMPLIANCE MODE (Delinquent)"}
                            </button>
                          </div>
                        </div>

                        {/* Quotas & Feature Flags */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs">
                          <div className="space-y-1.5">
                            <div className="flex justify-between font-semibold">
                              <span className="text-zinc-600">
                                PACS / DICOM Medical Imaging Quota
                              </span>
                              <span className="text-zinc-900">
                                {tenant.imagingStorageUsedGb} / {tenant.imagingStorageQuotaGb} GB (
                                {storagePct}%)
                              </span>
                            </div>
                            <div className="w-full h-2 bg-zinc-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  storagePct > 80 ? "bg-amber-500" : "bg-emerald-500"
                                }`}
                                style={{ width: `${storagePct}%` }}
                              />
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <div className="flex justify-between font-semibold">
                              <span className="text-zinc-600">Noisy-Neighbor API Rate Limit</span>
                              <span className="text-zinc-900">
                                {tenant.currentLoadReqPerMin} / {tenant.rateLimitReqPerMin} req/min
                              </span>
                            </div>
                            <div className="w-full h-2 bg-zinc-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-blue-500 rounded-full"
                                style={{
                                  width: `${Math.round(
                                    (tenant.currentLoadReqPerMin / tenant.rateLimitReqPerMin) * 100
                                  )}%`,
                                }}
                              />
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <span className="font-semibold text-zinc-600 block">
                              Licensed Modular Add-Ons (Feature Flags)
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {(
                                [
                                  ["telemedicineModule", "Telemedicine"],
                                  ["pharmacyInventory", "Pharmacy Inventory"],
                                  ["aiTriageAssistant", "AI Triage"],
                                  ["pacsDicomGateway", "PACS Gateway"],
                                ] as const
                              ).map(([key, label]) => {
                                const enabled = tenant.featureFlags[key];
                                return (
                                  <button
                                    key={key}
                                    onClick={() => handleToggleTenantFeature(tenant.id, key)}
                                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
                                      enabled
                                        ? "bg-zinc-900 text-white border-zinc-900"
                                        : "bg-zinc-50 text-zinc-400 border-zinc-200"
                                    }`}
                                  >
                                    {enabled ? "✓ " : "+ "}
                                    {label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* =====================================================================
                DOMAIN 6: BOUNDARY COMPARISON MATRIX (SYSTEM ADMIN VS HOSPITAL MANAGER)
               ===================================================================== */}
            {activeTab === "boundaries" && (
              <div className="space-y-6">
                <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden shadow-2xs">
                  <div className="p-6 border-b border-zinc-100">
                    <h3 className="font-bold text-base text-zinc-900">
                      Architectural Separation of Duties: System Admin vs. Hospital Manager
                    </h3>
                    <p className="text-xs text-zinc-500 mt-1">
                      Strict cryptographic and operational boundary separating Platform-Level Governance from Tenant-Level Hospital Administration.
                    </p>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-zinc-900 text-white text-[11px] font-bold uppercase tracking-wider">
                          <th className="py-3.5 px-6">Domain</th>
                          <th className="py-3.5 px-6">System Admin (Platform Level)</th>
                          <th className="py-3.5 px-6">Hospital Manager (Tenant Level)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-200">
                        <tr>
                          <td className="py-4 px-6 font-bold text-zinc-900">Scope</td>
                          <td className="py-4 px-6 text-zinc-700">
                            Global ecosystem across all clinics, labs, and pharmacies
                          </td>
                          <td className="py-4 px-6 text-zinc-700">
                            Single hospital or clinic branch (e.g., Hôpital Central de Yaoundé)
                          </td>
                        </tr>
                        <tr>
                          <td className="py-4 px-6 font-bold text-zinc-900">User Management</td>
                          <td className="py-4 px-6 text-zinc-700">
                            Verifies medical licenses globally against national boards; manages root identity & emergency revocations
                          </td>
                          <td className="py-4 px-6 text-zinc-700">
                            Assigns verified doctors/nurses to local departments, wards, and shifts
                          </td>
                        </tr>
                        <tr>
                          <td className="py-4 px-6 font-bold text-zinc-900">
                            Patient Data Access
                          </td>
                          <td className="py-4 px-6 font-semibold text-emerald-800 bg-emerald-50/50">
                            Zero clinical access (views anonymized metadata & cryptographic audit logs only)
                          </td>
                          <td className="py-4 px-6 text-zinc-700">
                            Administrative access to local patient rosters, triage intake, and billing disputes
                          </td>
                        </tr>
                        <tr>
                          <td className="py-4 px-6 font-bold text-zinc-900">Catalogs & MDM</td>
                          <td className="py-4 px-6 text-zinc-700">
                            Updates master ICD-11, LOINC, SNOMED CT, and national drug interaction databases
                          </td>
                          <td className="py-4 px-6 text-zinc-700">
                            Configures local service prices, room rates, and local pharmacy stock
                          </td>
                        </tr>
                        <tr>
                          <td className="py-4 px-6 font-bold text-zinc-900">Security & Audits</td>
                          <td className="py-4 px-6 text-zinc-700">
                            Monitors cross-tenant breaches, break-glass alerts, legal holds, and KSM/PBFT cryptographic nodes
                          </td>
                          <td className="py-4 px-6 text-zinc-700">
                            Reviews local staff attendance and internal clinic workflow bottlenecks
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
