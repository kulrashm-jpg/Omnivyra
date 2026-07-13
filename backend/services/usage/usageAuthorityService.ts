/**
 * usageAuthorityService.ts — the ONE canonical usage authority (CSA-001 §4).
 *
 * Every Customer Success consumer (Health, Lifecycle, Retention, Risk,
 * Engagement, Adoption) reads customer usage through THIS service — there is no
 * other read path over the usage stream. It queries the canonical time-series
 * sink (`customer_usage_events`) and aggregates per company / user / feature /
 * capability at daily / weekly / monthly granularity (§3). The aggregation core
 * is pure and deterministic; the read is fail-safe (empty on any error,
 * including a not-yet-applied migration).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { recordRawCounter, recordRawHistogram } from '../../observability/metrics';
import { USAGE_EVENT_TYPES, type UsageEventType } from '../../../lib/usage/usageEvent';

export type UsageGranularity = 'daily' | 'weekly' | 'monthly';

/** The minimal row shape the aggregation core needs. */
export interface UsageRow {
  user_id: string | null;
  event_type: string;
  feature: string | null;
  capability: string | null;
  occurred_at: string;
}

export interface UsageBucket {
  /** Bucket key: 'YYYY-MM-DD' (daily), UTC-Monday 'YYYY-MM-DD' (weekly), 'YYYY-MM' (monthly). */
  bucket: string;
  count: number;
  activeUsers: number;
}

export interface UsageSummary {
  companyId: string;
  from: string;
  to: string;
  granularity: UsageGranularity;
  totalEvents: number;
  activeUsers: number;
  byType: Record<string, number>;
  byFeature: Record<string, number>;
  byCapability: Record<string, number>;
  series: UsageBucket[];
}

export interface UsageQuery {
  from: string;
  to: string;
  granularity?: UsageGranularity;
  eventTypes?: UsageEventType[];
  userId?: string;
  feature?: string;
}

const TABLE = 'customer_usage_events';

/** UTC Monday (week start) date for an ISO timestamp. Deterministic. */
function weekStartUtc(iso: string): string {
  const d = new Date(iso);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const shift = day === 0 ? -6 : 1 - day; // back to Monday
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + shift));
  return monday.toISOString().slice(0, 10);
}

function bucketKey(iso: string, granularity: UsageGranularity): string {
  if (granularity === 'monthly') return iso.slice(0, 7);   // YYYY-MM
  if (granularity === 'weekly') return weekStartUtc(iso);   // UTC Monday
  return iso.slice(0, 10);                                  // YYYY-MM-DD
}

/**
 * PURE aggregation of usage rows into a canonical summary. Deterministic — the
 * same rows always yield the same summary (resume/refresh safe). No IO.
 */
export function aggregateUsage(
  rows: UsageRow[],
  opts: { companyId: string; from: string; to: string; granularity: UsageGranularity },
): UsageSummary {
  const byType: Record<string, number> = {};
  const byFeature: Record<string, number> = {};
  const byCapability: Record<string, number> = {};
  const allUsers = new Set<string>();
  const bucketMap = new Map<string, { count: number; users: Set<string> }>();

  for (const r of rows) {
    byType[r.event_type] = (byType[r.event_type] ?? 0) + 1;
    if (r.feature) byFeature[r.feature] = (byFeature[r.feature] ?? 0) + 1;
    if (r.capability) byCapability[r.capability] = (byCapability[r.capability] ?? 0) + 1;
    if (r.user_id) allUsers.add(r.user_id);

    const key = bucketKey(r.occurred_at, opts.granularity);
    let b = bucketMap.get(key);
    if (!b) { b = { count: 0, users: new Set<string>() }; bucketMap.set(key, b); }
    b.count++;
    if (r.user_id) b.users.add(r.user_id);
  }

  const series: UsageBucket[] = [...bucketMap.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([bucket, v]) => ({ bucket, count: v.count, activeUsers: v.users.size }));

  return {
    companyId: opts.companyId,
    from: opts.from,
    to: opts.to,
    granularity: opts.granularity,
    totalEvents: rows.length,
    activeUsers: allUsers.size,
    byType,
    byFeature,
    byCapability,
    series,
  };
}

/**
 * Read raw usage rows for a company over a window. Fail-safe: returns [] on any
 * error (including the table not existing pre-migration) and emits a metric.
 */
export async function queryUsageEvents(
  companyId: string,
  query: UsageQuery,
  deps?: { supabase?: SupabaseClient },
): Promise<UsageRow[]> {
  try {
    const supabase = deps?.supabase ?? (await import('../../db/supabaseClient')).supabase;
    let q = supabase
      .from(TABLE)
      .select('user_id, event_type, feature, capability, occurred_at')
      .eq('company_id', companyId)
      .gte('occurred_at', query.from)
      .lte('occurred_at', query.to)
      .order('occurred_at', { ascending: true })
      .limit(50000);
    if (query.eventTypes && query.eventTypes.length > 0) q = q.in('event_type', query.eventTypes);
    if (query.userId) q = q.eq('user_id', query.userId);
    if (query.feature) q = q.eq('feature', query.feature);

    const { data, error } = await q;
    if (error) { recordRawCounter('usage.query.failures', 1); return []; }
    return (data ?? []) as UsageRow[];
  } catch {
    recordRawCounter('usage.query.failures', 1);
    return [];
  }
}

/**
 * THE canonical usage read for Customer Success consumers: query + aggregate at
 * the requested granularity. Records aggregation latency (§7).
 */
export async function getUsageSummary(
  companyId: string,
  query: UsageQuery,
  deps?: { supabase?: SupabaseClient },
): Promise<UsageSummary> {
  const granularity = query.granularity ?? 'daily';
  const rows = await queryUsageEvents(companyId, query, deps);
  const started = Date.now();
  const summary = aggregateUsage(rows, { companyId, from: query.from, to: query.to, granularity });
  recordRawHistogram('usage.aggregation.duration_ms', Date.now() - started);
  return summary;
}

/** Convenience: the canonical event-type list (so consumers never redefine it). */
export function usageEventTypes(): ReadonlyArray<UsageEventType> {
  return USAGE_EVENT_TYPES;
}
