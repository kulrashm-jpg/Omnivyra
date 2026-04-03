/**
 * Hot Key Cache — Memory Layer (#3)
 *
 * Sits in front of Redis: the top-N most frequently accessed AI response cache
 * keys are kept in a JS Map (in-process memory), eliminating the Redis round-trip
 * entirely for those keys (~1–3 ms → ~0.01 ms).
 *
 * Architecture:
 *   Request → HotKeyCache (Map) → hit? return immediately
 *                              → miss? → Redis → store in HotKeyCache if freq ≥ threshold
 *
 * Eviction:
 *   - Capacity capped at MAX_HOT_KEYS (default 50)
 *   - Each key has a per-entry TTL (aligned to Redis TTL)
 *   - When capacity is hit, the least-recently-used key is evicted
 *   - Access frequency counter drives promotion; keys below MIN_FREQ_TO_PROMOTE
 *     never enter the hot tier
 *
 * Thread safety: Node.js is single-threaded; no locks needed.
 */

const MAX_HOT_KEYS        = 50;
const MAX_FREQ_KEYS       = 5_000; // cap the frequency counter to prevent unbounded growth
const MIN_FREQ_TO_PROMOTE = 3;    // key must be accessed ≥ 3× before entering hot tier
const HOT_ENTRY_TTL_MS    = 5 * 60 * 1000; // 5 min (refresh on each hit)

interface HotEntry {
  value:      string;
  expiresAt:  number;
  lastUsed:   number;
  freq:       number;
}

// ── Frequency counter (all keys, not just hot ones) ───────────────────────────
const _freqCounter = new Map<string, number>();
// ── Hot tier ──────────────────────────────────────────────────────────────────
const _hot = new Map<string, HotEntry>();

let _hotHits  = 0;
let _hotMisses = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────

function evictLRU(): void {
  let oldest: { key: string; lastUsed: number } | null = null;
  for (const [key, entry] of _hot) {
    if (!oldest || entry.lastUsed < oldest.lastUsed) {
      oldest = { key, lastUsed: entry.lastUsed };
    }
  }
  if (oldest) {
    _hot.delete(oldest.key);
    // Always clean freq counter when evicting from hot tier
    _freqCounter.delete(oldest.key);
  }
}

/** Drop the oldest half of frequency counter entries when it exceeds MAX_FREQ_KEYS. */
function trimFreqCounter(): void {
  if (_freqCounter.size < MAX_FREQ_KEYS) return;
  const toDelete = Math.floor(MAX_FREQ_KEYS / 2);
  let deleted = 0;
  for (const key of _freqCounter.keys()) {
    if (deleted >= toDelete) break;
    // Keep keys that are currently hot
    if (!_hot.has(key)) {
      _freqCounter.delete(key);
      deleted++;
    }
  }
}

function isExpired(entry: HotEntry): boolean {
  return Date.now() > entry.expiresAt;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Try to get a value from the hot key tier.
 * Returns the cached string on hit, null on miss or expiry.
 */
export function hotGet(key: string): string | null {
  const entry = _hot.get(key);
  if (!entry) {
    _hotMisses++;
    return null;
  }
  if (isExpired(entry)) {
    _hot.delete(key);
    _freqCounter.delete(key);
    _hotMisses++;
    return null;
  }
  // Refresh
  entry.lastUsed = Date.now();
  entry.freq++;
  _hotHits++;
  return entry.value;
}

/**
 * Record a cache access (hit or miss) for frequency tracking.
 * If the key has been accessed MIN_FREQ_TO_PROMOTE times and is NOT
 * already in the hot tier, promote it now.
 *
 * @param key   - Redis cache key
 * @param value - The cached value (needed for promotion)
 */
export function recordAccess(key: string, value: string): void {
  const freq = (_freqCounter.get(key) ?? 0) + 1;
  _freqCounter.set(key, freq);
  trimFreqCounter();

  if (freq < MIN_FREQ_TO_PROMOTE) return;
  if (_hot.has(key)) {
    // Already hot — just refresh TTL + bump freq
    const entry = _hot.get(key)!;
    entry.expiresAt = Date.now() + HOT_ENTRY_TTL_MS;
    entry.lastUsed  = Date.now();
    entry.freq      = freq;
    return;
  }

  // Promote to hot tier
  if (_hot.size >= MAX_HOT_KEYS) evictLRU();
  _hot.set(key, {
    value,
    expiresAt: Date.now() + HOT_ENTRY_TTL_MS,
    lastUsed:  Date.now(),
    freq,
  });
}

/**
 * Explicitly promote a key into the hot tier (e.g. from cache warmup).
 */
export function hotSet(key: string, value: string): void {
  if (_hot.size >= MAX_HOT_KEYS) evictLRU();
  _hot.set(key, {
    value,
    expiresAt: Date.now() + HOT_ENTRY_TTL_MS,
    lastUsed:  Date.now(),
    freq:      MIN_FREQ_TO_PROMOTE,
  });
  _freqCounter.set(key, MIN_FREQ_TO_PROMOTE);
}

/**
 * Invalidate a key from both hot tier and frequency counter.
 * Call this when the underlying Redis key is invalidated.
 */
export function hotInvalidate(key: string): void {
  _hot.delete(key);
  _freqCounter.delete(key);
}

/**
 * Returns top-N hot keys sorted by frequency (for observability).
 */
export function getHotKeyStats(topN = 10): Array<{ key: string; freq: number; expiresInMs: number }> {
  return Array.from(_hot.entries())
    .filter(([, e]) => !isExpired(e))
    .sort(([, a], [, b]) => b.freq - a.freq)
    .slice(0, topN)
    .map(([key, e]) => ({
      key: key.slice(0, 64), // truncate for logging safety
      freq: e.freq,
      expiresInMs: Math.max(0, e.expiresAt - Date.now()),
    }));
}

export function getHotCacheMetrics() {
  return {
    hotHits:   _hotHits,
    hotMisses: _hotMisses,
    hotSize:   _hot.size,
    hotHitRate: _hotHits + _hotMisses > 0
      ? Math.round((_hotHits / (_hotHits + _hotMisses)) * 1000) / 1000
      : 0,
  };
}
