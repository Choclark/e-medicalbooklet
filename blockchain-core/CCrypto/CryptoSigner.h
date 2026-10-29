#pragma once

#include <string>
#include <vector>
#include <cstdint>

namespace CCrypto {

struct KeyPair {
    std::string privateKeyHex;  // Hex-encoded private key blob for signing
    std::string publicKeyHex;   // Hex-encoded uncompressed public key (X || Y coordinates, 128 hex chars)
    std::string address;        // Derived public address (e.g. "0x" + SHA-256 hash prefix)
};

class CryptoSigner {
public:
    // Generate a new ECDSA P-256 (secp256r1) keypair
    static KeyPair generateKeyPair();

    // Sign a message (or SHA-256 hash hex) using a private key -> returns 64-byte ECDSA signature in hex (r || s, 128 hex chars)
    static std::string sign(const std::string& privateKeyHex, const std::string& messageOrHash);

    // Verify an ECDSA signature using a public key against a message (or hash) -> returns true if valid, false if invalid or forged
    static bool verify(const std::string& publicKeyHex,
                       const std::string& messageOrHash,
                       const std::string& signatureHex);

    // Helper: converts raw byte array to lowercase hexadecimal string
    static std::string toHex(const uint8_t* data, size_t length);

    // Helper: converts hexadecimal string to raw byte vector
    static std::vector<uint8_t> fromHex(const std::string& hex);
};

} // namespace CCrypto
