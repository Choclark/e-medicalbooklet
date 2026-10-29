#include "ShamirSecretSharing.h"
#include <windows.h>
#include <bcrypt.h>
#include <sstream>
#include <iomanip>
#include <stdexcept>
#include <algorithm>
#include <random>

namespace CKsm {

std::string KeyShare::toHex() const {
    std::ostringstream oss;
    for (uint8_t b : data) {
        oss << std::hex << std::setw(2) << std::setfill('0') << static_cast<int>(b);
    }
    return oss.str();
}

KeyShare KeyShare::fromHex(uint8_t index, const std::string& hex) {
    KeyShare ks;
    ks.index = index;
    ks.data.reserve(hex.length() / 2);
    for (size_t i = 0; i + 1 < hex.length(); i += 2) {
        std::string byteStr = hex.substr(i, 2);
        uint8_t b = static_cast<uint8_t>(std::stoul(byteStr, nullptr, 16));
        ks.data.push_back(b);
    }
    return ks;
}

ShamirSecretSharing::ShamirSecretSharing() : m_gf() {}

std::vector<uint8_t> ShamirSecretSharing::generateRandomBytes(size_t count) {
    std::vector<uint8_t> buffer(count);
    NTSTATUS status = BCryptGenRandom(nullptr, buffer.data(), static_cast<ULONG>(count), BCRYPT_USE_SYSTEM_PREFERRED_RNG);
    if (status != 0) {
        // Fallback to std::random_device if CNG is unavailable
        std::random_device rd;
        for (size_t i = 0; i < count; ++i) {
            buffer[i] = static_cast<uint8_t>(rd() & 0xFF);
        }
    }
    return buffer;
}

std::vector<KeyShare> ShamirSecretSharing::splitSecret(const std::vector<uint8_t>& secret,
                                                      uint32_t threshold_t,
                                                      uint32_t total_n,
                                                      uint8_t startCoordinate) const {
    if (secret.empty()) {
        throw std::invalid_argument("splitSecret: secret cannot be empty");
    }
    if (threshold_t == 0 || threshold_t > total_n) {
        throw std::invalid_argument("splitSecret: invalid threshold (must satisfy 1 <= t <= n)");
    }
    if (total_n > 254) {
        throw std::invalid_argument("splitSecret: total_n cannot exceed 254 in GF(2^8)");
    }
    if (static_cast<uint32_t>(startCoordinate) + total_n > 255) {
        throw std::invalid_argument("splitSecret: coordinates exceed field boundary");
    }

    std::vector<KeyShare> shares(total_n);
    for (uint32_t i = 0; i < total_n; ++i) {
        shares[i].index = static_cast<uint8_t>(startCoordinate + i);
        shares[i].data.resize(secret.size());
    }

    // For each byte of the secret, generate a random polynomial:
    // P(x) = secret_byte + a_1*x + a_2*x^2 + ... + a_{t-1}*x^{t-1}
    for (size_t byteIdx = 0; byteIdx < secret.size(); ++byteIdx) {
        std::vector<uint8_t> coeffs(threshold_t);
        coeffs[0] = secret[byteIdx]; // Constant term P(0) = secret[byteIdx]

        if (threshold_t > 1) {
            auto randomCoeffs = generateRandomBytes(threshold_t - 1);
            for (size_t k = 1; k < threshold_t; ++k) {
                coeffs[k] = randomCoeffs[k - 1];
            }
        }

        // Evaluate P(x_i) for each share
        for (uint32_t i = 0; i < total_n; ++i) {
            shares[i].data[byteIdx] = m_gf.evalPolynomial(coeffs, shares[i].index);
        }
    }

    return shares;
}

std::vector<uint8_t> ShamirSecretSharing::reconstructSecret(const std::vector<KeyShare>& shares,
                                                           uint32_t threshold_t) const {
    if (shares.size() < threshold_t) {
        throw std::invalid_argument("reconstructSecret: not enough shares provided for threshold");
    }
    if (shares.empty()) {
        throw std::invalid_argument("reconstructSecret: shares cannot be empty");
    }

    size_t secretSize = shares[0].data.size();
    for (size_t i = 1; i < threshold_t; ++i) {
        if (shares[i].data.size() != secretSize) {
            throw std::invalid_argument("reconstructSecret: share size mismatch");
        }
    }

    // Extract x coordinates of the first t shares used
    std::vector<uint8_t> xCoords(threshold_t);
    for (size_t i = 0; i < threshold_t; ++i) {
        xCoords[i] = shares[i].index;
    }

    // Precompute Lagrange basis weights evaluated at x = 0:
    // l_i(0) = \prod_{j != i} (0 - x_j) / (x_i - x_j)
    std::vector<uint8_t> lagrangeWeights(threshold_t);
    for (size_t i = 0; i < threshold_t; ++i) {
        lagrangeWeights[i] = m_gf.lagrangeBasis(xCoords, i, 0);
    }

    // Reconstruct each byte using Lagrange interpolation
    std::vector<uint8_t> secret(secretSize);
    for (size_t byteIdx = 0; byteIdx < secretSize; ++byteIdx) {
        uint8_t val = 0;
        for (size_t i = 0; i < threshold_t; ++i) {
            uint8_t term = m_gf.mul(shares[i].data[byteIdx], lagrangeWeights[i]);
            val = GF256::add(val, term);
        }
        secret[byteIdx] = val;
    }

    return secret;
}

KeyShare ShamirSecretSharing::deriveCatchupShare(const std::vector<KeyShare>& existingShares,
                                                uint8_t newIndex,
                                                uint32_t threshold_t) const {
    if (existingShares.size() < threshold_t) {
        throw std::invalid_argument("deriveCatchupShare: insufficient shares for quorum");
    }
    if (newIndex == 0) {
        throw std::invalid_argument("deriveCatchupShare: new coordinate cannot be 0");
    }

    size_t secretSize = existingShares[0].data.size();
    std::vector<uint8_t> xCoords(threshold_t);
    for (size_t i = 0; i < threshold_t; ++i) {
        xCoords[i] = existingShares[i].index;
        if (xCoords[i] == newIndex) {
            throw std::invalid_argument("deriveCatchupShare: coordinate collision with existing share");
        }
    }

    // Precompute Lagrange basis weights evaluated at x = newIndex:
    // l_i(newIndex) = \prod_{j != i} (newIndex ^ x_j) / (x_i ^ x_j)
    std::vector<uint8_t> lagrangeWeights(threshold_t);
    for (size_t i = 0; i < threshold_t; ++i) {
        lagrangeWeights[i] = m_gf.lagrangeBasis(xCoords, i, newIndex);
    }

    KeyShare catchupShare;
    catchupShare.index = newIndex;
    catchupShare.data.resize(secretSize);

    for (size_t byteIdx = 0; byteIdx < secretSize; ++byteIdx) {
        uint8_t val = 0;
        for (size_t i = 0; i < threshold_t; ++i) {
            uint8_t term = m_gf.mul(existingShares[i].data[byteIdx], lagrangeWeights[i]);
            val = GF256::add(val, term);
        }
        catchupShare.data[byteIdx] = val;
    }

    return catchupShare;
}

} // namespace CKsm
