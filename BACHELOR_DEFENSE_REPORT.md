# REPUBLIC OF CAMEROON &bull; THE ICT UNIVERSITY
### Faculty of Information and Communication Technology
**Department of Information Systems and Networking**

---

# BACHELOR DEGREE DEFENSE REPORT & TECHNICAL DOSSIER
**Degree:** Bachelor of Science in Information Systems and Networking (B.Sc. ISN)  
**Project Title:** **BLOCKCHAIN-BASED DIGITAL HEALTH CARNET: A Decentralized, Multi-Channel, Offline-First Health Records System with Threshold Cryptography (KSM) and Native C++/Python Core**  
**Academic Year:** 2025 / 2026  
**Supervision:** Department of ICT, The ICT University, Yaoundé, Cameroon  

---

## EXECUTIVE SUMMARY & ARCHITECTURAL PIVOT

### The Paradigm Shift: Why Hyperledger Fabric Was Abandoned
The initial academic proposal and preliminary dissertation draft conceived the *Digital Health Carnet* on top of **Hyperledger Fabric 3.x**. However, practical engineering and realistic deployment assessments in the context of Sub-Saharan Africa (specifically Cameroon) revealed critical systemic flaws that rendered Hyperledger Fabric unviable for real-world clinic infrastructure:

| Evaluation Metric | Hyperledger Fabric 3.x (Legacy Theoretical Proposal) | Custom Native C++ / Python Architecture (Implemented Reality) |
| :--- | :--- | :--- |
| **System Footprint & Overhead** | Extremely heavy: JVM, Docker containers, Go runtime, Raft ordering cluster. Requires $\ge 16\text{ GB}$ RAM per peer node. | Ultra-lightweight: Native compiled C++20 core with deterministic memory bounds ($\le 50\text{ MB}$ base; configurable LRU RAM buffers). |
| **Infrastructure Viability** | Unsuited for sub-prefectural or rural Cameroonian clinics lacking dedicated server racks or high-speed fiber. | Runs efficiently on low-spec edge hospital laptops, local clinic mini-PCs, or embedded Linux/Raspberry Pi appliances. |
| **Data Privacy & Key Control** | Off-chain data storage and basic MSP/TLS. Lacks native threshold encryption at the data-record layer. | Native **Threshold Key Management Service (`ksm-core`)** using **Shamir's Secret Sharing over $\text{GF}(2^8)$** with $(3, 4)$ threshold quorums. |
| **Channel Partitioning** | Complex channel configuration via cryptogen, configtxgen, and heavy containerized orderers. | Native **Multi-Channel Vector Architecture (`CChannelManager`)** managing distinct deterministic chains (`std::vector<CChain>`). |
| **Data Immutability vs. Editing** | Reliance on CouchDB state updates that overwrite key values in state databases without clear dual-sign audit history. | **Strict Blockchain Immutability**: Historical blocks are never modified. Edits/Soft-deletes create new forward blocks with display filtering. |
| **Edge Interoperability** | Complex client SDKs (Fabric Gateway Node/Java/Go) with high latency and complex TLS handshakes. | Dual-tier architecture: High-speed **C++ Core Engine** bridged via **Protobuf/gRPC** to an asynchronous **Python P2P Node Network** and **Next.js Web Portal**. |

This defense report outlines the complete architectural design, mathematical foundations, UML specifications, implementation artifacts, and defense strategy for this engineered solution.

---

## 1. PROBLEM STATEMENT & SUB-SAHARAN CONTEXT

### 1.1 The Failure of the Physical "Carnet de Santé"
In Cameroon, the physical paper booklet (*Carnet de Santé*) has served as the universal patient record for decades. Its fundamental deficiencies include:
1. **Physical Loss and Deterioration:** Booklets are frequently lost, water-damaged, or torn, obliterating critical medical history (allergies, vaccination records, surgical notes).
2. **Fragmentation Across Hospitals:** A patient visiting Yaoundé Central Hospital, Laquintinie Hospital in Douala, and a district clinic in Bafoussam holds disjointed records across different physical booklets.
3. **Medical Fraud & Impersonation:** Illegitimate practitioners forge paper stamps and prescribe medications without verifiable credentials.
4. **Emergency Paralysis:** Unconscious emergency patients arrive without family or booklets, leaving clinicians with zero visibility into blood types, chronic pathologies, or medication contraindications.

### 1.2 Connectivity Challenges & The Edge Imperative
Unlike Western healthcare systems with ubiquitous cloud connectivity, Sub-Saharan district facilities face frequent power outages and intermittent WAN connectivity. Healthcare IT systems must be **offline-first**:
* District clinics must record consultations, issue prescriptions, and register patients locally.
* When connectivity resumes, local transactions must deterministically synchronize, resolve, and anchor into the consensus ledger without data loss or split-brain states.

---

## 2. MATHEMATICAL & CRYPTOGRAPHIC FOUNDATIONS

The implemented platform is founded upon three rigorous cryptographic pillars:

```
+-----------------------------------------------------------------------------------+
|                        CRYPTOGRAPHIC PILLARS OF THE SYSTEM                        |
+-----------------------------------------------------------------------------------+
|  1. NIST P-256 (secp256r1) ECDSA Dual Co-Signing (Doctor + Patient)              |
|  2. Shamir's Secret Sharing (SSS) over Galois Field GF(2^8) (3-of-4 DEK Threshold)|
|  3. SHA-256 Merkle Inclusion Proofs with LRU Disk-Buffered Trees                  |
+-----------------------------------------------------------------------------------+
```

### 2.1 Shamir's Secret Sharing over Galois Field $\text{GF}(2^8)$
To guarantee that neither a single rogue hospital nor an eavesdropper can compromise patient privacy, medical Data Encryption Keys (DEKs) are never stored in one piece. Instead, every clinical record is encrypted with a symmetric 256-bit AES-GCM key, and this key is split across $n$ authorized hospital nodes using a $(k, n)$ threshold scheme over the Galois Field $\text{GF}(2^8)$ with irreducible polynomial:
$$P(x) = x^8 + x^4 + x^3 + x + 1 \quad (\text{0x11B})$$

For a threshold $k = 3$ and cluster size $n = 4$:
1. A random polynomial $f(x)$ of degree $k - 1 = 2$ is constructed:
   $$f(x) = a_0 + a_1 x + a_2 x^2 \pmod{P(x)}$$
   where $a_0 = S$ is the secret key byte, and $a_1, a_2 \in \text{GF}(2^8)$ are cryptographically secure random coefficients.
2. Each hospital $i \in \{1, 2, 3, 4\}$ receives share $(x_i, f(x_i))$.
3. Reconstructing the secret requires any $k = 3$ hospital shares via **Lagrange Interpolation**:
   $$S = f(0) = \sum_{j=1}^{k} y_j \prod_{\substack{m=1 \\ m \neq j}}^{k} \frac{0 - x_m}{x_j - x_m} \pmod{P(x)}$$
4. **Information-Theoretic Security:** Any subset of $k - 1 = 2$ shares reveals **zero** information regarding $S$.

### 2.2 Dual-Actor NIST P-256 ECDSA Co-Signing
No medical record can be committed unilaterally. The system enforces cryptographic co-signing:
* **Doctor Signature:** $\sigma_{\text{doc}} = \text{Sign}_{SK_{\text{doc}}}(H(\text{RecordPayload}))$
* **Patient Signature:** $\sigma_{\text{pat}} = \text{Sign}_{SK_{\text{pat}}}(H(\text{RecordPayload}))$
The C++ Core validates both signatures against on-chain public keys registered in Channel 1 before accepting the transaction into the mempool.

### 2.3 Merkle Inclusion Proofs with Deterministic Audit Trails
Each block computes a Merkle root over its transactions. A client edge node (e.g., patient phone or rural clinic tablet) verifies the inclusion of transaction $T_i$ without downloading the entire blockchain by checking the logarithmic audit path:
$$\text{Root} \stackrel{?}{=} H(\dots H(H(T_i, S_1), S_2) \dots)$$
where $S_k$ are sibling hashes cached in the C++ `CMerkleStore`.

---

## 3. SYSTEM ARCHITECTURE & DESIGN

```mermaid
flowchart TB
    subgraph Client_Layer ["Client & Clinical Interface Layer"]
        UI["Next.js Web Portal (Tailwind / TypeScript)"]
        EdgeApp["Offline Edge Client / Mobile Tablet"]
    end

    subgraph Node_Layer ["Distributed Python P2P Node Network"]
        API["Node API Server (REST / WebSockets)"]
        P2P["P2P TCP Socket Mesh & Gossip Engine"]
        
        subgraph Node_Roles ["Node Topologies"]
            VNode["Validator Nodes (PBFT Quorum)"]
            FNode["Full Nodes (State Synchronizers)"]
            ANode["Archive Nodes (Deep Audit Ledger)"]
            CNode["Client Edge Nodes (Local Cache)"]
        end
    end

    subgraph Bridge_Layer ["High-Performance IPC Bridge"]
        gRPC["Protobuf / gRPC IPC Bridge (Port 50055)"]
    end

    subgraph Core_Layer ["Native C++20 Blockchain Engine (blockchain-core)"]
        direction TB
        CCManager["CChannelManager (Multi-Channel Vector)"]
        
        subgraph Multi_Channel ["Multi-Channel Vector (std::vector&lt;CChain&gt;)"]
            Ch0["Channel 0: Medical Records Ledger\n(EHR, Prescriptions, Lab Tests)"]
            Ch1["Channel 1: Identity & Credentials Ledger\n(Doctors, Patients, Medical Boards)"]
        end

        PBFT["CPbftEngine\n(Consensus & Commit Proofs)"]
        MStore["CMerkleStore & CMerkleTree\n(LRU Cache + Disk Spillover)"]
        Storage["Hybrid Record Storage Engine\n(CSqliteRecordDb + CCouchDbRecordDb)"]
        BStore["CBlockStore & CFile\n(Append-Only Raw Block Storage)"]
    end

    subgraph KSM_Layer ["Threshold Key Management Service (ksm-core)"]
        DkgCluster["CKsm::KsmCluster\n(3-of-4 SSS Quorum Engine)"]
        Galois["GF(2^8) Galois Field Arithmetic"]
        AesCipher["AES-256-GCM Envelope Encryption"]
        JoinProto["KsmDynamicJoinProtocol\n(Historical Share Derivation)"]
    end

    UI -->|HTTP / JSON| API
    EdgeApp -->|TCP| P2P
    API --> P2P
    P2P --> VNode & FNode & ANode & CNode
    VNode & FNode & ANode & CNode -->|gRPC Calls| gRPC
    gRPC --> CCManager
    CCManager --> Ch0 & Ch1
    Ch0 & Ch1 --> PBFT
    Ch0 & Ch1 --> MStore
    Ch0 & Ch1 --> Storage
    Ch0 & Ch1 --> BStore
    Ch0 -.->|Cross-Channel Identity Check| Ch1
    Ch0 -->|Threshold Key Quorum| DkgCluster
    DkgCluster --> Galois & AesCipher & JoinProto
```

### 3.1 Multi-Channel Vector Architecture
Instead of maintaining a single monolithic blockchain, the C++ Core employs a vector of independent blockchain instances (`std::vector<CChain>`):
* **Channel 0 (Medical Record Chain):** Stores encrypted clinical records, diagnoses, prescriptions, and lab results.
* **Channel 1 (Identity & Credential Chain):** Stores cryptographically certified public keys, medical board licenses, hospital affiliations, and account revocation status.
* **Cross-Channel Enforcement:** Before `CrudManager` accepts any medical creation, edit, or deletion on Channel 0, it interrogates Channel 1 to verify that:
  1. The doctor's public key is active and not revoked/deregistered.
  2. The patient's identity is registered.
  3. The hospital authorization credentials match.

---

## 4. DETAILED UML MODELING

### 4.1 UML Class Diagram: C++ Core Architecture

```mermaid
classDiagram
    class CChannelManager {
        -std::vector~CChain~ m_channels
        -std::vector~std::string~ m_channelNames
        -std::string m_configFile
        -std::string m_baseDataDir
        +size_t getChannelCount()
        +CChain& getChannel(size_t index)
        +CChain& getMainChain()
        +CChain& getRegistrationChain()
        +std::string registerDoctor(DoctorRegistrationRequest req, string& txId, string& err)
        +std::string registerPatient(PatientRegistrationRequest req, string& txId, string& err)
        +bool isDoctorActive(string doctorId)
        +bool isPatientActive(string patientId)
        +bool deregisterDoctor(...)
    }

    class CChain {
        -uint32_t m_channelId
        -std::string m_channelName
        -CBlockStore m_blockStore
        -CMerkleStore m_merkleStore
        -IRecordDatabase* m_recordDb
        -CPbftEngine m_pbftEngine
        -std::vector~COnChainTxRecord~ m_mempool
        +uint64_t getChainHeight()
        +CBlock proposeBlock(string proposerId)
        +bool commitBlock(CBlock block)
        +bool submitTransaction(COnChainTxRecord tx)
    }

    class CBlock {
        -BlockHeader m_header
        -std::vector~COnChainTxRecord~ m_transactions
        +calculateHeaderHash() string
        +computeMerkleRoot() string
        +finalizeBlock() void
        +BlockHeader getHeader()
        +vector~COnChainTxRecord~ getTransactions()
    }

    class CPbftEngine {
        -std::vector~std::string~ m_validators
        -uint32_t m_viewNumber
        -uint32_t m_quorumCount
        +string getPrimaryNode()
        +ConsensusMetadata createCommitProof(uint64_t seq, string blockHash)
        +bool verifyCommitProof(ConsensusMetadata meta, string blockHash)
    }

    class CrudManager {
        -CChain& m_chain
        -KsmCluster& m_ksmCluster
        -CChannelManager* m_channelManager
        +string createRecord(CreateRecordRequest req, string& txId, string& err)
        +QueryRecordResponse queryRecord(QueryRecordRequest req)
        +bool editRecord(EditRecordRequest req, string& txId, string& err)
        +bool deleteRecord(DeleteRecordRequest req, string& txId, string& err)
    }

    class KsmCluster {
        -uint32_t m_thresholdT
        -uint32_t m_totalN
        -std::map~string, unique_ptr~KsmNode~~ m_nodes
        +void registerNode(string nodeId, uint8_t shareIndex)
        +EncryptedTxEnvelope encryptRecord(...)
        +map~string, string~ decryptRecord(EncryptedTxEnvelope env, vector~string~ quorumNodes)
    }

    class ShamirSecretSharing {
        +vector~KeyShare~ splitSecret(vector~uint8_t~ secret, uint32_t t, uint32_t n, uint8_t epoch)
        +vector~uint8_t~ reconstructSecret(vector~KeyShare~ shares, uint32_t t)
        +static bool verifyHash(vector~uint8_t~ secret, string expectedSha256)
    }

    CChannelManager "1" *-- "2..*" CChain : holds vector of
    CChain "1" *-- "1" CPbftEngine : consensus validation
    CChain "1" *-- "1" CBlock : commits sequential
    CrudManager ..> CChannelManager : cross-channel query
    CrudManager ..> CChain : operates on
    CrudManager ..> KsmCluster : threshold encryption
    KsmCluster ..> ShamirSecretSharing : polynomial splitting
```

---

### 4.2 UML Sequence Diagram: Clinical Record Creation & Threshold Encryption

```mermaid
sequenceDiagram
    autonumber
    actor Doctor as Attending Doctor
    actor Patient as Patient (Alice)
    participant UI as Next.js Web Interface
    participant Node as Python Client Node
    participant Core as C++ Blockchain Core (Channel 0)
    participant RegCh as Channel 1 (Registration Chain)
    participant KSM as KSM Cluster (3-of-4 SSS)
    participant PBFT as PBFT Validator Quorum

    Doctor->>UI: Enter Clinical Notes & Prescription
    Patient->>UI: Co-Sign with Private Key (NIST P-256)
    Doctor->>UI: Co-Sign with Private Key (NIST P-256)
    UI->>Node: POST /api/transactions (co-signed payload)
    Node->>Core: gRPC submitTransaction(Channel 0, payload)
    
    Core->>RegCh: Verify Doctor Status (DOC-7842)
    RegCh-->>Core: Active (License Valid, Board Approved)
    Core->>RegCh: Verify Patient Status (PAT-9942)
    RegCh-->>Core: Active (Patient Registered)

    Core->>KSM: Request Threshold DEK Generation & Encryption
    KSM->>KSM: Generate random 256-bit AES-GCM Key (DEK)
    KSM->>KSM: Split DEK via SSS over GF(2^8) (3-of-4)
    KSM->>KSM: Persist shares across Hospital SQLite Stores {A, B, C, D}
    KSM-->>Core: Return Encrypted Envelope (Metadata + Ciphertext)

    Core->>PBFT: Propose New Block #1 with Encrypted Tx
    PBFT->>PBFT: Pre-Prepare -> Prepare -> Commit (2f+1 signatures)
    PBFT-->>Core: Commit Certificate Generated
    Core->>Core: Commit Block #1 to CBlockStore & Update SQLite State
    Core-->>Node: Commit Ack (Block #1, TxId, Merkle Root)
    Node-->>UI: Real-Time Confirmation with Merkle Proof
```

---

### 4.3 UML Sequence Diagram: Cross-Channel Revocation Enforcement

```mermaid
sequenceDiagram
    autonumber
    actor Board as Medical Board / Authority
    participant RegCh as Channel 1 (Registration Chain)
    actor RogueDoc as Revoked Doctor
    participant MainCh as Channel 0 (Medical Record Chain)

    Board->>RegCh: Submit Doctor Deregistration (Revoke License DOC-7842)
    RegCh->>RegCh: Commit Deregistration Transaction to Block #3
    RegCh->>RegCh: Update Local State: Doctor DOC-7842 = REVOKED / INACTIVE

    Note over RogueDoc, MainCh: Rogue Doctor attempts unauthorized consultation record
    RogueDoc->>MainCh: Submit CREATE_EHR_RECORD for Patient Alice
    MainCh->>RegCh: Interrogate isDoctorActive("DOC-7842")
    RegCh-->>MainCh: FALSE (Doctor is Revoked / Inactive)
    
    MainCh-->>RogueDoc: REJECTED: Doctor not authorized in Channel 1 Registry!
    Note over MainCh: Security Law Enforced: Zero-Trust Cross-Channel Boundary
```

---

### 4.4 UML Sequence Diagram: Dynamic Join Protocol & Catch-Up Synchronization

```mermaid
sequenceDiagram
    autonumber
    participant HospE as Incoming Hospital Node (Hospital E)
    participant JoinProto as KsmDynamicJoinProtocol
    participant Quorum as KSM Quorum Nodes {A, B, C}
    participant DB as Hospital E Local SQLite DB

    HospE->>JoinProto: Submit JoinRequest (nodeId="HOSPITAL_E", preferredIndex=5)
    JoinProto->>Quorum: Verify Authority Credentials & Request Approval
    Quorum-->>JoinProto: Quorum Approved (3-of-4 Signatures)
    JoinProto-->>HospE: JoinApproved (assignedShareIndex=5, Epoch=2)

    Note over HospE, Quorum: Catch-Up State Synchronization for Historical Transactions
    HospE->>JoinProto: Request Historical Shares Sync
    JoinProto->>Quorum: Collect 3 existing shares for historical TxId
    Quorum-->>JoinProto: Return Shares {A(x=1), B(x=2), C(x=3)}
    JoinProto->>JoinProto: Lagrange Interpolation at x=5 over GF(2^8)
    JoinProto->>DB: Store Derived Share (x=5) for Historical TxId
    JoinProto-->>HospE: Sync Complete (100% Historical Parity)
    
    Note over HospE: Hospital E is now fully capable of participating in threshold decryptions!
```

---

## 5. IMMUTABILITY, SOFT-DELETION, AND DISPLAY FILTERING

A fundamental question raised in healthcare blockchain defenses is:  
> *"If a medical record was written in error, or a patient invokes their legal Right to Erasure (GDPR Art. 17 / Data Protection regulations), how can an immutable blockchain accommodate this without corrupting cryptographic hashes?"*

### The Architectural Solution
1. **Never Overwrite Historical Blocks:** In this implementation, historical blocks (`Block #1`, `Block #2`) are **strictly read-only** on disk. Their SHA-256 header hashes and Merkle roots remain unchanged forever.
2. **Forward State Anchoring:** When an edit or deletion occurs:
   * A new transaction schema (`EDIT_EHR_RECORD` or `DELETE_EHR_RECORD`) is submitted.
   * Both the attending physician and patient must co-sign the deletion or modification request.
   * A **new block** is mined (e.g., `Block #3`) containing this deletion transaction.
3. **Display Filtering vs. Audit Trail:**
   * **Active Clinical View:** When a clinician queries the patient carnet (`includeDeleted = false`), the SQLite state engine filters out soft-deleted records.
   * **Forensic Audit View:** When a medical-legal inquiry or court requests the record history (`includeDeleted = true`), the system retrieves the entire cryptographic lineage: the initial record at `Block #1`, the edit at `Block #2`, and the soft-deletion at `Block #3` with the authorizer's digital signature and timestamp.

---

## 6. MULTI-TIER PYTHON P2P NODE NETWORK & gRPC IPC

The system decouples the compute-heavy, consensus-critical blockchain engine from the distributed networking layer:

```
+-----------------------------------------------------------------------------------+
|                            MULTI-ROLE NODE TOPOLOGY                               |
+-----------------------------------------------------------------------------------+
|  1. VALIDATOR NODES (FullNode):                                                   |
|     - Run PBFT consensus rounds; propose and mine new blocks.                    |
|     - Maintain full Channel 0 & Channel 1 state; hold KSM key shares.             |
|                                                                                   |
|  2. FULL NODES (FullNode):                                                        |
|     - Synchronize all blocks and state; validate transactions.                    |
|     - Serve read/query traffic to localized hospital clients.                    |
|                                                                                   |
|  3. ARCHIVE NODES (ArchiveNode):                                                  |
|     - Deep cold-storage archival nodes.                                           |
|     - Audit historical chain integrity, Merkle consistency, and state proofs.    |
|                                                                                   |
|  4. CLIENT EDGE NODES (ClientNode):                                               |
|     - Lightweight edge installations for clinic tablets or mobile carnet apps.    |
|     - Submit transactions; verify Merkle proofs locally; restricted channels.     |
+-----------------------------------------------------------------------------------+
```

### IPC Bridge Protocol (`blockchain_core.proto`)
The Python daemon interacts with the C++ executable via high-speed gRPC over TCP port `50055`. Key service endpoints include:
* `SubmitTransaction(TransactionRequest) returns (TransactionResponse)`
* `ProposeBlock(ProposeBlockRequest) returns (ProposeBlockResponse)`
* `QueryRecord(RecordQueryRequest) returns (RecordQueryResponse)`
* `VerifyMerkleProof(MerkleProofRequest) returns (MerkleProofResponse)`
* `SynchronizeConfig(ConfigSyncRequest) returns (ConfigSyncResponse)`

---

## 7. SYSTEM VALIDATION, TEST HARNESS & EMPIRICAL FINDINGS

The implementation was validated using end-to-end multi-phase automated integration suites in both C++ and Python:

```
+-------------------------------------------------------------------------------------------------------+
| PHASE | TEST DESCRIPTION                              | STATUS | EMPIRICAL OBSERVATION                |
+-------+-----------------------------------------------+--------+--------------------------------------+
| 1     | NIST P-256 Keypair Generation                 | PASS   | Generated in < 1.2ms per pair        |
| 2     | Vector Multi-Channel Initialization           | PASS   | 2 channels active; genesis verified  |
| 3     | Channel 1 Doctor & Patient Registration       | PASS   | Registered and indexed in Block #1   |
| 4     | Merkle Inclusion Proofs on Registration       | PASS   | 100% proof verification on Channel 1 |
| 5     | Unregistered Doctor Rejection Law             | PASS   | Unauthorized doctor rejected by Ch0  |
| 6     | Dual Co-Signed Clinical Record (Channel 0)    | PASS   | Co-signed, encrypted, Block #1 mined |
| 7     | 3-of-4 SSS DEK Recovery & Decryption          | PASS   | Exact plaintext recovery across sets |
| 8     | Threshold Security (2 Shares Provided)       | PASS   | Correctly thrown: 0 bytes leaked     |
| 9     | Clinical Record Edit (Anchor in Block #2)     | PASS   | Block #1 untouched; Block #2 linked  |
| 10    | Soft-Delete & Display Filtering (Block #3)    | PASS   | Hidden on standard query; audit pass |
| 11    | Channel 1 Doctor Deregistration (Block #3)    | PASS   | Status set to INACTIVE / REVOKED     |
| 12    | Post-Deregistration Lockout on Channel 0      | PASS   | Revoked doctor immediately barred    |
| 13    | Dynamic Join: Hospital E Historical Derivation| PASS   | Derived share x=5 decrypts past Txs  |
| 14    | Python P2P Mesh Gossip & Block Propagation    | PASS   | 4 nodes interconnected; gossip synced|
+-------------------------------------------------------------------------------------------------------+
```

---

## 8. BACHELOR DEFENSE ORAL PRESENTATION BLUEPRINT

### 8.1 20-Minute Defense Timing Breakdown
* **Minutes 00:00 &ndash; 03:00:** Introduction, Problem Statement, Context of Cameroon, and Limitations of Physical Carnets.
* **Minutes 03:00 &ndash; 06:00:** The Architectural Pivot: Why Hyperledger Fabric was abandoned in favor of a bespoke C++/Python architecture.
* **Minutes 06:00 &ndash; 11:00:** System Architecture: Multi-Channel Vector, PBFT Consensus, and Threshold KSM Scheme over $\text{GF}(2^8)$.
* **Minutes 11:00 &ndash; 15:00:** Implementation Walkthrough, UML Diagrams, Immutability via Forward Anchoring, and Cross-Channel Security.
* **Minutes 15:00 &ndash; 18:00:** Demonstration of Results, Test Harness Findings, and Comparative Performance.
* **Minutes 18:00 &ndash; 20:00:** Conclusion, Recommendations for Cameroon Ministry of Public Health (MINSANTE), and Future Work.

---

### 8.2 Slide-by-Slide Defense Presentation Guide

#### Slide 1: Title & Candidacy
* **Title:** Blockchain-Based Digital Health Carnet: A Decentralized, Multi-Channel, Offline-First Health Records System
* **Candidate:** Bachelor of Science in Information Systems and Networking, The ICT University
* **Talking Points:** Greet the jury; introduce the project's core mission: giving every Cameroonian citizen sovereign, tamper-proof, and accessible digital health records.

#### Slide 2: The Healthcare Crisis in Cameroon
* **Visuals:** Photo of torn/lost paper *Carnet de Santé*; flowchart of fragmented records between regional hospitals.
* **Talking Points:** Patients carry physical booklets that get destroyed; doctors in emergency rooms treat patients blindly without knowing blood types or allergies; fraud and forged doctor stamps are rampant.

#### Slide 3: The Architectural Pivot: Leaving Hyperledger Fabric
* **Visuals:** Comparison table showing Hyperledger Fabric overhead vs. Custom Native C++ Core.
* **Talking Points:** Address the dissertation draft head-on: "We initially explored Hyperledger Fabric, but found it fundamentally mismatched with African reality. Requiring 16GB RAM server nodes and complex container clusters does not work in local Cameroonian clinics. We engineered a native C++20 core that runs with minimal memory footprint and native threshold key cryptography."

#### Slide 4: High-Level System Architecture
* **Visuals:** System Architecture Diagram showing Next.js UI $\rightarrow$ Python P2P Node Network $\rightarrow$ gRPC $\rightarrow$ Native C++ Core $\rightarrow$ KSM Cluster.
* **Talking Points:** Walk through the clean separation of concerns: Presentation (Next.js), Networking and Topology (Python P2P), Consensus and Ledger Core (C++), and Threshold Key Management (KSM).

#### Slide 5: The Multi-Channel Vector Architecture
* **Visuals:** Diagram showing Channel 0 (Medical Records) and Channel 1 (Identity & Registration) running in parallel.
* **Talking Points:** Explain why channels are separated: patient medical data should not be mingled with doctor licensing credentials. Detail cross-channel verification: Channel 0 interrogates Channel 1 to verify doctor accreditation in real-time.

#### Slide 6: Cryptographic Pillar 1: Shamir's Secret Sharing over $\text{GF}(2^8)$
* **Visuals:** Mathematical formulas of polynomial $f(x)$ in $\text{GF}(2^8)$ and Lagrange reconstruction; 3-of-4 hospital threshold diagram.
* **Talking Points:** No single hospital holds the master decryption key. The DEK is split into 4 polynomial shares. Any 3 hospitals (e.g., Yaoundé General, Douala Laquintinie, CNPS) can collaborate to decrypt in emergencies; 2 shares reveal mathematically zero information.

#### Slide 7: Cryptographic Pillar 2: Dual-Actor NIST P-256 Co-Signing
* **Visuals:** Co-signature workflow diagram (Doctor Key + Patient Key $\rightarrow$ SHA-256 payload $\rightarrow$ C++ Verifier).
* **Talking Points:** Doctors cannot inject fraudulent records without patient consent; patients cannot forge medical evaluations without a licensed doctor's private key.

#### Slide 8: Solving the Immutability Paradox: Soft-Deletes & Edits
* **Visuals:** Sequential block diagram (Block #1 Created $\rightarrow$ Block #2 Edited $\rightarrow$ Block #3 Soft-Deleted).
* **Talking Points:** How do we comply with medical record corrections and privacy laws? Past blocks are never touched. Edits and soft-deletes are committed as new transactions in forward blocks. Display filtering hides deleted records from regular clinic views while preserving complete forensic auditability.

#### Slide 9: Dynamic Node Onboarding & Historical Catch-Up
* **Visuals:** Sequence diagram of Hospital E joining dynamically at Epoch 2.
* **Talking Points:** When a new regional hospital opens in Cameroon, how does it join? The dynamic join protocol derives its historical share at coordinate $x=5$ using existing quorum nodes without exposing the master key.

#### Slide 10: Multi-Role Python P2P Node Network
* **Visuals:** Network topology diagram showing Validator Nodes, Full Nodes, Archive Nodes, and Client Nodes.
* **Talking Points:** Different healthcare facilities have different hardware capacities. Referral hospitals run PBFT Validator nodes; local clinics run lightweight Client nodes with local SQLite caching.

#### Slide 11: Experimental Findings & Verification
* **Visuals:** Terminal logs and test execution matrix (14/14 test phases passing 100%).
* **Talking Points:** Review empirical proof: sub-millisecond cryptographic signing, zero information leakage under $(k-1)$ shares, immediate cross-channel revocation enforcement, and successful P2P gossip.

#### Slide 12: Recommendations for Cameroon & MINSANTE
* **Visuals:** Roadmap for national deployment across the 10 Regions of Cameroon.
* **Talking Points:** Phased pilot starting with regional hospitals; deployment of offline edge nodes in rural health centers; national health ID card integration with QR public keys.

#### Slide 13: Conclusion & Acknowledgments
* **Visuals:** Summary slide with key takeaways; open invitation for jury questions.
* **Talking Points:** Summarize achievements: a fully engineered, sovereign, decentralized, and African-adapted digital health carnet. Thank the supervisor and jury.

---

## 9. ORAL DEFENSE JURY Q&A MASTERCLASS

Prepare for the following rigorous technical and contextual questions commonly asked by academic defense juries:

### Q1: "Why did you discard Hyperledger Fabric when it is the enterprise standard for healthcare blockchain?"
> **Candidate Answer:**  
> "Hyperledger Fabric is indeed widely cited in theoretical literature, but practical systems engineering requires evaluating deployment constraints. Fabric requires multiple Docker containers per peer, a Java/Go runtime, a heavy Raft ordering service, and at least 8 to 16 GB of RAM per node. In Cameroonian district health centers (Centre Médical d’Arrondissement), IT infrastructure consists of standard desktop computers or laptops with intermittent power and bandwidth.  
> Furthermore, Fabric does not natively offer mathematical threshold key splitting at the data-record layer. By designing and compiling a custom C++20 engine with a multi-channel vector and a Shamir Secret Sharing KSM cluster over $\text{GF}(2^8)$, our system runs within 50 MB of base RAM, provides deterministic memory management via LRU cache budgets, and delivers information-theoretic threshold privacy tailored directly to the operational realities of Cameroon."

---

### Q2: "In Shamir's Secret Sharing, if 3 hospital nodes reconstruct the key, doesn't the reconstructing node learn the key?"
> **Candidate Answer:**  
> "That is an astute observation regarding basic Shamir Secret Sharing. In our architecture, reconstruction occurs ephemerally inside the secure memory space of the authorized querying node for that specific consultation session. The recovered key is never committed to persistent storage.  
> Moreover, the request itself requires an on-chain purpose specification and audit logging co-signed by the patient. In future extensions, this can be transitioned to Threshold Secure Multi-Party Computation (SMPC) or Zero-Knowledge Decryption where the plaintext is decrypted without any single entity holding the reconstructed key."

---

### Q3: "What consensus mechanism does your platform use, and why is it better than Proof of Work or Proof of Stake for healthcare?"
> **Candidate Answer:**  
> "Our platform uses Practical Byzantine Fault Tolerance (PBFT) implemented in `CPbftEngine`.  
> Proof of Work is completely unacceptable for healthcare due to its massive computational waste, non-deterministic finality (probabilistic forks), and high latency.  
> Proof of Stake introduces plutocratic incentives unsuited for public sovereign health data.  
> Healthcare consortiums operate in a permissioned federated environment where validator identities are known (accredited regional hospitals and the Ministry of Health). PBFT provides immediate, absolute transaction finality (zero forking), high throughput ($\ge 1,000\text{ TPS}$), and tolerates up to $f = \lfloor(N-1)/3\rfloor$ Byzantine or malicious nodes. For our 4-node initial quorum, the system operates securely with full consensus even if 1 hospital is completely offline or compromised."

---

### Q4: "How does your system enforce GDPR / Data Protection 'Right to Erasure' if the blockchain is immutable?"
> **Candidate Answer:**  
> "We resolve this apparent contradiction through architectural schema partitioning and forward state anchoring:  
> 1. Raw, plaintext medical data is **never** written on the blockchain ledger. Only encrypted ciphertext envelopes and cryptographic hashes reside on-chain.  
> 2. When a record deletion is authorized, an authenticated `DELETE_RECORD` transaction is committed to the blockchain in a new block.  
> 3. The underlying state database (`CSqliteRecordDb`) marks the record as soft-deleted and filters it out from all active clinical displays.  
> 4. Additionally, by permanently destroying or revoking the corresponding KSM key share coordinates for that record's DEK, the on-chain ciphertext becomes cryptographically permanently unreadable (crypto-shredding), fulfilling the legal standard for digital erasure while preserving the cryptographic continuity of the blockchain."

---

### Q5: "How does the system operate when a rural clinic is completely offline without internet connectivity?"
> **Candidate Answer:**  
> "Our architecture is offline-first. A rural clinic operates a local `ClientNode` backed by an embedded SQLite record database. When a patient presents their digital carnet (or QR card containing their public key credentials), the attending clinician writes the consultation note and co-signs the transaction locally.  
> The transaction is queued in the local edge mempool and anchored in the local SQLite ledger. As soon as cellular connectivity (2G/3G/4G or satellite) is restored, the client node initiates a P2P handshake with the nearest regional Full Node, gossiping the queued transaction batch. The validator nodes verify the timestamps and dual signatures, validate credentials across Channel 1, and commit the transactions into the next consensus block."

---

### Q6: "Why did you separate the system into Channel 0 and Channel 1 rather than using a single blockchain?"
> **Candidate Answer:**  
> "Channel separation addresses both security and performance. Channel 1 represents governance and identity (who is a certified physician, who is a patient, which licenses are active). Channel 0 represents clinical interactions (diagnoses, treatments).  
> If both were mixed on a single chain, every clinical query would have to traverse thousands of administrative identity transactions. More critically, channel separation establishes a strict access control boundary: client edge nodes used by doctors or patients can be granted read/write permissions strictly on Channel 0, while Channel 1 can only be modified by medical governance authorities (MINSANTE, Medical Council). This prevents identity spoofing at the core protocol level."

---

## 10. CONCLUSION & FUTURE WORK

### 10.1 Concluding Summary
The *Blockchain-Based Digital Health Carnet* project successfully transitions decentralized healthcare records from theoretical academic conjecture into a tangible, high-performance, and resilient systems implementation. By discarding the heavyweight enterprise baggage of Hyperledger Fabric in favor of a purpose-built C++20 core, a Galois Field $\text{GF}(2^8)$ Shamir Secret Sharing cluster, a multi-channel ledger vector, and an asynchronous Python P2P mesh, this research provides the Republic of Cameroon with an actionable, technologically sovereign foundation for national digital health records.

### 10.2 Recommendations for the Ministry of Public Health (MINSANTE)
1. **National Pilot Deployment:** Initiate a three-hospital pilot linking Yaoundé Central Hospital, Douala General Hospital, and a semi-rural district health center in the Centre Region.
2. **Citizen Health Card Issuance:** Integrate patient public keys onto national biometric ID cards or secure NFC/QR cards.
3. **Regulatory Framework:** Establish legal recognition for dual-signed cryptographic medical records in Cameroonian jurisprudence.

---
*Prepared and structured for Bachelor of Science Defense in Information Systems and Networking &bull; The ICT University, Yaoundé, Cameroon &bull; Academic Year 2025/2026.*
