/**
 * Canonical Telemetry — Aggregation Layer
 * ---------------------------------------
 * Deterministic, reusable aggregation over the append-only ledger. No derived
 * scores stored; aggregates are computed on read. No UI coupling. There is one
 * aggregator — no module computes adoption independently.
 *
 * Windows: 7d / 30d / 90d / lifetime + arbitrary rolling (since-timestamp).
 * `now`/`since` are injectable for determinism + testability. Reads accept an
 * optional `preloaded` event list so a provider can aggregate several signals
 * from a single fetch (incremental-friendly; see telemetryProviders).
 */

import { queryTelemetryEvents } from './telemetryStore';
import type { TelemetryEventRecord, TelemetryEventType, TelemetryWindow } from '../../../lib/telemetry/telemetryTypes';

export const WINDOW_DAYS: Record<'7d' | '30d' | '90d', number> = { '7d': 7, '30d': 30, '90d': 90 };

/** Lower-bound ISO for a window; null = lifetime. For 'rolling', pass `rollingSince`. */
export function windowSince(window: TelemetryWindow, now: Date, rollingSince?: string | null): string | null {
  if (window === 'lifetime') return null;
  if (window === 'rolling') return rollingSince ?? null;
  const ms = WINDOW_DAYS[window] * 24 * 60 * 60 * 1000;
  return new Date(now.getTime() - ms).toISOString();
}

// ── Pure reducers (deterministic over a fixed event list) ────────────────────

export function countOf(events: TelemetryEventRecord[], type: TelemetryEventType): number {
  return events.reduce((n, e) => (e.event_type === type ? n + 1 : n), 0);
}

export function distinctEntities(events: TelemetryEventRecord[], type: TelemetryEventType): number {
  const set = new Set<string>();
  for (const e of events) if (e.event_type === type && e.entity_id) set.add(e.entity_id);
  return set.size;
}

export function distinctActors(events: TelemetryEventRecord[]): number {
  const set = new Set<string>();
  for (const e of events) if (e.actor_id) set.add(e.actor_id);
  return set.size;
}

export function distinctMetadataValues(events: TelemetryEventRecord[], type: TelemetryEventType, key: string): string[] {
  const set = new Set<string>();
  for (const e of events) {
    if (e.event_type !== type) continue;
    const v = e.metadata?.[key];
    if (typeof v === 'string' && v.trim()) set.add(v.trim());
  }
  return [...set];
}

/** ISO year-week buckets of a type's count — the basis for cadence signals. */
export function weeklyBuckets(events: TelemetryEventRecord[], type: TelemetryEventType): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of events) {
    if (e.event_type !== type) continue;
    const d = new Date(e.occurred_at);
    if (Number.isNaN(d.getTime())) continue;
    const year = d.getUTCFullYear();
    const week = Math.floor((d.getTime() - Date.UTC(year, 0, 1)) / (7 * 24 * 60 * 60 * 1000));
    const key = `${year}-W${String(week).padStart(2, '0')}`;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

export function activeWeeks(events: TelemetryEventRecord[], type: TelemetryEventType): number {
  return Object.keys(weeklyBuckets(events, type)).length;
}

export function latestOccurredAt(events: TelemetryEventRecord[], types?: TelemetryEventType[]): string | null {
  let latest: string | null = null;
  for (const e of events) {
    if (types && !types.includes(e.event_type)) continue;
    if (!latest || e.occurred_at > latest) latest = e.occurred_at;
  }
  return latest;
}

/**
 * Fetch window events once (reusable across providers). Pass `types` to scope.
 * `preloaded` short-circuits the query when a caller already has the events.
 */
export async function getWindowEvents(
  organizationId: string,
  window: TelemetryWindow,
  opts?: { now?: Date; types?: TelemetryEventType[]; rollingSince?: string | null; preloaded?: TelemetryEventRecord[] },
): Promise<TelemetryEventRecord[]> {
  if (opts?.preloaded) {
    const since = windowSince(window, opts.now ?? new Date(), opts.rollingSince);
    return opts.preloaded.filter(
      (e) => (!opts.types || opts.types.includes(e.event_type)) && (!since || e.occurred_at >= since),
    );
  }
  const since = windowSince(window, opts?.now ?? new Date(), opts?.rollingSince);
  return queryTelemetryEvents({ organizationId, since, types: opts?.types });
}
