import { getTopPages, type TopPageRow } from './behaviorAnalyticsService';
import { buildGscSeoIntelligence, type GscSeoPageInsight } from './gscSeoIntelligenceService';

export type AnalyticsCorrelationInsight = {
  type:
    | 'discovery_without_engagement'
    | 'engagement_without_discovery'
    | 'ctr_without_conversion'
    | 'ranking_opportunity'
    | 'balanced_strength';
  page_url: string;
  title: string;
  evidence: {
    ga?: Pick<TopPageRow, 'visits' | 'events' | 'conversions'> & { engagement_per_visit: number; conversion_rate: number };
    gsc?: Pick<GscSeoPageInsight, 'impressions' | 'clicks' | 'ctr' | 'avg_position' | 'movement'>;
  };
  confidence: 'high' | 'medium' | 'low';
  opportunity_score: number;
  provenance: {
    ga: 'ga_canonical_ingestion' | 'missing';
    gsc: 'gsc_canonical_ingestion' | 'missing';
  };
};

export type AnalyticsCorrelationContext = {
  provenance: {
    ga: 'ga_canonical_ingestion' | 'missing';
    gsc: 'gsc_canonical_ingestion' | 'missing';
  };
  insights: AnalyticsCorrelationInsight[];
};

function normalizePageKey(input: string): string {
  try {
    const url = /^https?:\/\//i.test(input) ? new URL(input) : new URL(input, 'https://omnivyra.com');
    return (url.pathname.replace(/\/+$/, '') || '/').toLowerCase();
  } catch {
    return (input.replace(/^https?:\/\/[^/]+/i, '').replace(/[?#].*$/, '').replace(/\/+$/, '') || '/').toLowerCase();
  }
}

function confidenceFor(ga: TopPageRow | null, gsc: GscSeoPageInsight | null): 'high' | 'medium' | 'low' {
  const visits = ga?.visits ?? 0;
  const impressions = gsc?.impressions ?? 0;
  if (visits >= 100 && impressions >= 100) return 'high';
  if (visits >= 25 || impressions >= 50) return 'medium';
  return 'low';
}

function score(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export async function buildAnalyticsCorrelationContext(companyId: string): Promise<AnalyticsCorrelationContext> {
  const [gaPages, gsc] = await Promise.all([
    getTopPages(companyId, { sinceDays: 30 }).catch(() => []),
    buildGscSeoIntelligence(companyId, 30).catch(() => null),
  ]);

  const gaByPage = new Map<string, TopPageRow>(
    gaPages.map((page): [string, TopPageRow] => [normalizePageKey(page.page_url), page]),
  );
  const gscByPage = new Map<string, GscSeoPageInsight>(
    (gsc?.top_pages ?? []).map((page): [string, GscSeoPageInsight] => [normalizePageKey(page.page_url), page]),
  );
  const pageKeys = new Set([...gaByPage.keys(), ...gscByPage.keys()]);
  const insights: AnalyticsCorrelationInsight[] = [];

  for (const pageKey of pageKeys) {
    const ga = gaByPage.get(pageKey) ?? null;
    const search = gscByPage.get(pageKey) ?? null;
    const visits = ga?.visits ?? 0;
    const events = ga?.events ?? 0;
    const conversions = ga?.conversions ?? 0;
    const engagementPerVisit = visits > 0 ? events / visits : 0;
    const conversionRate = visits > 0 ? conversions / visits : 0;
    const impressions = search?.impressions ?? 0;
    const ctr = search?.ctr ?? 0;
    const pageUrl = search?.page_url || ga?.page_url || pageKey;
    const baseEvidence = {
      ga: ga ? { visits, events, conversions, engagement_per_visit: Number(engagementPerVisit.toFixed(2)), conversion_rate: Number(conversionRate.toFixed(4)) } : undefined,
      gsc: search ? {
        impressions: search.impressions,
        clicks: search.clicks,
        ctr: search.ctr,
        avg_position: search.avg_position,
        movement: search.movement,
      } : undefined,
    };

    if (impressions >= 50 && engagementPerVisit < 1) {
      insights.push({
        type: 'discovery_without_engagement',
        page_url: pageUrl,
        title: 'Search discovery is not translating into engagement',
        evidence: baseEvidence,
        confidence: confidenceFor(ga, search),
        opportunity_score: score(Math.log10(impressions + 1) * 25 + Math.max(0, 1 - engagementPerVisit) * 35),
        provenance: { ga: ga ? 'ga_canonical_ingestion' : 'missing', gsc: search ? 'gsc_canonical_ingestion' : 'missing' },
      });
    } else if (visits >= 50 && impressions < 20) {
      insights.push({
        type: 'engagement_without_discovery',
        page_url: pageUrl,
        title: 'Behavioral demand exists but search discovery is weak',
        evidence: baseEvidence,
        confidence: confidenceFor(ga, search),
        opportunity_score: score(Math.log10(visits + 1) * 25 + Math.max(0, 20 - impressions)),
        provenance: { ga: ga ? 'ga_canonical_ingestion' : 'missing', gsc: search ? 'gsc_canonical_ingestion' : 'missing' },
      });
    } else if (ctr >= 0.03 && visits >= 10 && conversionRate < 0.01) {
      insights.push({
        type: 'ctr_without_conversion',
        page_url: pageUrl,
        title: 'Search clicks are not turning into conversions',
        evidence: baseEvidence,
        confidence: confidenceFor(ga, search),
        opportunity_score: score(ctr * 800 + Math.log10(visits + 1) * 15),
        provenance: { ga: ga ? 'ga_canonical_ingestion' : 'missing', gsc: search ? 'gsc_canonical_ingestion' : 'missing' },
      });
    } else if (search && search.avg_position >= 4 && search.avg_position <= 20) {
      insights.push({
        type: 'ranking_opportunity',
        page_url: pageUrl,
        title: 'Page is near a ranking improvement threshold',
        evidence: baseEvidence,
        confidence: confidenceFor(ga, search),
        opportunity_score: search.opportunity_score,
        provenance: { ga: ga ? 'ga_canonical_ingestion' : 'missing', gsc: 'gsc_canonical_ingestion' },
      });
    } else if (visits >= 50 && impressions >= 50 && engagementPerVisit >= 1) {
      insights.push({
        type: 'balanced_strength',
        page_url: pageUrl,
        title: 'Search visibility and engagement are both present',
        evidence: baseEvidence,
        confidence: confidenceFor(ga, search),
        opportunity_score: score(Math.log10(visits + impressions + 1) * 20),
        provenance: { ga: 'ga_canonical_ingestion', gsc: 'gsc_canonical_ingestion' },
      });
    }
  }

  return {
    provenance: {
      ga: gaPages.length > 0 ? 'ga_canonical_ingestion' : 'missing',
      gsc: gsc ? 'gsc_canonical_ingestion' : 'missing',
    },
    insights: insights.sort((a, b) => b.opportunity_score - a.opportunity_score).slice(0, 12),
  };
}
