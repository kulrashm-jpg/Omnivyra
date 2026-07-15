/**
 * distributedOrchestrationEventTransport — Phase-2 Step-24.
 *
 * Cross-instance OrchestrationEventTransport over Upstash Redis pub/sub
 * (reuses the existing bullmqClient connection config → TLS/`rediss://`
 * handled exactly like every other Redis consumer; no new infra, no
 * migration). A dedicated publisher + a dedicated subscriber connection
 * (a subscriber connection cannot also issue commands), one channel per
 * campaign: `orch:events:{campaign_id}`.
 *
 * Fallback hierarchy (STRICT RULE 6, Step-23 preserved):
 *   1. distributed (redis)  — cross-worker
 *   2. in-process emitter   — same-worker (redis down / not configured)
 *   3. client Step-22 invalidate/revalidate — channel fully unavailable
 *
 * Every redis path is fail-soft: a publish/subscribe failure NEVER throws
 * and NEVER blocks generation/mutation — it transparently delegates to the
 * in-process transport and logs a fallback. Bounded reconnect; duplicate
 * suppression for at-least-once / reconnect redelivery.
 */

import Redis from 'ioredis';
import { getRawConnectionOptions } from '../../../queue/bullmqClient'; // CERT-FIX P2: raw options — this file SPREADS into new Redis(); a shared client instance (W2-7 mode) would silently fall back to localhost
import {
  getInProcessOrchestrationTransport,
  registerOrchestrationEventTransport,
  type OrchestrationEventTransport,
} from './orchestrationEventBus';
import { isOrchestrationEvent, type OrchestrationEvent } from './orchestrationEventTypes';
import { getDurableOrchestrationEventStream } from './durableOrchestrationEventStream';

const LOG = (tag: string, payload: Record<string, unknown>) => {
  try {
    // eslint-disable-next-line no-console
    console.log(`[${tag}]`, JSON.stringify(payload));
  } catch {
    /* never throw from a diagnostic */
  }
};

const CHANNEL_PREFIX = 'orch:events:';
const channelFor = (campaignId: string) => `${CHANNEL_PREFIX}${campaignId}`;
const campaignFromChannel = (channel: string) =>
  channel.startsWith(CHANNEL_PREFIX) ? channel.slice(CHANNEL_PREFIX.length) : '';

const MAX_RECONNECT_ATTEMPTS = 20;
const DEDUPE_PER_CAMPAIGN = 200;

function dedupeKey(e: OrchestrationEvent): string {
  return `${e.type}|${e.execution_id ?? '*'}|${e.emitted_at}`;
}

class DistributedOrchestrationEventTransport implements OrchestrationEventTransport {
  private pub: Redis | null = null;
  private sub: Redis | null = null;
  private available = false;
  private initStarted = false;
  private readonly fallback = getInProcessOrchestrationTransport();
  private readonly listeners = new Map<string, Set<(e: OrchestrationEvent) => void>>();
  private readonly seen = new Map<string, Set<string>>(); // campaign → recent keys

  private redisOptions() {
    const base = getRawConnectionOptions();
    return {
      ...base,
      lazyConnect: true,
      // Bounded reconnect (STRICT RULE 7). Give up after N attempts → the
      // transport stays available=false and delegates to in-process.
      retryStrategy: (attempt: number) => {
        if (attempt > MAX_RECONNECT_ATTEMPTS) return null;
        LOG('DISTRIBUTED_EVENT_CONNECT', { transport_type: 'redis', reconnect_attempt: attempt });
        return Math.min(15_000, 500 * 2 ** Math.min(attempt, 5));
      },
      maxRetriesPerRequest: 2,
    };
  }

  /** Idempotent, fail-soft. Returns true if redis is (being) wired. */
  async ensure(): Promise<boolean> {
    if (this.initStarted) return this.available;
    this.initStarted = true;
    const url = process.env.REDIS_URL || '';
    if (!url || url.includes('localhost') || url.includes('127.0.0.1')) {
      // No distributed backend in this environment → stay on in-process.
      LOG('DISTRIBUTED_EVENT_FALLBACK', { transport_type: 'in_process', failure_reason: 'redis_not_configured', fallback_active: true });
      return false;
    }
    try {
      this.pub = new Redis(this.redisOptions() as never);
      this.sub = new Redis(this.redisOptions() as never);
      this.pub.on('error', (e) => this.onError('pub', e));
      this.sub.on('error', (e) => this.onError('sub', e));
      this.sub.on('end', () => { this.available = false; });
      // Re-subscribe every active channel on (re)connect — reconnect safety.
      this.sub.on('ready', () => {
        this.available = true;
        const channels = [...this.listeners.keys()];
        if (channels.length > 0) {
          this.sub?.subscribe(...channels).catch(() => {});
        }
        LOG('DISTRIBUTED_EVENT_CONNECT', { transport_type: 'redis', subscriber_count: channels.length, fallback_active: false });
      });
      this.sub.on('message', (channel: string, message: string) => this.onMessage(channel, message));
      await Promise.all([this.pub.connect(), this.sub.connect()]);
      this.available = true;
      LOG('DISTRIBUTED_EVENT_SUBSCRIBE', { transport_type: 'redis', fallback_active: false });
      return true;
    } catch (e) {
      this.available = false;
      LOG('DISTRIBUTED_EVENT_FALLBACK', {
        transport_type: 'in_process',
        failure_reason: (e as Error)?.message ?? 'connect_failed',
        fallback_active: true,
      });
      return false;
    }
  }

  private onError(role: string, e: unknown): void {
    this.available = false;
    LOG('DISTRIBUTED_EVENT_FAIL', { transport_type: 'redis', role, failure_reason: (e as Error)?.message ?? 'redis_error', fallback_active: true });
  }

  private isDuplicate(campaignId: string, e: OrchestrationEvent): boolean {
    let set = this.seen.get(campaignId);
    if (!set) { set = new Set(); this.seen.set(campaignId, set); }
    const key = dedupeKey(e);
    if (set.has(key)) return true;
    set.add(key);
    if (set.size > DEDUPE_PER_CAMPAIGN) {
      // Bounded memory: drop the oldest insertion.
      const oldest = set.values().next().value;
      if (oldest !== undefined) set.delete(oldest);
    }
    return false;
  }

  private onMessage(channel: string, message: string): void {
    try {
      const parsed = JSON.parse(message);
      if (!isOrchestrationEvent(parsed)) return;
      const event = parsed as OrchestrationEvent;
      const campaignId = campaignFromChannel(channel) || event.campaign_id;
      if (this.isDuplicate(campaignId, event)) return; // suppress redelivery
      const subs = this.listeners.get(channel);
      if (!subs || subs.size === 0) return;
      LOG('DISTRIBUTED_EVENT_RECEIVE', {
        campaign_id: campaignId, transport_type: 'redis',
        event_type: event.type, subscriber_count: subs.size,
      });
      subs.forEach((fn) => { try { fn(event); } catch { /* one bad subscriber must not break others */ } });
    } catch {
      LOG('DISTRIBUTED_EVENT_FAIL', { transport_type: 'redis', failure_reason: 'message_parse_failed' });
    }
  }

  async publish(event: OrchestrationEvent): Promise<void> {
    // Step-25: durably append FIRST so the event carries its replay cursor
    // (event_id) on the wire. Fail-soft: null id ⇒ Step-24 fire-and-forget.
    let durable: OrchestrationEvent = event;
    try {
      const id = await getDurableOrchestrationEventStream().append(event);
      if (id) durable = { ...event, event_id: id };
    } catch {
      /* durable append is best-effort; never blocks delivery */
    }

    const ok = await this.ensure();
    if (!ok || !this.available || !this.pub) {
      // Fallback: same-instance delivery still works.
      this.fallback.publish(durable);
      LOG('DISTRIBUTED_EVENT_FALLBACK', { campaign_id: event.campaign_id, transport_type: 'in_process', fallback_active: true });
      return;
    }
    try {
      await this.pub.publish(channelFor(event.campaign_id), JSON.stringify(durable));
      LOG('DISTRIBUTED_EVENT_PUBLISH', {
        campaign_id: event.campaign_id, transport_type: 'redis',
        event_type: event.type, publish_success: true,
      });
    } catch (e) {
      this.fallback.publish(durable);
      LOG('DISTRIBUTED_EVENT_FALLBACK', {
        campaign_id: event.campaign_id, transport_type: 'in_process',
        publish_success: false, failure_reason: (e as Error)?.message ?? 'publish_failed',
        fallback_active: true,
      });
    }
  }

  subscribe(campaignId: string, listener: (e: OrchestrationEvent) => void) {
    const channel = channelFor(campaignId);
    let set = this.listeners.get(channel);
    const first = !set;
    if (!set) { set = new Set(); this.listeners.set(channel, set); }
    set.add(listener);

    // Also attach to the in-process transport so same-instance emits (e.g.
    // a redis-down fallback publish on THIS worker) are never missed.
    const localSub = this.fallback.subscribe(campaignId, listener);

    void this.ensure().then((ok) => {
      if (ok && first && this.sub) {
        this.sub.subscribe(channel).then(
          () => LOG('DISTRIBUTED_EVENT_SUBSCRIBE', { campaign_id: campaignId, transport_type: 'redis', subscriber_count: set!.size }),
          () => LOG('DISTRIBUTED_EVENT_FAIL', { campaign_id: campaignId, transport_type: 'redis', failure_reason: 'subscribe_failed', fallback_active: true }),
        );
      }
    });

    return {
      unsubscribe: () => {
        try { localSub.unsubscribe(); } catch { /* noop */ }
        const s = this.listeners.get(channel);
        if (!s) return;
        s.delete(listener);
        if (s.size === 0) {
          this.listeners.delete(channel);
          this.seen.delete(campaignId);
          if (this.sub && this.available) this.sub.unsubscribe(channel).catch(() => {});
        }
      },
    };
  }
}

let singleton: DistributedOrchestrationEventTransport | null = null;

export function getDistributedOrchestrationEventTransport(): DistributedOrchestrationEventTransport {
  if (!singleton) singleton = new DistributedOrchestrationEventTransport();
  return singleton;
}

let registered = false;

/**
 * Idempotent, server-only, fail-soft. Called lazily from the SSE endpoint
 * and the emitter (the two real server entry points). Registers the
 * distributed transport ONLY when a non-local REDIS_URL exists; otherwise
 * the bus keeps its in-process transport (local-dev continuity). Registering
 * never breaks in-process: the distributed transport delegates to it.
 */
export function ensureDistributedOrchestrationTransport(): void {
  if (registered) return;
  registered = true;
  try {
    const url = process.env.REDIS_URL || '';
    if (!url || url.includes('localhost') || url.includes('127.0.0.1')) {
      LOG('DISTRIBUTED_EVENT_FALLBACK', {
        transport_type: 'in_process',
        failure_reason: 'redis_not_configured',
        fallback_active: true,
      });
      return;
    }
    const t = getDistributedOrchestrationEventTransport();
    registerOrchestrationEventTransport(t);
    // Warm the connections (fail-soft inside ensure()).
    void t.ensure().catch(() => {});
    LOG('DISTRIBUTED_EVENT_CONNECT', { transport_type: 'redis', registered: true });
  } catch (e) {
    LOG('DISTRIBUTED_EVENT_FAIL', {
      transport_type: 'redis',
      failure_reason: (e as Error)?.message ?? 'register_failed',
      fallback_active: true,
    });
  }
}
