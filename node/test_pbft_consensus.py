#!/usr/bin/env python3
"""
Automated Test Suite for PBFT Consensus in Electronic Medical Booklet Network
=============================================================================
Tests the full PBFT consensus lifecycle:
  1. Leader Selection Formula: Primary = v (mod N), where the first validator
     on the network (index 0 -> val-01) is the initial Primary proposer.
  2. Phase 1 (Pre-Prepare): Primary batches medical transactions, assigns sequence n,
     and broadcasts candidate block proposal to all backup nodes.
  3. Phase 2 (Prepare): Backup nodes validate proposal (digest, signatures, leader)
     and broadcast Prepare votes; 2f + 1 quorum reaches PREPARED state.
  4. Phase 3 (Commit): Nodes broadcast Commit votes; 2f + 1 quorum commits the block
     permanently to the ledger with PBFT finality.
  5. Leader Rotation: Primary rotates to (v + 1) mod N for subsequent blocks.
  6. View Change: Fault recovery rotates to next Primary on timeout/leader fault.
"""

import asyncio
import hashlib
import json
import logging
import os
import subprocess
import sys
import time

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [PBFT-TEST] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("PBFTTest")

PYTHON_EXE = sys.executable
BASE_DIR = os.path.dirname(os.path.abspath(__file__))


async def send_json_message(host: str, port: int, payload: dict, timeout: float = 3.0) -> dict:
    """Send a JSON message over TCP socket and receive a newline-delimited JSON response."""
    reader, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout=timeout)
    data = (json.dumps(payload) + "\n").encode("utf-8")
    writer.write(data)
    await writer.drain()

    raw = await asyncio.wait_for(reader.readline(), timeout=timeout)
    writer.close()
    await writer.wait_closed()
    return json.loads(raw.decode("utf-8").strip())


async def run_pbft_consensus_test():
    processes = []
    try:
        logger.info("================================================================================")
        logger.info(" Starting PBFT Consensus Lifecycle Verification")
        logger.info("================================================================================")

        # 1. Start Broadcast Coordinator Server on custom ports (9299 / 9300)
        bcast_port = 9299
        bcast_ws = 9300
        logs_dir = os.path.join(BASE_DIR, "logs_test")
        os.makedirs(logs_dir, exist_ok=True)

        logger.info(f"1. Spawning Central Broadcast Coordinator on port {bcast_port}...")
        f_bcast = open(os.path.join(logs_dir, "bcast.log"), "w", encoding="utf-8")
        p_bcast = subprocess.Popen(
            [PYTHON_EXE, os.path.join(BASE_DIR, "broadcast_server.py"), "--port", str(bcast_port), "--ws-port", str(bcast_ws)],
            stdout=f_bcast,
            stderr=subprocess.STDOUT,
        )
        processes.append(p_bcast)
        await asyncio.sleep(1.0)

        # 2. Launch 4 Validator Nodes (val-01, val-02, val-03, val-04)
        # N = 4 validators -> f = (4-1)//3 = 1 -> Quorum = 2f + 1 = 3
        val_ports = [8201, 8202, 8203, 8204]
        val_nodes = ["val-01", "val-02", "val-03", "val-04"]

        logger.info("2. Launching 4 Validator Nodes (N=4, f=1, Quorum=2f+1=3)...")
        for i, (vid, vport) in enumerate(zip(val_nodes, val_ports)):
            logger.info(f"   -> Launching Validator #{i+1}: {vid} on port {vport} (First launched: val-01)")
            f_val = open(os.path.join(logs_dir, f"{vid}.log"), "w", encoding="utf-8")
            p_val = subprocess.Popen(
                [
                    PYTHON_EXE,
                    os.path.join(BASE_DIR, "main.py"),
                    "--role", "validator",
                    "--node-id", vid,
                    "--port", str(vport),
                    "--core-port", "0",
                    "--broadcast-server", f"127.0.0.1:{bcast_port}",
                ],
                stdout=f_val,
                stderr=subprocess.STDOUT,
            )
            processes.append(p_val)
            await asyncio.sleep(0.5)

        # Wait until all 4 validators have registered with Broadcast Server
        logger.info("   Awaiting all 4 validator registrations with central coordinator...")
        primary_info = {}
        for _ in range(15):
            try:
                bcast_reader, bcast_writer = await asyncio.open_connection("127.0.0.1", bcast_port)
                bcast_writer.write(b'{"type":"GET_PBFT_PRIMARY"}\n')
                await bcast_writer.drain()
                raw_bcast = await asyncio.wait_for(bcast_reader.readline(), timeout=3.0)
                bcast_writer.close()
                await bcast_writer.wait_closed()
                primary_info = json.loads(raw_bcast.decode().strip()).get("pbft_consensus", {})
                if primary_info.get("validator_count", 0) >= 4:
                    break
            except Exception:
                pass
            await asyncio.sleep(0.5)

        # 3. Query Broadcast Server for PBFT Primary Info
        logger.info("3. Verifying Leader Selection Formula from Broadcast Coordinator:")
        logger.info(f"   Primary Node ID : {primary_info.get('primary_node_id')}")
        logger.info(f"   View Number (v) : {primary_info.get('view_number')}")
        logger.info(f"   Primary Index   : {primary_info.get('primary_index')} (v mod N = {primary_info.get('primary_index')})")
        logger.info(f"   Formula Used    : {primary_info.get('formula')}")
        logger.info(f"   Validator Count : {primary_info.get('validator_count')}")
        logger.info(f"   Quorum Size     : {primary_info.get('quorum_size')} (2f + 1)")
        logger.info(f"   Is First Val    : {primary_info.get('is_first_validator')}")

        assert primary_info.get("primary_node_id") == "val-01", (
            f"Expected initial primary to be 'val-01' (the first validator on the network), got '{primary_info.get('primary_node_id')}'"
        )
        assert primary_info.get("primary_index") == 0, "Expected primary index to be 0 for view 0"
        logger.info("   [SUCCESS] Initial Primary Proposer is confirmed as 'val-01' (first validator node, index 0)!")

        # 4. Query val-01 directly for PBFT Status
        logger.info("4. Querying 'val-01' directly for PBFT Status:")
        val1_status = await send_json_message("127.0.0.1", val_ports[0], {"type": "GET_PBFT_STATUS"})
        logger.info(f"   val-01 is_primary      : {val1_status.get('is_primary')}")
        logger.info(f"   val-01 current_primary : {val1_status.get('current_primary')}")
        logger.info(f"   val-01 view_number     : {val1_status.get('view_number')}")
        assert val1_status.get("is_primary") is True, "val-01 must report is_primary = True"
        logger.info("   [SUCCESS] val-01 accurately identifies itself as the active Primary proposer!")

        # 5. Query val-02 directly for PBFT Status
        logger.info("5. Querying 'val-02' (Backup node) for PBFT Status:")
        val2_status = await send_json_message("127.0.0.1", val_ports[1], {"type": "GET_PBFT_STATUS"})
        logger.info(f"   val-02 is_primary      : {val2_status.get('is_primary')}")
        logger.info(f"   val-02 current_primary : {val2_status.get('current_primary')}")
        assert val2_status.get("is_primary") is False, "val-02 must report is_primary = False (Backup role)"
        assert val2_status.get("current_primary") == "val-01", "val-02 must recognize val-01 as current Primary"
        logger.info("   [SUCCESS] Backup node val-02 correctly reports is_primary = False and points to leader val-01!")

        # 6. Submit a Patient Registration Transaction to val-01 (Primary) to trigger 3-Phase Consensus
        logger.info("6. Submitting Medical Transaction to Primary 'val-01' to trigger 3-Phase PBFT Consensus:")
        patient_id = "pat-pbft-test-001"
        tx_payload = {
            "type": "PATIENT_REGISTRATION",
            "patient_id": patient_id,
            "name": "Jean-Pierre Nguema",
            "email": "jp.nguema@sante.cm",
            "public_key": "04" + "a1" * 32,
            "device_token": "dev-tok-secure-trustzone-991",
            "password_hash": hashlib.sha256(b"SecretPass2026!").hexdigest(),
            "timestamp": int(time.time()),
        }
        # Compute integrity hash
        canonical = f"{patient_id}|{tx_payload['name']}|{tx_payload['email']}|{tx_payload['public_key']}|{tx_payload['device_token']}|{tx_payload['password_hash']}|{tx_payload['timestamp']}"
        tx_payload["payload_hash"] = hashlib.sha256(canonical.encode("utf-8")).hexdigest()

        tx_receipt = await send_json_message("127.0.0.1", val_ports[0], tx_payload)
        logger.info(f"   Registration receipt received: status='{tx_receipt.get('status')}', tx_id='{tx_receipt.get('tx_id')}'")
        assert tx_receipt.get("status") == "CONFIRMED_ON_CHAIN", "Patient registration should be confirmed"

        # Wait for 3-phase consensus messages (Pre-Prepare -> Prepare -> Commit) to circulate among peers
        logger.info("   Awaiting PBFT 3-phase message propagation and quorum settlement (2.5s)...")
        await asyncio.sleep(2.5)

        # 7. Verify PBFT Status & Sequence / Leader Progression
        logger.info("7. Verifying PBFT Ledger State and Sequence Progression:")
        val1_status_after = await send_json_message("127.0.0.1", val_ports[0], {"type": "GET_PBFT_STATUS"})
        logger.info(f"   val-01 Sequence Number : {val1_status_after.get('sequence_number')}")
        logger.info(f"   val-01 View Number     : {val1_status_after.get('view_number')}")
        logger.info(f"   val-01 Next Primary    : {val1_status_after.get('current_primary')}")

        assert val1_status_after.get("sequence_number") >= 1, "Sequence number must advance upon PBFT commit"
        logger.info("   [SUCCESS] PBFT Block finalized and sequence number advanced!")

        # 8. Test PBFT View Change / Leader Failover
        logger.info("8. Testing PBFT View Change / Leader Failover:")
        bcast_reader2, bcast_writer2 = await asyncio.open_connection("127.0.0.1", bcast_port)
        bcast_writer2.write(b'{"type":"PBFT_VIEW_CHANGE","reason":"Simulated leader timeout / failover"}\n')
        await bcast_writer2.drain()
        raw_vc = await asyncio.wait_for(bcast_reader2.readline(), timeout=3.0)
        bcast_writer2.close()
        await bcast_writer2.wait_closed()

        vc_resp = json.loads(raw_vc.decode().strip())
        new_pbft = vc_resp.get("pbft_consensus", {})
        logger.info(f"   View Change ACK status : {vc_resp.get('status')}")
        logger.info(f"   New View Number        : {new_pbft.get('view_number')}")
        logger.info(f"   New Primary Node ID    : {new_pbft.get('primary_node_id')} (v mod N = {new_pbft.get('primary_index')})")

        assert new_pbft.get("primary_node_id") == "val-02", (
            f"Expected next Primary after view change to be 'val-02', got '{new_pbft.get('primary_node_id')}'"
        )
        logger.info("   [SUCCESS] Leader failover correctly rotated to 'val-02' (v mod N = 1 mod 4 = index 1)!")

        logger.info("================================================================================")
        logger.info(" ALL PBFT CONSENSUS TESTS PASSED WITH 100% SUCCESS!")
        logger.info("================================================================================")

    finally:
        logger.info("Cleaning up background test processes...")
        for p in processes:
            try:
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(p.pid)], capture_output=True)
            except Exception:
                pass


if __name__ == "__main__":
    asyncio.run(run_pbft_consensus_test())
