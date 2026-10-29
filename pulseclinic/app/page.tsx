"use client";

import React, { useState, useEffect } from "react";
import PulseClinicPortal from "@/components/PulseClinicPortal";
import DoctorPortal from "@/components/DoctorPortal";
import HospitalAdminPortal from "@/components/HospitalAdminPortal";
import SystemAdminPortal from "@/components/SystemAdminPortal";
import AuthLandingPage from "@/components/AuthLandingPage";
import WebAuthnAuthModal from "@/components/WebAuthnAuthModal";
import DeviceBroadcastConfirmationModal from "@/components/DeviceBroadcastConfirmationModal";
import ClientNodeStatusBadge from "@/components/ClientNodeStatusBadge";
import { StoredCredential } from "@/lib/webauthn";
import { DEFAULT_DEMO_USER, ALL_DEMO_CREDENTIALS, getRolesForCredential } from "@/lib/medicalStore";
import { PortalType } from "@/lib/multiPortalStore";
import {
  DeviceProfile,
  BroadcastConfirmationMessage,
  getOrCreateDeviceProfile,
  deviceBroadcastService,
} from "@/lib/deviceToken";
import { Radio, Copy, Check } from "lucide-react";

interface PendingRoleInvitation {
  id: string;
  hospitalName: string;
  role: "DOCTOR" | "HOSPITAL_STAFF";
  department: string;
}

export default function Home() {
  const [currentUser, setCurrentUser] = useState<StoredCredential | null>(DEFAULT_DEMO_USER);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [storedCredentials, setStoredCredentials] = useState<StoredCredential[]>(ALL_DEMO_CREDENTIALS);

  // Multi-Portal Navigation & Role Capabilities
  const [activePortal, setActivePortal] = useState<PortalType>("patient");
  const [availableRoles, setAvailableRoles] = useState<string[]>(() =>
    getRolesForCredential(DEFAULT_DEMO_USER)
  );
  const [pendingRoleInvitations, setPendingRoleInvitations] = useState<PendingRoleInvitation[]>([
    {
      id: "inv-cardio-01",
      hospitalName: "Hôpital Central de Yaoundé (HCY)",
      role: "DOCTOR",
      department: "Cardiologie & Médecine Interne",
    },
  ]);

  // Role & Hospital connection checks:
  // Must have a role connected to a hospital (Doctor role somewhere, or Hospital role somewhere)
  // or System Admin role somewhere.
  const hasDoctorRole = availableRoles.includes("DOCTOR");
  const hasHospitalRole =
    availableRoles.includes("HOSPITAL_STAFF") ||
    availableRoles.includes("ADMIN") ||
    availableRoles.includes("HOSPITAL_ADMIN");
  const hasSysAdminRole = availableRoles.includes("SYSTEM_ADMIN");

  // Portal Switcher visibility rule: ONLY appear if you have at least one authorized role beyond standard patient
  const canSwitchPortal = hasDoctorRole || hasHospitalRole || hasSysAdminRole;

  // Auto-fallback: if current active portal is no longer permitted, return safely to patient view
  useEffect(() => {
    if (activePortal === "doctor" && !hasDoctorRole) {
      setActivePortal("patient");
    } else if (activePortal === "hospital" && !hasHospitalRole) {
      setActivePortal("patient");
    } else if (activePortal === "sysadmin" && !hasSysAdminRole) {
      setActivePortal("patient");
    }
  }, [activePortal, hasDoctorRole, hasHospitalRole, hasSysAdminRole]);

  // Device Token & Real-time Broadcast State
  const [deviceProfile, setDeviceProfile] = useState<DeviceProfile | null>(null);
  const [activeBroadcastMessage, setActiveBroadcastMessage] = useState<BroadcastConfirmationMessage | null>(null);
  const [copiedDeviceToken, setCopiedDeviceToken] = useState(false);
  const [broadcastNotice, setBroadcastNotice] = useState<string | null>(null);

  useEffect(() => {
    // 1. Initialize device profile & token
    const profile = getOrCreateDeviceProfile();
    setDeviceProfile(profile);

    // 2. Subscribe to real-time broadcast confirmation messages
    const unsubscribe = deviceBroadcastService.subscribe((msg) => {
      setActiveBroadcastMessage(msg);
    });

    // 3. Load credentials from localStorage
    if (typeof window !== "undefined") {
      try {
        const raw = localStorage.getItem("pulse_clinic_creds");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setStoredCredentials(parsed);
            const activeId = localStorage.getItem("pulse_clinic_active_user");
            const matched = parsed.find((c: StoredCredential) => c.id === activeId);
            if (matched) {
              setCurrentUser(matched);
              setAvailableRoles(getRolesForCredential(matched));
            }
          }
        } else {
          localStorage.setItem("pulse_clinic_creds", JSON.stringify(ALL_DEMO_CREDENTIALS));
        }
      } catch (err) {
        console.error("Failed to parse stored credentials", err);
      }
    }

    return () => {
      unsubscribe();
    };
  }, []);

  const handleAuthenticated = (cred: StoredCredential) => {
    setCurrentUser(cred);
    setIsAuthModalOpen(false);
    const roles = getRolesForCredential(cred);
    setAvailableRoles(roles);

    if (!roles.includes("DOCTOR")) {
      setPendingRoleInvitations([
        {
          id: `inv-${Date.now().toString().slice(-4)}`,
          hospitalName: "Hôpital Central de Yaoundé (HCY)",
          role: "DOCTOR",
          department: "Cardiologie & Médecine Interne",
        },
      ]);
    } else {
      setPendingRoleInvitations([]);
    }

    setActivePortal("patient");
    if (typeof window !== "undefined") {
      localStorage.setItem("pulse_clinic_active_user", cred.id);
    }
  };

  const handleSignOut = () => {
    setCurrentUser(null);
    if (typeof window !== "undefined") {
      localStorage.removeItem("pulse_clinic_active_user");
    }
  };

  const handleApproveRoleInvitation = (
    invitationId: string,
    role: "DOCTOR" | "HOSPITAL_STAFF",
    department: string
  ) => {
    setPendingRoleInvitations((prev) => prev.filter((i) => i.id !== invitationId));
    setAvailableRoles((prev) => (prev.includes(role) ? prev : [...prev, role]));
    setBroadcastNotice(
      `Role Keypair Minted on-chain! You are now connected to the hospital as ${role} (${department}). Portal switcher is now unlocked.`
    );
    setTimeout(() => {
      setBroadcastNotice(null);
    }, 6000);

    setTimeout(() => {
      if (role === "DOCTOR") {
        setActivePortal("doctor");
      } else if (role === "HOSPITAL_STAFF") {
        setActivePortal("hospital");
      }
    }, 400);
  };

  const handleHospitalInviteStaff = (
    email: string,
    role: "DOCTOR" | "HOSPITAL_STAFF",
    department: string
  ) => {
    const newInv: PendingRoleInvitation = {
      id: `inv-${Date.now().toString().slice(-4)}`,
      hospitalName: "Pulse Central Hospital",
      role,
      department,
    };
    setPendingRoleInvitations((prev) => [newInv, ...prev]);

    // Also broadcast an invite alert to the user's connected device
    deviceBroadcastService.broadcastMessage({
      id: `bc-inv-${Date.now()}`,
      type: "HOSPITAL_ROLE_INVITE",
      title: `Hospital Staff Delegation: ${role}`,
      description: `Pulse Central Hospital has invited you to assume the role of ${role} (${department}). Confirm on this device to mint your role keypair.`,
      requesterName: "Pulse Central Admin",
      requesterRole: "HOSPITAL_ADMIN",
      hospitalName: "Pulse Central Hospital",
      payload: { role, department, email },
      createdAt: new Date().toISOString(),
      status: "PENDING",
    });
  };

  const handleConfirmBroadcast = (msg: BroadcastConfirmationMessage) => {
    setActiveBroadcastMessage(null);
    setBroadcastNotice(`Confirmed on Device (${deviceProfile?.deviceName})! Action cryptographically signed.`);
    setTimeout(() => setBroadcastNotice(null), 4000);
  };

  const handleDenyBroadcast = (msg: BroadcastConfirmationMessage) => {
    setActiveBroadcastMessage(null);
    setBroadcastNotice(`Denied on Device (${deviceProfile?.deviceName}). Access refused.`);
    setTimeout(() => setBroadcastNotice(null), 4000);
  };

  const copyDeviceToken = () => {
    if (deviceProfile) {
      navigator.clipboard.writeText(deviceProfile.deviceToken);
      setCopiedDeviceToken(true);
      setTimeout(() => setCopiedDeviceToken(false), 2000);
    }
  };

  return (
    <div className="min-h-screen">
      {currentUser ? (
        <>
          {/* Top subtle utility & portal switcher bar */}
          <div className="bg-zinc-900 text-white px-4 py-2 text-xs flex flex-wrap items-center justify-between gap-3 shadow-sm border-b border-zinc-800">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span className="font-semibold text-emerald-300">{currentUser.user.name}</span>
                {currentUser.hospitalName && (
                  <span className="hidden sm:inline text-[10px] bg-zinc-800 text-zinc-300 border border-zinc-700 px-2 py-0.5 rounded-full">
                    {currentUser.hospitalName.includes("(") ? currentUser.hospitalName.split("(")[1].replace(")", "") : currentUser.hospitalName}
                  </span>
                )}
              </div>

              {/* Active Device Token Badge */}
              {deviceProfile && (
                <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-zinc-800 border border-zinc-700 text-[11px] text-zinc-300">
                  <Radio className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span className="font-mono text-[10px] text-emerald-300">
                    {deviceProfile.deviceToken.slice(0, 18)}...
                  </span>
                  <button
                    onClick={copyDeviceToken}
                    className="hover:text-white p-0.5"
                    title="Copy Active Device Token"
                  >
                    {copiedDeviceToken ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3 text-zinc-400" />
                    )}
                  </button>
                </div>
              )}

              {/* Distributed Client Node Gateway Badge */}
              <ClientNodeStatusBadge />
            </div>

            {/* Portal Switcher Buttons: ONLY appears if user has a role connected to a hospital or system admin */}
            {canSwitchPortal && (
              <div className="flex items-center gap-1.5 bg-zinc-800/80 p-1 rounded-xl border border-zinc-700/60 animate-in fade-in duration-200">
                <button
                  type="button"
                  onClick={() => setActivePortal("patient")}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                    activePortal === "patient"
                      ? "bg-white text-zinc-900 shadow-xs"
                      : "text-zinc-300 hover:text-white"
                  }`}
                >
                  Patient Portal
                </button>

                {hasDoctorRole && (
                  <button
                    type="button"
                    onClick={() => setActivePortal("doctor")}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                      activePortal === "doctor"
                        ? "bg-white text-zinc-900 shadow-xs"
                        : "text-zinc-300 hover:text-white"
                    }`}
                  >
                    <span>Doctor Portal</span>
                    <span className="text-[9px] bg-emerald-500/20 text-emerald-300 px-1 py-0.2 rounded font-mono">
                      Affiliated
                    </span>
                  </button>
                )}

                {hasHospitalRole && (
                  <button
                    type="button"
                    onClick={() => setActivePortal("hospital")}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                      activePortal === "hospital"
                        ? "bg-white text-zinc-900 shadow-xs"
                        : "text-zinc-300 hover:text-white"
                    }`}
                  >
                    <span>Hospital Manager</span>
                    <span className="text-[9px] bg-blue-500/20 text-blue-300 px-1 py-0.2 rounded font-mono">
                      Tenant
                    </span>
                  </button>
                )}

                {hasSysAdminRole && (
                  <button
                    type="button"
                    onClick={() => setActivePortal("sysadmin")}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                      activePortal === "sysadmin"
                        ? "bg-purple-500 text-white shadow-xs"
                        : "text-purple-300 hover:text-white"
                    }`}
                  >
                    <span>System Admin</span>
                    <span className="text-[9px] bg-purple-400/30 text-purple-200 px-1 py-0.2 rounded font-mono">
                      Platform
                    </span>
                  </button>
                )}
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsAuthModalOpen(true)}
                className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg text-xs font-medium transition-colors"
              >
                Passkey Identity
              </button>

              <button
                type="button"
                onClick={handleSignOut}
                className="px-2.5 py-1 text-zinc-400 hover:text-white rounded-lg text-xs transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>

          {/* Feedback banner after confirmation */}
          {broadcastNotice && (
            <div className="bg-emerald-600 text-white px-4 py-2 text-xs font-medium flex items-center justify-center gap-2 shadow-sm animate-in fade-in">
              <Radio className="w-3.5 h-3.5" />
              <span>{broadcastNotice}</span>
            </div>
          )}

          {/* RENDER ACTIVE PORTAL */}
          {activePortal === "patient" && (
            <PulseClinicPortal
              credential={currentUser}
              onSignOut={handleSignOut}
              onOpenAuthModal={() => setIsAuthModalOpen(true)}
              onSwitchPortal={(p) => setActivePortal(p)}
              availableRoles={availableRoles}
              pendingRoleInvitations={pendingRoleInvitations}
              onApproveRoleInvitation={handleApproveRoleInvitation}
            />
          )}

          {activePortal === "doctor" && (
            <DoctorPortal
              credential={currentUser}
              onSwitchPortal={(p) => setActivePortal(p)}
              availableRoles={availableRoles}
            />
          )}

          {activePortal === "hospital" && (
            <HospitalAdminPortal
              credential={currentUser}
              onSwitchPortal={(p) => setActivePortal(p)}
              availableRoles={availableRoles}
              onInviteStaff={handleHospitalInviteStaff}
            />
          )}

          {activePortal === "sysadmin" && (
            <SystemAdminPortal
              credential={currentUser}
              onSwitchPortal={(p) => setActivePortal(p)}
              availableRoles={availableRoles}
            />
          )}

          <WebAuthnAuthModal
            isOpen={isAuthModalOpen}
            onClose={() => setIsAuthModalOpen(false)}
            onAuthenticated={handleAuthenticated}
          />

          {/* DEVICE BROADCAST CONFIRMATION MODAL */}
          {deviceProfile && (
            <DeviceBroadcastConfirmationModal
              message={activeBroadcastMessage}
              currentDevice={deviceProfile}
              onConfirm={handleConfirmBroadcast}
              onDeny={handleDenyBroadcast}
              onClose={() => setActiveBroadcastMessage(null)}
            />
          )}
        </>
      ) : (
        <div className="relative min-h-screen">
          <div className="absolute top-4 right-4 z-40">
            <ClientNodeStatusBadge />
          </div>
          <AuthLandingPage
            onAuthenticated={handleAuthenticated}
            initialStoredCredentials={storedCredentials}
          />
        </div>
      )}
    </div>
  );
}
