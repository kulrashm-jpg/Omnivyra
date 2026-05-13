import { getLatestCompletedRun, getLatestRun } from './ingestionRunService';
import { supabase } from '../db/supabaseClient';

const ANALYTICS_FRESHNESS_HOURS = 24;
const MIN_ANALYTICS_EVENTS = 100;

export type AnalyticsReadiness = {
  ready: boolean;
  status:
    | 'ready'
    | 'not_connected'
    | 'ingestion_pending'
    | 'sync_in_progress'
    | 'stale'
    | 'no_data'
    | 'insufficient_data';
  reason: string;
  last_successful_ingestion_at: string | null;
  events_last_30_days: number;
  confidence: 'none' | 'low' | 'medium' | 'high';
};

function isFresh(lastIngestion: string | null): boolean {
  if (!lastIngestion) return false;
  const timestamp = new Date(lastIngestion).getTime();
  if (!Number.isFinite(timestamp)) return false;
  return timestamp >= Date.now() - ANALYTICS_FRESHNESS_HOURS * 60 * 60 * 1000;
}

export async function getAnalyticsReadiness(companyId: string): Promise<AnalyticsReadiness> {
  const windowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [latestSuccessfulRun, latestRun, events] = await Promise.all([
    getLatestCompletedRun(companyId, 'ga4'),
    getLatestRun(companyId, 'ga4').catch(() => null),
    supabase
      .from('canonical_events')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .gte('event_timestamp', windowStart),
  ]);

  const lastSuccessfulIngestionAt = latestSuccessfulRun?.completed_at ?? null;
  const eventsLast30Days = events.count ?? 0;

  if (latestRun?.status === 'running' && !latestSuccessfulRun?.completed_at) {
    return {
      ready: false,
      status: 'sync_in_progress',
      reason: 'Google Analytics sync is in progress',
      last_successful_ingestion_at: null,
      events_last_30_days: eventsLast30Days,
      confidence: eventsLast30Days > 0 ? 'low' : 'none',
    };
  }

  if (!lastSuccessfulIngestionAt) {
    return {
      ready: false,
      status: 'ingestion_pending',
      reason: 'No successful GA4 ingestion found',
      last_successful_ingestion_at: null,
      events_last_30_days: eventsLast30Days,
      confidence: eventsLast30Days > 0 ? 'low' : 'none',
    };
  }

  if (!isFresh(lastSuccessfulIngestionAt)) {
    return {
      ready: false,
      status: 'stale',
      reason: 'Last successful GA4 ingestion is stale',
      last_successful_ingestion_at: lastSuccessfulIngestionAt,
      events_last_30_days: eventsLast30Days,
      confidence: eventsLast30Days > 0 ? 'medium' : 'none',
    };
  }

  if (eventsLast30Days === 0) {
    return {
      ready: false,
      status: 'no_data',
      reason: 'No analytics data available',
      last_successful_ingestion_at: lastSuccessfulIngestionAt,
      events_last_30_days: eventsLast30Days,
      confidence: 'none',
    };
  }

  if (eventsLast30Days < MIN_ANALYTICS_EVENTS) {
    return {
      ready: false,
      status: 'insufficient_data',
      reason: 'Not enough data for reliable insights',
      last_successful_ingestion_at: lastSuccessfulIngestionAt,
      events_last_30_days: eventsLast30Days,
      confidence: 'low',
    };
  }

  return {
    ready: true,
    status: 'ready',
    reason: 'Analytics data ready',
    last_successful_ingestion_at: lastSuccessfulIngestionAt,
    events_last_30_days: eventsLast30Days,
    confidence: 'high',
  };
}
