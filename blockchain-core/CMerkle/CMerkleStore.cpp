#include "CMerkleStore.h"
#include <fstream>
#include <iostream>

namespace CMerkle {

CMerkleStore::CMerkleStore(std::filesystem::path storageDir, uint64_t memoryLimitBytes)
    : m_storageDir(std::move(storageDir)),
      m_memoryLimitBytes(memoryLimitBytes),
      m_cache(memoryLimitBytes / 2048) { // 2KB estimated average frame size
    if (!std::filesystem::exists(m_storageDir)) {
        std::filesystem::create_directories(m_storageDir);
    }
}

std::filesystem::path CMerkleStore::getStoragePath(uint64_t blockHeight) const {
    return m_storageDir / ("block_" + std::to_string(blockHeight) + ".merkle");
}

bool CMerkleStore::writeToDisk(uint64_t blockHeight, const CMerkleTree& tree) {
    auto path = getStoragePath(blockHeight);
    std::ofstream out(path, std::ios::binary);
    if (!out.is_open()) {
        std::cerr << "[MerkleStore] Error writing " << path.string() << "\n";
        return false;
    }

    auto bytes = tree.serialize();
    out.write(reinterpret_cast<const char*>(bytes.data()), bytes.size());
    out.flush();
    return true;
}

std::optional<CMerkleTree> CMerkleStore::readFromDisk(uint64_t blockHeight) {
    auto path = getStoragePath(blockHeight);
    if (!std::filesystem::exists(path)) {
        return std::nullopt;
    }

    std::ifstream in(path, std::ios::binary | std::ios::ate);
    if (!in.is_open()) {
        return std::nullopt;
    }

    std::streamsize size = in.tellg();
    in.seekg(0, std::ios::beg);

    std::vector<uint8_t> buffer(size);
    if (in.read(reinterpret_cast<char*>(buffer.data()), size)) {
        return CMerkleTree::deserialize(buffer.data(), buffer.size());
    }
    return std::nullopt;
}

bool CMerkleStore::saveTree(uint64_t blockHeight, const CMerkleTree& tree) {
    std::lock_guard<std::mutex> lock(m_mutex);
    // 1. Write to persistent disk
    if (!writeToDisk(blockHeight, tree)) {
        return false;
    }
    // 2. Put into 2GB RAM LRU cache
    m_cache.put(blockHeight, tree);
    return true;
}

std::optional<CMerkleTree> CMerkleStore::getTree(uint64_t blockHeight) {
    std::lock_guard<std::mutex> lock(m_mutex);
    // 1. Check in-memory 2GB LRU cache (RAM fast path)
    auto cached = m_cache.get(blockHeight);
    if (cached) {
        return cached;
    }

    // 2. Cache miss: load from disk
    auto fromDisk = readFromDisk(blockHeight);
    if (fromDisk) {
        m_cache.put(blockHeight, *fromDisk);
        return fromDisk;
    }

    return std::nullopt;
}

bool CMerkleStore::hasTree(uint64_t blockHeight) {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (m_cache.contains(blockHeight)) return true;
    return std::filesystem::exists(getStoragePath(blockHeight));
}

std::optional<MerkleProof> CMerkleStore::getProof(uint64_t blockHeight, uint32_t txOrder) {
    auto treeOpt = getTree(blockHeight);
    if (!treeOpt) {
        return std::nullopt;
    }
    try {
        return treeOpt->getProof(txOrder);
    } catch (const std::exception& ex) {
        std::cerr << "[MerkleStore] Error getting proof for block " 
                  << blockHeight << " tx " << txOrder << ": " << ex.what() << "\n";
        return std::nullopt;
    }
}

} // namespace CMerkle
