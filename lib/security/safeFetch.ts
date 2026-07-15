/**
 * HARDEN-005 — safe outbound fetch (the centralized enforcement seam).
 *
 * Every protected server-side outbound request should go through safeFetch /
 * safeFetchBuffer instead of raw fetch/axios. It composes the ssrfGuard policy
 * with the runtime protections that can only happen at request time:
 *
 *   1. URL validation (protocol / credentials / literal-IP) via ssrfGuard.
 *   2. DNS resolution of the hostname, and rejection if ANY resolved address is
 *      in a blocked range (IPv4 + IPv6).
 *   3. Connection PINNING: the socket is forced to connect to the exact IPs we
 *      validated (custom undici lookup), so a hostname that re-resolves to a
 *      private IP between our check and the connection (DNS rebinding) cannot
 *      reach an internal target.
 *   4. Manual redirect following: every hop is re-validated + re-resolved +
 *      re-pinned; capped count; no redirect can escape into a private network.
 *   5. Limits: connect/headers/body timeouts, max response size (declared
 *      Content-Length pre-check AND streamed byte cap to stop decompression
 *      bombs), max redirects.
 *   6. Observability: allowed / blocked / dns-failure / redirect / timeout /
 *      size counters + latency, via the HARDEN-001 registry (fail-safe).
 *
 * Fail-CLOSED: any validation failure throws SsrfBlockedError; the request is
 * never issued.
 */
import dns from 'dns';
import { Agent, fetch as undiciFetch } from 'undici';
import { validateOutboundUrl, isBlockedIp, type SsrfPolicy } from './ssrfGuard';
import { recordExternal, recordRawCounter } from '../../backend/observability';
import { defineRolloutFlag, resolveRolloutSync } from '../platform/rollout';

export interface SafeFetchOptions extends SsrfPolicy {
  /** Max redirects to follow (default 3, 0 = none). */
  maxRedirects?: number;
  /** Max response bytes (default 25 MiB). Applies to declared + streamed size. */
  maxBytes?: number;
  /** Overall + per-phase timeouts (ms). */
  timeoutMs?: number;
  /** Label for observability metrics (defaults to the resolved host). */
  metricLabel?: string;
}

const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024; // 25 MiB
const DEFAULT_TIMEOUT_MS = 15_000;

export class SsrfBlockedError extends Error {
  readonly reason: string;
  readonly target: string;
  constructor(reason: string, target: string) {
    super(`SSRF blocked (${reason}) for ${target}`);
    this.name = 'SsrfBlockedError';
    this.reason = reason;
    this.target = target;
  }
}

function countBlocked(reason: string, host: string): void {
  try { recordRawCounter('ssrf.request.blocked', 1, { reason, host }); } catch { /* fail-safe */ }
}
function countAllowed(host: string): void {
  try { recordRawCounter('ssrf.request.allowed', 1, { host }); } catch { /* fail-safe */ }
}
function countEvent(name: string, host: string): void {
  try { recordRawCounter(`ssrf.request.${name}`, 1, { host }); } catch { /* fail-safe */ }
}

/**
 * Validate + DNS-resolve + IP-check a URL WITHOUT issuing the request. Throws
 * SsrfBlockedError if the target is unsafe. For call sites that must keep their
 * existing download mechanics (e.g. axios arraybuffer in the publish hot path)
 * but need to block internal targets before connecting. Note: unlike safeFetch,
 * this does not pin the connection, so a narrow DNS-rebinding TOCTOU window
 * remains — prefer safeFetch/safeFetchBuffer where the mechanics allow.
 */
export async function assertUrlSafe(rawUrl: string, options: SafeFetchOptions = {}): Promise<void> {
  const policy: SsrfPolicy = {
    allowHttp: options.allowHttp,
    allowedHosts: options.allowedHosts,
    allowPrivateNetwork: options.allowPrivateNetwork,
  };
  const check = validateOutboundUrl(rawUrl, policy);
  if (!check.ok || !check.url) {
    countBlocked(check.reason ?? 'invalid', String(rawUrl).slice(0, 120));
    throw new SsrfBlockedError(check.reason ?? 'invalid', String(rawUrl));
  }
  await resolveAndValidate(check.url.hostname, policy);
  countAllowed(check.url.hostname);
}

/** Resolve a hostname to all A/AAAA records and reject if any is blocked. */
async function resolveAndValidate(hostname: string, policy: SsrfPolicy): Promise<Array<{ address: string; family: number }>> {
  if (policy.allowPrivateNetwork) {
    // Test / explicit-dev path: skip DNS pinning, let the platform resolve.
    return [];
  }
  let records: Array<{ address: string; family: number }>;
  try {
    records = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch {
    countEvent('dns_failure', hostname);
    throw new SsrfBlockedError('dns_resolution_failed', hostname);
  }
  if (!records.length) {
    throw new SsrfBlockedError('dns_no_records', hostname);
  }
  for (const rec of records) {
    if (isBlockedIp(rec.address)) {
      throw new SsrfBlockedError('resolved_to_blocked_ip', `${hostname} → ${rec.address}`);
    }
  }
  return records;
}

/** A custom undici lookup that only ever returns the pre-validated addresses. */
function makePinnedLookup(addresses: Array<{ address: string; family: number }>): (
  hostname: string,
  options: dns.LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void,
) => void {
  return (_hostname, options, callback) => {
    if (addresses.length === 0) {
      callback(new Error('no validated addresses'), '', 0);
      return;
    }
    if (options && (options as dns.LookupOptions).all) {
      callback(null, addresses.map((a) => ({ address: a.address, family: a.family })));
    } else {
      callback(null, addresses[0].address, addresses[0].family);
    }
  };
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

// ── W2-5 (audit B-18): pooled keep-alive agents ───────────────────────────────
//
// With the flag OFF (default) every call builds a fresh single-use Agent —
// today's behavior byte-for-byte. With 'outbound-keepalive' ON, agents are
// reused per (hostname, validated-address-set, timeout): repeat calls to the
// same host skip the TCP+TLS handshake (~50–150 ms each).
//
// SECURITY IS UNCHANGED EITHER WAY: DNS resolution + SSRF validation still
// run on EVERY call and EVERY redirect hop (resolveAndValidate above); an
// agent is only reused when the freshly-validated address set is IDENTICAL
// to the one it was pinned to — a DNS change produces a different pool key
// and a new pinned agent. Bounded LRU; evicted agents are closed.
// Enable: ROLLOUT_OUTBOUND_KEEPALIVE_MODE=enforce (or configureOutboundAgents
// in lib/platform/outboundHttp). Kill: ROLLOUT_OUTBOUND_KEEPALIVE_KILL.
const OUTBOUND_KEEPALIVE_FLAG = defineRolloutFlag({
  key: 'outbound-keepalive',
  description: 'W2-5: pooled keep-alive agents in safeFetch (audit B-18)',
});

const AGENT_POOL = new Map<string, Agent>();
const AGENT_POOL_MAX = 64;

function getPooledAgent(
  host: string,
  addresses: Array<{ address: string; family: number }>,
  timeoutMs: number,
): Agent {
  const key = `${host}|${addresses.map((a) => a.address).sort().join(',')}|${timeoutMs}`;
  const existing = AGENT_POOL.get(key);
  if (existing) {
    AGENT_POOL.delete(key);
    AGENT_POOL.set(key, existing); // LRU bump
    return existing;
  }
  const agent = new Agent({
    connect: { lookup: makePinnedLookup(addresses), timeout: timeoutMs },
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
    maxRedirections: 0, // we follow manually so every hop is re-validated
    keepAliveTimeout: 10_000,
    keepAliveMaxTimeout: 60_000,
  });
  AGENT_POOL.set(key, agent);
  if (AGENT_POOL.size > AGENT_POOL_MAX) {
    const oldestKey = AGENT_POOL.keys().next().value as string;
    const evicted = AGENT_POOL.get(oldestKey);
    AGENT_POOL.delete(oldestKey);
    void evicted?.close().catch(() => { /* best-effort */ });
  }
  return agent;
}

/**
 * Perform a validated, pinned, redirect-safe outbound fetch. Returns the final
 * undici Response (its body still needs reading; use readCapped/safeFetchBuffer
 * to enforce the streamed byte cap, or read small JSON/text directly).
 */
export async function safeFetch(rawUrl: string, init: RequestInit = {}, options: SafeFetchOptions = {}): Promise<Response> {
  const policy: SsrfPolicy = {
    allowHttp: options.allowHttp,
    allowedHosts: options.allowedHosts,
    allowPrivateNetwork: options.allowPrivateNetwork,
  };
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let currentUrl = rawUrl;
  let redirects = 0;
  const t0 = Date.now();

  while (true) {
    const check = validateOutboundUrl(currentUrl, policy);
    if (!check.ok || !check.url) {
      countBlocked(check.reason ?? 'invalid', String(currentUrl).slice(0, 120));
      throw new SsrfBlockedError(check.reason ?? 'invalid', String(currentUrl));
    }
    const url = check.url;
    const host = url.hostname;

    const addresses = await resolveAndValidate(host, policy);

    // W2-5: pooled keep-alive agent when the rollout flag is on; otherwise
    // the historical fresh-per-call agent. Pinning semantics identical.
    const agent = resolveRolloutSync(OUTBOUND_KEEPALIVE_FLAG).mode !== 'off'
      ? getPooledAgent(host, addresses, timeoutMs)
      : new Agent({
          connect: { lookup: makePinnedLookup(addresses), timeout: timeoutMs },
          headersTimeout: timeoutMs,
          bodyTimeout: timeoutMs,
          maxRedirections: 0, // we follow manually so every hop is re-validated
        });

    let res: Response;
    try {
      res = (await undiciFetch(url, {
        ...(init as Record<string, unknown>),
        redirect: 'manual',
        dispatcher: agent,
      } as never)) as unknown as Response;
    } catch (err) {
      const timedOut = /timeout|UND_ERR_(CONNECT_TIMEOUT|HEADERS_TIMEOUT|BODY_TIMEOUT)/i.test((err as Error)?.message ?? '');
      if (timedOut) countEvent('timeout', host);
      try { recordExternal({ host, durationMs: Date.now() - t0, error: true, timeout: timedOut }); } catch { /* fail-safe */ }
      throw err instanceof SsrfBlockedError ? err : err;
    }

    if (isRedirectStatus(res.status)) {
      const location = res.headers.get('location');
      if (location) {
        if (redirects >= maxRedirects) {
          try { await res.body?.cancel(); } catch { /* ignore */ }
          countBlocked('too_many_redirects', host);
          throw new SsrfBlockedError('too_many_redirects', currentUrl);
        }
        redirects += 1;
        countEvent('redirect', host);
        try { await res.body?.cancel(); } catch { /* ignore */ }
        currentUrl = new URL(location, url).href; // re-validated at loop top
        continue;
      }
    }

    // Declared-size pre-check (cheap; the streamed cap in readCapped is the real guard).
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      try { await res.body?.cancel(); } catch { /* ignore */ }
      countBlocked('response_too_large', host);
      throw new SsrfBlockedError('response_too_large', currentUrl);
    }

    countAllowed(host);
    try { recordExternal({ host, durationMs: Date.now() - t0, status: res.status, error: res.status >= 500 }); } catch { /* fail-safe */ }
    // Stash the cap so readCapped/safeFetchBuffer can enforce it.
    (res as { __ssrfMaxBytes?: number }).__ssrfMaxBytes = maxBytes;
    return res;
  }
}

/**
 * Read a Response body into a Buffer, aborting if it exceeds maxBytes (defeats
 * decompression bombs / oversized downloads that lie about Content-Length).
 */
export async function readCapped(res: Response, maxBytes?: number): Promise<Buffer> {
  const cap = maxBytes ?? (res as { __ssrfMaxBytes?: number }).__ssrfMaxBytes ?? DEFAULT_MAX_BYTES;
  const body = res.body;
  if (!body) return Buffer.alloc(0);
  const reader = (body as ReadableStream<Uint8Array>).getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > cap) {
          try { await reader.cancel(); } catch { /* ignore */ }
          const host = (() => { try { return new URL(res.url).hostname; } catch { return 'unknown'; } })();
          countBlocked('stream_exceeded_max_bytes', host);
          throw new SsrfBlockedError('stream_exceeded_max_bytes', res.url || 'unknown');
        }
        chunks.push(Buffer.from(value));
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
  return Buffer.concat(chunks, total);
}

/**
 * Convenience for media/asset downloads: validate + fetch + size-capped read.
 * Returns the bytes, content-type, and status. Throws SsrfBlockedError on any
 * policy failure or oversize.
 */
export async function safeFetchBuffer(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<{ buffer: Buffer; contentType: string | null; status: number; finalUrl: string }> {
  const res = await safeFetch(rawUrl, { method: 'GET' }, options);
  const buffer = await readCapped(res, options.maxBytes);
  return {
    buffer,
    contentType: res.headers.get('content-type'),
    status: res.status,
    finalUrl: res.url || rawUrl,
  };
}
