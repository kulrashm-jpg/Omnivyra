/**
 * OR-07 Action 1 — client-side idempotency keys.
 *
 * The backend `withIdempotency` middleware requires an `Idempotency-Key`
 * header and returns 400 IDEMPOTENCY_KEY_REQUIRED without one. The key is
 * deliberately CLIENT-supplied: only the caller knows whether two requests are
 * the same logical operation or two deliberate ones.
 *
 * ── The rule that makes this useful ─────────────────────────────────────────
 * One logical operation → exactly one key, reused across every retry of that
 * operation. A fresh key per attempt satisfies the header and provides ZERO
 * replay protection — ceremony without safety, and harder to spot than having
 * no key at all.
 *
 * That is why generation does NOT live inside `apiFetch`: a low-level fetch
 * wrapper cannot tell a retry from a new operation, so minting there would
 * produce a new key on every attempt. Callers mint once at the operation
 * boundary and pass the key down.
 *
 * React callers should use `useIdempotencyKey` (hooks/useIdempotencyKey.ts),
 * which ties key lifetime to the inputs that define the operation.
 */

/**
 * Collision-resistant Idempotency-Key generator. Uses crypto.randomUUID()
 * where available (modern browsers + Node 19+); falls back to a high-entropy
 * suffix when not.
 *
 * Rationale: a `Date.now()`-based key permits two clicks within the same
 * millisecond to share a key — causing the withIdempotency middleware to
 * return 409 IDEMPOTENCY_IN_PROGRESS or IDEMPOTENCY_CONFLICT on the second
 * submission.
 *
 * Canonical home for this generator. It previously lived in
 * components/super-admin/tabs/CreditsBillingTabMain.tsx; that module now
 * re-exports this one so its existing importers are unaffected and only one
 * implementation exists.
 */
export function makeIdemKey(prefix: string): string {
  const haveUuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function';
  return haveUuid
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Header object for a key. Spread into a fetch `headers` literal. */
export function idempotencyHeaders(key: string): Record<string, string> {
  return { 'Idempotency-Key': key };
}

/**
 * A logical operation with a fixed key. Mint ONCE where the business action
 * begins, then reuse `headers` for the initial attempt and every retry.
 *
 * For non-React callers (plain modules, services). React callers should prefer
 * `useIdempotencyKey` so the key's lifetime is bound to the operation's inputs.
 */
export interface IdempotentOperation {
  readonly key: string;
  readonly headers: Record<string, string>;
}

export function createIdempotentOperation(prefix: string): IdempotentOperation {
  const key = makeIdemKey(prefix);
  return { key, headers: idempotencyHeaders(key) };
}
