#include "AesGcmCipher.h"
#include <windows.h>
#include <bcrypt.h>
#include <sstream>
#include <iomanip>
#include <stdexcept>
#include <random>

#ifndef NT_SUCCESS
#define NT_SUCCESS(Status) (((NTSTATUS)(Status)) >= 0)
#endif

namespace CKsm {

std::string AesGcmResult::ivHex() const {
    return AesGcmCipher::toHex(iv);
}

std::string AesGcmResult::tagHex() const {
    return AesGcmCipher::toHex(tag);
}

std::string AesGcmResult::ciphertextHex() const {
    return AesGcmCipher::toHex(ciphertext);
}

std::string AesGcmCipher::toHex(const uint8_t* data, size_t length) {
    std::ostringstream oss;
    for (size_t i = 0; i < length; ++i) {
        oss << std::hex << std::setw(2) << std::setfill('0') << static_cast<int>(data[i]);
    }
    return oss.str();
}

std::string AesGcmCipher::toHex(const std::vector<uint8_t>& bytes) {
    return toHex(bytes.data(), bytes.size());
}

std::vector<uint8_t> AesGcmCipher::fromHex(const std::string& hex) {
    std::vector<uint8_t> bytes;
    bytes.reserve(hex.length() / 2);
    for (size_t i = 0; i + 1 < hex.length(); i += 2) {
        std::string byteStr = hex.substr(i, 2);
        uint8_t b = static_cast<uint8_t>(std::stoul(byteStr, nullptr, 16));
        bytes.push_back(b);
    }
    return bytes;
}

std::vector<uint8_t> AesGcmCipher::generateRandom(size_t count) {
    std::vector<uint8_t> buffer(count);
    NTSTATUS status = BCryptGenRandom(nullptr, buffer.data(), static_cast<ULONG>(count), BCRYPT_USE_SYSTEM_PREFERRED_RNG);
    if (!NT_SUCCESS(status)) {
        std::random_device rd;
        for (size_t i = 0; i < count; ++i) {
            buffer[i] = static_cast<uint8_t>(rd() & 0xFF);
        }
    }
    return buffer;
}

AesGcmResult AesGcmCipher::encrypt(const std::vector<uint8_t>& key,
                                   const std::vector<uint8_t>& plaintext,
                                   const std::vector<uint8_t>& iv) {
    if (key.size() != 16 && key.size() != 24 && key.size() != 32) {
        throw std::invalid_argument("AesGcmCipher::encrypt: invalid key size (must be 128, 192, or 256 bits)");
    }

    AesGcmResult result;
    // Standard GCM recommends a 12-byte (96-bit) IV
    result.iv = iv.empty() ? generateRandom(12) : iv;
    result.tag.resize(16); // Standard 128-bit authentication tag

    BCRYPT_ALG_HANDLE hAlg = nullptr;
    NTSTATUS status = BCryptOpenAlgorithmProvider(&hAlg, BCRYPT_AES_ALGORITHM, nullptr, 0);
    if (!NT_SUCCESS(status)) {
        throw std::runtime_error("AesGcmCipher: failed to open AES algorithm provider");
    }

    status = BCryptSetProperty(hAlg, BCRYPT_CHAINING_MODE,
                               reinterpret_cast<PUCHAR>(const_cast<wchar_t*>(BCRYPT_CHAIN_MODE_GCM)),
                               sizeof(BCRYPT_CHAIN_MODE_GCM), 0);
    if (!NT_SUCCESS(status)) {
        BCryptCloseAlgorithmProvider(hAlg, 0);
        throw std::runtime_error("AesGcmCipher: failed to set GCM chaining mode");
    }

    DWORD cbKeyObject = 0;
    DWORD cbData = 0;
    BCryptGetProperty(hAlg, BCRYPT_OBJECT_LENGTH, reinterpret_cast<PUCHAR>(&cbKeyObject), sizeof(DWORD), &cbData, 0);
    std::vector<uint8_t> keyObject(cbKeyObject);

    BCRYPT_KEY_HANDLE hKey = nullptr;
    status = BCryptGenerateSymmetricKey(hAlg, &hKey, keyObject.data(), cbKeyObject,
                                        const_cast<PUCHAR>(key.data()), static_cast<ULONG>(key.size()), 0);
    if (!NT_SUCCESS(status)) {
        BCryptCloseAlgorithmProvider(hAlg, 0);
        throw std::runtime_error("AesGcmCipher: failed to generate symmetric key");
    }

    BCRYPT_AUTHENTICATED_CIPHER_MODE_INFO authInfo;
    BCRYPT_INIT_AUTH_MODE_INFO(authInfo);
    authInfo.pbNonce = result.iv.data();
    authInfo.cbNonce = static_cast<ULONG>(result.iv.size());
    authInfo.pbTag = result.tag.data();
    authInfo.cbTag = static_cast<ULONG>(result.tag.size());

    result.ciphertext.resize(plaintext.size());
    DWORD cbResult = 0;
    status = BCryptEncrypt(hKey, const_cast<PUCHAR>(plaintext.data()), static_cast<ULONG>(plaintext.size()),
                           &authInfo, nullptr, 0, result.ciphertext.data(),
                           static_cast<ULONG>(result.ciphertext.size()), &cbResult, 0);

    BCryptDestroyKey(hKey);
    BCryptCloseAlgorithmProvider(hAlg, 0);

    if (!NT_SUCCESS(status)) {
        throw std::runtime_error("AesGcmCipher: encryption failed (NTSTATUS 0x" + toHex(reinterpret_cast<uint8_t*>(&status), 4) + ")");
    }

    return result;
}

std::vector<uint8_t> AesGcmCipher::decrypt(const std::vector<uint8_t>& key,
                                           const std::vector<uint8_t>& iv,
                                           const std::vector<uint8_t>& tag,
                                           const std::vector<uint8_t>& ciphertext) {
    if (key.size() != 16 && key.size() != 24 && key.size() != 32) {
        throw std::invalid_argument("AesGcmCipher::decrypt: invalid key size");
    }
    if (tag.size() != 16) {
        throw std::invalid_argument("AesGcmCipher::decrypt: invalid GCM tag size (must be 16 bytes)");
    }

    BCRYPT_ALG_HANDLE hAlg = nullptr;
    NTSTATUS status = BCryptOpenAlgorithmProvider(&hAlg, BCRYPT_AES_ALGORITHM, nullptr, 0);
    if (!NT_SUCCESS(status)) {
        throw std::runtime_error("AesGcmCipher: failed to open AES provider");
    }

    status = BCryptSetProperty(hAlg, BCRYPT_CHAINING_MODE,
                               reinterpret_cast<PUCHAR>(const_cast<wchar_t*>(BCRYPT_CHAIN_MODE_GCM)),
                               sizeof(BCRYPT_CHAIN_MODE_GCM), 0);
    if (!NT_SUCCESS(status)) {
        BCryptCloseAlgorithmProvider(hAlg, 0);
        throw std::runtime_error("AesGcmCipher: failed to set GCM chaining mode");
    }

    DWORD cbKeyObject = 0;
    DWORD cbData = 0;
    BCryptGetProperty(hAlg, BCRYPT_OBJECT_LENGTH, reinterpret_cast<PUCHAR>(&cbKeyObject), sizeof(DWORD), &cbData, 0);
    std::vector<uint8_t> keyObject(cbKeyObject);

    BCRYPT_KEY_HANDLE hKey = nullptr;
    status = BCryptGenerateSymmetricKey(hAlg, &hKey, keyObject.data(), cbKeyObject,
                                        const_cast<PUCHAR>(key.data()), static_cast<ULONG>(key.size()), 0);
    if (!NT_SUCCESS(status)) {
        BCryptCloseAlgorithmProvider(hAlg, 0);
        throw std::runtime_error("AesGcmCipher: failed to generate symmetric key for decrypt");
    }

    // Set up auth info for decryption
    BCRYPT_AUTHENTICATED_CIPHER_MODE_INFO authInfo;
    BCRYPT_INIT_AUTH_MODE_INFO(authInfo);
    authInfo.pbNonce = const_cast<PUCHAR>(iv.data());
    authInfo.cbNonce = static_cast<ULONG>(iv.size());
    authInfo.pbTag = const_cast<PUCHAR>(tag.data());
    authInfo.cbTag = static_cast<ULONG>(tag.size());

    std::vector<uint8_t> plaintext(ciphertext.size());
    DWORD cbResult = 0;
    status = BCryptDecrypt(hKey, const_cast<PUCHAR>(ciphertext.data()), static_cast<ULONG>(ciphertext.size()),
                           &authInfo, nullptr, 0, plaintext.data(),
                           static_cast<ULONG>(plaintext.size()), &cbResult, 0);

    BCryptDestroyKey(hKey);
    BCryptCloseAlgorithmProvider(hAlg, 0);

    if (!NT_SUCCESS(status)) {
        // Tag mismatch or corrupted key / ciphertext
        throw std::runtime_error("AesGcmCipher: authentication failed (tag mismatch or invalid key)");
    }

    plaintext.resize(cbResult);
    return plaintext;
}

} // namespace CKsm
