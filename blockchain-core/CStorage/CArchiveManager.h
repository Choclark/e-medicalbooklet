#pragma once

#include <cstdint>
#include <filesystem>
#include <mutex>
#include <optional>
#include <string>
#include <vector>
#include "CChain/Cchain.h"

namespace CStorage {

struct ArchiveManifest {
    std::string archiveId;
    uint64_t startHeight{0};
    uint64_t endHeight{0};
    uint64_t blockCount{0};
    uint64_t uncompressedBytes{0};
    uint64_t compressedBytes{0};
    std::string sha256Checksum;
    std::string merkleCheckpointRoot;
    std::string archiveFilePath;
    int64_t createdAt{0};
    size_t sealedFilesPruned{0};
    bool headersRetainedOnline{true};
    bool merkleRootsRetainedOnline{true};
};

class CArchiveManager {
public:
    explicit CArchiveManager(std::filesystem::path dataDir);

    // Seal, compress, checksum, and archive blocks [startHeight .. maxHeight] into chaindata/<node_id>/archives/
    // Keeps headers.dat and merkle_trees/ online for fast SPV & Merkle verification.
    ArchiveManifest archiveBlocksUpToHeight(CChain& chain,
                                            uint64_t maxHeight,
                                            bool pruneSealedFiles = true);

    // On-Demand Block Restoration from Cold .medarch Archive Bundle (with SHA-256 verification)
    std::optional<CBlock> restoreBlockFromArchive(uint64_t height) const;

    std::vector<ArchiveManifest> listArchives() const;
    std::filesystem::path getArchiveDir() const { return m_archiveDir; }

    // Lightweight lossless byte-stream compression (RLE-LZ hybrid) for .medarch cold storage
    static std::vector<uint8_t> compressBuffer(const std::vector<uint8_t>& input);
    static std::vector<uint8_t> decompressBuffer(const std::vector<uint8_t>& compressed);

private:
    void saveManifestIndex() const;
    void loadManifestIndex();

    std::filesystem::path m_dataDir;
    std::filesystem::path m_archiveDir;
    std::filesystem::path m_manifestPath;
    std::vector<ArchiveManifest> m_manifests;
    mutable std::mutex m_mutex;
};

} // namespace CStorage
