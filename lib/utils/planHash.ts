/**
 * Plan Hash Utilities
 *
 * Deterministic, zero-dependency hashing for plan inputs and API results.
 * Used to key caches and detect when inputs have changed without deep-equality.
 *
 * Algorithm: FNV-1a 32-bit — ~10× faster than crypto.createHash for small objects,
 * sufficient distribution for cache keying (not security-sensitive).
 */

// ---------------------------------------------------------------------------
// FNV-1a 32-bit core
// ---------------------------------------------------------------------------

function fnv1a(str: string): number {
  let hash = 2166136261; // FNV-1a 32-bit offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    // 32-bit unsigned multiply by FNV prime (16777619)
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0; // ensure unsigned
}

// ---------------------------------------------------------------------------
// Stable stringify — sorts object keys so insertion order doesn't affect hash
// ---------------------------------------------------------------------------

export function stableStringify(val: unknown): string {
  if (val === null) return 'null';
  if (val === undefined) return 'undefined';
  if (typeof val !== 'object') return JSON.stringify(val);
  if (Array.isArray(val)) {
    return '[' + val.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(val as object).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + stableStringify((val as Record<string, unknown>)[k]))
      .join(',') +
    '}'
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Hash any serialisable value into a short base-36 string.
 * Returns '' on serialisation error (e.g. circular refs) — treat as cache miss.
 */
export function hashObject(val: unknown): string {
  try {
    return fnv1a(stableStringify(val)).toString(36);
  } catch {
    return '';
  }
}

/**
 * Hash multiple values together — avoids creating a wrapper object.
 */
export function hashMany(...vals: unknown[]): string {
  try {
    const combined = vals.map(stableStringify).join('|');
    return fnv1a(combined).toString(36);
  } catch {
    return '';
  }
}
