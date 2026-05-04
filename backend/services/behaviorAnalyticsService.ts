/**
 * Behavior Analytics Service — Report 2 data access layer
 *
 * Pure read-only queries against the canonical_* tables. Each function is
 * scoped to a single company + optional time window (default 30 days).
 *
 * Join note: canonical_events.session_id is TEXT (GA4-issued) and does NOT
 * join to canonical_sessions.id (UUID). Where possible we stay inside one
 * table; where we need both, canonical_sessions is authoritative for
 * traffic-source + total-session counts, and canonical_events' own session_id
 * is authoritative for event-scoped aggregates.
 */

import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');

const DEFAULT_WINDOW_DAYS = 30;
const TOP_PAGES_LIMIT     = 20;
const DROP_OFF_LIMIT      = 10;
const TRAFFIC_GROUP_LIMIT = 50;

export interface BehaviorQueryOpts {
  /** Look-back window in days. Defaults to 30. */
  sinceDays?: number;
}

function windowStartIso(opts?: BehaviorQueryOpts): string {
  const days = opts?.sinceDays ?? DEFAULT_WINDOW_DAYS;
  return new Date(Date.now() - days * 86400 * 1000).toISOString();
}

// ─── Public shapes ────────────────────────────────────────────────────────────

export interface TrafficSourceRow {
  traffic_source: string;
  source_medium:  string;
  sessions:       number;
  events:         number;
  conversions:    number;
}

export interface TopPageRow {
  page_url:    string;
  visits:      number;
  events:      number;
  conversions: number;
}

export interface SessionMetrics {
  total_sessions:          number;
  avg_events_per_session:  number;
  conversion_rate:         number; // 0..1
}

export interface DropOffPageRow {
  page_url:       string;
  entry_sessions: number;
  exit_sessions:  number;
  drop_off_rate:  number; // 0..1
}

export interface FunnelStep {
  step:     string;
  users:    number;
  drop_pct: number; // 0..1, relative to previous step; 0 for step 1
}

export interface FunnelResult {
  steps: FunnelStep[];
  inferred_entry: boolean;
}

export interface ConversionSummary {
  total_conversions:          number;
  by_type:                    Array<{ conversion_name: string; count: number }>;
  conversion_rate_per_session: number; // 0..1
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Page a Supabase select in 1000-row chunks. Required for any fetch that
 * could exceed the default 1000-row cap (events windows).
 */
async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const to = from + PAGE - 1;
    const { data, error } = await build(from, to);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

function safeDiv(num: number, den: number): number {
  return den > 0 ? num / den : 0;
}

function aggregatedCount(metadata: Record<string, unknown> | null | undefined): number {
  const parsed = Number.parseInt(String(metadata?.['aggregated_event_count'] ?? '1'), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

// ─── 1. Traffic sources ───────────────────────────────────────────────────────

/**
 * Group canonical_events by metadata.traffic_source + metadata.source_medium.
 * Returns sessions (distinct session_id), events (row count) and conversions
 * (rows with event_category='conversion') per group.
 */
export async function getTrafficSources(
  companyId: string,
  opts?: BehaviorQueryOpts,
): Promise<TrafficSourceRow[]> {
  const since = windowStartIso(opts);

  type EventRow = {
    session_id:     string;
    event_category: string;
    metadata:       Record<string, unknown> | null;
  };

  const rows = await fetchAllRows<EventRow>((from, to) =>
    supabase
      .from('canonical_events')
      .select('session_id, event_category, metadata')
      .eq('company_id', companyId)
      .gte('event_timestamp', since)
      .range(from, to),
  );

  type Agg = { sessions: Set<string>; events: number; conversions: number };
  const groups = new Map<string, Agg>();

  for (const row of rows) {
    const src = (row.metadata?.['traffic_source'] as string | undefined)?.trim() || 'unknown';
    const med = (row.metadata?.['source_medium']  as string | undefined)?.trim() || 'unknown';
    const key = `${src}|${med}`;
    let agg = groups.get(key);
    if (!agg) {
      agg = { sessions: new Set(), events: 0, conversions: 0 };
      groups.set(key, agg);
    }
    agg.sessions.add(row.session_id);
    const count = aggregatedCount(row.metadata);
    agg.events += count;
    if (row.event_category === 'conversion') agg.conversions += count;
  }

  return Array.from(groups.entries())
    .map(([key, agg]) => {
      const [traffic_source, source_medium] = key.split('|');
      return {
        traffic_source,
        source_medium,
        sessions:    agg.sessions.size,
        events:      agg.events,
        conversions: agg.conversions,
      };
    })
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, TRAFFIC_GROUP_LIMIT);
}

// ─── 2. Top pages ─────────────────────────────────────────────────────────────

/**
 * Top pages by distinct-session visits, with events-per-page engagement and
 * conversion counts. Groups on canonical_events.page_url (avoids the
 * page_id → canonical_pages.url join which adds a table without new signal).
 */
export async function getTopPages(
  companyId: string,
  opts?: BehaviorQueryOpts,
): Promise<TopPageRow[]> {
  const since = windowStartIso(opts);

  type PageViewRow = {
    page_id: string;
    view_count: number | null;
  };
  type PageRow = { id: string; url: string | null };
  type EventRow = { page_url: string | null; event_category: string; metadata: Record<string, unknown> | null };

  const pageViews = await fetchAllRows<PageViewRow>((from, to) =>
    supabase
      .from('canonical_page_views')
      .select('page_id, view_count')
      .eq('company_id', companyId)
      .gte('viewed_at', since)
      .range(from, to),
  );

  const pageIds = [...new Set(pageViews.map((row) => row.page_id).filter(Boolean))];
  const pageUrls = new Map<string, string>();

  if (pageIds.length > 0) {
    const pages = await fetchAllRows<PageRow>((from, to) =>
      supabase
        .from('canonical_pages')
        .select('id, url')
        .eq('company_id', companyId)
        .in('id', pageIds)
        .range(from, to),
    );

    for (const page of pages) {
      const url = page.url?.trim();
      if (page.id && url) {
        pageUrls.set(page.id, url);
      }
    }
  }

  const eventRows = await fetchAllRows<EventRow>((from, to) =>
    supabase
      .from('canonical_events')
      .select('page_url, event_category, metadata')
      .eq('company_id', companyId)
      .gte('event_timestamp', since)
      .not('page_url', 'is', null)
      .range(from, to),
  );

  type Agg = { visits: number; events: number; conversions: number };
  const byPage = new Map<string, Agg>();

  for (const row of pageViews) {
    const url = pageUrls.get(row.page_id)?.trim();
    if (!url) continue;
    let agg = byPage.get(url);
    if (!agg) {
      agg = { visits: 0, events: 0, conversions: 0 };
      byPage.set(url, agg);
    }
    agg.visits += Math.max(1, Number(row.view_count ?? 1));
  }

  for (const row of eventRows) {
    const url = row.page_url?.trim();
    if (!url) continue;
    let agg = byPage.get(url);
    if (!agg) {
      agg = { visits: 0, events: 0, conversions: 0 };
      byPage.set(url, agg);
    }
    const count = aggregatedCount(row.metadata);
    agg.events += count;
    if (row.event_category === 'conversion') agg.conversions += count;
  }

  return Array.from(byPage.entries())
    .map(([page_url, agg]) => ({
      page_url,
      visits:      agg.visits,
      events:      agg.events,
      conversions: agg.conversions,
    }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, TOP_PAGES_LIMIT);
}

// ─── 3. Session metrics ───────────────────────────────────────────────────────

/**
 * Session-wide metrics. total_sessions is drawn from canonical_sessions (the
 * session source-of-truth); avg events + conversion rate are computed from
 * canonical_events (grouped by its own TEXT session_id). The two session
 * universes differ in cardinality when GA4 and Omnivera ingestion are not
 * fully paired — that's expected and documented at top of file.
 */
export async function getSessionMetrics(
  companyId: string,
  opts?: BehaviorQueryOpts,
): Promise<SessionMetrics> {
  const since = windowStartIso(opts);

  const { count: totalSessions = 0 } = await supabase
    .from('canonical_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .gte('started_at', since);

  type EventRow = { session_id: string; event_category: string; metadata: Record<string, unknown> | null };
  const rows = await fetchAllRows<EventRow>((from, to) =>
    supabase
      .from('canonical_events')
      .select('session_id, event_category, metadata')
      .eq('company_id', companyId)
      .gte('event_timestamp', since)
      .range(from, to),
  );

  const perSession = new Map<string, { events: number; hasConversion: boolean }>();
  for (const row of rows) {
    let s = perSession.get(row.session_id);
    if (!s) {
      s = { events: 0, hasConversion: false };
      perSession.set(row.session_id, s);
    }
    s.events += aggregatedCount(row.metadata);
    if (row.event_category === 'conversion') s.hasConversion = true;
  }

  const totalEvents   = Array.from(perSession.values()).reduce((sum, session) => sum + session.events, 0);
  const convSessions  = Array.from(perSession.values()).filter((s) => s.hasConversion).length;

  return {
    total_sessions:         totalSessions ?? 0,
    avg_events_per_session: Number(safeDiv(totalEvents, totalSessions ?? 0).toFixed(2)),
    conversion_rate:        Number(safeDiv(convSessions, totalSessions ?? 0).toFixed(4)),
  };
}

// ─── 4. Drop-off pages ────────────────────────────────────────────────────────

/**
 * For each page, compute the share of sessions that visited AND exited on it.
 *   entry_sessions = sessions that visited the page at any point in the window
 *   exit_sessions  = sessions whose LAST event (by event_timestamp) is this page
 *   drop_off_rate  = exit_sessions / entry_sessions
 *
 * Sorted by drop_off_rate desc, filtered to pages with a minimum sample size
 * (≥ 5 entry sessions) to suppress noise from one-off visits.
 */
export async function getDropOffPages(
  companyId: string,
  opts?: BehaviorQueryOpts,
): Promise<DropOffPageRow[]> {
  const since = windowStartIso(opts);

  type EventRow = {
    session_id:      string;
    page_url:        string | null;
    event_timestamp: string;
  };

  const rows = await fetchAllRows<EventRow>((from, to) =>
    supabase
      .from('canonical_events')
      .select('session_id, page_url, event_timestamp')
      .eq('company_id', companyId)
      .gte('event_timestamp', since)
      .not('page_url', 'is', null)
      .order('event_timestamp', { ascending: true })
      .range(from, to),
  );

  // Walk rows in timestamp order; track per-session pages-visited (dedup) and
  // most-recent page. At the end, most-recent == exit page.
  const sessionPages    = new Map<string, Set<string>>();
  const sessionLastPage = new Map<string, string>();

  for (const row of rows) {
    const url = row.page_url?.trim();
    if (!url) continue;
    let visited = sessionPages.get(row.session_id);
    if (!visited) {
      visited = new Set();
      sessionPages.set(row.session_id, visited);
    }
    visited.add(url);
    sessionLastPage.set(row.session_id, url);
  }

  const entries = new Map<string, number>();
  const exits   = new Map<string, number>();

  for (const [sessionId, visited] of sessionPages) {
    for (const url of visited) {
      entries.set(url, (entries.get(url) ?? 0) + 1);
    }
    const last = sessionLastPage.get(sessionId);
    if (last) exits.set(last, (exits.get(last) ?? 0) + 1);
  }

  const MIN_SAMPLE = 5;
  return Array.from(entries.entries())
    .filter(([, n]) => n >= MIN_SAMPLE)
    .map(([page_url, entry_sessions]) => {
      const exit_sessions = exits.get(page_url) ?? 0;
      return {
        page_url,
        entry_sessions,
        exit_sessions,
        drop_off_rate: Number(safeDiv(exit_sessions, entry_sessions).toFixed(4)),
      };
    })
    .sort((a, b) => b.drop_off_rate - a.drop_off_rate)
    .slice(0, DROP_OFF_LIMIT);
}

// ─── 5. Basic funnel ──────────────────────────────────────────────────────────

/**
 * Three-step funnel, keyed on canonical_events.event_category:
 *   Step 1 — session_start : any event in the window (every session enters)
 *   Step 2 — engagement    : session has an event with category='engagement'
 *   Step 3 — conversion    : session has an event with category='conversion'
 *
 * drop_pct on each step is the fraction of step-1 users NOT present at that
 * step (set to 0 for step 1).
 */
export async function getBasicFunnel(
  companyId: string,
  opts?: BehaviorQueryOpts,
): Promise<FunnelResult> {
  const since = windowStartIso(opts);

  type Row = { session_id: string; event_name: string; event_category: string; metadata: Record<string, unknown> | null };
  const rows = await fetchAllRows<Row>((from, to) =>
    supabase
      .from('canonical_events')
      .select('session_id, event_name, event_category, metadata')
      .eq('company_id', companyId)
      .gte('event_timestamp', since)
      .range(from, to),
  );

  let started = 0;
  let engaged = 0;
  let converted = 0;
  const sessionsSeen = new Set<string>();

  for (const row of rows) {
    const count = aggregatedCount(row.metadata);
    sessionsSeen.add(row.session_id);
    if (row.event_name === 'session_start') started += count;
    if (row.event_category === 'engagement') engaged += count;
    if (row.event_category === 'conversion') converted += count;
  }

  const inferredEntry = started === 0 && sessionsSeen.size > 0;
  const step1 = inferredEntry ? sessionsSeen.size : started;
  const step2 = engaged;
  const step3 = converted;

  return {
    steps: [
      { step: 'session_start', users: step1, drop_pct: 0 },
      {
        step: 'engagement',
        users: step2,
        drop_pct: Number((1 - safeDiv(step2, step1)).toFixed(4)),
      },
      {
        step: 'conversion',
        users: step3,
        drop_pct: Number((1 - safeDiv(step3, step2)).toFixed(4)),
      },
    ],
    inferred_entry: inferredEntry,
  };
}

// ─── 6. Conversion summary ────────────────────────────────────────────────────

/**
 * Totals + per-type breakdown from canonical_conversions, plus
 * conversion-rate-per-session using canonical_events' session cardinality.
 */
export async function getConversionSummary(
  companyId: string,
  opts?: BehaviorQueryOpts,
): Promise<ConversionSummary> {
  const since = windowStartIso(opts);

  type ConvRow = { conversion_name: string; metadata: Record<string, unknown> | null };
  const convRows = await fetchAllRows<ConvRow>((from, to) =>
    supabase
      .from('canonical_conversions')
      .select('conversion_name, metadata')
      .eq('company_id', companyId)
      .gte('conversion_timestamp', since)
      .range(from, to),
  );

  const byTypeMap = new Map<string, number>();
  for (const row of convRows) {
    const k = row.conversion_name?.trim() || 'unknown';
    byTypeMap.set(k, (byTypeMap.get(k) ?? 0) + aggregatedCount(row.metadata));
  }

  const totalConversions = convRows.reduce((sum, row) => sum + aggregatedCount(row.metadata), 0);

  const { count: totalSessions = 0 } = await supabase
    .from('canonical_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .gte('started_at', since);

  return {
    total_conversions: totalConversions,
    by_type: Array.from(byTypeMap.entries())
      .map(([conversion_name, count]) => ({ conversion_name, count }))
      .sort((a, b) => b.count - a.count),
    conversion_rate_per_session: Number(safeDiv(totalConversions, totalSessions ?? 0).toFixed(4)),
  };
}
