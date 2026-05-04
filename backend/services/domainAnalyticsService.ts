/**
 * domainAnalyticsService.ts
 *
 * Read-only aggregations over domain_events. Pure utility — does not mutate
 * the table. Intended for super-admin dashboards / triage tooling.
 *
 * No caching here on purpose: the table is small, queries are bounded, and
 * caching adds complexity that the spec explicitly asks to avoid.
 */

import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { logger } from './logger';

const FAILURE_EVENT_TYPES = [
  'DOMAIN_VERIFICATION_FAILED',
  'DOMAIN_RESOLUTION_FAILED',
  'DOMAIN_FORWARDING_BLOCKED',
] as const;

export interface TopFailingDomain {
  final_domain: string;
  count: number;
}

export interface HighRiskCompany {
  company_id: string;
  count: number;
}

export interface EventTrendBucket {
  event_type: string;
  count: number;
}

/**
 * Top N domains by combined failure count across the lifetime of the table.
 * Reads only the failure event types defined above.
 */
export async function getTopFailingDomains(limit = 10): Promise<TopFailingDomain[]> {
  const { data, error } = await supabase
    .from('domain_events')
    .select('final_domain')
    .in('event_type', FAILURE_EVENT_TYPES as unknown as string[])
    .not('final_domain', 'is', null);
  if (error) {
    logger.warn('domain_analytics_top_failing_failed', { message: error.message });
    return [];
  }
  const counts = new Map<string, number>();
  for (const row of (data || []) as Array<{ final_domain: string | null }>) {
    if (!row.final_domain) continue;
    counts.set(row.final_domain, (counts.get(row.final_domain) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([final_domain, count]) => ({ final_domain, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, Math.max(0, limit));
}

/**
 * Companies with > 5 non-success events. Useful for surfacing customers
 * stuck in a verification loop or repeatedly hitting canonical / forwarding
 * rejections.
 */
export async function getHighRiskCompanies(threshold = 5): Promise<HighRiskCompany[]> {
  const { data, error } = await supabase
    .from('domain_events')
    .select('company_id')
    .neq('event_type', 'DOMAIN_VERIFICATION_SUCCESS')
    .not('company_id', 'is', null);
  if (error) {
    logger.warn('domain_analytics_high_risk_failed', { message: error.message });
    return [];
  }
  const counts = new Map<string, number>();
  for (const row of (data || []) as Array<{ company_id: string | null }>) {
    if (!row.company_id) continue;
    counts.set(row.company_id, (counts.get(row.company_id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, c]) => c > threshold)
    .map(([company_id, count]) => ({ company_id, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Event-type distribution over the last `days` days. Drives the
 * verified-vs-failed adoption ratio over time.
 */
export async function getEventTrend(days = 7): Promise<EventTrendBucket[]> {
  const since = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('domain_events')
    .select('event_type')
    .gt('created_at', since);
  if (error) {
    logger.warn('domain_analytics_event_trend_failed', { message: error.message });
    return [];
  }
  const counts = new Map<string, number>();
  for (const row of (data || []) as Array<{ event_type: string }>) {
    counts.set(row.event_type, (counts.get(row.event_type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([event_type, count]) => ({ event_type, count }))
    .sort((a, b) => b.count - a.count);
}
