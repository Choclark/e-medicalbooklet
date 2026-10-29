#!/usr/bin/env python3
"""
Test Suite: Core Data Writing & Reading with AES-GCM, Patient PK, Proxy Re-Encryption & KSM Threshold
===================================================================================================
Validates the complete cryptographic lifecycle:
1. Core Data Writing:
   - Doctor is the transaction signer (verified in consensus).
   - Fast symmetric encryption of clinical record using AES-256-GCM.
   - Symmetric key (DEK) protected with KSM 3-of-4 threshold shares and Patient's public key.
   - Plaintext headers for consensus validation (patientId, doctorId, hospitalId, bodyDataHash).
   - Block committed with Merkle root calculation and SQLite persistence.
2. Core Data Reading:
   - Doctor queries record with patient authorization.
   - Merkle inclusion proof verified against block header.
   - Proxy Re-Encryption workflow: 3-of-4 KSM hospital quorum threshold decryption.
   - Decryption executed inside Doctor's TrustZone (TEE).
   - Query logged to query_audit.log (read-only audit log, not anchored in blockchain block).
"""

import asyncio
import json
import os
import shutil
import socket
import subprocess
import sys
import time

CORE_EXE = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "blockchain-core", "build", "Debug", "blockchain_core.exe")
)
TEST_CORE_PORT = 48055
TEST_NODE_PORT = 8045
TEST_NODE_ID = "val-yaounde-readwrite-test"
TEST_DATA_DIR = os.path.join("chaindata", TEST_NODE_ID)


def cleanup_test_dir():
    if os.path.exists(TEST_DATA_DIR):
        try:
            shutil.rmtree(TEST_DATA_DIR)
        except Exception:
            pass


def wait_for_port(port: int, host: str = "127.0.0.1", timeout: float = 8.0) -> bool:
    start = time.time()
    candidates = [host, "127.0.0.1"]
    try:
        candidates.append(socket.gethostbyname(socket.gethostname()))
    except Exception:
        pass

    while time.time() - start < timeout:
        for h in candidates:
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(0.5)
                    if s.connect_ex((h, port)) == 0:
                        return True
            except Exception:
                pass
        time.sleep(0.3)
    return False


async def main():
    print("=" * 78)
    print(" [TEST] STARTING CORE DATA READ & WRITE PROTOCOL TEST")
    print("=" * 78)

    cleanup_test_dir()

    # 1. Start C++ Blockchain Core IPC Server
    print(f"[+] Starting C++ Blockchain Core on port {TEST_CORE_PORT}...")
    core_proc = subprocess.Popen(
        [
            CORE_EXE,
            "--port", str(TEST_CORE_PORT),
            "--node-id", TEST_NODE_ID,
            "--data-dir", TEST_DATA_DIR,
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if not wait_for_port(TEST_CORE_PORT):
        print(f"[!] Blockchain Core did not open port {TEST_CORE_PORT} in time")
        core_proc.terminate()
        sys.exit(1)
    print(f"[+] C++ Blockchain Core is online on port {TEST_CORE_PORT}")

    # 2. Start DistributedNode in background
    from main import DistributedNode
    node = DistributedNode(
        node_id=TEST_NODE_ID,
        node_type="VALIDATOR",
        host="127.0.0.1",
        port=TEST_NODE_PORT,
        broadcast_server=None,
        core_host="127.0.0.1",
        core_port=TEST_CORE_PORT,
    )

    node_task = asyncio.create_task(node.start())
    await asyncio.sleep(2.0)

    try:
        # Connect TCP client to the Validator Node
        print(f"[+] Connecting test client to Validator Node at 127.0.0.1:{node.port}...")
        reader, writer = await asyncio.open_connection("127.0.0.1", node.port)

        # =====================================================================
        # PART 1: CORE DATA WRITING
        # =====================================================================
        print("\n" + "-" * 78)
        print(" [TEST PART 1] DISPATCHING CORE DATA WRITE (AES-GCM + PATIENT PK + DOCTOR SIGN)")
        print("-" * 78)

        write_payload = {
            "type": "RECORD_WRITE",
            "doctor_id": "doc-martin-kamga",
            "doctor_name": "Dr. Martin Kamga",
            "patient_id": "patient-kamga-01",
            "hospital_id": "hosp-yaounde-central",
            "hospital_name": "Hôpital Central de Yaoundé",
            "diagnosis": "Cardiopathie Ischémique & Hypertension Artérielle Sévère",
            "treatment": "Protocole Anti-ischémique et Trithérapie Antihypertensive",
            "medication": "Amlodipine 10mg, Périndopril 8mg, Indapamide 2.5mg, Kardégic 75mg",
            "notes": "Patient reçu en consultation cardiologique à Yaoundé. ECG montre une onde T négative en V4-V6.",
            "blood_pressure": "158/96 mmHg",
        }

        writer.write((json.dumps(write_payload) + "\n").encode("utf-8"))
        await writer.drain()

        resp_line = await asyncio.wait_for(reader.readline(), timeout=8.0)
        write_receipt = json.loads(resp_line.decode("utf-8").strip())

        print(f"[RECEIPT] Record Write Status: {write_receipt.get('status')}")
        print(f"          Data ID:             {write_receipt.get('data_id')}")
        print(f"          Tx ID:               {write_receipt.get('tx_id')}")
        print(f"          Block Height:        #{write_receipt.get('block_height')}")
        print(f"          Ciphertext Bytes:    {write_receipt.get('ciphertext_bytes')}")
        print(f"          Body Data Hash:      {write_receipt.get('body_data_hash')}")
        print(f"          Consensus Verified:  {write_receipt.get('consensus_verified')}")

        assert write_receipt["status"] == "OK", "Write failed"
        assert write_receipt["data_id"].startswith("REC-"), "Invalid record data ID"
        assert write_receipt["block_height"] >= 1, "Block was not committed on chain"
        assert write_receipt["ciphertext_bytes"] > 0, "Ciphertext should be non-empty"
        assert write_receipt["consensus_verified"] is True, "Doctor consensus verification failed"
        assert write_receipt["patient_id"] == "patient-kamga-01", "Patient ID mismatch"
        assert write_receipt["doctor_id"] == "doc-martin-kamga", "Doctor ID mismatch"

        written_data_id = write_receipt["data_id"]
        print("\n [OK] PART 1 PASSED: Core clinical record encrypted with AES-256-GCM, doctor signed, and committed into Block!")

        # =====================================================================
        # PART 2: CORE DATA READING (Proxy Re-Encryption + KSM Threshold + TrustZone)
        # =====================================================================
        print("\n" + "-" * 78)
        print(" [TEST PART 2] DISPATCHING CORE DATA READ (PRE + 3-of-4 KSM + TRUSTZONE)")
        print("-" * 78)

        read_payload = {
            "type": "RECORD_READ",
            "data_id": written_data_id,
            "doctor_id": "doc-martin-kamga",
            "patient_id": "patient-kamga-01",
            "purpose": "CONSULTATION_DE_SUIVI_CARDIOLOGIQUE",
        }

        writer.write((json.dumps(read_payload) + "\n").encode("utf-8"))
        await writer.drain()

        read_resp_line = await asyncio.wait_for(reader.readline(), timeout=8.0)
        read_resp = json.loads(read_resp_line.decode("utf-8").strip())

        print(f"[RESPONSE] Record Read Status: {read_resp.get('status')}")
        print(f"           Data ID:            {read_resp.get('data_id')}")
        print(f"           Merkle Verified:    {read_resp.get('merkle_verified')}")
        print(f"           Proxy Re-Encrypt:   {read_resp.get('proxy_re_encryption')}")
        print(f"           TrustZone Decrypt:  {read_resp.get('trustzone_decrypted')}")
        print(f"           KSM Quorum Nodes:   {read_resp.get('ksm_quorum')}")

        rec = read_resp.get("clinical_record", {})
        print(f"           Decrypted Diagnosis:      {rec.get('diagnosis')}")
        print(f"           Decrypted Treatment:      {rec.get('treatment')}")
        print(f"           Decrypted Medication:     {rec.get('medication')}")
        print(f"           Decrypted Blood Pressure: {rec.get('blood_pressure')}")

        assert read_resp["status"] == "OK", "Read failed"
        assert read_resp["data_id"] == written_data_id, "Returned wrong data_id"
        assert read_resp["merkle_verified"] is True, "Merkle proof verification failed"
        assert read_resp["proxy_re_encryption"] is True, "Proxy Re-Encryption flag missing"
        assert read_resp["trustzone_decrypted"] is True, "TrustZone decryption failed"
        assert len(read_resp["ksm_quorum"]) >= 3, "KSM quorum did not reach threshold (3-of-4)"
        assert rec["diagnosis"] == write_payload["diagnosis"], "Decrypted diagnosis does not match original"
        assert rec["treatment"] == write_payload["treatment"], "Decrypted treatment does not match original"
        assert rec["medication"] == write_payload["medication"], "Decrypted medication does not match original"
        assert rec["blood_pressure"] == write_payload["blood_pressure"], "Decrypted BP does not match original"

        # Verify audit log exists off-chain
        audit_log_path = os.path.join(TEST_DATA_DIR, "audit_logs", "query_audit.log")
        assert os.path.exists(audit_log_path), f"Audit log file not created at {audit_log_path}"
        with open(audit_log_path, "r", encoding="utf-8") as f:
            audit_content = f.read()
            print(f"\n[AUDIT LOG ENTRY]:\n{audit_content.strip()}")
            assert "AUDIT_QUERY_REQUEST" in audit_content
            assert written_data_id in audit_content
            assert "READ_LOG_ONLY" in audit_content

        print("\n [OK] PART 2 PASSED: Proxy Re-Encryption with 3-of-4 KSM threshold + TrustZone decryption verified!")

        writer.close()
        await writer.wait_closed()

    finally:
        # Cleanup
        print("\n[*] Shutting down test instances...")
        await node.stop()
        node_task.cancel()
        core_proc.terminate()
        core_proc.kill()
        cleanup_test_dir()

    print("\n" + "=" * 78)
    print(" [TEST PASSED] ALL CORE DATA READ & WRITE PROTOCOL TESTS SUCCEEDED [OK]")
    print("=" * 78)


if __name__ == "__main__":
    asyncio.run(main())
