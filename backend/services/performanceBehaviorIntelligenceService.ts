import { supabase } from '../db/supabaseClient';
import type { BehaviorReportData } from './performanceReportService';

export type BehaviorConfidence = 'none' | 'low' | 'medium' | 'high';
export type BehaviorSeverity = 'low' | 'medium' | 'high';

export type BehaviorDimensionInsight = {
  dimension: 'device' | 'source';
  key: string;
  sessions: number;
  engaged_sessions: number;
  engagement_rate: number;
  avg_engagement_seconds: number;
  conversions: number;
  conversion_rate: number;
  confidence: BehaviorConfidence;
  severity: BehaviorSeverity;
  confidence_label: 'observed' | 'likely' | 'directional';
  diagnosis: string;
};

export type LandingPageBehaviorInsight = {
  page_url: string;
  visits: number;
  events: number;
  conversions: number;
  engagement_rate: number;
  conversion_rate: number;
  prior_visits: number;
  prior_conversions: number;
  visit_delta_pct: number;
  conversion_delta_pct: number;
  confidence: BehaviorConfidence;
  severity: BehaviorSeverity;
  confidence_label: 'observed' | 'likely' | 'directional';
  diagnosis: string;
};

export type PerformanceBehaviorIntelligence = {
  engagement_confidence: BehaviorConfidence;
  traffic_quality_confidence: BehaviorConfidence;
  conversion_confidence: BehaviorConfidence;
  current: {
    sessions: number;
    engaged_sessions: number;
    engagement_rate: number;
    avg_engagement_seconds: number;
    conversions: number;
    conversion_rate: number;
  };
  prior: {
    sessions: number;
    engaged_sessions: number;
    engagement_rate: number;
    conversions: number;
    conversion_rate: number;
  };
  deltas: {
    sessions_pct: number;
    engagement_rate_pct: number;
    conversions_pct: number;
    conversion_rate_pct: number;
  };
  device_insights: BehaviorDimensionInsight[];
  source_insights: BehaviorDimensionInsight[];
  landing_page_insights: LandingPageBehaviorInsight[];
  summaries: {
    engagement_quality: string;
    traffic_quality: string;
    conversion_quality: string;
  };
};

type SessionRow = {
  source: string | null;
  source_medium: string | null;
  device: string | null;
  started_at: string | null;
  session_count: number | null;
  is_engaged: boolean | null;
  engagement_time_msec: number | null;
};

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString();
}

function safeDiv(num: number, den: number): number {
  return den > 0 ? num / den : 0;
}

function pctChange(previous: number, current: number): number {
  if (previous <= 0 && current <= 0) return 0;
  if (previous <= 0 && current > 0) return 1;
  return (current - previous) / previous;
}

function confidenceFromVolume(sessions: number, conversions = 0): BehaviorConfidence {
  if (sessions >= 250 && conversions >= 10) return 'high';
  if (sessions >= 75 && conversions >= 3) return 'medium';
  if (sessions >= 15) return 'low';
  return 'none';
}

function severityFromGap(value: number): BehaviorSeverity {
  if (value >= 0.5) return 'high';
  if (value >= 0.25) return 'medium';
  return 'low';
}

function confidenceLabel(confidence: BehaviorConfidence): 'observed' | 'likely' | 'directional' {
  if (confidence === 'high') return 'observed';
  if (confidence === 'medium') return 'likely';
  return 'directional';
}

function calibratedIssuePrefix(confidence: BehaviorConfidence): string {
  if (confidence === 'high') return 'Observed';
  if (confidence === 'medium') return 'Likely';
  return 'Directional signal:';
}

function aggregateSessions(rows: SessionRow[]): {
  sessions: number;
  engaged_sessions: number;
  engagement_rate: number;
  avg_engagement_seconds: number;
} {
  const sessions = rows.reduce((sum, row) => sum + Math.max(1, Number(row.session_count ?? 1)), 0);
  const engaged = rows.reduce((sum, row) => sum + (row.is_engaged ? Math.max(1, Number(row.session_count ?? 1)) : 0), 0);
  const engagementMs = rows.reduce((sum, row) => sum + Number(row.engagement_time_msec ?? 0), 0);
  return {
    sessions,
    engaged_sessions: engaged,
    engagement_rate: Number(safeDiv(engaged, sessions).toFixed(4)),
    avg_engagement_seconds: Number(safeDiv(engagementMs, sessions * 1000).toFixed(1)),
  };
}

async function loadSessions(companyId: string, fromIso: string): Promise<SessionRow[]> {
  const { data, error } = await supabase
    .from('canonical_sessions')
    .select('source, source_medium, device, started_at, session_count, is_engaged, engagement_time_msec')
    .eq('company_id', companyId)
    .gte('started_at', fromIso)
    .limit(20000);
  if (error) throw new Error(`Failed to load GA behavior sessions: ${error.message}`);
  return (data ?? []) as SessionRow[];
}

function groupByDimension(rows: SessionRow[], dimension: 'device' | 'source', conversionsBySource: Map<string, number>): BehaviorDimensionInsight[] {
  const groups = new Map<string, SessionRow[]>();
  for (const row of rows) {
    const key = dimension === 'device'
      ? (row.device || 'unknown')
      : [row.source || 'unknown', row.source_medium || 'unknown'].join(' / ');
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return Array.from(groups.entries()).map(([key, group]) => {
    const aggregate = aggregateSessions(group);
    const conversions = dimension === 'source' ? conversionsBySource.get(key) ?? 0 : 0;
    const conversionRate = Number(safeDiv(conversions, aggregate.sessions).toFixed(4));
    const engagementGap = Math.max(0, 0.45 - aggregate.engagement_rate);
    const conversionGap = conversions > 0 ? Math.max(0, 0.02 - conversionRate) : aggregate.sessions >= 25 ? 0.02 : 0;
    const confidence = confidenceFromVolume(aggregate.sessions, conversions);
    return {
      dimension,
      key,
      sessions: aggregate.sessions,
      engaged_sessions: aggregate.engaged_sessions,
      engagement_rate: aggregate.engagement_rate,
      avg_engagement_seconds: aggregate.avg_engagement_seconds,
      conversions,
      conversion_rate: conversionRate,
      confidence,
      severity: severityFromGap(engagementGap + conversionGap * 10),
      confidence_label: confidenceLabel(confidence),
      diagnosis: aggregate.engagement_rate < 0.35
        ? `${calibratedIssuePrefix(confidence)} weak engagement quality from ${key}.`
        : conversionRate < 0.01 && aggregate.sessions >= 25
          ? `${calibratedIssuePrefix(confidence)} traffic without enough conversion quality from ${key}.`
          : `${key} has measurable behavioral signal.`,
    };
  })
    .filter((item) => item.sessions >= 10)
    .sort((a, b) => {
      const severityRank = { high: 3, medium: 2, low: 1 };
      return severityRank[b.severity] - severityRank[a.severity] || b.sessions - a.sessions;
    })
    .slice(0, 8);
}

function buildLandingPageInsights(data: BehaviorReportData, priorData: BehaviorReportData): LandingPageBehaviorInsight[] {
  const priorByPage = new Map(priorData.top_pages.map((page) => [page.page_url, page]));
  return data.top_pages
    .map((page) => {
      const prior = priorByPage.get(page.page_url);
      const conversionRate = Number(safeDiv(page.conversions, page.visits).toFixed(4));
      const engagementRate = Number(safeDiv(page.events, page.visits).toFixed(2));
      const priorConversionRate = safeDiv(prior?.conversions ?? 0, prior?.visits ?? 0);
      const engagementGap = Math.max(0, 1 - engagementRate);
      const conversionGap = Math.max(0, 0.01 - conversionRate);
      return {
        page_url: page.page_url,
        visits: page.visits,
        events: page.events,
        conversions: page.conversions,
        engagement_rate: engagementRate,
        conversion_rate: conversionRate,
        prior_visits: prior?.visits ?? 0,
        prior_conversions: prior?.conversions ?? 0,
        visit_delta_pct: Number(pctChange(prior?.visits ?? 0, page.visits).toFixed(4)),
        conversion_delta_pct: Number(pctChange(prior?.conversions ?? 0, page.conversions).toFixed(4)),
        confidence: confidenceFromVolume(page.visits, page.conversions),
        severity: severityFromGap(engagementGap / 2 + conversionGap * 20 + Math.max(0, priorConversionRate - conversionRate)),
        confidence_label: confidenceLabel(confidenceFromVolume(page.visits, page.conversions)),
        diagnosis: page.visits >= 10 && conversionRate < 0.01
          ? `${calibratedIssuePrefix(confidenceFromVolume(page.visits, page.conversions))} landing-page conversion weakness on ${page.page_url}.`
          : engagementRate < 1
            ? `${calibratedIssuePrefix(confidenceFromVolume(page.visits, page.conversions))} weak engagement depth on ${page.page_url}.`
            : `${page.page_url} has usable landing-page signal.`,
      };
    })
    .filter((item) => item.visits >= 10)
    .filter((item) => item.confidence !== 'none')
    .filter((item) => item.confidence !== 'low' || item.severity === 'high')
    .sort((a, b) => {
      const severityRank = { high: 3, medium: 2, low: 1 };
      return severityRank[b.severity] - severityRank[a.severity] || b.visits - a.visits;
    })
    .slice(0, 10);
}

function summarizeEngagement(current: PerformanceBehaviorIntelligence['current']): string {
  if (current.sessions === 0) return 'GA engagement quality is not measurable yet.';
  if (current.engagement_rate < 0.35) return 'Engagement quality is weak: many sessions are arriving without meaningful interaction.';
  if (current.avg_engagement_seconds < 10) return 'Engagement time is shallow, so page relevance should be reviewed.';
  return 'Engagement quality is measurable and strong enough to support behavioral recommendations.';
}

export async function buildPerformanceBehaviorIntelligence(params: {
  companyId: string;
  currentData: BehaviorReportData;
  priorData?: BehaviorReportData;
  windowDays?: number;
}): Promise<PerformanceBehaviorIntelligence> {
  const windowDays = params.windowDays ?? 30;
  const currentStart = isoDaysAgo(windowDays);
  const priorStart = isoDaysAgo(windowDays * 2);
  const allSessions = await loadSessions(params.companyId, priorStart);
  const currentSessions = allSessions.filter((row) => String(row.started_at ?? '') >= currentStart);
  const priorSessions = allSessions.filter((row) => String(row.started_at ?? '') < currentStart);
  const currentAggregate = aggregateSessions(currentSessions);
  const priorAggregate = aggregateSessions(priorSessions);
  const currentConversions = params.currentData.conversions.total_conversions;
  const priorConversions = params.priorData?.conversions.total_conversions ?? 0;

  const conversionsBySource = new Map(
    params.currentData.traffic_sources.map((row) => [
      row.source_medium !== 'unknown' ? `${row.traffic_source} / ${row.source_medium}` : `${row.traffic_source} / unknown`,
      row.conversions,
    ]),
  );
  for (const row of params.currentData.traffic_sources) {
    conversionsBySource.set(`${row.traffic_source} / ${row.source_medium}`, row.conversions);
  }

  const current = {
    ...currentAggregate,
    conversions: currentConversions,
    conversion_rate: Number(safeDiv(currentConversions, currentAggregate.sessions).toFixed(4)),
  };
  const prior = {
    ...priorAggregate,
    conversions: priorConversions,
    conversion_rate: Number(safeDiv(priorConversions, priorAggregate.sessions).toFixed(4)),
  };

  return {
    engagement_confidence: confidenceFromVolume(current.sessions),
    traffic_quality_confidence: confidenceFromVolume(current.sessions, currentConversions),
    conversion_confidence: confidenceFromVolume(current.sessions, currentConversions),
    current,
    prior,
    deltas: {
      sessions_pct: Number(pctChange(prior.sessions, current.sessions).toFixed(4)),
      engagement_rate_pct: Number(pctChange(prior.engagement_rate, current.engagement_rate).toFixed(4)),
      conversions_pct: Number(pctChange(prior.conversions, current.conversions).toFixed(4)),
      conversion_rate_pct: Number(pctChange(prior.conversion_rate, current.conversion_rate).toFixed(4)),
    },
    device_insights: groupByDimension(currentSessions, 'device', conversionsBySource),
    source_insights: groupByDimension(currentSessions, 'source', conversionsBySource),
    landing_page_insights: buildLandingPageInsights(params.currentData, params.priorData ?? {
      traffic_sources: [],
      top_pages: [],
      session_metrics: { total_sessions: 0, avg_events_per_session: 0, conversion_rate: 0 },
      drop_off_pages: [],
      funnel: { steps: [], inferred_entry: false },
      conversions: { total_conversions: 0, by_type: [], conversion_rate_per_session: 0 },
      insights: [],
      recommendations: [],
    }),
    summaries: {
      engagement_quality: summarizeEngagement(current),
      traffic_quality: current.sessions >= 25 ? 'Traffic quality has enough volume for directional channel diagnostics.' : 'Traffic volume is low, so channel diagnostics are directional only.',
      conversion_quality: current.conversions > 0 ? 'Conversion quality is measurable.' : 'No conversions were detected in the current window, so conversion guidance is lower confidence.',
    },
  };
}
