#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace CKsm {

struct AesGcmResult {
    std::vector<uint8_t> iv;         // 12-byte initialization vector (nonce)
    std::vector<uint8_t> tag;        // 16-byte authentication tag
    std::vector<uint8_t> ciphertext; // Encrypted data payload

    std::string ivHex() const;
    std::string tagHex() const;
    std::string ciphertextHex() const;
};

class AesGcmCipher {
public:
    // Generate cryptographically secure random bytes
    static std::vector<uint8_t> generateRandom(size_t count);

    // Encrypt plaintext with 256-bit DEK using AES-256-GCM
    static AesGcmResult encrypt(const std::vector<uint8_t>& key,
                                const std::vector<uint8_t>& plaintext,
                                const std::vector<uint8_t>& iv = {});

    // Decrypt ciphertext with 256-bit DEK; throws if authentication tag fails
    static std::vector<uint8_t> decrypt(const std::vector<uint8_t>& key,
                                        const std::vector<uint8_t>& iv,
                                        const std::vector<uint8_t>& tag,
                                        const std::vector<uint8_t>& ciphertext);

    // Helper: hex encoding / decoding
    static std::string toHex(const uint8_t* data, size_t length);
    static std::string toHex(const std::vector<uint8_t>& bytes);
    static std::vector<uint8_t> fromHex(const std::string& hex);
};

} // namespace CKsm
