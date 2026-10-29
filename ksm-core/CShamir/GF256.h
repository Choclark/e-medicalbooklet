#pragma once

#include <cstdint>
#include <vector>

namespace CKsm {

// Galois Field GF(2^8) arithmetic using irreducible polynomial:
// P(x) = x^8 + x^4 + x^3 + x + 1 (0x11B - Rijndael / AES standard field)
class GF256 {
public:
    GF256();

    // Addition and Subtraction in characteristic 2 is bitwise XOR: a ^ b
    static inline uint8_t add(uint8_t a, uint8_t b) { return a ^ b; }
    static inline uint8_t sub(uint8_t a, uint8_t b) { return a ^ b; }

    // Multiplication in GF(2^8)
    uint8_t mul(uint8_t a, uint8_t b) const;

    // Multiplicative Inverse: a^-1 such that a * a^-1 = 1 (inv(0) is invalid/0)
    uint8_t inv(uint8_t a) const;

    // Division in GF(2^8): a / b = a * inv(b)
    uint8_t div(uint8_t a, uint8_t b) const;

    // Evaluate polynomial P(x) = c0 + c1*x + c2*x^2 + ... at point x
    uint8_t evalPolynomial(const std::vector<uint8_t>& coeffs, uint8_t x) const;

    // Compute Lagrange basis coefficient: l_i(x_target) = \prod_{j != i} (x_target ^ x_j) / (x_i ^ x_j)
    uint8_t lagrangeBasis(const std::vector<uint8_t>& xCoords, size_t i, uint8_t xTarget) const;

private:
    uint8_t m_exp[512]; // Exponent table (doubled to avoid modulo)
    uint8_t m_log[256]; // Logarithm table
    void initTables();
};

} // namespace CKsm
