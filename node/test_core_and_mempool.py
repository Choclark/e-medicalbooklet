"""
Automated Test for Blockchain Core IPC Linking & Hospital Booklet Access Transaction
====================================================================================
"""

import asyncio
import json
import socket
from main import DistributedNode

CORE_PORT = 50055
VALIDATOR_PORT = 8002

core_received_messages = []


async def mock_blockchain_core_server(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    """Simulates native C++ blockchain_core.exe IPC server on port 50055."""
    buffer = ""
    try:
        while True:
            chunk = await reader.read(4096)
            if not chunk:
                break
            buffer += chunk.decode("utf-8")
            while "\n" in buffer:
                line, buffer = buffer.split("\n", 1)
                line = line.strip()
                if line:
                    core_received_messages.append(line)
                    # Respond with C++ Core format
                    reply = '{"status": "OK", "response": "Hello from Blockchain Core C++! Received: ' + line + '"}\n'
                    writer.write(reply.encode("utf-8"))
                    await writer.drain()
    except Exception:
        pass
    finally:
        writer.close()


async def run_test():
    print("=" * 76)
    print(" [TEST] BLOCKCHAIN CORE LINKING & HOSPITAL ACCESS TRANSACTION QUEUE")
    print("=" * 76)

    # 1. Start Mock Blockchain Core C++ Server
    print(f"\n[1] Starting C++ Blockchain Core IPC Server on port {CORE_PORT}...")
    core_srv = await asyncio.start_server(mock_blockchain_core_server, host="127.0.0.1", port=CORE_PORT)

    # 2. Start Validator Node configured with Core Port 50055
    print(f"[2] Launching Validator Node on port {VALIDATOR_PORT} with --core-port {CORE_PORT}...")
    validator = DistributedNode(
        node_id="val-yaounde-01",
        node_type="VALIDATOR",
        host="127.0.0.1",
        port=VALIDATOR_PORT,
        broadcast_server="none",
        core_host="127.0.0.1",
        core_port=CORE_PORT,
    )
    val_task = asyncio.create_task(validator.start())
    await asyncio.sleep(1.0)

    # Verify Validator linked to Core
    assert validator.core_linked is True, "Validator failed to link with Blockchain Core!"
    print(f" [PASS] Validator linked to C++ Blockchain Core IPC on port {CORE_PORT}!")

    # 3. Simulate Hospital sending booklet access request
    print("\n[3] Hospital sending booklet access request to Validator...")
    payload = {
        "type": "HOSPITAL_ACCESS_REQUEST",
        "hospital_name": "Yaounde Central Hospital",
        "doctor_name": "Dr. Arthur Whitfield",
        "patient_id": "patient-kamga-01",
        "department": "Cardiology & Emergency",
        "duration_hours": 4,
        "scope": ["EHR_RECORDS", "PRESCRIPTIONS", "LAB_TESTS"],
    }

    reader, writer = await asyncio.open_connection("127.0.0.1", validator.port)
    writer.write((json.dumps(payload) + "\n").encode("utf-8"))
    await writer.drain()

    raw_resp = await asyncio.wait_for(reader.read(4096), timeout=3.0)
    receipt = json.loads(raw_resp.decode("utf-8").strip())
    writer.close()
    await writer.wait_closed()

    print(f"[4] Verifying Transaction Receipt received by Hospital Client...")
    print(f" -> Received Transaction ID : {receipt.get('tx_id')}")
    print(f" -> Queue Position          : #{receipt.get('queue_position')}")
    print(f" -> Status                  : {receipt.get('status')}")

    assert receipt.get("type") == "TRANSACTION_RECEIPT"
    assert receipt.get("status") == "QUEUED"
    assert "tx-req-" in receipt.get("tx_id")
    assert len(validator.transaction_queue) == 1
    assert validator.transaction_queue[0]["tx_id"] == receipt.get("tx_id")
    print(" [PASS] Transaction is stored in Validator's transaction queue (mempool)!")

    # Verify Core received transaction forward
    await asyncio.sleep(0.5)
    core_has_tx = any("TRANSACTION_SUBMIT" in msg for msg in core_received_messages)
    assert core_has_tx, "Blockchain core did not receive forwarded transaction!"
    print(" [PASS] Transaction forwarded to C++ Blockchain Core IPC!")

    print("\n" + "=" * 76)
    print(" [SUCCESS] ALL BLOCKCHAIN CORE & TRANSACTION QUEUE TESTS PASSED!")
    print("=" * 76)

    await validator.stop()
    val_task.cancel()
    core_srv.close()
    await core_srv.wait_closed()


if __name__ == "__main__":
    asyncio.run(run_test())
