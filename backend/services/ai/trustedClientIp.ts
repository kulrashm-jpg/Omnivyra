/**
 * SEC91-D1 — the ONE client-IP derivation for AI spend limits.
 *
 * WHY: the AI routes keyed their per-IP limit on the FIRST entry of
 * `x-forwarded-for`. That entry is whatever the client wrote into the header;
 * a proxy only ever APPENDS to it. Off Vercel it is fully attacker-controlled
 * (rotate it per request → a fresh rate-limit bucket every time, or write a
 * victim's IP → exhaust the victim's bucket). On Vercel it happens to be
 * overwritten by the edge today, but that is a platform detail the code must
 * not depend on silently.
 *
 * RULE (fail-closed on trust, never on availability):
 *   - On Vercel (`VERCEL=1`), the edge SETS `x-real-ip` and
 *     `x-vercel-forwarded-for` to the connecting client and discards any
 *     client-supplied value. Those are the only headers read.
 *   - Anywhere else, headers are NOT trusted — the TCP peer
 *     (`socket.remoteAddress`) is used, unless the operator names the one
 *     header their own proxy sets via `TRUSTED_CLIENT_IP_HEADER`.
 *   - `x-forwarded-for` is never read.
 *
 * The result is used only as a rate-limit key; it never authorizes anything.
 * Authenticated routes key their limits by USER first (see aiRequestGuard).
 */

type HeaderBag = Record<string, string | string[] | undefined>;
export interface ClientIpRequestLike {
  headers?: HeaderBag;
  socket?: { remoteAddress?: string | null } | null;
}

function firstHeaderValue(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return null;
  // A list-valued header: the platform writes a single value; take the first
  // token defensively and drop anything that is not a plausible IP literal.
  const token = raw.split(',')[0]?.trim() ?? '';
  return /^[0-9a-fA-F:.]{2,45}$/.test(token) ? token : null;
}

function isVercelRuntime(env: NodeJS.ProcessEnv): boolean {
  return env.VERCEL === '1';
}

/**
 * Resolve the client IP from headers the deployment platform guarantees, or
 * from the TCP peer. Returns null when nothing trustworthy is available (the
 * per-IP layer is then skipped; per-user / per-company layers still apply).
 */
export function resolveTrustedClientIp(
  req: ClientIpRequestLike | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const headers = req?.headers ?? {};
  const operatorHeader = String(env.TRUSTED_CLIENT_IP_HEADER ?? '').trim().toLowerCase();
  if (operatorHeader && operatorHeader !== 'x-forwarded-for') {
    const v = firstHeaderValue(headers[operatorHeader]);
    if (v) return v;
  }
  if (isVercelRuntime(env)) {
    const v = firstHeaderValue(headers['x-real-ip']) ?? firstHeaderValue(headers['x-vercel-forwarded-for']);
    if (v) return v;
  }
  const peer = req?.socket?.remoteAddress;
  return typeof peer === 'string' && peer.trim() ? peer.trim() : null;
}
