/**
 * Tracker operational diagnostics (READ-ONLY).
 *
 * Aggregates the EXISTING tracking tables (tracking_events, visitor_sessions,
 * websites) into a tenant-scoped health view. It never writes, never calls the
 * tracker, never mutates ingestion — purely reflects what ingestion already
 * persisted. Safe to poll from an admin endpoint.
 *
 * Ingestion flow it observes (unchanged):
 *   omnivera-tracker.js → POST /api/website-events/track
 *     → tracking_events (+ dedupe_key/batch_id/ip_hash/bot_flag)
 *     → resolveVisitorSession() → visitor_sessions
 */
import { ownedDbTable } from '../../db/writeOwner';

export type HealthStatus = 'healthy' | 'degraded' | 'stale' | 'no_data';

export interface WebsiteTrackerHealth {
  websiteId: string;
  status: HealthStatus;
  lastEventAt: string | null;
  minutesSinceLastEvent: number | null;
  events24h: number;
  sessions24h: number;
  botEvents24h: number;
  /** Heuristic: many distinct batch_ids per session within a short window
   * suggests duplicate tracker tags firing the same events. */
  duplicateTrackerSuspected: boolean;
  /** 0–100 confidence the tracker is correctly installed & ingesting. */
  installationConfidence: number;
  notes: string[];
}

export interface TrackingDiagnosticsReport {
  companyId: string;
  generatedAt: string;
  overall: HealthStatus;
  ingestionLagSeconds: number | null;
  websites: WebsiteTrackerHealth[];
  remediation: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_MIN = 6 * 60; // 6h with zero events on an active site = stale

async function safeCount(
  build: () => any,
): Promise<number> {
  try {
    const { count, error } = await build();
    if (error) return 0;
    return typeof count === 'number' ? count : 0;
  } catch {
    return 0;
  }
}

export async function buildTrackingDiagnostics(
  companyId: string,
): Promise<TrackingDiagnosticsReport> {
  const sinceIso = new Date(Date.now() - DAY_MS).toISOString();
  const remediation: string[] = [];

  let websites: Array<{ id: string; status: string }> = [];
  try {
    const { data } = await ownedDbTable('websites')
      .select('id, status')
      .eq('company_id', companyId)
      .is('deleted_at', null);
    websites = (data ?? []) as Array<{ id: string; status: string }>;
  } catch {
    websites = [];
  }

  // Newest event for ingestion-lag (occurred_at vs created_at).
  let ingestionLagSeconds: number | null = null;
  try {
    const { data } = await ownedDbTable('tracking_events')
      .select('occurred_at, created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(1);
    const row = (data ?? [])[0] as { occurred_at?: string; created_at?: string } | undefined;
    if (row?.occurred_at && row?.created_at) {
      ingestionLagSeconds = Math.max(
        0,
        Math.round((Date.parse(row.created_at) - Date.parse(row.occurred_at)) / 1000),
      );
    }
  } catch {
    ingestionLagSeconds = null;
  }

  const perWebsite: WebsiteTrackerHealth[] = [];
  for (const w of websites) {
    const notes: string[] = [];

    let lastEventAt: string | null = null;
    try {
      const { data } = await ownedDbTable('tracking_events')
        .select('occurred_at')
        .eq('company_id', companyId)
        .eq('website_id', w.id)
        .order('occurred_at', { ascending: false })
        .limit(1);
      lastEventAt = ((data ?? [])[0] as any)?.occurred_at ?? null;
    } catch {
      lastEventAt = null;
    }

    const events24h = await safeCount(() =>
      ownedDbTable('tracking_events')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('website_id', w.id)
        .gte('occurred_at', sinceIso),
    );
    const botEvents24h = await safeCount(() =>
      ownedDbTable('tracking_events')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('website_id', w.id)
        .eq('bot_flag', true)
        .gte('occurred_at', sinceIso),
    );
    const sessions24h = await safeCount(() =>
      ownedDbTable('visitor_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('website_id', w.id)
        .gte('started_at', sinceIso),
    );

    // Duplicate-tracker heuristic: distinct batch_ids >> sessions implies the
    // same page is POSTing the same events from two script tags.
    let duplicateTrackerSuspected = false;
    try {
      const { data } = await ownedDbTable('tracking_events')
        .select('batch_id, visitor_session_id')
        .eq('company_id', companyId)
        .eq('website_id', w.id)
        .gte('occurred_at', sinceIso)
        .limit(2000);
      const rows = (data ?? []) as Array<{ batch_id?: string; visitor_session_id?: string }>;
      const bySession = new Map<string, Set<string>>();
      for (const r of rows) {
        if (!r.visitor_session_id || !r.batch_id) continue;
        if (!bySession.has(r.visitor_session_id)) bySession.set(r.visitor_session_id, new Set());
        bySession.get(r.visitor_session_id)!.add(r.batch_id);
      }
      let suspect = 0;
      for (const set of bySession.values()) if (set.size >= 8) suspect += 1;
      duplicateTrackerSuspected = suspect > 0 && suspect >= bySession.size * 0.25;
      if (duplicateTrackerSuspected) {
        notes.push('Possible duplicate tracker tag — unusually many event batches per session.');
      }
    } catch {
      duplicateTrackerSuspected = false;
    }

    const minutesSinceLastEvent = lastEventAt
      ? Math.round((Date.now() - Date.parse(lastEventAt)) / 60000)
      : null;

    let status: HealthStatus;
    if (lastEventAt == null) {
      status = 'no_data';
      notes.push('No events received — tracker may not be installed on this site.');
    } else if (minutesSinceLastEvent != null && minutesSinceLastEvent > STALE_MIN) {
      status = 'stale';
      notes.push(`No events for ${Math.round(minutesSinceLastEvent / 60)}h — tracker may have been removed or the site is idle.`);
    } else if (events24h > 0 && sessions24h === 0) {
      status = 'degraded';
      notes.push('Events arriving but no visitor sessions created — session resolution may be failing.');
    } else if (duplicateTrackerSuspected) {
      status = 'degraded';
    } else {
      status = 'healthy';
    }

    // Installation confidence (0–100).
    let confidence = 0;
    if (lastEventAt) confidence += 40;
    if (events24h > 0) confidence += 20;
    if (sessions24h > 0) confidence += 25;
    if (minutesSinceLastEvent != null && minutesSinceLastEvent <= 60) confidence += 15;
    if (duplicateTrackerSuspected) confidence = Math.max(0, confidence - 25);
    confidence = Math.min(100, confidence);

    perWebsite.push({
      websiteId: w.id,
      status,
      lastEventAt,
      minutesSinceLastEvent,
      events24h,
      sessions24h,
      botEvents24h,
      duplicateTrackerSuspected,
      installationConfidence: confidence,
      notes,
    });
  }

  if (perWebsite.some((w) => w.status === 'no_data')) {
    remediation.push('Add the tracking snippet to the site <head> (Integrations → Your Websites).');
  }
  if (perWebsite.some((w) => w.status === 'stale')) {
    remediation.push('Confirm the tracking snippet is still present and the site is reachable.');
  }
  if (perWebsite.some((w) => w.duplicateTrackerSuspected)) {
    remediation.push('Remove duplicate tracker script tags — keep exactly one per page.');
  }
  if (ingestionLagSeconds != null && ingestionLagSeconds > 120) {
    remediation.push(`Event ingestion lag is ${ingestionLagSeconds}s — check queue/worker throughput.`);
  }

  const overall: HealthStatus =
    perWebsite.length === 0
      ? 'no_data'
      : perWebsite.every((w) => w.status === 'healthy')
        ? 'healthy'
        : perWebsite.some((w) => w.status === 'no_data' || w.status === 'stale')
          ? 'stale'
          : 'degraded';

  return {
    companyId,
    generatedAt: new Date().toISOString(),
    overall,
    ingestionLagSeconds,
    websites: perWebsite,
    remediation,
  };
}
