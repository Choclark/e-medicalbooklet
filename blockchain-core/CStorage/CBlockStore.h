#pragma once

#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>
#include <mutex>
#include "CBlock/Cblock.h"
#include "CFile.h"

// ========================================================
// On-disk layout:
//  <dataDir>/
//    index.dat               Fixed-size entries: height, fileNo, offset, size, hash, CRC32
//    headers.dat             Append-only block headers (isolated from bodies)
//    blocks/blk00000.dat     Append-only full blocks (header + transactions)
//
// Write sequence:
//  1. Write full block to blocks/blkNNNNN.dat -> syncToDisk() (FlushFileBuffers)
//  2. Write header to headers.dat -> syncToDisk()
//  3. Write index entry to index.dat -> syncToDisk()
// ========================================================

struct BlockIndexEntry {
    uint64_t height{0};
    uint32_t fileNo{0};
    uint64_t offset{0};    // Byte offset in blkNNNNN.dat
    uint32_t size{0};      // Full block record size
    uint64_t headerOffset{0}; // Byte offset in headers.dat
    uint32_t headerSize{0};
    std::string hash;      // 64-char SHA-256 hex
};

class CBlockStore {
public:
    explicit CBlockStore(const std::filesystem::path& dataDir,
                         uint64_t maxFileSize = 128ULL * 1024 * 1024);
    ~CBlockStore();

    CBlockStore(const CBlockStore&) = delete;
    CBlockStore& operator=(const CBlockStore&) = delete;
    CBlockStore(CBlockStore&&) noexcept;
    CBlockStore& operator=(CBlockStore&&) noexcept;

    // Thread-safe append with physical FlushFileBuffers / fsync
    bool appendBlock(const CBlock& block);
    void syncToDisk();

    // Fast O(1) random-access reads
    std::optional<CBlock> readBlock(uint64_t height) const;
    std::optional<CBlock> readBlockByHash(const std::string& hash) const;
    std::optional<BlockHeader> readHeader(uint64_t height) const;

    // Bulk loading
    std::vector<CBlock> loadAllBlocks() const;
    std::vector<BlockHeader> loadAllHeaders() const;

    // Status queries
    uint64_t getBlockCount() const;
    bool empty() const;
    const std::filesystem::path& getDataDir() const { return m_dataDir; }
    uint32_t getCurrentFileNo() const;
    size_t pruneSealedBlockFiles(uint32_t upToFileNo, const std::filesystem::path& archiveDir);

    // Serialization utilities
    static std::vector<uint8_t> serializeBlock(const CBlock& block);
    static CBlock deserializeBlock(const uint8_t* data, size_t size);

private:
    std::filesystem::path blockFilePath(uint32_t fileNo) const;
    void loadIndexAndRecover();
    void openWriteStreams();
    void rollbackPartialWrite();

    std::filesystem::path m_dataDir;
    std::filesystem::path m_blocksDir;
    std::filesystem::path m_indexPath;
    std::filesystem::path m_headersPath;
    uint64_t m_maxFileSize;

    // In-memory index
    std::vector<BlockIndexEntry> m_index;
    std::unordered_map<std::string, uint64_t> m_hashToHeight;

    // Physical file handles with FlushFileBuffers support
    CStorage::CPhysicalFile m_blockFile;
    CStorage::CPhysicalFile m_headerFile;
    CStorage::CPhysicalFile m_indexFile;

    uint32_t m_currentFileNo{0};
    uint64_t m_currentFileSize{0};
    uint64_t m_currentHeaderFileSize{0};

    mutable std::mutex m_mutex;
};
