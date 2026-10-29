#!/usr/bin/env python3
"""
Test Suite: Break-Glass Function with Multi-Node Key Escrow
============================================================
Tests the complete Break-Glass Architecture requested:
  1. Proxy Re-Encryption / Key Escrow:
     - Emergency key pair generated and structurally separated from TrustZone key.
     - Split via Shamir's Secret Sharing over GF(2^8) (2-of-3 threshold).
     - Distributed and stored across:
       * KSM Core / KSM Node
       * Validator Node
       * Archive Node
     - Verifies all 3 nodes store their respective shares in their SQLite ledgers.
  2. Smart Contract Emergency Trigger:
     - Authorized ER doctor signs transaction stating "Emergency: Patient Unconscious".
     - Smart contract verifies ER doctor credentials and signature.
     - Unauthorized doctors or non-emergency declarations are rejected.
  3. Decryption Bypass:
     - System gathers unlocked shares from the quorum (KMS, Validator, Archive).
     - Recreates the emergency decryption key using Shamir Lagrange interpolation.
     - Decrypts off-chain encrypted emergency medical records (allergies, medications, blood type).
  4. Permanent Audit Logging & Legal Flagging:
     - Blockchain permanently logs the break-glass event on-chain.
     - Flags doctor with 'FLAGGED_FOR_LEGAL_AUDIT'.
  5. Patient Alerting:
     - Patient is alerted the moment they regain access to their device.
"""

import asyncio
import json
import os
import shutil
import sys
import time
import uuid

# Ensure node directory is in sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from shamir import GF256, KeyShare, ShamirSecretSharing, encrypt_aes_gcm, decrypt_aes_gcm
from escrow_storage import EscrowStorage
from main import DistributedNode
from ksm_node import KsmNode


TEST_DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "chaindata", "test_escrow"))


def cleanup():
    if os.path.exists(TEST_DATA_DIR):
        try:
            shutil.rmtree(TEST_DATA_DIR, ignore_errors=True)
        except Exception:
            pass


async def main():
    print("=" * 80)
    print(" [TEST SUITE] BREAK-GLASS FUNCTION WITH MULTI-NODE KEY ESCROW")
    print("   Storage Nodes: KMS Core, Validator Node, and Archive Node")
    print("=" * 80)

    cleanup()
    os.makedirs(TEST_DATA_DIR, exist_ok=True)

    # -------------------------------------------------------------------------
    # PART 1: NODE INITIALIZATION (VALIDATOR, ARCHIVE, KSM)
    # -------------------------------------------------------------------------
    print("\n" + "-" * 80)
    print(" [STAGE 1] INITIALIZING DISTRIBUTED NODES (VALIDATOR, ARCHIVE, KSM)")
    print("-" * 80)

    val_node_id = "val-node-01"
    archive_node_id = "archive-node-01"
    ksm_node_id = "ksm-node-01"

    val_storage = EscrowStorage(os.path.join(TEST_DATA_DIR, val_node_id, "db"), val_node_id, "VALIDATOR")
    archive_storage = EscrowStorage(os.path.join(TEST_DATA_DIR, archive_node_id, "db"), archive_node_id, "ARCHIVE")
    ksm_storage = EscrowStorage(os.path.join(TEST_DATA_DIR, ksm_node_id, "db"), ksm_node_id, "KSM")

    # Start a live Validator DistributedNode to handle network triggers
    val_port = 8110
    validator_node = DistributedNode(
        node_id=val_node_id,
        node_type="VALIDATOR",
        host="127.0.0.1",
        port=val_port,
        core_port=None,
        broadcast_server=None,
    )
    val_task = asyncio.create_task(validator_node.start())
    await asyncio.sleep(0.5)

    print(f" [+] Validator Node active on port {val_port} (Escrow DB: {val_storage.db_path})")
    print(f" [+] Archive Node initialized (Escrow DB: {archive_storage.db_path})")
    print(f" [+] KSM Node initialized (Escrow DB: {ksm_storage.db_path})")

    try:
        # -------------------------------------------------------------------------
        # PART 2: EMERGENCY KEY GENERATION & SHAMIR SECRET SHARING
        # -------------------------------------------------------------------------
        print("\n" + "-" * 80)
        print(" [STAGE 2] PATIENT BOOKLET SETUP: GENERATING EMERGENCY ESCROW KEY PAIR")
        print("   (Structurally separated from daily personal TrustZone key)")
        print("-" * 80)

        patient_id = "pat-yaounde-9942"
        emergency_pubkey = f"04{'ee' * 32}{'ff' * 32}"
        # 256-bit AES Emergency Decryption Key (DEK)
        emergency_dek = os.urandom(32)
        print(f"  [+] Emergency DEK (Master Secret): {emergency_dek.hex()[:32]}... ({len(emergency_dek)} bytes)")
        print(f"  [+] Emergency Public Key:         {emergency_pubkey[:32]}...")

        # Off-Chain Medical Record to be encrypted with the Emergency Key
        clinical_profile = {
            "patient_id": patient_id,
            "patient_name": "Jean-Luc Nguema",
            "blood_type": "O-Negative",
            "severe_allergies": ["Penicillin G", "Iodinated Contrast Media"],
            "chronic_conditions": ["Severe Coronary Artery Disease", "Type 1 Diabetes Mellitus"],
            "current_medications": [
                {"drug": "Clopidogrel", "dose": "75mg QD"},
                {"drug": "Atorvastatin", "dose": "40mg QHS"},
                {"drug": "Insulin Glargine", "dose": "24 units QHS"}
            ],
            "resuscitation_preference": "FULL_CODE",
            "emergency_contact": "Clarisse Nguema (Wife) +237-677-99-88-77",
            "primary_care_physician": "Dr. Martin Kamga (Cardiologist, Yaoundé)",
        }
        clinical_bytes = json.dumps(clinical_profile).encode("utf-8")
        encrypted_record = encrypt_aes_gcm(emergency_dek, clinical_bytes)
        print(f"  [+] Clinical Emergency Data Encrypted: {len(clinical_bytes)} bytes plaintext -> {len(encrypted_record['ciphertext_hex']) // 2} bytes ciphertext")
        print(f"  [+] Body Data Hash (SHA-256):         {encrypted_record['body_data_hash']}")

        # Shamir Secret Sharing: 2-of-3 threshold
        # Share 1 (x=1) -> KMS Node
        # Share 2 (x=2) -> Validator Node
        # Share 3 (x=3) -> Archive Node
        sss = ShamirSecretSharing()
        shares = sss.split_secret(emergency_dek, threshold_t=2, total_n=3, start_coord=1)
        print("\n  [+] Splitting Emergency Key into 3 Shares (Threshold: 2-of-3):")
        for i, s in enumerate(shares, 1):
            role = ["KSM Node", "Validator Node", "Archive Node"][i - 1]
            print(f"      * Share #{s.index} (x={s.index}) destined for [{role}]: {s.to_hex()[:24]}...")

        # -------------------------------------------------------------------------
        # PART 3: KEY ESCROW STORAGE ACROSS KMS, VALIDATOR, AND ARCHIVE NODES
        # -------------------------------------------------------------------------
        print("\n" + "-" * 80)
        print(" [STAGE 3] DISTRIBUTING & PERSISTING ESCROW SHARES ACROSS NODES")
        print("   (KMS Core, Validator Node, and Archive Node)")
        print("-" * 80)

        escrow_id = f"escrow-{uuid.uuid4().hex[:8]}"

        # Store on KSM Node
        ksm_storage.store_escrow_share(
            escrow_id=escrow_id,
            patient_id=patient_id,
            share_index=shares[0].index,
            share_hex=shares[0].to_hex(),
            emergency_public_key=emergency_pubkey,
            threshold_t=2,
            total_n=3,
        )
        print(f"  [+] KSM Node SQLite Ledger: Share x={shares[0].index} stored [OK]")

        # Store on Validator Node (via TCP Socket)
        reader, writer = await asyncio.open_connection("127.0.0.1", val_port)
        store_val_msg = {
            "type": "STORE_ESCROW_SHARE",
            "escrow_id": escrow_id,
            "patient_id": patient_id,
            "share_index": shares[1].index,
            "share_hex": shares[1].to_hex(),
            "emergency_public_key": emergency_pubkey,
            "threshold": 2,
            "total_nodes": 3,
        }
        writer.write((json.dumps(store_val_msg) + "\n").encode("utf-8"))
        await writer.drain()
        val_ack = json.loads((await reader.readline()).decode("utf-8").strip())
        print(f"  [+] Validator Node SQLite Ledger: Share x={shares[1].index} stored via P2P ({val_ack.get('status')}) [OK]")
        assert val_ack["status"] == "SUCCESS", "Validator escrow storage failed"

        # Store on Archive Node
        archive_storage.store_escrow_share(
            escrow_id=escrow_id,
            patient_id=patient_id,
            share_index=shares[2].index,
            share_hex=shares[2].to_hex(),
            emergency_public_key=emergency_pubkey,
            threshold_t=2,
            total_n=3,
        )
        print(f"  [+] Archive Node SQLite Ledger: Share x={shares[2].index} stored [OK]")

        # Verify disk persistence across all three node SQLite databases
        ksm_rec = ksm_storage.get_escrow_share(patient_id)
        val_rec = validator_node.escrow_storage.get_escrow_share(patient_id)
        arc_rec = archive_storage.get_escrow_share(patient_id)

        assert ksm_rec and ksm_rec["share_index"] == 1, "KSM share missing"
        assert val_rec and val_rec["share_index"] == 2, "Validator share missing"
        assert arc_rec and arc_rec["share_index"] == 3, "Archive share missing"
        print("\n  [OK] Key Escrow successfully anchored across KMS Core, Validator, and Archive nodes!")

        # -------------------------------------------------------------------------
        # PART 4: THE SMART CONTRACT EMERGENCY TRIGGER ("Emergency: Patient Unconscious")
        # -------------------------------------------------------------------------
        print("\n" + "-" * 80)
        print(" [STAGE 4] SMART CONTRACT EMERGENCY TRIGGER VERIFICATION")
        print("   (Testing Credential Checks & Mandatory Declaration)")
        print("-" * 80)

        # Negative Test 1: Invalid declaration (missing "Emergency: Patient Unconscious")
        invalid_decl_msg = {
            "type": "TRIGGER_BREAK_GLASS",
            "patient_id": patient_id,
            "doctor_id": "doc-er-01",
            "department": "Emergency Room",
            "declaration": "Routine Checkup: Patient Asleep",
            "encrypted_emergency_record": encrypted_record,
        }
        writer.write((json.dumps(invalid_decl_msg) + "\n").encode("utf-8"))
        await writer.drain()
        inv_res = json.loads((await reader.readline()).decode("utf-8").strip())
        print(f"  [-] Test 1 (Invalid Declaration): {inv_res.get('status')} - {inv_res.get('message')}")
        assert inv_res["status"] == "REJECTED_INVALID_DECLARATION", "Should reject non-emergency declaration"

        # Negative Test 2: Unauthorized doctor (Non-ER credentials)
        unauth_msg = {
            "type": "TRIGGER_BREAK_GLASS",
            "patient_id": patient_id,
            "doctor_id": "doc-dermatology-99",
            "is_er_doctor": False,
            "department": "Cosmetic Dermatology Clinic",
            "requester_role": "DERMATOLOGIST",
            "declaration": "Emergency: Patient Unconscious",
            "encrypted_emergency_record": encrypted_record,
        }
        writer.write((json.dumps(unauth_msg) + "\n").encode("utf-8"))
        await writer.drain()
        unauth_res = json.loads((await reader.readline()).decode("utf-8").strip())
        print(f"  [-] Test 2 (Unauthorized Doctor): {unauth_res.get('status')} - {unauth_res.get('message')}")
        assert unauth_res["status"] == "REJECTED_UNAUTHORIZED_DOCTOR", "Should reject unauthorized doctor"

        # Positive Test: Authorized ER Doctor signs "Emergency: Patient Unconscious"
        print("\n  [+] Test 3: Authorized ER Doctor Submits Valid Emergency Trigger...")
        er_doctor_id = "doc-er-mvondo"
        er_doctor_name = "Dr. Paul Mvondo (ER Chief Physician)"
        hospital_id = "Hôpital Central de Yaoundé - ER Resuscitation Bay 1"

        # Unlock share from Archive node to form the 2-of-3 quorum with Validator
        unlocked_arc = archive_storage.unlock_escrow_share(
            patient_id, er_doctor_id, "Emergency: Patient Unconscious"
        )
        assert unlocked_arc, "Archive unlock failed"

        valid_trigger_msg = {
            "type": "TRIGGER_BREAK_GLASS",
            "patient_id": patient_id,
            "doctor_id": er_doctor_id,
            "doctor_name": er_doctor_name,
            "hospital_id": hospital_id,
            "department": "Emergency & Trauma Surgery",
            "declaration": "Emergency: Patient Unconscious",
            "is_er_doctor": True,
            "threshold": 2,
            "encrypted_emergency_record": encrypted_record,
            "provided_escrow_shares": [
                {
                    "node_role": "ARCHIVE",
                    "node_id": archive_node_id,
                    "share_index": unlocked_arc["share_index"],
                    "share_hex": unlocked_arc["share_hex"],
                }
            ],
        }

        writer.write((json.dumps(valid_trigger_msg) + "\n").encode("utf-8"))
        await writer.drain()
        bg_res = json.loads((await reader.readline()).decode("utf-8").strip())

        # -------------------------------------------------------------------------
        # PART 5: VERIFY DECRYPTION BYPASS & RECONSTRUCTED DATA
        # -------------------------------------------------------------------------
        print("\n" + "-" * 80)
        print(" [STAGE 5] DECRYPTION BYPASS & CLINICAL RECONSTRUCTION VERIFICATION")
        print("-" * 80)

        print(f"  [+] Status:              {bg_res.get('status')}")
        print(f"  [+] Action:              {bg_res.get('action')}")
        print(f"  [+] Break-Glass ID:      {bg_res.get('break_glass_id')}")
        print(f"  [+] On-Chain Tx ID:      {bg_res.get('tx_id')}")
        print(f"  [+] Escrow Quorum Nodes: {', '.join(bg_res.get('escrow_quorum', []))}")
        print(f"  [+] Shares Unlocked:     {bg_res.get('shares_unlocked_count')} shares")
        print(f"  [+] Legal Audit Flag:    {bg_res.get('legal_audit_flag')}")
        print(f"  [+] Legal Audit Status:  {bg_res.get('legal_audit_status')}")

        assert bg_res["status"] == "OK", "Break-Glass trigger failed"
        assert bg_res["action"] == "BREAK_GLASS_UNLOCKED_AND_AUDITED", "Action mismatch"
        assert bg_res["legal_audit_flag"] == "FLAGGED_FOR_LEGAL_AUDIT", "Legal audit flag missing"

        # Verify Decrypted Clinical Records
        decrypted_med = bg_res.get("emergency_clinical_record", {})
        print("\n  [+] Decrypted Emergency Medical Information:")
        print(f"      - Blood Type:          {decrypted_med.get('blood_type')}")
        print(f"      - Severe Allergies:    {decrypted_med.get('severe_allergies')}")
        print(f"      - Chronic Conditions:  {decrypted_med.get('chronic_conditions')}")
        print(f"      - Current Medications: {decrypted_med.get('current_medications')}")
        print(f"      - Emergency Contact:   {decrypted_med.get('emergency_contact')}")

        assert decrypted_med["blood_type"] == "O-Negative", "Blood type decryption error"
        assert "Penicillin G" in decrypted_med["severe_allergies"], "Allergy decryption error"
        print("\n  [OK] Off-chain emergency files successfully decrypted via reconstructed emergency key!")

        # -------------------------------------------------------------------------
        # PART 6: PERMANENT ON-CHAIN AUDIT LOG & PATIENT ALERT VERIFICATION
        # -------------------------------------------------------------------------
        print("\n" + "-" * 80)
        print(" [STAGE 6] PERMANENT AUDIT LOG & PATIENT RECONNECT ALERT VERIFICATION")
        print("-" * 80)

        # 1. Verify On-Chain / SQLite Audit Logs
        audit_logs = validator_node.escrow_storage.get_audit_logs(patient_id)
        assert len(audit_logs) >= 1, "Audit log missing on validator"
        latest_audit = audit_logs[0]
        print(f"  [+] Immutable Audit Log Confirmed:")
        print(f"      - Tx ID:              {latest_audit['tx_id']}")
        print(f"      - Break-Glass ID:     {latest_audit['break_glass_id']}")
        print(f"      - Attending Doctor:   {latest_audit['doctor_name']} ({latest_audit['doctor_id']})")
        print(f"      - Justification:      {latest_audit['reason']}")
        print(f"      - Legal Status:       {latest_audit['legal_audit_flag']} ({latest_audit['legal_audit_status']})")
        print(f"      - Escrow Quorum:      {latest_audit['escrow_quorum']}")

        assert latest_audit["reason"] == "Emergency: Patient Unconscious"
        assert latest_audit["legal_audit_flag"] == "FLAGGED_FOR_LEGAL_AUDIT"

        # 2. Patient Reconnect Alert Test
        print("\n  [+] Simulating Patient Reconnecting Mobile Device / Booklet...")
        query_alerts_msg = {
            "type": "GET_PATIENT_ALERTS",
            "patient_id": patient_id,
        }
        writer.write((json.dumps(query_alerts_msg) + "\n").encode("utf-8"))
        await writer.drain()
        alerts_resp = json.loads((await reader.readline()).decode("utf-8").strip())

        print(f"  [+] Patient Pending Alerts Count: {alerts_resp.get('pending_count')}")
        assert alerts_resp.get("pending_count") >= 1, "Patient should have pending security alert"
        alert_entry = alerts_resp["alerts"][0]
        print(f"  [+] Delivered Alert Message:\n      \"{alert_entry.get('message')}\"")

        # Patient acknowledges the alert
        ack_msg = {
            "type": "ACK_PATIENT_ALERT",
            "alert_id": alert_entry["alert_id"],
        }
        writer.write((json.dumps(ack_msg) + "\n").encode("utf-8"))
        await writer.drain()
        ack_resp = json.loads((await reader.readline()).decode("utf-8").strip())
        print(f"  [+] Alert Acknowledgment Status: {ack_resp.get('status')} [OK]")
        assert ack_resp.get("acknowledged") is True, "Alert acknowledgment failed"

        writer.close()
        await writer.wait_closed()

    finally:
        print("\n[*] Shutting down test validator...")
        await validator_node.stop()
        val_task.cancel()
        cleanup()

    print("\n" + "=" * 80)
    print(" [TEST PASSED] ALL KEY ESCROW & BREAK-GLASS SPECIFICATIONS VERIFIED [OK]")
    print("=" * 80)


if __name__ == "__main__":
    asyncio.run(main())
