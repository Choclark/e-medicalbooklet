#!/usr/bin/env python3
"""
Hospital Medical Booklet Access Request Client
==============================================
Sends a formal booklet access request from a hospital to a patient,
anchors it into the receiving validator node's transaction queue (mempool),
and receives the generated Transaction ID.
"""

import argparse
import json
import socket
import sys
import time

# Ensure instant terminal output without buffering
sys.stdout.reconfigure(line_buffering=True)


def send_access_request(
    node_host: str = "127.0.0.1",
    node_port: int = 8002,
    hospital_name: str = "Pulse Central Hospital",
    doctor_name: str = "Dr. Arthur Whitfield",
    patient_id: str = "patient-kamga-01",
    department: str = "Cardiology & Emergency",
    duration_hours: int = 4,
) -> dict:
    print("\n" + "=" * 76)
    print(" [HOSPITAL CLIENT] DISPATCHING BOOKLET ACCESS REQUEST")
    print("=" * 76)
    print(f" [+] Target Node      : {node_host}:{node_port}")
    print(f" [+] Hospital         : {hospital_name}")
    print(f" [+] Doctor           : {doctor_name} ({department})")
    print(f" [+] Target Patient   : {patient_id}")
    print(f" [+] Access Duration  : {duration_hours} Hours")
    print("=" * 76)

    payload = {
        "type": "HOSPITAL_ACCESS_REQUEST",
        "hospital_name": hospital_name,
        "doctor_name": doctor_name,
        "patient_id": patient_id,
        "department": department,
        "duration_hours": duration_hours,
        "scope": ["EHR_RECORDS", "PRESCRIPTIONS", "LAB_TESTS", "ALLERGIES"],
        "timestamp": time.time(),
    }

    candidate_hosts = [node_host]
    if "127.0.0.1" not in candidate_hosts:
        candidate_hosts.append("127.0.0.1")
    try:
        local_ip = socket.gethostbyname(socket.gethostname())
        if local_ip not in candidate_hosts:
            candidate_hosts.append(local_ip)
    except Exception:
        pass

    connected = False
    for host in candidate_hosts:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(4.0)
                print(f"[->] Connecting to Node at {host}:{node_port}...")
                s.connect((host, node_port))

                raw_req = json.dumps(payload) + "\n"
                s.sendall(raw_req.encode("utf-8"))
                print("[->] Request dispatched. Awaiting Transaction Receipt from Validator...")

                data = s.recv(4096)
                if not data:
                    print("[!] Node closed connection without receipt.")
                    return {}

                resp_str = data.decode("utf-8", errors="replace").strip()
                receipt = {}
                for line in resp_str.split("\n"):
                    try:
                        receipt = json.loads(line)
                        break
                    except json.JSONDecodeError:
                        continue

                connected = True
                print("\n" + "=" * 76)
                print(" [<-] TRANSACTION RECEIPT CONFIRMED BY NODE")
                print("=" * 76)
                print(f"  [TRANSACTION ID]  : {receipt.get('tx_id')}")
                print(f"  [STATUS]          : {receipt.get('status')} (In Mempool Queue)")
                print(f"  [QUEUE POSITION]  : #{receipt.get('queue_position')}")
                print(f"  [VALIDATOR NODE]  : {receipt.get('node_id')}")
                print(f"  [RECEIPT MSG]     : {receipt.get('message')}")
                print("=" * 76 + "\n")
                return receipt
        except Exception:
            continue

    print(f"[!] Could not connect to Validator Node on port {node_port} across candidate hosts {candidate_hosts}", file=sys.stderr)
    return {}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Send Hospital Access Request to Node"
    )
    parser.add_argument(
        "-p",
        "--port",
        type=int,
        default=8002,
        help="Target Validator/Node TCP socket port (default: 8002)",
    )
    parser.add_argument(
        "--host",
        type=str,
        default="127.0.0.1",
        help="Target Node host IP (default: 127.0.0.1)",
    )
    parser.add_argument(
        "--hospital",
        type=str,
        default="Pulse Central Hospital",
        help="Hospital Name (default: 'Pulse Central Hospital')",
    )
    parser.add_argument(
        "--doctor",
        type=str,
        default="Dr. Arthur Whitfield",
        help="Doctor / Requester Name (default: 'Dr. Arthur Whitfield')",
    )
    parser.add_argument(
        "--patient",
        type=str,
        default="patient-kamga-01",
        help="Patient Identifier (default: 'patient-kamga-01')",
    )
    parser.add_argument(
        "--department",
        type=str,
        default="Cardiology & Internal Medicine",
        help="Hospital Department (default: 'Cardiology & Internal Medicine')",
    )
    parser.add_argument(
        "--duration",
        type=int,
        default=4,
        help="Access duration in hours (default: 4)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    send_access_request(
        node_host=args.host,
        node_port=args.port,
        hospital_name=args.hospital,
        doctor_name=args.doctor,
        patient_id=args.patient,
        department=args.department,
        duration_hours=args.duration,
    )


if __name__ == "__main__":
    main()
