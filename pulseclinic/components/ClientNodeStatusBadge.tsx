"use client";

import React, { useState, useEffect } from "react";
import {
  clientNodeService,
  ClientNodeConnectionState,
  ClientNodeStatus,
  ClientNodeEndpoint,
  BroadcastLogItem,
} from "@/lib/clientNodeSocket";
import {
  Network,
  Radio,
  Server,
  RefreshCw,
  Send,
  Plus,
  CheckCircle2,
  AlertCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  X,
  Layers,
  ArrowUpRight,
  ArrowDownLeft,
  Share2,
  ShieldAlert,
  ArrowLeftRight,
  Zap,
} from "lucide-react";

export default function ClientNodeStatusBadge() {
  const [connectionState, setConnectionState] = useState<ClientNodeConnectionState>("DISCONNECTED");
  const [activeEndpointIndex, setActiveEndpointIndex] = useState<number>(0);
  const [activeEndpoint, setActiveEndpoint] = useState<ClientNodeEndpoint | null>(null);
  const [endpoints, setEndpoints] = useState<ClientNodeEndpoint[]>([]);
  const [nodeStatus, setNodeStatus] = useState<ClientNodeStatus | null>(null);
  const [logs, setLogs] = useState<BroadcastLogItem[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [failoverNotice, setFailoverNotice] = useState<string | null>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [newPeerInput, setNewPeerInput] = useState("127.0.0.1:8000");
  const [customBroadcastMsg, setCustomBroadcastMsg] = useState("");
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingUrl, setEditingUrl] = useState<string>("");

  useEffect(() => {
    clientNodeService.connect();

    const unsubscribe = clientNodeService.subscribe((state) => {
      setConnectionState(state.connectionState);
      setActiveEndpointIndex(state.activeEndpointIndex);
      setActiveEndpoint(state.activeEndpoint);
      setEndpoints(state.endpoints);
      setNodeStatus(state.nodeStatus);
      setLogs(state.logs);
      setLastError(state.lastError);
      setFailoverNotice(state.failoverNotice);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const handleConnectPeer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPeerInput.trim()) return;
    const ok = clientNodeService.connectPeer(newPeerInput.trim());
    if (ok) {
      setActionNotice(`Requested connection to peer ${newPeerInput}`);
      setTimeout(() => setActionNotice(null), 3000);
    }
  };

  const handleSwitchActiveNode = (idx: number) => {
    clientNodeService.switchActiveNode(idx);
    setActionNotice(`Active client node changed to: ${endpoints[idx]?.label}`);
    setTimeout(() => setActionNotice(null), 3500);
  };

  const handleSaveUrl = (idx: number) => {
    if (!editingUrl.trim()) return;
    clientNodeService.updateEndpointUrl(idx, editingUrl.trim());
    setEditingIndex(null);
    setActionNotice(`Updated ${endpoints[idx]?.label} URL to ${editingUrl.trim()}`);
    setTimeout(() => setActionNotice(null), 3000);
  };

  const isConnected = connectionState === "CONNECTED";
  const isConnecting = connectionState === "CONNECTING";
  const peerCount = nodeStatus?.peer_count ?? 0;

  return (
    <>
      {/* Sleek Header Badge */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`flex items-center gap-2 px-2.5 py-1 rounded-xl text-xs font-medium border transition-all duration-200 shadow-2xs ${
          isConnected
            ? "bg-zinc-800/90 hover:bg-zinc-800 border-emerald-500/40 text-zinc-200"
            : isConnecting
            ? "bg-zinc-800/90 border-amber-500/40 text-amber-300"
            : "bg-zinc-800/90 border-zinc-700 text-zinc-400 hover:text-zinc-200"
        }`}
        title="Distributed Client Node Gateway & Failover Pool Status"
      >
        <div className="relative flex items-center justify-center">
          <span
            className={`w-2 h-2 rounded-full ${
              isConnected
                ? "bg-emerald-400"
                : isConnecting
                ? "bg-amber-400 animate-pulse"
                : "bg-red-400"
            }`}
          />
          {isConnected && (
            <span className="absolute w-3.5 h-3.5 rounded-full bg-emerald-400/30 animate-ping" />
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <Server className="w-3.5 h-3.5 text-emerald-400" />
          <span className="font-semibold text-[11px] text-zinc-100">
            {activeEndpoint?.isPrivileged ? "Primary Node" : `Fallback Node (${activeEndpointIndex + 1})`}
          </span>
          {isConnected && (
            <span className="px-1.5 py-0.2 rounded-md bg-emerald-500/20 text-emerald-300 text-[10px] font-mono font-medium">
              :{activeEndpoint?.url.split(":").pop() || "8765"}
            </span>
          )}
        </div>

        <div className="hidden sm:flex items-center gap-1 pl-1 border-l border-zinc-700 text-[10px] text-zinc-400">
          <Network className="w-3 h-3 text-cyan-400" />
          <span className="font-mono text-zinc-300 font-semibold">{peerCount}</span>
          <span className="text-[10px]">peers</span>
        </div>
      </button>

      {/* Slide-out / Modal Drawer for Deep Client Node Monitoring & Failover Controls */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="relative w-full max-w-3xl bg-zinc-950 border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-zinc-900/90 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-inner">
                  <Server className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-sm text-white">Client Node Gateway & Failover Mechanism</h3>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
                        isConnected
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          : isConnecting
                          ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                          : "bg-red-500/20 text-red-300 border border-red-500/30"
                      }`}
                    >
                      {connectionState}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400">
                    Connects to up to 3 Client Nodes with privileged routing and automated failover
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => clientNodeService.reconnect()}
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                  title="Reconnect to Active Client Node"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Notification / Failover Alert Banner */}
            {(failoverNotice || actionNotice) && (
              <div className="bg-amber-950/80 border-b border-amber-800/80 px-6 py-2.5 text-xs text-amber-200 flex items-center justify-between animate-in fade-in">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="font-medium">{failoverNotice || actionNotice}</span>
                </div>
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 bg-amber-500/20 rounded text-amber-300">
                  Failover Engine Active
                </span>
              </div>
            )}

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs text-zinc-300">
              {/* CHANGE CLIENT MECHANISM: 3-NODE FAILOVER POOL */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ArrowLeftRight className="w-4 h-4 text-emerald-400" />
                    <span className="font-bold text-white text-xs uppercase tracking-wider">
                      3-Node Client Pool & Priority Failover
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-emerald-400">
                    Auto-Failover Enabled
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {endpoints.map((ep, idx) => {
                    const isActive = idx === activeEndpointIndex;
                    const isEditing = editingIndex === idx;

                    return (
                      <div
                        key={ep.id}
                        className={`p-3.5 rounded-2xl border transition-all ${
                          isActive
                            ? "bg-emerald-950/30 border-emerald-500/50 shadow-md ring-1 ring-emerald-500/30"
                            : "bg-zinc-900/60 border-zinc-800 hover:border-zinc-700"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                              ep.isPrivileged
                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                : "bg-zinc-800 text-zinc-400 border border-zinc-700"
                            }`}
                          >
                            {ep.isPrivileged ? "Primary (Privileged)" : `Fallback ${idx}`}
                          </span>

                          <span
                            className={`w-2 h-2 rounded-full ${
                              isActive && isConnected
                                ? "bg-emerald-400 animate-pulse"
                                : isActive && isConnecting
                                ? "bg-amber-400"
                                : "bg-zinc-600"
                            }`}
                          />
                        </div>

                        <div className="font-semibold text-zinc-100 text-xs truncate">{ep.label}</div>

                        {/* URL display or edit */}
                        {isEditing ? (
                          <div className="mt-2 space-y-1.5">
                            <input
                              type="text"
                              value={editingUrl}
                              onChange={(e) => setEditingUrl(e.target.value)}
                              className="w-full px-2 py-1 bg-zinc-950 border border-zinc-700 rounded-lg font-mono text-[11px] text-zinc-200"
                            />
                            <div className="flex gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleSaveUrl(idx)}
                                className="px-2 py-0.5 bg-emerald-600 text-white rounded text-[10px] font-semibold"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingIndex(null)}
                                className="px-2 py-0.5 bg-zinc-800 text-zinc-400 rounded text-[10px]"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between mt-1 text-[11px] font-mono text-zinc-400">
                            <span className="truncate">{ep.url}</span>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingIndex(idx);
                                setEditingUrl(ep.url);
                              }}
                              className="text-[10px] text-zinc-500 hover:text-zinc-300 ml-1"
                            >
                              Edit
                            </button>
                          </div>
                        )}

                        {/* Action buttons */}
                        <div className="mt-3 pt-2.5 border-t border-zinc-800/80 flex items-center justify-between">
                          <span className="text-[10px] font-mono text-zinc-500">
                            {isActive ? (
                              <span className="text-emerald-400 font-bold">● ACTIVE</span>
                            ) : (
                              <span>STANDBY</span>
                            )}
                          </span>

                          {!isActive && (
                            <button
                              type="button"
                              onClick={() => handleSwitchActiveNode(idx)}
                              className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-[10px] font-semibold transition-colors"
                            >
                              Make Active
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Topology Limits & Architectural Rules Card */}
              <div className="p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-cyan-400" />
                    <span className="font-bold text-white text-xs">P2P Network Topology & Node Rules</span>
                  </div>
                  <span className="text-[10px] text-emerald-400 font-mono">Central Broadcast Tracker</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-[11px] pt-1">
                  <div className="p-2.5 rounded-xl bg-zinc-900 border border-zinc-800">
                    <span className="font-bold text-emerald-400">Client Nodes</span>
                    <p className="text-zinc-400 text-[10px] mt-0.5">
                      Connect to a <strong className="text-zinc-200">MAXIMUM of 20 Validators</strong>. Expose WebSocket for PulseClinic.
                    </p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-zinc-900 border border-zinc-800">
                    <span className="font-bold text-cyan-400">Validator Nodes</span>
                    <p className="text-zinc-400 text-[10px] mt-0.5">
                      Can connect to <strong className="text-zinc-200">20 Validators</strong> and <strong className="text-zinc-200">5 Archive nodes</strong> for PBFT consensus.
                    </p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-zinc-900 border border-zinc-800">
                    <span className="font-bold text-amber-400">Archive Nodes</span>
                    <p className="text-zinc-400 text-[10px] mt-0.5">
                      Store complete historical block records & state ledger for deep audit.
                    </p>
                  </div>
                </div>
              </div>

              {/* Connected Peers on Active Client Node */}
              <div className="p-4 rounded-2xl bg-zinc-900/50 border border-zinc-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Network className="w-4 h-4 text-cyan-400" />
                    <span className="font-bold text-white text-xs">
                      Peers on Active Gateway ({activeEndpoint?.label})
                    </span>
                  </div>
                  <span className="text-[11px] text-zinc-400 font-mono">
                    {peerCount}/20 Validators connected
                  </span>
                </div>

                {nodeStatus?.connected_peers && nodeStatus.connected_peers.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {nodeStatus.connected_peers.map((peer, idx) => (
                      <div
                        key={idx}
                        className="px-3 py-1.5 rounded-xl bg-zinc-900 border border-cyan-500/30 text-cyan-300 font-mono text-[11px] flex items-center gap-2"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                        <span>{peer}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-zinc-500 italic">
                    No validator peers linked yet. Connect a validator below or boot a node with --broadcast-server.
                  </p>
                )}

                {/* Form to Connect a New Peer */}
                <form onSubmit={handleConnectPeer} className="flex gap-2 pt-2 border-t border-zinc-800/80">
                  <input
                    type="text"
                    value={newPeerInput}
                    onChange={(e) => setNewPeerInput(e.target.value)}
                    placeholder="Enter peer IP:PORT (e.g. 127.0.0.1:8000)"
                    className="flex-1 px-3 py-1.5 bg-zinc-950 border border-zinc-700 rounded-xl text-xs text-zinc-200 placeholder-zinc-500 focus:outline-hidden focus:border-emerald-500"
                  />
                  <button
                    type="submit"
                    disabled={!isConnected}
                    className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Connect Peer</span>
                  </button>
                </form>
              </div>

              {/* Live Broadcast Feed */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Share2 className="w-4 h-4 text-emerald-400" />
                    <span className="font-bold text-white text-xs">Live Broadcast & Failover Audit Log</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 font-mono">
                    {logs.length} logged event{logs.length === 1 ? "" : "s"}
                  </span>
                </div>

                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {logs.length === 0 ? (
                    <div className="p-4 rounded-2xl bg-zinc-900/30 border border-zinc-800/60 text-center text-zinc-500 text-[11px]">
                      No P2P broadcast or failover events recorded in this session.
                    </div>
                  ) : (
                    logs.map((log) => {
                      const isExpanded = expandedLogId === log.id;
                      const isOutbound = log.direction === "OUTBOUND";
                      const isFailover = log.type === "FAILOVER" || log.type === "MANUAL_SWITCH";

                      return (
                        <div
                          key={log.id}
                          className={`p-2.5 rounded-xl border transition-colors ${
                            isFailover
                              ? "bg-amber-950/30 border-amber-500/40"
                              : "bg-zinc-900/70 border-zinc-800 hover:border-zinc-700"
                          }`}
                        >
                          <div
                            className="flex items-center justify-between gap-2 cursor-pointer"
                            onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[9px] font-bold font-mono uppercase shrink-0 ${
                                  isFailover
                                    ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                    : isOutbound
                                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                    : "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                                }`}
                              >
                                {isFailover ? (
                                  "FAILOVER"
                                ) : isOutbound ? (
                                  <span className="flex items-center gap-1">
                                    <ArrowUpRight className="w-2.5 h-2.5" /> OUT
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-1">
                                    <ArrowDownLeft className="w-2.5 h-2.5" /> IN
                                  </span>
                                )}
                              </span>

                              <span className="font-semibold text-zinc-200 text-xs truncate">
                                {log.summary}
                              </span>
                            </div>

                            <div className="flex items-center gap-2 shrink-0 text-zinc-500 text-[10px]">
                              <span>{log.timestamp}</span>
                              {isExpanded ? (
                                <ChevronUp className="w-3.5 h-3.5" />
                              ) : (
                                <ChevronDown className="w-3.5 h-3.5" />
                              )}
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="mt-2 pt-2 border-t border-zinc-800 text-[11px] font-mono bg-zinc-950 p-2.5 rounded-lg overflow-x-auto text-zinc-400">
                              <pre>{JSON.stringify(log.rawPayload, null, 2)}</pre>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 bg-zinc-900/60 border-t border-zinc-800 flex items-center justify-between text-[11px] text-zinc-400">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span>
                  Active Gateway: <strong className="text-zinc-200">{activeEndpoint?.label}</strong> ({activeEndpoint?.url})
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg font-medium transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
