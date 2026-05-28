/**
 * UUID utilities — canonical anti-corruption layer between semantic
 * application identifiers (e.g. "workspace-linkedin", "${orgId}:${topic}")
 * and UUID-backed billing storage.
 *
 * Three layers:
 *
 *   1. Shape: `isUuid` / `assertUuid` validate the RFC 4122 8-4-4-4-12 form.
 *      Used for IDs that MUST already be UUIDs by contract (orgId, userId,
 *      foreign keys to real rows).
 *
 *   2. Coercion: `ensureUuid` / `deriveUuidFromKey` deterministically project
 *      a semantic key onto a UUID v5-shaped string so it can live in a UUID
 *      column without losing dedup behavior. Same key → same UUID, always.
 *
 *   3. Nominal types: `Uuid` and `SemanticReference` are brand-flavored
 *      aliases that let billing entry-point signatures distinguish "this
 *      string is a UUID" from "this string is a semantic key that will be
 *      canonicalized at the boundary." They are runtime no-ops; the asserts
 *      in this file are what actually enforce the distinction.
 */

import { createHash } from 'crypto';

/** RFC 4122 UUID v1-v5 shape — 8-4-4-4-12 hex with version + variant nibbles. */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Brand-flavored nominal types. These are erased at runtime — the asserts in
 * this file (and the billing boundary) are what enforce the distinction.
 * Use them in signatures to make caller intent visible:
 *   - `Uuid`               : already a UUID; will be asserted at boundary
 *   - `SemanticReference`  : opaque key; will be canonicalized via ensureUuid
 *   - `WorkspaceKey`       : transient workspace/session key (e.g. "workspace-linkedin")
 *   - `PlatformKey`        : platform discriminator (e.g. "linkedin", "twitter")
 */
export type Uuid = string & { readonly __brand: 'Uuid' };
export type SemanticReference = string & { readonly __brand: 'SemanticReference' };
export type WorkspaceKey = string & { readonly __brand: 'WorkspaceKey' };
export type PlatformKey = string & { readonly __brand: 'PlatformKey' };

export function isUuid(value: unknown): value is Uuid {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

export class InvalidUuidError extends Error {
  readonly name = 'InvalidUuidError';
  constructor(public readonly field: string, public readonly received: unknown) {
    const display = typeof received === 'string' && received.length <= 80
      ? received
      : `${typeof received}(${String(received).slice(0, 60)}...)`;
    super(`[billing-payload-invalid] ${field} must be UUID, received: ${display}`);
  }
}

export function assertUuid(value: unknown, field: string): asserts value is Uuid {
  if (!isUuid(value)) {
    throw new InvalidUuidError(field, value);
  }
}

/**
 * Deterministically derive a UUID from a semantic key.
 *
 * Uses SHA-256 of `namespace:key` truncated to 16 bytes, then formats as a
 * RFC-4122 v5-like UUID (version=5 nibble, variant=10 bits). Same input →
 * same output, every time, with no entropy.
 *
 * Use for: cases where a billing/DB column requires a UUID but the caller's
 * upstream identifier is a stable semantic key (e.g. transient workspace
 * sessions). The semantic key is still passed separately (e.g. in
 * idempotencyKey) so dedup + observability remain keyed on intent, not on
 * the synthetic UUID.
 *
 * Format: 8-4-4-4-12 hex (32 chars + 4 dashes).
 */
export function deriveUuidFromKey(namespace: string, key: string): Uuid {
  if (!namespace || typeof namespace !== 'string') {
    throw new Error('deriveUuidFromKey: namespace required');
  }
  if (!key || typeof key !== 'string') {
    throw new Error('deriveUuidFromKey: key required');
  }
  const digest = createHash('sha256').update(`${namespace}:${key}`).digest();
  // Take first 16 bytes (128 bits).
  const bytes = Buffer.from(digest.subarray(0, 16));
  // Set version to 5 (per RFC 4122 §4.3): top 4 bits of byte 6 → 0101.
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  // Set variant to RFC 4122: top 2 bits of byte 8 → 10.
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}` as Uuid;
}

/**
 * If `value` is already a UUID, return it. Otherwise derive a deterministic
 * UUID from `value` under `namespace`. Used at billing boundaries where the
 * caller MAY have a semantic key and we want a UUID for the DB column without
 * rejecting the request.
 */
export function ensureUuid(value: string, namespace: string): Uuid {
  return (isUuid(value) ? value : deriveUuidFromKey(namespace, value)) as Uuid;
}

/**
 * Coerce a reference value to a UUID, returning BOTH the canonical UUID and
 * the original semantic value (for use in idempotency keys / notes).
 *
 * Use at billing boundaries where the same identifier serves two roles:
 *   - UUID for the DB column (canonical)
 *   - opaque key for dedup/observability (semantic)
 */
export interface CanonicalReference {
  /** UUID for DB foreign-key columns. */
  uuid: Uuid;
  /** Caller's original value, preserved verbatim. */
  semantic: string;
  /** True when the semantic value was NOT already a UUID and had to be derived. */
  derived: boolean;
}

export function canonicalizeReference(value: string, namespace: string): CanonicalReference {
  if (!value || typeof value !== 'string') {
    throw new Error('canonicalizeReference: value required');
  }
  if (isUuid(value)) {
    return { uuid: value, semantic: value, derived: false };
  }
  return {
    uuid: deriveUuidFromKey(namespace, value),
    semantic: value,
    derived: true,
  };
}
