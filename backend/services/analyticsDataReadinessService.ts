import { getLatestCompletedRun } from './ingestionRunService';
import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');

const ANALYTICS_FRESHNESS_HOURS = 24;
const MIN_ANALYTICS_EVENTS = 100;

export type AnalyticsReadiness = {
  ready: boolean;
  reason: string;
  last_successful_ingestion_at: string | null;
  events_last_30_days: number;
};

function isFresh(lastIngestion: string | null): boolean {
  if (!lastIngestion) return false;
  const timestamp = new Date(lastIngestion).getTime();
  if (!Number.isFinite(timestamp)) return false;
  return timestamp >= Date.now() - ANALYTICS_FRESHNESS_HOURS * 60 * 60 * 1000;
}

export async function getAnalyticsReadiness(companyId: string): Promise<AnalyticsReadiness> {
  const windowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [latestSuccessfulRun, events] = await Promise.all([
    getLatestCompletedRun(companyId, 'ga4'),
    supabase
      .from('canonical_events')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .gte('event_timestamp', windowStart),
  ]);

  const lastSuccessfulIngestionAt = latestSuccessfulRun?.completed_at ?? null;
  const eventsLast30Days = events.count ?? 0;

  if (!lastSuccessfulIngestionAt) {
    return {
      ready: false,
      reason: 'No successful GA4 ingestion found',
      last_successful_ingestion_at: null,
      events_last_30_days: eventsLast30Days,
    };
  }

  if (!isFresh(lastSuccessfulIngestionAt)) {
    return {
      ready: false,
      reason: 'Last successful GA4 ingestion is stale',
      last_successful_ingestion_at: lastSuccessfulIngestionAt,
      events_last_30_days: eventsLast30Days,
    };
  }

  if (eventsLast30Days === 0) {
    return {
      ready: false,
      reason: 'No analytics data available',
      last_successful_ingestion_at: lastSuccessfulIngestionAt,
      events_last_30_days: eventsLast30Days,
    };
  }

  if (eventsLast30Days < MIN_ANALYTICS_EVENTS) {
    return {
      ready: false,
      reason: 'Not enough data for reliable insights',
      last_successful_ingestion_at: lastSuccessfulIngestionAt,
      events_last_30_days: eventsLast30Days,
    };
  }

  return {
    ready: true,
    reason: 'Analytics data ready',
    last_successful_ingestion_at: lastSuccessfulIngestionAt,
    events_last_30_days: eventsLast30Days,
  };
}
