#!/usr/bin/env python3
"""
Key Escrow & Break-Glass Audit Storage
======================================
Provides local persistent SQLite storage for:
  1. Key Escrow Shares distributed across Validator, Archive, and KMS nodes.
  2. Permanent On-Chain / Node Break-Glass Audit Trails.
  3. Patient Emergency Alerts flagged for immediate delivery upon reconnect.
"""

import os
import sqlite3
import time
import json
from typing import Dict, List, Optional, Tuple


class EscrowStorage:
    """Manages SQLite persistence for emergency key escrow shares and audit trails."""

    def __init__(self, db_dir: str, node_id: str, node_role: str):
        self.node_id = node_id
        self.node_role = node_role.upper()
        self.db_dir = db_dir
        os.makedirs(self.db_dir, exist_ok=True)
        self.db_path = os.path.join(self.db_dir, "escrow.sqlite")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS key_escrow_shares (
                    escrow_id TEXT PRIMARY KEY,
                    patient_id TEXT NOT NULL,
                    emergency_public_key TEXT,
                    share_index INTEGER NOT NULL,
                    share_hex TEXT NOT NULL,
                    threshold_t INTEGER NOT NULL DEFAULT 2,
                    total_n INTEGER NOT NULL DEFAULT 3,
                    node_role TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'ESCROW_ACTIVE',
                    created_at INTEGER NOT NULL,
                    unlocked_at INTEGER,
                    unlocked_by_doctor TEXT,
                    reason TEXT
                )
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_escrow_patient
                ON key_escrow_shares (patient_id)
            """)

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS break_glass_audit_log (
                    break_glass_id TEXT PRIMARY KEY,
                    tx_id TEXT NOT NULL,
                    patient_id TEXT NOT NULL,
                    doctor_id TEXT NOT NULL,
                    doctor_name TEXT,
                    hospital_id TEXT NOT NULL,
                    reason TEXT NOT NULL,
                    escrow_quorum TEXT NOT NULL,
                    legal_audit_flag TEXT NOT NULL DEFAULT 'FLAGGED_FOR_LEGAL_AUDIT',
                    legal_audit_status TEXT NOT NULL DEFAULT 'PENDING_LEGAL_AUDIT_REVIEW',
                    patient_notified INTEGER NOT NULL DEFAULT 0,
                    block_height INTEGER DEFAULT 0,
                    timestamp INTEGER NOT NULL
                )
            """)

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS patient_alerts (
                    alert_id TEXT PRIMARY KEY,
                    patient_id TEXT NOT NULL,
                    alert_type TEXT NOT NULL,
                    message TEXT NOT NULL,
                    doctor_id TEXT NOT NULL,
                    hospital_id TEXT NOT NULL,
                    break_glass_id TEXT,
                    timestamp INTEGER NOT NULL,
                    acknowledged INTEGER NOT NULL DEFAULT 0
                )
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_alerts_patient
                ON patient_alerts (patient_id, acknowledged)
            """)
            conn.commit()

    # =========================================================================
    # ESCROW SHARE MANAGEMENT
    # =========================================================================

    def store_escrow_share(
        self,
        escrow_id: str,
        patient_id: str,
        share_index: int,
        share_hex: str,
        emergency_public_key: str = "",
        threshold_t: int = 2,
        total_n: int = 3,
        status: str = "ESCROW_ACTIVE",
    ) -> bool:
        """Store or update the emergency key share for a patient on this node."""
        now = int(time.time())
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT OR REPLACE INTO key_escrow_shares (
                    escrow_id, patient_id, emergency_public_key, share_index,
                    share_hex, threshold_t, total_n, node_role, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    escrow_id,
                    patient_id,
                    emergency_public_key,
                    share_index,
                    share_hex,
                    threshold_t,
                    total_n,
                    self.node_role,
                    status,
                    now,
                ),
            )
            conn.commit()
            return True

    def get_escrow_share(self, patient_id_or_escrow_id: str) -> Optional[Dict]:
        """Query stored escrow share by escrow_id or patient_id."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT * FROM key_escrow_shares
                WHERE escrow_id = ? OR patient_id = ?
                ORDER BY created_at DESC LIMIT 1
                """,
                (patient_id_or_escrow_id, patient_id_or_escrow_id),
            )
            row = cursor.fetchone()
            if row:
                return dict(row)
        return None

    def unlock_escrow_share(
        self,
        patient_id_or_escrow_id: str,
        doctor_id: str,
        reason: str,
    ) -> Optional[Dict]:
        """
        Unlock the escrow share upon verified emergency trigger ("Emergency: Patient Unconscious").
        Marks the share as UNLOCKED_EMERGENCY and records the accessing doctor and reason.
        """
        now = int(time.time())
        record = self.get_escrow_share(patient_id_or_escrow_id)
        if not record:
            return None

        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE key_escrow_shares
                SET status = 'UNLOCKED_EMERGENCY',
                    unlocked_at = ?,
                    unlocked_by_doctor = ?,
                    reason = ?
                WHERE escrow_id = ?
                """,
                (now, doctor_id, reason, record["escrow_id"]),
            )
            conn.commit()

        record["status"] = "UNLOCKED_EMERGENCY"
        record["unlocked_at"] = now
        record["unlocked_by_doctor"] = doctor_id
        record["reason"] = reason
        return record

    def list_all_escrows(self) -> List[Dict]:
        """Return all escrow records stored on this node."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM key_escrow_shares ORDER BY created_at DESC")
            return [dict(r) for r in cursor.fetchall()]

    # =========================================================================
    # BREAK-GLASS AUDIT LOG & LEGAL FLAGGING
    # =========================================================================

    def log_break_glass_event(
        self,
        break_glass_id: str,
        tx_id: str,
        patient_id: str,
        doctor_id: str,
        hospital_id: str,
        reason: str,
        escrow_quorum: List[str],
        doctor_name: str = "Authorized ER Physician",
        block_height: int = 0,
    ) -> Dict:
        """
        Permanently record a Break-Glass emergency override event in the audit ledger.
        Automatically flags the accessing physician for legal review.
        """
        now = int(time.time())
        quorum_str = ",".join(escrow_quorum)
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT OR REPLACE INTO break_glass_audit_log (
                    break_glass_id, tx_id, patient_id, doctor_id, doctor_name,
                    hospital_id, reason, escrow_quorum, legal_audit_flag,
                    legal_audit_status, patient_notified, block_height, timestamp
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'FLAGGED_FOR_LEGAL_AUDIT', 'PENDING_LEGAL_AUDIT_REVIEW', 0, ?, ?)
                """,
                (
                    break_glass_id,
                    tx_id,
                    patient_id,
                    doctor_id,
                    doctor_name,
                    hospital_id,
                    reason,
                    quorum_str,
                    block_height,
                    now,
                ),
            )
            conn.commit()

        # Enqueue patient alert immediately
        self.add_patient_alert(
            patient_id=patient_id,
            alert_type="CRITICAL_EMERGENCY_BREAK_GLASS",
            message=(
                f"CRITICAL SECURITY ALERT: Emergency Break-Glass access was triggered for your medical records "
                f"by Dr. {doctor_id} ({doctor_name}) at {hospital_id}. Declaration: '{reason}'. "
                f"Emergency keys unlocked via escrow quorum ({quorum_str}). This incident has been permanently "
                f"recorded on the blockchain (Block #{block_height}, Tx={tx_id}) and FLAGGED FOR LEGAL AUDIT."
            ),
            doctor_id=doctor_id,
            hospital_id=hospital_id,
            break_glass_id=break_glass_id,
        )

        return {
            "break_glass_id": break_glass_id,
            "tx_id": tx_id,
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "hospital_id": hospital_id,
            "reason": reason,
            "escrow_quorum": escrow_quorum,
            "legal_audit_flag": "FLAGGED_FOR_LEGAL_AUDIT",
            "legal_audit_status": "PENDING_LEGAL_AUDIT_REVIEW",
            "block_height": block_height,
            "timestamp": now,
        }

    def get_audit_logs(self, patient_id: Optional[str] = None) -> List[Dict]:
        """Fetch break-glass audit logs, optionally filtered by patient_id."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            if patient_id:
                cursor.execute(
                    "SELECT * FROM break_glass_audit_log WHERE patient_id = ? ORDER BY timestamp DESC",
                    (patient_id,),
                )
            else:
                cursor.execute("SELECT * FROM break_glass_audit_log ORDER BY timestamp DESC")
            return [dict(r) for r in cursor.fetchall()]

    # =========================================================================
    # PATIENT ALERTS (DELIVERED UPON RECONNECT)
    # =========================================================================

    def add_patient_alert(
        self,
        patient_id: str,
        alert_type: str,
        message: str,
        doctor_id: str,
        hospital_id: str,
        break_glass_id: Optional[str] = None,
    ) -> str:
        """Add an emergency alert for a patient to be received upon device reconnect."""
        import uuid
        alert_id = f"alert-{uuid.uuid4().hex[:8]}"
        now = int(time.time())
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO patient_alerts (
                    alert_id, patient_id, alert_type, message, doctor_id,
                    hospital_id, break_glass_id, timestamp, acknowledged
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
                """,
                (
                    alert_id,
                    patient_id,
                    alert_type,
                    message,
                    doctor_id,
                    hospital_id,
                    break_glass_id,
                    now,
                ),
            )
            conn.commit()
        return alert_id

    def get_pending_patient_alerts(self, patient_id: str) -> List[Dict]:
        """Retrieve unacknowledged alerts for patient when device connects."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT * FROM patient_alerts
                WHERE patient_id = ? AND acknowledged = 0
                ORDER BY timestamp DESC
                """,
                (patient_id,),
            )
            return [dict(r) for r in cursor.fetchall()]

    def acknowledge_alert(self, alert_id: str) -> bool:
        """Mark alert as acknowledged by patient."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE patient_alerts SET acknowledged = 1 WHERE alert_id = ?",
                (alert_id,),
            )
            conn.commit()
            return cursor.rowcount > 0
