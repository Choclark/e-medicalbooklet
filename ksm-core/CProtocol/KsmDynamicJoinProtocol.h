#pragma once

#include <string>
#include <vector>
#include <memory>
#include "../CDkg/KsmCluster.h"

namespace CKsm {

struct JoinRequest {
    std::string newNodeId;
    uint8_t preferredShareIndex{0};
    int64_t timestamp{0};
    std::string identityKey;
};

struct JoinApproval {
    bool isApproved{false};
    std::string newNodeId;
    uint8_t assignedShareIndex{0};
    uint32_t clusterEpoch{1};
    uint32_t activeThreshold{3};
    std::vector<std::string> quorumApprovers;
    std::string message;
};

struct CatchupReport {
    std::string newNodeId;
    size_t syncedTransactionCount{0};
    std::vector<std::string> syncedTxIds;
    bool success{false};
};

class KsmDynamicJoinProtocol {
public:
    explicit KsmDynamicJoinProtocol(KsmCluster& cluster);

    // Step 1: Handshake & Registration
    JoinApproval processJoinRequest(const JoinRequest& request,
                                    const std::vector<std::string>& quorumApprovers);

    // Step 2: Optimized Catch-up State Synchronization:
    // Uses a quorum of existing nodes to derive the new node's shares
    // for all historical transactions via proactive Lagrange evaluation at assignedShareIndex.
    CatchupReport synchronizeHistoricalShares(
        KsmNode& newNode,
        const std::vector<std::string>& quorumNodeIds);

    // Step 3: Cluster Reconfiguration & Epoch Transition:
    // Activates the new node in the cluster so it participates in future DKG and decryptions.
    bool finalizeOnboarding(std::unique_ptr<KsmNode> newNode, uint32_t newThreshold = 0);

    uint32_t getCurrentEpoch() const { return m_epoch; }

private:
    KsmCluster& m_cluster;
    uint32_t m_epoch{1};
    ShamirSecretSharing m_sss;
};

} // namespace CKsm
