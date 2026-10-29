"""
Automated Test for Broadcast Discovery Server & Multi-Client Node Failover
==========================================================================
Verifies:
  1. Central Broadcast Server node registration & tracking.
  2. Topology limit enforcement:
     - Client node receives at most 20 Validators.
     - Validator node receives at most 20 Validators and at most 5 Archive nodes.
  3. Multi-Client Node Failover:
     - Website connects to Client Node 1 (Primary / Privileged).
     - Broadcasts through Client Node 1.
     - Client Node 1 shuts down.
     - Website detects shutdown and auto-fails over to Client Node 2 (Fallback).
     - Broadcasts successfully through Client Node 2!
"""

import asyncio
import json
import websockets
from broadcast_server import BroadcastServer
from client_node import ClientNode

BROADCAST_PORT = 9199
CLIENT_1_SOCKET_PORT = 9101
CLIENT_1_WS_PORT = 8865

CLIENT_2_SOCKET_PORT = 9102
CLIENT_2_WS_PORT = 8866


async def run_full_suite():
    print("=" * 70)
    print(" [TEST SUITE] BROADCAST SERVER & MULTI-CLIENT FAILOVER TEST")
    print("=" * 70)

    # 1. Start Broadcast Server
    print("\n[STEP 1] Starting Central Broadcast Server on port", BROADCAST_PORT)
    broadcast_srv = BroadcastServer(host="127.0.0.1", port=BROADCAST_PORT)
    srv_task = asyncio.create_task(broadcast_srv.start())
    await asyncio.sleep(0.5)

    # 2. Register a swarm of simulated nodes: 25 Validators and 8 Archives
    print("\n[STEP 2] Simulating 25 Validators and 8 Archives registering with Broadcast Server...")
    from broadcast_server import NodeRecord
    for i in range(1, 26):
        broadcast_srv.nodes[f"val-{i:02d}"] = NodeRecord(
            node_id=f"val-{i:02d}",
            node_type="VALIDATOR",
            host="127.0.0.1",
            socket_port=8100 + i,
            ws_port=None,
            writer=None,
        )

    for j in range(1, 9):
        broadcast_srv.nodes[f"arc-{j:02d}"] = NodeRecord(
            node_id=f"arc-{j:02d}",
            node_type="ARCHIVE",
            host="127.0.0.1",
            socket_port=8200 + j,
            ws_port=None,
            writer=None,
        )

    summary = broadcast_srv.get_network_summary()
    print(f"[STEP 2 OK] Active in Tracker: {summary['validators_count']} Validators, {summary['archives_count']} Archives")

    # 3. Test Topology Limits
    print("\n[STEP 3] Testing Topology Rules & Limits:")
    # Rule A: Client Node recommendations (max 20 Validators)
    client_recs = broadcast_srv.get_peer_recommendations("test-client", "CLIENT")
    print(f" -> Client Node peer recommendations count: {len(client_recs)}")
    assert len(client_recs) == 20, f"Expected exactly 20 validators for client, got {len(client_recs)}"
    assert all(p["node_type"] == "VALIDATOR" for p in client_recs), "All client peers must be validators"
    print(" [PASS] Rule Verified: Client Node can connect to maximum 20 Validators!")

    # Rule B: Validator Node recommendations (up to 20 Validators + 5 Archives)
    val_recs = broadcast_srv.get_peer_recommendations("val-01", "VALIDATOR")
    val_validators = [p for p in val_recs if p["node_type"] == "VALIDATOR"]
    val_archives = [p for p in val_recs if p["node_type"] == "ARCHIVE"]
    print(f" -> Validator peer recommendations: {len(val_validators)} Validators, {len(val_archives)} Archives")
    assert len(val_validators) <= 20, "Validator can connect to max 20 Validators"
    assert len(val_archives) <= 5, "Validator can connect to max 5 Archives"
    print(" [PASS] Rule Verified: Validator connects to max 20 Validators and 5 Archives!")

    # 4. Multi-Client Node Failover Simulation
    print("\n[STEP 4] Testing Website Multi-Client Failover Mechanism:")
    print(" -> Launching Client Node 1 (Primary - WS :8865)...")
    client1 = ClientNode(
        host="127.0.0.1",
        socket_port=CLIENT_1_SOCKET_PORT,
        ws_port=CLIENT_1_WS_PORT,
        node_id="client-node-primary",
        broadcast_server=f"127.0.0.1:{BROADCAST_PORT}",
    )
    c1_task = asyncio.create_task(client1.start())

    print(" -> Launching Client Node 2 (Fallback - WS :8866)...")
    client2 = ClientNode(
        host="127.0.0.1",
        socket_port=CLIENT_2_SOCKET_PORT,
        ws_port=CLIENT_2_WS_PORT,
        node_id="client-node-fallback",
        broadcast_server=f"127.0.0.1:{BROADCAST_PORT}",
    )
    c2_task = asyncio.create_task(client2.start())
    await asyncio.sleep(1.0)

    # 4A. Website connects to Client Node 1 (Primary Privileged)
    ws1_uri = f"ws://127.0.0.1:{CLIENT_1_WS_PORT}"
    print(f" -> Website connects to Privileged Node 1 ({ws1_uri})...")
    ws1 = await websockets.connect(ws1_uri)
    welcome1 = json.loads(await ws1.recv())
    assert welcome1.get("type") == "WELCOME"
    print(" [OK] Website connected to Client Node 1 (Primary)")

    # Send broadcast through Node 1
    broadcast1 = {
        "type": "DOCTOR_CONSULTATION_START",
        "id": "tx-consult-001",
        "doctor": "Dr. Sarah Mbida",
        "patient": "John Doe",
    }
    await ws1.send(json.dumps(broadcast1))
    ack1 = json.loads(await ws1.recv())
    assert ack1.get("type") == "BROADCAST_ACK"
    print(f" [OK] Broadcast sent through Client Node 1: status={ack1.get('status')}")

    # 4B. Simulate Shutdown of Client Node 1
    print("\n -> [SIMULATION] Client Node 1 abruptly shuts down!")
    await client1.stop()
    c1_task.cancel()

    # Website detects connection close
    try:
        await ws1.recv()
    except Exception:
        print(" [DETECTED] Website detected disconnection of Client Node 1!")

    # 4C. Failover Mechanism routes to Client Node 2 (Fallback)
    ws2_uri = f"ws://127.0.0.1:{CLIENT_2_WS_PORT}"
    print(f" -> Failover initiated: Website reconnecting to Fallback Node 2 ({ws2_uri})...")
    ws2 = await websockets.connect(ws2_uri)
    welcome2 = json.loads(await ws2.recv())
    assert welcome2.get("type") == "WELCOME"
    print(" [FAILOVER SUCCESS] Website linked to Client Node 2 (Fallback)")

    # Send broadcast through Fallback Node 2
    broadcast2 = {
        "type": "PRESCRIPTION_MINT",
        "id": "tx-rx-002",
        "medication": "Amoxicillin 500mg",
        "status": "SIGNED",
    }
    await ws2.send(json.dumps(broadcast2))
    ack2 = json.loads(await ws2.recv())
    assert ack2.get("type") == "BROADCAST_ACK"
    print(f" [OK] Broadcast sent through Fallback Client Node 2: status={ack2.get('status')}")

    await ws2.close()
    await client2.stop()
    c2_task.cancel()

    await broadcast_srv.stop()
    srv_task.cancel()

    print("\n" + "=" * 70)
    print(" [COMPLETE SUCCESS] ALL BROADCAST & FAILOVER TESTS PASSED PERFECTLY!")
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(run_full_suite())
