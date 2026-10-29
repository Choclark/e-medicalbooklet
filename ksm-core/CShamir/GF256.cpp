#include "GF256.h"
#include <cstring>
#include <stdexcept>

namespace CKsm {

GF256::GF256() {
    initTables();
}

void GF256::initTables() {
    std::memset(m_exp, 0, sizeof(m_exp));
    std::memset(m_log, 0, sizeof(m_log));

    // Primitive polynomial: 0x11B (x^8 + x^4 + x^3 + x + 1)
    // Generator: 3
    uint8_t x = 1;
    for (int i = 0; i < 255; ++i) {
        m_exp[i] = x;
        m_exp[i + 255] = x;
        m_log[x] = static_cast<uint8_t>(i);

        // Multiply by 3 in GF(2^8): (x * 2) ^ x
        uint16_t x2 = static_cast<uint16_t>(x << 1);
        if (x & 0x80) {
            x2 ^= 0x11B;
        }
        x = static_cast<uint8_t>(x2 ^ x);
    }
    m_exp[510] = m_exp[0];
    m_exp[511] = m_exp[1];
    m_log[0] = 0; // Logarithm of 0 is mathematically undefined
}

uint8_t GF256::mul(uint8_t a, uint8_t b) const {
    if (a == 0 || b == 0) {
        return 0;
    }
    return m_exp[static_cast<size_t>(m_log[a]) + static_cast<size_t>(m_log[b])];
}

uint8_t GF256::inv(uint8_t a) const {
    if (a == 0) {
        throw std::domain_error("GF256: division by zero in field inversion");
    }
    return m_exp[255 - static_cast<size_t>(m_log[a])];
}

uint8_t GF256::div(uint8_t a, uint8_t b) const {
    if (b == 0) {
        throw std::domain_error("GF256: division by zero in field division");
    }
    if (a == 0) {
        return 0;
    }
    size_t idx = static_cast<size_t>(m_log[a]) + 255 - static_cast<size_t>(m_log[b]);
    return m_exp[idx];
}

uint8_t GF256::evalPolynomial(const std::vector<uint8_t>& coeffs, uint8_t x) const {
    if (coeffs.empty()) {
        return 0;
    }
    if (x == 0) {
        return coeffs[0]; // P(0) is the constant term (the secret)
    }

    // Horner's method for polynomial evaluation:
    // P(x) = c0 + x * (c1 + x * (c2 + ... ))
    uint8_t result = 0;
    for (size_t i = coeffs.size(); i-- > 0;) {
        result = add(mul(result, x), coeffs[i]);
    }
    return result;
}

uint8_t GF256::lagrangeBasis(const std::vector<uint8_t>& xCoords, size_t i, uint8_t xTarget) const {
    uint8_t xi = xCoords[i];
    uint8_t num = 1;
    uint8_t den = 1;

    for (size_t j = 0; j < xCoords.size(); ++j) {
        if (j == i) continue;
        uint8_t xj = xCoords[j];

        // In GF(2^8): (xTarget - xj) == (xTarget ^ xj)
        //             (xi - xj)      == (xi ^ xj)
        num = mul(num, sub(xTarget, xj));
        den = mul(den, sub(xi, xj));
    }

    return div(num, den);
}

} // namespace CKsm
