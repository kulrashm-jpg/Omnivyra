/**
 * HARDEN-005 — centralized SSRF guard (URL + IP validation policy).
 *
 * THE single source of truth for deciding whether an outbound request target
 * is safe. Pure and synchronous (no I/O) so it is trivially testable and can be
 * reused by safeFetch (which adds DNS resolution + connection pinning) and by
 * any caller that needs to pre-validate a URL.
 *
 * Policy (deny by default):
 *   - protocol: https only (http allowed ONLY for explicit localhost dev via
 *     opts.allowHttp — off by default, and even then the IP checks still apply);
 *   - no embedded credentials (user:pass@host);
 *   - hostname must be present and not a bare IP in a blocked range;
 *   - every RESOLVED IP (checked by safeFetch after DNS) must be a public
 *     unicast address — loopback, private, link-local, CGNAT, ULA, multicast,
 *     reserved and cloud-metadata ranges are rejected, for both IPv4 and IPv6
 *     (including IPv4-mapped IPv6).
 */
import net from 'net';

export interface SsrfPolicy {
  /** Allow http:// (default false — https only). */
  allowHttp?: boolean;
  /** Optional host allow-list (exact host or suffix match, case-insensitive).
   *  When set, ONLY these hosts are permitted (defense-in-depth for known
   *  integrations). Leave undefined for dynamic media URLs. */
  allowedHosts?: string[];
  /** Permit private/loopback targets (ONLY for tests or explicit dev opt-in). */
  allowPrivateNetwork?: boolean;
}

export interface UrlCheckResult {
  ok: boolean;
  reason?: string;
  url?: URL;
}

const ALLOWED_PROTOCOLS_HTTPS = new Set(['https:']);
const ALLOWED_PROTOCOLS_WITH_HTTP = new Set(['https:', 'http:']);

/** True when a host matches the allow-list (exact or dot-suffix). */
export function hostMatchesAllowList(host: string, allowedHosts: string[]): boolean {
  const h = host.toLowerCase();
  return allowedHosts.some((entry) => {
    const e = entry.toLowerCase().replace(/^\./, '');
    return h === e || h.endsWith(`.${e}`);
  });
}

/**
 * Validate a URL string against protocol/credential/host policy WITHOUT DNS.
 * safeFetch performs the DNS + IP checks; callers can use this for a cheap
 * upfront reject.
 */
export function validateOutboundUrl(rawUrl: string | null | undefined, policy: SsrfPolicy = {}): UrlCheckResult {
  if (!rawUrl || typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    return { ok: false, reason: 'empty_url' };
  }
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }

  const allowedProtocols = policy.allowHttp ? ALLOWED_PROTOCOLS_WITH_HTTP : ALLOWED_PROTOCOLS_HTTPS;
  if (!allowedProtocols.has(url.protocol)) {
    return { ok: false, reason: `blocked_protocol:${url.protocol}` };
  }

  // Embedded credentials (user:pass@host) are an SSRF/credential-leak vector.
  if (url.username || url.password) {
    return { ok: false, reason: 'embedded_credentials' };
  }

  const host = url.hostname;
  if (!host) {
    return { ok: false, reason: 'missing_host' };
  }

  // A bare-IP literal host can be range-checked immediately (before DNS).
  const literalIpVersion = net.isIP(stripIpBrackets(host));
  if (literalIpVersion && !policy.allowPrivateNetwork && isBlockedIp(stripIpBrackets(host))) {
    return { ok: false, reason: 'blocked_ip_literal' };
  }

  if (policy.allowedHosts && policy.allowedHosts.length > 0) {
    if (!hostMatchesAllowList(host, policy.allowedHosts)) {
      return { ok: false, reason: 'host_not_in_allowlist' };
    }
  }

  return { ok: true, url };
}

function stripIpBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

// ── IPv4 range checks ───────────────────────────────────────────────────────

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = (value << 8) | n;
  }
  return value >>> 0;
}

function inCidr4(ipInt: number, base: string, maskBits: number): boolean {
  const baseInt = ipv4ToInt(base);
  if (baseInt === null) return false;
  const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

/** Blocked IPv4 ranges: loopback, private, link-local, CGNAT, metadata, reserved. */
const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8],        // "this" network / 0.0.0.0
  ['10.0.0.0', 8],       // private
  ['100.64.0.0', 10],    // CGNAT
  ['127.0.0.0', 8],      // loopback
  ['169.254.0.0', 16],   // link-local (incl. 169.254.169.254 cloud metadata)
  ['172.16.0.0', 12],    // private
  ['192.0.0.0', 24],     // IETF protocol assignments
  ['192.0.2.0', 24],     // TEST-NET-1
  ['192.168.0.0', 16],   // private
  ['198.18.0.0', 15],    // benchmarking
  ['198.51.100.0', 24],  // TEST-NET-2
  ['203.0.113.0', 24],   // TEST-NET-3
  ['224.0.0.0', 4],      // multicast
  ['240.0.0.0', 4],      // reserved (incl. 255.255.255.255 broadcast)
];

function isBlockedIpv4(ip: string): boolean {
  const ipInt = ipv4ToInt(ip);
  if (ipInt === null) return true; // unparseable → treat as unsafe
  return BLOCKED_V4.some(([base, bits]) => inCidr4(ipInt, base, bits));
}

// ── IPv6 range checks ───────────────────────────────────────────────────────

/** Expand an IPv6 address to 8 groups of 16-bit ints. Handles :: and mapped v4. */
function ipv6ToGroups(ip: string): number[] | null {
  let addr = ip;
  // IPv4-mapped / embedded (::ffff:1.2.3.4 or ::1.2.3.4) — convert the tail.
  const v4Match = addr.match(/(.*:)((\d{1,3}\.){3}\d{1,3})$/);
  if (v4Match) {
    const v4Int = ipv4ToInt(v4Match[2]);
    if (v4Int === null) return null;
    const hi = (v4Int >>> 16) & 0xffff;
    const lo = v4Int & 0xffff;
    addr = `${v4Match[1]}${hi.toString(16)}:${lo.toString(16)}`;
  }

  const halves = addr.split('::');
  if (halves.length > 2) return null;

  const parseSide = (side: string): number[] => (side === '' ? [] : side.split(':').map((g) => parseInt(g, 16)));
  let head: number[];
  let tail: number[];
  if (halves.length === 2) {
    head = parseSide(halves[0]);
    tail = parseSide(halves[1]);
  } else {
    head = parseSide(halves[0]);
    tail = [];
  }
  const missing = 8 - (head.length + tail.length);
  if (missing < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill(0), ...tail];
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff)) return null;
  return groups;
}

function isBlockedIpv6(ip: string): boolean {
  const g = ipv6ToGroups(ip);
  if (!g) return true; // unparseable → unsafe

  // ::  (unspecified) and ::1 (loopback)
  if (g.every((x) => x === 0)) return true;
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true;

  const first = g[0];
  // fc00::/7 — unique local addresses
  if ((first & 0xfe00) === 0xfc00) return true;
  // fe80::/10 — link-local
  if ((first & 0xffc0) === 0xfe80) return true;
  // ff00::/8 — multicast
  if ((first & 0xff00) === 0xff00) return true;

  // IPv4-mapped (::ffff:0:0/96) and IPv4-compatible — validate the embedded v4.
  const isMapped = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff;
  const isCompat = g.slice(0, 6).every((x) => x === 0) && (g[6] !== 0 || g[7] > 1);
  if (isMapped || isCompat) {
    const v4 = `${(g[6] >> 8) & 0xff}.${g[6] & 0xff}.${(g[7] >> 8) & 0xff}.${g[7] & 0xff}`;
    return isBlockedIpv4(v4);
  }

  return false;
}

/** True if an IP literal (v4 or v6) is in ANY blocked range. Fail-closed. */
export function isBlockedIp(ip: string): boolean {
  const clean = stripIpBrackets(ip);
  const version = net.isIP(clean);
  if (version === 4) return isBlockedIpv4(clean);
  if (version === 6) return isBlockedIpv6(clean);
  return true; // not a valid IP → unsafe
}
