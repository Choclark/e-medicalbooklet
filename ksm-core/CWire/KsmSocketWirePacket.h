#pragma once

#include <cstdint>
#include <string>
#include <vector>
#include <sstream>
#include <iomanip>
#include "../CSchemaSplit/SchemaSplitter.h"

namespace CKsm {

// ============================================================================
// Socket Wire Packet: Protocol framing for transmitting encrypted transactions
// from KSM to the Blockchain Mempool via TCP/IPC Socket
// ============================================================================
class KsmSocketWirePacket {
public:
    static constexpr uint32_t MAGIC = 0x4B534D31; // "KSM1"
    static constexpr uint16_t VERSION = 1;
    static constexpr uint16_t MSG_TYPE_TX_SUBMISSION = 0x0100;

    static std::vector<uint8_t> pack(const EncryptedTxEnvelope& envelope) {
        std::string jsonPayload = envelope.toSocketWireJson();
        std::vector<uint8_t> frame;
        frame.reserve(16 + jsonPayload.size());

        // Header: [4B Magic][2B Version][2B MsgType][4B PayloadLen][4B CRC32/Reserved]
        auto writeU32 = [&frame](uint32_t v) {
            for (int i = 0; i < 4; ++i) frame.push_back(static_cast<uint8_t>(v >> (8 * i)));
        };
        auto writeU16 = [&frame](uint16_t v) {
            frame.push_back(static_cast<uint8_t>(v & 0xFF));
            frame.push_back(static_cast<uint8_t>((v >> 8) & 0xFF));
        };

        writeU32(MAGIC);
        writeU16(VERSION);
        writeU16(MSG_TYPE_TX_SUBMISSION);
        writeU32(static_cast<uint32_t>(jsonPayload.size()));
        writeU32(0); // Reserved

        frame.insert(frame.end(), jsonPayload.begin(), jsonPayload.end());
        return frame;
    }

    static std::string inspectWireFrame(const std::vector<uint8_t>& frame) {
        if (frame.size() < 16) return "[Malformed wire frame]";
        std::ostringstream ss;
        ss << "Wire Frame [Total Size: " << frame.size() << " bytes]\n";
        ss << "  - Magic:      0x" << std::hex << std::setw(8) << std::setfill('0')
           << (static_cast<uint32_t>(frame[0]) | (static_cast<uint32_t>(frame[1]) << 8) |
               (static_cast<uint32_t>(frame[2]) << 16) | (static_cast<uint32_t>(frame[3]) << 24))
           << " (ASCII: 'KSM1')\n";
        ss << "  - Version:    " << std::dec << static_cast<int>(frame[4] | (frame[5] << 8)) << "\n";
        ss << "  - Msg Type:   0x" << std::hex << static_cast<int>(frame[6] | (frame[7] << 8)) 
           << " (MSG_ENCRYPTED_TX_SUBMISSION)\n";
        uint32_t payloadLen = frame[8] | (frame[9] << 8) | (frame[10] << 16) | (frame[11] << 24);
        ss << "  - PayloadLen: " << std::dec << payloadLen << " bytes\n";
        ss << "  - Wire Socket Ready: YES (Destination: Blockchain Transaction Pool / Mempool Port 8545)\n";
        return ss.str();
    }
};

} // namespace CKsm
