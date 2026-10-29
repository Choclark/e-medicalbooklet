#include "CArchiveManager.h"
#include "CBlockStore.h"
#include "CCommon/Serializer.h"
#include "CCrypto/Sha256.h"
#include "CMerkle/CMerkleTree.h"

#include <chrono>
#include <ctime>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>

namespace fs = std::filesystem;

namespace CStorage {

namespace {
constexpr uint32_t ARCHIVE_MAGIC = 0x4144454Du; // "MEDA"
}

CArchiveManager::CArchiveManager(fs::path dataDir)
    : m_dataDir(std::move(dataDir)),
      m_archiveDir(m_dataDir / "archives"),
      m_manifestPath(m_archiveDir / "archive_manifest.json") {
    std::error_code ec;
    fs::create_directories(m_archiveDir, ec);
    loadManifestIndex();
}

std::vector<uint8_t> CArchiveManager::compressBuffer(const std::vector<uint8_t>& input) {
    // Frame header: "MEDA" (4B) + uncompressed size (4B) + RLE-packed payload
    std::vector<uint8_t> out;
    out.reserve(input.size() / 2 + 16);

    uint32_t magic = ARCHIVE_MAGIC;
    uint32_t origSize = static_cast<uint32_t>(input.size());
    const uint8_t* mPtr = reinterpret_cast<const uint8_t*>(&magic);
    const uint8_t* sPtr = reinterpret_cast<const uint8_t*>(&origSize);
    out.insert(out.end(), mPtr, mPtr + 4);
    out.insert(out.end(), sPtr, sPtr + 4);

    size_t i = 0;
    while (i < input.size()) {
        // Count run of identical bytes
        size_t runLen = 1;
        while (i + runLen < input.size() && input[i + runLen] == input[i] && runLen < 127) {
            ++runLen;
        }
        if (runLen >= 3) {
            // High bit 1 => repeat run of length (tag & 0x7F)
            out.push_back(static_cast<uint8_t>(0x80 | runLen));
            out.push_back(input[i]);
            i += runLen;
        } else {
            // Literal run up to 127 bytes until a 3-byte repeat is encountered
            size_t litStart = i;
            size_t litLen = 0;
            while (i < input.size() && litLen < 127) {
                if (i + 2 < input.size() && input[i] == input[i + 1] && input[i] == input[i + 2]) {
                    break;
                }
                ++i;
                ++litLen;
            }
            out.push_back(static_cast<uint8_t>(litLen & 0x7F));
            out.insert(out.end(), input.begin() + litStart, input.begin() + litStart + litLen);
        }
    }
    return out;
}

std::vector<uint8_t> CArchiveManager::decompressBuffer(const std::vector<uint8_t>& compressed) {
    if (compressed.size() < 8) return {};
    uint32_t magic = 0;
    uint32_t origSize = 0;
    std::memcpy(&magic, compressed.data(), 4);
    std::memcpy(&origSize, compressed.data() + 4, 4);
    if (magic != ARCHIVE_MAGIC) return {};

    std::vector<uint8_t> out;
    out.reserve(origSize);
    size_t i = 8;
    while (i < compressed.size()) {
        uint8_t tag = compressed[i++];
        if (tag & 0x80) {
            size_t runLen = tag & 0x7F;
            if (i >= compressed.size()) break;
            uint8_t val = compressed[i++];
            out.insert(out.end(), runLen, val);
        } else {
            size_t litLen = tag & 0x7F;
            if (i + litLen > compressed.size()) break;
            out.insert(out.end(), compressed.begin() + i, compressed.begin() + i + litLen);
            i += litLen;
        }
    }
    return out;
}

ArchiveManifest CArchiveManager::archiveBlocksUpToHeight(CChain& chain,
                                                         uint64_t maxHeight,
                                                         bool pruneSealedFiles) {
    std::lock_guard<std::mutex> lock(m_mutex);

    uint64_t chainHeight = chain.getChainHeight();
    uint64_t effectiveEnd = (maxHeight < chainHeight) ? maxHeight : chainHeight;
    uint64_t startHeight = 0;
    if (!m_manifests.empty()) {
        uint64_t nextStart = m_manifests.back().endHeight + 1;
        if (nextStart <= effectiveEnd) {
            startHeight = nextStart;
        }
    }

    ByteWriter rawWriter;
    std::vector<std::string> blockMerkleRoots;
    uint64_t archivedCount = 0;

    for (uint64_t h = startHeight; h <= effectiveEnd; ++h) {
        auto blkOpt = chain.getBlockByHeight(h);
        if (!blkOpt) continue;
        std::vector<uint8_t> serialized = CBlockStore::serializeBlock(*blkOpt);
        rawWriter.writeU64(h);
        rawWriter.writeU32(static_cast<uint32_t>(serialized.size()));
        rawWriter.writeBytes(serialized.data(), serialized.size());
        blockMerkleRoots.push_back(blkOpt->getHeader().merkleRoot);
        ++archivedCount;
    }

    const std::vector<uint8_t>& rawData = rawWriter.data();
    std::vector<uint8_t> compressedData = compressBuffer(rawData);
    std::string sha256Hex = CCrypto::Sha256::hashHex(compressedData.data(), compressedData.size());

    // Compute Merkle checkpoint over all archived block Merkle roots
    std::string checkpointRoot = sha256Hex;
    if (!blockMerkleRoots.empty()) {
        CMerkle::CMerkleTree checkpointTree(blockMerkleRoots);
        checkpointRoot = checkpointTree.getRoot();
    }

    auto now = std::chrono::system_clock::to_time_t(std::chrono::system_clock::now());
    std::ostringstream idStream;
    idStream << "ARCH-" << std::setw(5) << std::setfill('0') << startHeight
             << "-" << std::setw(5) << std::setfill('0') << effectiveEnd
             << "-" << sha256Hex.substr(0, 8);

    std::ostringstream fileName;
    fileName << "archive_" << std::setw(5) << std::setfill('0') << startHeight
             << "_" << std::setw(5) << std::setfill('0') << effectiveEnd << ".medarch";

    fs::path archiveFile = m_archiveDir / fileName.str();
    {
        std::ofstream ofs(archiveFile, std::ios::binary | std::ios::trunc);
        if (ofs.is_open() && !compressedData.empty()) {
            ofs.write(reinterpret_cast<const char*>(compressedData.data()),
                      static_cast<std::streamsize>(compressedData.size()));
            ofs.flush();
        }
    }

    size_t prunedFiles = 0;
    if (pruneSealedFiles) {
        uint32_t curFileNo = chain.getBlockStore().getCurrentFileNo();
        if (curFileNo > 0) {
            prunedFiles = chain.getBlockStore().pruneSealedBlockFiles(curFileNo - 1, m_archiveDir / "sealed_blocks");
        }
    }

    ArchiveManifest manifest;
    manifest.archiveId = idStream.str();
    manifest.startHeight = startHeight;
    manifest.endHeight = effectiveEnd;
    manifest.blockCount = archivedCount;
    manifest.uncompressedBytes = rawData.size();
    manifest.compressedBytes = compressedData.size();
    manifest.sha256Checksum = sha256Hex;
    manifest.merkleCheckpointRoot = checkpointRoot;
    manifest.archiveFilePath = archiveFile.string();
    manifest.createdAt = static_cast<int64_t>(now);
    manifest.sealedFilesPruned = prunedFiles;
    manifest.headersRetainedOnline = fs::exists(m_dataDir / "headers.dat");
    manifest.merkleRootsRetainedOnline = fs::exists(m_dataDir / "merkle_trees");

    m_manifests.push_back(manifest);
    saveManifestIndex();

    return manifest;
}

std::optional<CBlock> CArchiveManager::restoreBlockFromArchive(uint64_t height) const {
    std::lock_guard<std::mutex> lock(m_mutex);

    auto tryRestoreFromFile = [height](const fs::path& filePath, const std::string& expectedSha256) -> std::optional<CBlock> {
        if (!fs::exists(filePath)) return std::nullopt;
        std::ifstream ifs(filePath, std::ios::binary | std::ios::ate);
        if (!ifs.is_open()) return std::nullopt;
        auto fSize = ifs.tellg();
        if (fSize <= 0) return std::nullopt;
        ifs.seekg(0, std::ios::beg);
        std::vector<uint8_t> compressed(static_cast<size_t>(fSize));
        if (!ifs.read(reinterpret_cast<char*>(compressed.data()), fSize)) return std::nullopt;

        if (!expectedSha256.empty()) {
            std::string actualSha = CCrypto::Sha256::hashHex(compressed.data(), compressed.size());
            if (actualSha != expectedSha256) {
                std::cerr << "[CArchiveManager] Archive checksum mismatch for " << filePath << "\n";
                return std::nullopt;
            }
        }

        std::vector<uint8_t> raw = decompressBuffer(compressed);
        if (raw.empty()) return std::nullopt;

        ByteReader reader(raw.data(), raw.size());
        while (reader.remaining() >= 12) {
            uint64_t blkH = reader.readU64();
            uint32_t blkLen = reader.readU32();
            if (reader.remaining() < blkLen) break;
            const uint8_t* blkBytesPtr = reader.readBytes(blkLen);
            if (blkH == height) {
                try {
                    return CBlockStore::deserializeBlock(blkBytesPtr, blkLen);
                } catch (...) {
                    return std::nullopt;
                }
            }
        }
        return std::nullopt;
    };

    // 1. Check in-memory manifest ranges first
    for (const auto& m : m_manifests) {
        if (height >= m.startHeight && height <= m.endHeight) {
            if (auto blk = tryRestoreFromFile(m.archiveFilePath, m.sha256Checksum)) {
                return blk;
            }
        }
    }

    // 2. Scan all .medarch bundles in m_archiveDir (for newly restarted nodes)
    std::error_code ec;
    if (fs::exists(m_archiveDir, ec)) {
        for (const auto& entry : fs::directory_iterator(m_archiveDir, ec)) {
            if (entry.is_regular_file() && entry.path().extension() == ".medarch") {
                if (auto blk = tryRestoreFromFile(entry.path(), "")) {
                    return blk;
                }
            }
        }
    }

    return std::nullopt;
}

std::vector<ArchiveManifest> CArchiveManager::listArchives() const {
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_manifests;
}

void CArchiveManager::saveManifestIndex() const {
    std::ofstream ofs(m_manifestPath, std::ios::trunc);
    if (!ofs.is_open()) return;

    ofs << "{\n  \"archive_count\": " << m_manifests.size() << ",\n  \"archives\": [\n";
    for (size_t i = 0; i < m_manifests.size(); ++i) {
        const auto& m = m_manifests[i];
        std::string safePath = m.archiveFilePath;
        for (char& c : safePath) {
            if (c == '\\') c = '/';
        }
        ofs << "    {\n"
            << "      \"archive_id\": \"" << m.archiveId << "\",\n"
            << "      \"start_height\": " << m.startHeight << ",\n"
            << "      \"end_height\": " << m.endHeight << ",\n"
            << "      \"block_count\": " << m.blockCount << ",\n"
            << "      \"uncompressed_bytes\": " << m.uncompressedBytes << ",\n"
            << "      \"compressed_bytes\": " << m.compressedBytes << ",\n"
            << "      \"sha256_checksum\": \"" << m.sha256Checksum << "\",\n"
            << "      \"merkle_checkpoint_root\": \"" << m.merkleCheckpointRoot << "\",\n"
            << "      \"archive_file_path\": \"" << safePath << "\",\n"
            << "      \"created_at\": " << m.createdAt << ",\n"
            << "      \"sealed_files_pruned\": " << m.sealedFilesPruned << ",\n"
            << "      \"headers_retained_online\": " << (m.headersRetainedOnline ? "true" : "false") << ",\n"
            << "      \"merkle_roots_retained_online\": " << (m.merkleRootsRetainedOnline ? "true" : "false") << "\n"
            << "    }" << (i + 1 < m_manifests.size() ? "," : "") << "\n";
    }
    ofs << "  ]\n}\n";
}

void CArchiveManager::loadManifestIndex() {
    // Manifest index is reconstructed on new archive runs and persisted to archive_manifest.json
}

} // namespace CStorage
