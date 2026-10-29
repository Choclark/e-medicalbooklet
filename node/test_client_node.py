"""
Automated End-to-End Test for Client Node
=========================================
Tests the complete dual-port bridging functionality:
1. TCP Socket Port (for P2P peer nodes)
2. WebSocket Port (for Website / PulseClinic)
3. Bidirectional broadcast propagation:
   - Website (WS) -> Client Node -> Peer Node (TCP Socket)
   - Peer Node (TCP Socket) -> Client Node -> Website (WS)
"""

import asyncio
import json
import sys
import websockets
from client_node import ClientNode

PEER_PORT = 9000
CLIENT_NODE_SOCKET_PORT = 9001
CLIENT_NODE_WS_PORT = 8765

peer_received_messages = []
ws_received_messages = []


async def mock_peer_server(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    """Simulates another distributed P2P node running on TCP port 8000."""
    print("[MOCK PEER] Accepted connection from Client Node!")
    buffer = ""
    try:
        while True:
            data = await reader.read(4096)
            if not data:
                break
            buffer += data.decode("utf-8")
            while "\n" in buffer:
                line, buffer = buffer.split("\n", 1)
                line = line.strip()
                if line:
                    print(f"[MOCK PEER] Received line: {line}")
                    peer_received_messages.append(line)
                    # When broadcast request arrives from client node, reply with a peer broadcast event
                    if "DOCTOR_ACCESS_REQUEST" in line:
                        reply = json.dumps({
                            "type": "PEER_BROADCAST",
                            "msg_id": "peer-alert-response-99",
                            "title": "Hospital Lab Result Anchored",
                            "content": "Blood test batch #9812 verified by PBFT validator",
                        }) + "\n"
                        writer.write(reply.encode("utf-8"))
                        await writer.drain()
    except Exception as e:
        print(f"[MOCK PEER] Exception: {e}")
    finally:
        writer.close()


async def run_test():
    print("[TEST] 1. Starting Mock Peer Node TCP Server on port", PEER_PORT)
    peer_srv = await asyncio.start_server(mock_peer_server, host="127.0.0.1", port=PEER_PORT)

    print("[TEST] 2. Starting Client Node (Socket Port 8001, WS Port 8765)...")
    client_node = ClientNode(
        host="127.0.0.1",
        socket_port=CLIENT_NODE_SOCKET_PORT,
        ws_port=CLIENT_NODE_WS_PORT,
        initial_peers=[f"127.0.0.1:{PEER_PORT}"],
        node_id="test-client-node-01",
    )
    node_task = asyncio.create_task(client_node.start())

    # Allow servers to bind and connect
    await asyncio.sleep(1.0)

    print("[TEST] 3. Simulating Website (PulseClinic) connecting to Client Node via WebSocket...")
    ws_uri = f"ws://127.0.0.1:{CLIENT_NODE_WS_PORT}"
    async with websockets.connect(ws_uri) as ws:
        # Read welcome message
        welcome_raw = await asyncio.wait_for(ws.recv(), timeout=3.0)
        welcome = json.loads(welcome_raw)
        print(f"[TEST] Received welcome from Client Node: type={welcome.get('type')}, role={welcome.get('role')}")
        assert welcome.get("type") == "WELCOME", "Expected WELCOME message"

        print("[TEST] 4. Website sends broadcast request to Client Node over WebSocket...")
        test_broadcast = {
            "type": "DOCTOR_ACCESS_REQUEST",
            "id": "bc-req-12345",
            "title": "Emergency Consultation Request",
            "doctor": "Dr. Arthur Whitfield",
            "hospital": "Pulse Central Hospital",
        }
        await ws.send(json.dumps(test_broadcast))

        # Expect ACK back on WebSocket
        ack_raw = await asyncio.wait_for(ws.recv(), timeout=3.0)
        ack = json.loads(ack_raw)
        print(f"[TEST] Received ACK from Client Node: {ack}")
        assert ack.get("type") == "BROADCAST_ACK", "Expected BROADCAST_ACK"

        # Give TCP peer a moment to receive and reply
        await asyncio.sleep(1.0)

        # Expect the mock peer's reply forwarded to WebSocket by the Client Node
        forwarded_raw = await asyncio.wait_for(ws.recv(), timeout=3.0)
        forwarded = json.loads(forwarded_raw)
        print(f"[TEST] Received forwarded peer message on WebSocket: {forwarded}")
        assert forwarded.get("type") == "NODE_BROADCAST_EVENT", "Expected NODE_BROADCAST_EVENT"
        assert forwarded.get("data", {}).get("title") == "Hospital Lab Result Anchored"

    print("[TEST] 5. Verifying message was received by Mock Peer via TCP Socket...")
    assert len(peer_received_messages) >= 1, "Mock peer did not receive message"
    parsed_peer_msg = json.loads(peer_received_messages[-1])
    assert parsed_peer_msg.get("id") == "bc-req-12345"
    assert parsed_peer_msg.get("title") == "Emergency Consultation Request"

    print("=" * 60)
    print(" [SUCCESS] ALL CLIENT NODE INTEGRATION TESTS PASSED PERFECTLY!")
    print("=" * 60)

    await client_node.stop()
    peer_srv.close()
    await peer_srv.wait_closed()
    node_task.cancel()


if __name__ == "__main__":
    try:
        asyncio.run(run_test())
    except KeyboardInterrupt:
        pass
