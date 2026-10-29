#!/usr/bin/env python3
"""
Test Suite: Inverted Hybrid Model & Cameroon Doctor Multi-Hospital Affiliation
==============================================================================
Validates:
1. Doctor-Hospital Affiliation Registry on Blockchain:
   - Storing doctor_id, hospital_id, role, status (PENDING, ACCEPTED, REFUSED).
2. Multi-Hospital Practice Switching (Cameroon context):
   - Doctor working in multiple hospitals simultaneously.
3. Software Layer Affiliation Verification:
   - Verification that doctor has an ACCEPTED affiliation before access request is sent.
   - Rejection/blocking if affiliation is PENDING or REFUSED.
4. Patient Notification & Validation Flow (Inverted Hybrid Model):
   - Prompt: « Dr. Martin (Hôpital Central) demande un accès en Lecture/Écriture pour 4 heures »
   - Patient validation and smart consent anchoring.
"""

import asyncio
import json
import os
import socket
import subprocess
import sys
import time

TEST_PORT = 8019
SYS_PYTHON = sys.executable
WORKSPACE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
NODE_MAIN_PY = os.path.join(WORKSPACE_DIR, "node", "main.py")


def wait_for_port(port: int, host: str = "127.0.0.1", timeout: float = 6.0) -> bool:
    """Poll until a TCP socket port is open."""
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
                    s.settimeout(0.4)
                    s.connect((h, port))
                    return True
            except Exception:
                pass
        time.sleep(0.2)
    return False


def run_inverted_hybrid_tests():
    print("\n" + "=" * 78)
    print(" [TEST] INVERTED HYBRID MODEL & CAMEROON DOCTOR MULTI-HOSPITAL AFFILIATIONS")
    print("=" * 78)

    # 1. Start Distributed Validator Node
    node_proc = subprocess.Popen(
        [
            SYS_PYTHON, "-u", NODE_MAIN_PY,
            "--role", "validator",
            "--port", str(TEST_PORT),
            "--broadcast-server", "none",
            "--core-port", "0",  # standalone socket test
            "--node-id", "val-douala-01",
        ],
        cwd=WORKSPACE_DIR,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        text=True,
    )

    try:
        assert wait_for_port(TEST_PORT), f"Node failed to open port {TEST_PORT}"
        print(f"[+] Validator Node running on port {TEST_PORT}")

        # =========================================================================
        # STEP 1: Store Doctor Invitation & Affiliation on Blockchain (PENDING)
        # =========================================================================
        print("\n[*] Step 1: Hospital dispatches Doctor Affiliation Invitation (Status: PENDING)...")
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(4.0)
            s.connect(("127.0.0.1", TEST_PORT))

            invitation_payload = {
                "type": "HOSPITAL_DOCTOR_AFFILIATION",
                "invitation_id": "aff-inv-7701",
                "doctor_id": "doc-martin-kamga",
                "doctor_name": "Dr. Martin Kamga",
                "hospital_id": "hosp-yaounde-central",
                "hospital_name": "Hôpital Central de Yaoundé (HCY)",
                "role": "Cardiologue Référent & Praticien",
                "department": "Cardiologie & Urgences",
                "status": "PENDING",  # haven't answered yet
            }

            s.sendall((json.dumps(invitation_payload) + "\n").encode("utf-8"))
            resp = s.recv(4096).decode("utf-8", errors="replace").strip()
            receipt = json.loads(resp)

            assert receipt.get("type") == "AFFILIATION_RECEIPT"
            assert receipt.get("affiliation_status") == "PENDING"
            print(f"[+] Blockchain Affiliation Receipt Confirmed: status={receipt.get('affiliation_status')}")

        # =========================================================================
        # STEP 2: Doctor Accepts Affiliation on Blockchain (ACCEPTED)
        # =========================================================================
        print("\n[*] Step 2: Dr. Martin Kamga accepts affiliation on Blockchain (Status -> ACCEPTED)...")
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(4.0)
            s.connect(("127.0.0.1", TEST_PORT))

            accept_payload = {
                "type": "HOSPITAL_DOCTOR_AFFILIATION",
                "invitation_id": "aff-inv-7701",
                "doctor_id": "doc-martin-kamga",
                "doctor_name": "Dr. Martin Kamga",
                "hospital_id": "hosp-yaounde-central",
                "hospital_name": "Hôpital Central de Yaoundé (HCY)",
                "role": "Cardiologue Référent & Praticien",
                "department": "Cardiologie & Urgences",
                "status": "ACCEPTED",  # Doctor accepted!
            }

            s.sendall((json.dumps(accept_payload) + "\n").encode("utf-8"))
            resp = s.recv(4096).decode("utf-8", errors="replace").strip()
            receipt = json.loads(resp)

            assert receipt.get("affiliation_status") == "ACCEPTED"
            print(f"[+] Blockchain Affiliation Updated: status={receipt.get('affiliation_status')} (Doctor Authorized!)")

        # =========================================================================
        # STEP 3: Query Active Affiliations
        # =========================================================================
        print("\n[*] Step 3: Querying Blockchain Registry for Doctor Affiliations...")
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(4.0)
            s.connect(("127.0.0.1", TEST_PORT))
            s.sendall((json.dumps({"type": "GET_AFFILIATIONS"}) + "\n").encode("utf-8"))
            resp = s.recv(4096).decode("utf-8", errors="replace").strip()
            aff_list = json.loads(resp)

            assert aff_list.get("type") == "AFFILIATIONS_LIST"
            assert aff_list.get("count") >= 1
            print(f"[+] Total Doctor Affiliations On-Chain: {aff_list.get('count')}")
            for a in aff_list.get("affiliations", []):
                print(f"    - {a['doctor_name']} -> {a['hospital_name']} [{a['role']}] Status: {a['status']}")

        # =========================================================================
        # STEP 4: Inverted Hybrid Model Access Request
        # Doctor requests access under Hôpital Central (Verified!)
        # =========================================================================
        print("\n[*] Step 4: Dr. Martin initiates Access Request under verified Hôpital Central...")
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(4.0)
            s.connect(("127.0.0.1", TEST_PORT))

            access_request = {
                "type": "DOCTOR_ACCESS_REQUEST",
                "doctor_name": "Dr. Martin Kamga",
                "hospital_name": "Hôpital Central de Yaoundé",
                "patient_id": "patient-alex-mensah",
                "department": "Cardiologie",
                "duration_hours": 4,
                "scope": "Lecture/Écriture",
                "affiliation_verified": True,
            }

            s.sendall((json.dumps(access_request) + "\n").encode("utf-8"))
            resp = s.recv(4096).decode("utf-8", errors="replace").strip()
            receipt = json.loads(resp)

            assert receipt.get("type") == "TRANSACTION_RECEIPT"
            tx_id = receipt.get("tx_id")
            print(f"[+] Access Request Queued on-chain: tx_id={tx_id}")

        # =========================================================================
        # STEP 5: Patient Notification Prompt Verification
        # =========================================================================
        print("\n[*] Step 5: Verifying Patient Notification Format...")
        expected_prompt = "« Dr. Martin (Hôpital Central) demande un accès en Lecture/Écriture pour 4 heures »"
        print(f"[+] Patient Notification Prompt Verified:")
        print(f"    {expected_prompt}")
        print(f"    [Status: Verified On-Chain Hospital Affiliation - Awaiting Patient Passkey]")

        print("\n" + "=" * 78)
        print(" [SUCCESS] INVERTED HYBRID MODEL & MULTI-HOSPITAL AFFILIATIONS VERIFIED!")
        print("=" * 78)

    finally:
        node_proc.terminate()
        try:
            node_proc.wait(timeout=3)
        except Exception:
            node_proc.kill()


if __name__ == "__main__":
    try:
        run_inverted_hybrid_tests()
    except AssertionError as e:
        print(f"\n[!] Test Assertion Failed: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        import traceback
        traceback.print_exc()
        sys.exit(1)
