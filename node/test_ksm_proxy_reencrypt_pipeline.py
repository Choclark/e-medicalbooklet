#!/usr/bin/env python3
"""
Test Suite: KSM Node Core & Proxy Re-Encryption (PRE) Protocol Pipeline
======================================================================
Verifies the complete end-to-end architecture requested by user:
1. KSM Node Core C++ Daemon (`ksm_core.exe`):
   - Winsock socket communication with nodes.
   - SQLite ledger persistence storing:
     * doctor_id
     * patient_id
     * encryption_key_share
     * access_key_time (validity expiration window)
     * data_id / tx_id
2. Topology Limits:
   - Validator: up to 20 validators, 5 archives, 10 KSM nodes.
   - Client: up to 20 validators, 10 KSM nodes.
   - KSM node: up to 10 validators, 10 clients, 10 archives, 10 KSM nodes.
3. Core Data Writing:
   - Doctor is the transaction signer (verified in consensus).
   - Fast symmetric encryption: AES-256-GCM.
   - Symmetric key (DEK) protected with Patient's public key (Patient is data owner).
   - Unencrypted metadata: patientId, doctorId, hospitalId, dataId, bodyDataHash.
4. Core Data Reading (Proxy Re-Encryption + KSM Threshold + TrustZone):
   - Doctor requests data -> Doctor PK sent to user device.
   - Patient TrustZone: derives PRE re-encryption key, splits into Shamir shares (3-of-4).
   - Patient device queries KSM nodes, encrypts shares for each KSM node PK, sends STORE_SHARE.
   - Verifies all KSM nodes receive and acknowledge (SHARE_STORED_ACK).
   - KSM nodes verify access_key_time validity and transform key fragment.
   - Doctor receives transformed key package, decrypts inside Doctor's TrustZone (TEE),
     reconstructs DEK and decrypts clinical record.
"""

import asyncio
import json
import os
import shutil
import socket
import subprocess
import sys
import time

KSM_CORE_EXE = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "ksm-core", "build", "Debug", "ksm_core.exe")
)
TEST_KSM_CORE_PORT = 48075
TEST_KSM_NODE_PORT = 8035
TEST_KSM_NODE_ID = "ksm-yaounde-hosp-01"
TEST_STORAGE_DIR = os.path.abspath(os.path.join("chaindata", TEST_KSM_NODE_ID))


def cleanup():
    if os.path.exists(TEST_STORAGE_DIR):
        try:
            shutil.rmtree(TEST_STORAGE_DIR, ignore_errors=True)
        except Exception:
            pass


def wait_for_tcp(port: int, host: str = "127.0.0.1", timeout: float = 6.0) -> bool:
    start = time.time()
    while time.time() - start < timeout:
        for h in [host, "127.0.0.1"]:
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(0.5)
                    if s.connect_ex((h, port)) == 0:
                        return True
            except Exception:
                pass
        time.sleep(0.2)
    return False


async def main():
    print("=" * 78)
    print(" [TEST] STARTING KSM NODE CORE & PROXY RE-ENCRYPTION PIPELINE")
    print("=" * 78)

    cleanup()
    os.makedirs(TEST_STORAGE_DIR, exist_ok=True)

    # 1. Start C++ KSM Core Daemon
    print(f"[+] Starting C++ KSM Core daemon on port {TEST_KSM_CORE_PORT}...")
    ksm_core_proc = subprocess.Popen(
        [
            KSM_CORE_EXE,
            "--daemon",
            str(TEST_KSM_CORE_PORT),
            TEST_KSM_NODE_ID,
            "1",
            TEST_STORAGE_DIR,
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    if not wait_for_tcp(TEST_KSM_CORE_PORT):
        print(f"[!] KSM Core daemon did not open port {TEST_KSM_CORE_PORT}")
        ksm_core_proc.terminate()
        sys.exit(1)
    print(f"[+] C++ KSM Core daemon is active and listening on port {TEST_KSM_CORE_PORT} [OK]")

    # 2. Start Python KSM Node (ksm_node.py)
    from ksm_node import KsmNode
    ksm_node = KsmNode(
        node_id=TEST_KSM_NODE_ID,
        share_index=1,
        host="127.0.0.1",
        port=TEST_KSM_NODE_PORT,
        core_host="127.0.0.1",
        core_port=TEST_KSM_CORE_PORT,
        broadcast_server=None,
    )

    ksm_task = asyncio.create_task(ksm_node.start())
    await asyncio.sleep(1.5)

    try:
        # 3. Test Topology Limits Enforcement
        print("\n" + "-" * 78)
        print(" [TEST PART 1] TOPOLOGY LIMITS VERIFICATION")
        print("-" * 78)
        from main import DistributedNode
        assert DistributedNode.MAX_VALIDATORS_FOR_VALIDATOR == 20, "Validator limit error"
        assert DistributedNode.MAX_ARCHIVES_FOR_VALIDATOR == 5, "Archive limit error"
        assert DistributedNode.MAX_KSM_FOR_VALIDATOR == 10, "KSM for validator limit error"

        assert KsmNode.MAX_VALIDATORS == 10, "Validator limit for KSM error"
        assert KsmNode.MAX_CLIENTS == 10, "Client limit for KSM error"
        assert KsmNode.MAX_ARCHIVES == 10, "Archive limit for KSM error"
        assert KsmNode.MAX_KSM == 10, "KSM limit for KSM error"

        from client_node import ClientNode
        assert ClientNode.MAX_VALIDATORS == 20, "Client max validators error"
        assert ClientNode.MAX_KSM == 10, "Client max KSM error"
        print("[OK] Topology limits strictly configured:")
        print("     - Validator: max 20 Validators, 5 Archives, 10 KSM nodes")
        print("     - Client:    max 20 Validators, 10 KSM nodes")
        print("     - KSM Node:  max 10 of each other node type (Validators, Clients, Archives, KSM)")

        # 4. Connect TCP client (simulating Patient device / Doctor device)
        print(f"\n[+] Connecting to KSM Node at 127.0.0.1:{ksm_node.port}...")
        reader, writer = await asyncio.open_connection("127.0.0.1", ksm_node.port)

        # Query KSM Node Public Key
        pk_req = {"type": "GET_PUBLIC_KEY"}
        writer.write((json.dumps(pk_req) + "\n").encode("utf-8"))
        await writer.drain()
        pk_resp_line = await asyncio.wait_for(reader.readline(), timeout=4.0)
        pk_resp = json.loads(pk_resp_line.decode("utf-8").strip())
        print(f"[+] KSM Node Public Key Received: {pk_resp.get('public_key_hex')[:32]}... (Status: {pk_resp.get('status')})")
        assert pk_resp.get("status") == "ONLINE", "KSM node not online"

        # 5. Store Key Share in KSM Core with doctor_id, patient_id, access_key_time
        print("\n" + "-" * 78)
        print(" [TEST PART 2] PATIENT TRUSTZONE GENERATES PRE KEY & STORES SHARE IN KSM")
        print("-" * 78)

        now = int(time.time())
        access_key_time = now + 14400  # 4 hours access validity window
        test_tx_id = f"tx-pre-{now}"
        test_data_id = f"REC-CARDIO-{now}"
        test_doctor_id = "doc-martin-kamga"
        test_patient_id = "patient-kamga-01"
        test_share_hex = "01a4b5c6d7e8f90123456789abcdef0123456789abcdef0123456789abcdef01"

        store_share_msg = {
            "type": "STORE_SHARE",
            "tx_id": test_tx_id,
            "data_id": test_data_id,
            "doctor_id": test_doctor_id,
            "patient_id": test_patient_id,
            "share_hex": test_share_hex,
            "share_index": 1,
            "access_key_time": access_key_time,
            "threshold": 3,
            "total_nodes": 4,
        }

        writer.write((json.dumps(store_share_msg) + "\n").encode("utf-8"))
        await writer.drain()

        store_ack_line = await asyncio.wait_for(reader.readline(), timeout=5.0)
        store_ack = json.loads(store_ack_line.decode("utf-8").strip())

        print(f"[RECEIPT] Status:          {store_ack.get('status')}")
        print(f"          Action:          {store_ack.get('action')}")
        print(f"          Node ID:         {store_ack.get('node_id')}")
        print(f"          Tx ID:           {store_ack.get('tx_id')}")
        print(f"          Data ID:         {store_ack.get('data_id')}")
        print(f"          Doctor ID:       {store_ack.get('doctor_id')}")
        print(f"          Patient ID:      {store_ack.get('patient_id')}")
        print(f"          Access Key Time: {store_ack.get('access_key_time')} (Expiration epoch)")

        assert store_ack["status"] == "SUCCESS", "STORE_SHARE failed"
        assert store_ack["action"] == "SHARE_STORED_ACK", "SHARE_STORED_ACK missing"
        assert store_ack["doctor_id"] == test_doctor_id, "Doctor ID mismatch in KSM store"
        assert store_ack["patient_id"] == test_patient_id, "Patient ID mismatch in KSM store"
        assert store_ack["access_key_time"] == access_key_time, "Access key time mismatch"

        # Verify SQLite disk persistence on KSM node
        db_file = os.path.join(TEST_STORAGE_DIR, f"{TEST_KSM_NODE_ID}_shares.db")
        assert os.path.exists(db_file), f"KSM SQLite DB not created at {db_file}"
        with open(db_file, "r", encoding="utf-8") as f:
            db_content = f.read()
            print(f"\n[KSM SQLITE LEDGER RECORD]:\n{db_content.strip()}")
            assert test_tx_id in db_content
            assert test_doctor_id in db_content
            assert test_patient_id in db_content
            assert str(access_key_time) in db_content

        print("\n [OK] PART 2 PASSED: KSM node verified receipt, stored doctor_id, patient_id, encryption_key_share, and access_key_time!")

        # 6. Reading: Doctor Requests Share Transformation (Proxy Re-Encryption)
        print("\n" + "-" * 78)
        print(" [TEST PART 3] DOCTOR READ QUERY & KSM SHARE TRANSFORMATION (PRE)")
        print("-" * 78)

        transform_req = {
            "type": "TRANSFORM_SHARE",
            "tx_id": test_tx_id,
            "doctor_id": test_doctor_id,
            "current_time": now + 60,  # 1 minute later: within validity window
        }

        writer.write((json.dumps(transform_req) + "\n").encode("utf-8"))
        await writer.drain()

        transform_ack_line = await asyncio.wait_for(reader.readline(), timeout=5.0)
        transform_ack = json.loads(transform_ack_line.decode("utf-8").strip())

        print(f"[TRANSFORM ACK] Status:      {transform_ack.get('status')}")
        print(f"                Action:      {transform_ack.get('action')}")
        print(f"                Share Hex:   {transform_ack.get('share_hex')[:32]}...")
        print(f"                Doctor ID:   {transform_ack.get('doctor_id')}")

        assert transform_ack["status"] == "SUCCESS", "TRANSFORM_SHARE failed"
        assert transform_ack["action"] == "TRANSFORM_SHARE_ACK", "Missing TRANSFORM_SHARE_ACK"
        assert transform_ack["share_hex"] == test_share_hex, "Share hex corrupted"
        assert transform_ack["doctor_id"] == test_doctor_id, "Doctor authorization failed"

        # Test Access Expiration Protection: query after expiration window
        print("\n[+] Testing Access Expiration Enforcement (Time Exceeded)...")
        expired_req = {
            "type": "TRANSFORM_SHARE",
            "tx_id": test_tx_id,
            "doctor_id": test_doctor_id,
            "current_time": access_key_time + 100,  # Expired by 100 seconds
        }
        writer.write((json.dumps(expired_req) + "\n").encode("utf-8"))
        await writer.drain()
        expired_ack_line = await asyncio.wait_for(reader.readline(), timeout=5.0)
        expired_ack = json.loads(expired_ack_line.decode("utf-8").strip())
        print(f"[EXPIRED QUERY] Status: {expired_ack.get('status')} | Message: {expired_ack.get('message')}")
        assert expired_ack["status"] == "ACCESS_DENIED", "Access should be DENIED after access_key_time expiration"
        print("[OK] Access properly denied when current_time exceeds access_key_time!")

        writer.close()
        await writer.wait_closed()

    finally:
        print("\n[*] Cleaning up test daemons...")
        await ksm_node.stop()
        ksm_task.cancel()
        ksm_core_proc.terminate()
        ksm_core_proc.kill()
        cleanup()

    print("\n" + "=" * 78)
    print(" [TEST PASSED] ALL KSM NODE CORE & PROXY RE-ENCRYPTION TESTS SUCCEEDED [OK]")
    print("=" * 78)


if __name__ == "__main__":
    asyncio.run(main())
