/**
 * Canonical chronological timeline.
 *
 * Merges events from every connected source into one provenance-preserving,
 * chronologically-ordered stream. Every event retains origin, timestamp, source,
 * entity id and metadata — nothing is collapsed or lost.
 */

import type { CanonicalLeadSource } from './types';

export interface TimelineEvent {
  origin: string;            // which subsystem produced it (e.g. 'opportunity_feed', 'tracking_events')
  source: CanonicalLeadSource;
  entityId: string | null;   // the originating row id
  eventType: string;
  occurredAt: string | null; // ISO; null sorts last
  metadata: Record<string, unknown>;
}

function ts(v: string | null): number {
  if (!v) return Number.NEGATIVE_INFINITY; // unknown timestamps sort to the end (ascending) / handled below
  const n = Date.parse(v);
  return Number.isNaN(n) ? Number.NEGATIVE_INFINITY : n;
}

/**
 * Merge + order events chronologically (newest first by default). Stable for equal
 * timestamps (preserves input order). Events with unknown timestamps go last.
 */
export function buildTimeline(events: TimelineEvent[], opts: { order?: 'asc' | 'desc' } = {}): TimelineEvent[] {
  const order = opts.order ?? 'desc';
  return events
    .map((e, i) => ({ e, i, t: ts(e.occurredAt), known: e.occurredAt != null && !Number.isNaN(Date.parse(e.occurredAt)) }))
    .sort((a, b) => {
      if (a.known !== b.known) return a.known ? -1 : 1; // known timestamps first
      if (a.t !== b.t) return order === 'desc' ? b.t - a.t : a.t - b.t;
      return a.i - b.i; // stable
    })
    .map((x) => x.e);
}

/** Merge several per-source event lists into one timeline. */
export function mergeTimelines(...lists: TimelineEvent[][]): TimelineEvent[] {
  return buildTimeline(lists.flat());
}
