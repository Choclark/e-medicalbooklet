#!/usr/bin/env python3
"""
E-Medical Booklet - Distributed Client Node
============================================
The Client Node acts as an intelligent edge gateway bridging web clients
(such as the PulseClinic Next.js platform) and the distributed P2P node network.

Architecture:
  - WebSocket Port (default: 8765): Web clients (PulseClinic) connect here.
    The website only connects to this ONE client node.
  - TCP Socket Port (default: 8001): Peer nodes (Full nodes, Validator nodes) connect here.
  - Outbound Peer Connections: The client node connects out to other nodes (e.g. port 8000).
  - Bi-directional Relay:
      * Web Client (PulseClinic) -> Client Node (WS) -> Broadcasts to all TCP Peer Nodes.
      * Peer Node -> Client Node (TCP) -> Pushes to all connected Web Clients (WS).
"""

import argparse
import asyncio
import collections
import json
import logging
import os
import socket
import sys
import time
import uuid
from typing import Dict, Optional, Set, Tuple

# Optional websockets import verification
try:
    import websockets
    from websockets.server import WebSocketServerProtocol
except ImportError:
    print("[!] Error: 'websockets' library is required. Install via: pip install websockets", file=sys.stderr)
    sys.exit(1)

# Ensure instant terminal output without buffering
sys.stdout.reconfigure(line_buffering=True)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("ClientNode")


def get_local_ip() -> str:
    """Retrieve machine hostname and corresponding local IP via socket."""
    hostname = socket.gethostname()
    try:
        ip = socket.gethostbyname(hostname)
    except socket.gaierror:
        ip = "127.0.0.1"
    return ip


class ClientNode:
    MAX_VALIDATORS = 20  # A Client Node connects to a MAXIMUM of 20 Validators
    MAX_KSM = 10         # A Client Node connects to a MAXIMUM of 10 KSM Nodes

    def __init__(
        self,
        host: str = "0.0.0.0",
        socket_port: int = 8001,
        ws_port: int = 8765,
        initial_peers: Optional[list[str]] = None,
        node_id: Optional[str] = None,
        broadcast_server: Optional[str] = "127.0.0.1:9099",
    ):
        self.host = host
        self.socket_port = socket_port
        self.ws_port = ws_port
        self.node_id = node_id or f"client-node-{uuid.uuid4().hex[:8]}"
        self.local_ip = get_local_ip()
        self.broadcast_server = broadcast_server if broadcast_server and broadcast_server.lower() != "none" else None

        # Web clients connected via WebSocket
        self.ws_clients: Set[WebSocketServerProtocol] = set()

        # Connected peer TCP sockets (writer objects mapped by remote address string)
        self.peer_writers: Dict[str, asyncio.StreamWriter] = {}

        # Initial seed peers to connect to (e.g. ["127.0.0.1:8000"])
        self.target_peers: Set[str] = set(initial_peers or [])

        # Active validator and KSM peers
        self.validator_peers: Set[str] = set()
        self.ksm_peers: Set[str] = set()

        # Message deduplication cache to prevent re-broadcast loops (LRU with max 1000 items)
        self.seen_message_ids: collections.deque = collections.deque(maxlen=1000)
        self.seen_ids_set: Set[str] = set()

        # Temporary staging buffer (before validator consensus) & Permanently committed store (after validator consensus)
        self.data_dir = os.path.join("chaindata", self.node_id)
        os.makedirs(self.data_dir, exist_ok=True)
        self.temp_staging_file = os.path.join(self.data_dir, "temp_pending_records.json")
        self.committed_file = os.path.join(self.data_dir, "permanently_committed_records.json")
        self.temp_pending_records: Dict[str, dict] = {}
        self.permanently_committed_records: Dict[str, dict] = {}
        self._load_client_staging_files()

        # Running servers
        self.tcp_server: Optional[asyncio.Server] = None
        self.ws_server = None
        self.running = False

    def _load_client_staging_files(self) -> None:
        try:
            if os.path.exists(self.temp_staging_file):
                with open(self.temp_staging_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict):
                        self.temp_pending_records = data
            if os.path.exists(self.committed_file):
                with open(self.committed_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict):
                        self.permanently_committed_records = data
        except Exception as e:
            logger.debug(f"[CLIENT STAGING] Could not load staging files: {e}")

    def _save_client_staging_files(self) -> None:
        try:
            with open(self.temp_staging_file, "w", encoding="utf-8") as f:
                json.dump(self.temp_pending_records, f, indent=2)
            with open(self.committed_file, "w", encoding="utf-8") as f:
                json.dump(self.permanently_committed_records, f, indent=2)
        except Exception as e:
            logger.debug(f"[CLIENT STAGING] Could not save staging files: {e}")

    def check_and_mark_seen(self, msg_id: str) -> bool:
        """Return True if message has already been processed, otherwise record it and return False."""
        if not msg_id:
            return False
        if msg_id in self.seen_ids_set:
            return True
        if len(self.seen_message_ids) >= self.seen_message_ids.maxlen:
            oldest = self.seen_message_ids.popleft()
            self.seen_ids_set.discard(oldest)
        self.seen_message_ids.append(msg_id)
        self.seen_ids_set.add(msg_id)
        return False

    def get_status_payload(self) -> dict:
        """Return snapshot status of the client node."""
        return {
            "type": "NODE_STATUS",
            "node_id": self.node_id,
            "role": "CLIENT_NODE",
            "local_ip": self.local_ip,
            "socket_port": self.socket_port,
            "ws_port": self.ws_port,
            "connected_peers": list(self.peer_writers.keys()),
            "peer_count": len(self.peer_writers),
            "web_clients_count": len(self.ws_clients),
            "configured_target_peers": list(self.target_peers),
            "timestamp": time.time(),
        }

    # =========================================================================
    # WEBSOCKET HANDLING (Web Clients / PulseClinic)
    # =========================================================================

    async def register_ws_client(self, websocket) -> None:
        self.ws_clients.add(websocket)
        client_addr = f"{websocket.remote_address[0]}:{websocket.remote_address[1]}"
        logger.info(f"[WS] (+) Web Client connected from {client_addr} (Total: {len(self.ws_clients)})")

        # Immediately send welcome handshake with node identity and peer status
        try:
            handshake = {
                **self.get_status_payload(),
                "type": "WELCOME",
                "message": "Connected to E-Medical Booklet Distributed Client Node",
            }
            await websocket.send(json.dumps(handshake))
        except Exception as e:
            logger.warning(f"[WS] Failed to send welcome handshake: {e}")

    async def unregister_ws_client(self, websocket) -> None:
        self.ws_clients.discard(websocket)
        try:
            client_addr = f"{websocket.remote_address[0]}:{websocket.remote_address[1]}"
        except Exception:
            client_addr = "unknown"
        logger.info(f"[WS] (-) Web Client disconnected: {client_addr} (Remaining: {len(self.ws_clients)})")

    async def broadcast_to_web_clients(self, payload: dict, exclude=None) -> None:
        """Send message to all connected web clients."""
        if not self.ws_clients:
            return

        message_str = json.dumps(payload)
        for ws in list(self.ws_clients):
            if ws == exclude:
                continue
            try:
                await ws.send(message_str)
            except Exception as e:
                logger.debug(f"[WS] Error pushing to web client: {e}")

    async def handle_ws_message(self, websocket: WebSocketServerProtocol, raw_data: str) -> None:
        """Handle incoming messages from a web client (e.g. PulseClinic)."""
        try:
            parsed = json.loads(raw_data)
        except json.JSONDecodeError:
            parsed = {"type": "BROADCAST", "content": raw_data}

        msg_type = parsed.get("type", "BROADCAST").upper()
        msg_id = parsed.get("id") or parsed.get("msg_id") or f"msg-{uuid.uuid4().hex[:12]}"
        parsed["msg_id"] = msg_id
        parsed["origin_node"] = self.node_id

        if msg_type == "PING":
            # Heartbeat query from website
            pong = {
                "type": "PONG",
                "timestamp": time.time(),
                "node_status": self.get_status_payload(),
            }
            await websocket.send(json.dumps(pong))
            return

        if msg_type == "GET_STATUS":
            # Website asks for current peers & status
            await websocket.send(json.dumps(self.get_status_payload()))
            return

        if msg_type == "CONNECT_PEER":
            # Website requests to connect to a new peer node dynamically
            target_peer = parsed.get("peer")
            if target_peer:
                logger.info(f"[WS] Website requested connection to peer: {target_peer}")
                self.target_peers.add(target_peer)
                asyncio.create_task(self.connect_to_peer(target_peer))
                await websocket.send(json.dumps({
                    "type": "PEER_CONNECT_INITIATED",
                    "target": target_peer,
                    "status": "CONNECTING",
                }))
            return

        # Default action: BROADCAST to P2P Node Network
        if self.check_and_mark_seen(msg_id):
            logger.debug(f"[WS] Message {msg_id} already processed, skipping re-broadcast.")
            return

        if msg_type == "PATIENT_REGISTRATION":
            logger.info(
                f"[WS] [+] Inbound PATIENT_REGISTRATION for '{parsed.get('name')}' "
                f"(UUID: {parsed.get('patient_id')}) with Device Token {parsed.get('device_token')}. "
                f"Relaying to {len(self.peer_writers)} peer validators..."
            )
        elif msg_type in ("RECORD_WRITE", "WRITE_RECORD", "CREATE_EHR_RECORD", "CONSENT_WRITE", "APPROVE_CONSENT", "REVOKE_CONSENT", "GRANT_CONSENT"):
            tx_key = parsed.get("tx_id") or msg_id
            parsed["tx_id"] = tx_key
            self.temp_pending_records[tx_key] = {
                **parsed,
                "persistence_state": "TEMPORARY_PENDING_CONSENSUS",
                "pipeline_stage": "SAVED_TEMPORARILY_IN_CLIENT_NODE",
                "staged_at": time.time(),
            }
            self._save_client_staging_files()
            logger.info(
                f"[WS] [TEMP STAGING] Saved {msg_type} ({tx_key}, category={parsed.get('record_category') or parsed.get('consent_action')}) "
                f"TEMPORARILY in Client Node ({self.node_id}) before dispatching to Validator Transaction Pool..."
            )
            await websocket.send(json.dumps({
                "type": "RECORD_PIPELINE_STATUS",
                "tx_id": tx_key,
                "msg_id": msg_id,
                "persistence_state": "TEMPORARY_PENDING_CONSENSUS",
                "stage": "SAVED_TEMPORARILY_IN_CLIENT_NODE",
                "node_id": self.node_id,
                "timestamp": time.time(),
            }))
        else:
            logger.info(f"[WS] (->) Web client broadcast request: type='{msg_type}', id='{msg_id}'")

        # 1. Broadcast out to all connected TCP Peer Nodes
        peer_count = await self.broadcast_to_peers(parsed)

        # 2. Echo to other connected web clients (e.g. multiple open tabs/doctors)
        await self.broadcast_to_web_clients(
            {
                "type": "BROADCAST_RELAY",
                "source": "WEB_CLIENT",
                "data": parsed,
                "broadcast_to_peers_count": peer_count,
            },
            exclude=websocket,
        )

        # 3. Send acknowledgment to the originating website
        ack = {
            "type": "BROADCAST_ACK",
            "msg_id": msg_id,
            "status": "SENT_TO_P2P_NETWORK",
            "peer_count": peer_count,
            "timestamp": time.time(),
        }
        await websocket.send(json.dumps(ack))

    async def ws_handler(self, websocket: WebSocketServerProtocol) -> None:
        """Handler for each incoming WebSocket connection from web client."""
        await self.register_ws_client(websocket)
        try:
            async for message in websocket:
                if isinstance(message, bytes):
                    message = message.decode("utf-8", errors="replace")
                await self.handle_ws_message(websocket, message)
        except websockets.exceptions.ConnectionClosed:
            pass
        except Exception as e:
            logger.warning(f"[WS] Handler error: {e}")
        finally:
            await self.unregister_ws_client(websocket)

    # =========================================================================
    # TCP SOCKET HANDLING (Other P2P Nodes)
    # =========================================================================

    async def handle_peer_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        """Handle incoming TCP connection from another node."""
        peer_addr = writer.get_extra_info("peername")
        peer_key = f"{peer_addr[0]}:{peer_addr[1]}" if peer_addr else f"unknown-{uuid.uuid4().hex[:6]}"
        self.peer_writers[peer_key] = writer
        logger.info(f"[SOCKET] (+) Inbound peer connected: {peer_key} (Total peers: {len(self.peer_writers)})")

        # Notify connected websites about the new peer
        await self.broadcast_to_web_clients({
            "type": "PEER_CONNECTED",
            "peer": peer_key,
            "direction": "INBOUND",
            "total_peers": len(self.peer_writers),
        })

        try:
            buffer = ""
            while self.running:
                chunk = await reader.read(4096)
                if not chunk:
                    break
                buffer += chunk.decode("utf-8", errors="replace")

                # Process newline-delimited or stream messages
                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    line = line.strip()
                    if line:
                        await self.on_message_from_peer(line, source_peer=peer_key)

            # Process any remaining text in buffer before closing
            if buffer.strip():
                await self.on_message_from_peer(buffer.strip(), source_peer=peer_key)

        except (ConnectionResetError, asyncio.IncompleteReadError):
            pass
        except Exception as e:
            logger.warning(f"[SOCKET] Error reading from peer {peer_key}: {e}")
        finally:
            self.peer_writers.pop(peer_key, None)
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass
            logger.info(f"[SOCKET] (-) Peer disconnected: {peer_key} (Remaining peers: {len(self.peer_writers)})")
            await self.broadcast_to_web_clients({
                "type": "PEER_DISCONNECTED",
                "peer": peer_key,
                "total_peers": len(self.peer_writers),
            })

    async def connect_to_peer(self, peer_address_str: str, peer_type: str = "VALIDATOR") -> bool:
        """Connect out as a client to a peer node at host:port."""
        if peer_address_str in self.peer_writers:
            return True

        if peer_type == "VALIDATOR" and len(self.validator_peers) >= self.MAX_VALIDATORS:
            logger.debug(f"[SOCKET] Max validators reached ({self.MAX_VALIDATORS}), skipping {peer_address_str}")
            return False
        if peer_type == "KSM" and len(self.ksm_peers) >= self.MAX_KSM:
            logger.debug(f"[SOCKET] Max KSM nodes reached ({self.MAX_KSM}), skipping {peer_address_str}")
            return False

        try:
            host, port_str = peer_address_str.split(":")
            port = int(port_str)
        except ValueError:
            logger.error(f"[SOCKET] Invalid peer format '{peer_address_str}'. Expected host:port")
            return False

        logger.info(f"[SOCKET] (->) Attempting outbound connection to peer {peer_address_str}...")
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(host, port),
                timeout=5.0,
            )
            peer_key = peer_address_str
            self.peer_writers[peer_key] = writer
            logger.info(f"[SOCKET] [OK] Successfully connected to peer node: {peer_key}")

            # Notify web clients
            await self.broadcast_to_web_clients({
                "type": "PEER_CONNECTED",
                "peer": peer_key,
                "direction": "OUTBOUND",
                "total_peers": len(self.peer_writers),
            })

            # Send initial hello/identification to the peer
            ident_msg = json.dumps({
                "type": "HELLO",
                "node_id": self.node_id,
                "role": "CLIENT_NODE",
                "socket_port": self.socket_port,
                "message": f"Hello from Client Node ({self.node_id})",
            }) + "\n"
            writer.write(ident_msg.encode("utf-8"))
            await writer.drain()

            # Start background reader task for this outbound connection
            asyncio.create_task(self.read_from_outbound_peer(reader, writer, peer_key))
            return True

        except (ConnectionRefusedError, asyncio.TimeoutError, OSError) as e:
            logger.debug(f"[SOCKET] Could not connect to peer {peer_address_str}: {e}")
            return False

    async def read_from_outbound_peer(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter, peer_key: str) -> None:
        """Continuously read data from an outbound connected peer."""
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
                    if line:
                        await self.on_message_from_peer(line, source_peer=peer_key)

            if buffer.strip():
                await self.on_message_from_peer(buffer.strip(), source_peer=peer_key)

        except (ConnectionResetError, asyncio.IncompleteReadError):
            pass
        except Exception as e:
            logger.warning(f"[SOCKET] Connection error with outbound peer {peer_key}: {e}")
        finally:
            self.peer_writers.pop(peer_key, None)
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass
            logger.info(f"[SOCKET] Outbound peer {peer_key} closed.")
            await self.broadcast_to_web_clients({
                "type": "PEER_DISCONNECTED",
                "peer": peer_key,
                "total_peers": len(self.peer_writers),
            })

    async def on_message_from_peer(self, raw_message: str, source_peer: str) -> None:
        """Triggered whenever a message is received from any peer node via TCP socket."""
        logger.info(f"[SOCKET] (<-) Received from peer [{source_peer}]: {raw_message[:120]}")

        # Attempt JSON parse
        try:
            parsed = json.loads(raw_message)
        except json.JSONDecodeError:
            parsed = {"type": "PEER_MESSAGE", "content": raw_message}

        msg_id = parsed.get("msg_id") or parsed.get("id") or ""
        if msg_id and self.check_and_mark_seen(msg_id):
            logger.debug(f"[SOCKET] Dropping duplicate message {msg_id}")
            return

        # If Validator sends RECORD_WRITE_RECEIPT or CONSENT_WRITE_RECEIPT after Consensus & DB Commit:
        # Promote from Temporary Staging -> Permanently Committed in Client Node, then notify Portal!
        if parsed.get("type") in ("RECORD_WRITE_RECEIPT", "CONSENT_WRITE_RECEIPT"):
            tx_key = parsed.get("request_tx_id") or parsed.get("tx_id") or ""
            temp_entry = self.temp_pending_records.pop(tx_key, None)
            committed_entry = {
                **(temp_entry or {}),
                **parsed,
                "persistence_state": "PERMANENTLY_SAVED",
                "pipeline_stage": "PERMANENTLY_COMMITTED_AFTER_CONSENSUS",
                "committed_at_client": time.time(),
            }
            if tx_key:
                self.permanently_committed_records[tx_key] = committed_entry
            self._save_client_staging_files()
            logger.info(
                f"[CLIENT COMMIT] Validator [{source_peer}] confirmed PBFT Consensus & DB Commit for Tx={tx_key} "
                f"(Block #{parsed.get('block_height')}). Promoted from TEMPORARY -> PERMANENTLY SAVED and notifying Portal!"
            )

        # 1. Forward directly to all connected Web Clients (PulseClinic)!
        forward_payload = {
            "type": "NODE_BROADCAST_EVENT",
            "source_peer": source_peer,
            "data": parsed,
            "received_at": time.time(),
        }
        await self.broadcast_to_web_clients(forward_payload)

        # 2. Gossip/forward to other connected peer nodes if this is a broadcast
        if parsed.get("type") in ("BROADCAST", "TRANSACTION", "EMERGENCY_ALERT", "MEDICAL_RECORD"):
            await self.broadcast_to_peers(parsed, exclude_peer=source_peer)

    async def broadcast_to_peers(self, payload: dict, exclude_peer: Optional[str] = None) -> int:
        """Broadcast JSON payload to all connected TCP peer nodes."""
        payload_str = json.dumps(payload) + "\n"
        encoded = payload_str.encode("utf-8")

        sent_count = 0
        dead_peers = []

        for peer_key, writer in list(self.peer_writers.items()):
            if peer_key == exclude_peer:
                continue
            try:
                writer.write(encoded)
                await writer.drain()
                sent_count += 1
            except Exception as e:
                logger.warning(f"[SOCKET] Failed to send to peer {peer_key}: {e}")
                dead_peers.append(peer_key)

        for dp in dead_peers:
            self.peer_writers.pop(dp, None)

        logger.info(f"[BROADCAST] Message sent to {sent_count} peer node(s).")
        return sent_count

    # =========================================================================
    # BACKGROUND PEER MAINTAINER
    # =========================================================================

    async def peer_connection_loop(self) -> None:
        """Regularly checks target peers and reconnects if disconnected."""
        while self.running:
            for peer in list(self.target_peers):
                if peer not in self.peer_writers:
                    # Attempt connection in background
                    asyncio.create_task(self.connect_to_peer(peer))
            await asyncio.sleep(5.0)

    async def broadcast_tracker_loop(self) -> None:
        """Connects to the Broadcast Server to register as CLIENT node and discover up to 20 validators."""
        if not self.broadcast_server:
            return

        try:
            b_host, b_port_str = self.broadcast_server.split(":")
            b_port = int(b_port_str)
        except ValueError:
            logger.error(f"[TRACKER] Invalid broadcast server format: {self.broadcast_server}")
            return

        while self.running:
            try:
                logger.info(f"[TRACKER] Contacting Broadcast Server at {self.broadcast_server}...")
                reader, writer = await asyncio.wait_for(
                    asyncio.open_connection(b_host, b_port),
                    timeout=4.0,
                )
                logger.info(f"[TRACKER] Linked to Broadcast Server! Registering node '{self.node_id}' [Type: CLIENT]")

                # Register as CLIENT node with our socket and ws ports
                reg_payload = {
                    "type": "REGISTER",
                    "node_id": self.node_id,
                    "node_type": "CLIENT",
                    "host": self.local_ip,
                    "socket_port": self.socket_port,
                    "ws_port": self.ws_port,
                }
                writer.write((json.dumps(reg_payload) + "\n").encode("utf-8"))
                await writer.drain()

                last_heartbeat = time.time()
                buffer = ""

                while self.running:
                    # Non-blocking read with timeout
                    try:
                        read_task = asyncio.create_task(reader.read(4096))
                        done, pending = await asyncio.wait([read_task], timeout=2.0)
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
                                        await self.handle_tracker_message(json.loads(line))
                                    except json.JSONDecodeError:
                                        pass
                        else:
                            read_task.cancel()
                    except asyncio.TimeoutError:
                        pass

                    # Periodic heartbeat (every 10s)
                    if time.time() - last_heartbeat >= 10.0:
                        hb_payload = {
                            "type": "HEARTBEAT",
                            "node_id": self.node_id,
                            "connected_peers": list(self.peer_writers.keys()),
                        }
                        writer.write((json.dumps(hb_payload) + "\n").encode("utf-8"))
                        await writer.drain()
                        last_heartbeat = time.time()

            except (ConnectionRefusedError, OSError, asyncio.TimeoutError) as e:
                logger.debug(f"[TRACKER] Broadcast server not reachable ({e}). Retrying in 5s...")
            except Exception as e:
                logger.warning(f"[TRACKER] Exception in tracker connection: {e}")

            await asyncio.sleep(5.0)

    async def handle_tracker_message(self, msg: dict) -> None:
        """Handle incoming peer discovery announcements and registration acknowledgments."""
        msg_type = msg.get("type", "").upper()

        if msg_type == "REGISTER_ACK":
            recommended = msg.get("recommended_peers", [])
            logger.info(
                f"[TRACKER] Broadcast Server returned {len(recommended)} recommended validator peers "
                f"(Client limit: max {self.MAX_VALIDATORS} validators)"
            )
            for peer_info in recommended:
                if len(self.validator_peers) >= self.MAX_VALIDATORS:
                    break
                p_host = peer_info.get("host", "127.0.0.1")
                p_port = peer_info.get("socket_port")
                if p_port:
                    peer_addr = f"{p_host}:{p_port}"
                    if peer_addr not in self.validator_peers:
                        self.validator_peers.add(peer_addr)
                        self.target_peers.add(peer_addr)
                        asyncio.create_task(self.connect_to_peer(peer_addr))

        elif msg_type == "NODE_JOINED":
            data = msg.get("data", {})
            if data.get("node_type") == "VALIDATOR":
                if len(self.validator_peers) < self.MAX_VALIDATORS:
                    p_host = data.get("host", "127.0.0.1")
                    p_port = data.get("socket_port")
                    if p_port:
                        peer_addr = f"{p_host}:{p_port}"
                        if peer_addr not in self.validator_peers:
                            logger.info(
                                f"[TRACKER] (+) New Validator detected: {peer_addr}. "
                                f"Connecting ({len(self.validator_peers) + 1}/{self.MAX_VALIDATORS})..."
                            )
                            self.validator_peers.add(peer_addr)
                            self.target_peers.add(peer_addr)
                            asyncio.create_task(self.connect_to_peer(peer_addr))

        elif msg_type == "NODE_LEFT":
            data = msg.get("data", {})
            p_host = data.get("host", "127.0.0.1")
            p_port = data.get("socket_port")
            if p_port:
                peer_addr = f"{p_host}:{p_port}"
                self.validator_peers.discard(peer_addr)
                self.target_peers.discard(peer_addr)

    # =========================================================================
    # LIFECYCLE START & STOP
    # =========================================================================

    async def start(self) -> None:
        """Start both TCP Socket Server and WebSocket Server concurrently."""
        self.running = True

        print("=" * 68)
        print("   DISTRIBUTED CLIENT NODE - E-MEDICAL BOOKLET NETWORK")
        print("=" * 68)
        print(f" [+] Node Identifier   : {self.node_id}")
        print(f" [+] Host IP (Local)   : {self.local_ip}")
        print(f" [+] TCP Socket Port   : {self.socket_port} (For Peer Nodes)")
        print(f" [+] WebSocket Port    : {self.ws_port} (For Website / PulseClinic)")
        print(f" [+] Broadcast Server  : {self.broadcast_server or 'None (Standalone)'}")
        print(f" [+] Validator Limit   : Max {self.MAX_VALIDATORS} Validators")
        print(f" [+] Target Seed Peers : {list(self.target_peers) if self.target_peers else 'None configured'}")
        print("=" * 68)

        # 1. Start TCP Socket Server (with fallback if port is busy on Windows)
        orig_socket_port = self.socket_port
        for offset in range(20):
            attempt_port = orig_socket_port + offset
            try:
                self.tcp_server = await asyncio.start_server(
                    self.handle_peer_client,
                    host=self.host,
                    port=attempt_port,
                )
                if attempt_port != orig_socket_port:
                    logger.warning(
                        f"[!] Socket port {orig_socket_port} is busy. "
                        f"Automatically bound to free socket port: {attempt_port}"
                    )
                self.socket_port = attempt_port
                break
            except OSError as e:
                if offset == 19:
                    raise e

        logger.info(f"[SOCKET] TCP Socket Server listening on {self.host}:{self.socket_port}")

        # 2. Start WebSocket Server for website connections (PulseClinic)
        orig_ws_port = self.ws_port
        for offset in range(20):
            attempt_ws = orig_ws_port + offset
            try:
                self.ws_server = await websockets.serve(
                    self.ws_handler,
                    host=self.host,
                    port=attempt_ws,
                )
                if attempt_ws != orig_ws_port:
                    logger.warning(
                        f"[!] WebSocket port {orig_ws_port} is busy. "
                        f"Automatically bound to free WebSocket port: {attempt_ws}"
                    )
                self.ws_port = attempt_ws
                break
            except OSError as e:
                if offset == 19:
                    raise e

        logger.info(f"[WS] WebSocket Server listening on ws://{self.host}:{self.ws_port}")

        # 3. Start peer reconnect loop
        asyncio.create_task(self.peer_connection_loop())

        # 4. Start broadcast tracker registration and discovery loop
        if self.broadcast_server:
            asyncio.create_task(self.broadcast_tracker_loop())

        print(f"[OK] Client Node is READY. Website can connect to: ws://127.0.0.1:{self.ws_port}")
        print(f"[OK] Press Ctrl+C to terminate.")

        # Keep servers running until interrupted
        await asyncio.gather(
            self.tcp_server.serve_forever(),
            self.ws_server.wait_closed(),
        )

    async def stop(self) -> None:
        """Gracefully shut down servers and close connections."""
        self.running = False
        logger.info("[*] Shutting down Client Node...")

        if self.ws_server:
            self.ws_server.close()
            await self.ws_server.wait_closed()

        for peer_key, writer in list(self.peer_writers.items()):
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass
        self.peer_writers.clear()

        if self.tcp_server:
            self.tcp_server.close()
            await self.tcp_server.wait_closed()

        logger.info("[*] Client Node terminated cleanly.")


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="E-Medical Booklet Distributed Client Node (Socket + WebSocket Bridge)"
    )
    parser.add_argument(
        "--ws-port",
        type=int,
        default=8765,
        help="Port for WebSocket server that websites (PulseClinic) connect to (default: 8765)",
    )
    parser.add_argument(
        "-p",
        "--socket-port",
        "--port",
        dest="socket_port",
        type=int,
        default=8001,
        help="Port for TCP socket server for peer nodes to connect to (default: 8001)",
    )
    parser.add_argument(
        "--host",
        type=str,
        default="0.0.0.0",
        help="Host address to bind both servers (default: 0.0.0.0)",
    )
    parser.add_argument(
        "--peers",
        type=str,
        default="127.0.0.1:8000",
        help="Comma-separated list of peer nodes to connect to, e.g. '127.0.0.1:8000' (default: 127.0.0.1:8000)",
    )
    parser.add_argument(
        "--node-id",
        type=str,
        default=None,
        help="Unique identifier for this client node",
    )
    parser.add_argument(
        "--broadcast-server",
        type=str,
        default="127.0.0.1:9099",
        help="Address of Central Broadcast & Discovery Server (default: 127.0.0.1:9099, or 'none')",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_arguments()
    peers = [p.strip() for p in args.peers.split(",") if p.strip()] if args.peers else []

    node = ClientNode(
        host=args.host,
        socket_port=args.socket_port,
        ws_port=args.ws_port,
        initial_peers=peers,
        node_id=args.node_id,
        broadcast_server=args.broadcast_server,
    )

    try:
        asyncio.run(node.start())
    except (KeyboardInterrupt, SystemExit):
        logger.info("\n[*] Interrupted by user.")
    except Exception as e:
        logger.error(f"[!] Fatal error: {e}", exc_info=True)


if __name__ == "__main__":
    main()
