#pragma once

#include <string>
#include <vector>
#include <cstdint>
#include <array>

namespace CCrypto {

class Sha256 {
public:
    Sha256();
    void update(const uint8_t* data, size_t length);
    void update(const std::string& str);
    std::array<uint8_t, 32> digest();
    std::string digestHex();

    // Convenience static helpers
    static std::string hashHex(const std::string& input);
    static std::string hashHex(const uint8_t* data, size_t length);
    static std::array<uint8_t, 32> hash(const uint8_t* data, size_t length);

private:
    void transform(const uint8_t chunk[64]);

    uint32_t m_state[8];
    uint64_t m_bitlen;
    uint8_t m_buffer[64];
    size_t m_buflen;
};

} // namespace CCrypto
