/**
 * Phase 8 — Prompt Context Cache
 *
 * In-memory LRU cache for prompt blocks by fingerprint.
 * Reduces token usage and prevents unnecessary recomputation when
 * the same prompt block is used across requests.
 *
 * Hardened: max 1000 entries with LRU eviction to prevent unbounded growth.
 */

import { generateCacheFingerprint } from '../utils/promptFingerprint';

const MAX_ENTRIES = 1000;

// Insertion-order map acts as LRU: delete + re-insert on access moves to tail.
const store = new Map<string, string>();

function evictLRU(): void {
  // Map iterator returns entries in insertion order; first = oldest
  const firstKey = store.keys().next().value;
  if (firstKey !== undefined) store.delete(firstKey);
}

/**
 * Get cached prompt content by fingerprint.
 * Returns undefined if not cached.
 */
export function getCachedPrompt(fingerprint: string): string | undefined {
  const value = store.get(fingerprint);
  if (value === undefined) return undefined;
  // Move to tail (most recently used)
  store.delete(fingerprint);
  store.set(fingerprint, value);
  return value;
}

/**
 * Store prompt content under its fingerprint.
 */
export function storePrompt(fingerprint: string, promptContent: string): void {
  if (store.has(fingerprint)) {
    // Refresh position
    store.delete(fingerprint);
  } else if (store.size >= MAX_ENTRIES) {
    evictLRU();
  }
  store.set(fingerprint, promptContent);
}

/**
 * Get or build a prompt block. Fingerprints the content, checks cache.
 * On cache hit: returns cached content and logs.
 * On cache miss: stores and returns content.
 */
export function getOrBuildPromptBlock(
  blockName: string,
  promptContent: string
): { content: string; fingerprint: string; cacheHit: boolean } {
  if (!promptContent || typeof promptContent !== 'string') {
    return { content: promptContent, fingerprint: '', cacheHit: false };
  }

  const fingerprint = generateCacheFingerprint(promptContent);
  const cached = getCachedPrompt(fingerprint);

  if (cached !== undefined) {
    if (process.env.NODE_ENV !== 'test') {
      console.info('[promptContextCache] Cache hit', { block: blockName, fingerprint: fingerprint.slice(0, 16) });
    }
    return { content: cached, fingerprint, cacheHit: true };
  }

  storePrompt(fingerprint, promptContent);
  return { content: promptContent, fingerprint, cacheHit: false };
}

/**
 * Clear cache (for tests or manual reset).
 */
export function clearPromptCache(): void {
  store.clear();
}

/** Returns current cache size (for observability). */
export function getPromptCacheSize(): number {
  return store.size;
}
