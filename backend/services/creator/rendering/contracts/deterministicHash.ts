/**
 * Creator Rendering — Phase-7 deterministic input-hash strategy.
 * ──────────────────────────────────────────────────────────────────────────
 * R0 foundation. PURE compute only (no DB, no network, no clock, no
 * RNG). `node:crypto` SHA-256 is deterministic local computation — it is
 * NOT a network/effectful call.
 *
 * ── STRATEGY (documented, normative) ──────────────────────────────────
 * The `deterministic_input_hash` makes an identical render INTENT
 * idempotent — the render analogue of the Step-12 deterministic
 * reconstruction guarantee. Rules:
 *
 *  1. ORDER-INDEPENDENT for maps: object keys are recursively SORTED
 *     before serialization, so `{a,b}` and `{b,a}` hash identically.
 *  2. ARRAYS ARE ORDER-PRESERVING: a storyboard / scene_sequence is
 *     SEMANTICALLY ordered — reordering scenes is a different render
 *     intent and MUST change the hash. (So "order-independent" applies
 *     to object keys, never to arrays.)
 *  3. STABLE SERIALIZATION: a single canonical JSON form — `undefined`
 *     and function values are dropped; `NaN`/`Infinity` rejected;
 *     numbers/booleans/strings/null/arrays/plain-objects only.
 *  4. NO VOLATILE FIELDS: `spec_id`, `deterministic_input_hash`,
 *     timestamps, db ids, attempt/queue/runtime fields are EXCLUDED by
 *     construction — only the render-content projection is hashed.
 *  5. NO RUNTIME MUTATION LEAKAGE: the function never reads ambient
 *     state; same input object → same digest, process-independent.
 *
 * The future RenderRequestProjector computes this over the
 * (content-only) projection and sets `spec_id = \`render:${hash}\``.
 */

import { createHash } from 'node:crypto';

/** Keys that are NEVER part of the render-content identity. */
const VOLATILE_KEYS = new Set<string>([
  'spec_id',
  'deterministic_input_hash',
  'created_at',
  'updated_at',
  'enqueued_at',
  'attempt_id',
  'queue_item_id',
  'render_job_id',
  'render_variant_id',
  'billing_operation_id',
  'idempotency_key',
]);

/**
 * Recursively produce a canonical, stable structure: object keys sorted,
 * volatile keys stripped, arrays preserved (semantic order), `undefined`
 * dropped. Throws on non-finite numbers (no silent NaN→null drift).
 */
export function stableCanonicalize(value: unknown): unknown {
  if (value === null) return null;
  const t = typeof value;
  if (t === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new Error('deterministicHash: non-finite number is not serialization-safe');
    }
    return value;
  }
  if (t === 'string' || t === 'boolean') return value;
  if (t === 'undefined' || t === 'function' || t === 'symbol' || t === 'bigint') {
    return undefined; // dropped by the parent
  }
  if (Array.isArray(value)) {
    // Arrays are ORDER-PRESERVING (semantic). Map elements; keep nulls
    // (positionally significant); collapse dropped → null to hold index.
    return value.map((v) => {
      const c = stableCanonicalize(v);
      return c === undefined ? null : c;
    });
  }
  // Plain object: sort keys, strip volatile + undefined.
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    if (VOLATILE_KEYS.has(key)) continue;
    const c = stableCanonicalize((value as Record<string, unknown>)[key]);
    if (c !== undefined) out[key] = c;
  }
  return out;
}

/** Canonical JSON string (the exact bytes that get hashed). */
export function stableStringify(value: unknown): string {
  return JSON.stringify(stableCanonicalize(value));
}

/**
 * SHA-256 hex of the canonical form. Deterministic + order-independent
 * (object keys) + array-order-sensitive + volatile-free. Same input →
 * same digest on any machine/process.
 */
export function computeDeterministicInputHash(input: unknown): string {
  return createHash('sha256').update(stableStringify(input), 'utf8').digest('hex');
}
