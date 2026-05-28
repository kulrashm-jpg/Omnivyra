/**
 * Enterprise Governance — Unified event envelopes (Phases 5, 8).
 *
 * Single canonical envelope shape for every workflow event the
 * orchestrator emits. Events are:
 *   1. Logged via stdout (structured JSON — picked up by the platform's
 *      existing log pipeline).
 *   2. Recorded into a bounded in-process ring buffer for hot reads.
 *   3. Mirrored to Redis via `appendWorkflowEvent` for cross-instance
 *      observability + dashboard tailing.
 *
 * Notifications are NOT dispatched from here — this module only emits
 * the envelope. Existing notification layers can subscribe later by
 * consuming the Redis stream or the in-process buffer.
 *
 * Phase 10 cost ceilings:
 *   - in-process ring buffer: 2_000 events
 *   - Redis stream: 1_000 events / company (enforced by persistence layer)
 *   - payload size capped at 4 KB
 */

import { appendWorkflowEvent } from './enterpriseGovernanceRedisPersistence';

export type EnterpriseGovernanceEventType =
  | 'asset_generated'
  | 'qa_failure'
  | 'qa_passed'
  | 'governance_intervention'
  | 'governance_passed'
  | 'severe_governance_violation'
  | 'escalation_created'
  | 'retry_exhausted'
  | 'approval_required'
  | 'approval_granted'
  | 'approval_rejected'
  | 'publish_allowed'
  | 'publish_blocked'
  | 'published'
  | 'campaign_locked'
  | 'campaign_unlocked'
  | 'review_state_transition'
  | 'autonomous_intervention'
  | 'review_record_established';

export type EnterpriseGovernanceEvent = {
  /** Unique stable ID — usable as an idempotency key for downstream consumers. */
  eventId: string;
  type: EnterpriseGovernanceEventType;
  /** Subject of the event — always carries assetId + companyId for routing. */
  assetId: string;
  companyId: string;
  campaignId: string | null;
  /** Optional contextual fields — kept narrow + stringly-typed for stability. */
  context: Record<string, string | number | boolean | null>;
  /** ISO timestamp. */
  occurredAt: string;
};

const RING_BUFFER_MAX = 2_000;
const ring: EnterpriseGovernanceEvent[] = [];

/* ── Subscriber registry — pluggable, bounded, never-throws ──────────── */

export type GovernanceEventSubscriber = (event: EnterpriseGovernanceEvent) => void;
const subscribers = new Set<GovernanceEventSubscriber>();
const MAX_SUBSCRIBERS = 16;

export function subscribeToGovernanceEvents(fn: GovernanceEventSubscriber): () => void {
  if (subscribers.size >= MAX_SUBSCRIBERS) {
    console.warn('[creator-gov-event] subscriber cap reached; ignoring registration');
    return () => {};
  }
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}

function fanoutToSubscribers(event: EnterpriseGovernanceEvent): void {
  for (const fn of subscribers) {
    try { fn(event); } catch (err) {
      // Never let a subscriber failure break the emission path.
      console.warn('[creator-gov-event] subscriber failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

function eventId(): string {
  return `gov-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

function boundedContext(input: Record<string, unknown> | undefined): Record<string, string | number | boolean | null> {
  if (!input) return {};
  const out: Record<string, string | number | boolean | null> = {};
  let keys = 0;
  for (const [k, v] of Object.entries(input)) {
    if (keys >= 20) break; // bounded fan-in
    if (v === null || v === undefined) out[k] = null;
    else if (typeof v === 'string') out[k] = v.slice(0, 200);
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else out[k] = String(v).slice(0, 200);
    keys += 1;
  }
  return out;
}

/**
 * Emit a unified governance event. Fire-and-forget — never throws.
 * Returns the envelope so callers can correlate (e.g. surface eventId
 * in API responses).
 */
export function emitGovernanceEvent(input: {
  type: EnterpriseGovernanceEventType;
  assetId: string;
  companyId: string;
  campaignId?: string | null;
  context?: Record<string, unknown>;
}): EnterpriseGovernanceEvent {
  const event: EnterpriseGovernanceEvent = {
    eventId: eventId(),
    type: input.type,
    assetId: input.assetId,
    companyId: input.companyId,
    campaignId: input.campaignId ?? null,
    context: boundedContext(input.context),
    occurredAt: new Date().toISOString(),
  };

  // 1) Structured log line (existing log pipeline picks it up)
  try {
    console.info('[creator-gov-event]', JSON.stringify(event));
  } catch {
    // never propagate logging failures
  }

  // 2) In-process ring buffer
  ring.push(event);
  if (ring.length > RING_BUFFER_MAX) ring.splice(0, ring.length - RING_BUFFER_MAX);

  // 3) Distributed mirror (best-effort, async)
  void appendWorkflowEvent(input.companyId, event);

  // 4) Synchronous subscriber fan-out (notification + alerting hooks).
  //    Subscribers MUST be non-blocking + non-throwing.
  fanoutToSubscribers(event);

  return event;
}

/** List recent events for a company — used by dashboard + audit timeline. */
export function listRecentGovernanceEvents(input: {
  companyId?: string;
  assetId?: string;
  type?: EnterpriseGovernanceEventType;
  limit?: number;
}): ReadonlyArray<EnterpriseGovernanceEvent> {
  const cid = input.companyId?.trim().toLowerCase();
  const limit = Math.max(1, Math.min(500, input.limit ?? 100));
  const matched: EnterpriseGovernanceEvent[] = [];
  // Walk newest-first.
  for (let i = ring.length - 1; i >= 0 && matched.length < limit; i--) {
    const ev = ring[i];
    if (cid && ev.companyId.toLowerCase() !== cid) continue;
    if (input.assetId && ev.assetId !== input.assetId) continue;
    if (input.type && ev.type !== input.type) continue;
    matched.push(ev);
  }
  return matched;
}

export function eventBufferDiagnostics(): {
  size: number;
  max: number;
  subscriberCount: number;
} {
  return { size: ring.length, max: RING_BUFFER_MAX, subscriberCount: subscribers.size };
}

export function clearSubscribersForTests(): void { subscribers.clear(); }

export function clearGovernanceEventsForTests(): void {
  ring.splice(0, ring.length);
}
