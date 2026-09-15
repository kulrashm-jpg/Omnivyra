/**
 * STEP 3AH-91 SEC-E2 — the platform-trusted client IP.
 *
 * Rate limits keyed by IP are only as strong as the IP. The historical pattern
 * `String(req.headers['x-forwarded-for'] ?? socket).split(',')[0]` takes the
 * FIRST hop of X-Forwarded-For, which any client can set to any value unless
 * the platform in front of the app overwrites the header.
 *
 *   - On Vercel (the web app's platform; `process.env.VERCEL` is set) the edge
 *     sets `x-real-ip` and overwrites `x-forwarded-for` / `x-vercel-forwarded-for`
 *     with the connecting client's address, so those are trusted, in that order.
 *   - Behind another reverse proxy, set TRUSTED_PROXY_HOPS=<n> (the number of
 *     proxies you operate in front of the app). The client address is then the
 *     one appended by the outermost trusted proxy: the n-th entry from the
 *     RIGHT of X-Forwarded-For. Entries to its left are client-controlled.
 *   - Otherwise no forwarding header is trusted: the socket peer is used.
 *
 * Every candidate must parse as an IP address; anything else falls through.
 */
import { isIP } from 'net';

type HeaderValue = string | string[] | undefined;
interface RequestLike {
  headers: Record<string, HeaderValue>;
  socket?: { remoteAddress?: string | null } | null;
}

function firstHeader(value: HeaderValue): string | null {
  if (Array.isArray(value)) return value.length ? String(value[0]) : null;
  return typeof value === 'string' ? value : null;
}

/** Normalise `1.2.3.4:5678`, `[::1]:80`, `::ffff:1.2.3.4`; null if not an IP. */
export function normaliseIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let v = raw.trim();
  if (!v) return null;
  const bracketed = v.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) v = bracketed[1];
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(v)) v = v.slice(0, v.lastIndexOf(':'));
  if (v.toLowerCase().startsWith('::ffff:') && isIP(v.slice(7)) === 4) v = v.slice(7);
  return isIP(v) ? v : null;
}

function splitList(value: string | null): string[] {
  return (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

function trustedProxyHops(): number {
  const n = Number.parseInt(String(process.env.TRUSTED_PROXY_HOPS ?? ''), 10);
  return Number.isFinite(n) && n > 0 && n < 16 ? n : 0;
}

/**
 * The client IP as established by the platform, or the socket peer.
 * Returns 'unknown' only when nothing parses as an IP.
 */
export function getTrustedClientIp(req: RequestLike): string {
  const headers = req.headers ?? {};

  if (process.env.VERCEL) {
    const candidates = [
      firstHeader(headers['x-real-ip']),
      splitList(firstHeader(headers['x-vercel-forwarded-for']))[0],
      splitList(firstHeader(headers['x-forwarded-for']))[0],
    ];
    for (const c of candidates) {
      const ip = normaliseIp(c);
      if (ip) return ip;
    }
  } else {
    const hops = trustedProxyHops();
    if (hops > 0) {
      const list = splitList(firstHeader(headers['x-forwarded-for']));
      const ip = normaliseIp(list[list.length - hops]);
      if (ip) return ip;
    }
  }

  return normaliseIp(req.socket?.remoteAddress ?? null) ?? 'unknown';
}

/**
 * SEC91-W2E — the same trusted client IP, or null when nothing parses as an IP.
 * For audit fields / nullable columns whose old contract was `string | null`.
 */
export function getTrustedClientIpOrNull(req: RequestLike): string | null {
  const ip = getTrustedClientIp(req);
  return ip === 'unknown' ? null : ip;
}
