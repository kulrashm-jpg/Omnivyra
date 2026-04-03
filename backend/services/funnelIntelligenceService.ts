import { supabase } from '../db/supabaseClient';
import {
  archiveDecisionSourceEntityType,
  createDecisionObjects,
  type PersistedDecisionObject,
} from './decisionObjectService';
import { assertBackgroundJobContext } from './intelligenceExecutionContext';
import { clamp, roundNumber, safeAverage } from './intelligenceEngineUtils';

type PageViewRow = {
  session_id: string;
  page_id: string;
  viewed_at: string;
  view_count: number | null;
};

type PageRow = {
  id: string;
  url: string;
  page_type: string;
  ctas: unknown[] | null;
  internal_link_count: number | null;
};

type PageStats = {
  page: PageRow;
  entryCount: number;
  exitCount: number;
  singlePageSessions: number;
  nextPageCount: number;
};

function recentSince(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function loadFunnelContext(companyId: string): Promise<{
  pageViews: PageViewRow[];
  pages: Map<string, PageRow>;
}> {
  const { data: pageViews, error: pageViewsError } = await supabase
    .from('canonical_page_views')
    .select('session_id, page_id, viewed_at, view_count')
    .eq('company_id', companyId)
    .gte('viewed_at', recentSince(30))
    .order('viewed_at', { ascending: true })
    .limit(1500);

  if (pageViewsError) {
    throw new Error(`Failed to load funnel page views for ${companyId}: ${pageViewsError.message}`);
  }

  const pageIds = [...new Set(((pageViews ?? []) as PageViewRow[]).map((row) => row.page_id).filter(Boolean))];
  if (pageIds.length === 0) {
    return { pageViews: [], pages: new Map() };
  }

  const { data: pages, error: pagesError } = await supabase
    .from('canonical_pages')
    .select('id, url, page_type, ctas, internal_link_count')
    .eq('company_id', companyId)
    .in('id', pageIds);

  if (pagesError) {
    throw new Error(`Failed to load funnel pages for ${companyId}: ${pagesError.message}`);
  }

  return {
    pageViews: (pageViews ?? []) as PageViewRow[],
    pages: new Map(((pages ?? []) as PageRow[]).map((row) => [row.id, row])),
  };
}

export async function generateFunnelIntelligenceDecisions(companyId: string): Promise<PersistedDecisionObject[]> {
  assertBackgroundJobContext('funnelIntelligenceService');

  const { pageViews, pages } = await loadFunnelContext(companyId);
  await archiveDecisionSourceEntityType({
    company_id: companyId,
    report_tier: 'deep',
    source_service: 'funnelIntelligenceService',
    entity_type: 'page',
    changed_by: 'system',
  });

  if (pageViews.length === 0) return [];

  const sessionPaths = new Map<string, string[]>();
  for (const view of pageViews) {
    const current = sessionPaths.get(view.session_id) ?? [];
    current.push(view.page_id);
    sessionPaths.set(view.session_id, current);
  }

  const statsByPageId = new Map<string, PageStats>();
  for (const rawPath of sessionPaths.values()) {
    const path = rawPath.filter(Boolean);
    if (path.length === 0) continue;

    const firstPageId = path[0];
    const lastPageId = path[path.length - 1];
    const firstPage = pages.get(firstPageId);
    const lastPage = pages.get(lastPageId);

    if (firstPage) {
      const current = statsByPageId.get(firstPageId) ?? {
        page: firstPage,
        entryCount: 0,
        exitCount: 0,
        singlePageSessions: 0,
        nextPageCount: 0,
      };
      current.entryCount += 1;
      if (path.length > 1) current.nextPageCount += 1;
      if (path.length === 1) current.singlePageSessions += 1;
      statsByPageId.set(firstPageId, current);
    }

    if (lastPage) {
      const current = statsByPageId.get(lastPageId) ?? {
        page: lastPage,
        entryCount: 0,
        exitCount: 0,
        singlePageSessions: 0,
        nextPageCount: 0,
      };
      current.exitCount += 1;
      statsByPageId.set(lastPageId, current);
    }
  }

  const decisions = [];
  for (const [pageId, stats] of statsByPageId.entries()) {
    const exitRate = safeAverage(stats.exitCount, Math.max(stats.entryCount, stats.exitCount));
    const singlePageRate = safeAverage(stats.singlePageSessions, Math.max(1, stats.entryCount));
    const ctaCount = Array.isArray(stats.page.ctas) ? stats.page.ctas.length : 0;
    const internalLinks = Number(stats.page.internal_link_count ?? 0);

    if (stats.entryCount >= 1 && singlePageRate >= 0.6) {
      decisions.push({
        company_id: companyId,
        report_tier: 'deep' as const,
        source_service: 'funnelIntelligenceService',
        entity_type: 'page' as const,
        entity_id: pageId,
        issue_type: 'high_dropoff_page',
        title: 'Page is losing sessions before the funnel starts',
        description: `${stats.page.url} is acting as an entry page, but users are dropping before progressing deeper into the site.`,
        evidence: {
          page_url: stats.page.url,
          page_type: stats.page.page_type,
          entry_sessions: stats.entryCount,
          single_page_sessions: stats.singlePageSessions,
          single_page_rate: roundNumber(singlePageRate),
          cta_count: ctaCount,
        },
        impact_traffic: clamp(38 + Math.round(singlePageRate * 35), 0, 100),
        impact_conversion: clamp(44 + Math.round(singlePageRate * 38), 0, 100),
        impact_revenue: clamp(36 + Math.round(singlePageRate * 34), 0, 100),
        priority_score: clamp(42 + Math.round(singlePageRate * 40), 0, 100),
        effort_score: 18,
        confidence_score: 0.82,
        recommendation: 'Strengthen the above-the-fold path so the landing page earns the next click instead of acting like an exit.',
        action_type: 'fix_cta',
        action_payload: {
          campaign_id: null,
          page_id: pageId,
          page_url: stats.page.url,
        },
        status: 'open' as const,
        last_changed_by: 'system' as const,
      });
    }

    if (stats.entryCount >= 1 && exitRate >= 0.6 && ctaCount === 0) {
      decisions.push({
        company_id: companyId,
        report_tier: 'deep' as const,
        source_service: 'funnelIntelligenceService',
        entity_type: 'page' as const,
        entity_id: pageId,
        issue_type: 'weak_conversion_path',
        title: 'Page path is not steering visitors toward conversion',
        description: `${stats.page.url} attracts traffic but gives too few directional cues to move users toward conversion pages.`,
        evidence: {
          page_url: stats.page.url,
          entry_sessions: stats.entryCount,
          exits: stats.exitCount,
          exit_rate: roundNumber(exitRate),
          cta_count: ctaCount,
          next_page_sessions: stats.nextPageCount,
        },
        impact_traffic: 24,
        impact_conversion: clamp(48 + Math.round(exitRate * 32), 0, 100),
        impact_revenue: clamp(42 + Math.round(exitRate * 30), 0, 100),
        priority_score: clamp(46 + Math.round(exitRate * 30), 0, 100),
        effort_score: 20,
        confidence_score: 0.79,
        recommendation: 'Add a clearer next-step path from this page into pricing, contact, or lead capture experiences.',
        action_type: 'fix_cta',
        action_payload: {
          campaign_id: null,
          page_id: pageId,
          page_url: stats.page.url,
        },
        status: 'open' as const,
        last_changed_by: 'system' as const,
      });
    }

    if (stats.exitCount >= 1 && internalLinks === 0 && ctaCount === 0) {
      decisions.push({
        company_id: companyId,
        report_tier: 'deep' as const,
        source_service: 'funnelIntelligenceService',
        entity_type: 'page' as const,
        entity_id: pageId,
        issue_type: 'dead_end_pages',
        title: 'Page is acting like a dead end',
        description: `${stats.page.url} has no internal routing or CTA support, so visits terminate there.`,
        evidence: {
          page_url: stats.page.url,
          exits: stats.exitCount,
          internal_link_count: internalLinks,
          cta_count: ctaCount,
        },
        impact_traffic: 18,
        impact_conversion: 54,
        impact_revenue: 46,
        priority_score: 49,
        effort_score: 16,
        confidence_score: 0.84,
        recommendation: 'Connect this page into the site graph with internal links or a conversion CTA so traffic does not stall.',
        action_type: 'improve_content',
        action_payload: {
          page_id: pageId,
          page_url: stats.page.url,
          optimization_focus: 'dead_end_page',
        },
        status: 'open' as const,
        last_changed_by: 'system' as const,
      });
    }
  }

  if (decisions.length === 0) return [];
  return createDecisionObjects(decisions);
}
