/**
 * Deterministic fingerprint for compiled prompts.
 * Enables precise tracing of prompt executions and cache keys (Phase 8).
 */

import { createHash } from 'crypto';

/**
 * Generate a deterministic short hash of a prompt string.
 * Same prompt always yields the same fingerprint.
 * Used for tracing and logging.
 */
export function generatePromptFingerprint(prompt: string): string {
  const hash = createHash('sha1').update(prompt).digest('hex');
  return hash.slice(0, 8);
}

/**
 * Generate SHA256 fingerprint for prompt cache keys (Phase 8).
 * Full hex digest for reliable cache lookup.
 */
export function generateCacheFingerprint(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex');
}
