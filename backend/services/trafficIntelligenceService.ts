import { supabase } from '../db/supabaseClient';
import {
  archiveDecisionSourceEntityType,
  createDecisionObjects,
  type PersistedDecisionObject,
} from './decisionObjectService';
import { assertBackgroundJobContext } from './intelligenceExecutionContext';
import { clamp, normalizeText } from './intelligenceEngineUtils';

type SessionRow = {
  id: string;
  company_id: string;
  source: string;
  device: string;
  started_at: string;
  source_medium: string | null;
  source_campaign: string | null;
  geo_country: string | null;
  geo_region: string | null;
  geo_city: string | null;
  engagement_time_msec: number | null;
  is_engaged: boolean;
  page_view_count: number | null;
};

type PageViewRow = {
  session_id: string;
  page_id: string;
  viewed_at: string;
  engagement_time_msec: number | null;
  view_count: number | null;
};

type PageRow = {
  id: string;
  url: string;
  page_type: string;
  ctas: unknown[] | null;
  internal_link_count: number | null;
};

function recentSince(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function loadTrafficContext(companyId: string): Promise<{
  sessions: SessionRow[];
  pageViews: PageViewRow[];
  pages: Map<string, PageRow>;
}> {
  const { data: sessions, error: sessionsError } = await supabase
    .from('canonical_sessions')
    .select('id, company_id, source, device, started_at, source_medium, source_campaign, geo_country, geo_region, geo_city, engagement_time_msec, is_engaged, page_view_count')
    .eq('company_id', companyId)
    .gte('started_at', recentSince(30))
    .order('started_at', { ascending: false })
    .limit(500);

  if (sessionsError) {
    throw new Error(`Failed to load traffic sessions for ${companyId}: ${sessionsError.message}`);
  }

  const sessionRows = (sessions ?? []) as SessionRow[];
  if (sessionRows.length === 0) {
    return { sessions: [], pageViews: [], pages: new Map() };
  }

  const sessionIds = sessionRows.map((row) => row.id);
  const { data: pageViews, error: pageViewsError } = await supabase
    .from('canonical_page_views')
    .select('session_id, page_id, viewed_at, engagement_time_msec, view_count')
    .eq('company_id', companyId)
    .in('session_id', sessionIds)
    .order('viewed_at', { ascending: true });

  if (pageViewsError) {
    throw new Error(`Failed to load traffic page views for ${companyId}: ${pageViewsError.message}`);
  }

  const pageIds = [...new Set(((pageViews ?? []) as PageViewRow[]).map((row) => row.page_id).filter(Boolean))];
  if (pageIds.length === 0) {
    return { sessions: sessionRows, pageViews: (pageViews ?? []) as PageViewRow[], pages: new Map() };
  }

  const { data: pages, error: pagesError } = await supabase
    .from('canonical_pages')
    .select('id, url, page_type, ctas, internal_link_count')
    .eq('company_id', companyId)
    .in('id', pageIds);

  if (pagesError) {
    throw new Error(`Failed to load traffic pages for ${companyId}: ${pagesError.message}`);
  }

  return {
    sessions: sessionRows,
    pageViews: (pageViews ?? []) as PageViewRow[],
    pages: new Map(((pages ?? []) as PageRow[]).map((row) => [row.id, row])),
  };
}

function inferTargetGeo(sessions: SessionRow[]): string | null {
  const counts = new Map<string, number>();
  let total = 0;
  for (const session of sessions) {
    if (!session.geo_country) continue;
    if (!session.is_engaged && Number(session.page_view_count ?? 0) <= 1) continue;
    const key = session.geo_country.trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total += 1;
  }

  if (total < 2 || counts.size === 0) return null;
  const winner = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return winner && winner[1] / total >= 0.5 ? winner[0] : null;
}

function scoreTrafficQuality(session: SessionRow, views: PageViewRow[]): number {
  const viewCount = Math.max(Number(session.page_view_count ?? views.length ?? 0), views.length);
  const engagementMs =
    Number(session.engagement_time_msec ?? 0) ||
    views.reduce((sum, view) => sum + Number(view.engagement_time_msec ?? 0), 0);
  let score = 10;
  if (session.is_engaged) score += 35;
  score += clamp(viewCount * 14, 0, 30);
  score += clamp(Math.round(engagementMs / 1500), 0, 25);
  if (normalizeText(session.source) === 'paid' && viewCount <= 1 && !session.is_engaged) score -= 10;
  return clamp(score, 0, 100);
}

export async function generateTrafficIntelligenceDecisions(companyId: string): Promise<PersistedDecisionObject[]> {
  assertBackgroundJobContext('trafficIntelligenceService');

  const { sessions, pageViews, pages } = await loadTrafficContext(companyId);
  await archiveDecisionSourceEntityType({
    company_id: companyId,
    report_tier: 'growth',
    source_service: 'trafficIntelligenceService',
    entity_type: 'session',
    changed_by: 'system',
  });

  if (sessions.length === 0) return [];

  const viewsBySessionId = new Map<string, PageViewRow[]>();
  for (const view of pageViews) {
    const current = viewsBySessionId.get(view.session_id) ?? [];
    current.push(view);
    viewsBySessionId.set(view.session_id, current);
  }

  const targetGeo = inferTargetGeo(sessions);
  const decisions = [];

  for (const session of sessions) {
    const views = viewsBySessionId.get(session.id) ?? [];
    const firstPage = views.length > 0 ? pages.get(views[0].page_id) ?? null : null;
    const trafficQuality = scoreTrafficQuality(session, views);
    const ctaCount = Array.isArray(firstPage?.ctas) ? firstPage!.ctas.length : 0;
    const source = normalizeText(session.source) || 'unknown';

    if (trafficQuality < 45) {
      decisions.push({
        company_id: companyId,
        report_tier: 'growth' as const,
        source_service: 'trafficIntelligenceService',
        entity_type: 'session' as const,
        entity_id: session.id,
        issue_type: 'low_quality_traffic',
        title: 'Session quality is below viable threshold',
        description: `Traffic from ${source} is arriving with weak engagement and shallow browsing depth.`,
        evidence: {
          session_id: session.id,
          source,
          traffic_quality_score: trafficQuality,
          is_engaged: session.is_engaged,
          page_view_count: Number(session.page_view_count ?? views.length),
          engagement_time_msec: Number(session.engagement_time_msec ?? 0),
          landing_page_url: firstPage?.url ?? null,
        },
        impact_traffic: clamp(52 + Math.round((45 - trafficQuality) * 0.8), 0, 100),
        impact_conversion: clamp(56 + Math.round((45 - trafficQuality) * 0.9), 0, 100),
        impact_revenue: clamp(48 + Math.round((45 - trafficQuality) * 0.7), 0, 100),
        priority_score: clamp(54 + Math.round((45 - trafficQuality) * 0.85), 0, 100),
        effort_score: 18,
        confidence_score: 0.83,
        recommendation: 'Tighten landing-page relevance and acquisition targeting so low-intent sessions stop diluting the funnel.',
        action_type: 'improve_content',
        action_payload: {
          session_id: session.id,
          optimization_focus: 'traffic_quality',
        },
        status: 'open' as const,
        last_changed_by: 'system' as const,
      });
    }

    if (
      targetGeo &&
      session.geo_country &&
      session.geo_country !== targetGeo &&
      !session.is_engaged &&
      ['paid', 'social', 'direct'].includes(source)
    ) {
      decisions.push({
        company_id: companyId,
        report_tier: 'growth' as const,
        source_service: 'trafficIntelligenceService',
        entity_type: 'session' as const,
        entity_id: session.id,
        issue_type: 'wrong_geo_traffic',
        title: 'Traffic is arriving from a low-fit geography',
        description: `Session geography ${session.geo_country} is outside the dominant engaged geo mix of ${targetGeo}.`,
        evidence: {
          session_id: session.id,
          source,
          geo_country: session.geo_country,
          target_geo_country: targetGeo,
          is_engaged: session.is_engaged,
          page_view_count: Number(session.page_view_count ?? views.length),
        },
        impact_traffic: 34,
        impact_conversion: 58,
        impact_revenue: 54,
        priority_score: 52,
        effort_score: 22,
        confidence_score: 0.74,
        recommendation: 'Constrain targeting and geo routing so spend is concentrated in regions that actually engage.',
        action_type: 'improve_content',
        action_payload: {
          session_id: session.id,
          optimization_focus: 'geo_targeting',
        },
        status: 'open' as const,
        last_changed_by: 'system' as const,
      });
    }

    const landingUrl = firstPage?.url ?? '';
    const isNonCommercialLanding =
      /\/downloads?(\/|$)|\/docs?(\/|$)|\/blog(\/|$)/i.test(landingUrl) ||
      ['blog', 'docs', 'other'].includes(firstPage?.page_type ?? '');

    if (
      firstPage &&
      source === 'paid' &&
      (
        (Number(session.page_view_count ?? views.length) <= 1 && ctaCount === 0) ||
        isNonCommercialLanding
      )
    ) {
      decisions.push({
        company_id: companyId,
        report_tier: 'growth' as const,
        source_service: 'trafficIntelligenceService',
        entity_type: 'session' as const,
        entity_id: session.id,
        issue_type: 'channel_mismatch',
        title: 'Acquisition channel is misaligned with the landing experience',
        description: `Paid traffic is landing on ${firstPage.url} without enough conversion guidance to justify the acquisition cost.`,
        evidence: {
          session_id: session.id,
          source,
          source_medium: session.source_medium,
          landing_page_url: firstPage.url,
          landing_page_type: firstPage.page_type,
          landing_page_cta_count: ctaCount,
          traffic_quality_score: trafficQuality,
        },
        impact_traffic: 26,
        impact_conversion: 66,
        impact_revenue: 62,
        priority_score: 63,
        effort_score: 20,
        confidence_score: 0.81,
        recommendation: 'Route paid traffic into pages with explicit CTA coverage and stronger offer alignment.',
        action_type: 'improve_content',
        action_payload: {
          session_id: session.id,
          landing_page_url: firstPage.url,
          optimization_focus: 'channel_alignment',
        },
        status: 'open' as const,
        last_changed_by: 'system' as const,
      });
    }
  }

  if (decisions.length === 0) return [];
  return createDecisionObjects(decisions);
}
