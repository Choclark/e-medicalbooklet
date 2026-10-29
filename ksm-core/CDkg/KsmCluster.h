#pragma once

#include <string>
#include <vector>
#include <map>
#include <memory>
#include <filesystem>
#include "../CKsmNode/KsmNode.h"
#include "../CShamir/ShamirSecretSharing.h"
#include "../CSchemaSplit/SchemaSplitter.h"

namespace CKsm {

class KsmCluster {
public:
    KsmCluster(uint32_t thresholdT, uint32_t totalN, std::filesystem::path storageDir);

    // Register a participating hospital node in the cluster
    void registerNode(const std::string& nodeId, uint8_t shareIndex);

    // Register a remote standalone ksm_core daemon TCP endpoint (e.g. 127.0.0.1:9101)
    void registerNodeEndpoint(const std::string& nodeId, const std::string& host, uint16_t port);

    // Get a node by ID
    KsmNode* getNode(const std::string& nodeId);
    const KsmNode* getNode(const std::string& nodeId) const;

    // Get all registered node IDs
    std::vector<std::string> getNodeIds() const;

    // Get active cluster parameters
    uint32_t getThreshold() const { return m_thresholdT; }
    uint32_t getTotalNodes() const { return static_cast<uint32_t>(m_nodes.size()); }
    void setThreshold(uint32_t t) { m_thresholdT = t; }

    // Step 1: Divide record into Metadata and Body, generate DEK via DKG,
    // split DEK into 3-of-4 shares for hospitals, persist to SQLite,
    // encrypt Body with AES-256-GCM, wipe DEK, and return envelope.
    EncryptedTxEnvelope encryptRecord(const std::string& schemaType,
                                      const std::map<std::string, std::string>& fullRecord,
                                      const std::string& signerType,
                                      const std::string& senderAddress,
                                      const std::string& senderPublicKey,
                                      const std::string& signature);

    // Step 2: Threshold Decryption: Gathers shares from at least t participating hospitals,
    // reconstructs DEK via Lagrange interpolation, decrypts AES-256-GCM body, and reassembles.
    std::map<std::string, std::string> decryptRecord(
        const EncryptedTxEnvelope& envelope,
        const std::vector<std::string>& participatingNodeIds);

    // Reconstruct the 32-byte DEK via Shamir Lagrange interpolation for Proxy Re-Encryption capsule generation
    std::vector<uint8_t> reconstructKeyForTx(
        const std::string& txId,
        const std::vector<std::string>& participatingNodeIds);

    // Dynamic join: Add a new node (e.g. Hospital E) to the cluster
    void addNode(std::unique_ptr<KsmNode> node);

    std::filesystem::path getStorageDir() const { return m_storageDir; }

private:
    struct RemoteEndpoint {
        std::string host;
        uint16_t port;
    };

    bool sendRemoteShareStore(const std::string& nodeId,
                              const std::string& txId,
                              const KeyShare& share,
                              const std::string& patientId,
                              const std::string& doctorId) const;

    std::optional<KeyShare> fetchRemoteShare(const std::string& nodeId,
                                             const std::string& txId) const;

    uint32_t m_thresholdT;
    uint32_t m_totalN;
    std::filesystem::path m_storageDir;
    std::map<std::string, std::unique_ptr<KsmNode>> m_nodes;
    std::map<std::string, RemoteEndpoint> m_nodeEndpoints;
    ShamirSecretSharing m_sss;
};

} // namespace CKsm
