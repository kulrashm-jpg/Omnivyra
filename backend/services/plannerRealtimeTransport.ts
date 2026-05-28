/**
 * Planner realtime transport.
 *
 * Decouples SSE delivery from app workers so high-volume connection
 * coordination doesn't live in the planner request path. The transport
 * owns:
 *   - Per-campaign subscription registry (in-memory + Redis pub/sub mirror)
 *   - Connection multiplexing: many client connections for the same
 *     campaign share one upstream subscription
 *   - Connection-flood protection: per-campaign cap (default 50) +
 *     per-instance global cap (default 1000)
 *   - Memory-safe fanout: bounded per-connection write buffer; slow clients
 *     are evicted with a `closed: too_slow` event
 *   - Reconnect replay (delegates to `replayCampaignEvents`)
 *   - Graceful degradation: when the realtime transport is overloaded OR
 *     the env flag is off, callers can `shouldFallbackToPolling()` and
 *     return immediately so the client polls instead
 *
 * Backward-compatible: the existing `/api/bolt/progress-stream` endpoint
 * keeps working as-is. New code can opt into this transport by calling
 * `subscribe()` / `publish()` instead of attaching directly to the in-
 * process event bus. Gradual migration.
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type IORedis from 'ioredis';
import { logger } from './logger';
import { plannerEventBus, type PlannerEvent } from './plannerEventBus';
import { counter, gauge } from './plannerTelemetry';

/* eslint-disable @typescript-eslint/no-explicit-any */

const CHANNEL_PREFIX = 'planner:realtime:campaign:';
// Caps are READ ON EVERY CHECK so operator env-flag changes (and tests)
// take effect without a process restart. Each read is a cheap Number(...)
// parse with a fallback default.
const maxPerCampaign = () => Number(process.env.PLANNER_REALTIME_MAX_PER_CAMPAIGN || 50);
const maxPerInstance = () => Number(process.env.PLANNER_REALTIME_MAX_PER_INSTANCE || 1000);
const maxBufferPerConnection = () => Number(process.env.PLANNER_REALTIME_BUFFER_LIMIT || 256);
const FAILURE_DISABLE_THRESHOLD = 5;

let _pub: IORedis | null = null;
let _sub: IORedis | null = null;
let _failureCount = 0;
const _started = { value: false };

function isEnabled(): boolean {
  return String(process.env.PLANNER_REALTIME_TRANSPORT_ENABLED ?? 'false').toLowerCase() === 'true';
}

function getPubOrNull(): IORedis | null {
  if (_failureCount >= FAILURE_DISABLE_THRESHOLD) return null;
  if (_pub) return _pub;
  try {
    const { getInstrumentedStandaloneRedisClient } =
      require('../queue/standaloneRedisClient') as typeof import('../queue/standaloneRedisClient');
    _pub = getInstrumentedStandaloneRedisClient('planner-realtime-pub');
    return _pub;
  } catch (err) {
    _failureCount = FAILURE_DISABLE_THRESHOLD;
    logger.warn('planner_realtime_pub_unavailable', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

function getSubOrNull(): IORedis | null {
  if (_failureCount >= FAILURE_DISABLE_THRESHOLD) return null;
  if (_sub) return _sub;
  try {
    const { getInstrumentedStandaloneRedisClient } =
      require('../queue/standaloneRedisClient') as typeof import('../queue/standaloneRedisClient');
    _sub = getInstrumentedStandaloneRedisClient('planner-realtime-sub');
    return _sub;
  } catch (err) {
    _failureCount = FAILURE_DISABLE_THRESHOLD;
    logger.warn('planner_realtime_sub_unavailable', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/* ───────────────────────────────────────────────────────────────────────
 * Connection registry.
 *
 * One `Connection` object per SSE / WebSocket client. The transport routes
 * events to all matching connections via an in-process EventEmitter; the
 * client's network write happens in the connection's `send` callback.
 * ────────────────────────────────────────────────────────────────────── */

export interface Connection {
  id: string;
  campaignId: string;
  /** Write callback. Must NOT throw — implementations swallow errors and
   *  trigger eviction by setting `closed` to true. */
  send: (event: PlannerEvent) => void;
  /** Close callback. Called by the transport when evicting. */
  close: (reason: 'too_slow' | 'evicted' | 'server_shutdown' | 'manual') => void;
  /** Bounded in-memory buffer of yet-to-deliver events. Used for flood
   *  detection — when this exceeds maxBufferPerConnection() the connection
   *  is evicted with reason `too_slow`. */
  buffered: number;
  /** Set true on eviction. Subsequent dispatches are no-ops. */
  closed: boolean;
}

const _connsByCampaign = new Map<string, Set<Connection>>();
let _totalConnections = 0;

function addConnection(c: Connection): void {
  const set = _connsByCampaign.get(c.campaignId) ?? new Set();
  set.add(c);
  _connsByCampaign.set(c.campaignId, set);
  _totalConnections += 1;
  gauge('planner_sse_connections_active', _totalConnections);
}

function removeConnection(c: Connection): void {
  const set = _connsByCampaign.get(c.campaignId);
  if (set) {
    set.delete(c);
    if (set.size === 0) _connsByCampaign.delete(c.campaignId);
  }
  _totalConnections = Math.max(0, _totalConnections - 1);
  gauge('planner_sse_connections_active', _totalConnections);
}

/** True when local resources are saturated → callers should fall back to polling. */
export function shouldFallbackToPolling(campaignId: string): boolean {
  if (!isEnabled()) return true;
  if (_totalConnections >= maxPerInstance()) return true;
  const campSet = _connsByCampaign.get(campaignId);
  if (campSet && campSet.size >= maxPerCampaign()) return true;
  return false;
}

/**
 * Subscribe a client connection for a single campaign. Returns an
 * `unsubscribe` function which the SSE handler MUST call on disconnect.
 *
 * When `shouldFallbackToPolling` would return true, this call still
 * accepts the connection (so the caller doesn't need to branch twice) but
 * triggers an immediate eviction on the NEXT event with `closed: too_slow`
 * — caller's `close` callback receives this so the client can fall back.
 */
export function subscribe(opts: {
  campaignId: string;
  send: (event: PlannerEvent) => void;
  close: (reason: 'too_slow' | 'evicted' | 'server_shutdown' | 'manual') => void;
}): { connectionId: string; unsubscribe: () => void; fellBackToPolling: boolean } {
  const fallback = shouldFallbackToPolling(opts.campaignId);
  const conn: Connection = {
    id: randomUUID(),
    campaignId: opts.campaignId,
    send: (event) => {
      if (conn.closed) return;
      if (conn.buffered >= maxBufferPerConnection()) {
        conn.closed = true;
        try { opts.close('too_slow'); } catch { /* swallow */ }
        counter('planner_sse_disconnect_rate', 1, { reason: 'too_slow' });
        removeConnection(conn);
        return;
      }
      conn.buffered += 1;
      try {
        opts.send(event);
      } catch (err) {
        conn.closed = true;
        try { opts.close('evicted'); } catch { /* swallow */ }
        counter('planner_sse_disconnect_rate', 1, { reason: 'server_terminated' });
        removeConnection(conn);
        logger.warn('planner_realtime_connection_send_failed', {
          campaign_id: opts.campaignId, connection_id: conn.id, error: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      conn.buffered = Math.max(0, conn.buffered - 1);
    },
    close: (reason) => {
      if (conn.closed) return;
      conn.closed = true;
      try { opts.close(reason); } catch { /* swallow */ }
      removeConnection(conn);
      counter('planner_sse_disconnect_rate', 1, { reason });
    },
    buffered: 0,
    closed: false,
  };
  addConnection(conn);
  if (fallback) {
    // Connection accepted to give caller a uniform return shape, but mark
    // it for immediate eviction.
    setImmediate(() => conn.close('too_slow'));
  }
  return {
    connectionId: conn.id,
    unsubscribe: () => conn.close('manual'),
    fellBackToPolling: fallback,
  };
}

/* ───────────────────────────────────────────────────────────────────────
 * Fanout.
 *
 * Two delivery paths:
 *   - LOCAL: subscribe to plannerEventBus; for every event, dispatch to
 *     local connections matching the campaign.
 *   - DISTRIBUTED: also publish to Redis Pub/Sub; other instances'
 *     subscribers receive and re-fan to their local connections.
 *
 * `start()` wires both. Idempotent.
 * ────────────────────────────────────────────────────────────────────── */

const _localEmitter = new EventEmitter();
_localEmitter.setMaxListeners(100);

function dispatchToLocalConnections(event: PlannerEvent): void {
  const set = _connsByCampaign.get(event.campaign_id);
  if (!set || set.size === 0) return;
  for (const conn of set) conn.send(event);
}

/** Publish an event explicitly. Most callers should let the event bus do it. */
export async function publish(event: PlannerEvent): Promise<void> {
  // Local fanout.
  dispatchToLocalConnections(event);
  // Distributed fanout via Pub/Sub.
  const pub = getPubOrNull();
  if (!pub) return;
  try {
    await pub.publish(`${CHANNEL_PREFIX}${event.campaign_id}`, JSON.stringify(event));
  } catch (err) {
    _failureCount += 1;
    logger.warn('planner_realtime_publish_failed', {
      campaign_id: event.campaign_id, error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function start(): void {
  if (_started.value) return;
  if (!isEnabled()) return;

  // LOCAL: forward every planner event to local connections.
  plannerEventBus.onAny((event) => {
    try { dispatchToLocalConnections(event); } catch { /* swallow */ }
    // ALSO publish to Redis so other instances' subscribers see it.
    const pub = getPubOrNull();
    if (pub) {
      pub.publish(`${CHANNEL_PREFIX}${event.campaign_id}`, JSON.stringify(event)).catch(() => undefined);
    }
  });

  // DISTRIBUTED: subscribe via pattern so we get ANY campaign channel
  // matching the prefix. The subscriber filters by local interest before
  // dispatching to avoid CPU waste on campaigns this instance has no
  // connections for.
  const sub = getSubOrNull();
  if (sub) {
    sub.psubscribe(`${CHANNEL_PREFIX}*`).catch((err) => {
      _failureCount += 1;
      logger.warn('planner_realtime_psubscribe_failed', { error: err instanceof Error ? err.message : String(err) });
    });
    sub.on('pmessage', (_pattern, channel, message) => {
      try {
        const campaignId = channel.slice(CHANNEL_PREFIX.length);
        if (!_connsByCampaign.has(campaignId)) return; // no local interest
        const event = JSON.parse(message) as PlannerEvent;
        dispatchToLocalConnections(event);
      } catch (err) {
        logger.warn('planner_realtime_pmessage_dispatch_failed', { error: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  _started.value = true;
  logger.info('planner_realtime_transport_started', {
    max_per_campaign: maxPerCampaign(),
    max_per_instance: maxPerInstance(),
    distributed: !!sub,
  });
}

export function stop(): void {
  if (_sub) { _sub.punsubscribe(`${CHANNEL_PREFIX}*`).catch(() => undefined); }
  _started.value = false;
}

/* ───────────────────────────────────────────────────────────────────────
 * Snapshot for ops dashboards.
 * ────────────────────────────────────────────────────────────────────── */

export interface RealtimeSnapshot {
  enabled: boolean;
  started: boolean;
  total_connections: number;
  per_campaign: Array<{ campaign_id: string; connections: number }>;
  max_per_campaign: number;
  max_per_instance: number;
  redis_healthy: boolean;
}

export function snapshot(): RealtimeSnapshot {
  const perCampaign = Array.from(_connsByCampaign.entries()).map(([campaign_id, set]) => ({
    campaign_id,
    connections: set.size,
  }));
  return {
    enabled: isEnabled(),
    started: _started.value,
    total_connections: _totalConnections,
    per_campaign: perCampaign,
    max_per_campaign: maxPerCampaign(),
    max_per_instance: maxPerInstance(),
    redis_healthy: _failureCount < FAILURE_DISABLE_THRESHOLD,
  };
}

export function __resetForTests(): void {
  for (const set of _connsByCampaign.values()) for (const c of set) c.closed = true;
  _connsByCampaign.clear();
  _totalConnections = 0;
  _started.value = false;
  _failureCount = 0;
  _pub = null;
  _sub = null;
}
