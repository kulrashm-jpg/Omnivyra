import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getGoogleAnalyticsStatusPayload } from '../../../backend/services/googleAnalyticsExperienceService';
import {
  normalizeWebsiteDomain,
  resolveOmnivyraCompanyName,
  resolveOmnivyraWebsiteCompany,
  resolveOmnivyraWebsiteUrl,
} from '../../../backend/services/omnivyraWebsiteCompanyService';
import { requireSuperAdminGaAccess } from '../../../backend/services/superAdminGaAccess';

async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await build(from, to);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
  }

  return rows;
}

function aggregatedCount(metadata: Record<string, unknown> | null | undefined): number {
  const parsed = Number.parseInt(String(metadata?.aggregated_event_count ?? '1'), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      status: 'error',
      code: 'GA_METHOD_NOT_ALLOWED',
      message: 'Method not allowed',
    });
  }

  const access = await requireSuperAdminGaAccess(req, res);
  if (!access) return;

  try {
    const company = await resolveOmnivyraWebsiteCompany();

    if (!company) {
      return res.status(404).json({
        status: 'error',
        code: 'OMNIVYRA_WEBSITE_COMPANY_NOT_FOUND',
        message: 'No Omnivyra website company is configured.',
      });
    }

    const companyId = company.id;
    const windowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const websiteHost = normalizeWebsiteDomain(resolveOmnivyraWebsiteUrl(company) || company.website_domain || 'omnivyra.com') || 'omnivyra.com';

    const { data: domainRows, error: domainError } = await supabase
      .from('canonical_domains')
      .select('id, primary_domain')
      .eq('company_id', companyId);

    if (domainError) {
      throw new Error(`FAILED_TO_LOAD_CANONICAL_DOMAINS: ${domainError.message}`);
    }

    const matchingDomainIds = (domainRows ?? [])
      .filter((row: any) => normalizeWebsiteDomain(row?.primary_domain) === websiteHost)
      .map((row: any) => String(row.id));

    const [
      gaStatus,
      sessionRows,
      pageViewRows,
      eventRows,
      conversionRows,
    ] = await Promise.all([
      getGoogleAnalyticsStatusPayload(companyId).catch((error) => ({
        connected: false,
        status: 'error',
        message: error instanceof Error ? error.message : 'Failed to load Google Analytics status',
        property: null,
        last_sync: null,
        events_last_30_days: 0,
        properties: [],
        reconnect_required: false,
        degraded: true,
        status_error: error instanceof Error ? error.message : String(error),
      })),
      matchingDomainIds.length > 0
        ? fetchAllRows<{
            id: string;
            external_session_id: string | null;
            source: string | null;
            source_medium: string | null;
            session_count: number | null;
            page_view_count: number | null;
            is_engaged: boolean | null;
            engagement_time_msec: number | null;
          }>((from, to) =>
            supabase
              .from('canonical_sessions')
              .select('id, external_session_id, source, source_medium, session_count, page_view_count, is_engaged, engagement_time_msec')
              .eq('company_id', companyId)
              .in('domain_id', matchingDomainIds)
              .gte('started_at', windowStart)
              .range(from, to),
          )
        : Promise.resolve([] as Array<{
            id: string;
            external_session_id: string | null;
            source: string | null;
            source_medium: string | null;
            session_count: number | null;
            page_view_count: number | null;
            is_engaged: boolean | null;
            engagement_time_msec: number | null;
          }>),
      fetchAllRows<{ page_url: string | null; view_count: number | null }>((from, to) =>
        supabase
          .from('canonical_page_views')
          .select('page_url, view_count')
          .eq('company_id', companyId)
          .gte('viewed_at', windowStart)
          .range(from, to),
      ),
      fetchAllRows<{ session_id: string; event_category: string; metadata: Record<string, unknown> | null; page_url: string | null }>((from, to) =>
        supabase
          .from('canonical_events')
          .select('session_id, event_category, metadata, page_url')
          .eq('company_id', companyId)
          .gte('event_timestamp', windowStart)
          .range(from, to),
      ),
      fetchAllRows<{ conversion_name: string; session_id: string; metadata: Record<string, unknown> | null; page_url: string | null }>((from, to) =>
        supabase
          .from('canonical_conversions')
          .select('conversion_name, session_id, metadata, page_url')
          .eq('company_id', companyId)
          .gte('conversion_timestamp', windowStart)
          .range(from, to),
      ),
    ]);

    const filteredPageViews = pageViewRows.filter((row) => normalizeWebsiteDomain(row.page_url) === websiteHost);
    const filteredEvents = eventRows.filter((row) => normalizeWebsiteDomain(row.page_url) === websiteHost);
    const filteredConversions = conversionRows.filter((row) => normalizeWebsiteDomain(row.page_url) === websiteHost);

    const sessionCountFor = (row: { session_count: number | null }) =>
      Math.max(1, Number(row.session_count ?? 1));
    const engagedSessions = sessionRows.reduce(
      (sum, row) => sum + (row.is_engaged ? sessionCountFor(row) : 0),
      0,
    );
    const totalPageViews = filteredPageViews.reduce((sum, row) => sum + Math.max(0, Number(row.view_count ?? 0)), 0);
    const totalEngagementTimeSeconds = sessionRows.reduce(
      (sum, row) => sum + Math.max(0, Number(row.engagement_time_msec ?? 0)) / 1000,
      0,
    );
    const eventsBySession = new Map<string, number>();
    const trafficSourceAgg = new Map<string, { sessionIds: Set<string>; sessions: number; events: number; conversions: number }>();
    const topPageAgg = new Map<string, { visits: number; events: number; conversions: number }>();
    const conversionAgg = new Map<string, number>();
    const conversionSessions = new Set<string>();

    for (const row of sessionRows) {
      const trafficSource = String(row.source ?? 'unknown').trim() || 'unknown';
      const sourceMedium = String(row.source_medium ?? 'unknown').trim() || 'unknown';
      const trafficKey = `${trafficSource}|${sourceMedium}`;
      const trafficBucket = trafficSourceAgg.get(trafficKey) ?? {
        sessionIds: new Set<string>(),
        sessions: 0,
        events: 0,
        conversions: 0,
      };
      trafficBucket.sessionIds.add(String(row.external_session_id || row.id));
      trafficBucket.sessions += sessionCountFor(row);
      trafficSourceAgg.set(trafficKey, trafficBucket);
    }

    for (const row of filteredEvents) {
      const count = aggregatedCount(row.metadata);
      eventsBySession.set(row.session_id, (eventsBySession.get(row.session_id) ?? 0) + count);

      const trafficSource = String(row.metadata?.traffic_source ?? 'unknown').trim() || 'unknown';
      const sourceMedium = String(row.metadata?.source_medium ?? 'unknown').trim() || 'unknown';
      const trafficKey = `${trafficSource}|${sourceMedium}`;
      const trafficBucket = trafficSourceAgg.get(trafficKey) ?? {
        sessionIds: new Set<string>(),
        sessions: 0,
        events: 0,
        conversions: 0,
      };
      trafficBucket.sessionIds.add(row.session_id);
      trafficBucket.events += count;
      if (row.event_category === 'conversion') {
        trafficBucket.conversions += count;
      }
      trafficSourceAgg.set(trafficKey, trafficBucket);

      const pageUrl = String(row.page_url || '').trim();
      if (pageUrl) {
        const pageBucket = topPageAgg.get(pageUrl) ?? { visits: 0, events: 0, conversions: 0 };
        pageBucket.events += count;
        if (row.event_category === 'conversion') {
          pageBucket.conversions += count;
        }
        topPageAgg.set(pageUrl, pageBucket);
      }
    }

    for (const row of filteredPageViews) {
      const pageUrl = String(row.page_url || '').trim();
      if (!pageUrl) continue;
      const pageBucket = topPageAgg.get(pageUrl) ?? { visits: 0, events: 0, conversions: 0 };
      pageBucket.visits += Math.max(1, Number(row.view_count ?? 1));
      topPageAgg.set(pageUrl, pageBucket);
    }

    for (const row of filteredConversions) {
      const count = aggregatedCount(row.metadata);
      conversionAgg.set(row.conversion_name, (conversionAgg.get(row.conversion_name) ?? 0) + count);
      conversionSessions.add(row.session_id);
    }

    const totalEvents = Array.from(eventsBySession.values()).reduce((sum, count) => sum + count, 0);
    const trafficSources = Array.from(trafficSourceAgg.entries())
      .map(([key, value]) => {
        const [traffic_source, source_medium] = key.split('|');
        return {
          traffic_source,
          source_medium,
          sessions: value.sessions > 0 ? value.sessions : value.sessionIds.size,
          events: value.events,
          conversions: value.conversions,
        };
      })
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 50);
    const topPages = Array.from(topPageAgg.entries())
      .map(([page_url, value]) => ({
        page_url,
        visits: value.visits,
        events: value.events,
        conversions: value.conversions,
      }))
      .sort((a, b) => b.visits - a.visits)
      .slice(0, 20);
    const conversions = Array.from(conversionAgg.entries())
      .map(([conversion_name, count]) => ({ conversion_name, count }))
      .sort((a, b) => b.count - a.count);
    const totalSessions = sessionRows.reduce((sum, row) => sum + sessionCountFor(row), 0);
    const totalConversions = conversions.reduce((sum, row) => sum + row.count, 0);

    return res.status(200).json({
      company_id: companyId,
      company_name: resolveOmnivyraCompanyName(company),
      website: resolveOmnivyraWebsiteUrl(company),
      ga_status: {
        connected: gaStatus.connected,
        status: gaStatus.status,
        message: gaStatus.message,
        last_sync: gaStatus.last_sync,
        events_last_30_days: gaStatus.events_last_30_days,
        reconnect_required: gaStatus.reconnect_required,
        property: gaStatus.property,
        properties: gaStatus.properties || [],
        degraded: Boolean((gaStatus as any).degraded) || gaStatus.status !== 'ready',
        status_error: (gaStatus as any).status_error ?? null,
        provider_readiness: (gaStatus as any).provider_readiness ?? null,
        search_console: (gaStatus as any).search_console ?? null,
      },
      overview: {
        total_sessions: totalSessions,
        engaged_sessions: engagedSessions,
        engagement_rate: totalSessions > 0 ? engagedSessions / totalSessions : 0,
        total_page_views: totalPageViews,
        avg_events_per_session: totalSessions > 0 ? Number((totalEvents / totalSessions).toFixed(2)) : 0,
        total_conversions: totalConversions,
        conversion_rate: totalSessions > 0 ? Number((conversionSessions.size / totalSessions).toFixed(4)) : 0,
        avg_engagement_time_seconds:
          totalSessions > 0 ? totalEngagementTimeSeconds / totalSessions : 0,
      },
      traffic_sources: trafficSources,
      top_pages: topPages,
      conversions,
    });
  } catch (error: any) {
    return res.status(500).json({
      status: 'error',
      code: 'GA_ANALYTICS_LOAD_FAILED',
      message: error?.message || 'Failed to load Google Analytics summary',
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/ga-analytics-summary' });
