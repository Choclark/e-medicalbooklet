#include "CBlockStore.h"
#include "CArchiveManager.h"
#include "CCommon/Serializer.h"
#include "CCommon/Crc32.h"
#include "CCrypto/Sha256.h"

#include <cstdio>
#include <iostream>
#include <stdexcept>
#include <fstream>

namespace fs = std::filesystem;

namespace {

constexpr uint32_t BLOCK_MAGIC = 0x4244454Du;             // "MEDB"
constexpr uint32_t HEADER_MAGIC = 0x4844454Du;            // "MEDH"
constexpr uint8_t STORAGE_FORMAT_VERSION = 2;
constexpr size_t RECORD_HEADER_SIZE = 12;                 // magic(4) + payloadSize(4) + crc(4)
constexpr size_t HASH_FIELD_SIZE = 64;                    // 64 hex characters for SHA-256
// Index entry: height(8) + fileNo(4) + offset(8) + size(4) + headerOffset(8) + headerSize(4) + hash(64) + crc(4)
constexpr size_t INDEX_ENTRY_SIZE = 8 + 4 + 8 + 4 + 8 + 4 + HASH_FIELD_SIZE + 4;

std::vector<uint8_t> readWholeFile(const fs::path& path) {
    std::ifstream in(path, std::ios::binary | std::ios::ate);
    if (!in) return {};
    std::streamsize size = in.tellg();
    std::vector<uint8_t> buf(static_cast<size_t>(size));
    in.seekg(0);
    if (size > 0) in.read(reinterpret_cast<char*>(buf.data()), size);
    return buf;
}

std::vector<uint8_t> encodeIndexEntry(const BlockIndexEntry& e) {
    ByteWriter w;
    w.reserve(INDEX_ENTRY_SIZE);
    w.writeU64(e.height);
    w.writeU32(e.fileNo);
    w.writeU64(e.offset);
    w.writeU32(e.size);
    w.writeU64(e.headerOffset);
    w.writeU32(e.headerSize);
    w.writeFixedString(e.hash, HASH_FIELD_SIZE);
    w.writeU32(crc32(w.data().data(), w.data().size()));
    return std::move(w.data());
}

bool decodeIndexEntry(const uint8_t* p, BlockIndexEntry& out) {
    ByteReader crcReader(p + INDEX_ENTRY_SIZE - 4, 4);
    if (crc32(p, INDEX_ENTRY_SIZE - 4) != crcReader.readU32()) {
        return false;
    }
    ByteReader r(p, INDEX_ENTRY_SIZE - 4);
    out.height = r.readU64();
    out.fileNo = r.readU32();
    out.offset = r.readU64();
    out.size = r.readU32();
    out.headerOffset = r.readU64();
    out.headerSize = r.readU32();
    out.hash = r.readFixedString(HASH_FIELD_SIZE);
    return true;
}

std::optional<CBlock> decodeBlockRecord(const uint8_t* data, size_t size) {
    if (size < RECORD_HEADER_SIZE) return std::nullopt;

    ByteReader header(data, RECORD_HEADER_SIZE);
    uint32_t magic = header.readU32();
    uint32_t payloadSize = header.readU32();
    uint32_t storedCrc = header.readU32();

    if (magic != BLOCK_MAGIC || payloadSize != size - RECORD_HEADER_SIZE) return std::nullopt;

    const uint8_t* payload = data + RECORD_HEADER_SIZE;
    if (crc32(payload, payloadSize) != storedCrc) return std::nullopt;

    try {
        return CBlockStore::deserializeBlock(payload, payloadSize);
    } catch (const std::exception&) {
        return std::nullopt;
    }
}

std::optional<BlockHeader> decodeHeaderRecord(const uint8_t* data, size_t size) {
    if (size < RECORD_HEADER_SIZE) return std::nullopt;

    ByteReader header(data, RECORD_HEADER_SIZE);
    uint32_t magic = header.readU32();
    uint32_t payloadSize = header.readU32();
    uint32_t storedCrc = header.readU32();

    if (magic != HEADER_MAGIC || payloadSize != size - RECORD_HEADER_SIZE) return std::nullopt;

    const uint8_t* payload = data + RECORD_HEADER_SIZE;
    if (crc32(payload, payloadSize) != storedCrc) return std::nullopt;

    try {
        return BlockHeader::deserialize(payload, payloadSize);
    } catch (const std::exception&) {
        return std::nullopt;
    }
}

} // namespace

CBlockStore::CBlockStore(const fs::path& dataDir, uint64_t maxFileSize)
    : m_dataDir(dataDir),
      m_blocksDir(dataDir / "blocks"),
      m_indexPath(dataDir / "index.dat"),
      m_headersPath(dataDir / "headers.dat"),
      m_maxFileSize(maxFileSize) {
    fs::create_directories(m_blocksDir);
    loadIndexAndRecover();
    openWriteStreams();
}

CBlockStore::~CBlockStore() {
    try {
        syncToDisk();
    } catch (...) {}
}

CBlockStore::CBlockStore(CBlockStore&& other) noexcept {
    std::lock_guard<std::mutex> lock(other.m_mutex);
    m_dataDir = std::move(other.m_dataDir);
    m_blocksDir = std::move(other.m_blocksDir);
    m_indexPath = std::move(other.m_indexPath);
    m_headersPath = std::move(other.m_headersPath);
    m_maxFileSize = other.m_maxFileSize;
    m_index = std::move(other.m_index);
    m_hashToHeight = std::move(other.m_hashToHeight);
    m_blockFile = std::move(other.m_blockFile);
    m_headerFile = std::move(other.m_headerFile);
    m_indexFile = std::move(other.m_indexFile);
    m_currentFileNo = other.m_currentFileNo;
    m_currentFileSize = other.m_currentFileSize;
    m_currentHeaderFileSize = other.m_currentHeaderFileSize;
}

CBlockStore& CBlockStore::operator=(CBlockStore&& other) noexcept {
    if (this != &other) {
        std::scoped_lock lock(m_mutex, other.m_mutex);
        m_dataDir = std::move(other.m_dataDir);
        m_blocksDir = std::move(other.m_blocksDir);
        m_indexPath = std::move(other.m_indexPath);
        m_headersPath = std::move(other.m_headersPath);
        m_maxFileSize = other.m_maxFileSize;
        m_index = std::move(other.m_index);
        m_hashToHeight = std::move(other.m_hashToHeight);
        m_blockFile = std::move(other.m_blockFile);
        m_headerFile = std::move(other.m_headerFile);
        m_indexFile = std::move(other.m_indexFile);
        m_currentFileNo = other.m_currentFileNo;
        m_currentFileSize = other.m_currentFileSize;
        m_currentHeaderFileSize = other.m_currentHeaderFileSize;
    }
    return *this;
}

fs::path CBlockStore::blockFilePath(uint32_t fileNo) const {
    char name[32];
    std::snprintf(name, sizeof(name), "blk%05u.dat", fileNo);
    return m_blocksDir / name;
}

void CBlockStore::loadIndexAndRecover() {
    m_index.clear();
    m_hashToHeight.clear();

    std::vector<uint8_t> buf = readWholeFile(m_indexPath);
    size_t count = buf.size() / INDEX_ENTRY_SIZE;
    m_index.reserve(count);

    std::unordered_map<uint32_t, uint64_t> fileSizes;

    for (size_t i = 0; i < count; ++i) {
        BlockIndexEntry e;
        if (!decodeIndexEntry(buf.data() + i * INDEX_ENTRY_SIZE, e) || e.height != i) {
            std::cerr << "[Storage] Index entry " << i << " invalid - truncating index.\n";
            break;
        }

        auto it = fileSizes.find(e.fileNo);
        if (it == fileSizes.end()) {
            std::error_code ec;
            uint64_t sz = fs::file_size(blockFilePath(e.fileNo), ec);
            it = fileSizes.emplace(e.fileNo, ec ? 0 : sz).first;
        }
        if (e.offset + e.size > it->second) {
            std::cerr << "[Storage] Block #" << i << " payload missing - truncating.\n";
            break;
        }

        m_hashToHeight[e.hash] = e.height;
        m_index.push_back(std::move(e));
    }

    uint64_t validIndexBytes = static_cast<uint64_t>(m_index.size()) * INDEX_ENTRY_SIZE;
    if (fs::exists(m_indexPath) && fs::file_size(m_indexPath) != validIndexBytes) {
        fs::resize_file(m_indexPath, validIndexBytes);
    }

    if (m_index.empty()) {
        m_currentFileNo = 0;
        m_currentFileSize = 0;
        m_currentHeaderFileSize = 0;
    } else {
        const auto& last = m_index.back();
        m_currentFileNo = last.fileNo;
        m_currentFileSize = last.offset + last.size;
        m_currentHeaderFileSize = last.headerOffset + last.headerSize;
    }

    fs::path current = blockFilePath(m_currentFileNo);
    if (fs::exists(current) && fs::file_size(current) != m_currentFileSize) {
        fs::resize_file(current, m_currentFileSize);
    }
    if (fs::exists(m_headersPath) && fs::file_size(m_headersPath) != m_currentHeaderFileSize) {
        fs::resize_file(m_headersPath, m_currentHeaderFileSize);
    }
}

void CBlockStore::openWriteStreams() {
    if (!m_blockFile.open(blockFilePath(m_currentFileNo), CStorage::CPhysicalFile::OpenMode::WriteAppend)) {
        throw std::runtime_error("CBlockStore: failed to open block file: " + blockFilePath(m_currentFileNo).string());
    }
    if (!m_headerFile.open(m_headersPath, CStorage::CPhysicalFile::OpenMode::WriteAppend)) {
        throw std::runtime_error("CBlockStore: failed to open headers file: " + m_headersPath.string());
    }
    if (!m_indexFile.open(m_indexPath, CStorage::CPhysicalFile::OpenMode::WriteAppend)) {
        throw std::runtime_error("CBlockStore: failed to open index file: " + m_indexPath.string());
    }
}

void CBlockStore::rollbackPartialWrite() {
    m_blockFile.truncateTo(m_currentFileSize);
    m_headerFile.truncateTo(m_currentHeaderFileSize);
    m_indexFile.truncateTo(static_cast<uint64_t>(m_index.size()) * INDEX_ENTRY_SIZE);
}

bool CBlockStore::appendBlock(const CBlock& block) {
    std::lock_guard<std::mutex> lock(m_mutex);

    if (block.getHeight() != m_index.size()) {
        std::cerr << "[Storage] Refusing block #" << block.getHeight()
                  << " - expected height " << m_index.size() << "\n";
        return false;
    }

    std::vector<uint8_t> blockPayload = serializeBlock(block);
    const uint64_t blockRecordSize = RECORD_HEADER_SIZE + blockPayload.size();

    std::vector<uint8_t> headerPayload = block.getHeader().serialize();
    const uint64_t headerRecordSize = RECORD_HEADER_SIZE + headerPayload.size();

    // Check file rolling for blocks
    if (m_currentFileSize > 0 && m_currentFileSize + blockRecordSize > m_maxFileSize) {
        m_blockFile.close();
        ++m_currentFileNo;
        m_currentFileSize = 0;
        if (!m_blockFile.open(blockFilePath(m_currentFileNo), CStorage::CPhysicalFile::OpenMode::WriteTruncate)) {
            std::cerr << "[Storage] Failed to roll to new block file.\n";
            return false;
        }
    }

    // 1. Write Block Record to blkNNNNN.dat
    ByteWriter bHeader;
    bHeader.reserve(RECORD_HEADER_SIZE);
    bHeader.writeU32(BLOCK_MAGIC);
    bHeader.writeU32(static_cast<uint32_t>(blockPayload.size()));
    bHeader.writeU32(crc32(blockPayload.data(), blockPayload.size()));

    if (!m_blockFile.write(bHeader.data().data(), RECORD_HEADER_SIZE) ||
        !m_blockFile.write(blockPayload.data(), blockPayload.size())) {
        std::cerr << "[Storage] Failed writing block payload - rolling back.\n";
        rollbackPartialWrite();
        return false;
    }

    // 2. Write Header Record to headers.dat
    ByteWriter hHeader;
    hHeader.reserve(RECORD_HEADER_SIZE);
    hHeader.writeU32(HEADER_MAGIC);
    hHeader.writeU32(static_cast<uint32_t>(headerPayload.size()));
    hHeader.writeU32(crc32(headerPayload.data(), headerPayload.size()));

    if (!m_headerFile.write(hHeader.data().data(), RECORD_HEADER_SIZE) ||
        !m_headerFile.write(headerPayload.data(), headerPayload.size())) {
        std::cerr << "[Storage] Failed writing header record - rolling back.\n";
        rollbackPartialWrite();
        return false;
    }

    // 3. Write Index Entry to index.dat
    BlockIndexEntry entry{
        block.getHeight(),
        m_currentFileNo,
        m_currentFileSize,
        static_cast<uint32_t>(blockRecordSize),
        m_currentHeaderFileSize,
        static_cast<uint32_t>(headerRecordSize),
        block.getBlockHash()
    };

    std::vector<uint8_t> encodedIdx = encodeIndexEntry(entry);
    if (!m_indexFile.write(encodedIdx.data(), encodedIdx.size())) {
        std::cerr << "[Storage] Failed writing index entry - rolling back.\n";
        rollbackPartialWrite();
        return false;
    }

    // 4. Force physical disk sync to survive power failure (FlushFileBuffers / fsync)
    m_blockFile.syncToDisk();
    m_headerFile.syncToDisk();
    m_indexFile.syncToDisk();

    // 5. Commit state to in-memory index
    m_currentFileSize += blockRecordSize;
    m_currentHeaderFileSize += headerRecordSize;
    m_hashToHeight[entry.hash] = entry.height;
    m_index.push_back(std::move(entry));

    return true;
}

void CBlockStore::syncToDisk() {
    std::lock_guard<std::mutex> lock(m_mutex);
    m_blockFile.syncToDisk();
    m_headerFile.syncToDisk();
    m_indexFile.syncToDisk();
}

std::optional<CBlock> CBlockStore::readBlock(uint64_t height) const {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (height >= m_index.size()) return std::nullopt;

    const auto& e = m_index[static_cast<size_t>(height)];
    CStorage::CPhysicalFile reader;
    fs::path blkPath = blockFilePath(e.fileNo);
    if (!reader.open(blkPath, CStorage::CPhysicalFile::OpenMode::Read)) {
        // Check if sealed block file was moved to cold storage or compressed into a .medarch bundle
        fs::path sealedPath = m_dataDir / "archives" / "sealed_blocks" / blkPath.filename();
        if (!reader.open(sealedPath, CStorage::CPhysicalFile::OpenMode::Read)) {
            CStorage::CArchiveManager archMgr(m_dataDir);
            return archMgr.restoreBlockFromArchive(height);
        }
    }

    std::vector<uint8_t> buf(e.size);
    if (!reader.readAt(e.offset, buf.data(), e.size)) {
        CStorage::CArchiveManager archMgr(m_dataDir);
        return archMgr.restoreBlockFromArchive(height);
    }

    return decodeBlockRecord(buf.data(), buf.size());
}

std::optional<BlockHeader> CBlockStore::readHeader(uint64_t height) const {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (height >= m_index.size()) return std::nullopt;

    const auto& e = m_index[static_cast<size_t>(height)];
    CStorage::CPhysicalFile reader;
    if (!reader.open(m_headersPath, CStorage::CPhysicalFile::OpenMode::Read)) {
        return std::nullopt;
    }

    std::vector<uint8_t> buf(e.headerSize);
    if (!reader.readAt(e.headerOffset, buf.data(), e.headerSize)) {
        return std::nullopt;
    }

    return decodeHeaderRecord(buf.data(), buf.size());
}

std::optional<CBlock> CBlockStore::readBlockByHash(const std::string& hash) const {
    std::lock_guard<std::mutex> lock(m_mutex);
    auto it = m_hashToHeight.find(hash);
    if (it == m_hashToHeight.end()) return std::nullopt;
    uint64_t height = it->second;

    const auto& e = m_index[static_cast<size_t>(height)];
    CStorage::CPhysicalFile reader;
    fs::path blkPath = blockFilePath(e.fileNo);
    if (!reader.open(blkPath, CStorage::CPhysicalFile::OpenMode::Read)) {
        fs::path sealedPath = m_dataDir / "archives" / "sealed_blocks" / blkPath.filename();
        if (!reader.open(sealedPath, CStorage::CPhysicalFile::OpenMode::Read)) {
            CStorage::CArchiveManager archMgr(m_dataDir);
            return archMgr.restoreBlockFromArchive(height);
        }
    }

    std::vector<uint8_t> buf(e.size);
    if (!reader.readAt(e.offset, buf.data(), e.size)) {
        CStorage::CArchiveManager archMgr(m_dataDir);
        return archMgr.restoreBlockFromArchive(height);
    }

    return decodeBlockRecord(buf.data(), buf.size());
}

std::vector<CBlock> CBlockStore::loadAllBlocks() const {
    std::lock_guard<std::mutex> lock(m_mutex);
    std::vector<CBlock> blocks;
    blocks.reserve(m_index.size());

    uint32_t loadedFile = UINT32_MAX;
    std::vector<uint8_t> fileBuf;

    for (const auto& e : m_index) {
        if (e.fileNo != loadedFile) {
            fileBuf = readWholeFile(blockFilePath(e.fileNo));
            loadedFile = e.fileNo;
        }
        if (e.offset + e.size > fileBuf.size()) {
            throw std::runtime_error("CBlockStore: block #" + std::to_string(e.height) + " out of bounds");
        }
        auto block = decodeBlockRecord(fileBuf.data() + e.offset, e.size);
        if (!block) {
            throw std::runtime_error("CBlockStore: block #" + std::to_string(e.height) + " corrupted");
        }
        blocks.push_back(std::move(*block));
    }
    return blocks;
}

std::vector<BlockHeader> CBlockStore::loadAllHeaders() const {
    std::lock_guard<std::mutex> lock(m_mutex);
    std::vector<BlockHeader> headers;
    headers.reserve(m_index.size());

    std::vector<uint8_t> fileBuf = readWholeFile(m_headersPath);
    for (const auto& e : m_index) {
        if (e.headerOffset + e.headerSize > fileBuf.size()) {
            throw std::runtime_error("CBlockStore: header #" + std::to_string(e.height) + " out of bounds");
        }
        auto header = decodeHeaderRecord(fileBuf.data() + e.headerOffset, e.headerSize);
        if (!header) {
            throw std::runtime_error("CBlockStore: header #" + std::to_string(e.height) + " corrupted");
        }
        headers.push_back(std::move(*header));
    }
    return headers;
}

uint64_t CBlockStore::getBlockCount() const {
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_index.size();
}

bool CBlockStore::empty() const {
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_index.empty();
}

uint32_t CBlockStore::getCurrentFileNo() const {
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_currentFileNo;
}

size_t CBlockStore::pruneSealedBlockFiles(uint32_t upToFileNo, const std::filesystem::path& archiveDir) {
    std::lock_guard<std::mutex> lock(m_mutex);
    size_t prunedCount = 0;
    std::error_code ec;
    fs::create_directories(archiveDir, ec);
    // Only prune sealed files strictly less than m_currentFileNo
    uint32_t limitFileNo = (upToFileNo < m_currentFileNo) ? upToFileNo : (m_currentFileNo > 0 ? m_currentFileNo - 1 : 0);
    if (m_currentFileNo == 0) {
        return 0;
    }
    for (uint32_t fNo = 0; fNo <= limitFileNo; ++fNo) {
        fs::path srcPath = blockFilePath(fNo);
        if (fs::exists(srcPath, ec)) {
            fs::path dstPath = archiveDir / srcPath.filename();
            fs::copy_file(srcPath, dstPath, fs::copy_options::overwrite_existing, ec);
            if (!ec) {
                fs::remove(srcPath, ec);
                if (!ec) {
                    ++prunedCount;
                }
            }
        }
    }
    return prunedCount;
}

std::vector<uint8_t> CBlockStore::serializeBlock(const CBlock& block) {
    ByteWriter w;
    w.reserve(block.getEstimatedSizeBytes() + 64);

    w.writeU8(STORAGE_FORMAT_VERSION);

    // 1. Serialize Header
    std::vector<uint8_t> hBytes = block.getHeader().serialize();
    w.writeU32(static_cast<uint32_t>(hBytes.size()));
    w.writeBytes(hBytes.data(), hBytes.size());

    // 2. Serialize Transactions Body
    const auto& txs = block.getTransactions();
    w.writeU32(static_cast<uint32_t>(txs.size()));
    for (const auto& tx : txs) {
        std::vector<uint8_t> txBytes = tx.serialize();
        w.writeU32(static_cast<uint32_t>(txBytes.size()));
        w.writeBytes(txBytes.data(), txBytes.size());
    }

    return std::move(w.data());
}

CBlock CBlockStore::deserializeBlock(const uint8_t* data, size_t size) {
    ByteReader r(data, size);

    uint8_t format = r.readU8();
    if (format != STORAGE_FORMAT_VERSION) {
        throw std::runtime_error("Unsupported storage format version: " + std::to_string(format));
    }

    uint32_t hSize = r.readU32();
    const uint8_t* hPtr = r.readBytes(hSize);
    BlockHeader header = BlockHeader::deserialize(hPtr, hSize);

    uint32_t txCount = r.readU32();
    std::vector<COnChainTxRecord> txs;
    txs.reserve(txCount);

    for (uint32_t i = 0; i < txCount; ++i) {
        uint32_t txBytesLen = r.readU32();
        const uint8_t* txPtr = r.readBytes(txBytesLen);
        txs.push_back(COnChainTxRecord::deserialize(txPtr, txBytesLen));
    }

    return CBlock(header, std::move(txs));
}
