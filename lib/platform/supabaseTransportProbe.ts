/**
 * Passive undici transport probe for Supabase-bound traffic (diagnostic only).
 *
 * WHY
 * ---
 * Application-level Server-Timing measures the whole await around a Supabase
 * call, which bundles three very different things together:
 *
 *   1. establishing a socket (DNS + TCP + TLS to the project region),
 *   2. waiting for the remote service after the request is on the wire,
 *   3. postgrest-js client-side retry backoff (1s/2s/4s - on by default).
 *
 * This module splits them apart by subscribing to the diagnostics channels
 * Node's bundled undici already publishes. It is a pure OBSERVER: it never
 * creates, mutates, delays, retries or inspects a request's payload, and a
 * throw inside any handler is swallowed so instrumentation can never affect
 * the request it is watching.
 *
 * EVENT SEMANTICS (verified empirically on Node 22.17 / bundled undici -
 * NOT assumed):
 *
 *   undici:request:create        { request }                        - caller's async context
 *   undici:client:beforeConnect  { connectParams, connector }       - NO request
 *   undici:client:connected      { connectParams, connector, socket } - NO request
 *   undici:client:sendHeaders    { request, headers, socket }       - request IS on the wire
 *   undici:request:headers       { request, response }              - first response byte
 *   undici:request:trailers      { request, trailers }              - response end
 *
 * The two connect events carry NO request, so connect time cannot be attributed
 * to a request directly. It is attributed through SOCKET OBJECT IDENTITY: the
 * socket published by `connected` is the same object later published by
 * `sendHeaders`. A socket seen for the first time at sendHeaders is a new
 * connection (cold); a socket already consumed by an earlier request is a
 * proven reuse (warm). Reuse is never inferred from the mere absence of a
 * `connected` event.
 *
 * Because `beforeConnect` has no socket either, connect start/finish are paired
 * FIFO per origin. When more than one connect to the same origin is in flight
 * the pairing is ambiguous, and the record reports connect as UNKNOWN rather
 * than a possibly-misattributed number.
 *
 * PRIVACY
 * -------
 * Only the host class and endpoint class are recorded - never a full URL, query
 * string, table name, header value, body, or tenant identifier. The single
 * header ever read is `x-retry-count` (written by postgrest-js itself), and it
 * is accepted only when it matches a one-or-two digit integer - anything else
 * is UNKNOWN.
 */
import { AsyncLocalStorage } from 'async_hooks';
import type { NextApiResponse } from 'next';
import { appendServerTiming } from './serverTiming';

const now = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

/** Kill switch. Default on - this is an approved diagnostic. */
function enabled(): boolean {
  const raw = process.env.SUPABASE_TRANSPORT_PROBE_ENABLED;
  if (raw === undefined || raw === '') return true;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

export type ConnectionState = 'cold' | 'warm' | 'unknown';
export type SupabaseService = 'gotrue' | 'pgrst' | 'storage' | 'control' | 'other';
export type EndpointClass = 'auth' | 'rest' | 'storage' | 'edge' | 'other';

export interface TransportRecord {
  service: SupabaseService;
  /** Endpoint CLASS only - never the table, path tail, or query string. */
  endpoint: EndpointClass;
  /** null = not measurable (ambiguous connect pairing, or socket unknown). */
  connectMs: number | null;
  /** sendHeaders -> response headers. The true request-sent -> first-byte span. */
  ttfbMs: number | null;
  /** create -> response headers. Includes queueing and connect. */
  totalMs: number | null;
  state: ConnectionState;
  /** 1-based attempt number; null when not safely observable. */
  attempts: number | null;
}

export interface TransportCollector {
  records: TransportRecord[];
}

const MAX_RECORDS_PER_REQUEST = 12;
const MAX_INFLIGHT = 256;
const MAX_PENDING_CONNECTS = 32;

const collectorStore = new AsyncLocalStorage<TransportCollector>();

interface Inflight {
  collector: TransportCollector;
  service: SupabaseService;
  endpoint: EndpointClass;
  createdAt: number;
  sentAt: number | null;
  state: ConnectionState;
  connectMs: number | null;
  attempts: number | null;
}

/** Keyed by the undici Request object. Bounded + deleted on every terminal event. */
const inflight = new Map<object, Inflight>();
/** Socket identity -> how it was established. WeakMap: sockets are never retained. */
const socketInfo = new WeakMap<object, { connectMs: number | null; used: boolean }>();
/** origin hostname -> FIFO queue of connect start times (beforeConnect has no socket). */
const pendingConnects = new Map<string, number[]>();

let installed = false;
let envHostCache: string | null | undefined;

function supabaseEnvHost(): string | null {
  if (envHostCache !== undefined) return envHostCache;
  try {
    const raw = String(process.env.SUPABASE_URL ?? '').trim();
    envHostCache = raw ? new URL(raw).hostname.toLowerCase() : null;
  } catch {
    envHostCache = null;
  }
  return envHostCache;
}

function classify(
  originRaw: unknown,
  pathRaw: unknown,
): { service: SupabaseService; endpoint: EndpointClass } | null {
  if (typeof originRaw !== 'string' || typeof pathRaw !== 'string') return null;
  let hostname: string;
  try {
    hostname = new URL(originRaw).hostname.toLowerCase();
  } catch {
    return null;
  }
  // Supabase-bound traffic ONLY. Everything else is ignored outright.
  const envHost = supabaseEnvHost();
  const isSupabase = hostname.endsWith('.supabase.co') || (envHost !== null && hostname === envHost);
  if (!isSupabase) return null;

  // Edge control: the bare PostgREST root with no table. The application never
  // issues this (every real call names a table), so the match is unambiguous.
  if (pathRaw === '/rest/v1/' || pathRaw === '/rest/v1') return { service: 'control', endpoint: 'edge' };
  if (pathRaw.startsWith('/auth/v1')) return { service: 'gotrue', endpoint: 'auth' };
  if (pathRaw.startsWith('/rest/v1')) return { service: 'pgrst', endpoint: 'rest' };
  if (pathRaw.startsWith('/storage/v1')) return { service: 'storage', endpoint: 'storage' };
  return { service: 'other', endpoint: 'other' };
}

/**
 * Read ONLY x-retry-count out of undici's flat header array, and only when it
 * is a small integer. postgrest-js sets it on attempts > 0; its absence on a
 * PostgREST request therefore means attempt 1.
 */
export function readAttempts(headers: unknown, service: SupabaseService): number | null {
  try {
    if (!Array.isArray(headers)) return null; // unexpected shape -> UNKNOWN, never guessed
    for (let i = 0; i + 1 < headers.length; i += 2) {
      const name = headers[i];
      if (typeof name !== 'string' || name.toLowerCase() !== 'x-retry-count') continue;
      const value = headers[i + 1];
      const text = typeof value === 'string' ? value : Array.isArray(value) ? value[0] : null;
      if (typeof text !== 'string' || !/^\d{1,2}$/.test(text)) return null;
      return Number(text) + 1; // header carries a 0-based attemptCount
    }
    // postgrest-js omits the header on the first attempt.
    return service === 'pgrst' ? 1 : null;
  } catch {
    return null;
  }
}

function evictIfNeeded(): void {
  while (inflight.size > MAX_INFLIGHT) {
    const oldest = inflight.keys().next();
    if (oldest.done) return;
    inflight.delete(oldest.value);
  }
}

function finish(request: object, endAt: number | null): void {
  const entry = inflight.get(request);
  if (!entry) return;
  inflight.delete(request); // terminal: never retain the request object
  if (endAt === null) return; // error path - cleaned up, nothing recorded
  const { collector } = entry;
  if (collector.records.length >= MAX_RECORDS_PER_REQUEST) return;
  collector.records.push({
    service: entry.service,
    endpoint: entry.endpoint,
    connectMs: entry.connectMs,
    ttfbMs: entry.sentAt === null ? null : Math.max(0, endAt - entry.sentAt),
    totalMs: Math.max(0, endAt - entry.createdAt),
    state: entry.state,
    attempts: entry.attempts,
  });
}

// -- channel handlers, exported so they can be unit-tested without undici ------

export function onRequestCreate(msg: Record<string, unknown>): void {
  const collector = collectorStore.getStore();
  if (!collector) return; // only capture inside an explicitly-started window
  const request = msg.request as Record<string, unknown> | undefined;
  if (!request || typeof request !== 'object') return;
  const kind = classify(request.origin, request.path);
  if (!kind) return; // non-Supabase traffic is never captured
  inflight.set(request as object, {
    collector,
    service: kind.service,
    endpoint: kind.endpoint,
    createdAt: now(),
    sentAt: null,
    state: 'unknown',
    connectMs: null,
    attempts: null,
  });
  evictIfNeeded();
}

export function onBeforeConnect(msg: Record<string, unknown>): void {
  const params = msg.connectParams as Record<string, unknown> | undefined;
  const host = params && typeof params.hostname === 'string' ? params.hostname.toLowerCase() : null;
  if (!host) return;
  const queue = pendingConnects.get(host) ?? [];
  queue.push(now());
  if (queue.length > MAX_PENDING_CONNECTS) queue.shift();
  pendingConnects.set(host, queue);
}

export function onConnected(msg: Record<string, unknown>): void {
  const params = msg.connectParams as Record<string, unknown> | undefined;
  const socket = msg.socket as object | undefined;
  if (!socket || typeof socket !== 'object') return;
  const host = params && typeof params.hostname === 'string' ? params.hostname.toLowerCase() : null;
  let connectMs: number | null = null;
  if (host) {
    const queue = pendingConnects.get(host);
    if (queue && queue.length > 0) {
      const startedAt = queue.shift() as number;
      // Anything still pending for this origin means FIFO pairing is ambiguous.
      connectMs = queue.length === 0 ? Math.max(0, now() - startedAt) : null;
      if (queue.length === 0) pendingConnects.delete(host);
    }
  }
  socketInfo.set(socket, { connectMs, used: false });
}

export function onConnectError(msg: Record<string, unknown>): void {
  const params = msg.connectParams as Record<string, unknown> | undefined;
  const host = params && typeof params.hostname === 'string' ? params.hostname.toLowerCase() : null;
  if (!host) return;
  const queue = pendingConnects.get(host);
  if (!queue) return;
  queue.shift();
  if (queue.length === 0) pendingConnects.delete(host);
}

export function onSendHeaders(msg: Record<string, unknown>): void {
  const request = msg.request as object | undefined;
  if (!request || typeof request !== 'object') return;
  const entry = inflight.get(request);
  if (!entry) return;
  entry.sentAt = now();
  entry.attempts = readAttempts((request as Record<string, unknown>).headers, entry.service);
  const socket = msg.socket as object | undefined;
  if (!socket || typeof socket !== 'object') {
    entry.state = 'unknown';
    return;
  }
  const info = socketInfo.get(socket);
  if (!info) {
    // Socket established before the probe saw it - do NOT guess.
    entry.state = 'unknown';
    return;
  }
  if (info.used) {
    entry.state = 'warm'; // proven by socket identity, not by absence of an event
    entry.connectMs = 0;
  } else {
    info.used = true;
    entry.state = 'cold';
    entry.connectMs = info.connectMs; // may be null when pairing was ambiguous
  }
}

export function onResponseHeaders(msg: Record<string, unknown>): void {
  const request = msg.request as object | undefined;
  if (!request || typeof request !== 'object') return;
  finish(request, now());
}

export function onTrailers(msg: Record<string, unknown>): void {
  const request = msg.request as object | undefined;
  if (request && typeof request === 'object') inflight.delete(request);
}

export function onRequestError(msg: Record<string, unknown>): void {
  const request = msg.request as object | undefined;
  if (request && typeof request === 'object') finish(request, null);
}

/** Idempotent. Safe to call from any number of modules. */
export function installSupabaseTransportProbe(): void {
  if (installed) return;
  installed = true;
  if (!enabled()) return;

  let dc: typeof import('node:diagnostics_channel');
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    dc = require('node:diagnostics_channel') as typeof import('node:diagnostics_channel');
  } catch {
    return; // no diagnostics_channel -> probe is simply absent
  }

  const on = (name: string, fn: (msg: Record<string, unknown>) => void): void => {
    try {
      dc.channel(name).subscribe((msg) => {
        try {
          fn((msg ?? {}) as Record<string, unknown>);
        } catch {
          /* an observer must never affect the request it observes */
        }
      });
    } catch {
      /* channel unavailable on this runtime */
    }
  };

  on('undici:request:create', onRequestCreate);
  on('undici:client:beforeConnect', onBeforeConnect);
  on('undici:client:connected', onConnected);
  on('undici:client:connectError', onConnectError);
  on('undici:client:sendHeaders', onSendHeaders);
  on('undici:request:headers', onResponseHeaders);
  on('undici:request:trailers', onTrailers);
  on('undici:request:error', onRequestError);
}

/**
 * Start capturing Supabase transport for the current request.
 *
 * Uses enterWith so the collector propagates to every downstream await without
 * wrapping or restructuring the caller (the same pattern the repo already uses
 * in mergeRequestContext).
 */
export function beginTransportCapture(): TransportCollector | null {
  if (!enabled()) return null;
  try {
    installSupabaseTransportProbe();
    const collector: TransportCollector = { records: [] };
    collectorStore.enterWith(collector);
    return collector;
  } catch {
    return null;
  }
}

/**
 * Encode measured transport phases as Server-Timing.
 *
 * dur= is numeric-only, so the non-numeric facets (service, cold/warm, attempt)
 * are encoded deterministically in the metric NAME:
 *
 *   tx1_pgrst_cold_a1_ttfb;dur=204
 *   tx2_gotrue_warm_au_tot;dur=91
 *
 * `au` = attempts unknown, `unknown` = connection state unknown. Only measured
 * values are emitted; a phase that was not measured is simply absent - never a
 * fabricated zero.
 */
export function flushTransportTiming(
  res: NextApiResponse,
  collector: TransportCollector | null,
): void {
  if (!collector) return;
  try {
    collector.records.forEach((r, i) => {
      const attempts = r.attempts === null ? 'au' : `a${r.attempts}`;
      const prefix = `tx${i + 1}_${r.service}_${r.state}_${attempts}`;
      if (r.connectMs !== null) appendServerTiming(res, `${prefix}_conn`, r.connectMs);
      if (r.ttfbMs !== null) appendServerTiming(res, `${prefix}_ttfb`, r.ttfbMs);
      if (r.totalMs !== null) appendServerTiming(res, `${prefix}_tot`, r.totalMs);
    });
  } catch {
    /* diagnostics must never break a response */
  }
}

/** Bounded timeout so the edge control can never stall a handler. */
const EDGE_CONTROL_TIMEOUT_MS = 3_000;

/**
 * TEMPORARY DIAGNOSTIC - edge-terminated control request.
 *
 * Issues an unauthenticated GET to the project's bare PostgREST root on the
 * SAME host, and therefore the same Cloudflare anycast endpoint and the same
 * undici connection pool, as the application's real Supabase calls.
 *
 * The Supabase gateway rejects it for a missing api key
 * (sb-error-code: UNAUTHORIZED_MISSING_API_KEY) without routing it to the
 * project origin, so its TTFB measures Vercel -> edge -> response only. Paired
 * with a normal origin-bound call in the same invocation, this separates delay
 * occurring before the edge from delay occurring beyond it.
 *
 * Touches no database, no application data, no auth state and no tenant state,
 * sends no credentials, and can never throw into the caller.
 */
export async function probeEdgeControl(): Promise<void> {
  if (!enabled()) return;
  try {
    const host = supabaseEnvHost();
    if (!host) return;
    const res = await fetch(`https://${host}/rest/v1/`, {
      method: 'GET',
      signal: AbortSignal.timeout(EDGE_CONTROL_TIMEOUT_MS),
    });
    await res.arrayBuffer(); // drain so the socket returns to the pool
  } catch {
    /* diagnostic only - never affects the response */
  }
}

/** Test hooks. */
export function __runWithCollectorForTests<T>(collector: TransportCollector, fn: () => T): T {
  return collectorStore.run(collector, fn);
}
export function __resetTransportProbeForTests(): void {
  inflight.clear();
  pendingConnects.clear();
  envHostCache = undefined;
}
export function __inflightSizeForTests(): number {
  return inflight.size;
}
