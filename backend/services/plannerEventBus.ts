/**
 * Planner event bus.
 *
 * Decouples planner phases so downstream optimization can be wired up as
 * subscribers instead of inline awaits. The orchestrator emits events at
 * phase boundaries; subscribers (typically BullMQ jobs) react asynchronously.
 *
 * Design:
 *   - In-process EventEmitter for low-latency synchronous handlers
 *     (telemetry, in-orchestrator side effects).
 *   - Optional durable publishing to BullMQ for handlers that must run
 *     even if the producing process crashes (async refinement, optimization).
 *   - Idempotency via per-event UUID. Subscribers must dedup on
 *     (event_type, campaign_id, plan_revision_id) to be safe across retries.
 *
 * Event ordering is best-effort per-campaign. Cross-campaign ordering is
 * not guaranteed. Subscribers should be commutative.
 *
 * Failure semantics: a subscriber that throws does NOT affect other
 * subscribers, nor does it block the emitter. Subscriber errors are logged
 * and propagated as a `planner_event_subscriber_failed` warn.
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { logger } from './logger';
import { getRequestContext } from './requestContext';

export type PlannerEventType =
  | 'plan_created'
  | 'drafting_completed'
  | 'alignment_completed'
  | 'refinement_completed'
  | 'optimization_completed'
  | 'salvage_applied'
  | 'overload_mode_activated'
  | 'progressive_phase_completed';

export interface PlannerEvent<P = Record<string, unknown>> {
  /** Stable event id. Subscribers dedup on this. */
  id: string;
  type: PlannerEventType;
  /** Campaign id is the partition key for ordering. */
  campaign_id: string;
  /** Optional plan revision id — bumped on every refinement so subscribers
   *  can tell "is this still the current plan?". */
  plan_revision_id?: string | null;
  ts: number;
  payload: P;
  /** request_id at emit time, carried for downstream log correlation. */
  request_id?: string;
}

interface PlannerEventBus {
  emit<P>(event: Omit<PlannerEvent<P>, 'id' | 'ts' | 'request_id'>): PlannerEvent<P>;
  on<P>(type: PlannerEventType, handler: (event: PlannerEvent<P>) => void | Promise<void>): () => void;
  onAny(handler: (event: PlannerEvent) => void | Promise<void>): () => void;
  recentEvents(): PlannerEvent[];
}

const _emitter = new EventEmitter();
_emitter.setMaxListeners(50);

// Ring buffer of recent events for introspection / dashboards. Caps at 256.
const _recent: PlannerEvent[] = [];
const RECENT_LIMIT = 256;

// Per-(type, campaign_id, plan_revision_id) dedupe set with TTL so a retry
// or duplicate emit is suppressed. Keys expire after 5 minutes.
const _dedupe = new Map<string, number>();
const DEDUPE_TTL_MS = 5 * 60_000;

function dedupeKey(e: Pick<PlannerEvent, 'type' | 'campaign_id' | 'plan_revision_id'>): string {
  return `${e.type}::${e.campaign_id}::${e.plan_revision_id ?? ''}`;
}

function pruneDedupe(now: number): void {
  for (const [k, t] of _dedupe) {
    if (t + DEDUPE_TTL_MS < now) _dedupe.delete(k);
  }
}

export const plannerEventBus: PlannerEventBus = {
  emit<P>(input: Omit<PlannerEvent<P>, 'id' | 'ts' | 'request_id'>): PlannerEvent<P> {
    const now = Date.now();
    pruneDedupe(now);
    const event: PlannerEvent<P> = {
      ...input,
      id: randomUUID(),
      ts: now,
      request_id: getRequestContext().requestId,
    };
    const k = dedupeKey(event);
    if (_dedupe.has(k)) {
      // Duplicate emit — log and suppress. Subscribers do not run.
      logger.info('planner_event_duplicate_suppressed', {
        request_id: event.request_id,
        type: event.type,
        campaign_id: event.campaign_id,
        plan_revision_id: event.plan_revision_id,
      });
      return event;
    }
    _dedupe.set(k, now);
    _recent.push(event as unknown as PlannerEvent);
    if (_recent.length > RECENT_LIMIT) _recent.shift();

    logger.info('planner_event_emitted', {
      request_id: event.request_id,
      event_id: event.id,
      type: event.type,
      campaign_id: event.campaign_id,
      plan_revision_id: event.plan_revision_id,
    });

    // Synchronous subscribers via EventEmitter.
    try {
      _emitter.emit(event.type, event as unknown as PlannerEvent);
      _emitter.emit('*', event as unknown as PlannerEvent);
    } catch (err) {
      logger.warn('planner_event_emit_failed', {
        event_id: event.id,
        type: event.type,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return event;
  },

  on<P>(
    type: PlannerEventType,
    handler: (event: PlannerEvent<P>) => void | Promise<void>,
  ): () => void {
    // Wrap so a SYNC throw from the user handler doesn't break EventEmitter's
    // delivery loop (which would prevent other subscribers from receiving the
    // event). Async rejections are also caught and logged.
    const wrapped = (event: PlannerEvent<P>): void => {
      try {
        const r = handler(event);
        if (r && typeof (r as Promise<unknown>).then === 'function') {
          (r as Promise<unknown>).catch((err: unknown) => {
            logger.warn('planner_event_subscriber_failed', {
              type,
              event_id: event.id,
              campaign_id: event.campaign_id,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }
      } catch (err) {
        logger.warn('planner_event_subscriber_failed', {
          type,
          event_id: event.id,
          campaign_id: event.campaign_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };
    _emitter.on(type, wrapped as (event: PlannerEvent) => void);
    return () => _emitter.off(type, wrapped as (event: PlannerEvent) => void);
  },

  onAny(handler: (event: PlannerEvent) => void | Promise<void>): () => void {
    const wrapped = (event: PlannerEvent): void => {
      try {
        const r = handler(event);
        if (r && typeof (r as Promise<unknown>).then === 'function') {
          (r as Promise<unknown>).catch((err: unknown) => {
            logger.warn('planner_event_subscriber_failed', {
              type: 'any',
              event_id: event.id,
              campaign_id: event.campaign_id,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }
      } catch (err) {
        logger.warn('planner_event_subscriber_failed', {
          type: 'any',
          event_id: event.id,
          campaign_id: event.campaign_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };
    _emitter.on('*', wrapped);
    return () => _emitter.off('*', wrapped);
  },

  recentEvents(): PlannerEvent[] {
    return [..._recent];
  },
};

/** Test-only: reset state. */
export function __resetEventBusForTests(): void {
  _emitter.removeAllListeners();
  _emitter.setMaxListeners(50);
  _recent.length = 0;
  _dedupe.clear();
}
