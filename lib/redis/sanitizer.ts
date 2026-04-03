/**
 * Redis URL Sanitizer
 * 
 * Defensive parsing to extract valid URLs from common mistakes
 * (e.g., redis-cli command syntax accidentally pasted into config)
 * 
 * This is used in env.schema.ts to clean input before validation
 */

/**
 * Extract valid Redis URL from potentially malformed input
 * 
 * Handles:
 * - redis-cli commands: "redis-cli --tls -u redis://..."
 * - Extra whitespace
 * - Protocol variations
 * 
 * Returns null if no valid URL found
 */
export function extractRedisUrl(input: string): string | null {
  if (!input) return null;
  
  const trimmed = input.trim();
  
  // Try direct match first
  if (trimmed.startsWith('redis://') || trimmed.startsWith('rediss://')) {
    return trimmed;
  }
  
  // Extract from redis-cli command
  // Patterns:
  //   redis-cli -u redis://...
  //   redis-cli --tls -u redis://...
  const match = trimmed.match(/rediss?:\/\/[^\s'"`]+/);
  if (match) {
    return match[0];
  }
  
  return null;
}

/**
 * Validate Redis URL structure
 * Returns error message if invalid
 */
export function validateRedisUrl(url: string): string | null {
  try {
    new URL(url);
    return null; // Valid
  } catch (err) {
    return `Invalid URL: ${(err as Error).message}`;
  }
}

/**
 * Normalize Redis URL
 * - Ensure protocol is present
 * - Validates structure
 */
export function normalizeRedisUrl(input: string): string {
  const trimmed = input.trim();
  
  // Check for redis-cli command syntax issues
  if (trimmed.includes('redis-cli')) {
    const extracted = extractRedisUrl(trimmed);
    if (!extracted) {
      throw new Error(
        'Could not extract valid Redis URL from command syntax. ' +
        'Expected format: redis://user:pass@host:port'
      );
    }
    return extracted;
  }
  
  // Check for other shell syntax issues
  if (trimmed.includes('--tls') || trimmed.includes('-u ')) {
    const extracted = extractRedisUrl(trimmed);
    if (!extracted) {
      throw new Error(
        'URL contains shell flags but no valid Redis URL found. ' +
        'Expected format: redis://user:pass@host:port (without flags)'
      );
    }
    return extracted;
  }
  
  // Validate URL format
  const error = validateRedisUrl(trimmed);
  if (error) {
    throw new Error(error);
  }
  
  return trimmed;
}

/**
 * Mask Redis URL for logging (hide password)
 * 
 * Input:  redis://user:secretpass@host:6379
 * Output: redis://user:***@host:6379
 */
export function maskRedisUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    // If URL parsing fails, return truncated version
    const prefix = url.substring(0, 30);
    return prefix.endsWith('...') ? prefix : prefix + '...';
  }
}

/**
 * Extract host from Redis URL
 */
export function getRedisHost(url: string): string {
  try {
    return new URL(url).hostname || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Check if URL requires TLS (Upstash)
 */
export function isRedisUrlTLS(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'rediss:' ||
      parsed.hostname?.includes('upstash.io')
    );
  } catch {
    return false;
  }
}
