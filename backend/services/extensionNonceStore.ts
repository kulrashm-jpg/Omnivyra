/**
 * Shared request-nonce store for signed extension requests
 * (EXTENSION-1.5.0-CONTRACT.md §2).
 *
 * `verifyExtensionRequestSignature` already refuses a nonce seen by THIS
 * instance. With more than one instance, a captured request could be replayed
 * against another one within the 5-minute window. This adds a cross-instance
 * claim on the shared Redis client: SET key NX PX.
 *
 * The client is used only while it reports status 'ready' (the BullMQ client
 * queues commands forever while disconnected; see the WS-3 quota fix). When
 * Redis is unavailable, the result is 'unavailable' and the caller keeps the
 * per-instance protection it already has. That is never weaker than before
 * this module, and it never "accepts" on error by itself.
 */

export const SHARED_NONCE_TTL_MS = 10 * 60 * 1000;

export type SharedNonceClaim = 'claimed' | 'replayed' | 'unavailable';

type RedisLike = { status?: unknown; set: (...args: unknown[]) => Promise<unknown> };

let client: RedisLike | null = null;

async function getClient(): Promise<RedisLike | null> {
  if (client) return client;
  try {
    const mod = (await import('../queue/bullmqClient')) as { getSharedRedisClient?: () => unknown };
    client = (mod.getSharedRedisClient?.() as RedisLike) ?? null;
    return client;
  } catch {
    return null;
  }
}

/** Test seam. */
export function __resetSharedNonceClientForTests(): void {
  client = null;
}

const usable = (r: RedisLike): boolean => typeof r.status !== 'string' || r.status === 'ready';

/**
 * Claim `nonce` for `scope` (the session's user id) across instances.
 * 'replayed' means another request already used it: the caller must refuse.
 */
export async function claimSharedRequestNonce(scope: string, nonce: string): Promise<SharedNonceClaim> {
  const r = await getClient();
  if (!r || !usable(r)) return 'unavailable';
  try {
    const res = await r.set(`ext:nonce:${scope}:${nonce}`, '1', 'PX', SHARED_NONCE_TTL_MS, 'NX');
    return res === 'OK' ? 'claimed' : 'replayed';
  } catch {
    return 'unavailable';
  }
}
