#pragma once

#include <cstdint>
#include <list>
#include <mutex>
#include <optional>
#include <unordered_map>
#include <utility>

// ========================================================
// Thread-safe LRU cache with a fixed number of frames.
// frames = memory budget / frame size (from blockchain.conf)
// Least-recently-used entries are evicted; they remain on disk.
// ========================================================
template <typename Key, typename Value>
class LruCache {
public:
    struct Stats {
        uint64_t hits{0};
        uint64_t misses{0};
        uint64_t evictions{0};
        size_t size{0};
        size_t capacity{0};
    };

    explicit LruCache(size_t capacityFrames) : m_capacity(capacityFrames) {}
    ~LruCache() {
        clear();
    }

    std::optional<Value> get(const Key& key) {
        std::lock_guard<std::mutex> lock(m_mutex);
        auto it = m_map.find(key);
        if (it == m_map.end()) {
            ++m_misses;
            return std::nullopt;
        }
        m_items.splice(m_items.begin(), m_items, it->second); // mark as most recently used
        ++m_hits;
        return it->second->second;
    }

    void put(const Key& key, Value value) {
        if (m_capacity == 0) return;
        std::lock_guard<std::mutex> lock(m_mutex);

        auto it = m_map.find(key);
        if (it != m_map.end()) {
            it->second->second = std::move(value);
            m_items.splice(m_items.begin(), m_items, it->second);
            return;
        }

        m_items.emplace_front(key, std::move(value));
        m_map[key] = m_items.begin();

        if (m_items.size() > m_capacity) {
            m_map.erase(m_items.back().first);
            m_items.pop_back();
            ++m_evictions;
        }
    }

    void erase(const Key& key) {
        std::lock_guard<std::mutex> lock(m_mutex);
        auto it = m_map.find(key);
        if (it == m_map.end()) return;
        m_items.erase(it->second);
        m_map.erase(it);
    }

    void clear() {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_items.clear();
        m_map.clear();
    }

    size_t capacity() const { return m_capacity; }

    size_t size() const {
        std::lock_guard<std::mutex> lock(m_mutex);
        return m_items.size();
    }

    bool contains(const Key& key) const {
        std::lock_guard<std::mutex> lock(m_mutex);
        return m_map.find(key) != m_map.end();
    }

    Stats stats() const {
        std::lock_guard<std::mutex> lock(m_mutex);
        return {m_hits, m_misses, m_evictions, m_items.size(), m_capacity};
    }

private:
    using Item = std::pair<Key, Value>;

    size_t m_capacity;
    std::list<Item> m_items; // front = most recent
    std::unordered_map<Key, typename std::list<Item>::iterator> m_map;
    mutable std::mutex m_mutex;
    uint64_t m_hits{0};
    uint64_t m_misses{0};
    uint64_t m_evictions{0};
};
