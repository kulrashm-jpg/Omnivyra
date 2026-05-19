/**
 * durableOrchestrationEventStream — Phase-2 Step-25.
 *
 * Append-only durable log of orchestration events on Redis Streams, layered
 * UNDER the Step-24 pub/sub transport (reuses the same bullmqClient
 * connection config → TLS/`rediss://` handled; no new infra, no migration).
 *
 *   key       : orch:stream:{campaign_id}   (campaign-scoped)
 *   id        : the Redis Stream `ms-seq` entry id == event_id (monotonic,
 *               dedupe/order friendly, doubles as SSE Last-Event-ID cursor)
 *   retention : XADD MAXLEN ~ CAP (approx trim) + EXPIRE on idle reclaim
 *
 * Every path is FAIL-SOFT: a stream failure NEVER throws and NEVER blocks
 * generation/mutation — append degrades to "no event_id" (Step-24 fire-and-
 * forget) and replay degrades to "best-effort empty" (Step-22 reconcile
 * remains the safety net).
 */

import Redis from 'ioredis';
import { getConnectionConfig } from '../../../queue/bullmqClient';
import { isOrchestrationEvent, type OrchestrationEvent } from './orchestrationEventTypes';

const LOG = (tag: string, payload: Record<string, unknown>) => {
  try {
    // eslint-disable-next-line no-console
    console.log(`[${tag}]`, JSON.stringify(payload));
  } catch {
    /* never throw from a diagnostic */
  }
};

const STREAM_PREFIX = 'orch:stream:';
const streamKey = (campaignId: string) => `${STREAM_PREFIX}${campaignId}`;

/** Bounded retention (memory + replay-window safety, STRICT RULE 6/7). */
const MAXLEN_CAP = 500;
const REPLAY_COUNT_CAP = 500;
const STREAM_TTL_SECONDS = 24 * 60 * 60; // idle campaign streams self-reclaim

class DurableOrchestrationEventStream {
  private client: Redis | null = null;
  private available = false;
  private initStarted = false;

  private async ensure(): Promise<boolean> {
    if (this.initStarted) return this.available;
    this.initStarted = true;
    const url = process.env.REDIS_URL || '';
    if (!url || url.includes('localhost') || url.includes('127.0.0.1')) {
      LOG('DURABLE_EVENT_RECOVERY_FAIL', { reason: 'redis_not_configured', recovery_success: false });
      return false;
    }
    try {
      this.client = new Redis({ ...getConnectionConfig(), lazyConnect: true, maxRetriesPerRequest: 2 } as never);
      this.client.on('error', (e) => {
        this.available = false;
        LOG('DURABLE_EVENT_RECOVERY_FAIL', { reason: (e as Error)?.message ?? 'redis_error', recovery_success: false });
      });
      this.client.on('ready', () => { this.available = true; });
      await this.client.connect();
      this.available = true;
      return true;
    } catch (e) {
      this.available = false;
      LOG('DURABLE_EVENT_RECOVERY_FAIL', { reason: (e as Error)?.message ?? 'connect_failed', recovery_success: false });
      return false;
    }
  }

  /**
   * Append the event; returns the assigned durable id (== event_id) or null
   * when the stream is unavailable (caller then publishes id-less ⇒ Step-24
   * fire-and-forget). Approximate-trims + refreshes idle TTL each append.
   */
  async append(event: OrchestrationEvent): Promise<string | null> {
    if (!(await this.ensure()) || !this.client) return null;
    const key = streamKey(event.campaign_id);
    try {
      const id = await this.client.xadd(
        key,
        'MAXLEN', '~', String(MAXLEN_CAP),
        '*',
        'e', JSON.stringify(event),
      );
      // Idle reclamation — bounded growth even for abandoned campaigns.
      this.client.expire(key, STREAM_TTL_SECONDS).catch(() => {});
      LOG('DURABLE_EVENT_APPEND', {
        campaign_id: event.campaign_id,
        event_id: id,
        event_type: event.type,
        execution_id: event.execution_id,
      });
      LOG('DURABLE_EVENT_TRIM', { campaign_id: event.campaign_id, maxlen: MAXLEN_CAP, applied: true });
      return id ?? null;
    } catch (e) {
      LOG('DURABLE_EVENT_RECOVERY_FAIL', {
        campaign_id: event.campaign_id,
        reason: (e as Error)?.message ?? 'xadd_failed',
        recovery_success: false,
      });
      return null;
    }
  }

  /**
   * Replay events strictly AFTER `lastId` (exclusive). Bounded by
   * REPLAY_COUNT_CAP (replay-window safety). No lastId ⇒ no replay (go
   * live only — never dump full history). Best-effort: any failure ⇒ [].
   */
  async replay(campaignId: string, lastId: string | null): Promise<OrchestrationEvent[]> {
    if (!lastId) return [];
    if (!(await this.ensure()) || !this.client) return [];
    const key = streamKey(campaignId);
    try {
      // '(' = exclusive start (Redis 6.2+/Upstash) so we never re-deliver
      // the cursor event itself.
      const rows = (await this.client.xrange(
        key, `(${lastId}`, '+', 'COUNT', REPLAY_COUNT_CAP,
      )) as Array<[string, string[]]>;
      const out: OrchestrationEvent[] = [];
      for (const [id, fields] of rows) {
        const idx = fields.indexOf('e');
        if (idx < 0 || idx + 1 >= fields.length) continue;
        try {
          const parsed = JSON.parse(fields[idx + 1]!);
          if (isOrchestrationEvent(parsed)) {
            out.push({ ...(parsed as OrchestrationEvent), event_id: id });
          }
        } catch { /* skip a corrupt entry, keep replaying */ }
      }
      LOG('DURABLE_EVENT_REPLAY', {
        campaign_id: campaignId,
        reconnect_source: 'last_event_id',
        replay_count: out.length,
        from_id: lastId,
        recovery_success: true,
      });
      return out;
    } catch (e) {
      LOG('DURABLE_EVENT_RECOVERY_FAIL', {
        campaign_id: campaignId,
        reason: (e as Error)?.message ?? 'xrange_failed',
        reconnect_source: 'last_event_id',
        recovery_success: false,
      });
      return [];
    }
  }
}

let singleton: DurableOrchestrationEventStream | null = null;

export function getDurableOrchestrationEventStream(): DurableOrchestrationEventStream {
  if (!singleton) singleton = new DurableOrchestrationEventStream();
  return singleton;
}
