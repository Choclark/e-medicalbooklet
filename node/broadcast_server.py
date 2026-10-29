#!/usr/bin/env python3
"""
E-Medical Booklet - Central Broadcast & Discovery Server
=========================================================
Central coordinator and tracker for the distributed P2P node network.

Core Responsibilities:
  1. Node Registration & Discovery:
     - Nodes register their node_id (name/id) and node_type:
       * "VALIDATOR"
       * "CLIENT"
       * "ARCHIVE"
     - Reports host, socket_port (P2P TCP), and ws_port (WebSocket for client nodes).

  2. Topology Connection Rules & Limits:
     - CLIENT Node   : can connect to a MAXIMUM of 20 Validators.
     - VALIDATOR Node: can connect to up to 20 Validators and up to 5 Archive nodes.
     - ARCHIVE Node  : maintains immutable ledger storage for validators.

  3. Peer Distribution & Dynamic Network Events:
     - Computes and returns peer recommendations when nodes join.
     - Broadcasts NODE_JOINED and NODE_LEFT notifications to all peers.
     - Exposes discovery queries for web portals (PulseClinic) to locate active client nodes.
"""

import argparse
import asyncio
import json
import logging
import socket
import sys
import time
from typing import Dict, List, Optional, Set

try:
    import websockets
    from websockets.server import WebSocketServerProtocol
    WEBSOCKETS_AVAILABLE = True
except ImportError:
    WEBSOCKETS_AVAILABLE = False

# Ensure instant terminal output without buffering
sys.stdout.reconfigure(line_buffering=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [BroadcastServer] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("BroadcastServer")


def get_local_ip() -> str:
    hostname = socket.gethostname()
    try:
        return socket.gethostbyname(hostname)
    except socket.gaierror:
        return "127.0.0.1"


class NodeRecord:
    def __init__(
        self,
        node_id: str,
        node_type: str,
        host: str,
        socket_port: int,
        ws_port: Optional[int] = None,
        writer: Optional[asyncio.StreamWriter] = None,
    ):
        self.node_id = node_id
        self.node_type = node_type.upper()  # VALIDATOR | CLIENT | ARCHIVE
        self.host = host
        self.socket_port = socket_port
        self.ws_port = ws_port
        self.writer = writer
        self.registered_at = time.time()
        self.last_seen = time.time()
        self.connected_peers: Set[str] = set()

    def to_dict(self) -> dict:
        return {
            "node_id": self.node_id,
            "node_type": self.node_type,
            "host": self.host,
            "socket_port": self.socket_port,
            "ws_port": self.ws_port,
            "registered_at": self.registered_at,
            "last_seen": self.last_seen,
            "connected_peers_count": len(self.connected_peers),
        }


class BroadcastServer:
    # Topology connection constraints
    MAX_VALIDATORS_FOR_CLIENT = 20
    MAX_KSM_FOR_CLIENT = 10

    MAX_VALIDATORS_FOR_VALIDATOR = 20
    MAX_ARCHIVES_FOR_VALIDATOR = 5
    MAX_KSM_FOR_VALIDATOR = 10

    MAX_VALIDATORS_FOR_KSM = 10
    MAX_CLIENTS_FOR_KSM = 10
    MAX_ARCHIVES_FOR_KSM = 10
    MAX_KSM_FOR_KSM = 10

    def __init__(self, host: str = "0.0.0.0", port: int = 9099, ws_port: int = 9100):
        self.host = host
        self.port = port
        self.ws_port = ws_port
        self.local_ip = get_local_ip()
        self.nodes: Dict[str, NodeRecord] = {}  # node_id -> NodeRecord (maintains registration order)
        self.view_number: int = 0  # PBFT view number v
        self.sequence_number: int = 0  # PBFT committed block sequence number
        self.server: Optional[asyncio.Server] = None
        self.ws_server = None
        self.ws_clients: Set = set()
        self.running = False

    def get_pbft_primary_info(self) -> dict:
        """
        Compute PBFT Primary (leader) using round-robin formula:
            Primary = v (mod N)
        Where v is current view number and N is total validated nodes in the network.
        At view 0, the first validator node registered on the network becomes the Primary proposer.
        """
        validators = [n for n in self.nodes.values() if n.node_type == "VALIDATOR"]
        validators.sort(key=lambda n: (n.registered_at, n.node_id))
        if not validators:
            return {
                "primary_node_id": None,
                "view_number": self.view_number,
                "validator_count": 0,
                "quorum_size": 1,
                "validators": [],
                "formula": "Primary = v (mod N)",
                "is_first_validator": True,
            }

        n = len(validators)
        primary_idx = self.view_number % n
        primary_node = validators[primary_idx]
        f = (n - 1) // 3 if n >= 4 else 0
        quorum = 2 * f + 1 if n >= 4 else max(1, n)

        return {
            "primary_node_id": primary_node.node_id,
            "primary_host": primary_node.host,
            "primary_port": primary_node.socket_port,
            "primary_index": primary_idx,
            "view_number": self.view_number,
            "sequence_number": self.sequence_number,
            "validator_count": n,
            "quorum_size": quorum,
            "fault_tolerance_f": f,
            "validators": [v.node_id for v in validators],
            "formula": "Primary = v (mod N)",
            "is_first_validator": (primary_idx == 0),
        }

    def get_peer_recommendations(self, node_id: str, node_type: str) -> List[dict]:
        """Compute recommended peer connections according to architectural topology rules."""
        node_type = node_type.upper()
        candidates: List[NodeRecord] = []

        if node_type == "CLIENT":
            # Rule: Client nodes can connect to max 20 Validators and max 10 KSM nodes
            validators = [
                n for n in self.nodes.values()
                if n.node_type == "VALIDATOR" and n.node_id != node_id
            ]
            validators.sort(key=lambda n: len(n.connected_peers))

            ksm_nodes = [
                n for n in self.nodes.values()
                if n.node_type == "KSM" and n.node_id != node_id
            ]
            ksm_nodes.sort(key=lambda n: len(n.connected_peers))

            candidates = (
                validators[: self.MAX_VALIDATORS_FOR_CLIENT]
                + ksm_nodes[: self.MAX_KSM_FOR_CLIENT]
            )

        elif node_type == "VALIDATOR":
            # Rule: Validator nodes can connect to up to 20 Validators, 5 Archives, and 10 KSM nodes
            validators = [
                n for n in self.nodes.values()
                if n.node_type == "VALIDATOR" and n.node_id != node_id
            ]
            validators.sort(key=lambda n: len(n.connected_peers))

            archives = [
                n for n in self.nodes.values()
                if n.node_type == "ARCHIVE" and n.node_id != node_id
            ]
            archives.sort(key=lambda n: len(n.connected_peers))

            ksm_nodes = [
                n for n in self.nodes.values()
                if n.node_type == "KSM" and n.node_id != node_id
            ]
            ksm_nodes.sort(key=lambda n: len(n.connected_peers))

            candidates = (
                validators[: self.MAX_VALIDATORS_FOR_VALIDATOR]
                + archives[: self.MAX_ARCHIVES_FOR_VALIDATOR]
                + ksm_nodes[: self.MAX_KSM_FOR_VALIDATOR]
            )

        elif node_type == "KSM":
            # Rule: KSM nodes connect to up to 10 of each other node type
            validators = [n for n in self.nodes.values() if n.node_type == "VALIDATOR" and n.node_id != node_id]
            clients = [n for n in self.nodes.values() if n.node_type == "CLIENT" and n.node_id != node_id]
            archives = [n for n in self.nodes.values() if n.node_type == "ARCHIVE" and n.node_id != node_id]
            ksm_nodes = [n for n in self.nodes.values() if n.node_type == "KSM" and n.node_id != node_id]

            candidates = (
                validators[: self.MAX_VALIDATORS_FOR_KSM]
                + clients[: self.MAX_CLIENTS_FOR_KSM]
                + archives[: self.MAX_ARCHIVES_FOR_KSM]
                + ksm_nodes[: self.MAX_KSM_FOR_KSM]
            )

        elif node_type == "ARCHIVE":
            peers = [
                n for n in self.nodes.values()
                if n.node_id != node_id
            ]
            candidates = peers[:20]

        return [c.to_dict() for c in candidates]

    async def broadcast_network_event(self, event_type: str, data: dict, exclude_id: Optional[str] = None) -> None:
        """Broadcast a network change notification to all actively connected nodes."""
        message = json.dumps({"type": event_type, "timestamp": time.time(), "data": data}) + "\n"
        encoded = message.encode("utf-8")

        for nid, record in list(self.nodes.items()):
            if nid == exclude_id or not record.writer:
                continue
            try:
                record.writer.write(encoded)
                await record.writer.drain()
            except Exception as e:
                logger.debug(f"Failed to send event to node {nid}: {e}")

        # Also push real-time discovery events to connected Web Portals via WebSocket
        if self.ws_clients:
            ws_msg = json.dumps({
                "type": event_type,
                "timestamp": time.time(),
                "data": data,
                "client_nodes": [
                    n.to_dict() for n in self.nodes.values()
                    if n.node_type == "CLIENT" and n.ws_port
                ],
                "summary": self.get_network_summary(),
            })
            for ws in list(self.ws_clients):
                try:
                    asyncio.create_task(ws.send(ws_msg))
                except Exception:
                    pass

    async def handle_portal_ws(self, websocket) -> None:
        """Handle incoming WebSocket connection from web portals (PulseClinic) for node discovery."""
        self.ws_clients.add(websocket)
        peer_addr = getattr(websocket, "remote_address", ("unknown", 0))
        logger.info(f"[WS] (+) Web Portal connected from {peer_addr} (Total portals: {len(self.ws_clients)})")
        try:
            # 1. Send immediate active client nodes list to newly connected portal
            client_nodes = [
                n.to_dict() for n in self.nodes.values()
                if n.node_type == "CLIENT" and n.ws_port
            ]
            initial_payload = {
                "type": "CLIENT_NODES_LIST",
                "client_nodes": client_nodes,
                "all_nodes": [n.to_dict() for n in self.nodes.values()],
                "summary": self.get_network_summary(),
                "timestamp": time.time(),
            }
            await websocket.send(json.dumps(initial_payload))

            # 2. Process queries from portal
            async for raw_msg in websocket:
                try:
                    query = json.loads(raw_msg)
                except json.JSONDecodeError:
                    continue
                q_type = query.get("type", "").upper()
                if q_type in ("GET_CLIENT_NODES", "GET_NODES", "REFRESH"):
                    c_nodes = [
                        n.to_dict() for n in self.nodes.values()
                        if n.node_type == "CLIENT" and n.ws_port
                    ]
                    await websocket.send(json.dumps({
                        "type": "CLIENT_NODES_LIST",
                        "client_nodes": c_nodes,
                        "all_nodes": [n.to_dict() for n in self.nodes.values()],
                        "summary": self.get_network_summary(),
                        "timestamp": time.time(),
                    }))
                elif q_type == "PING":
                    await websocket.send(json.dumps({"type": "PONG", "timestamp": time.time()}))
        except Exception as e:
            logger.debug(f"[WS] Portal connection closed: {e}")
        finally:
            self.ws_clients.discard(websocket)
            logger.info(f"[WS] (-) Web Portal disconnected (Remaining portals: {len(self.ws_clients)})")

    async def handle_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        """Handle incoming node session on the broadcast server."""
        current_node_id: Optional[str] = None
        peer_addr = writer.get_extra_info("peername")
        remote_ip = peer_addr[0] if peer_addr else "127.0.0.1"

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

                    if msg_type == "REGISTER":
                        # Node introduces itself
                        node_id = msg.get("node_id") or f"node-{remote_ip}-{time.time()}"
                        node_type = msg.get("node_type", "VALIDATOR").upper()
                        host = msg.get("host", remote_ip)
                        if host in ("0.0.0.0", "localhost"):
                            host = remote_ip
                        socket_port = int(msg.get("socket_port", 8000))
                        ws_port = msg.get("ws_port")
                        if ws_port is not None:
                            ws_port = int(ws_port)

                        current_node_id = node_id
                        existing = self.nodes.get(node_id)
                        reg_time = existing.registered_at if existing else time.time()
                        record = NodeRecord(
                            node_id=node_id,
                            node_type=node_type,
                            host=host,
                            socket_port=socket_port,
                            ws_port=ws_port,
                            writer=writer,
                        )
                        record.registered_at = reg_time
                        self.nodes[node_id] = record
                        logger.info(
                            f"[+] Registered node '{node_id}' [Type: {node_type}] "
                            f"(TCP Socket: {host}:{socket_port}"
                            f"{f', WS: :{ws_port}' if ws_port else ''})"
                        )

                        # Compute recommended peers adhering to topology rules
                        recommended = self.get_peer_recommendations(node_id, node_type)

                        ack_payload = {
                            "type": "REGISTER_ACK",
                            "status": "OK",
                            "node_id": node_id,
                            "node_type": node_type,
                            "recommended_peers": recommended,
                            "pbft_consensus": self.get_pbft_primary_info(),
                            "topology_limits": {
                                "client_max_validators": self.MAX_VALIDATORS_FOR_CLIENT,
                                "validator_max_validators": self.MAX_VALIDATORS_FOR_VALIDATOR,
                                "validator_max_archives": self.MAX_ARCHIVES_FOR_VALIDATOR,
                            },
                            "active_network_summary": self.get_network_summary(),
                        }
                        writer.write((json.dumps(ack_payload) + "\n").encode("utf-8"))
                        await writer.drain()

                        # Announce new node to all existing nodes with updated PBFT primary info
                        node_joined_data = record.to_dict()
                        node_joined_data["pbft_consensus"] = self.get_pbft_primary_info()
                        asyncio.create_task(
                            self.broadcast_network_event(
                                "NODE_JOINED", node_joined_data, exclude_id=node_id
                            )
                        )

                    elif msg_type == "PBFT_VIEW_CHANGE" or msg_type == "VIEW_CHANGE":
                        # Fault recovery: increment view number and rotate to next round-robin Primary = (v+1) mod N
                        old_view = self.view_number
                        self.view_number += 1
                        new_info = self.get_pbft_primary_info()
                        logger.warning(
                            f"[PBFT] View Change triggered! View {old_view} -> {self.view_number}. "
                            f"New Primary: {new_info.get('primary_node_id')} (v mod N = {new_info.get('primary_index')})"
                        )
                        asyncio.create_task(
                            self.broadcast_network_event(
                                "PBFT_NEW_VIEW",
                                {
                                    "view_number": self.view_number,
                                    "old_view": old_view,
                                    "pbft_consensus": new_info,
                                    "reason": msg.get("reason", "Leader timeout / fault reported"),
                                }
                            )
                        )
                        resp = {
                            "type": "VIEW_CHANGE_ACK",
                            "status": "OK",
                            "new_view": self.view_number,
                            "pbft_consensus": new_info,
                        }
                        writer.write((json.dumps(resp) + "\n").encode("utf-8"))
                        await writer.drain()

                    elif msg_type == "GET_PBFT_PRIMARY":
                        resp = {
                            "type": "PBFT_PRIMARY_RESPONSE",
                            "pbft_consensus": self.get_pbft_primary_info(),
                        }
                        writer.write((json.dumps(resp) + "\n").encode("utf-8"))
                        await writer.drain()

                    elif msg_type == "HEARTBEAT" or msg_type == "PING":
                        if current_node_id and current_node_id in self.nodes:
                            self.nodes[current_node_id].last_seen = time.time()
                            peers_list = msg.get("connected_peers", [])
                            self.nodes[current_node_id].connected_peers = set(peers_list)

                        pong = {
                            "type": "PONG",
                            "timestamp": time.time(),
                            "active_nodes_count": len(self.nodes),
                        }
                        writer.write((json.dumps(pong) + "\n").encode("utf-8"))
                        await writer.drain()

                    elif msg_type == "GET_PEERS":
                        # Node explicitly queries for updated peer recommendations
                        ntype = msg.get("node_type")
                        if not ntype and current_node_id and current_node_id in self.nodes:
                            ntype = self.nodes[current_node_id].node_type
                        ntype = ntype or "CLIENT"
                        rec = self.get_peer_recommendations(current_node_id or "", ntype)
                        resp = {
                            "type": "PEER_RECOMMENDATIONS",
                            "node_type": ntype,
                            "peers": rec,
                        }
                        writer.write((json.dumps(resp) + "\n").encode("utf-8"))
                        await writer.drain()

                    elif msg_type == "GET_NODES" or msg_type == "GET_CLIENT_NODES":
                        # Discovery query for website / tools
                        client_nodes = [
                            n.to_dict() for n in self.nodes.values()
                            if n.node_type == "CLIENT" and n.ws_port
                        ]
                        all_nodes = [n.to_dict() for n in self.nodes.values()]
                        resp = {
                            "type": "NODES_LIST",
                            "client_nodes": client_nodes,
                            "all_nodes": all_nodes,
                            "summary": self.get_network_summary(),
                        }
                        writer.write((json.dumps(resp) + "\n").encode("utf-8"))
                        await writer.drain()

                    elif msg_type == "DEREGISTER":
                        break

        except (ConnectionResetError, asyncio.IncompleteReadError):
            pass
        except Exception as e:
            logger.warning(f"Error handling node {current_node_id}: {e}")
        finally:
            if current_node_id and current_node_id in self.nodes:
                leaving_record = self.nodes.pop(current_node_id, None)
                logger.info(f"[-] Node left: '{current_node_id}' (Remaining nodes: {len(self.nodes)})")
                if leaving_record:
                    asyncio.create_task(
                        self.broadcast_network_event("NODE_LEFT", leaving_record.to_dict())
                    )
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass

    def get_network_summary(self) -> dict:
        validators = [n for n in self.nodes.values() if n.node_type == "VALIDATOR"]
        clients = [n for n in self.nodes.values() if n.node_type == "CLIENT"]
        archives = [n for n in self.nodes.values() if n.node_type == "ARCHIVE"]
        return {
            "total_nodes": len(self.nodes),
            "validators_count": len(validators),
            "clients_count": len(clients),
            "archives_count": len(archives),
        }

    async def prune_stale_nodes_loop(self) -> None:
        """Prune nodes that have not sent a heartbeat for more than 45 seconds."""
        while self.running:
            await asyncio.sleep(15.0)
            now = time.time()
            stale_ids = [
                nid for nid, rec in self.nodes.items()
                if now - rec.last_seen > 45.0
            ]
            for sid in stale_ids:
                logger.warning(f"Pruning stale node '{sid}' due to heartbeat timeout.")
                rec = self.nodes.pop(sid, None)
                if rec:
                    if rec.writer:
                        try:
                            rec.writer.close()
                        except Exception:
                            pass
                    await self.broadcast_network_event("NODE_LEFT", rec.to_dict())

    async def start(self) -> None:
        self.running = True
        print("=" * 70)
        print("    E-MEDICAL BOOKLET - BROADCAST & PEER DISCOVERY SERVER")
        print("=" * 70)
        print(f" [+] Server Host/IP : {self.local_ip} (Bound: {self.host})")
        print(f" [+] Broadcast Port : {self.port} (TCP for P2P Nodes)")
        if WEBSOCKETS_AVAILABLE:
            print(f" [+] Discovery WS   : {self.ws_port} (WebSocket for PulseClinic Web Portals)")
        print(" [+] Topology Rules :")
        print(f"     - Client Node    -> Max {self.MAX_VALIDATORS_FOR_CLIENT} Validators")
        print(f"     - Validator Node -> Max {self.MAX_VALIDATORS_FOR_VALIDATOR} Validators + {self.MAX_ARCHIVES_FOR_VALIDATOR} Archives")
        print("=" * 70)

        self.server = await asyncio.start_server(
            self.handle_client,
            host=self.host,
            port=self.port,
        )
        logger.info(f"Broadcast Server TCP listening on {self.host}:{self.port}")

        if WEBSOCKETS_AVAILABLE:
            try:
                self.ws_server = await websockets.serve(
                    self.handle_portal_ws,
                    self.host,
                    self.ws_port,
                )
                logger.info(f"Broadcast Discovery WebSocket listening on ws://{self.host}:{self.ws_port}")
            except Exception as e:
                logger.warning(f"Could not bind Discovery WebSocket server on port {self.ws_port}: {e}")

        asyncio.create_task(self.prune_stale_nodes_loop())

        await self.server.serve_forever()

    async def stop(self) -> None:
        self.running = False
        logger.info("Stopping Broadcast Server...")
        if self.ws_server:
            self.ws_server.close()
            await self.ws_server.wait_closed()
        if self.server:
            self.server.close()
            await self.server.wait_closed()
        for rec in self.nodes.values():
            if rec.writer:
                try:
                    rec.writer.close()
                except Exception:
                    pass
        self.nodes.clear()
        logger.info("Broadcast Server stopped.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="E-Medical Booklet Central Broadcast & Discovery Server"
    )
    parser.add_argument(
        "-p",
        "--port",
        type=int,
        default=9099,
        help="TCP port for the Broadcast & Discovery Server (default: 9099)",
    )
    parser.add_argument(
        "--ws-port",
        type=int,
        default=9100,
        help="WebSocket port for Web Portals (PulseClinic) node discovery (default: 9100)",
    )
    parser.add_argument(
        "--host",
        type=str,
        default="0.0.0.0",
        help="Host address to bind the broadcast server (default: 0.0.0.0)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    srv = BroadcastServer(host=args.host, port=args.port, ws_port=args.ws_port)
    try:
        asyncio.run(srv.start())
    except (KeyboardInterrupt, SystemExit):
        logger.info("\nBroadcast Server terminated by user.")


if __name__ == "__main__":
    main()
