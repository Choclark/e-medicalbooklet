#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <bcrypt.h>
#pragma comment(lib, "bcrypt.lib")

#include "CryptoSigner.h"
#include "Sha256.h"
#include <sstream>
#include <iomanip>
#include <algorithm>
#include <cctype>
#include <cstring>
#include <iostream>

#ifndef NT_SUCCESS
#define NT_SUCCESS(Status) (((NTSTATUS)(Status)) >= 0)
#endif

namespace CCrypto {

std::string CryptoSigner::toHex(const uint8_t* data, size_t length) {
    std::stringstream ss;
    ss << std::hex << std::setfill('0');
    for (size_t i = 0; i < length; ++i) {
        ss << std::setw(2) << static_cast<unsigned int>(data[i]);
    }
    return ss.str();
}

std::vector<uint8_t> CryptoSigner::fromHex(const std::string& hexInput) {
    std::string hex = hexInput;
    if (hex.size() >= 2 && hex[0] == '0' && (hex[1] == 'x' || hex[1] == 'X')) {
        hex = hex.substr(2);
    }
    std::vector<uint8_t> bytes;
    bytes.reserve(hex.length() / 2);
    for (size_t i = 0; i + 1 < hex.length(); i += 2) {
        std::string byteStr = hex.substr(i, 2);
        char* endPtr = nullptr;
        unsigned long val = std::strtoul(byteStr.c_str(), &endPtr, 16);
        if (endPtr != byteStr.c_str() + 2) {
            continue;
        }
        bytes.push_back(static_cast<uint8_t>(val));
    }
    return bytes;
}

static std::vector<uint8_t> get32ByteHash(const std::string& messageOrHashInput) {
    std::string messageOrHash = messageOrHashInput;
    if (messageOrHash.size() == 66 && messageOrHash[0] == '0' && (messageOrHash[1] == 'x' || messageOrHash[1] == 'X')) {
        messageOrHash = messageOrHash.substr(2);
    }
    // If it's a 64-char valid hex string, it is already a 32-byte SHA-256 hash
    bool is64Hex = (messageOrHash.length() == 64) && std::all_of(messageOrHash.begin(), messageOrHash.end(), [](char c) {
        return std::isxdigit(static_cast<unsigned char>(c));
    });

    if (is64Hex) {
        return CryptoSigner::fromHex(messageOrHash);
    }
    // Otherwise, compute SHA-256 hash of the arbitrary message payload
    auto arr = Sha256::hash(reinterpret_cast<const uint8_t*>(messageOrHashInput.data()), messageOrHashInput.size());
    return std::vector<uint8_t>(arr.begin(), arr.end());
}

KeyPair CryptoSigner::generateKeyPair() {
    KeyPair kp;
    BCRYPT_ALG_HANDLE hAlg = nullptr;
    NTSTATUS status = BCryptOpenAlgorithmProvider(&hAlg, BCRYPT_ECDSA_P256_ALGORITHM, nullptr, 0);
    if (!NT_SUCCESS(status)) {
        std::cerr << "[CryptoSigner] BCryptOpenAlgorithmProvider failed: " << std::hex << status << "\n";
        return kp;
    }

    BCRYPT_KEY_HANDLE hKey = nullptr;
    status = BCryptGenerateKeyPair(hAlg, &hKey, 256, 0);
    if (!NT_SUCCESS(status)) {
        std::cerr << "[CryptoSigner] BCryptGenerateKeyPair failed: " << std::hex << status << "\n";
        BCryptCloseAlgorithmProvider(hAlg, 0);
        return kp;
    }

    status = BCryptFinalizeKeyPair(hKey, 0);
    if (!NT_SUCCESS(status)) {
        std::cerr << "[CryptoSigner] BCryptFinalizeKeyPair failed: " << std::hex << status << "\n";
        BCryptDestroyKey(hKey);
        BCryptCloseAlgorithmProvider(hAlg, 0);
        return kp;
    }

    // 1. Export Private Key Blob
    DWORD privBlobLen = 0;
    BCryptExportKey(hKey, nullptr, BCRYPT_ECCPRIVATE_BLOB, nullptr, 0, &privBlobLen, 0);
    std::vector<uint8_t> privBlob(privBlobLen);
    BCryptExportKey(hKey, nullptr, BCRYPT_ECCPRIVATE_BLOB, privBlob.data(), privBlobLen, &privBlobLen, 0);
    kp.privateKeyHex = toHex(privBlob.data(), privBlob.size());

    // 2. Export Public Key Blob (Extract raw 64-byte X || Y coordinates)
    DWORD pubBlobLen = 0;
    BCryptExportKey(hKey, nullptr, BCRYPT_ECCPUBLIC_BLOB, nullptr, 0, &pubBlobLen, 0);
    std::vector<uint8_t> pubBlob(pubBlobLen);
    BCryptExportKey(hKey, nullptr, BCRYPT_ECCPUBLIC_BLOB, pubBlob.data(), pubBlobLen, &pubBlobLen, 0);

    // The BCRYPT_ECCKEY_BLOB header is 8 bytes, followed by X (32 bytes) and Y (32 bytes)
    if (pubBlob.size() >= sizeof(BCRYPT_ECCKEY_BLOB) + 64) {
        const uint8_t* rawCoordinates = pubBlob.data() + sizeof(BCRYPT_ECCKEY_BLOB);
        kp.publicKeyHex = toHex(rawCoordinates, 64);
    } else {
        kp.publicKeyHex = toHex(pubBlob.data(), pubBlob.size());
    }

    // 3. Derive address as 0x + 40-char hex (Ethereum / Ledger style address)
    std::string pubHash = Sha256::hashHex(kp.publicKeyHex);
    kp.address = "0x" + pubHash.substr(0, 40);

    BCryptDestroyKey(hKey);
    BCryptCloseAlgorithmProvider(hAlg, 0);
    return kp;
}

std::string CryptoSigner::sign(const std::string& privateKeyHex, const std::string& messageOrHash) {
    std::vector<uint8_t> privBlob = fromHex(privateKeyHex);
    if (privBlob.empty()) {
        std::cerr << "[CryptoSigner::sign] Invalid private key hex format\n";
        return "";
    }

    BCRYPT_ALG_HANDLE hAlg = nullptr;
    NTSTATUS status = BCryptOpenAlgorithmProvider(&hAlg, BCRYPT_ECDSA_P256_ALGORITHM, nullptr, 0);
    if (!NT_SUCCESS(status)) {
        return "";
    }

    BCRYPT_KEY_HANDLE hKey = nullptr;
    status = BCryptImportKeyPair(hAlg, nullptr, BCRYPT_ECCPRIVATE_BLOB, &hKey, privBlob.data(), static_cast<ULONG>(privBlob.size()), 0);
    if (!NT_SUCCESS(status)) {
        std::cerr << "[CryptoSigner::sign] Failed to import private key: 0x" << std::hex << status << "\n";
        BCryptCloseAlgorithmProvider(hAlg, 0);
        return "";
    }

    std::vector<uint8_t> hashBytes = get32ByteHash(messageOrHash);

    DWORD sigLen = 0;
    BCryptSignHash(hKey, nullptr, hashBytes.data(), static_cast<ULONG>(hashBytes.size()), nullptr, 0, &sigLen, 0);
    std::vector<uint8_t> signature(sigLen);
    status = BCryptSignHash(hKey, nullptr, hashBytes.data(), static_cast<ULONG>(hashBytes.size()), signature.data(), sigLen, &sigLen, 0);

    BCryptDestroyKey(hKey);
    BCryptCloseAlgorithmProvider(hAlg, 0);

    if (!NT_SUCCESS(status)) {
        std::cerr << "[CryptoSigner::sign] BCryptSignHash failed: 0x" << std::hex << status << "\n";
        return "";
    }

    return toHex(signature.data(), sigLen);
}

bool CryptoSigner::verify(const std::string& publicKeyHex,
                          const std::string& messageOrHash,
                          const std::string& signatureHex) {
    if (publicKeyHex.empty() || signatureHex.empty()) {
        return false;
    }

    std::vector<uint8_t> rawCoords = fromHex(publicKeyHex);
    std::vector<uint8_t> sigBytes = fromHex(signatureHex);

    if (sigBytes.empty()) {
        return false;
    }

    // Build the BCRYPT_ECCPUBLIC_BLOB structure (8-byte header + 64 bytes coordinates)
    // Supports:
    //  1) Raw 64-byte X || Y coordinates (128 hex chars)
    //  2) Uncompressed SEC1 65-byte point 0x04 || X || Y (130 hex chars)
    //  3) X.509 SPKI DER P-256 public key (91 bytes ending with 0x04 || X || Y)
    //  4) Native Windows BCRYPT_ECCPUBLIC_BLOB (72 bytes starting with "ECS1")
    std::vector<uint8_t> pubBlob;
    if (rawCoords.size() == 65 && rawCoords[0] == 0x04) {
        rawCoords.erase(rawCoords.begin());
    } else if (rawCoords.size() > 65 && rawCoords[rawCoords.size() - 65] == 0x04) {
        rawCoords = std::vector<uint8_t>(rawCoords.end() - 64, rawCoords.end());
    }

    if (rawCoords.size() == 64) {
        BCRYPT_ECCKEY_BLOB header;
        header.dwMagic = BCRYPT_ECDSA_PUBLIC_P256_MAGIC; // "ECS1"
        header.cbKey = 32;

        pubBlob.resize(sizeof(BCRYPT_ECCKEY_BLOB) + 64);
        std::memcpy(pubBlob.data(), &header, sizeof(header));
        std::memcpy(pubBlob.data() + sizeof(BCRYPT_ECCKEY_BLOB), rawCoords.data(), 64);
    } else {
        pubBlob = std::move(rawCoords);
    }

    BCRYPT_ALG_HANDLE hAlg = nullptr;
    NTSTATUS status = BCryptOpenAlgorithmProvider(&hAlg, BCRYPT_ECDSA_P256_ALGORITHM, nullptr, 0);
    if (!NT_SUCCESS(status)) {
        return false;
    }

    BCRYPT_KEY_HANDLE hKey = nullptr;
    status = BCryptImportKeyPair(hAlg, nullptr, BCRYPT_ECCPUBLIC_BLOB, &hKey, pubBlob.data(), static_cast<ULONG>(pubBlob.size()), 0);
    if (!NT_SUCCESS(status)) {
        BCryptCloseAlgorithmProvider(hAlg, 0);
        return false;
    }

    std::vector<uint8_t> hashBytes = get32ByteHash(messageOrHash);

    status = BCryptVerifySignature(hKey, nullptr, hashBytes.data(), static_cast<ULONG>(hashBytes.size()),
                                   sigBytes.data(), static_cast<ULONG>(sigBytes.size()), 0);

    // Fallback: if the caller signed the ASCII representation of a 64-char hex digest
    // (such as WebCrypto SubtleCrypto.sign({name:"ECDSA", hash:"SHA-256"}, key, utf8Bytes(hexDigest)))
    if (!NT_SUCCESS(status) && !messageOrHash.empty()) {
        auto asciiHash = Sha256::hash(reinterpret_cast<const uint8_t*>(messageOrHash.data()), messageOrHash.size());
        status = BCryptVerifySignature(hKey, nullptr, const_cast<uint8_t*>(asciiHash.data()), static_cast<ULONG>(asciiHash.size()),
                                       sigBytes.data(), static_cast<ULONG>(sigBytes.size()), 0);
    }

    BCryptDestroyKey(hKey);
    BCryptCloseAlgorithmProvider(hAlg, 0);

    return NT_SUCCESS(status);
}

} // namespace CCrypto
