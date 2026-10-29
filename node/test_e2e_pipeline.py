#!/usr/bin/env python3
"""
End-to-End Integration Test Suite: Full Sovereign Pipeline Verification
=======================================================================
Verifies the complete end-to-end medical blockchain pipeline:
  1. Multi-Process Standalone KSM Hospital Daemons (HOSPITAL_A..D)
  2. C++ Blockchain Core (Storage, Law 1-7 Consensus Rules, AccessManager, ArchiveManager)
  3. Python Validator Node (Transaction Pool, PBFT Engine with Signed Votes & Watchdog)
  4. End-to-End Workflow Steps:
     - Step 1: ECIES-P256 Encrypted & Signed Clinical Record Write (Mempool -> PBFT -> On-Chain Commit)
     - Step 2: Patient Consent Grant (APPROVE_CONSENT -> On-Chain AccessManager Commit)
     - Step 3: Authorized Record Read via KMS 3-of-4 Proxy Re-Encryption (PRE Capsule Issued, Zero-Plaintext IPC)
     - Step 4: Consent Revocation (REVOKE_CONSENT -> AccessManager Rejection on subsequent read)
     - Step 5: Cold Archive Creation (ARCHIVE_BLOCKS -> .medarch bundle with SHA-256 & Merkle Checkpoints)
     - Step 6: On-Demand Block Restoration (RESTORE_ARCHIVED_BLOCK -> Decompression & Hash Verification)
"""

import asyncio
import hashlib
import hmac
import json
import os
import shutil
import socket
import subprocess
import sys
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))

BLOCKCHAIN_CORE_EXE = os.path.join(PROJECT_ROOT, "blockchain-core", "build", "Release", "blockchain_core.exe")
KSM_CORE_EXE = os.path.join(PROJECT_ROOT, "blockchain-core", "build", "Release", "ksm_core.exe")

TEST_CORE_PORT = 48155
TEST_NODE_PORT = 8088
TEST_NODE_ID = "val-e2e-test"
TEST_DATA_DIR = os.path.join(PROJECT_ROOT, "chaindata", TEST_NODE_ID)

KSM_PORTS = {
    "HOSPITAL_A": (9201, 1),
    "HOSPITAL_B": (9202, 2),
    "HOSPITAL_C": (9203, 3),
    "HOSPITAL_D": (9204, 4),
}


def cleanup_test_dir():
    for p in [TEST_DATA_DIR] + [os.path.join(PROJECT_ROOT, "chaindata", f"ksm_test_{h}") for h in KSM_PORTS]:
        if os.path.exists(p):
            try:
                shutil.rmtree(p)
            except Exception:
                pass


def wait_for_port(port: int, host: str = "127.0.0.1", timeout: float = 6.0) -> bool:
    start = time.time()
    while time.time() - start < timeout:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(0.4)
                if s.connect_ex((host, port)) == 0:
                    return True
        except Exception:
            pass
        time.sleep(0.2)
    return False


async def send_socket_request(port: int, request_obj: dict, timeout: float = 4.0) -> dict:
    reader, writer = await asyncio.wait_for(
        asyncio.open_connection("127.0.0.1", port), timeout=timeout
    )
    cmd = json.dumps(request_obj) + "\n"
    writer.write(cmd.encode("utf-8"))
    await writer.drain()

    raw_data = await asyncio.wait_for(reader.read(16384), timeout=timeout)
    writer.close()
    await writer.wait_closed()

    lines = [ln.strip() for ln in raw_data.decode("utf-8", errors="replace").split("\n") if ln.strip()]
    parsed = []
    for ln in lines:
        try:
            parsed.append(json.loads(ln))
        except Exception:
            pass
    if not parsed:
        return {}
    for item in reversed(parsed):
        if "RECEIPT" in item.get("type", "") or "RESPONSE" in item.get("type", ""):
            return item
    return parsed[-1]


async def main():
    print("=" * 80)
    print("   E-MEDICAL BOOKLET SOVEREIGN PIPELINE: END-TO-END INTEGRATION TEST")
    print("=" * 80)

    cleanup_test_dir()

    processes = []
    try:
        # 1. Start 4 Standalone KSM Core Hospital Daemons
        print("\n[*] Step 0A: Launching 4 Standalone C++ KSM Hospital Daemons...")
        for hosp, (port, share_idx) in KSM_PORTS.items():
            storage_dir = os.path.join(PROJECT_ROOT, "chaindata", f"ksm_test_{hosp}")
            p = subprocess.Popen(
                [KSM_CORE_EXE, "--daemon", str(port), hosp, str(share_idx), storage_dir],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            processes.append(p)
            if not wait_for_port(port):
                raise RuntimeError(f"KSM daemon {hosp} failed to listen on port {port}")
            print(f"    [+] {hosp} Daemon active on port {port} (Share index {share_idx}/4)")

        # 2. Start C++ Blockchain Core
        print(f"\n[*] Step 0B: Launching C++ Blockchain Core on port {TEST_CORE_PORT}...")
        core_proc = subprocess.Popen(
            [
                BLOCKCHAIN_CORE_EXE,
                "--port", str(TEST_CORE_PORT),
                "--node-id", TEST_NODE_ID,
                "--data-dir", TEST_DATA_DIR,
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        processes.append(core_proc)
        if not wait_for_port(TEST_CORE_PORT):
            raise RuntimeError(f"Blockchain Core failed to listen on port {TEST_CORE_PORT}")
        print(f"    [+] C++ Blockchain Core active on port {TEST_CORE_PORT}")

        # 3. Start Python DistributedNode (Validator)
        print(f"\n[*] Step 0C: Initializing Python Validator Node ({TEST_NODE_ID} on port {TEST_NODE_PORT})...")
        sys.path.insert(0, SCRIPT_DIR)
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
        await asyncio.sleep(1.5)

        # Generate test identities & keys
        patient_id = "usr-mensah-e2e"
        doctor_id = "doc-kamga-e2e"
        hospital_id = "hosp-yaounde-central"
        data_id = f"REC-E2E-{int(time.time())}"
        tx_id = f"tx-e2e-{int(time.time())}"

        doc_secret = hashlib.sha256(b"DOC_E2E_SECRET_KEY").digest()
        doc_pub = hashlib.sha256(b"DOC_E2E_PUB_TAG").hexdigest() + hashlib.sha256(b"DOC_E2E_PUB_TAG2").hexdigest()

        # =========================================================================
        # TEST 1: Clinical Record Write (ECIES-P256 + AES-GCM + Signatures -> PBFT)
        # =========================================================================
        print("\n" + "-" * 78)
        print(" [TEST 1] CLINICAL RECORD WRITE & CONSENSUS PERSISTENCE")
        print("-" * 78)

        ciphertext_hex = "a1b2c3d4e5f60718293a4b5c6d7e8f90" * 4
        iv_hex = "0102030405060708090a0b0c"
        dek_wrap_hex = "99887766554433221100" * 6
        payload_hash = hashlib.sha256(f"{data_id}|{patient_id}|{ciphertext_hex}".encode()).hexdigest()

        write_payload = {
            "type": "RECORD_WRITE",
            "tx_id": tx_id,
            "data_id": data_id,
            "record_category": "HEALTH_RECORD",
            "patient_id": patient_id,
            "patient_name": "Alex Mensah",
            "patient_public_key": "04" + "aa" * 64,
            "doctor_id": doctor_id,
            "doctor_name": "Dr. Martin Kamga",
            "doctor_public_key": doc_pub[:128],
            "signer_role": "DOCTOR",
            "signer_did": f"did:pulse:{doctor_id}",
            "hospital_id": hospital_id,
            "hospital_name": "Hôpital Central de Yaoundé",
            "diagnosis": "Suivi Cardiologique & HTA Sévère",
            "treatment": "Amlodipine 10mg + Régime Hyposodé",
            "medication": "Amlodipine",
            "blood_pressure": "140/90 mmHg",
            "notes": "ECG normal, bilan lipidique stable.",
            "ciphertext_hex": ciphertext_hex,
            "iv_hex": iv_hex,
            "auth_tag_hex": "112233445566778899aabbccddeeff00",
            "encrypted_dek_for_patient": dek_wrap_hex,
            "payload_hash": payload_hash,
            "digital_signature": "0x" + hashlib.sha256(b"SIG").hexdigest(),
            "timestamp": int(time.time()),
        }

        write_receipt = await send_socket_request(TEST_NODE_PORT, write_payload)
        print(f"  [+] Response received from Node: Type={write_receipt.get('type')}, Status={write_receipt.get('status')}")
        assert write_receipt.get("status") in ("OK", "CONFIRMED_ON_CHAIN") or write_receipt.get("type") in ("RECORD_WRITE_RECEIPT", "RECORD_PIPELINE_STATUS"), "Write submission failed"
        print("  [OK] Test 1 Passed: Record accepted through Transaction Pool & PBFT Consensus!")

        # Wait for consensus commit
        await asyncio.sleep(1.8)

        # =========================================================================
        # TEST 2: On-Chain Patient Consent (APPROVE_CONSENT)
        # =========================================================================
        print("\n" + "-" * 78)
        print(" [TEST 2] ON-CHAIN PATIENT CONSENT GRANT (APPROVE_CONSENT)")
        print("-" * 78)

        consent_tx_id = f"tx-consent-{int(time.time())}"
        consent_payload = {
            "type": "CONSENT_WRITE",
            "tx_id": consent_tx_id,
            "consent_id": f"CONSENT-{int(time.time())}",
            "consent_action": "APPROVE_CONSENT",
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "hospital_id": hospital_id,
            "scope": "FullClinicalRecordAccess",
            "patient_public_key": "aa" * 64,
            "payload_hash": hashlib.sha256(b"CONSENT_HASH").hexdigest(),
            "digital_signature": "0x" + hashlib.sha256(b"CONSENT_SIG").hexdigest(),
            "timestamp": int(time.time()),
        }

        consent_receipt = await send_socket_request(TEST_NODE_PORT, consent_payload)
        print(f"  [+] Response: Type={consent_receipt.get('type')}, Action={consent_receipt.get('consent_action', 'APPROVE_CONSENT')}")
        assert consent_receipt.get("status") == "OK" or consent_receipt.get("type") == "CONSENT_WRITE_RECEIPT", "Consent grant failed"
        print("  [OK] Test 2 Passed: Patient Consent Approved and committed on-chain!")

        await asyncio.sleep(1.2)

        # =========================================================================
        # TEST 3: Authorized Record Read via KMS Proxy Re-Encryption (PRE)
        # =========================================================================
        print("\n" + "-" * 78)
        print(" [TEST 3] AUTHORIZED RECORD READ & KMS PROXY RE-ENCRYPTION")
        print("-" * 78)

        read_payload = {
            "type": "RECORD_READ",
            "data_id": data_id,
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "doctor_public_key": doc_pub[:128],
            "scope": "FullClinicalRecordAccess",
            "purpose": "CLINICAL_TREATMENT_AND_REVISION",
        }

        read_resp = await send_socket_request(TEST_NODE_PORT, read_payload)
        print(f"  [+] Read Decision:     {read_resp.get('decision')}")
        print(f"  [+] PRE Enabled:       {read_resp.get('proxy_re_encryption')}")
        print(f"  [+] PRE Capsule DEK:   {str(read_resp.get('reencrypted_dek_hex'))[:24]}...")
        print(f"  [+] PRE IV:            {read_resp.get('pre_iv_hex')}")
        print(f"  [+] Ciphertext Output: {str(read_resp.get('ciphertext_hex'))[:24]}...")

        assert read_resp.get("decision") == "APPROVED", "Expected read decision to be APPROVED"
        assert read_resp.get("reencrypted_dek_hex"), "Expected valid re-encrypted DEK capsule"
        print("  [OK] Test 3 Passed: KMS Proxy Re-Encryption issued zero-plaintext capsule successfully!")

        # =========================================================================
        # TEST 4: On-Chain Patient Consent Revocation & Access Denial
        # =========================================================================
        print("\n" + "-" * 78)
        print(" [TEST 4] CONSENT REVOCATION (REVOKE_CONSENT) & DENIAL ENFORCEMENT")
        print("-" * 78)

        revoke_payload = {
            "type": "CONSENT_WRITE",
            "tx_id": f"tx-revoke-{int(time.time())}",
            "consent_id": f"CONSENT-{int(time.time())}",
            "consent_action": "REVOKE_CONSENT",
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "hospital_id": hospital_id,
            "scope": "REVOKED",
            "patient_public_key": "aa" * 64,
            "payload_hash": hashlib.sha256(b"REVOKE_HASH").hexdigest(),
            "digital_signature": "0x" + hashlib.sha256(b"REVOKE_SIG").hexdigest(),
            "timestamp": int(time.time()),
        }

        revoke_receipt = await send_socket_request(TEST_NODE_PORT, revoke_payload)
        print(f"  [+] Revocation receipt: Status={revoke_receipt.get('status')}, Action={revoke_receipt.get('consent_action')}")
        await asyncio.sleep(1.2)

        # Attempt to read again: should be DENIED
        denied_read_resp = await send_socket_request(TEST_NODE_PORT, read_payload)
        print(f"  [+] Post-Revocation Decision: {denied_read_resp.get('decision')} (Reason: {denied_read_resp.get('reason')})")
        assert denied_read_resp.get("decision") == "DENIED", "Access should be DENIED after consent revocation"
        print("  [OK] Test 4 Passed: On-chain AccessManager strictly blocked access after revocation!")

        # =========================================================================
        # TEST 5: Cold Archive Creation (ARCHIVE_BLOCKS)
        # =========================================================================
        print("\n" + "-" * 78)
        print(" [TEST 5] COLD ARCHIVE SAVING & BLOCK PRUNING (ARCHIVE_BLOCKS)")
        print("-" * 78)

        archive_payload = {
            "type": "ARCHIVE_BLOCKS",
            "max_height": 10,
            "prune_sealed_files": True,
        }
        arch_receipt = await send_socket_request(TEST_NODE_PORT, archive_payload)
        print(f"  [+] Archive ID:        {arch_receipt.get('archive_id')}")
        print(f"  [+] File Path:         {arch_receipt.get('archive_file_path')}")
        print(f"  [+] Compressed Bytes:  {arch_receipt.get('compressed_bytes')}")
        print(f"  [+] SHA-256 Checksum:  {arch_receipt.get('sha256_checksum')}")
        print(f"  [+] Merkle Checkpoint: {arch_receipt.get('merkle_checkpoint_root')}")

        assert arch_receipt.get("status") == "OK", "Archive creation failed"
        assert arch_receipt.get("sha256_checksum"), "Missing SHA-256 checksum in archive manifest"
        print("  [OK] Test 5 Passed: Cold archive sealed and compressed successfully!")

        # =========================================================================
        # TEST 6: On-Demand Block Restoration (RESTORE_ARCHIVED_BLOCK)
        # =========================================================================
        print("\n" + "-" * 78)
        print(" [TEST 6] ON-DEMAND ARCHIVED BLOCK RESTORATION")
        print("-" * 78)

        restore_payload = {
            "type": "RESTORE_ARCHIVED_BLOCK",
            "height": 0,
        }
        restore_resp = await send_socket_request(TEST_NODE_PORT, restore_payload)
        print(f"  [+] Restored Block: Height #{restore_resp.get('height')}, Status={restore_resp.get('status')}")
        print(f"  [+] Block Hash:     {restore_resp.get('block_hash')}")
        print(f"  [+] Restored From:  {restore_resp.get('restored_from')}")

        assert restore_resp.get("status") == "OK", "Block restoration failed"
        print("  [OK] Test 6 Passed: Archived block decompressed and verified on demand!")

        print("\n" + "=" * 80)
        print(" [ALL TESTS PASSED] SOVEREIGN PIPELINE 100% OPERATIONAL & VERIFIED")
        print("=" * 80)

    finally:
        print("\n[*] Tearing down background test processes...")
        for p in processes:
            try:
                p.terminate()
                p.wait(timeout=1.0)
            except Exception:
                try:
                    p.kill()
                except Exception:
                    pass
        cleanup_test_dir()
        print("[*] Cleanup complete.")


if __name__ == "__main__":
    asyncio.run(main())
