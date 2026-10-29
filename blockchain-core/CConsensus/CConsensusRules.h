#pragma once

#include "CBlock/Cblock.h"
#include "CTransaction/CSchemaRegistry.h"
#include "CConfig/CConfig.h"
#include "CCommon/ValidationResult.h"
#include <map>
#include <set>
#include <string>

namespace CConsensus {

class CConsensusRules {
public:
    explicit CConsensusRules(const BlockchainConfig& config,
                             const CSchemaRegistry& schemaRegistry);

    // Evaluates all 7 consensus laws in priority order:
    // 1. Schema -> 2. Size -> 3. Link -> 4. Integrity -> 5. Time -> 6. PBFT -> 7. Quorum
    ValidationResult validateBlock(const CBlock& newBlock,
                                  const CBlock& prevBlock,
                                  int64_t currentNetworkTime = 0) const;

    // Validate a single transaction independently before entry into Mempool (Law 1)
    ValidationResult validateTransaction(const CTransaction& tx) const;

    // Validate on-chain transaction record inside proposed/committed block
    ValidationResult validateOnChainRecord(const COnChainTxRecord& rec, uint32_t expectedOrder) const;

    // Validate Genesis Block
    ValidationResult validateGenesisBlock(const CBlock& genesis) const;

    // On-Chain PKI Identity Registry (Accredited Public Key Binding & Revocation)
    static void registerAccreditedKey(const std::string& actorId,
                                      const std::string& role,
                                      const std::string& pubKeyHex);
    static void revokeAccreditedKey(const std::string& actorId,
                                    const std::string& pubKeyHex);
    static bool isSignerKeyAccredited(const std::string& actorId,
                                      const std::string& pubKeyHex);

private:
    BlockchainConfig m_config;
    const CSchemaRegistry& m_schemaRegistry;
};

} // namespace CConsensus
