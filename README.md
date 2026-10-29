# E-Medical Booklet (Sovereign Medical Blockchain)

A decentralized, privacy-preserving, sovereign healthcare records blockchain network engineered with end-to-end cryptographic confidentiality, Shamir-based Key Management System (KSM) proxy re-encryption, Practical Byzantine Fault Tolerance (PBFT) consensus, and cold archival block storage.

---

## Architecture Overview

The system is architected across four tightly-coupled sovereign layers:

```
+-----------------------------------------------------------------------------------+
|                        Pulse Clinic Portal (Next.js 15)                           |
|   - Web Cryptography API: P-256 ECDSA signing, raw 64-byte SPKI coordination      |
|   - Patient-side zero-knowledge encryption: ECIES / ECDH + HKDF + AES-256-GCM     |
|   - Role portals: Patient, Doctor, Hospital, System Administrator                 |
+------------------------------------------+----------------------------------------+
                                           | WebSocket / JSON-RPC
                                           v
+-----------------------------------------------------------------------------------+
|                       Distributed Node Network (Python)                           |
|   - Client Gateway Node: Translates browser WebSocket frames to TCP P2P wire      |
|   - PBFT Consensus Engine: Pre-Prepare, Prepare, Commit 2/3+1 Quorum              |
|   - Dynamic P2P Broadcast Discovery Server & Failover Manager                     |
+------------------------------------------+----------------------------------------+
                                           | Localhost IPC Sockets
                     +---------------------+---------------------+
                     v                                           v
+-----------------------------------------+ +---------------------------------------+
|        C++ Blockchain Core Engine       | |       C++ Hospital KSM Daemons        |
|  - CBlock / CChain / Merkle Store       | |  - Shamir Secret Sharing over GF(256) |
|  - CConsensusRules & CPbftEngine        | |  - Threshold Distributed Key Gen (DKG)|
|  - CAccessControl / AccessManager       | |  - Proxy Re-Encryption (PRE) Capsules |
|  - CSqliteRecordDb & CArchiveManager    | |  - 4 Independent Hospital Daemons     |
+-----------------------------------------+ +---------------------------------------+
```

### Key Security & Consensus Highlights
1. **End-to-End Client Encryption**: All clinical records (diagnoses, prescriptions, test results, vaccinations) are encrypted in the patient's browser using AES-256-GCM with an ephemeral Data Encryption Key (DEK). The DEK is encapsulated via ECDH against the patient's public key. Plaintext never leaves the client boundary.
2. **On-Chain Consent Enforcement**: Access to patient records requires active on-chain consent stored in `CAccessControl/AccessManager`. Revocations (`REVOKE_CONSENT`) immediately block data access queries across all nodes.
3. **Threshold Proxy Re-Encryption (KMS PRE)**: Doctors requesting access receive re-encrypted key capsules produced cooperatively by hospital KSM nodes without reconstructing the patient's master private key.
4. **PBFT Consensus**: Blocks are committed across Byzantine-tolerant validator clusters requiring $2f + 1$ quorum signatures.
5. **Cold Archive Storage & On-Demand Restoration**: Historical rolled block files (`blkNNNNN.dat`) are pruned and compressed into tamper-evident `.medarch` archives with Merkle checkpoints and SHA-256 manifests, with instant on-demand restoration via `CArchiveManager`.

---

## Directory Structure

* `pulseclinic/` — Next.js 15 frontend application, React components, Tailwind styling, and WebCrypto stores.
* `node/` — Python distributed P2P node implementation, PBFT consensus, transaction pool, and client gateway.
* `blockchain-core/` — High-performance C++17 blockchain engine (consensus, storage, Merkle verification, access control).
* `ksm-core/` — C++17 Key Management System (GF(256) Shamir secret sharing, threshold DKG, proxy re-encryption daemons).
* `start-full-cluster.ps1` — One-click production cluster startup script.
* `stop_nodes.ps1` — Clean cluster shutdown script.
* `launch_nodes.ps1` / `launch_nodes.sh` — Configurable node launcher supporting single-node or multi-node clusters.
* `blockchain.conf` — Core memory budget, frame sizes, and consensus configuration.

---

## Getting Started

### Prerequisites
* **Windows 10/11** or **Linux**
* **CMake** (>= 3.15) & C++17 compiler (Visual Studio MSVC 2022 or GCC/Clang)
* **Python** (>= 3.10) with standard networking libraries
* **Node.js** (>= 18.0) and **npm**

---

### One-Command Full Stack Startup

To start the full 13-node cluster and launch the web portal in one command:

```powershell
.\start-full-cluster.ps1
```

This automatically initializes:
* 4 Standalone Hospital C++ KSM Daemons (ports `9101`–`9104`)
* 1 Broadcast Discovery Server (port `9000`)
* 5 PBFT Validator Nodes with dedicated C++ Core engines (ports `8001`–`8005`)
* 2 Storage Archive Nodes (ports `8021`–`8022`)
* 1 Client Node Gateway (WebSocket port `8765`, TCP port `8080`)
* Next.js Web Portal (`http://localhost:3000`)

To stop all background daemons and nodes:
```powershell
.\stop_nodes.ps1
```

---

### Automated End-to-End Verification

Run the full integration test suite verifying record encryption, PBFT consensus, on-chain consent enforcement, KSM PRE re-encryption, cold archiving, and on-demand block restoration:

```powershell
python node/test_e2e_pipeline.py
```

---

### Building C++ Binaries Manually

```powershell
cd blockchain-core
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release
```

The compiled executables will be placed in:
* `blockchain-core/build/Release/blockchain_core.exe`
* `blockchain-core/build/Release/ksm_core.exe`

---

## License

Confidential and Proprietary. All rights reserved.
