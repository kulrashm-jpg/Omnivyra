/**
 * Phase 1 — Feedback event registry.
 *
 * In-memory time-series store of feedback events per company. All downstream
 * adaptive-learning modules read from this registry — it is the single
 * source-of-truth for "what happened" so the engines stay pure.
 *
 * 15 event types supported. Caller emits events as the upstream governance
 * layers fire (e.g. orchestrator emits `generation_blocked`, planner emits
 * `planner_approved`, approval engine emits `approval_bottleneck`, etc.).
 */

import type {
  FeedbackEvent,
  FeedbackEventType,
} from './longFormRecommendationTypes';

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface RecordFeedbackEventInput {
  companyId: string;
  eventType: FeedbackEventType;
  recommendationId?: string;
  articleId?: string;
  revisionId?: string;
  sectionContractId?: string;
  reviewerId?: string;
  detail?: string;
  scoreContext?: Record<string, number>;
  tags?: string[];
  recoveryOutcome?: FeedbackEvent['recoveryOutcome'];
  timestamp?: string;
}

export interface FeedbackEventRegistry {
  record(input: RecordFeedbackEventInput): FeedbackEvent;
  list(companyId?: string, options?: { type?: FeedbackEventType; sinceISO?: string; limit?: number }): FeedbackEvent[];
  /** Count events matching predicate. */
  count(companyId: string, predicate?: (e: FeedbackEvent) => boolean): number;
  /** Group events by a key extractor. */
  groupBy<T extends string>(companyId: string, keyOf: (e: FeedbackEvent) => T | null): Map<T, FeedbackEvent[]>;
  clear(companyId?: string): void;
  size(companyId?: string): number;
}

export function createFeedbackEventRegistry(options?: {
  maxEventsPerCompany?: number;
}): FeedbackEventRegistry {
  const capacity = Math.max(50, options?.maxEventsPerCompany ?? 5000);
  const buckets = new Map<string, FeedbackEvent[]>();

  function getBucket(companyId: string): FeedbackEvent[] {
    let b = buckets.get(companyId);
    if (!b) { b = []; buckets.set(companyId, b); }
    return b;
  }

  return {
    record(input) {
      const event: FeedbackEvent = {
        eventId: newId('fbe'),
        companyId: input.companyId,
        eventType: input.eventType,
        timestamp: input.timestamp ?? new Date().toISOString(),
        recommendationId: input.recommendationId,
        articleId: input.articleId,
        revisionId: input.revisionId,
        sectionContractId: input.sectionContractId,
        reviewerId: input.reviewerId,
        detail: input.detail,
        scoreContext: input.scoreContext,
        tags: input.tags,
        recoveryOutcome: input.recoveryOutcome,
      };
      const bucket = getBucket(input.companyId);
      bucket.push(event);
      while (bucket.length > capacity) bucket.shift();
      return event;
    },
    list(companyId, options) {
      const all = companyId
        ? [...(buckets.get(companyId) ?? [])]
        : (() => {
            const out: FeedbackEvent[] = [];
            buckets.forEach((b) => out.push(...b));
            return out;
          })();
      let filtered = all;
      if (options?.type) filtered = filtered.filter((e) => e.eventType === options.type);
      if (options?.sinceISO) filtered = filtered.filter((e) => e.timestamp >= options.sinceISO!);
      if (options?.limit) filtered = filtered.slice(-options.limit);
      return filtered;
    },
    count(companyId, predicate) {
      const bucket = buckets.get(companyId) ?? [];
      if (!predicate) return bucket.length;
      let c = 0;
      for (const e of bucket) if (predicate(e)) c += 1;
      return c;
    },
    groupBy(companyId, keyOf) {
      const map = new Map<ReturnType<typeof keyOf>, FeedbackEvent[]>();
      const bucket = buckets.get(companyId) ?? [];
      for (const e of bucket) {
        const k = keyOf(e);
        if (k == null) continue;
        const arr = map.get(k) ?? [];
        arr.push(e);
        map.set(k, arr);
      }
      return map as Map<Exclude<ReturnType<typeof keyOf>, null>, FeedbackEvent[]>;
    },
    clear(companyId) {
      if (!companyId) { buckets.clear(); return; }
      buckets.delete(companyId);
    },
    size(companyId) {
      if (companyId) return buckets.get(companyId)?.length ?? 0;
      let total = 0;
      buckets.forEach((b) => { total += b.length; });
      return total;
    },
  };
}

let _defaultRegistry: FeedbackEventRegistry | null = null;

export function getDefaultFeedbackEventRegistry(): FeedbackEventRegistry {
  if (!_defaultRegistry) _defaultRegistry = createFeedbackEventRegistry();
  return _defaultRegistry;
}

export function setDefaultFeedbackEventRegistry(reg: FeedbackEventRegistry): void {
  _defaultRegistry = reg;
}
