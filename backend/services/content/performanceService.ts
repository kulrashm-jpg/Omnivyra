/**
 * Wave 5 (item 2) — Performance Signal Ingestion.
 *
 * The single write/read seam for `content_performance` — per-published-item
 * engagement signals that feed the Learning Engine. Signals are APPEND-ONLY: a
 * new row is written per capture; historical content is NEVER mutated.
 *
 * Design:
 *  - Uses the shared service-role admin client (`backend/db/supabaseClient`),
 *    consistent with `contentService`. The service role bypasses RLS, so EVERY
 *    method is explicitly company-scoped (`.eq('company_id', …)`).
 *  - EXTENSIBLE by construction: the migration exposes first-class columns for
 *    the common metrics; any other signal the caller supplies is preserved
 *    verbatim in the `metrics` jsonb bag so new platform-specific metrics need
 *    no schema change.
 *  - DERIVED ctr: when `ctr` is absent but `clicks` and `impressions` are
 *    present (and impressions > 0), ctr is computed deterministically as
 *    clicks / impressions. No other value is ever invented.
 *  - FAIL-SAFE: ingestion never throws. On a DB error it returns `null` (the
 *    caller's publish path must not fail because a metric write failed). Reads
 *    return `null` / `[]` on error.
 */

import { supabase } from '../../db/supabaseClient';

const PERFORMANCE_TABLE = 'content_performance';

/**
 * The known, first-class performance metrics. Every field is optional; the
 * ingest path maps present numeric fields to their dedicated column and routes
 * anything else into the `metrics` jsonb bag (see `EXTRA` handling below).
 */
export interface PerformanceSignals {
  impressions?: number;
  reach?: number;
  clicks?: number;
  engagement?: number;
  reactions?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  /** Click-through rate 0..1. Derived from clicks/impressions when absent. */
  ctr?: number;
  watchTimeMs?: number;
  /** Any additional, platform-specific or future metric — preserved verbatim. */
  [key: string]: unknown;
}

export interface IngestSignalsInput {
  companyId: string;
  contentId?: string | null;
  platform?: string | null;
  signals: PerformanceSignals;
  /** Provenance, e.g. 'manual' | 'platform_sync'. Defaults to 'manual'. */
  source?: string | null;
  /** ISO capture time. Supplied by the caller for reproducibility; optional. */
  capturedAt?: string;
}

/** A persisted performance row projected to camelCase. */
export interface PerformanceRow {
  id: string;
  companyId: string;
  contentId: string | null;
  platform: string | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  engagement: number | null;
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  ctr: number | null;
  watchTimeMs: number | null;
  metrics: Record<string, unknown> | null;
  source: string | null;
  capturedAt: string;
}

/** An aggregated view across every capture for one content item. */
export interface PerformanceAggregate {
  contentId: string;
  samples: number;
  /** Summed counters across all captures. */
  totals: {
    impressions: number;
    reach: number;
    clicks: number;
    engagement: number;
    reactions: number;
    comments: number;
    shares: number;
    saves: number;
    watchTimeMs: number;
  };
  /** Averaged rates across captures that carried the metric. */
  averages: {
    /** Aggregate ctr from summed clicks / summed impressions (0 when no impressions). */
    ctr: number;
  };
  /** Newest capture time observed, or null when there were no rows. */
  lastCapturedAt: string | null;
}

// ── the known numeric columns (drives column-vs-jsonb routing) ───────────────

/** camelCase signal key → snake_case column. Anything NOT here goes to `metrics`. */
const KNOWN_COLUMN_MAP: Record<string, string> = {
  impressions: 'impressions',
  reach: 'reach',
  clicks: 'clicks',
  engagement: 'engagement',
  reactions: 'reactions',
  comments: 'comments',
  shares: 'shares',
  saves: 'saves',
  ctr: 'ctr',
  watchTimeMs: 'watch_time_ms',
};

const COUNTER_KEYS = [
  'impressions', 'reach', 'clicks', 'engagement',
  'reactions', 'comments', 'shares', 'saves', 'watchTimeMs',
] as const;

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapRow(row: any): PerformanceRow {
  return {
    id: row.id,
    companyId: row.company_id,
    contentId: row.content_id ?? null,
    platform: row.platform ?? null,
    impressions: row.impressions ?? null,
    reach: row.reach ?? null,
    clicks: row.clicks ?? null,
    engagement: row.engagement ?? null,
    reactions: row.reactions ?? null,
    comments: row.comments ?? null,
    shares: row.shares ?? null,
    saves: row.saves ?? null,
    ctr: row.ctr ?? null,
    watchTimeMs: row.watch_time_ms ?? null,
    metrics: (row.metrics ?? null) as Record<string, unknown> | null,
    source: row.source ?? null,
    capturedAt: row.captured_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Split a caller's signal bag into first-class column values and an extensible
 * `metrics` jsonb remainder. Derives `ctr` from clicks/impressions when absent.
 * Pure and deterministic.
 */
export function partitionSignals(signals: PerformanceSignals): {
  columns: Record<string, number>;
  metrics: Record<string, unknown>;
  derivedCtr: boolean;
} {
  const columns: Record<string, number> = {};
  const metrics: Record<string, unknown> = {};

  for (const [key, rawValue] of Object.entries(signals ?? {})) {
    if (rawValue == null) continue;
    const column = KNOWN_COLUMN_MAP[key];
    if (column) {
      const n = toFiniteNumber(rawValue);
      if (n !== null) columns[column] = n;
      continue;
    }
    // Unknown / future / platform-specific metric — preserve verbatim.
    metrics[key] = rawValue;
  }

  // Derive ctr from clicks/impressions when the caller did not supply one.
  let derivedCtr = false;
  if (columns.ctr === undefined) {
    const clicks = columns.clicks;
    const impressions = columns.impressions;
    if (
      typeof clicks === 'number' &&
      typeof impressions === 'number' &&
      impressions > 0
    ) {
      columns.ctr = clicks / impressions;
      derivedCtr = true;
    }
  }

  return { columns, metrics, derivedCtr };
}

/**
 * Append one performance capture. Company-scoped, append-only, extensible,
 * fail-safe (returns `null` instead of throwing on any error).
 */
export async function ingestSignals(input: IngestSignalsInput): Promise<PerformanceRow | null> {
  try {
    if (!input?.companyId) return null;
    const { columns, metrics, derivedCtr } = partitionSignals(input.signals ?? {});

    // Record provenance of a derived value inside the jsonb bag for auditability.
    if (derivedCtr) metrics.__ctr_derived_from = 'clicks/impressions';

    const insertRow: Record<string, unknown> = {
      company_id: input.companyId,
      content_id: input.contentId ?? null,
      platform: input.platform ?? null,
      source: input.source ?? 'manual',
      metrics: Object.keys(metrics).length > 0 ? metrics : null,
      ...columns,
    };
    if (input.capturedAt) insertRow.captured_at = input.capturedAt;

    const { data, error } = await supabase
      .from(PERFORMANCE_TABLE)
      .insert(insertRow)
      .select('*')
      .single();
    if (error || !data) return null;
    return mapRow(data);
  } catch {
    return null;
  }
}

/**
 * Read performance captures for a content item, newest-first. Company-scoped.
 * Returns `[]` on error. Pass `{ latestOnly: true }` for just the most recent.
 */
export async function getSignals(
  contentId: string,
  companyId: string,
  opts: { latestOnly?: boolean; limit?: number } = {},
): Promise<PerformanceRow[]> {
  try {
    if (!contentId || !companyId) return [];
    let query = supabase
      .from(PERFORMANCE_TABLE)
      .select('*')
      .eq('content_id', contentId)
      .eq('company_id', companyId)
      .order('captured_at', { ascending: false });

    const limit = opts.latestOnly ? 1 : opts.limit;
    if (typeof limit === 'number') query = query.limit(limit);

    const { data, error } = await query;
    if (error || !data) return [];
    return (data as unknown[]).map((r) => mapRow(r));
  } catch {
    return [];
  }
}

/**
 * Summed / averaged view across every capture for a content item. Company
 * scoping is enforced when `companyId` is supplied. Deterministic given the
 * same rows; fail-safe (returns a zeroed aggregate on error).
 */
export async function aggregateSignals(
  contentId: string,
  companyId?: string,
): Promise<PerformanceAggregate> {
  const empty: PerformanceAggregate = {
    contentId,
    samples: 0,
    totals: {
      impressions: 0, reach: 0, clicks: 0, engagement: 0,
      reactions: 0, comments: 0, shares: 0, saves: 0, watchTimeMs: 0,
    },
    averages: { ctr: 0 },
    lastCapturedAt: null,
  };
  try {
    if (!contentId) return empty;
    let query = supabase
      .from(PERFORMANCE_TABLE)
      .select('*')
      .eq('content_id', contentId)
      .order('captured_at', { ascending: false });
    if (companyId) query = query.eq('company_id', companyId);

    const { data, error } = await query;
    if (error || !data) return empty;
    const rows = (data as unknown[]).map((r) => mapRow(r));
    if (rows.length === 0) return empty;

    const totals = { ...empty.totals };
    for (const row of rows) {
      for (const key of COUNTER_KEYS) {
        const v = row[key];
        if (typeof v === 'number' && Number.isFinite(v)) totals[key] += v;
      }
    }
    const ctr = totals.impressions > 0 ? totals.clicks / totals.impressions : 0;

    return {
      contentId,
      samples: rows.length,
      totals,
      averages: { ctr },
      lastCapturedAt: rows[0].capturedAt ?? null,
    };
  } catch {
    return empty;
  }
}
