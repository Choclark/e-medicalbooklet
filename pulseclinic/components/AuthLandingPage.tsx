"use client";

import React, { useState } from "react";
import {
  Fingerprint,
  KeyRound,
  ShieldCheck,
  Lock,
  Cpu,
  Layers,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Activity,
  Copy,
  Check,
  Sparkles,
} from "lucide-react";
import {
  StoredCredential,
  isWebAuthnSupported,
  authenticateWithWebAuthn,
} from "@/lib/webauthn";
import { registerPatientInTrustedZone } from "@/lib/trustedZone";
import { clientNodeService } from "@/lib/clientNodeSocket";
import { DEFAULT_DEMO_USER, ALL_DEMO_CREDENTIALS, getRolesForCredential } from "@/lib/medicalStore";

interface AuthLandingPageProps {
  onAuthenticated: (credential: StoredCredential) => void;
  initialStoredCredentials: StoredCredential[];
}

export default function AuthLandingPage({
  onAuthenticated,
  initialStoredCredentials,
}: AuthLandingPageProps) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [stepMessage, setStepMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [createdCred, setCreatedCred] = useState<StoredCredential | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const [creds, setCreds] = useState<StoredCredential[]>(() => {
    if (initialStoredCredentials.length > 1) return initialStoredCredentials;
    return ALL_DEMO_CREDENTIALS;
  });

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!fullName.trim()) {
      setErrorMessage("Please enter your legal name.");
      return;
    }
    if (!email.trim() || !email.includes("@")) {
      setErrorMessage("Please enter a valid medical portal email.");
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
      const updated = [bundle.credential, ...creds];
      setCreds(updated);
      if (typeof window !== "undefined") {
        localStorage.setItem("pulse_clinic_creds", JSON.stringify(updated));
        localStorage.setItem("pulse_clinic_active_user", bundle.credential.id);
      }

      setCreatedCred(bundle.credential);
      setStepMessage(`Patient Booklet successfully anchored on-chain! Tx: ${receipt.tx_id}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to generate Trusted Zone keypair";
      setErrorMessage(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async (targetCred?: StoredCredential) => {
    setErrorMessage(null);
    setIsLoading(true);

    const cred = targetCred || creds[0] || DEFAULT_DEMO_USER;

    try {
      setStepMessage(`Prompting biometric signature for ${cred.user.name}...`);
      await new Promise((r) => setTimeout(r, 350));

      const result = await authenticateWithWebAuthn(cred);

      if (result.success) {
        setStepMessage("WebAuthn cryptographic signature verified!");
        await new Promise((r) => setTimeout(r, 300));
        onAuthenticated(cred);
      } else {
        setErrorMessage("Signature validation failed.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Authentication error";
      setErrorMessage(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#F4F5F7] flex flex-col justify-between font-sans antialiased text-zinc-900 p-4 sm:p-8">
      {/* Top Navbar */}
      <header className="max-w-6xl w-full mx-auto flex items-center justify-between py-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-zinc-900 text-white flex items-center justify-center shadow-xs">
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
            <h1 className="font-bold text-lg text-zinc-900 tracking-tight leading-none">Pulse Clinic</h1>
            <p className="text-[11px] text-zinc-500 font-medium">Electronic Medical Booklet • Blockchain Portal</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            WebAuthn Enclave Ready
          </span>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-5xl w-full mx-auto my-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        {/* Left column: Value Proposition & Cryptography Explanation */}
        <div className="lg:col-span-6 space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-zinc-900 text-white shadow-xs">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            Next-Gen Medical Security
          </div>

          <h2 className="text-4xl sm:text-5xl font-black text-zinc-900 tracking-tight leading-[1.15]">
            Your health records, protected by hardware keys.
          </h2>

          <p className="text-zinc-600 text-sm leading-relaxed max-w-lg">
            Say goodbye to passwords and insecure central credentials. Pulse Clinic combines{" "}
            <strong>W3C WebAuthn passkeys</strong> with a <strong>decentralized blockchain ledger</strong>.
            Your medical booklet is cryptographically signed and exclusively accessible by you.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-2xs space-y-2">
              <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
                <Lock className="w-4 h-4" />
              </div>
              <h4 className="font-bold text-xs text-zinc-900">Secure Enclave Private Key</h4>
              <p className="text-[11px] text-zinc-500 leading-snug">
                Your private key never leaves your device’s biometric hardware enclave (Touch ID / Face ID / Windows
                Hello).
              </p>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-2xs space-y-2">
              <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center">
                <Layers className="w-4 h-4" />
              </div>
              <h4 className="font-bold text-xs text-zinc-900">Blockchain DID Booklet</h4>
              <p className="text-[11px] text-zinc-500 leading-snug">
                Your public key is anchored to an immutable decentralized medical ledger to verify claims and
                prescriptions.
              </p>
            </div>
          </div>
        </div>

        {/* Right column: Interactive Sign Up / Log In Card */}
        <div className="lg:col-span-6">
          <div className="bg-white rounded-3xl border border-zinc-200 shadow-xl overflow-hidden p-6 sm:p-8 space-y-6">
            {/* Mode Tabs */}
            <div className="flex border-b border-zinc-200 bg-zinc-100/70 p-1.5 rounded-2xl">
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  setErrorMessage(null);
                  setCreatedCred(null);
                }}
                className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-2 ${
                  mode === "login"
                    ? "bg-white text-zinc-900 shadow-sm"
                    : "text-zinc-600 hover:text-zinc-900"
                }`}
              >
                <KeyRound className="w-3.5 h-3.5" />
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setErrorMessage(null);
                  setCreatedCred(null);
                }}
                className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-2 ${
                  mode === "signup"
                    ? "bg-white text-zinc-900 shadow-sm"
                    : "text-zinc-600 hover:text-zinc-900"
                }`}
              >
                <Fingerprint className="w-3.5 h-3.5" />
                Sign Up (Create Booklet)
              </button>
            </div>

            {/* Error Message */}
            {errorMessage && (
              <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Loading Indicator */}
            {isLoading && (
              <div className="p-4 rounded-2xl bg-zinc-900 text-white flex items-center gap-3.5 shadow-lg animate-pulse">
                <div className="w-8 h-8 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin shrink-0"></div>
                <div className="text-xs">
                  <p className="font-semibold text-emerald-300">Enclave Cryptographic Verification</p>
                  <p className="text-zinc-300">{stepMessage}</p>
                </div>
              </div>
            )}

            {/* Newly Created Credential Showcase */}
            {createdCred && (
              <div className="p-5 rounded-2xl bg-emerald-50/70 border border-emerald-200 space-y-4">
                <div className="flex items-center gap-2 text-emerald-900 font-semibold text-xs">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Public & Private Key Generated Successfully!</span>
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-emerald-100 text-xs space-y-2">
                  <div className="flex justify-between items-center text-zinc-500">
                    <span>Patient Name:</span>
                    <span className="font-bold text-zinc-900">{createdCred.user.name}</span>
                  </div>
                  <div className="flex justify-between items-center text-zinc-500">
                    <span>Blockchain DID:</span>
                    <span className="font-mono text-[11px] text-emerald-700 truncate max-w-[200px]">
                      {createdCred.did}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-zinc-500">
                    <span>Algorithm:</span>
                    <span className="font-medium text-zinc-700">{createdCred.algorithm}</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between items-center text-[11px] text-zinc-500">
                    <span>Exported Public Key:</span>
                    <button
                      onClick={() => copyToClipboard(createdCred.publicKeyHex)}
                      className="text-xs hover:text-zinc-900 flex items-center gap-1"
                    >
                      {copiedKey ? (
                        <Check className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      {copiedKey ? "Copied" : "Copy Hex"}
                    </button>
                  </div>
                  <div className="p-2.5 bg-zinc-900 text-emerald-400 font-mono text-[10px] rounded-lg break-all max-h-16 overflow-y-auto">
                    {createdCred.publicKeyHex}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onAuthenticated(createdCred)}
                  className="w-full py-3 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2 shadow-sm"
                >
                  Enter Electronic Medical Booklet
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* TAB: LOGIN */}
            {mode === "login" && !createdCred && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-2">
                    Select Identity to Authenticate
                  </label>
                  <div className="space-y-2">
                    {creds.map((cred) => (
                      <div
                        key={cred.id}
                        onClick={() => handleLogin(cred)}
                        className="p-3.5 rounded-2xl border border-zinc-200 hover:border-zinc-900 bg-zinc-50/50 hover:bg-white cursor-pointer transition-all flex items-center justify-between group shadow-2xs"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-zinc-100 group-hover:bg-zinc-900 group-hover:text-white text-zinc-700 flex items-center justify-center transition-colors">
                            <Fingerprint className="w-5 h-5" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="text-xs font-bold text-zinc-900">{cred.user.name}</h4>
                              <span className="text-[10px] bg-zinc-100 text-zinc-600 px-1.5 py-0.2 rounded font-medium capitalize">
                                {cred.user.role}
                              </span>
                              {cred.hospitalName && (
                                <span className="text-[9px] bg-emerald-50 text-emerald-700 border border-emerald-200/60 px-1.5 rounded font-medium">
                                  {cred.hospitalName.includes("(") ? cred.hospitalName.split("(")[1].replace(")", "") : cred.hospitalName}
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-zinc-400 font-mono truncate max-w-[200px]">
                              {cred.did}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 text-xs font-medium text-zinc-400 group-hover:text-zinc-900">
                          <span>Authenticate</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="relative flex py-1 items-center">
                  <div className="flex-grow border-t border-zinc-200"></div>
                  <span className="flex-shrink mx-3 text-[11px] text-zinc-400">or scan device passkey</span>
                  <div className="flex-grow border-t border-zinc-200"></div>
                </div>

                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => handleLogin()}
                  className="w-full py-3.5 px-4 bg-zinc-900 hover:bg-zinc-800 active:scale-[0.99] text-white rounded-2xl text-xs font-semibold transition-all flex items-center justify-center gap-2.5 shadow-md disabled:opacity-50"
                >
                  <Fingerprint className="w-4 h-4 text-emerald-400" />
                  <span>Verify WebAuthn Passkey (Hardware Enclave)</span>
                </button>
              </div>
            )}

            {/* TAB: SIGN UP */}
            {mode === "signup" && !createdCred && (
              <form onSubmit={handleSignUp} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Full Legal Name</label>
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
                    placeholder="e.g. alex.mensah@pulseclinic.health"
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
                      All new accounts automatically provision as a Patient Digital Booklet. Professional privileges (Doctor / Staff) are granted strictly via Hospital Cryptographic Delegation.
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3.5 px-4 bg-zinc-900 hover:bg-zinc-800 active:scale-[0.99] text-white rounded-2xl text-xs font-semibold transition-all flex items-center justify-center gap-2.5 shadow-md disabled:opacity-50"
                >
                  <KeyRound className="w-4 h-4 text-emerald-400" />
                  <span>Generate WebAuthn Keypair & Mint Booklet DID</span>
                </button>
              </form>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-6xl w-full mx-auto py-4 border-t border-zinc-200/80 flex flex-col sm:flex-row items-center justify-between text-xs text-zinc-400 gap-2">
        <div className="flex items-center gap-2">
          <span>Pulse Clinic Electronic Medical Booklet</span>
          <span>•</span>
          <span>FIDO2 / W3C Web Authentication Standard</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-zinc-600 font-medium">ECDSA P-256</span>
          <span className="text-zinc-600 font-medium">NIST Curvature</span>
          <span className="text-zinc-600 font-medium">Smart Ledger V2</span>
        </div>
      </footer>
    </div>
  );
}
