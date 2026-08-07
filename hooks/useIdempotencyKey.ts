/**
 * OR-07 Action 1 — React binding for client-side idempotency keys.
 *
 * Returns a key that is STABLE for as long as the operation's defining inputs
 * are unchanged, and regenerates when they change. That is the property the
 * backend middleware depends on:
 *
 *   • user clicks "Publish", request fails, user clicks "Retry"
 *       → same inputs → SAME key → the server treats it as one operation
 *   • user edits the post, then publishes
 *       → inputs changed → NEW key → a genuinely new operation
 *
 * Deliberately NOT implemented inside `apiFetch`: a fetch wrapper cannot
 * distinguish a retry from a new operation, so a key minted there would change
 * on every attempt and provide no replay protection at all.
 *
 * `reset()` covers the case where the same inputs legitimately begin a NEW
 * operation — e.g. the user deliberately publishes identical content a second
 * time after the first succeeded. Callers that never reset keep one key per
 * input-set, which is the safe default.
 */
import { useCallback, useRef, useState } from 'react';
import { makeIdemKey, idempotencyHeaders } from '../lib/idempotency';

export interface UseIdempotencyKeyResult {
  /** Stable key for the current operation. */
  key: string;
  /** Ready-to-spread header object for the current key. */
  headers: Record<string, string>;
  /** Begin a NEW logical operation with the same inputs. */
  reset: () => void;
}

/**
 * @param prefix Human-readable operation label, e.g. 'social-publish'.
 * @param deps   The inputs that DEFINE the operation. The key regenerates only
 *               when these change. Pass the identifiers a server would use to
 *               decide "is this the same request" — a post id, an order id, the
 *               payload's primary key. Pass `[]` when the operation has no
 *               varying inputs.
 */
export function useIdempotencyKey(
  prefix: string,
  deps: ReadonlyArray<unknown>,
): UseIdempotencyKeyResult {
  // `reset()` participates in the signature so a deliberate restart yields a
  // new key without any state write during render.
  const [resetCount, setResetCount] = useState(0);

  let depSignature: string;
  try {
    depSignature = JSON.stringify(deps ?? []);
  } catch {
    // Non-serializable dep (a DOM node, a cyclic object). Fall back to a
    // per-mount constant rather than throwing inside a render.
    depSignature = '__unserializable__';
  }
  const signature = `${depSignature}#${resetCount}`;

  // Derived during render from a ref — no setState-in-render, and the key is
  // available to the very first handler that runs after an input change.
  const held = useRef<{ signature: string; key: string } | null>(null);
  if (!held.current || held.current.signature !== signature) {
    held.current = { signature, key: makeIdemKey(prefix) };
  }
  const key = held.current.key;

  const reset = useCallback(() => setResetCount((c) => c + 1), []);

  return { key, headers: idempotencyHeaders(key), reset };
}
