#include "CConfig.h"
#include <fstream>
#include <iostream>
#include <sstream>
#include <algorithm>

namespace {

std::string trim(const std::string& str) {
    size_t first = str.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) return "";
    size_t last = str.find_last_not_of(" \t\r\n");
    return str.substr(first, (last - first + 1));
}

} // namespace

BlockchainConfig CConfig::load(const std::string& configFilePath) {
    BlockchainConfig cfg;
    cfg.configPath = configFilePath;

    std::ifstream file(configFilePath);
    if (!file.is_open()) {
        std::cout << "[Config] No " << configFilePath << " found. Writing default configuration.\n";
        saveDefault(configFilePath);
        return cfg;
    }

    std::string line;
    while (std::getline(file, line)) {
        line = trim(line);
        if (line.empty() || line[0] == '#' || line[0] == ';') {
            continue;
        }

        size_t eq = line.find('=');
        if (eq == std::string::npos) continue;

        std::string key = trim(line.substr(0, eq));
        std::string val = trim(line.substr(eq + 1));

        try {
            if (key == "blockchain_memory_gb") {
                cfg.blockchainMemoryLimitBytes = static_cast<uint64_t>(std::stod(val) * 1024 * 1024 * 1024);
            } else if (key == "blockheader_memory_gb") {
                cfg.blockHeaderMemoryLimitBytes = static_cast<uint64_t>(std::stod(val) * 1024 * 1024 * 1024);
            } else if (key == "schema_memory_gb") {
                cfg.schemaMemoryLimitBytes = static_cast<uint64_t>(std::stod(val) * 1024 * 1024 * 1024);
            } else if (key == "max_block_size_kb") {
                cfg.maxBlockSizeBytes = static_cast<uint32_t>(std::stoul(val) * 1024);
            } else if (key == "header_size_bytes") {
                cfg.headerSizeBytes = static_cast<uint32_t>(std::stoul(val));
            } else if (key == "data_dir") {
                cfg.dataDir = val;
            } else if (key == "consensus_quorum_count") {
                cfg.consensusQuorumCount = static_cast<uint32_t>(std::stoul(val));
            } else if (key == "max_transactions_per_block") {
                cfg.maxTransactionsPerBlock = static_cast<uint32_t>(std::stoul(val));
            }
        } catch (const std::exception& e) {
            std::cerr << "[Config] Warning: failed to parse config line: " << line << " (" << e.what() << ")\n";
        }
    }

    return cfg;
}

void CConfig::saveDefault(const std::string& configFilePath) {
    std::ofstream out(configFilePath);
    if (!out.is_open()) return;

    out << "# ========================================================\n";
    out << "# E-Medical Booklet Blockchain Configuration\n";
    out << "# ========================================================\n\n";
    out << "# Memory Budgets (defines LRU cache capacities):\n";
    out << "blockchain_memory_gb = 4\n";
    out << "blockheader_memory_gb = 2\n";
    out << "schema_memory_gb = 1\n\n";
    out << "# Frame Sizes:\n";
    out << "# frames = memory_budget / frame_size\n";
    out << "max_block_size_kb = 32\n";
    out << "header_size_bytes = 160\n\n";
    out << "# Storage Location:\n";
    out << "data_dir = chaindata\n\n";
    out << "# PBFT Consensus Rules:\n";
    out << "consensus_quorum_count = 3\n";
    out << "max_transactions_per_block = 256\n";
    out.close();
}
