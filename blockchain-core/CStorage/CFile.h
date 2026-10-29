#pragma once

#include <string>
#include <vector>
#include <cstdint>
#include <filesystem>
#include <stdexcept>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#else
#include <fcntl.h>
#include <unistd.h>
#include <sys/stat.h>
#endif

namespace CStorage {

class CPhysicalFile {
public:
    enum class OpenMode {
        Read,
        WriteAppend,
        WriteTruncate
    };

    CPhysicalFile() = default;
    ~CPhysicalFile() { close(); }

    CPhysicalFile(const CPhysicalFile&) = delete;
    CPhysicalFile& operator=(const CPhysicalFile&) = delete;

    CPhysicalFile(CPhysicalFile&& other) noexcept {
        moveFrom(std::move(other));
    }

    CPhysicalFile& operator=(CPhysicalFile&& other) noexcept {
        if (this != &other) {
            close();
            moveFrom(std::move(other));
        }
        return *this;
    }

    bool open(const std::filesystem::path& path, OpenMode mode) {
        close();
        m_path = path;

#ifdef _WIN32
        DWORD access = (mode == OpenMode::Read) ? GENERIC_READ : (GENERIC_READ | GENERIC_WRITE);
        DWORD share = FILE_SHARE_READ | FILE_SHARE_WRITE;
        DWORD creation = 0;
        if (mode == OpenMode::Read) {
            creation = OPEN_EXISTING;
        } else if (mode == OpenMode::WriteAppend) {
            creation = OPEN_ALWAYS;
        } else if (mode == OpenMode::WriteTruncate) {
            creation = CREATE_ALWAYS;
        }

        m_handle = CreateFileW(path.c_str(), access, share, NULL, creation, FILE_ATTRIBUTE_NORMAL, NULL);
        if (m_handle == INVALID_HANDLE_VALUE) {
            return false;
        }

        if (mode == OpenMode::WriteAppend) {
            SetFilePointer(m_handle, 0, NULL, FILE_END);
        }
        return true;
#else
        int flags = 0;
        if (mode == OpenMode::Read) flags = O_RDONLY;
        else if (mode == OpenMode::WriteAppend) flags = O_RDWR | O_CREAT | O_APPEND;
        else if (mode == OpenMode::WriteTruncate) flags = O_RDWR | O_CREAT | O_TRUNC;

        m_fd = ::open(path.c_str(), flags, 0644);
        return m_fd >= 0;
#endif
    }

    void close() {
#ifdef _WIN32
        if (m_handle != INVALID_HANDLE_VALUE) {
            CloseHandle(m_handle);
            m_handle = INVALID_HANDLE_VALUE;
        }
#else
        if (m_fd >= 0) {
            ::close(m_fd);
            m_fd = -1;
        }
#endif
    }

    bool isOpen() const {
#ifdef _WIN32
        return m_handle != INVALID_HANDLE_VALUE;
#else
        return m_fd >= 0;
#endif
    }

    // Force OS dirty buffers to be written to the physical disk (survives power loss)
    bool syncToDisk() {
#ifdef _WIN32
        if (m_handle == INVALID_HANDLE_VALUE) return false;
        return FlushFileBuffers(m_handle) != 0;
#else
        if (m_fd < 0) return false;
#if defined(__APPLE__)
        return fcntl(m_fd, F_FULLFSYNC) == 0;
#else
        return fdatasync(m_fd) == 0;
#endif
#endif
    }

    bool write(const void* data, size_t bytes) {
#ifdef _WIN32
        if (m_handle == INVALID_HANDLE_VALUE) return false;
        DWORD written = 0;
        if (!WriteFile(m_handle, data, static_cast<DWORD>(bytes), &written, NULL)) {
            return false;
        }
        return written == bytes;
#else
        if (m_fd < 0) return false;
        ssize_t res = ::write(m_fd, data, bytes);
        return res == static_cast<ssize_t>(bytes);
#endif
    }

    bool readAt(uint64_t offset, void* buffer, size_t bytes) const {
#ifdef _WIN32
        if (m_handle == INVALID_HANDLE_VALUE) return false;
        LARGE_INTEGER li;
        li.QuadPart = static_cast<LONGLONG>(offset);
        if (!SetFilePointerEx(m_handle, li, NULL, FILE_BEGIN)) {
            return false;
        }
        DWORD readBytes = 0;
        if (!ReadFile(m_handle, buffer, static_cast<DWORD>(bytes), &readBytes, NULL)) {
            return false;
        }
        return readBytes == bytes;
#else
        if (m_fd < 0) return false;
        ssize_t res = ::pread(m_fd, buffer, bytes, static_cast<off_t>(offset));
        return res == static_cast<ssize_t>(bytes);
#endif
    }

    uint64_t size() const {
#ifdef _WIN32
        if (m_handle == INVALID_HANDLE_VALUE) return 0;
        LARGE_INTEGER li;
        if (!GetFileSizeEx(m_handle, &li)) return 0;
        return static_cast<uint64_t>(li.QuadPart);
#else
        if (m_fd < 0) return 0;
        struct stat st;
        if (fstat(m_fd, &st) != 0) return 0;
        return static_cast<uint64_t>(st.st_size);
#endif
    }

    void truncateTo(uint64_t newSize) {
#ifdef _WIN32
        if (m_handle == INVALID_HANDLE_VALUE) return;
        LARGE_INTEGER li;
        li.QuadPart = static_cast<LONGLONG>(newSize);
        SetFilePointerEx(m_handle, li, NULL, FILE_BEGIN);
        SetEndOfFile(m_handle);
#else
        if (m_fd >= 0) {
            ftruncate(m_fd, static_cast<off_t>(newSize));
        }
#endif
    }

private:
    void moveFrom(CPhysicalFile&& other) {
#ifdef _WIN32
        m_handle = other.m_handle;
        other.m_handle = INVALID_HANDLE_VALUE;
#else
        m_fd = other.m_fd;
        other.m_fd = -1;
#endif
        m_path = std::move(other.m_path);
    }

#ifdef _WIN32
    HANDLE m_handle{INVALID_HANDLE_VALUE};
#else
    int m_fd{-1};
#endif
    std::filesystem::path m_path;
};

} // namespace CStorage
