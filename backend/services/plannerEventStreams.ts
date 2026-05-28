/**
 * Redis Streams event bus — durable replacement for Pub/Sub.
 *
 * Three streams:
 *   planner:events       — drafting/alignment/refinement/salvage/overload
 *   planner:refinement   — refinement-only events (subset, dedicated stream
 *                          for downstream consumers that don't need the rest)
 *   planner:optimization — future optimization phases (reserved)
 *
 * Semantics:
 *   - At-least-once delivery via XREADGROUP + XACK
 *   - Per-consumer-group cursor — multiple consumer groups can replay
 *     independently
 *   - Bounded retention via MAXLEN ~ N (approximate trim)
 *   - Replay-by-campaign via XRANGE filter on stored campaign_id field
 *   - Dead-letter via XPENDING + delivery-count threshold → planner:dead
 *
 * The local in-process bus is unchanged — every emit also fires the local
 * EventEmitter so synchronous subscribers (telemetry, side effects in the
 * same process) still work. Streams add a SECOND fanout that's durable +
 * cross-instance.
 *
 * Env flag: PLANNER_EVENT_STREAMS_ENABLED. When false: legacy in-process
 * + Pub/Sub bus only.
 */

import type IORedis from 'ioredis';
import { randomUUID } from 'crypto';
import { logger } from './logger';
import { getRequestContext } from './requestContext';
import { plannerEventBus, type PlannerEvent, type PlannerEventType } from './plannerEventBus';

const STREAM_EVENTS      = 'planner:events';
const STREAM_REFINEMENT  = 'planner:refinement';
const STREAM_OPTIMIZE    = 'planner:optimization';
const STREAM_DEAD_LETTER = 'planner:dead';
/** Approximate stream cap. Older entries get trimmed automatically. */
const STREAM_MAXLEN = Number(process.env.PLANNER_STREAM_MAXLEN || 10_000);
/** Max delivery count before we shunt the entry to the dead-letter stream. */
const DEAD_LETTER_THRESHOLD = Number(process.env.PLANNER_DEAD_LETTER_THRESHOLD || 5);
/** Idle-pending entries older than this are reclaimed by XAUTOCLAIM. */
const PENDING_RECLAIM_IDLE_MS = Number(process.env.PLANNER_PENDING_RECLAIM_MS || 60_000);

const INSTANCE_ID = randomUUID();
const REFINEMENT_TYPES = new Set<PlannerEventType>(['refinement_completed']);
const PROPAGATED_TYPES = new Set<PlannerEventType>([
  'plan_created',
  'salvage_applied',
  'refinement_completed',
  'overload_mode_activated',
  'alignment_completed',
]);

let _client: IORedis | null = null;
let _started = false;
let _failureCount = 0;
const FAILURE_DISABLE_THRESHOLD = 5;
const _consumerLoops = new Map<string, NodeJS.Immediate | NodeJS.Timeout>();
let _reclaimLoop: NodeJS.Timeout | null = null;
/** Local dedup cache: stream entry-ids we've already re-emitted. */
const _seenEntryIds = new Map<string, number>();
const SEEN_TTL_MS = 5 * 60_000;

function isEnabled(): boolean {
  return String(process.env.PLANNER_EVENT_STREAMS_ENABLED ?? 'false').toLowerCase() === 'true';
}

function getRedisOrNull(): IORedis | null {
  if (_failureCount >= FAILURE_DISABLE_THRESHOLD) return null;
  if (_client) return _client;
  try {
    const { getInstrumentedStandaloneRedisClient } =
      require('../queue/standaloneRedisClient') as typeof import('../queue/standaloneRedisClient');
    _client = getInstrumentedStandaloneRedisClient('planner-event-streams');
    return _client;
  } catch (err) {
    _failureCount += 1;
    logger.warn('planner_event_streams_unavailable', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function streamForEventType(type: PlannerEventType): string {
  if (REFINEMENT_TYPES.has(type)) return STREAM_REFINEMENT;
  return STREAM_EVENTS;
}

/**
 * Publish to Redis Streams. Fire-and-forget — failure logs but never blocks.
 * Always called AFTER the local emit so in-process subscribers run first.
 *
 * Each entry carries:
 *   - id              : caller-provided event id (for dedup at consumer)
 *   - type            : PlannerEventType
 *   - campaign_id     : partition key for per-campaign filtering
 *   - plan_revision_id: optional, for revision-scoped queries
 *   - ts              : epoch ms
 *   - origin_instance_id: this process's id (consumer drops own echoes)
 *   - correlation_id  : request-id of emitter for cross-stream tracing
 *   - causation_id    : id of the event that caused this one (null on roots)
 *   - payload         : JSON-stringified payload
 */
export async function publishEventToStream(event: PlannerEvent, opts: { causationId?: string } = {}): Promise<void> {
  if (!isEnabled()) return;
  if (!PROPAGATED_TYPES.has(event.type)) return;
  const client = getRedisOrNull();
  if (!client) return;
  const stream = streamForEventType(event.type);
  try {
    await client.xadd(
      stream,
      'MAXLEN', '~', String(STREAM_MAXLEN),
      '*',
      'id',                  event.id,
      'type',                event.type,
      'campaign_id',         event.campaign_id,
      'plan_revision_id',    event.plan_revision_id ?? '',
      'ts',                  String(event.ts),
      'origin_instance_id',  INSTANCE_ID,
      'correlation_id',      event.request_id ?? '',
      'causation_id',        opts.causationId ?? '',
      'payload',             JSON.stringify(event.payload ?? {}),
    );
  } catch (err) {
    _failureCount += 1;
    logger.warn('planner_event_streams_publish_failed', {
      type: event.type,
      campaign_id: event.campaign_id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function pruneSeen(now: number): void {
  for (const [k, t] of _seenEntryIds) {
    if (t + SEEN_TTL_MS < now) _seenEntryIds.delete(k);
  }
}

/** Parse a stream entry into a PlannerEvent shape suitable for re-emission. */
function parseEntry(entryId: string, fields: string[]): { event: PlannerEvent; originInstanceId: string; entryId: string } | null {
  const f: Record<string, string> = {};
  for (let i = 0; i + 1 < fields.length; i += 2) f[fields[i]] = fields[i + 1];
  if (!f.type || !f.campaign_id) return null;
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(f.payload || '{}'); } catch { /* leave empty */ }
  return {
    entryId,
    originInstanceId: f.origin_instance_id || '',
    event: {
      id: f.id || entryId,
      type: f.type as PlannerEventType,
      campaign_id: f.campaign_id,
      plan_revision_id: f.plan_revision_id || null,
      ts: Number(f.ts) || Date.now(),
      payload,
      request_id: f.correlation_id || undefined,
    },
  };
}

async function ensureConsumerGroup(client: IORedis, stream: string, group: string): Promise<void> {
  try {
    // MKSTREAM creates the stream if it doesn't exist yet.
    await client.xgroup('CREATE', stream, group, '$', 'MKSTREAM');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // BUSYGROUP = group already exists. Anything else is a real failure.
    if (!msg.includes('BUSYGROUP')) {
      logger.warn('planner_event_streams_group_create_failed', { stream, group, error: msg });
      throw err;
    }
  }
}

async function processEntry(parsed: { event: PlannerEvent; originInstanceId: string; entryId: string }): Promise<void> {
  // Drop our own echoes.
  if (parsed.originInstanceId === INSTANCE_ID) return;
  // Local dedup by entry id.
  if (_seenEntryIds.has(parsed.entryId)) return;
  _seenEntryIds.set(parsed.entryId, Date.now());
  // Re-emit on the LOCAL event bus with __propagated flag. Local dedup map
  // on the bus (type+campaign+revision) catches retries beyond entry-id dedup.
  try {
    plannerEventBus.emit({
      type: parsed.event.type,
      campaign_id: parsed.event.campaign_id,
      plan_revision_id: parsed.event.plan_revision_id,
      payload: {
        ...(parsed.event.payload as Record<string, unknown>),
        __propagated: true,
        __origin_instance_id: parsed.originInstanceId,
        __stream_entry_id: parsed.entryId,
      },
    });
  } catch (err) {
    logger.warn('planner_event_streams_local_remit_failed', {
      entry_id: parsed.entryId,
      type: parsed.event.type,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Run one XREADGROUP iteration on a stream/group. Reads up to N pending
 * entries first (delivery > 1), then up to N new entries. ACKs each one
 * after `processEntry` resolves. On delivery-count >= threshold, shunts
 * to dead-letter stream.
 */
async function readOnce(client: IORedis, stream: string, group: string, consumer: string): Promise<void> {
  try {
    const res = (await client.xreadgroup(
      'GROUP', group, consumer,
      'COUNT', '32',
      'BLOCK', '2000',
      'STREAMS', stream, '>',
    )) as Array<[string, Array<[string, string[]]>]> | null;
    if (!res || res.length === 0) return;
    pruneSeen(Date.now());
    for (const [, entries] of res) {
      for (const [entryId, fields] of entries) {
        const parsed = parseEntry(entryId, fields);
        if (!parsed) {
          await client.xack(stream, group, entryId).catch(() => undefined);
          continue;
        }
        try {
          await processEntry(parsed);
          await client.xack(stream, group, entryId);
        } catch (err) {
          // Don't ACK on processor failure — entry stays pending for retry.
          logger.warn('planner_event_streams_process_failed', {
            entry_id: entryId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  } catch (err) {
    _failureCount += 1;
    logger.warn('planner_event_streams_read_failed', {
      stream,
      group,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Reclaim pending entries that have been idle longer than threshold and
 * shunt them to the dead-letter stream if delivery count is too high.
 *
 * XAUTOCLAIM hands ownership of idle pending entries to the calling
 * consumer; we then either retry-process them or dead-letter them based on
 * the delivery count in XPENDING summary.
 */
async function reclaimAndDeadLetter(client: IORedis, stream: string, group: string, consumer: string): Promise<void> {
  try {
    const res = (await client.xautoclaim(
      stream, group, consumer,
      String(PENDING_RECLAIM_IDLE_MS),
      '0-0',
      'COUNT', '32',
    )) as [string, Array<[string, string[]]>, string[]] | null;
    if (!res) return;
    const [, claimed] = res;
    for (const [entryId, fields] of claimed) {
      const parsed = parseEntry(entryId, fields);
      if (!parsed) {
        await client.xack(stream, group, entryId).catch(() => undefined);
        continue;
      }
      // Check delivery count via XPENDING for this specific entry.
      const pending = (await client.xpending(
        stream, group, entryId, entryId, 1,
      )) as Array<[string, string, number, number]>;
      const delivCount = pending?.[0]?.[3] ?? 1;
      if (delivCount >= DEAD_LETTER_THRESHOLD) {
        await client.xadd(
          STREAM_DEAD_LETTER,
          'MAXLEN', '~', String(STREAM_MAXLEN),
          '*',
          'original_stream', stream,
          'original_group',  group,
          'entry_id',        entryId,
          'delivery_count',  String(delivCount),
          'fields',          JSON.stringify(fields),
          'shunted_at',      String(Date.now()),
        );
        await client.xack(stream, group, entryId);
        logger.warn('planner_event_streams_dead_letter', {
          stream,
          group,
          entry_id: entryId,
          delivery_count: delivCount,
        });
        continue;
      }
      try {
        await processEntry(parsed);
        await client.xack(stream, group, entryId);
      } catch (err) {
        logger.warn('planner_event_streams_reclaim_process_failed', {
          entry_id: entryId,
          delivery_count: delivCount,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    _failureCount += 1;
    logger.warn('planner_event_streams_autoclaim_failed', {
      stream,
      group,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Start the consumer loops + reclaim sweeper. Idempotent. */
export async function startEventStreamConsumers(consumerGroup: string = 'planner-default'): Promise<void> {
  if (_started) return;
  if (!isEnabled()) return;
  const client = getRedisOrNull();
  if (!client) return;
  await Promise.all([
    ensureConsumerGroup(client, STREAM_EVENTS, consumerGroup),
    ensureConsumerGroup(client, STREAM_REFINEMENT, consumerGroup),
    ensureConsumerGroup(client, STREAM_OPTIMIZE, consumerGroup),
  ]).catch((err) => {
    logger.warn('planner_event_streams_groups_init_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  const consumer = `consumer-${INSTANCE_ID}`;

  // Continuous read loop per stream. Use setImmediate after each read so we
  // yield to the event loop and don't starve other I/O.
  for (const stream of [STREAM_EVENTS, STREAM_REFINEMENT, STREAM_OPTIMIZE]) {
    const loop = async (): Promise<void> => {
      while (_started) {
        await readOnce(client, stream, consumerGroup, consumer);
      }
    };
    void loop();
  }

  // Reclaim sweeper runs every 30s.
  _reclaimLoop = setInterval(async () => {
    for (const stream of [STREAM_EVENTS, STREAM_REFINEMENT, STREAM_OPTIMIZE]) {
      await reclaimAndDeadLetter(client, stream, consumerGroup, consumer);
    }
  }, 30_000);
  if ((_reclaimLoop as any)?.unref) (_reclaimLoop as any).unref();

  _started = true;
  // Hook the local emitter so every propagatable emit also gets streamed.
  plannerEventBus.onAny((event) => {
    if (!PROPAGATED_TYPES.has(event.type)) return;
    if ((event.payload as any)?.__propagated) return;
    void publishEventToStream(event);
  });

  logger.info('planner_event_streams_started', {
    instance_id: INSTANCE_ID,
    consumer_group: consumerGroup,
    streams: [STREAM_EVENTS, STREAM_REFINEMENT, STREAM_OPTIMIZE],
  });
}

export async function stopEventStreamConsumers(): Promise<void> {
  _started = false;
  if (_reclaimLoop) clearInterval(_reclaimLoop);
  for (const handle of _consumerLoops.values()) {
    clearInterval(handle as any);
  }
  _consumerLoops.clear();
}

/**
 * Replay events for a specific campaign. Returns up to `count` events
 * matching `campaign_id` from the events stream, optionally bounded by
 * sinceMs. Useful for SSE catch-up after reconnect or post-incident replay.
 */
export async function replayCampaignEvents(
  campaignId: string,
  opts: { count?: number; sinceMs?: number } = {},
): Promise<Array<{ entryId: string; event: PlannerEvent }>> {
  const client = getRedisOrNull();
  if (!client) return [];
  const start = opts.sinceMs ? `${opts.sinceMs}-0` : '-';
  const end = '+';
  const count = Math.max(1, opts.count ?? 100);
  const out: Array<{ entryId: string; event: PlannerEvent }> = [];
  try {
    for (const stream of [STREAM_EVENTS, STREAM_REFINEMENT]) {
      const entries = (await client.xrange(stream, start, end, 'COUNT', count)) as Array<[string, string[]]>;
      for (const [entryId, fields] of entries) {
        const parsed = parseEntry(entryId, fields);
        if (parsed && parsed.event.campaign_id === campaignId) {
          out.push({ entryId, event: parsed.event });
        }
      }
    }
  } catch (err) {
    logger.warn('planner_event_streams_replay_failed', {
      campaign_id: campaignId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  // Sort by entryId (Redis stream IDs are time-ordered).
  out.sort((a, b) => a.entryId.localeCompare(b.entryId));
  return out;
}

export interface StreamLagSnapshot {
  stream: string;
  length: number;
  pending: number;
  oldestPendingAgeMs: number | null;
}

/**
 * Snapshot of per-stream lag for dashboards. Returns null when Redis
 * unavailable.
 */
export async function getStreamLagSnapshot(consumerGroup: string = 'planner-default'): Promise<StreamLagSnapshot[] | null> {
  const client = getRedisOrNull();
  if (!client) return null;
  const out: StreamLagSnapshot[] = [];
  for (const stream of [STREAM_EVENTS, STREAM_REFINEMENT, STREAM_OPTIMIZE]) {
    try {
      const length = (await client.xlen(stream)) as number;
      const pendingSummary = (await client.xpending(stream, consumerGroup)) as any;
      const pendingCount = Number(pendingSummary?.[0] ?? 0);
      const oldest = pendingSummary?.[1] ? Number(String(pendingSummary[1]).split('-')[0]) : null;
      const oldestAge = oldest ? Date.now() - oldest : null;
      out.push({ stream, length, pending: pendingCount, oldestPendingAgeMs: oldestAge });
    } catch {
      out.push({ stream, length: 0, pending: 0, oldestPendingAgeMs: null });
    }
  }
  return out;
}

export function getInstanceIdForTests(): string { return INSTANCE_ID; }
