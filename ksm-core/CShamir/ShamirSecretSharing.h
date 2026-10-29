#pragma once

#include <cstdint>
#include <string>
#include <vector>
#include "GF256.h"

namespace CKsm {

struct KeyShare {
    uint8_t index{0};           // Polynomial evaluation point x_i (1, 2, 3, ...)
    std::vector<uint8_t> data;  // Share bytes y_i (same length as secret, e.g. 32 bytes for DEK)

    std::string toHex() const;
    static KeyShare fromHex(uint8_t index, const std::string& hex);
};

class ShamirSecretSharing {
public:
    ShamirSecretSharing();

    // Split an arbitrary secret (e.g. 256-bit DEK) into n shares with threshold t
    // Any t shares can reconstruct the secret; t-1 shares reveal zero information.
    std::vector<KeyShare> splitSecret(const std::vector<uint8_t>& secret,
                                      uint32_t threshold_t,
                                      uint32_t total_n,
                                      uint8_t startCoordinate = 1) const;

    // Reconstruct secret using at least t valid shares
    std::vector<uint8_t> reconstructSecret(const std::vector<KeyShare>& shares,
                                           uint32_t threshold_t) const;

    // Proactive Resharing / Dynamic Node Catch-up:
    // Derives a new share at coordinate 'newIndex' using t existing shares
    // without ever having to disclose the master secret in cleartext!
    KeyShare deriveCatchupShare(const std::vector<KeyShare>& existingShares,
                                uint8_t newIndex,
                                uint32_t threshold_t) const;

    // Verify if a reconstructed secret matches an expected hash
    static bool verifyHash(const std::vector<uint8_t>& secret, const std::string& expectedSha256Hex);

private:
    GF256 m_gf;
    static std::vector<uint8_t> generateRandomBytes(size_t count);
};

} // namespace CKsm
