#include "KsmShareStorage.h"
#include <fstream>
#include <sstream>
#include <iostream>
#include <ctime>
#include <cstring>

namespace CKsm {

namespace {
constexpr uint32_t KSM_BIN_MAGIC = 0x534D534Bu; // "KSMS"

uint32_t computeCrc32(const uint8_t* data, size_t len) {
    uint32_t crc = 0xFFFFFFFFu;
    for (size_t i = 0; i < len; ++i) {
        crc ^= data[i];
        for (int b = 0; b < 8; ++b) {
            crc = (crc >> 1) ^ (0xEDB88320u & (-(static_cast<int32_t>(crc & 1))));
        }
    }
    return ~crc;
}

void writeBinStr(std::vector<uint8_t>& buf, const std::string& s) {
    uint32_t len = static_cast<uint32_t>(s.size());
    const uint8_t* p = reinterpret_cast<const uint8_t*>(&len);
    buf.insert(buf.end(), p, p + 4);
    buf.insert(buf.end(), s.begin(), s.end());
}

void writeBinU64(std::vector<uint8_t>& buf, uint64_t v) {
    const uint8_t* p = reinterpret_cast<const uint8_t*>(&v);
    buf.insert(buf.end(), p, p + 8);
}

bool readBinStr(const std::vector<uint8_t>& buf, size_t& pos, std::string& out) {
    if (pos + 4 > buf.size()) return false;
    uint32_t len = 0;
    std::memcpy(&len, buf.data() + pos, 4);
    pos += 4;
    if (pos + len > buf.size()) return false;
    out.assign(reinterpret_cast<const char*>(buf.data() + pos), len);
    pos += len;
    return true;
}

bool readBinU64(const std::vector<uint8_t>& buf, size_t& pos, uint64_t& out) {
    if (pos + 8 > buf.size()) return false;
    std::memcpy(&out, buf.data() + pos, 8);
    pos += 8;
    return true;
}
} // namespace

KsmShareStorage::KsmShareStorage(std::filesystem::path dbPath)
    : m_dbPath(std::move(dbPath)) {
    initializeDb();
    loadFromDisk();
}

void KsmShareStorage::initializeDb() {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (!std::filesystem::exists(m_dbPath.parent_path())) {
        std::filesystem::create_directories(m_dbPath.parent_path());
    }

    if (!std::filesystem::exists(m_dbPath)) {
        std::ofstream ofs(m_dbPath);
        ofs << "-- SQLite format 3 compatible KSM KeyShare Ledger\n";
        ofs << "CREATE TABLE IF NOT EXISTS ksm_shares (\n";
        ofs << "    tx_id TEXT PRIMARY KEY,\n";
        ofs << "    data_id TEXT,\n";
        ofs << "    doctor_id TEXT,\n";
        ofs << "    patient_id TEXT,\n";
        ofs << "    share_index INTEGER,\n";
        ofs << "    share_hex TEXT,\n";
        ofs << "    access_key_time INTEGER,\n";
        ofs << "    threshold_t INTEGER,\n";
        ofs << "    total_n INTEGER,\n";
        ofs << "    created_at INTEGER,\n";
        ofs << "    status TEXT\n";
        ofs << ");\n\n";
    }
}

void KsmShareStorage::loadFromDisk() {
    std::lock_guard<std::mutex> lock(m_mutex);

    // 1. Primary Binary Length-Prefixed + CRC32-Verified Share Log (.bin)
    std::filesystem::path binPath = m_dbPath;
    binPath.replace_extension(".bin");
    if (std::filesystem::exists(binPath)) {
        std::ifstream binIn(binPath, std::ios::binary | std::ios::ate);
        if (binIn.is_open()) {
            auto fSize = binIn.tellg();
            if (fSize > 0) {
                binIn.seekg(0, std::ios::beg);
                std::vector<uint8_t> buf(static_cast<size_t>(fSize));
                if (binIn.read(reinterpret_cast<char*>(buf.data()), fSize)) {
                    size_t pos = 0;
                    while (pos + 12 <= buf.size()) {
                        uint32_t magic = 0, payloadLen = 0, expectedCrc = 0;
                        std::memcpy(&magic, buf.data() + pos, 4);
                        std::memcpy(&payloadLen, buf.data() + pos + 4, 4);
                        std::memcpy(&expectedCrc, buf.data() + pos + 8, 4);
                        pos += 12;
                        if (magic != KSM_BIN_MAGIC || pos + payloadLen > buf.size()) break;

                        std::vector<uint8_t> frame(buf.begin() + pos, buf.begin() + pos + payloadLen);
                        pos += payloadLen;
                        if (computeCrc32(frame.data(), frame.size()) != expectedCrc) break;

                        size_t fpos = 0;
                        StoredShareRecord rec;
                        uint64_t idx64 = 0, akt64 = 0, t64 = 0, n64 = 0, cat64 = 0;
                        if (readBinStr(frame, fpos, rec.txId) &&
                            readBinStr(frame, fpos, rec.dataId) &&
                            readBinStr(frame, fpos, rec.doctorId) &&
                            readBinStr(frame, fpos, rec.patientId) &&
                            readBinU64(frame, fpos, idx64) &&
                            readBinStr(frame, fpos, rec.shareHex) &&
                            readBinU64(frame, fpos, akt64) &&
                            readBinU64(frame, fpos, t64) &&
                            readBinU64(frame, fpos, n64) &&
                            readBinU64(frame, fpos, cat64) &&
                            readBinStr(frame, fpos, rec.status)) {
                            rec.shareIndex = static_cast<uint8_t>(idx64);
                            rec.accessKeyTime = static_cast<int64_t>(akt64);
                            rec.thresholdT = static_cast<uint32_t>(t64);
                            rec.totalN = static_cast<uint32_t>(n64);
                            rec.createdAt = static_cast<int64_t>(cat64);
                            m_cache[rec.txId] = rec;
                        }
                    }
                    return;
                }
            }
        }
    }

    // 2. Fallback: Load from SQLite .db text dump
    if (!std::filesystem::exists(m_dbPath)) return;

    std::ifstream ifs(m_dbPath);
    std::string line;
    while (std::getline(ifs, line)) {
        if (line.rfind("INSERT INTO ksm_shares VALUES (", 0) == 0) {
            size_t start = line.find('(');
            size_t end = line.rfind(')');
            if (start != std::string::npos && end != std::string::npos && end > start) {
                std::string content = line.substr(start + 1, end - start - 1);
                std::vector<std::string> tokens;
                std::stringstream ss(content);
                std::string token;
                while (std::getline(ss, token, ',')) {
                    size_t first = token.find_first_not_of(" '");
                    size_t last = token.find_last_not_of(" '");
                    if (first != std::string::npos && last != std::string::npos) {
                        tokens.push_back(token.substr(first, last - first + 1));
                    } else {
                        tokens.push_back("");
                    }
                }

                if (tokens.size() >= 11) {
                    StoredShareRecord rec;
                    rec.txId = tokens[0];
                    rec.dataId = tokens[1];
                    rec.doctorId = tokens[2];
                    rec.patientId = tokens[3];
                    rec.shareIndex = static_cast<uint8_t>(std::stoul(tokens[4]));
                    rec.shareHex = tokens[5];
                    rec.accessKeyTime = std::stoll(tokens[6]);
                    rec.thresholdT = static_cast<uint32_t>(std::stoul(tokens[7]));
                    rec.totalN = static_cast<uint32_t>(std::stoul(tokens[8]));
                    rec.createdAt = std::stoll(tokens[9]);
                    rec.status = tokens[10];
                    m_cache[rec.txId] = rec;
                } else if (tokens.size() >= 7) {
                    // Backward-compatibility fallback
                    StoredShareRecord rec;
                    rec.txId = tokens[0];
                    rec.shareIndex = static_cast<uint8_t>(std::stoul(tokens[1]));
                    rec.shareHex = tokens[2];
                    rec.thresholdT = static_cast<uint32_t>(std::stoul(tokens[3]));
                    rec.totalN = static_cast<uint32_t>(std::stoul(tokens[4]));
                    rec.createdAt = std::stoll(tokens[5]);
                    rec.status = tokens[6];
                    m_cache[rec.txId] = rec;
                }
            }
        }
    }
}

void KsmShareStorage::appendSqlRow(const StoredShareRecord& rec) {
    // 1. Append binary length-prefixed + CRC32-verified frame to .bin
    std::filesystem::path binPath = m_dbPath;
    binPath.replace_extension(".bin");
    {
        std::vector<uint8_t> frame;
        frame.reserve(256);
        writeBinStr(frame, rec.txId);
        writeBinStr(frame, rec.dataId);
        writeBinStr(frame, rec.doctorId);
        writeBinStr(frame, rec.patientId);
        writeBinU64(frame, static_cast<uint64_t>(rec.shareIndex));
        writeBinStr(frame, rec.shareHex);
        writeBinU64(frame, static_cast<uint64_t>(rec.accessKeyTime));
        writeBinU64(frame, static_cast<uint64_t>(rec.thresholdT));
        writeBinU64(frame, static_cast<uint64_t>(rec.totalN));
        writeBinU64(frame, static_cast<uint64_t>(rec.createdAt));
        writeBinStr(frame, rec.status);

        uint32_t magic = KSM_BIN_MAGIC;
        uint32_t payloadLen = static_cast<uint32_t>(frame.size());
        uint32_t crc = computeCrc32(frame.data(), frame.size());

        std::ofstream binOut(binPath, std::ios::binary | std::ios::app);
        if (binOut.is_open()) {
            binOut.write(reinterpret_cast<const char*>(&magic), 4);
            binOut.write(reinterpret_cast<const char*>(&payloadLen), 4);
            binOut.write(reinterpret_cast<const char*>(&crc), 4);
            binOut.write(reinterpret_cast<const char*>(frame.data()), static_cast<std::streamsize>(frame.size()));
            binOut.flush();
        }
    }

    // 2. Append human-readable SQLite row to .db
    std::ofstream ofs(m_dbPath, std::ios::app);
    ofs << "INSERT INTO ksm_shares VALUES ('"
        << rec.txId << "', '"
        << rec.dataId << "', '"
        << rec.doctorId << "', '"
        << rec.patientId << "', "
        << static_cast<int>(rec.shareIndex) << ", '"
        << rec.shareHex << "', "
        << rec.accessKeyTime << ", "
        << rec.thresholdT << ", "
        << rec.totalN << ", "
        << rec.createdAt << ", '"
        << rec.status << "');\n";
}

bool KsmShareStorage::storeShare(const std::string& txId,
                                const KeyShare& share,
                                uint32_t thresholdT,
                                uint32_t totalN,
                                const std::string& doctorId,
                                const std::string& patientId,
                                const std::string& dataId,
                                int64_t accessKeyTime,
                                const std::string& status) {
    std::lock_guard<std::mutex> lock(m_mutex);
    StoredShareRecord rec;
    rec.txId = txId;
    rec.dataId = dataId.empty() ? ("DATA-" + txId.substr(0, 8)) : dataId;
    rec.doctorId = doctorId;
    rec.patientId = patientId;
    rec.shareIndex = share.index;
    rec.shareHex = share.toHex();
    rec.accessKeyTime = accessKeyTime;
    rec.thresholdT = thresholdT;
    rec.totalN = totalN;
    rec.createdAt = std::time(nullptr);
    rec.status = status;

    m_cache[txId] = rec;
    appendSqlRow(rec);
    return true;
}

bool KsmShareStorage::isShareAccessValid(const std::string& txId, const std::string& doctorId, int64_t currentTime) const {
    std::lock_guard<std::mutex> lock(m_mutex);
    auto it = m_cache.find(txId);
    if (it == m_cache.end()) return false;
    if (it->second.status != "ACTIVE") return false;
    if (!doctorId.empty() && !it->second.doctorId.empty() && it->second.doctorId != doctorId) {
        return false;
    }
    if (it->second.accessKeyTime > 0 && currentTime > it->second.accessKeyTime) {
        return false; // Access expired
    }
    return true;
}

std::optional<KeyShare> KsmShareStorage::getShare(const std::string& txId) const {
    std::lock_guard<std::mutex> lock(m_mutex);
    auto it = m_cache.find(txId);
    if (it == m_cache.end()) {
        const_cast<KsmShareStorage*>(this)->loadFromDisk();
        it = m_cache.find(txId);
    }
    if (it == m_cache.end()) {
        return std::nullopt;
    }
    return KeyShare::fromHex(it->second.shareIndex, it->second.shareHex);
}

bool KsmShareStorage::hasShare(const std::string& txId) const {
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_cache.find(txId) != m_cache.end();
}

std::optional<StoredShareRecord> KsmShareStorage::getRecord(const std::string& txId) const {
    std::lock_guard<std::mutex> lock(m_mutex);
    auto it = m_cache.find(txId);
    if (it == m_cache.end()) {
        return std::nullopt;
    }
    return it->second;
}

std::vector<std::string> KsmShareStorage::getAllTxIds() const {
    std::lock_guard<std::mutex> lock(m_mutex);
    std::vector<std::string> ids;
    ids.reserve(m_cache.size());
    for (const auto& [txId, _] : m_cache) {
        ids.push_back(txId);
    }
    return ids;
}

size_t KsmShareStorage::getShareCount() const {
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_cache.size();
}

} // namespace CKsm
