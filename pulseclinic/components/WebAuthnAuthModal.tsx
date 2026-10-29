"use client";

import React, { useState, useEffect } from "react";
import {
  Fingerprint,
  KeyRound,
  ShieldCheck,
  Cpu,
  Lock,
  ArrowRight,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ExternalLink,
  ChevronRight,
  Activity,
  Layers,
  Copy,
  Check,
} from "lucide-react";
import {
  StoredCredential,
  isWebAuthnSupported,
  isPlatformAuthenticatorAvailable,
  authenticateWithWebAuthn,
} from "@/lib/webauthn";
import { registerPatientInTrustedZone } from "@/lib/trustedZone";
import { clientNodeService } from "@/lib/clientNodeSocket";
import { DEFAULT_DEMO_USER, ALL_DEMO_CREDENTIALS } from "@/lib/medicalStore";

interface WebAuthnAuthModalProps {
  onAuthenticated: (credential: StoredCredential) => void;
  isOpen: boolean;
  onClose?: () => void;
}

export default function WebAuthnAuthModal({
  onAuthenticated,
  isOpen,
  onClose,
}: WebAuthnAuthModalProps) {
  const [activeTab, setActiveTab] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [preferHardware, setPreferHardware] = useState(true);

  // Status and animation states
  const [isLoading, setIsLoading] = useState(false);
  const [stepMessage, setStepMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successCred, setSuccessCred] = useState<StoredCredential | null>(null);
  const [showKeyDetails, setShowKeyDetails] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  // Platform capabilities
  const [hasWebAuthn, setHasWebAuthn] = useState(true);
  const [hasBiometric, setHasBiometric] = useState(false);

  // Stored credentials in localStorage
  const [storedCredentials, setStoredCredentials] = useState<StoredCredential[]>([]);

  useEffect(() => {
    setHasWebAuthn(isWebAuthnSupported());
    isPlatformAuthenticatorAvailable().then(setHasBiometric);

    // Load credentials from local storage
    if (typeof window !== "undefined") {
      try {
        const raw = localStorage.getItem("pulse_clinic_creds");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setStoredCredentials(parsed);
            return;
          }
        }
      } catch (e) {
        console.error(e);
      }
      // If none found or single default, populate with all demo profiles
      setStoredCredentials(ALL_DEMO_CREDENTIALS);
      localStorage.setItem("pulse_clinic_creds", JSON.stringify(ALL_DEMO_CREDENTIALS));
    }
  }, []);

  const saveCredentialToLocal = (cred: StoredCredential) => {
    setStoredCredentials((prev) => {
      const exists = prev.some((c) => c.id === cred.id || c.user.email === cred.user.email);
      const updated = exists ? prev.map((c) => (c.user.email === cred.user.email ? cred : c)) : [cred, ...prev];
      if (typeof window !== "undefined") {
        localStorage.setItem("pulse_clinic_creds", JSON.stringify(updated));
      }
      return updated;
    });
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!fullName.trim()) {
      setErrorMessage("Please enter your legal full name for the medical booklet.");
      return;
    }
    if (!email.trim() || !email.includes("@")) {
      setErrorMessage("Please enter a valid email address.");
      return;
    }

    setIsLoading(true);
    setStepMessage("Initializing client device Trusted Zone...");

    try {
      await new Promise((r) => setTimeout(r, 200));
      setStepMessage("Generating ECDSA P-256 keypair in Hardware Enclave...");

      // 1. Create Patient & sign in Trusted Zone
      const bundle = await registerPatientInTrustedZone({
        name: fullName.trim(),
        email: email.trim().toLowerCase(),
        password: password || undefined,
      });

      setStepMessage("Signing registration payload with private key in Trusted Zone...");
      await new Promise((r) => setTimeout(r, 300));

      // 2. Broadcast patient registration to the Blockchain and await on-chain consensus confirmation
      setStepMessage("Broadcasting to Blockchain Validators & awaiting consensus commit...");
      const receipt = await clientNodeService.submitPatientRegistrationAndWaitForBlockchain({
        type: "PATIENT_REGISTRATION",
        patient_id: bundle.patient_id,
        name: bundle.name,
        email: bundle.email,
        public_key: bundle.public_key,
        public_key_base64: bundle.public_key_base64,
        blockchain_address: bundle.blockchain_address,
        did: bundle.did,
        device_token: bundle.device_token,
        device_name: bundle.device_name,
        password_hash: bundle.password_hash,
        payload_hash: bundle.payload_hash,
        signature: bundle.signature,
        timestamp: bundle.timestamp,
      });

      // STRICT SECURITY RULE: If blockchain rejected or did not confirm, ABORT!
      // Do NOT save to website DB and do NOT save to local storage.
      if (!receipt.confirmed) {
        throw new Error(
          receipt.error ||
            "Registration rejected: Blockchain consensus could not verify or commit patient transaction."
        );
      }

      // 3. ONLY ON CONFIRMED TRANSACTION: Save patient & public key to website PostgreSQL database
      setStepMessage(`Consensus verified on-chain (Tx: ${receipt.tx_id})! Storing in website database...`);
      const dbRes = await fetch("/api/auth/register-patient", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: bundle.patient_id,
          name: bundle.name,
          email: bundle.email,
          public_key: bundle.public_key,
          device_token: bundle.device_token,
          device_name: bundle.device_name,
          blockchain_address: bundle.blockchain_address,
          credential_id: bundle.credential.id,
          tx_id: receipt.tx_id,
          blockchain_confirmed: true,
        }),
      });

      if (!dbRes.ok) {
        const errJson = await dbRes.json().catch(() => ({}));
        throw new Error(
          errJson.error || "Failed to persist confirmed patient record in website database."
        );
      }

      // 4. Update stored credentials & session state ONLY after blockchain confirmation
      saveCredentialToLocal(bundle.credential);
      setSuccessCred(bundle.credential);
      setStepMessage(`Medical Booklet Cryptographic Keypair Registered & Verified on Blockchain (Tx: ${receipt.tx_id})!`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Registration failed";
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async (credToUse?: StoredCredential) => {
    setErrorMessage(null);
    setIsLoading(true);

    const targetCred = credToUse || storedCredentials[0] || DEFAULT_DEMO_USER;

    try {
      setStepMessage(`Prompting secure key signature for ${targetCred.user.name}...`);
      await new Promise((r) => setTimeout(r, 400));

      const result = await authenticateWithWebAuthn(targetCred);

      if (result.success) {
        setStepMessage("Signature verified against Blockchain Public Key!");
        await new Promise((r) => setTimeout(r, 450));
        onAuthenticated(targetCred);
      } else {
        setErrorMessage("Cryptographic signature verification failed.");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Authentication failed";
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl bg-white rounded-3xl shadow-2xl border border-zinc-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Top Header with Pulse Clinic logo */}
        <div className="px-8 pt-7 pb-5 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-zinc-900 text-white flex items-center justify-center shadow-sm">
              {/* Pulse / Heartbeat SVG */}
              <svg
                className="w-5 h-5 text-emerald-400 stroke-[2.5]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-zinc-900 text-lg tracking-tight">Pulse Clinic</span>
                <span className="text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/60 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  WebAuthn & Blockchain
                </span>
              </div>
              <p className="text-xs text-zinc-500">Electronic Medical Booklet • Zero-Password Cryptography</p>
            </div>
          </div>

          {onClose && (
            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-zinc-700 text-sm p-1.5 rounded-lg hover:bg-zinc-100 transition-colors"
            >
              ✕
            </button>
          )}
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-zinc-200 bg-zinc-100/70 p-1.5 mx-8 mt-5 rounded-2xl">
          <button
            type="button"
            onClick={() => {
              setActiveTab("login");
              setErrorMessage(null);
            }}
            className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-2 ${
              activeTab === "login"
                ? "bg-white text-zinc-900 shadow-sm"
                : "text-zinc-600 hover:text-zinc-900"
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            Passkey Log In
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab("signup");
              setErrorMessage(null);
            }}
            className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-2 ${
              activeTab === "signup"
                ? "bg-white text-zinc-900 shadow-sm"
                : "text-zinc-600 hover:text-zinc-900"
            }`}
          >
            <Fingerprint className="w-3.5 h-3.5" />
            Create Medical Booklet (Sign Up)
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-8 overflow-y-auto space-y-6">
          {/* Security Banner */}
          <div className="bg-zinc-50 border border-zinc-200/80 rounded-2xl p-4 flex items-start gap-3">
            <div className="p-2 bg-emerald-100/80 rounded-xl text-emerald-800 shrink-0">
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
            </div>
            <div className="text-xs space-y-1">
              <div className="font-semibold text-zinc-900 flex items-center gap-2">
                Asymmetric Cryptography Architecture
                <span className="text-[10px] text-zinc-500 font-normal">FIDO2 / W3C Standard</span>
              </div>
              <p className="text-zinc-600 leading-relaxed">
                Your private key is generated inside your device&apos;s Secure Enclave (Face ID / Touch ID / Windows Hello)
                and <strong>never transmitted</strong>. Your public key is anchored to your on-chain Medical Booklet DID.
              </p>
            </div>
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Loading / Status Step Animation */}
          {isLoading && (
            <div className="p-4 rounded-2xl bg-zinc-900 text-white flex items-center gap-3.5 shadow-lg animate-pulse">
              <div className="w-8 h-8 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin shrink-0"></div>
              <div className="text-xs">
                <p className="font-medium text-emerald-300">WebAuthn Enclave Operation</p>
                <p className="text-zinc-300">{stepMessage}</p>
              </div>
            </div>
          )}

          {/* SUCCESS SIGNUP PREVIEW MODAL */}
          {successCred && (
            <div className="p-5 rounded-2xl bg-emerald-50/70 border border-emerald-200 space-y-4">
              <div className="flex items-center gap-2 text-emerald-900 font-semibold text-sm">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <span>WebAuthn Credential & Medical Booklet Initialized!</span>
              </div>

              <div className="bg-white p-3.5 rounded-xl border border-emerald-100 text-xs space-y-2">
                <div className="flex justify-between items-center text-zinc-500">
                  <span>Patient Name:</span>
                  <span className="font-semibold text-zinc-900">{successCred.user.name}</span>
                </div>
                <div className="flex justify-between items-center text-zinc-500">
                  <span>Medical Booklet DID:</span>
                  <span className="font-mono text-[11px] text-emerald-700 truncate max-w-[240px]">
                    {successCred.did}
                  </span>
                </div>
                <div className="flex justify-between items-center text-zinc-500">
                  <span>Enclave Algorithm:</span>
                  <span className="font-medium text-zinc-700">{successCred.algorithm}</span>
                </div>
                <div className="flex justify-between items-center text-zinc-500">
                  <span>Blockchain Wallet:</span>
                  <span className="font-mono text-[11px] text-zinc-800">{successCred.blockchainAddress}</span>
                </div>
              </div>

              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={() => onAuthenticated(successCred)}
                  className="flex-1 py-2.5 bg-zinc-900 text-white rounded-xl text-xs font-semibold hover:bg-zinc-800 transition-colors flex items-center justify-center gap-2 shadow-sm"
                >
                  Enter Portal as {successCred.user.name}
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setShowKeyDetails(!showKeyDetails)}
                  className="px-3.5 py-2.5 border border-zinc-200 bg-white text-zinc-700 rounded-xl text-xs font-medium hover:bg-zinc-50"
                >
                  {showKeyDetails ? "Hide Key" : "Inspect Key"}
                </button>
              </div>

              {showKeyDetails && (
                <div className="p-3 bg-zinc-900 text-zinc-300 rounded-xl text-[11px] font-mono space-y-2 overflow-x-auto">
                  <div className="flex justify-between items-center text-zinc-400">
                    <span>Public Key (Hex - Uncompressed P-256):</span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(successCred.publicKeyHex)}
                      className="text-xs hover:text-white flex items-center gap-1"
                    >
                      {copiedKey ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      {copiedKey ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <p className="break-all text-emerald-400 bg-black/40 p-2 rounded">{successCred.publicKeyHex}</p>
                </div>
              )}
            </div>
          )}

          {/* TAB 1: LOGIN */}
          {activeTab === "login" && !successCred && (
            <div className="space-y-5">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-2">
                  Select Registered Passkey / Medical Identity
                </label>
                <div className="space-y-2.5 max-h-48 overflow-y-auto pr-1">
                  {storedCredentials.map((cred) => (
                    <div
                      key={cred.id}
                      onClick={() => handleLogin(cred)}
                      className="p-3.5 rounded-2xl border border-zinc-200 hover:border-zinc-900 bg-white hover:bg-zinc-50/80 cursor-pointer transition-all flex items-center justify-between group shadow-xs"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-zinc-100 group-hover:bg-zinc-900 group-hover:text-white text-zinc-700 flex items-center justify-center transition-colors">
                          <Fingerprint className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="text-xs font-semibold text-zinc-900">{cred.user.name}</h4>
                            <span className="text-[10px] bg-zinc-100 text-zinc-600 px-1.5 py-0.2 rounded font-medium capitalize">
                              {cred.user.role}
                            </span>
                            {cred.hospitalName && (
                              <span className="text-[9px] bg-emerald-50 text-emerald-700 border border-emerald-200/60 px-1.5 rounded font-medium">
                                {cred.hospitalName.includes("(") ? cred.hospitalName.split("(")[1].replace(")", "") : cred.hospitalName}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-zinc-500 font-mono truncate max-w-[220px]">
                            {cred.did || cred.blockchainAddress}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-zinc-400 group-hover:text-zinc-900">
                        <span className="text-xs font-medium hidden sm:inline">Authenticate</span>
                        <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="relative flex py-1 items-center">
                <div className="flex-grow border-t border-zinc-200"></div>
                <span className="flex-shrink mx-3 text-[11px] text-zinc-400">or sign in with hardware passkey</span>
                <div className="flex-grow border-t border-zinc-200"></div>
              </div>

              <button
                type="button"
                disabled={isLoading}
                onClick={() => handleLogin()}
                className="w-full py-3.5 px-4 bg-zinc-900 hover:bg-zinc-800 active:scale-[0.99] text-white rounded-2xl text-xs font-semibold transition-all flex items-center justify-center gap-2.5 shadow-md disabled:opacity-50"
              >
                <Fingerprint className="w-4 h-4 text-emerald-400" />
                <span>Verify Biometric / WebAuthn Passkey</span>
              </button>

              <div className="flex items-center justify-between text-[11px] text-zinc-500 pt-1">
                <span className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${hasWebAuthn ? "bg-emerald-500" : "bg-amber-500"}`}></span>
                  {hasWebAuthn ? "WebAuthn Supported" : "WebCrypto Fallback Mode"}
                </span>
                <span>Touch ID • Windows Hello • YubiKey</span>
              </div>
            </div>
          )}

          {/* TAB 2: SIGN UP */}
          {activeTab === "signup" && !successCred && (
            <form onSubmit={handleSignUp} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Legal Full Name</label>
                <input
                  type="text"
                  placeholder="e.g. Alex Mensah"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-zinc-200 focus:outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 transition-all bg-zinc-50/50"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Email Address</label>
                <input
                  type="email"
                  placeholder="e.g. patient@pulseclinic.health"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-zinc-200 focus:outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 transition-all bg-zinc-50/50"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Security Passphrase</label>
                <input
                  type="password"
                  placeholder="Enter security passphrase (protected in Trusted Zone)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-zinc-200 focus:outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 transition-all bg-zinc-50/50"
                />
              </div>

              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-start gap-2.5 text-emerald-800 text-xs">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-emerald-950">Universal Patient Booklet (Auto-Provisioned)</div>
                  <div className="text-[11px] text-emerald-700 mt-0.5">
                    All accounts auto-register as a Patient Digital Booklet. Professional credentials (Doctor / Staff) are granted strictly via Hospital Cryptographic Delegation.
                  </div>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3.5 px-4 bg-zinc-900 hover:bg-zinc-800 active:scale-[0.99] text-white rounded-2xl text-xs font-semibold transition-all flex items-center justify-center gap-2.5 shadow-md disabled:opacity-50"
                >
                  <KeyRound className="w-4 h-4 text-emerald-400" />
                  <span>Generate WebAuthn Keypair & Mint Booklet DID</span>
                </button>
              </div>

              <div className="p-3 bg-zinc-50 rounded-xl border border-zinc-200/70 text-[11px] text-zinc-600 flex items-start gap-2">
                <Layers className="w-4 h-4 text-zinc-400 shrink-0 mt-0.5" />
                <p>
                  Upon clicking, your operating system will securely request your biometric or device passkey. A unique
                  public/private ECDSA P-256 keypair will be created for your electronic medical booklet.
                </p>
              </div>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="px-8 py-4 bg-zinc-50/80 border-t border-zinc-200/80 flex items-center justify-between text-[11px] text-zinc-500">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            <span>Blockchain Smart Ledger #4829104</span>
          </div>
          <span>FIDO2 Hardware Passkey Enclave</span>
        </div>
      </div>
    </div>
  );
}
