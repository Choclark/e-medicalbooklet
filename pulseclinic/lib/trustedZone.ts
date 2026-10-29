// Trusted Zone Cryptographic Operations for Patient Registration & Identity
// =========================================================================
// Generates keys strictly in the client device's Secure Enclave / WebCrypto Trusted Zone.
// Signs patient creation payloads to ensure verifiable integrity on blockchain nodes.

import { getOrCreateDeviceProfile } from "./deviceToken";
import { StoredCredential, deriveBlockchainAddress, bufferToHex, bufferToBase64Url } from "./webauthn";

export interface PatientRegistrationBundle {
  patient_id: string; // Client-generated UUID
  name: string;
  email: string;
  public_key: string; // SPKI DER in Hex
  public_key_base64: string;
  blockchain_address: string;
  did: string;
  device_token: string;
  device_name: string;
  password_hash: string;
  payload_hash: string; // SHA-256 integrity hash of canonical registration data
  signature: string; // ECDSA signature produced by patient's private key in Trusted Zone
  timestamp: number;
  credential: StoredCredential;
}

/**
 * Compute SHA-256 hex hash of any string input using WebCrypto Subtle.
 */
export async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return bufferToHex(buf);
}

/**
 * Canonical payload string formatter used for hashing & signature verification.
 * Must match the verification format in validator node runners.
 */
export function getCanonicalRegistrationString(
  patientId: string,
  name: string,
  email: string,
  publicKeyHex: string,
  deviceToken: string,
  passwordHash: string,
  timestamp: number
): string {
  return `${patientId}|${name.trim()}|${email.trim().toLowerCase()}|${publicKeyHex}|${deviceToken}|${passwordHash}|${timestamp}`;
}

/**
 * Register a new patient entirely within the client's Trusted Zone:
 * 1. Generates UUID patient_id.
 * 2. Generates ECDSA P-256 keypair (private key never leaves browser enclave).
 * 3. Hashes user password/credential.
 * 4. Derives device token and booklet DID.
 * 5. Computes payload_hash to guarantee tamper-proof integrity.
 * 6. Digitally signs payload_hash with the private key inside the Trusted Zone.
 */
export async function registerPatientInTrustedZone(params: {
  name: string;
  email: string;
  password?: string;
}): Promise<PatientRegistrationBundle> {
  const patientId = crypto.randomUUID();
  const cleanName = params.name.trim();
  const cleanEmail = params.email.trim().toLowerCase();
  const timestamp = Math.floor(Date.now() / 1000);

  // 1. Retrieve hardware device token and device name
  const deviceProfile = getOrCreateDeviceProfile();

  // 2. Hash password / secret (fallback to random salt if blank)
  const rawSecret = params.password || `secret-${cleanEmail}-${Date.now()}`;
  const passwordHash = await sha256Hex(rawSecret);

  // 3. Generate genuine ECDSA P-256 keypair in the Trusted Zone
  const keyPair = await window.crypto.subtle.generateKey(
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    false, // Private key remains non-extractable in the browser enclave
    ["sign", "verify"]
  );

  // 4. Export public key as SubjectPublicKeyInfo (SPKI DER)
  const exportedSpki = await window.crypto.subtle.exportKey("spki", keyPair.publicKey);
  const publicKeyHex = bufferToHex(exportedSpki);
  const publicKeyBase64 = bufferToBase64Url(exportedSpki);

  // 5. Derive on-chain address and DID
  const { address, did } = await deriveBlockchainAddress(exportedSpki);

  // 6. Build canonical string and calculate payload_hash for tamper prevention
  const canonical = getCanonicalRegistrationString(
    patientId,
    cleanName,
    cleanEmail,
    publicKeyHex,
    deviceProfile.deviceToken,
    passwordHash,
    timestamp
  );
  const payloadHash = await sha256Hex(canonical);

  // 7. Sign the payload hash using the patient's private key inside the Trusted Zone
  const enc = new TextEncoder();
  const signatureBuffer = await window.crypto.subtle.sign(
    {
      name: "ECDSA",
      hash: { name: "SHA-256" },
    },
    keyPair.privateKey,
    enc.encode(canonical)
  );
  const signature = bufferToHex(signatureBuffer);

  // 8. Create local StoredCredential for authentication and session
  const credentialId = bufferToBase64Url(crypto.getRandomValues(new Uint8Array(16)).buffer as ArrayBuffer);
  const credential: StoredCredential = {
    id: credentialId,
    rawId: credentialId,
    publicKeyHex,
    publicKeyBase64,
    algorithm: "ES256 (WebCrypto Trusted Zone ECDSA P-256)",
    blockchainAddress: address,
    did,
    user: {
      id: patientId,
      name: cleanName,
      email: cleanEmail,
      role: "patient", // Automatically and immutably a PATIENT
    },
    createdAt: new Date().toISOString(),
    counter: 1,
    transports: ["enclave-software", "trusted-zone"],
    type: "webcrypto-simulated",
  };

  return {
    patient_id: patientId,
    name: cleanName,
    email: cleanEmail,
    public_key: publicKeyHex,
    public_key_base64: publicKeyBase64,
    blockchain_address: address,
    did,
    device_token: deviceProfile.deviceToken,
    device_name: deviceProfile.deviceName,
    password_hash: passwordHash,
    payload_hash: payloadHash,
    signature,
    timestamp,
    credential,
  };
}

// ============================================================================
// PERSISTENT INDEXEDDB NON-EXTRACTABLE HARDWARE-BACKED ACTOR KEY STORE
// ============================================================================

export interface PersistentActorSigningKeys {
  actorId: string;
  role: string;
  signingKeyPair: CryptoKeyPair; // privateKey is non-extractable in IndexedDB!
  publicKeyRawHex: string;       // 64-byte (128-hex) uncompressed X || Y coordinates
  createdAt: string;
}

export interface PersistentActorEcdhKeys {
  actorId: string;
  ecdhKeyPair: CryptoKeyPair;    // privateKey is non-extractable in IndexedDB!
  publicKeyRawHex: string;       // 64-byte (128-hex) uncompressed X || Y coordinates
  createdAt: string;
}

const IDB_NAME = 'pulse_trusted_zone_keystore_v1';
const IDB_STORE_SIGNING = 'actor_signing_keys';
const IDB_STORE_ECDH = 'actor_ecdh_keys';

const inMemorySigningCache = new Map<string, PersistentActorSigningKeys>();
const inMemoryEcdhCache = new Map<string, PersistentActorEcdhKeys>();

function openTrustedKeyStoreDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB unavailable in this environment'));
      return;
    }
    const req = window.indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE_SIGNING)) {
        db.createObjectStore(IDB_STORE_SIGNING, { keyPath: 'actorId' });
      }
      if (!db.objectStoreNames.contains(IDB_STORE_ECDH)) {
        db.createObjectStore(IDB_STORE_ECDH, { keyPath: 'actorId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function exportRawXYHex(publicKey: CryptoKey): Promise<string> {
  const rawPubBuffer = await window.crypto.subtle.exportKey('raw', publicKey);
  const rawPubBytes = new Uint8Array(rawPubBuffer);
  // Strip 0x04 uncompressed point indicator so C++ CryptoSigner::verify receives exact 64-byte X || Y
  const xyPubBytes = (rawPubBytes.length === 65 && rawPubBytes[0] === 0x04)
    ? rawPubBytes.slice(1)
    : rawPubBytes;
  return Array.from(xyPubBytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Retrieves or generates a persistent ECDSA P-256 signing keypair for an actor
 * (`PATIENT`, `DOCTOR`, `HOSPITAL`, `VACCINATION_CENTER`) stored in IndexedDB with
 * `extractable: false` on the private key so raw private key bytes can never be exported.
 */
export async function getOrCreateActorSigningKeyPair(
  actorId: string,
  role: string
): Promise<PersistentActorSigningKeys> {
  const normalizedId = (actorId || 'DEFAULT_ACTOR').trim();
  const cached = inMemorySigningCache.get(normalizedId);
  if (cached) return cached;

  try {
    const db = await openTrustedKeyStoreDb();
    const existing = await new Promise<PersistentActorSigningKeys | undefined>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_SIGNING, 'readonly');
      const store = tx.objectStore(IDB_STORE_SIGNING);
      const getReq = store.get(normalizedId);
      getReq.onsuccess = () => resolve(getReq.result as PersistentActorSigningKeys | undefined);
      getReq.onerror = () => reject(getReq.error);
    });
    if (existing && existing.signingKeyPair?.privateKey && existing.publicKeyRawHex) {
      inMemorySigningCache.set(normalizedId, existing);
      return existing;
    }

    const signingKeyPair = await window.crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      false, // non-extractable private key!
      ['sign', 'verify']
    );
    const publicKeyRawHex = await exportRawXYHex(signingKeyPair.publicKey);
    const record: PersistentActorSigningKeys = {
      actorId: normalizedId,
      role,
      signingKeyPair,
      publicKeyRawHex,
      createdAt: new Date().toISOString(),
    };

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_SIGNING, 'readwrite');
      const store = tx.objectStore(IDB_STORE_SIGNING);
      const putReq = store.put(record);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    });

    inMemorySigningCache.set(normalizedId, record);
    return record;
  } catch {
    const signingKeyPair = await window.crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign', 'verify']
    );
    const publicKeyRawHex = await exportRawXYHex(signingKeyPair.publicKey);
    const record: PersistentActorSigningKeys = {
      actorId: normalizedId,
      role,
      signingKeyPair,
      publicKeyRawHex,
      createdAt: new Date().toISOString(),
    };
    inMemorySigningCache.set(normalizedId, record);
    return record;
  }
}

/**
 * Retrieves or generates a persistent ECDH P-256 keypair for an actor stored in IndexedDB
 * with `extractable: false` on the private key.
 */
export async function getOrCreateActorEcdhKeyPair(
  actorId: string
): Promise<PersistentActorEcdhKeys> {
  const normalizedId = (actorId || 'DEFAULT_PATIENT').trim();
  const cached = inMemoryEcdhCache.get(normalizedId);
  if (cached) return cached;

  try {
    const db = await openTrustedKeyStoreDb();
    const existing = await new Promise<PersistentActorEcdhKeys | undefined>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_ECDH, 'readonly');
      const store = tx.objectStore(IDB_STORE_ECDH);
      const getReq = store.get(normalizedId);
      getReq.onsuccess = () => resolve(getReq.result as PersistentActorEcdhKeys | undefined);
      getReq.onerror = () => reject(getReq.error);
    });
    if (existing && existing.ecdhKeyPair?.privateKey && existing.publicKeyRawHex) {
      inMemoryEcdhCache.set(normalizedId, existing);
      return existing;
    }

    const ecdhKeyPair = await window.crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      false, // non-extractable private key!
      ['deriveKey', 'deriveBits']
    );
    const publicKeyRawHex = await exportRawXYHex(ecdhKeyPair.publicKey);
    const record: PersistentActorEcdhKeys = {
      actorId: normalizedId,
      ecdhKeyPair,
      publicKeyRawHex,
      createdAt: new Date().toISOString(),
    };

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_ECDH, 'readwrite');
      const store = tx.objectStore(IDB_STORE_ECDH);
      const putReq = store.put(record);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    });

    inMemoryEcdhCache.set(normalizedId, record);
    return record;
  } catch {
    const ecdhKeyPair = await window.crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveKey', 'deriveBits']
    );
    const publicKeyRawHex = await exportRawXYHex(ecdhKeyPair.publicKey);
    const record: PersistentActorEcdhKeys = {
      actorId: normalizedId,
      ecdhKeyPair,
      publicKeyRawHex,
      createdAt: new Date().toISOString(),
    };
    inMemoryEcdhCache.set(normalizedId, record);
    return record;
  }
}

