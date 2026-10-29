// Device Token & Real-time Broadcast Confirmation Management for Pulse Clinic

export interface DeviceProfile {
  deviceToken: string;
  deviceName: string;
  deviceType: "DESKTOP" | "MOBILE" | "TABLET";
  registeredAt: string;
  lastActiveAt: string;
  ephemeralPublicKeyHex: string;
}

export interface BroadcastConfirmationMessage {
  id: string;
  targetUserId?: string;
  targetDeviceToken?: string;
  type: "DOCTOR_ACCESS_REQUEST" | "HOSPITAL_ROLE_INVITE" | "PRESCRIPTION_SIGN_ALERT";
  title: string;
  description: string;
  requesterName: string;
  requesterRole: string;
  hospitalName: string;
  durationHours?: number;
  payload: Record<string, unknown>;
  createdAt: string;
  status: "PENDING" | "CONFIRMED" | "DENIED";
}

// Generate a random secure hex token
function generateSecureHex(bytesLength: number): string {
  const bytes = new Uint8Array(bytesLength);
  if (typeof window !== "undefined" && window.crypto) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytesLength; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Detect client device name & platform
export function detectDeviceName(): { name: string; type: "DESKTOP" | "MOBILE" | "TABLET" } {
  if (typeof window === "undefined" || !navigator) {
    return { name: "Medical Terminal Client", type: "DESKTOP" };
  }

  const ua = navigator.userAgent;
  let os = "Desktop";
  let type: "DESKTOP" | "MOBILE" | "TABLET" = "DESKTOP";

  if (/Windows/i.test(ua)) os = "Windows 11 PC";
  else if (/Macintosh|Mac OS/i.test(ua)) os = "macOS Workstation";
  else if (/iPhone/i.test(ua)) {
    os = "Apple iPhone (Face ID)";
    type = "MOBILE";
  } else if (/iPad/i.test(ua)) {
    os = "Apple iPad";
    type = "TABLET";
  } else if (/Android/i.test(ua)) {
    os = "Android Mobile (Biometric)";
    type = "MOBILE";
  } else if (/Linux/i.test(ua)) os = "Linux Workstation";

  let browser = "Browser";
  if (/Edg/i.test(ua)) browser = "Edge";
  else if (/Chrome/i.test(ua)) browser = "Chrome";
  else if (/Safari/i.test(ua)) browser = "Safari";
  else if (/Firefox/i.test(ua)) browser = "Firefox";

  return { name: `${os} • ${browser} Hardware Enclave`, type };
}

// Get or create unique device profile with deviceToken
export function getOrCreateDeviceProfile(): DeviceProfile {
  if (typeof window === "undefined") {
    return {
      deviceToken: "dev_tok_mock_server",
      deviceName: "Server Session",
      deviceType: "DESKTOP",
      registeredAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      ephemeralPublicKeyHex: "0489f...mock",
    };
  }

  const STORAGE_KEY = "pulse_clinic_device_profile";
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.deviceToken) {
        // Update last active
        parsed.lastActiveAt = new Date().toISOString();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
        return parsed;
      }
    }
  } catch (err) {
    console.error("Error reading device token", err);
  }

  // Create new unique device profile
  const { name, type } = detectDeviceName();
  const token = `dev_tok_sec256_${generateSecureHex(16)}`;
  const ephemeralKey = `04${generateSecureHex(32)}`;

  const profile: DeviceProfile = {
    deviceToken: token,
    deviceName: name,
    deviceType: type,
    registeredAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    ephemeralPublicKeyHex: ephemeralKey,
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch (err) {
    console.error("Error saving device token", err);
  }

  return profile;
}

import { clientNodeService } from "./clientNodeSocket";

// Real-time broadcast channel for device confirmation messages
class DeviceBroadcastService {
  private channel: BroadcastChannel | null = null;
  private listeners: ((message: BroadcastConfirmationMessage) => void)[] = [];

  constructor() {
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      this.channel = new BroadcastChannel("pulse_clinic_device_channel");
      this.channel.onmessage = (event) => {
        if (event.data && typeof event.data === "object") {
          this.notifyListeners(event.data as BroadcastConfirmationMessage);
        }
      };
    }

    // Connect to Distributed Client Node P2P network broadcasts
    if (typeof window !== "undefined") {
      clientNodeService.onMessage((incoming: Record<string, unknown>) => {
        if (
          incoming &&
          typeof incoming === "object" &&
          (incoming.type === "DOCTOR_ACCESS_REQUEST" ||
            incoming.type === "HOSPITAL_ROLE_INVITE" ||
            incoming.type === "PRESCRIPTION_SIGN_ALERT" ||
            incoming.status === "PENDING" ||
            Boolean(incoming.title))
        ) {
          this.notifyListeners(incoming as unknown as BroadcastConfirmationMessage);
        }
      });
    }
  }

  public subscribe(callback: (message: BroadcastConfirmationMessage) => void): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((cb) => cb !== callback);
    };
  }

  public notifyListeners(message: BroadcastConfirmationMessage) {
    this.listeners.forEach((cb) => {
      try {
        cb(message);
      } catch (err) {
        console.error("Error in broadcast listener", err);
      }
    });
  }

  // Dispatch a message to all connected devices/tabs AND distributed Client Node
  public broadcastMessage(message: BroadcastConfirmationMessage) {
    this.notifyListeners(message);
    if (this.channel) {
      this.channel.postMessage(message);
    }
    // Flood message across P2P node mesh via Client Node WebSocket
    if (typeof window !== "undefined") {
      clientNodeService.sendBroadcast(message as unknown as Record<string, unknown>);
    }
  }
}

export const deviceBroadcastService = new DeviceBroadcastService();
