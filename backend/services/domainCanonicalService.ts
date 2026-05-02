/**
 * domainCanonicalService.ts
 *
 * Resolves an input domain to its canonical (post-redirect) form by following
 * HTTP redirects. Pure utility — does NOT read or write the database.
 *
 * Security posture (HARDENED):
 *   - SSRF protection: every hop's hostname is DNS-resolved BEFORE the fetch;
 *     if any resolved A/AAAA record falls inside a private/loopback/link-local
 *     range, the resolution is blocked.
 *   - Fail-closed: any timeout, DNS failure, or fetch error returns
 *     resolution_failed=true. Callers MUST treat this as a hard rejection,
 *     not a permissive pass.
 *   - Per-hop timeout capped at 3 seconds.
 *   - Response body capped at 1 MB; over-cap aborts the request.
 *   - HTTP method is HEAD (small body); GET fallback only for 405/501.
 *   - Bounded redirect chain (MAX_REDIRECTS=8).
 *
 * resolveDomain(input):
 *   - On success: { input_domain, final_domain, redirect_chain, is_forwarding }
 *   - On private-IP block: { ..., resolution_blocked: true }
 *   - On any failure: { ..., resolution_failed: true }
 */

import dns from 'dns/promises';
import { Agent, buildConnector } from 'undici';
import { logger } from './logger';

const MAX_REDIRECTS = 8;
const PER_HOP_TIMEOUT_MS = 3_000;
const MAX_RESPONSE_BYTES = 1_048_576; // 1 MB

/** Distinct error code on connect-time SSRF blocks — used by followChain to
 *  distinguish a rebind block (hard fail, no HTTP fallback) from a generic
 *  network error. */
const REBIND_BLOCK_CODE = 'EREBINDBLOCK';

const KNOWN_MULTI_PART_TLDS = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk',
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.in', 'net.in', 'org.in',
  'com.br', 'com.mx', 'com.ar', 'com.cn',
  'co.kr', 'co.za', 'co.nz',
]);

export interface ResolveDomainResult {
  input_domain: string;
  final_domain: string;
  redirect_chain: string[];
  is_forwarding: boolean;
  /** True when the resolution was aborted because a hop pointed at a private IP. */
  resolution_blocked?: boolean;
  /** True when the resolution failed (DNS, timeout, fetch error). Callers MUST reject. */
  resolution_failed?: boolean;
}

export function normalizeDomain(raw: string): string {
  if (!raw) return '';
  let s = String(raw).trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+\-.]*:\/\//, '');
  s = s.split('/')[0].split('?')[0].split('#')[0];
  s = s.replace(/^www\./, '');
  s = s.split(':')[0];
  return s;
}

export function registrableRoot(host: string): string {
  if (!host) return '';
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join('.');
  if (KNOWN_MULTI_PART_TLDS.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return lastTwo;
}

// ─────────────────────────────────────────────────────────────────────────────
// SSRF blocklist
// ─────────────────────────────────────────────────────────────────────────────

/**
 * IPv4 private / loopback / link-local CIDRs.
 * Stored as [networkInt, prefixBits] for cheap bitwise containment checks.
 */
const IPV4_BLOCKED_CIDRS: ReadonlyArray<[number, number]> = [
  [ipv4ToInt('127.0.0.0'),   8],   // loopback
  [ipv4ToInt('10.0.0.0'),    8],   // private
  [ipv4ToInt('172.16.0.0'),  12],  // private
  [ipv4ToInt('192.168.0.0'), 16],  // private
  [ipv4ToInt('169.254.0.0'), 16],  // link-local
  [ipv4ToInt('0.0.0.0'),     8],   // "this network"
  [ipv4ToInt('100.64.0.0'),  10],  // CGNAT
];

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map((n) => parseInt(n, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return -1;
  }
  // Use unsigned right shift to keep the result in [0, 2^32 - 1].
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function ipv4InCidr(ipInt: number, [networkInt, prefix]: [number, number]): boolean {
  if (prefix === 0) return true;
  const mask = prefix === 32 ? 0xffffffff : ((0xffffffff << (32 - prefix)) >>> 0);
  return (ipInt & mask) === (networkInt & mask);
}

function isPrivateIPv4(ip: string): boolean {
  const ipInt = ipv4ToInt(ip);
  if (ipInt < 0) return false;
  return IPV4_BLOCKED_CIDRS.some((cidr) => ipv4InCidr(ipInt, cidr));
}

/**
 * IPv6 private / loopback / link-local check. Uses string-prefix matching on
 * the canonical zero-expanded form for the small set of relevant ranges.
 *   - ::1/128                loopback
 *   - fc00::/7               unique local (covers fc00::/8 and fd00::/8)
 *   - fe80::/10              link-local
 *   - ::ffff:0:0/96          IPv4-mapped — must check the embedded v4
 */
function isPrivateIPv6(ip: string): boolean {
  const norm = ip.toLowerCase();
  if (norm === '::1' || norm === '0:0:0:0:0:0:0:1') return true;

  // IPv4-mapped: ::ffff:1.2.3.4 — re-check against IPv4 ranges.
  const v4MappedMatch = norm.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4MappedMatch) return isPrivateIPv4(v4MappedMatch[1]);

  // First hextet drives fc00::/7 and fe80::/10 detection.
  const firstHextet = norm.split(':')[0];
  if (!firstHextet) return false;
  const v = parseInt(firstHextet, 16);
  if (Number.isNaN(v)) return false;

  // fc00::/7 — top 7 bits == 1111110 → leading byte 0xfc or 0xfd.
  if ((v & 0xfe00) === 0xfc00) return true;

  // fe80::/10 — top 10 bits == 1111111010 → first hextet 0xfe80..0xfebf.
  if ((v & 0xffc0) === 0xfe80) return true;

  return false;
}

function isPrivateIp(ip: string): boolean {
  return isPrivateIPv4(ip) || isPrivateIPv6(ip);
}

/**
 * DNS-resolve a hostname to all A + AAAA records. Returns null on any DNS
 * failure (caller treats this as a fail-closed signal).
 */
async function resolveAllAddresses(host: string): Promise<string[] | null> {
  const all: string[] = [];
  let anySuccess = false;
  // A records
  try {
    const a = await dns.resolve4(host);
    all.push(...a);
    anySuccess = true;
  } catch {
    // ignore — try AAAA
  }
  try {
    const aaaa = await dns.resolve6(host);
    all.push(...aaaa);
    anySuccess = true;
  } catch {
    // ignore
  }
  if (!anySuccess) return null;
  return all;
}

/**
 * SSRF gate: returns 'safe' if every resolved IP is public, 'blocked' if any
 * IP is in a private range, 'failed' if DNS resolution failed.
 */
async function classifyHost(host: string): Promise<'safe' | 'blocked' | 'failed'> {
  if (!host) return 'failed';
  const ips = await resolveAllAddresses(host);
  if (!ips || ips.length === 0) return 'failed';
  for (const ip of ips) {
    if (isPrivateIp(ip)) {
      logger.warn('domain_resolution_blocked_private_ip', { host, ip });
      return 'blocked';
    }
  }
  return 'safe';
}

// ─────────────────────────────────────────────────────────────────────────────
// SafeAgent — connect-time SSRF validation (DNS-rebinding TOCTOU defense)
// ─────────────────────────────────────────────────────────────────────────────
//
// Pre-fetch classifyHost() resolves DNS once and gates the request. Between
// that lookup and the actual TCP connect, a malicious DNS resolver can flip
// the answer to a private IP (DNS rebinding). The connect-time validator
// closes that window:
//
//   1. Re-resolve hostname to ALL A/AAAA records
//   2. If ANY resolved IP is private/loopback/link-local → reject
//   3. Otherwise call the default connector
//
// Wired via undici's Agent.connect factory, scoped LOCALLY to this service.
// fetch() inside followChain explicitly passes `dispatcher: safeDispatcher`,
// so only canonical-resolution traffic is gated. Every other outbound HTTP
// caller in the process is unaffected.

const _defaultConnector = buildConnector({});

const safeConnect: ConstructorParameters<typeof Agent>[0] extends { connect?: infer C } ? C : never =
  ((options: any, callback: any) => {
    const host: string = options?.hostname || options?.host || '';
    if (!host) return _defaultConnector(options, callback);

    // Re-resolve at connect time. This is the AUTHORITATIVE check —
    // pre-fetch classifyHost is just an optimization that avoids a wasted
    // TCP attempt for known-bad hosts.
    resolveAllAddresses(host).then(
      (ips) => {
        if (!ips || ips.length === 0) {
          // DNS failed at connect time. Surface as a generic failure so
          // followChain can map it to status='failed'.
          const err: any = new Error('DNS_FAILED_AT_CONNECT');
          err.code = 'EDNSFAIL';
          return callback(err, null);
        }
        const blockedIp = ips.find((ip) => isPrivateIp(ip));
        if (blockedIp) {
          logger.warn('domain_resolution_blocked_rebind', {
            hostname: host,
            resolved_ips: ips,
            blocked_ip: blockedIp,
          });
          const err: any = new Error(`Connect blocked — rebind to private IP ${blockedIp}`);
          err.code = REBIND_BLOCK_CODE;
          return callback(err, null);
        }
        return _defaultConnector(options, callback);
      },
      (lookupErr: unknown) => {
        const err: any = new Error('DNS_LOOKUP_THREW');
        err.code = 'EDNSFAIL';
        err.cause = lookupErr;
        callback(err, null);
      },
    );
  }) as any;

/**
 * SafeAgent — undici Agent with connect-time SSRF validation.
 * Subclass exists for type identity + clarity at the construction site;
 * actual interception happens via the connect factory above.
 */
class SafeAgent extends Agent {
  constructor(options: ConstructorParameters<typeof Agent>[0] = {}) {
    super({ ...options, connect: safeConnect as any });
  }
}

/**
 * Scoped dispatcher used ONLY by resolveDomain / followChain via the
 * `dispatcher` option on fetch(). NOT installed globally — every other
 * outbound HTTP caller in the process keeps Node's default behavior.
 *
 * Exported for tests (so they can swap in a stub dispatcher); production
 * callers should not touch it directly.
 */
export const safeDispatcher = new SafeAgent({
  connections: 10,
  pipelining: 1,
});

// ─────────────────────────────────────────────────────────────────────────────
// HTTP fetch with body cap + per-hop timeout
// ─────────────────────────────────────────────────────────────────────────────

function isRebindBlock(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  // Modern fetch errors wrap the underlying connector error in `cause`.
  const direct = (err as any).code === REBIND_BLOCK_CODE;
  const nested = (err as any).cause && (err as any).cause.code === REBIND_BLOCK_CODE;
  return Boolean(direct || nested);
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    // `dispatcher` is a Node-/undici-specific option on fetch — Node 22's
    // global fetch routes the request through the supplied dispatcher
    // INSTEAD of the default. This is what scopes SSRF+rebind protection
    // to canonical-resolution traffic only.
    const res = await fetch(url, {
      ...init,
      signal: ac.signal,
      // @ts-expect-error — `dispatcher` is an undici extension on fetch init,
      // not in the standard RequestInit type.
      dispatcher: safeDispatcher,
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Drain (or abort) the response body so we never hold more than MAX_RESPONSE_BYTES
 * in memory. Reading is necessary so the underlying connection is released.
 */
async function safeDrain(res: Response): Promise<void> {
  if (!res.body) return;
  try {
    const reader = res.body.getReader();
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      total += value?.byteLength ?? 0;
      if (total > MAX_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch { /* ignore */ }
        throw new Error('RESPONSE_TOO_LARGE');
      }
    }
  } catch (err) {
    // Surface size-cap as a fail-closed signal upstream.
    if ((err as Error)?.message === 'RESPONSE_TOO_LARGE') throw err;
    // Other drain errors (connection closed early, etc.) are non-fatal.
  }
}

/**
 * Walk redirects manually so we can record every hop AND SSRF-gate every hop
 * (a redirect can point at a private IP even if the original hostname did not).
 */
async function followChain(startUrl: string): Promise<{
  finalUrl: string | null;
  chain: string[];
  status: 'ok' | 'blocked' | 'rebind_blocked' | 'failed';
}> {
  const chain: string[] = [];
  let current = startUrl;

  for (let i = 0; i < MAX_REDIRECTS; i += 1) {
    let host: string;
    try {
      host = new URL(current).hostname;
    } catch {
      return { finalUrl: null, chain, status: 'failed' };
    }

    const cls = await classifyHost(host);
    if (cls === 'blocked') return { finalUrl: null, chain, status: 'blocked' };
    if (cls === 'failed') return { finalUrl: null, chain, status: 'failed' };

    let res: Response;
    try {
      res = await fetchWithTimeout(
        current,
        { method: 'HEAD', redirect: 'manual' },
        PER_HOP_TIMEOUT_MS,
      );
    } catch (err) {
      if (isRebindBlock(err)) {
        return { finalUrl: null, chain, status: 'rebind_blocked' };
      }
      logger.warn('domain_resolution_timeout', {
        url: current,
        message: (err as Error)?.message ?? 'fetch_failed',
      });
      return { finalUrl: null, chain, status: 'failed' };
    }

    if (res.status === 405 || res.status === 501) {
      try {
        // GET fallback — drain (and size-cap) the body so we don't OOM.
        res = await fetchWithTimeout(
          current,
          { method: 'GET', redirect: 'manual' },
          PER_HOP_TIMEOUT_MS,
        );
        try { await safeDrain(res); } catch { return { finalUrl: null, chain, status: 'failed' }; }
      } catch (err) {
        if (isRebindBlock(err)) {
          return { finalUrl: null, chain, status: 'rebind_blocked' };
        }
        logger.warn('domain_resolution_timeout', {
          url: current,
          message: (err as Error)?.message ?? 'fetch_failed_get',
        });
        return { finalUrl: null, chain, status: 'failed' };
      }
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return { finalUrl: current, chain, status: 'ok' };
      let next: string;
      try {
        next = new URL(loc, current).toString();
      } catch {
        return { finalUrl: null, chain, status: 'failed' };
      }
      chain.push(next);
      current = next;
      continue;
    }

    return { finalUrl: current, chain, status: 'ok' };
  }
  return { finalUrl: current, chain, status: 'ok' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve an input domain to its canonical form.
 *
 * Outcomes:
 *   - resolution_blocked=true  → SSRF gate stopped a hop. Caller decides
 *     whether this is a hard reject or a soft skip (currently rejected
 *     by the user signup flow).
 *   - resolution_failed=true   → DNS / timeout / network error. Caller MUST
 *     reject (fail-closed).
 *   - default                  → input/final/redirect_chain/is_forwarding.
 */
export async function resolveDomain(domain: string): Promise<ResolveDomainResult> {
  const input = normalizeDomain(domain);

  if (!input) {
    return {
      input_domain: '',
      final_domain: '',
      redirect_chain: [],
      is_forwarding: false,
      resolution_failed: true,
    };
  }

  // Try HTTPS first.
  let result = await followChain(`https://${input}`);
  // Only retry over plain HTTP if the HTTPS attempt FAILED outright (DNS /
  // network), never when SSRF blocked it (rebind or pre-fetch). A private
  // host on :443 is just as private on :80 — and a rebind during HTTPS will
  // rebind during HTTP too.
  if (result.status === 'failed') {
    const httpResult = await followChain(`http://${input}`);
    if (httpResult.status !== 'failed') {
      result = httpResult;
    }
  }

  // Connect-time rebind block — hard-fail to resolution_failed per spec.
  // Never falls back to HTTP and never leaks the redirect chain.
  if (result.status === 'rebind_blocked') {
    logger.warn('domain_resolution_failed', {
      input_domain: input,
      reason: 'rebind_blocked',
    });
    return {
      input_domain: input,
      final_domain: input,
      redirect_chain: [],
      is_forwarding: false,
      resolution_failed: true,
    };
  }

  if (result.status === 'blocked') {
    return {
      input_domain: input,
      final_domain: input,
      redirect_chain: [],
      is_forwarding: false,
      resolution_blocked: true,
    };
  }

  if (result.status === 'failed' || !result.finalUrl) {
    logger.warn('domain_resolution_failed', { input_domain: input });
    return {
      input_domain: input,
      final_domain: input,
      redirect_chain: [],
      is_forwarding: false,
      resolution_failed: true,
    };
  }

  let finalHost: string;
  try {
    finalHost = normalizeDomain(new URL(result.finalUrl).hostname);
  } catch {
    return {
      input_domain: input,
      final_domain: input,
      redirect_chain: [],
      is_forwarding: false,
      resolution_failed: true,
    };
  }

  const isForwarding =
    finalHost.length > 0 &&
    finalHost !== input &&
    registrableRoot(finalHost) !== registrableRoot(input);

  return {
    input_domain: input,
    final_domain: finalHost || input,
    redirect_chain: result.chain,
    is_forwarding: isForwarding,
  };
}
