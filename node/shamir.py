#!/usr/bin/env python3
"""
Threshold Cryptography: Galois Field GF(2^8) & Shamir's Secret Sharing (SSS)
=============================================================================
Pure-Python implementation of GF(2^8) arithmetic and Shamir's Secret Sharing
designed to be 100% mathematically and byte-level compatible with the C++
ksm-core engine (primitive polynomial 0x11B, generator 3).

Supports:
  - Splitting arbitrary secret keys (e.g. 256-bit AES DEK, ECC private keys)
    into N shares with threshold T.
  - Reconstructing secret keys from any subset of >= T shares using
    Lagrange polynomial interpolation over GF(2^8).
  - Authenticated AES-256-GCM envelope encryption and decryption for off-chain
    emergency medical records.
"""

import os
import hashlib
from typing import List, Tuple, Dict, Optional


class GF256:
    """Galois Field GF(2^8) arithmetic matching C++ ksm-core (0x11B polynomial)."""

    def __init__(self):
        self.exp = [0] * 512
        self.log = [0] * 256
        x = 1
        for i in range(255):
            self.exp[i] = x
            self.exp[i + 255] = x
            self.log[x] = i
            x2 = (x << 1)
            if x & 0x80:
                x2 ^= 0x11B
            x = (x2 ^ x) & 0xFF
        self.exp[510] = self.exp[0]
        self.exp[511] = self.exp[1]
        self.log[0] = 0

    @staticmethod
    def add(a: int, b: int) -> int:
        return a ^ b

    @staticmethod
    def sub(a: int, b: int) -> int:
        return a ^ b

    def mul(self, a: int, b: int) -> int:
        if a == 0 or b == 0:
            return 0
        return self.exp[self.log[a] + self.log[b]]

    def inv(self, a: int) -> int:
        if a == 0:
            raise ZeroDivisionError("GF256: division by zero in field inversion")
        return self.exp[255 - self.log[a]]

    def div(self, a: int, b: int) -> int:
        if b == 0:
            raise ZeroDivisionError("GF256: division by zero in field division")
        if a == 0:
            return 0
        return self.exp[self.log[a] + 255 - self.log[b]]

    def lagrange_basis(self, x_coords: List[int], i: int, x_target: int = 0) -> int:
        """Compute Lagrange basis polynomial weight l_i(x_target) over GF(2^8)."""
        xi = x_coords[i]
        num = 1
        den = 1
        for j, xj in enumerate(x_coords):
            if j == i:
                continue
            num = self.mul(num, self.add(x_target, xj))
            den = self.mul(den, self.add(xi, xj))
        return self.div(num, den)


class KeyShare:
    """Represents a single Shamir polynomial share (x_i, y_i)."""

    def __init__(self, index: int, data: bytes):
        if not (1 <= index <= 255):
            raise ValueError(f"Share index must be 1..255, got {index}")
        self.index = index
        self.data = data

    def to_hex(self) -> str:
        return self.data.hex()

    @classmethod
    def from_hex(cls, index: int, hex_str: str) -> "KeyShare":
        return cls(index, bytes.fromhex(hex_str))

    def __repr__(self) -> str:
        return f"KeyShare(index={self.index}, len={len(self.data)}, hex={self.to_hex()[:16]}...)"


class ShamirSecretSharing:
    """Threshold secret sharing over GF(2^8)."""

    def __init__(self):
        self.gf = GF256()

    def split_secret(
        self,
        secret: bytes,
        threshold_t: int,
        total_n: int,
        start_coord: int = 1,
    ) -> List[KeyShare]:
        """
        Split secret into total_n shares with threshold_t.
        Any threshold_t shares can reconstruct the secret; fewer reveal zero information.
        """
        if not secret:
            raise ValueError("Secret cannot be empty")
        if not (1 <= threshold_t <= total_n <= 254):
            raise ValueError("Invalid parameters: must satisfy 1 <= t <= n <= 254")
        if start_coord + total_n > 255:
            raise ValueError("Coordinates exceed GF(2^8) boundary")

        # For each byte of the secret, generate random polynomial:
        # P(x) = secret[i] + a1*x + a2*x^2 + ... + a_{t-1}*x^{t-1}
        polys: List[List[int]] = []
        for b in secret:
            coeffs = [b] + list(os.urandom(threshold_t - 1))
            polys.append(coeffs)

        shares: List[KeyShare] = []
        for i in range(total_n):
            x = start_coord + i
            share_bytes = bytearray()
            for coeffs in polys:
                # Horner evaluation: c0 + x * (c1 + x * (...))
                val = 0
                for c in reversed(coeffs):
                    val = self.gf.add(self.gf.mul(val, x), c)
                share_bytes.append(val)
            shares.append(KeyShare(x, bytes(share_bytes)))

        return shares

    def reconstruct_secret(self, shares: List[KeyShare], threshold_t: int) -> bytes:
        """
        Reconstruct the master secret from at least threshold_t shares.
        Uses Lagrange polynomial interpolation evaluated at x = 0.
        """
        if len(shares) < threshold_t:
            raise ValueError(
                f"Insufficient shares for reconstruction: got {len(shares)}, required {threshold_t}"
            )
        subset = shares[:threshold_t]
        secret_len = len(subset[0].data)
        for s in subset:
            if len(s.data) != secret_len:
                raise ValueError("Share byte length mismatch")

        x_coords = [s.index for s in subset]
        if len(set(x_coords)) != len(x_coords):
            raise ValueError("Duplicate share indices provided")

        weights = [self.gf.lagrange_basis(x_coords, i, 0) for i in range(threshold_t)]

        secret = bytearray()
        for byte_idx in range(secret_len):
            val = 0
            for i in range(threshold_t):
                term = self.gf.mul(subset[i].data[byte_idx], weights[i])
                val = self.gf.add(val, term)
            secret.append(val)

        return bytes(secret)


# =============================================================================
# AES-256-GCM ENCRYPTION / DECRYPTION HELPERS FOR CLINICAL DATA
# =============================================================================

def _keystream_cipher(key: bytes, iv: bytes, data: bytes) -> bytes:
    """CTR stream cipher derived from key and IV."""
    blocks = []
    counter = 0
    needed = len(data)
    generated = 0
    while generated < needed:
        ctr_bytes = counter.to_bytes(8, "big")
        block = hashlib.sha256(key + iv + ctr_bytes).digest()
        blocks.append(block)
        generated += len(block)
        counter += 1
    stream = b"".join(blocks)[:needed]
    return bytes(a ^ b for a, b in zip(data, stream))


def encrypt_aes_gcm(key: bytes, plaintext: bytes) -> Dict[str, str]:
    """Encrypt plaintext using AES-256-GCM (with HMAC fallback if cryptography lib not installed)."""
    if len(key) != 32:
        raise ValueError("AES-256 requires a 32-byte key")

    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        aesgcm = AESGCM(key)
        iv = os.urandom(12)
        ciphertext_and_tag = aesgcm.encrypt(iv, plaintext, None)
        ciphertext = ciphertext_and_tag[:-16]
        tag = ciphertext_and_tag[-16:]
    except ImportError:
        import hmac
        iv = os.urandom(12)
        ciphertext = _keystream_cipher(key, iv, plaintext)
        tag = hmac.new(key, iv + ciphertext, hashlib.sha256).digest()[:16]

    return {
        "iv_hex": iv.hex(),
        "tag_hex": tag.hex(),
        "ciphertext_hex": ciphertext.hex(),
        "body_data_hash": hashlib.sha256(plaintext).hexdigest(),
    }


def decrypt_aes_gcm(key: bytes, iv_hex: str, tag_hex: str, ciphertext_hex: str) -> bytes:
    """Decrypt ciphertext using AES-256-GCM (with HMAC verification fallback)."""
    if len(key) != 32:
        raise ValueError("AES-256 requires a 32-byte key")

    iv = bytes.fromhex(iv_hex)
    tag = bytes.fromhex(tag_hex)
    ciphertext = bytes.fromhex(ciphertext_hex)

    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        aesgcm = AESGCM(key)
        return aesgcm.decrypt(iv, ciphertext + tag, None)
    except ImportError:
        import hmac
        expected_tag = hmac.new(key, iv + ciphertext, hashlib.sha256).digest()[:16]
        if not hmac.compare_digest(tag, expected_tag):
            raise ValueError("Authentication tag mismatch! Data corrupted or wrong emergency key.")
        return _keystream_cipher(key, iv, ciphertext)
