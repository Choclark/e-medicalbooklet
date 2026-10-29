"use client";

import React, { useState } from "react";
import {
  ShieldCheck,
  Key,
  Copy,
  Check,
  ExternalLink,
  Layers,
  Lock,
  Cpu,
  Hash,
  Database,
  FileCheck2,
} from "lucide-react";
import { StoredCredential } from "@/lib/webauthn";

interface BlockchainKeyDrawerProps {
  credential: StoredCredential;
  isOpen: boolean;
  onClose: () => void;
}

export default function BlockchainKeyDrawer({
  credential,
  isOpen,
  onClose,
}: BlockchainKeyDrawerProps) {
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  if (!isOpen) return null;

  const copyText = (text: string, sectionId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(sectionId);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-zinc-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-5 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/60">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-100 rounded-2xl text-emerald-800">
              <Key className="w-5 h-5 text-emerald-700" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-zinc-900 text-sm">
                  WebAuthn Public Key & Blockchain Booklet Identity
                </h3>
                <span className="text-[10px] bg-emerald-50 text-emerald-700 font-semibold px-2 py-0.5 rounded-full border border-emerald-200">
                  Enclave Protected
                </span>
              </div>
              <p className="text-xs text-zinc-500">
                Cryptographic parameters anchoring {credential.user.name}&apos;s medical records
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-700 p-1.5 rounded-lg hover:bg-zinc-100 text-sm"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs">
          {/* Enclave Hardware Security Status */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3.5 rounded-2xl border border-zinc-200 bg-zinc-50/70 space-y-1.5">
              <div className="flex items-center gap-1.5 text-zinc-500 text-[11px] font-medium">
                <Lock className="w-3.5 h-3.5 text-emerald-600" />
                <span>Private Key Status</span>
              </div>
              <p className="font-semibold text-zinc-900 text-xs">Hardware Enclave (Isolated)</p>
              <p className="text-[11px] text-zinc-500 leading-snug">
                The private key never leaves the secure hardware chip (Apple Secure Enclave, Android Titan M, or Windows
                TPM 2.0).
              </p>
            </div>

            <div className="p-3.5 rounded-2xl border border-zinc-200 bg-zinc-50/70 space-y-1.5">
              <div className="flex items-center gap-1.5 text-zinc-500 text-[11px] font-medium">
                <Cpu className="w-3.5 h-3.5 text-blue-600" />
                <span>Key Algorithm & Curve</span>
              </div>
              <p className="font-semibold text-zinc-900 text-xs">{credential.algorithm}</p>
              <p className="text-[11px] text-zinc-500 leading-snug">
                NIST P-256 (secp256r1) with SHA-256 digest signature scheme.
              </p>
            </div>
          </div>

          {/* Blockchain DID & Wallet Address */}
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-zinc-700 font-medium flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-zinc-500" />
                  Medical Booklet DID (Decentralized Identifier)
                </label>
                <button
                  onClick={() => copyText(credential.did, "did")}
                  className="text-[11px] text-zinc-600 hover:text-zinc-900 flex items-center gap-1"
                >
                  {copiedSection === "did" ? (
                    <Check className="w-3 h-3 text-emerald-600" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  {copiedSection === "did" ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="p-3 bg-zinc-900 text-emerald-400 font-mono text-[11px] rounded-xl break-all">
                {credential.did}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-zinc-700 font-medium flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5 text-zinc-500" />
                  Blockchain Wallet Address
                </label>
                <button
                  onClick={() => copyText(credential.blockchainAddress, "addr")}
                  className="text-[11px] text-zinc-600 hover:text-zinc-900 flex items-center gap-1"
                >
                  {copiedSection === "addr" ? (
                    <Check className="w-3 h-3 text-emerald-600" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  {copiedSection === "addr" ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="p-3 bg-zinc-100 text-zinc-800 font-mono text-[11px] rounded-xl border border-zinc-200 break-all">
                {credential.blockchainAddress}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-zinc-700 font-medium flex items-center gap-1.5">
                  <FileCheck2 className="w-3.5 h-3.5 text-zinc-500" />
                  Raw Public Key (Hex)
                </label>
                <button
                  onClick={() => copyText(credential.publicKeyHex, "pubkey")}
                  className="text-[11px] text-zinc-600 hover:text-zinc-900 flex items-center gap-1"
                >
                  {copiedSection === "pubkey" ? (
                    <Check className="w-3 h-3 text-emerald-600" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  {copiedSection === "pubkey" ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="p-3 bg-zinc-950 text-zinc-300 font-mono text-[10px] rounded-xl max-h-24 overflow-y-auto break-all border border-zinc-800">
                {credential.publicKeyHex}
              </div>
            </div>
          </div>

          {/* Credential ID */}
          <div className="pt-2 border-t border-zinc-100 flex items-center justify-between text-[11px] text-zinc-500">
            <span>WebAuthn Credential ID:</span>
            <span className="font-mono text-zinc-700 truncate max-w-[280px]">{credential.id}</span>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-zinc-50 border-t border-zinc-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl text-xs font-medium transition-colors"
          >
            Close Inspector
          </button>
        </div>
      </div>
    </div>
  );
}
