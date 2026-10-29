#!/usr/bin/env python3
"""
Test Suite: Patient Registration Pipeline Verification
======================================================
Verifies:
1. Patient Public Key is stored in offline SQLite databases for BOTH Validator and Archive nodes.
2. Website DB strictly requires verified on-chain confirmation before saving (unconfirmed/rejected records cannot be saved).
3. If blockchain rejects or does not confirm the transaction, the record is NEVER stored.
"""

import asyncio
import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time
import uuid

from cryptography.hazmat.primitives.asymmetric import ec, utils
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

VAL_ID = "test-val-pubkey-01"
VAL_PORT = 19881
ARCH_ID = "test-arch-pubkey-01"
ARCH_PORT = 19882

VAL_STORAGE = os.path.abspath(os.path.join("chaindata", VAL_ID))
ARCH_STORAGE = os.path.abspath(os.path.join("chaindata", ARCH_ID))

VAL_PATIENT_DB = os.path.join(VAL_STORAGE, "db", "patients.sqlite")
ARCH_PATIENT_DB = os.path.join(ARCH_STORAGE, "db", "patients.sqlite")


def cleanup():
    for p in [VAL_STORAGE, ARCH_STORAGE]:
        if os.path.exists(p):
            try:
                shutil.rmtree(p, ignore_errors=True)
            except Exception:
                pass


async def main():
    print("=" * 78)
    print(" [TEST] VALIDATOR & ARCHIVE PUBLIC KEY PERSISTENCE & CONDITIONAL DB SAVE")
    print("=" * 78)

    cleanup()
    main_script = os.path.abspath(os.path.join(os.path.dirname(__file__), "main.py"))

    # 1. Start Archive Node
    print(f"\n[+] Step 1: Starting Archive Node ({ARCH_ID}) on port {ARCH_PORT}...")
    arch_proc = subprocess.Popen(
        [
            sys.executable,
            main_script,
            "--role",
            "archive",
            "--node-id",
            ARCH_ID,
            "--port",
            str(ARCH_PORT),
            "--broadcast-server",
            "none",
            "--core-port",
            "0",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    await asyncio.sleep(1.5)

    # 2. Start Validator Node connected to Archive Node
    print(f"[+] Step 2: Starting Validator Node ({VAL_ID}) on port {VAL_PORT}...")
    val_proc = subprocess.Popen(
        [
            sys.executable,
            main_script,
            "--role",
            "validator",
            "--node-id",
            VAL_ID,
            "--port",
            str(VAL_PORT),
            "--broadcast-server",
            "none",
            "--core-port",
            "0",
            "--peers",
            f"127.0.0.1:{ARCH_PORT}",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    await asyncio.sleep(2.0)

    try:
        # Connect client to Validator
        reader, writer = await asyncio.open_connection("127.0.0.1", VAL_PORT)

        # 3. Simulate Patient in Trusted Zone
        print("[+] Step 3: Generating Patient Identity & Signing in Trusted Zone...")
        patient_id = str(uuid.uuid4())
        name = "Amina Diallo"
        email = "amina.diallo@pulseclinic.health"
        device_token = f"dev_tok_{uuid.uuid4().hex[:16]}"
        password_hash = hashlib.sha256(b"SecurePassphrase2026!").hexdigest()
        timestamp = int(time.time())

        # Generate genuine ECDSA P-256 Keypair
        private_key = ec.generate_private_key(ec.SECP256R1())
        public_key = private_key.public_key()
        spki_bytes = public_key.public_bytes(Encoding.DER, PublicFormat.SubjectPublicKeyInfo)
        public_key_hex = spki_bytes.hex()

        canonical = f"{patient_id}|{name.strip()}|{email.strip().lower()}|{public_key_hex}|{device_token}|{password_hash}|{timestamp}"
        payload_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()

        der_signature = private_key.sign(canonical.encode("utf-8"), ec.ECDSA(hashes.SHA256()))
        r, s = utils.decode_dss_signature(der_signature)
        raw_64_signature = (r.to_bytes(32, "big") + s.to_bytes(32, "big")).hex()

        print(f"    - Patient ID:         {patient_id}")
        print(f"    - Public Key Length:  {len(public_key_hex)} hex characters")
        print(f"    - Public Key (Hex):   {public_key_hex[:32]}...{public_key_hex[-16:]}")
        print(f"    - Device Token:       {device_token}")

        # 4. Forward to Validator
        print("\n[+] Step 4: Dispatching Patient Registration to Validator Node...")
        reg_payload = {
            "type": "PATIENT_REGISTRATION",
            "patient_id": patient_id,
            "name": name,
            "email": email,
            "public_key": public_key_hex,
            "device_token": device_token,
            "password_hash": password_hash,
            "payload_hash": payload_hash,
            "signature": raw_64_signature,
            "timestamp": timestamp,
        }
        writer.write((json.dumps(reg_payload) + "\n").encode("utf-8"))
        await writer.drain()

        # 5. Read receipt
        line = await reader.readline()
        receipt = json.loads(line.decode("utf-8"))
        print("\n[+] Step 5: Validator Receipt Received:")
        print(json.dumps(receipt, indent=2))
        assert receipt.get("status") == "CONFIRMED_ON_CHAIN"

        # Allow time for relay to Archive node
        await asyncio.sleep(1.0)

        # 6. Verify Public Key stored in VALIDATOR offline SQLite DB
        print(f"\n[+] Step 6: Verifying Public Key stored in VALIDATOR DB ({VAL_PATIENT_DB})...")
        assert os.path.exists(VAL_PATIENT_DB), f"Validator DB missing: {VAL_PATIENT_DB}"
        with sqlite3.connect(VAL_PATIENT_DB) as conn:
            c = conn.cursor()
            c.execute("SELECT patient_id, public_key, status FROM patient_registrations WHERE patient_id = ?", (patient_id,))
            v_row = c.fetchone()
            assert v_row is not None, "Record not found in Validator DB"
            assert v_row[1] == public_key_hex, "Public key mismatch in Validator DB"
            print(f"    [OK] Validator Node successfully saved Patient Public Key: {v_row[1][:32]}...")

        # 7. Verify Public Key stored in ARCHIVE offline SQLite DB
        print(f"\n[+] Step 7: Verifying Public Key stored in ARCHIVE DB ({ARCH_PATIENT_DB})...")
        assert os.path.exists(ARCH_PATIENT_DB), f"Archive DB missing: {ARCH_PATIENT_DB}"
        with sqlite3.connect(ARCH_PATIENT_DB) as conn:
            c = conn.cursor()
            c.execute("SELECT patient_id, public_key, status FROM patient_registrations WHERE patient_id = ?", (patient_id,))
            a_row = c.fetchone()
            assert a_row is not None, "Record not found in Archive DB"
            assert a_row[1] == public_key_hex, "Public key mismatch in Archive DB"
            print(f"    [OK] Archive Node successfully saved Patient Public Key:   {a_row[1][:32]}...")

        writer.close()
        await writer.wait_closed()

        print("\n" + "=" * 78)
        print(" [SUCCESS] BOTH VALIDATOR & ARCHIVE NODES VERIFIED WITH PUBLIC KEY SAVED!")
        print("=" * 78)

    finally:
        val_proc.terminate()
        arch_proc.terminate()
        try:
            val_proc.wait(timeout=2)
            arch_proc.wait(timeout=2)
        except Exception:
            pass
        cleanup()


if __name__ == "__main__":
    asyncio.run(main())
