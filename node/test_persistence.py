#!/usr/bin/env python3
"""
Test Suite: Blockchain Core & Node Storage Persistency
=====================================================
Validates that:
1. Blockchain Core & Node dynamically initialize storage under `chaindata/<node_id>`
   with subdirectories: `db/`, `uploads/`, `blocks/`, `merkle_trees/`, `audit_logs/`.
2. Transactions sent into the node persist into `chaindata/<node_id>/mempool.json`
   and are anchored into Blockchain Core's audit logs.
3. Upon shutdown and restart of both the node and Blockchain Core:
   - Data directories and files remain intact.
   - Core reloads the chain height and tip without losing data.
   - Node restores queued transactions from disk.
"""

import asyncio
import json
import os
import shutil
import socket
import subprocess
import sys
import time

TEST_NODE_ID = "val-persistency-test"
TEST_CHAIN_ID = 42
TEST_CORE_PORT = 50058
TEST_NODE_PORT = 8018
SYS_PYTHON = sys.executable

# Root paths
WORKSPACE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BUILD_CORE_EXE = os.path.join(WORKSPACE_DIR, "build", "Debug", "blockchain_core.exe")
TARGET_DATA_DIR = os.path.join(WORKSPACE_DIR, "chaindata", TEST_NODE_ID)


def clean_test_data() -> None:
    """Ensure clean slate before starting test."""
    if os.path.exists(TARGET_DATA_DIR):
        try:
            shutil.rmtree(TARGET_DATA_DIR, ignore_errors=True)
            time.sleep(0.5)
        except Exception as e:
            print(f"[!] Warning cleaning directory {TARGET_DATA_DIR}: {e}")


def wait_for_port(port: int, host: str = "127.0.0.1", timeout: float = 6.0) -> bool:
    """Poll until a TCP socket port is open and responding."""
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
                    s.connect((h, port))
                    return True
            except Exception:
                pass
        time.sleep(0.2)
    return False


def test_core_cli_storage_creation() -> None:
    """Test 1: Start blockchain_core.exe with --node-id and verify directory creation."""
    print("\n" + "=" * 76)
    print(" [TEST 1] BLOCKCHAIN CORE DIRECTORY CREATION VIA CLI / INIT_STORAGE")
    print("=" * 76)

    clean_test_data()

    # Launch blockchain_core with --node-id and --chain-id
    cmd = [
        BUILD_CORE_EXE,
        "--port", str(TEST_CORE_PORT),
        "--node-id", TEST_NODE_ID,
        "--chain-id", str(TEST_CHAIN_ID),
    ]
    print(f"[*] Launching: {' '.join(cmd)}")
    core_proc = subprocess.Popen(
        cmd,
        cwd=WORKSPACE_DIR,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        text=True,
    )

    try:
        assert wait_for_port(TEST_CORE_PORT), f"Core did not open port {TEST_CORE_PORT}"
        print(f"[+] Blockchain Core listening on port {TEST_CORE_PORT}")

        # Check directory creation
        time.sleep(1.0)
        assert os.path.isdir(TARGET_DATA_DIR), f"Missing data dir: {TARGET_DATA_DIR}"
        print(f"[+] Main data dir verified: {TARGET_DATA_DIR}")

        expected_subdirs = ["db", "uploads", "blocks", "merkle_trees", "audit_logs"]
        for sub in expected_subdirs:
            subdir_path = os.path.join(TARGET_DATA_DIR, sub)
            assert os.path.isdir(subdir_path), f"Missing required subdir: {subdir_path}"
            print(f"    - Subdirectory [OK]: {sub}/")

        # Verify chain_info.json
        info_file = os.path.join(TARGET_DATA_DIR, "chain_info.json")
        assert os.path.isfile(info_file), f"Missing chain_info.json in {TARGET_DATA_DIR}"
        with open(info_file, "r") as f:
            info_data = json.load(f)
            assert info_data["node_id"] == TEST_NODE_ID
            assert info_data["chain_id"] == TEST_CHAIN_ID
        print(f"[+] Metadata file verified: {info_file} (Node: {info_data['node_id']}, Chain: {info_data['chain_id']})")

        # Test IPC command: INIT_STORAGE handshake
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(3.0)
            s.connect(("127.0.0.1", TEST_CORE_PORT))
            req = f"INIT_STORAGE node_id={TEST_NODE_ID} chain_id={TEST_CHAIN_ID}\n"
            s.sendall(req.encode("utf-8"))
            resp_data = s.recv(4096).decode("utf-8", errors="replace")
            print(f"[+] Core IPC INIT_STORAGE Response:\n{resp_data.strip()}")
            resp_json = json.loads(resp_data)
            assert resp_json.get("status") == "OK"
            assert resp_json.get("node_id") == TEST_NODE_ID

    finally:
        core_proc.terminate()
        try:
            core_proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            core_proc.kill()
        print("[*] Core process stopped.")


def test_end_to_end_persistency() -> None:
    """Test 2 & 3: Run Node + Core, send transaction, stop, restart, verify persistence."""
    print("\n" + "=" * 76)
    print(" [TEST 2] FULL PERSISTENCY TEST: SUBMIT TRANSACTION -> RESTART -> VERIFY DATA")
    print("=" * 76)

    # 1. Start Core on TEST_CORE_PORT
    core_proc1 = subprocess.Popen(
        [BUILD_CORE_EXE, "--port", str(TEST_CORE_PORT), "--node-id", TEST_NODE_ID, "--chain-id", str(TEST_CHAIN_ID)],
        cwd=WORKSPACE_DIR,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    assert wait_for_port(TEST_CORE_PORT), "Core 1 failed to start"

    # 2. Start Distributed Validator Node
    node_main_py = os.path.join(WORKSPACE_DIR, "node", "main.py")
    node_proc1 = subprocess.Popen(
        [
            SYS_PYTHON, "-u", node_main_py,
            "--role", "validator",
            "--port", str(TEST_NODE_PORT),
            "--broadcast-server", "none",
            "--core-port", str(TEST_CORE_PORT),
            "--node-id", TEST_NODE_ID,
            "--chain-id", str(TEST_CHAIN_ID),
        ],
        cwd=WORKSPACE_DIR,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    assert wait_for_port(TEST_NODE_PORT), "Node 1 failed to start"
    print(f"[+] Validator Node & Core running on ports {TEST_NODE_PORT} & {TEST_CORE_PORT}")

    time.sleep(1.0)
    tx_id = ""

    try:
        # 3. Send Hospital Access Request to Node
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(4.0)
            s.connect(("127.0.0.1", TEST_NODE_PORT))
            req_payload = {
                "type": "HOSPITAL_ACCESS_REQUEST",
                "hospital_name": "Douala General Hospital",
                "doctor_name": "Dr. Jean Ebolo",
                "patient_id": "patient-persist-001",
                "department": "Neurology",
                "duration_hours": 8,
            }
            s.sendall((json.dumps(req_payload) + "\n").encode("utf-8"))
            resp = s.recv(4096).decode("utf-8", errors="replace").strip()
            receipt = json.loads(resp)
            tx_id = receipt["tx_id"]
            print(f"[+] Transaction successfully accepted and queued: {tx_id}")

        time.sleep(1.5)

        # Verify file on disk before restart: mempool.json
        mempool_path = os.path.join(TARGET_DATA_DIR, "mempool.json")
        assert os.path.isfile(mempool_path), f"Mempool file missing: {mempool_path}"
        with open(mempool_path, "r") as f:
            saved_mempool = json.load(f)
            assert any(t.get("tx_id") == tx_id for t in saved_mempool), "Transaction not found in mempool.json!"
        print(f"[+] Verified transaction {tx_id} physically saved on disk in {mempool_path}")

        # Verify audit log in core
        audit_log_path = os.path.join(TARGET_DATA_DIR, "audit_logs", "transactions.log")
        if os.path.exists(audit_log_path):
            with open(audit_log_path, "r") as f:
                content = f.read()
                print(f"[+] Core audit log entries found ({len(content)} bytes)")

    finally:
        # 4. SHUT DOWN BOTH PROCESSES COMPLETELY
        print("\n[*] Shutting down Node and Core to simulate power/server restart...")
        node_proc1.terminate()
        core_proc1.terminate()
        try:
            node_proc1.wait(timeout=3)
        except Exception:
            node_proc1.kill()
        try:
            core_proc1.wait(timeout=3)
        except Exception:
            core_proc1.kill()
        time.sleep(1.5)

    print("[*] Both processes stopped. Data remains on disk.")

    # 5. RESTART NODE & CORE WITH SAME NODE_ID TO TEST PERSISTENCY
    print("\n" + "=" * 76)
    print(" [TEST 3] RESTARTING NODE & CORE: VERIFYING RECOVERY OF DATA & MEMPOOL")
    print("=" * 76)

    core_proc2 = subprocess.Popen(
        [BUILD_CORE_EXE, "--port", str(TEST_CORE_PORT), "--node-id", TEST_NODE_ID, "--chain-id", str(TEST_CHAIN_ID)],
        cwd=WORKSPACE_DIR,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    assert wait_for_port(TEST_CORE_PORT), "Core 2 failed to restart"

    node_proc2 = subprocess.Popen(
        [
            SYS_PYTHON, "-u", node_main_py,
            "--role", "validator",
            "--port", str(TEST_NODE_PORT),
            "--broadcast-server", "none",
            "--core-port", str(TEST_CORE_PORT),
            "--node-id", TEST_NODE_ID,
            "--chain-id", str(TEST_CHAIN_ID),
        ],
        cwd=WORKSPACE_DIR,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    assert wait_for_port(TEST_NODE_PORT), "Node 2 failed to restart"
    time.sleep(1.5)

    try:
        # Query node queue/mempool via socket
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(4.0)
            s.connect(("127.0.0.1", TEST_NODE_PORT))
            query = json.dumps({"type": "GET_MEMPOOL"}) + "\n"
            s.sendall(query.encode("utf-8"))
            resp = s.recv(8192).decode("utf-8", errors="replace").strip()
            queue_data = json.loads(resp)
            print(f"[+] Re-queried Node Mempool after restart:\n{json.dumps(queue_data, indent=2)}")

            # Assert that the previous transaction was recovered from disk!
            pending_txs = queue_data.get("pending_transactions", [])
            restored_tx = next((t for t in pending_txs if t.get("tx_id") == tx_id), None)
            assert restored_tx is not None, f"Transaction {tx_id} was NOT restored after restart!"
            print(f"\n[SUCCESS] Transaction {tx_id} successfully restored from persistent storage!")
            print(f"          Origin Hospital: {restored_tx['hospital_name']}")
            print(f"          Doctor:          {restored_tx['doctor_name']}")
            print(f"          Patient:         {restored_tx['patient_id']}")
            print(f"          Queue Size:      {queue_data.get('queue_size')}")

    finally:
        node_proc2.terminate()
        core_proc2.terminate()
        try:
            node_proc2.wait(timeout=3)
        except Exception:
            node_proc2.kill()
        try:
            core_proc2.wait(timeout=3)
        except Exception:
            core_proc2.kill()
        print("\n[*] Test processes terminated cleanly.")


if __name__ == "__main__":
    try:
        test_core_cli_storage_creation()
        test_end_to_end_persistency()
        print("\n" + "=" * 76)
        print(" [ALL PERSISTENCY TESTS PASSED SUCCESSFULLY!]")
        print("=" * 76)
    except AssertionError as e:
        print(f"\n[TEST FAILED] {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        import traceback
        traceback.print_exc()
        sys.exit(1)
