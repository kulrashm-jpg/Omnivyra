/**
 * Canonical JSON-safe (de)serialization for CreatorTemplate / style schemas.
 *
 * The canonical style schemas legitimately use non-finite numbers — notably
 * `Infinity` for the unbounded catch-all band in `fontMultiplierScale`
 * (`maxSectionChars: Infinity`). `JSON.stringify` turns Infinity / -Infinity /
 * NaN into `null`, which silently corrupts the style on a database round-trip
 * (JSONB storage) and changes rendering for extreme-length content.
 *
 * This module encodes those values to a reversible sentinel object and decodes
 * them back, so a persisted template round-trips byte-identically. It is the ONE
 * canonical serializer (no duplication), transparent to callers, and requires NO
 * schema change and NO renderer change. Finite values, strings, booleans, null,
 * and arrays/objects pass through structurally unchanged.
 */

import type { CreatorTemplate } from './types';

const SENTINEL = '__creator_num__';
type NumTag = 'Infinity' | '-Infinity' | 'NaN';
type Sentinel = { [SENTINEL]: NumTag };

function isSentinel(v: unknown): v is Sentinel {
  return !!v && typeof v === 'object' && !Array.isArray(v)
    && Object.keys(v as object).length === 1
    && typeof (v as Record<string, unknown>)[SENTINEL] === 'string';
}

/** Encode a value tree, replacing non-finite numbers with reversible sentinels. */
export function encodeJsonSafe(value: unknown): unknown {
  if (typeof value === 'number') {
    if (value === Infinity) return { [SENTINEL]: 'Infinity' };
    if (value === -Infinity) return { [SENTINEL]: '-Infinity' };
    if (Number.isNaN(value)) return { [SENTINEL]: 'NaN' };
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => encodeJsonSafe(v));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = encodeJsonSafe(v);
    return out;
  }
  return value;
}

/** Decode a value tree, restoring sentinels back to their non-finite numbers. */
export function decodeJsonSafe<T = unknown>(value: unknown): T {
  if (isSentinel(value)) {
    const tag = value[SENTINEL];
    return (tag === 'Infinity' ? Infinity : tag === '-Infinity' ? -Infinity : NaN) as unknown as T;
  }
  if (Array.isArray(value)) return value.map((v) => decodeJsonSafe(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = decodeJsonSafe(v);
    return out as unknown as T;
  }
  return value as T;
}

/** Serialize a CreatorTemplate to a JSON-safe object for persistence. */
export function serializeTemplate(template: CreatorTemplate): unknown {
  return encodeJsonSafe(template);
}

/** Deserialize a persisted JSON object back to a CreatorTemplate (non-finite
 *  numbers restored). Idempotent on already-decoded (sentinel-free) input. */
export function deserializeTemplate(json: unknown): CreatorTemplate {
  return decodeJsonSafe<CreatorTemplate>(json);
}
