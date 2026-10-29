#pragma once

#include <cstdint>
#include <cstring>
#include <string>
#include <vector>
#include <stdexcept>
#include <limits>

// ========================================================
// ByteWriter - compact little-endian binary encoder
// ========================================================
class ByteWriter {
public:
    ByteWriter() = default;
    ~ByteWriter() {
        m_buf.clear();
        m_buf.shrink_to_fit();
    }

    void reserve(size_t n) { m_buf.reserve(n); }

    void writeU8(uint8_t v) { m_buf.push_back(v); }

    void writeU32(uint32_t v) {
        for (int i = 0; i < 4; ++i) m_buf.push_back(static_cast<uint8_t>(v >> (8 * i)));
    }

    void writeU64(uint64_t v) {
        for (int i = 0; i < 8; ++i) m_buf.push_back(static_cast<uint8_t>(v >> (8 * i)));
    }

    void writeI64(int64_t v) { writeU64(static_cast<uint64_t>(v)); }

    // Length-prefixed string: [u32 length][bytes]
    void writeString(const std::string& s) {
        if (s.size() > (std::numeric_limits<uint32_t>::max)()) {
            throw std::length_error("ByteWriter: string too long");
        }
        writeU32(static_cast<uint32_t>(s.size()));
        m_buf.insert(m_buf.end(), s.begin(), s.end());
    }

    // Fixed-width string, zero padded (used for fixed-size index records)
    void writeFixedString(const std::string& s, size_t width) {
        if (s.size() > width) {
            throw std::length_error("ByteWriter: fixed string exceeds field width");
        }
        m_buf.insert(m_buf.end(), s.begin(), s.end());
        m_buf.insert(m_buf.end(), width - s.size(), 0);
    }

    void writeBytes(const uint8_t* data, size_t n) { m_buf.insert(m_buf.end(), data, data + n); }

    const std::vector<uint8_t>& data() const { return m_buf; }
    std::vector<uint8_t>& data() { return m_buf; }

private:
    std::vector<uint8_t> m_buf;
};

// ========================================================
// ByteReader - bounds-checked little-endian binary decoder
// ========================================================
class ByteReader {
public:
    ByteReader(const uint8_t* data, size_t size) : m_data(data), m_size(size) {}
    ~ByteReader() {
        m_data = nullptr;
        m_size = 0;
        m_pos = 0;
    }

    uint8_t readU8() {
        require(1);
        return m_data[m_pos++];
    }

    uint32_t readU32() {
        require(4);
        uint32_t v = 0;
        for (int i = 0; i < 4; ++i) v |= static_cast<uint32_t>(m_data[m_pos + i]) << (8 * i);
        m_pos += 4;
        return v;
    }

    uint64_t readU64() {
        require(8);
        uint64_t v = 0;
        for (int i = 0; i < 8; ++i) v |= static_cast<uint64_t>(m_data[m_pos + i]) << (8 * i);
        m_pos += 8;
        return v;
    }

    int64_t readI64() { return static_cast<int64_t>(readU64()); }

    std::string readString() {
        uint32_t n = readU32();
        require(n);
        std::string s(reinterpret_cast<const char*>(m_data + m_pos), n);
        m_pos += n;
        return s;
    }

    std::string readFixedString(size_t width) {
        require(width);
        const char* p = reinterpret_cast<const char*>(m_data + m_pos);
        size_t len = 0;
        while (len < width && p[len] != '\0') ++len;
        m_pos += width;
        return std::string(p, len);
    }

    const uint8_t* readBytes(size_t n) {
        require(n);
        const uint8_t* p = m_data + m_pos;
        m_pos += n;
        return p;
    }

    size_t remaining() const { return m_size - m_pos; }

private:
    void require(size_t n) const {
        if (m_size - m_pos < n) {
            throw std::runtime_error("ByteReader: unexpected end of data");
        }
    }

    const uint8_t* m_data;
    size_t m_size;
    size_t m_pos{0};
};
