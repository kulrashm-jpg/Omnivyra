/**
 * Phase 8 — Prompt Context Cache
 *
 * In-memory cache for prompt blocks by fingerprint.
 * Reduces token usage and prevents unnecessary recomputation when
 * the same prompt block is used across requests.
 */

import { generateCacheFingerprint } from '../utils/promptFingerprint';

const store = new Map<string, string>();

/**
 * Get cached prompt content by fingerprint.
 * Returns undefined if not cached.
 */
export function getCachedPrompt(fingerprint: string): string | undefined {
  return store.get(fingerprint);
}

/**
 * Store prompt content under its fingerprint.
 */
export function storePrompt(fingerprint: string, promptContent: string): void {
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
