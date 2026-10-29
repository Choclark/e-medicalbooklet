#include "KsmDynamicJoinProtocol.h"
#include <iostream>
#include <set>

namespace CKsm {

KsmDynamicJoinProtocol::KsmDynamicJoinProtocol(KsmCluster& cluster)
    : m_cluster(cluster), m_epoch(1), m_sss() {}

JoinApproval KsmDynamicJoinProtocol::processJoinRequest(
    const JoinRequest& request,
    const std::vector<std::string>& quorumApprovers) {

    JoinApproval approval;
    approval.newNodeId = request.newNodeId;

    // Check if node already exists
    if (m_cluster.getNode(request.newNodeId) != nullptr) {
        approval.isApproved = false;
        approval.message = "Node ID already registered in cluster";
        return approval;
    }

    // Must have at least threshold T approvers from current cluster
    if (quorumApprovers.size() < m_cluster.getThreshold()) {
        approval.isApproved = false;
        approval.message = "Insufficient quorum for join approval (required " +
                           std::to_string(m_cluster.getThreshold()) + " nodes)";
        return approval;
    }

    // Determine coordinate point x for the new node
    uint8_t assignedIndex = request.preferredShareIndex;
    std::set<uint8_t> usedIndices;
    for (const auto& id : m_cluster.getNodeIds()) {
        const auto* node = m_cluster.getNode(id);
        if (node) usedIndices.insert(node->getShareIndex());
    }

    if (assignedIndex == 0 || usedIndices.count(assignedIndex)) {
        // Find first free coordinate >= 1
        assignedIndex = 1;
        while (usedIndices.count(assignedIndex)) {
            ++assignedIndex;
        }
    }

    approval.isApproved = true;
    approval.assignedShareIndex = assignedIndex;
    approval.clusterEpoch = m_epoch;
    approval.activeThreshold = m_cluster.getThreshold();
    approval.quorumApprovers = quorumApprovers;
    approval.message = "Join request approved by threshold quorum";

    return approval;
}

CatchupReport KsmDynamicJoinProtocol::synchronizeHistoricalShares(
    KsmNode& newNode,
    const std::vector<std::string>& quorumNodeIds) {

    CatchupReport report;
    report.newNodeId = newNode.getNodeId();

    if (quorumNodeIds.size() < m_cluster.getThreshold()) {
        std::cerr << "[KsmJoinProtocol] Catchup failed: quorum of " 
                  << m_cluster.getThreshold() << " nodes required.\n";
        report.success = false;
        return report;
    }

    // Collect all unique historical transaction IDs from the quorum
    std::set<std::string> allTxIds;
    for (const auto& nodeId : quorumNodeIds) {
        const auto* node = m_cluster.getNode(nodeId);
        if (node) {
            auto txList = node->getAllTxIds();
            allTxIds.insert(txList.begin(), txList.end());
        }
    }

    std::cout << "[KsmJoinProtocol] Synchronizing " << allTxIds.size() 
              << " historical transactions for incoming node " << newNode.getNodeId() << "...\n";

    for (const auto& txId : allTxIds) {
        // Gather threshold t shares from the quorum nodes
        std::vector<KeyShare> quorumShares;
        for (const auto& nodeId : quorumNodeIds) {
            const auto* node = m_cluster.getNode(nodeId);
            if (node) {
                auto shareOpt = node->provideShareForCatchup(txId);
                if (shareOpt) {
                    quorumShares.push_back(*shareOpt);
                }
            }
            if (quorumShares.size() >= m_cluster.getThreshold()) {
                break;
            }
        }

        if (quorumShares.size() >= m_cluster.getThreshold()) {
            // Derive the new node's share at coordinate assignedShareIndex via polynomial evaluation
            KeyShare catchupShare = m_sss.deriveCatchupShare(
                quorumShares,
                newNode.getShareIndex(),
                m_cluster.getThreshold()
            );

            // Persist the derived share into the new node's SQLite database
            newNode.receiveAndStoreShare(
                txId,
                catchupShare,
                m_cluster.getThreshold(),
                m_cluster.getTotalNodes() + 1,
                "CATCHUP_SYNCED"
            );

            report.syncedTxIds.push_back(txId);
            ++report.syncedTransactionCount;
        } else {
            std::cerr << "[KsmJoinProtocol] Warning: insufficient shares to reconstruct tx " << txId << "\n";
        }
    }

    report.success = true;
    return report;
}

bool KsmDynamicJoinProtocol::finalizeOnboarding(std::unique_ptr<KsmNode> newNode, uint32_t newThreshold) {
    if (!newNode) return false;

    std::string nodeId = newNode->getNodeId();
    m_cluster.addNode(std::move(newNode));
    ++m_epoch;

    if (newThreshold > 0) {
        m_cluster.setThreshold(newThreshold);
    }

    std::cout << "[KsmJoinProtocol] Node " << nodeId 
              << " successfully onboarded! Cluster transitioned to Epoch " << m_epoch
              << " (Total Nodes: " << m_cluster.getTotalNodes() 
              << ", Threshold: " << m_cluster.getThreshold() << ")\n";

    return true;
}

} // namespace CKsm
