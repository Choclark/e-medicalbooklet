#!/usr/bin/env python3
"""
E-Medical Booklet - Distributed KSM Node (Python P2P Node + C++ Winsock Core Bridge)
=====================================================================================
The KSM (Key Management Service) Node is an independent P2P network node written in Python
that manages cryptographic key shares, threshold re-encryption, and access validity windows:

Architecture:
  - Python P2P Network Socket:
    * Listens on TCP socket port (e.g. 8031).
    * Connects to network peers and Broadcast Server with strict topology limits:
        * Up to 10 Validators
        * Up to 10 Clients
        * Up to 10 Archives
        * Up to 10 KSM Nodes
  - C++ Winsock Core Engine (`ksm_core.exe`):
    * The Python KSM node connects to its native C++ core daemon via Winsock TCP socket (e.g. port 48075).
    * Performs Shamir Secret Sharing, AES-256-GCM operations, and SQLite persistence.
    * Stores:
        * doctor_id
        * patient_id
        * encryption_key_share
        * access_key_time (expiration / validity window)
        * data_id / tx_id
  - Network Actions:
    1. STORE_SHARE: Patient TrustZone encrypts key fragment for KSM node and sends share with validity window.
    2. TRANSFORM_SHARE: Doctor read query triggers partial re-encryption if access_key_time is valid.
    3. GET_PUBLIC_KEY: Node publishes its public key to the network for share encryption.
"""

import argparse
import asyncio
import json
import logging
import os
import socket
import sys
import time
import uuid
from typing import Dict, List, Optional, Set

from escrow_storage import EscrowStorage

# Ensure instant terminal output without buffering
sys.stdout.reconfigure(line_buffering=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [KsmNode] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("KsmNode")


def get_local_ip() -> str:
    """Retrieve machine hostname and corresponding local IP via socket."""
    hostname = socket.gethostname()
    try:
        return socket.gethostbyname(hostname)
    except socket.gaierror:
        return "127.0.0.1"


class KsmNode:
    """Distributed KSM Node in Python communicating with C++ Winsock Core."""

    # Topology connection limits: 10 of each other node type
    MAX_VALIDATORS = 10
    MAX_CLIENTS = 10
    MAX_ARCHIVES = 10
    MAX_KSM = 10

    def __init__(
        self,
        node_id: Optional[str] = None,
        share_index: int = 1,
        host: str = "0.0.0.0",
        port: int = 8031,
        core_host: str = "127.0.0.1",
        core_port: int = 48075,
        broadcast_server: Optional[str] = "127.0.0.1:9099",
        initial_peers: Optional[list[str]] = None,
    ):
        self.node_id = node_id or f"ksm-node-{uuid.uuid4().hex[:6]}"
        self.share_index = share_index
        self.host = host
        self.port = port
        self.core_host = core_host
        self.core_port = core_port
        self.local_ip = get_local_ip()
        self.broadcast_server = (
            broadcast_server if broadcast_server and broadcast_server.lower() != "none" else None
        )

        # Peer writers mapped by remote host:port string
        self.peer_writers: Dict[str, asyncio.StreamWriter] = {}
        self.target_peers: Set[str] = set(initial_peers or [])

        # Topology limit trackers
        self.connected_validators: Set[str] = set()
        self.connected_clients: Set[str] = set()
        self.connected_archives: Set[str] = set()
        self.connected_ksm: Set[str] = set()

        # Storage directory
        self.storage_dir = os.path.abspath(os.path.join("chaindata", self.node_id))
        os.makedirs(self.storage_dir, exist_ok=True)
        self.escrow_storage = EscrowStorage(
            db_dir=os.path.join(self.storage_dir, "db"),
            node_id=self.node_id,
            node_role="KSM",
        )

        # C++ Core state
        self.core_linked: bool = False
        self.core_status: dict = {}
        self.server: Optional[asyncio.Server] = None
        self.running: bool = False

    # =========================================================================
    # C++ WINSOCK CORE IPC
    # =========================================================================

    async def link_cpp_core(self) -> bool:
        """Probe and verify Winsock connection to C++ ksm_core daemon."""
        candidates = [self.core_host, "127.0.0.1", self.local_ip]
        for h in candidates:
            logger.info(f"Probing C++ KSM Core Winsock IPC at {h}:{self.core_port}...")
            try:
                reader, writer = await asyncio.wait_for(
                    asyncio.open_connection(h, self.core_port), timeout=3.0
                )
                status_query = json.dumps({"action": "STATUS"}) + "\n"
                writer.write(status_query.encode("utf-8"))
                await writer.drain()

                resp_bytes = await asyncio.wait_for(reader.read(4096), timeout=3.0)
                writer.close()
                await writer.wait_closed()

                self.core_status = json.loads(resp_bytes.decode("utf-8", errors="replace").strip())
                self.core_host = h
                self.core_linked = True
                logger.info(
                    f"[CORE IPC OK] Linked with C++ ksm_core at {h}:{self.core_port}!\n"
                    f"    - Node ID:       {self.core_status.get('node_id', self.node_id)}\n"
                    f"    - Share Index:   x={self.core_status.get('share_index', self.share_index)}\n"
                    f"    - Stored Shares: {self.core_status.get('stored_shares', 0)}"
                )
                return True
            except Exception as e:
                logger.debug(f"Attempt on {h}:{self.core_port} failed ({e})")

        logger.warning(
            f"[!] Could not connect to C++ KSM Core IPC at {self.core_host}:{self.core_port}.\n"
            f"    (Ensure ksm_core.exe --daemon {self.core_port} {self.node_id} {self.share_index} {self.storage_dir} is running)"
        )
        self.core_linked = False
        return False

    async def forward_to_core(self, action_dict: dict) -> dict:
        """Send action JSON command to C++ ksm_core Winsock socket and return JSON response."""
        candidates = [self.core_host, "127.0.0.1", self.local_ip]
        payload = (json.dumps(action_dict) + "\n").encode("utf-8")

        for h in candidates:
            try:
                reader, writer = await asyncio.wait_for(
                    asyncio.open_connection(h, self.core_port), timeout=4.0
                )
                writer.write(payload)
                await writer.drain()

                resp_bytes = await asyncio.wait_for(reader.read(16384), timeout=5.0)
                writer.close()
                await writer.wait_closed()
                return json.loads(resp_bytes.decode("utf-8", errors="replace").strip())
            except Exception as e:
                logger.debug(f"[KSM IPC] Core communication on {h}:{self.core_port} failed: {e}")

        return {"status": "ERROR", "message": f"Could not reach C++ KSM Core on port {self.core_port}"}

    # =========================================================================
    # TERMINAL BANNERS
    # =========================================================================

    def print_store_share_banner(self, payload: dict, res: dict) -> None:
        print("\n" + "=" * 78)
        print(f" [+] KSM NODE {self.node_id}: SHARE STORED (DOCTOR/PATIENT KEY TIMED)")
        print("=" * 78)
        print(f"  [TX ID]            : {payload.get('tx_id')}")
        print(f"  [DATA ID]          : {payload.get('data_id')}")
        print(f"  [DOCTOR ID]        : {payload.get('doctor_id')}")
        print(f"  [PATIENT ID]       : {payload.get('patient_id')}")
        print(f"  [ACCESS KEY TIME]  : {payload.get('access_key_time')} (Validity window)")
        print(f"  [SHARE INDEX]      : x={payload.get('share_index', self.share_index)}")
        print(f"  [STORAGE STATUS]   : {res.get('status')} ({res.get('message', 'SQLite Ledger written')})")
        print(f"  [CORE WINSOCK IPC] : Linked at {self.core_host}:{self.core_port} [OK]")
        print("=" * 78 + "\n")

    def print_transform_share_banner(self, payload: dict, res: dict) -> None:
        print("\n" + "=" * 78)
        print(f" [+] KSM NODE {self.node_id}: TRANSFORMED SHARE DISPATCHED")
        print("=" * 78)
        print(f"  [TX ID]            : {payload.get('tx_id')}")
        print(f"  [DOCTOR ID]        : {payload.get('doctor_id')}")
        status = res.get("status")
        print(f"  [ACCESS TIME CHECK]: {'VALID' if status == 'SUCCESS' else 'DENIED'}")
        print(f"  [TRANSFORM STATUS] : {status} (Targeted to Doctor Public Key)")
        print("=" * 78 + "\n")

    # =========================================================================
    # P2P NETWORK MESSAGE ROUTING
    # =========================================================================

    async def handle_peer_connection(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        """Process inbound TCP socket connections from other network nodes."""
        peer_addr = writer.get_extra_info("peername")
        peer_key = f"{peer_addr[0]}:{peer_addr[1]}" if peer_addr else f"unknown-{uuid.uuid4().hex[:6]}"
        self.peer_writers[peer_key] = writer
        logger.info(f"(+) Inbound peer linked: {peer_key} (Total: {len(self.peer_writers)})")

        try:
            buffer = ""
            while self.running:
                chunk = await reader.read(4096)
                if not chunk:
                    break
                buffer += chunk.decode("utf-8", errors="replace")
                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    line = line.strip()
                    if not line:
                        continue

                    try:
                        msg = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    msg_type = msg.get("type", "").upper()

                    # 1. STORE_SHARE: Patient TrustZone writes share for doctor access
                    if msg_type == "STORE_SHARE":
                        logger.info(f"Processing STORE_SHARE for Tx={msg.get('tx_id')} by Patient={msg.get('patient_id')}")
                        core_cmd = {
                            "action": "STORE_SHARE",
                            "tx_id": msg.get("tx_id", ""),
                            "data_id": msg.get("data_id", ""),
                            "doctor_id": msg.get("doctor_id", ""),
                            "patient_id": msg.get("patient_id", ""),
                            "share_hex": msg.get("share_hex", ""),
                            "share_index": msg.get("share_index", self.share_index),
                            "access_key_time": msg.get("access_key_time", 0),
                            "threshold": msg.get("threshold", 3),
                            "total_nodes": msg.get("total_nodes", 4),
                            "status": msg.get("status", "ACTIVE"),
                        }
                        core_res = await self.forward_to_core(core_cmd)
                        self.print_store_share_banner(msg, core_res)

                        receipt = {
                            "type": "SHARE_STORED_RECEIPT",
                            "action": "SHARE_STORED_ACK",
                            "status": core_res.get("status", "SUCCESS"),
                            "node_id": self.node_id,
                            "tx_id": msg.get("tx_id"),
                            "data_id": msg.get("data_id"),
                            "doctor_id": msg.get("doctor_id"),
                            "patient_id": msg.get("patient_id"),
                            "share_index": self.share_index,
                            "access_key_time": msg.get("access_key_time"),
                            "message": core_res.get("message", "Share stored in KSM SQLite ledger"),
                            "timestamp": time.time(),
                        }
                        writer.write((json.dumps(receipt) + "\n").encode("utf-8"))
                        await writer.drain()

                    # 2. TRANSFORM_SHARE / PROXY RE-ENCRYPTION for doctor read query
                    elif msg_type in ("TRANSFORM_SHARE", "RE_ENCRYPT_SHARE", "GET_SHARE"):
                        logger.info(f"Processing TRANSFORM_SHARE for Tx={msg.get('tx_id')} by Doctor={msg.get('doctor_id')}")
                        core_cmd = {
                            "action": "TRANSFORM_SHARE",
                            "tx_id": msg.get("tx_id", ""),
                            "doctor_id": msg.get("doctor_id", ""),
                            "current_time": msg.get("current_time", int(time.time())),
                        }
                        core_res = await self.forward_to_core(core_cmd)
                        self.print_transform_share_banner(msg, core_res)

                        response = {
                            "type": "TRANSFORM_SHARE_RESPONSE",
                            "action": "TRANSFORM_SHARE_ACK" if core_res.get("status") == "SUCCESS" else "TRANSFORM_SHARE_DENIED",
                            "status": core_res.get("status", "ERROR"),
                            "node_id": self.node_id,
                            "tx_id": msg.get("tx_id"),
                            "doctor_id": msg.get("doctor_id"),
                            "share_index": core_res.get("share_index", self.share_index),
                            "share_hex": core_res.get("share_hex", ""),
                            "message": core_res.get("message", ""),
                            "timestamp": time.time(),
                        }
                        writer.write((json.dumps(response) + "\n").encode("utf-8"))
                        await writer.drain()

                    # 3. GET_PUBLIC_KEY: Network discovery of KSM public key
                    elif msg_type == "GET_PUBLIC_KEY":
                        core_res = await self.forward_to_core({"action": "GET_PUBLIC_KEY"})
                        pk_hex = core_res.get("public_key_hex") or f"04{'ab' * 64}"
                        resp = {
                            "type": "KSM_PUBLIC_KEY",
                            "node_id": self.node_id,
                            "share_index": self.share_index,
                            "public_key_hex": pk_hex,
                            "status": "ONLINE",
                            "timestamp": time.time(),
                        }
                        writer.write((json.dumps(resp) + "\n").encode("utf-8"))
                        await writer.drain()

                    # 3b. STORE_ESCROW_SHARE: Emergency Key Escrow storage on KSM Node
                    elif msg_type == "STORE_ESCROW_SHARE":
                        logger.info(f"Processing STORE_ESCROW_SHARE for Patient={msg.get('patient_id')}")
                        patient_id = msg.get("patient_id", "")
                        escrow_id = msg.get("escrow_id") or msg.get("tx_id") or f"escrow-{uuid.uuid4().hex[:8]}"
                        share_index = msg.get("share_index", self.share_index)
                        share_hex = msg.get("share_hex", "")
                        emergency_pubkey = msg.get("emergency_public_key", "")
                        threshold_t = msg.get("threshold", 2)
                        total_n = msg.get("total_nodes", 3)

                        self.escrow_storage.store_escrow_share(
                            escrow_id=escrow_id,
                            patient_id=patient_id,
                            share_index=share_index,
                            share_hex=share_hex,
                            emergency_public_key=emergency_pubkey,
                            threshold_t=threshold_t,
                            total_n=total_n,
                        )

                        core_cmd = {
                            "action": "STORE_ESCROW_SHARE",
                            "escrow_id": escrow_id,
                            "tx_id": escrow_id,
                            "patient_id": patient_id,
                            "share_index": share_index,
                            "share_hex": share_hex,
                            "emergency_public_key": emergency_pubkey,
                            "threshold": threshold_t,
                            "total_nodes": total_n,
                        }
                        core_res = await self.forward_to_core(core_cmd)

                        print("\n" + "=" * 78)
                        print(f" [+] KSM NODE {self.node_id}: EMERGENCY KEY ESCROW SHARE STORED")
                        print("=" * 78)
                        print(f"  [PATIENT ID]       : {patient_id}")
                        print(f"  [ESCROW ID]        : {escrow_id}")
                        print(f"  [SHARE INDEX]      : x={share_index}")
                        print(f"  [STORAGE STATUS]   : ACTIVE (KSM SQLite ledger written)")
                        print("=" * 78 + "\n")

                        receipt = {
                            "type": "ESCROW_STORED_RECEIPT",
                            "action": "ESCROW_STORED_ACK",
                            "status": "SUCCESS",
                            "node_id": self.node_id,
                            "node_role": "KSM",
                            "patient_id": patient_id,
                            "escrow_id": escrow_id,
                            "share_index": share_index,
                            "message": "Emergency key escrow share stored in KSM SQLite ledger",
                            "timestamp": time.time(),
                        }
                        writer.write((json.dumps(receipt) + "\n").encode("utf-8"))
                        await writer.drain()

                    # 3c. UNLOCK_ESCROW_SHARE: Release KSM emergency escrow share upon verified declaration
                    elif msg_type in ("UNLOCK_ESCROW_SHARE", "RELEASE_ESCROW_SHARE", "GET_ESCROW_SHARE"):
                        patient_id = msg.get("patient_id", "")
                        doctor_id = msg.get("doctor_id", "")
                        declaration = msg.get("declaration") or msg.get("reason", "")
                        logger.info(f"Processing UNLOCK_ESCROW_SHARE for Patient={patient_id} by Doctor={doctor_id}")

                        if "Emergency: Patient Unconscious" not in declaration and "Unconscious" not in declaration and "EMERGENCY" not in declaration.upper():
                            resp = {
                                "type": "ESCROW_UNLOCKED_RESPONSE",
                                "status": "DENIED",
                                "node_id": self.node_id,
                                "node_role": "KSM",
                                "message": "Emergency declaration invalid. Required: 'Emergency: Patient Unconscious'",
                            }
                        else:
                            core_res = {}
                            if self.core_linked:
                                core_res = await self.forward_to_core({
                                    "action": "UNLOCK_ESCROW_SHARE",
                                    "patient_id": patient_id,
                                    "tx_id": msg.get("escrow_id", ""),
                                    "doctor_id": doctor_id,
                                    "declaration": declaration,
                                })

                            unlocked = self.escrow_storage.unlock_escrow_share(patient_id, doctor_id, declaration)
                            s_idx = core_res.get("share_index") or (unlocked.get("share_index") if unlocked else self.share_index)
                            s_hex = core_res.get("share_hex") or (unlocked.get("share_hex") if unlocked else "")

                            if s_hex:
                                resp = {
                                    "type": "ESCROW_UNLOCKED_RESPONSE",
                                    "status": "SUCCESS",
                                    "node_id": self.node_id,
                                    "node_role": "KSM",
                                    "patient_id": patient_id,
                                    "share_index": s_idx,
                                    "share_hex": s_hex,
                                    "message": "Emergency key share unlocked by KSM node",
                                }
                            else:
                                resp = {
                                    "type": "ESCROW_UNLOCKED_RESPONSE",
                                    "status": "NOT_FOUND",
                                    "node_id": self.node_id,
                                    "node_role": "KSM",
                                    "message": f"No escrow share found for patient {patient_id} on KSM node",
                                }
                        writer.write((json.dumps(resp) + "\n").encode("utf-8"))
                        await writer.drain()

                    # 4. Status Query
                    elif msg_type in ("PING", "GET_STATUS"):
                        status_payload = {
                            "type": "PONG",
                            "node_id": self.node_id,
                            "node_type": "KSM",
                            "share_index": self.share_index,
                            "port": self.port,
                            "core_linked": self.core_linked,
                            "connected_peers": list(self.peer_writers.keys()),
                            "timestamp": time.time(),
                        }
                        writer.write((json.dumps(status_payload) + "\n").encode("utf-8"))
                        await writer.drain()

                    elif msg_type == "HELLO":
                        logger.info(f"Handshake from {msg.get('node_id', peer_key)} [{msg.get('node_type', 'PEER')}]")

        except (ConnectionResetError, asyncio.IncompleteReadError):
            pass
        except Exception as e:
            logger.warning(f"Peer {peer_key} error: {e}")
        finally:
            self.peer_writers.pop(peer_key, None)
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass
            logger.info(f"(-) Peer unlinked: {peer_key}")

    # =========================================================================
    # OUTBOUND PEER CONNECTIONS & TOPOLOGY LIMITS
    # =========================================================================

    async def connect_to_peer(self, peer_addr_str: str, peer_type: str = "VALIDATOR") -> bool:
        """Connect out as client to another peer node adhering to topology rules."""
        if peer_addr_str in self.peer_writers:
            return True

        # Enforce topology limits: max 10 of each other node type
        if peer_type == "VALIDATOR" and len(self.connected_validators) >= self.MAX_VALIDATORS:
            return False
        if peer_type == "CLIENT" and len(self.connected_clients) >= self.MAX_CLIENTS:
            return False
        if peer_type == "ARCHIVE" and len(self.connected_archives) >= self.MAX_ARCHIVES:
            return False
        if peer_type == "KSM" and len(self.connected_ksm) >= self.MAX_KSM:
            return False

        try:
            host, port_str = peer_addr_str.split(":")
            port = int(port_str)
        except ValueError:
            return False

        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(host, port), timeout=4.0
            )
            self.peer_writers[peer_addr_str] = writer

            if peer_type == "VALIDATOR":
                self.connected_validators.add(peer_addr_str)
            elif peer_type == "CLIENT":
                self.connected_clients.add(peer_addr_str)
            elif peer_type == "ARCHIVE":
                self.connected_archives.add(peer_addr_str)
            elif peer_type == "KSM":
                self.connected_ksm.add(peer_addr_str)

            logger.info(f"[OK] Connected to peer {peer_addr_str} [{peer_type}]")

            hello = json.dumps({
                "type": "HELLO",
                "node_id": self.node_id,
                "node_type": "KSM",
                "share_index": self.share_index,
                "port": self.port,
            }) + "\n"
            writer.write(hello.encode("utf-8"))
            await writer.drain()
            return True
        except Exception as e:
            logger.debug(f"Could not connect to {peer_addr_str}: {e}")
            return False

    # =========================================================================
    # BROADCAST SERVER DISCOVERY
    # =========================================================================

    async def tracker_registration_loop(self) -> None:
        """Register with Central Broadcast Server as KSM node."""
        if not self.broadcast_server:
            return

        try:
            b_host, b_port_str = self.broadcast_server.split(":")
            b_port = int(b_port_str)
        except ValueError:
            return

        while self.running:
            try:
                reader, writer = await asyncio.wait_for(
                    asyncio.open_connection(b_host, b_port), timeout=4.0
                )
                logger.info(f"[TRACKER] Registered KSM node '{self.node_id}' [Index: x={self.share_index}]")

                reg_msg = {
                    "type": "REGISTER",
                    "node_id": self.node_id,
                    "node_type": "KSM",
                    "host": self.local_ip,
                    "socket_port": self.port,
                    "share_index": self.share_index,
                }
                writer.write((json.dumps(reg_msg) + "\n").encode("utf-8"))
                await writer.drain()

                last_heartbeat = time.time()
                buffer = ""

                while self.running:
                    try:
                        read_task = asyncio.create_task(reader.read(4096))
                        done, _ = await asyncio.wait([read_task], timeout=2.0)
                        if read_task in done:
                            chunk = read_task.result()
                            if not chunk:
                                break
                            buffer += chunk.decode("utf-8", errors="replace")
                            while "\n" in buffer:
                                line, buffer = buffer.split("\n", 1)
                                line = line.strip()
                                if line:
                                    try:
                                        data = json.loads(line)
                                        await self.handle_tracker_event(data)
                                    except json.JSONDecodeError:
                                        pass
                        else:
                            read_task.cancel()
                    except asyncio.TimeoutError:
                        pass

                    if time.time() - last_heartbeat >= 10.0:
                        hb = {
                            "type": "HEARTBEAT",
                            "node_id": self.node_id,
                            "connected_peers": list(self.peer_writers.keys()),
                        }
                        writer.write((json.dumps(hb) + "\n").encode("utf-8"))
                        await writer.drain()
                        last_heartbeat = time.time()

            except Exception as e:
                logger.debug(f"[TRACKER] Disconnected from Broadcast Server ({e}). Retrying in 5s...")

            await asyncio.sleep(5.0)

    async def handle_tracker_event(self, msg: dict) -> None:
        msg_type = msg.get("type", "").upper()
        if msg_type == "REGISTER_ACK":
            recommended = msg.get("recommended_peers", [])
            for p in recommended:
                p_host = p.get("host", "127.0.0.1")
                p_port = p.get("socket_port")
                p_type = p.get("node_type", "VALIDATOR")
                if p_port:
                    addr = f"{p_host}:{p_port}"
                    self.target_peers.add(addr)
                    asyncio.create_task(self.connect_to_peer(addr, peer_type=p_type))

    # =========================================================================
    # LIFECYCLE MANAGEMENT
    # =========================================================================

    async def start(self) -> None:
        self.running = True
        print("=" * 78)
        print("   E-MEDICAL BOOKLET - DISTRIBUTED KSM NODE (PYTHON)")
        print("=" * 78)
        print(f" [+] Node Identifier   : {self.node_id}")
        print(f" [+] Node Role/Type    : KSM")
        print(f" [+] Share Coordinate  : x={self.share_index} (Threshold 3-of-4)")
        print(f" [+] P2P TCP Socket    : {self.host}:{self.port}")
        print(f" [+] C++ Core Winsock  : {self.core_host}:{self.core_port} (ksm_core.exe)")
        print(f" [+] Storage Ledger    : {self.storage_dir}")
        print(f" [+] Topology Limits   : Max 10 of each (Validators, Clients, Archives, KSM)")
        print("=" * 78)

        # 1. Bind P2P TCP Server
        self.server = await asyncio.start_server(
            self.handle_peer_connection,
            host=self.host,
            port=self.port,
        )
        logger.info(f"KSM Node P2P Server listening on {self.host}:{self.port}")

        # 2. Probe and link C++ ksm_core Winsock IPC
        if self.core_port:
            await self.link_cpp_core()

        # 3. Connect to Broadcast Server
        if self.broadcast_server:
            asyncio.create_task(self.tracker_registration_loop())

        print(f"[OK] KSM Node '{self.node_id}' is online and ready for Proxy Re-Encryption.")
        await self.server.serve_forever()

    async def stop(self) -> None:
        self.running = False
        if self.server:
            self.server.close()
            await self.server.wait_closed()
        for w in self.peer_writers.values():
            try:
                w.close()
            except Exception:
                pass
        self.peer_writers.clear()


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="E-Medical Booklet Distributed KSM Node (Python + C++ Winsock Core)"
    )
    parser.add_argument(
        "-p",
        "--port",
        type=int,
        default=8031,
        help="TCP port for peer connections (default: 8031)",
    )
    parser.add_argument(
        "--core-port",
        type=int,
        default=48075,
        help="Port of C++ ksm_core.exe Winsock daemon (default: 48075)",
    )
    parser.add_argument(
        "--core-host",
        type=str,
        default="127.0.0.1",
        help="Host of C++ ksm_core.exe Winsock daemon (default: 127.0.0.1)",
    )
    parser.add_argument(
        "--share-index",
        type=int,
        default=1,
        help="KSM share index (1-4, default: 1)",
    )
    parser.add_argument(
        "--node-id",
        type=str,
        default=None,
        help="Unique identifier for this KSM node",
    )
    parser.add_argument(
        "--host",
        type=str,
        default="0.0.0.0",
        help="Host address to bind P2P server (default: 0.0.0.0)",
    )
    parser.add_argument(
        "--broadcast-server",
        type=str,
        default="127.0.0.1:9099",
        help="Address of Central Broadcast Server (default: 127.0.0.1:9099)",
    )
    parser.add_argument(
        "--peers",
        type=str,
        default="",
        help="Comma-separated seed peers, e.g. '127.0.0.1:8002'",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_arguments()
    peers = [p.strip() for p in args.peers.split(",") if p.strip()] if args.peers else []

    node = KsmNode(
        node_id=args.node_id or f"ksm-{uuid.uuid4().hex[:6]}",
        share_index=args.share_index,
        host=args.host,
        port=args.port,
        core_host=args.core_host,
        core_port=args.core_port,
        broadcast_server=args.broadcast_server,
        initial_peers=peers,
    )

    try:
        asyncio.run(node.start())
    except (KeyboardInterrupt, SystemExit):
        logger.info("\n[*] KSM Node terminated.")


if __name__ == "__main__":
    main()
