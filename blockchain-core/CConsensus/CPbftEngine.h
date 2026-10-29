#pragma once

#include <string>
#include <vector>
#include <map>
#include <set>
#include <cstdint>
#include <mutex>
#include "CBlock/Cblock.h"
#include "CCrypto/CryptoSigner.h"

namespace CConsensus {

class CPbftEngine {
public:
    explicit CPbftEngine(std::vector<std::string> validators = {
        "primary_validator_01",
        "validator_replica_02",
        "validator_replica_03",
        "validator_replica_04"
    });

    uint64_t getViewNumber() const;
    std::string getPrimaryNode() const;
    uint32_t getQuorumSize() const; // 2f + 1

    void advanceView();
    ConsensusMetadata createCommitProof(uint64_t sequenceNumber, const std::string& blockHash);
    bool verifyCommitProof(const ConsensusMetadata& metadata, const std::string& blockHash) const;

private:
    std::vector<std::string> m_validators;
    std::map<std::string, CCrypto::KeyPair> m_validatorKeys;
    uint64_t m_viewNumber{0};
    mutable std::mutex m_mutex;
};

} // namespace CConsensus
