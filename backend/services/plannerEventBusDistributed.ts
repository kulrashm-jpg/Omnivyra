/**
 * Cross-instance planner event propagation via Redis Pub/Sub.
 *
 * Wraps the in-process `plannerEventBus` so:
 *   - emit() also PUBLISHes the event to a Redis channel
 *   - a subscriber reads PMESSAGES and re-emits them into the LOCAL bus on
 *     this instance with a `propagated: true` flag, so local handlers run
 *     across the fleet
 *
 * Dedup: the local bus already dedups on (type, campaign_id, plan_revision_id)
 * with a 5-min TTL. When the same event arrives via pub/sub, the local
 * dedup catches it. We also stamp `origin_instance_id` on every published
 * event so the publisher can recognize its own echo and drop it before
 * re-emitting locally.
 *
 * Ordering: Redis Pub/Sub is at-most-once and best-effort ordered per channel.
 * For ordered-per-campaign delivery, callers would need a different transport
 * (Redis Streams with consumer groups). Documented as a known limitation.
 *
 * Failure: Redis outage takes pub/sub down. The LOCAL bus keeps working —
 * subscribers on this instance still receive events. Other instances simply
 * stop seeing this instance's events until Redis is restored.
 *
 * Env flag: DISTRIBUTED_EVENTS_ENABLED (default false). When false the bus
 * is purely local and the pub/sub channel is never touched.
 */

import type IORedis from 'ioredis';
import { resolvePlannerFlag } from './plannerRolloutMode';
import { randomUUID } from 'crypto';
import { logger } from './logger';
import { plannerEventBus, type PlannerEvent, type PlannerEventType } from './plannerEventBus';

const CHANNEL = 'planner:events';

// Events that we propagate cross-instance. Others stay process-local (e.g.
// progressive_phase_completed is consumed only by the originating UI poller).
const PROPAGATED_TYPES = new Set<PlannerEventType>([
  'plan_created',
  'salvage_applied',
  'refinement_completed',
  'overload_mode_activated',
  'alignment_completed',
]);

// Stable per-process id so the publisher can drop its own echoes. Generated
// once at module load and never persisted.
const INSTANCE_ID = randomUUID();

let _pub: IORedis | null = null;
let _sub: IORedis | null = null;
let _started = false;
let _failureCount = 0;
const FAILURE_DISABLE_THRESHOLD = 5;

function isEnabled(): boolean {
  return resolvePlannerFlag('DISTRIBUTED_EVENTS_ENABLED', false);
}

function getPubClient(): IORedis | null {
  if (_failureCount >= FAILURE_DISABLE_THRESHOLD) return null;
  if (_pub) return _pub;
  try {
    const { getInstrumentedStandaloneRedisClient } =
      require('../queue/standaloneRedisClient') as typeof import('../queue/standaloneRedisClient');
    _pub = getInstrumentedStandaloneRedisClient('planner-events-pub');
    return _pub;
  } catch (err) {
    _failureCount += 1;
    logger.warn('distributed_events_pub_unavailable', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function getSubClient(): IORedis | null {
  if (_failureCount >= FAILURE_DISABLE_THRESHOLD) return null;
  if (_sub) return _sub;
  try {
    // SUBSCRIBE clients in ioredis cannot run other commands, so we need a
    // separate client from the pub client. Use a freshly instrumented one.
    const { getInstrumentedStandaloneRedisClient } =
      require('../queue/standaloneRedisClient') as typeof import('../queue/standaloneRedisClient');
    _sub = getInstrumentedStandaloneRedisClient('planner-events-sub');
    return _sub;
  } catch (err) {
    _failureCount += 1;
    logger.warn('distributed_events_sub_unavailable', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Wire the local bus to publish propagatable events to Redis, and start a
 * Redis subscriber that re-emits incoming events into the local bus.
 *
 * Idempotent — call from worker + web bootstraps. Safe to call when Redis
 * is unavailable (no-op, periodic retry on next call).
 */
export async function startDistributedPlannerEvents(): Promise<void> {
  if (_started) return;
  if (!isEnabled()) return;
  const sub = getSubClient();
  const pub = getPubClient();
  if (!sub || !pub) return;

  // ── Publisher: wrap the local bus emit ──────────────────────────────────
  plannerEventBus.onAny((event) => {
    if (!PROPAGATED_TYPES.has(event.type)) return;
    // Skip events that originated remotely — we only publish locally-emitted ones.
    if ((event.payload as any)?.__origin_instance_id) return;
    const envelope = {
      ...event,
      payload: { ...(event.payload as Record<string, unknown>), __origin_instance_id: INSTANCE_ID },
    };
    pub.publish(CHANNEL, JSON.stringify(envelope)).catch((err) => {
      _failureCount += 1;
      logger.warn('distributed_events_publish_failed', {
        type: event.type,
        campaign_id: event.campaign_id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });

  // ── Subscriber: re-emit remote events into local bus ───────────────────
  try {
    await sub.subscribe(CHANNEL);
  } catch (err) {
    _failureCount += 1;
    logger.warn('distributed_events_subscribe_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  sub.on('message', (channel, message) => {
    if (channel !== CHANNEL) return;
    let envelope: PlannerEvent | null = null;
    try { envelope = JSON.parse(message) as PlannerEvent; } catch { return; }
    if (!envelope || !envelope.type) return;
    // Drop our own echoes — origin id must NOT match ours.
    const originId = (envelope.payload as any)?.__origin_instance_id;
    if (originId === INSTANCE_ID) return;
    // Re-emit on the local bus. The local dedup map (5min TTL on
    // type+campaign+revision) catches genuine duplicates from retries.
    // We add a `propagated: true` flag so subscribers can branch (e.g.
    // logging dashboards may want to differentiate local-vs-remote).
    plannerEventBus.emit({
      type: envelope.type,
      campaign_id: envelope.campaign_id,
      plan_revision_id: envelope.plan_revision_id,
      payload: {
        ...(envelope.payload as Record<string, unknown>),
        __propagated: true,
        __origin_instance_id: originId,
      },
    });
  });
  _started = true;
  logger.info('distributed_events_started', { instance_id: INSTANCE_ID, channel: CHANNEL });
}

/**
 * Tear down cross-instance event propagation. Used by worker shutdown
 * lifecycle so the subscriber unsubscribes cleanly.
 */
export async function stopDistributedPlannerEvents(): Promise<void> {
  if (_sub) {
    try { await _sub.unsubscribe(CHANNEL); } catch { /* noop */ }
  }
  _started = false;
}

export function getInstanceIdForTests(): string {
  return INSTANCE_ID;
}
