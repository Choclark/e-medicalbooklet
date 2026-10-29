#pragma once

#include <string>
#include <utility>

// ========================================================
// Consensus laws (evaluated in this order)
// ========================================================
namespace Law {
inline constexpr const char* SCHEMA    = "LAW-1 SCHEMA";        // every tx matches a registered schema
inline constexpr const char* SIZE      = "LAW-2 SIZE";          // tx / header / block size limits
inline constexpr const char* LINK      = "LAW-3 LINK";          // height + previous hash linkage
inline constexpr const char* INTEGRITY = "LAW-4 INTEGRITY";     // merkle root + header hash
inline constexpr const char* TIME      = "LAW-5 TIME";          // monotonic, bounded future drift
inline constexpr const char* PBFT      = "LAW-6 PBFT-METADATA"; // version, sequence, view, primary
inline constexpr const char* QUORUM    = "LAW-7 QUORUM";        // n-f valid commit signatures
} // namespace Law

struct ValidationResult {
    bool ok{true};
    std::string law;
    std::string message;

    static ValidationResult success() { return {}; }

    static ValidationResult failure(std::string law, std::string message) {
        ValidationResult r;
        r.ok = false;
        r.law = std::move(law);
        r.message = std::move(message);
        return r;
    }

    explicit operator bool() const { return ok; }
    std::string toString() const { return ok ? "OK" : "[" + law + "] " + message; }
};
