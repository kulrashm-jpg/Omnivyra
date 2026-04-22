import type {
  ConversionSummary,
  DropOffPageRow,
  FunnelResult,
  TopPageRow,
  TrafficSourceRow,
} from './behaviorAnalyticsService';
import type {
  EngagementSignalsDashboardData,
  EngagementTopPost,
  EngagementTrendPoint,
} from './engagementSignalIntelligenceService';

export interface BehaviorInsightReportData {
  traffic_sources: TrafficSourceRow[];
  top_pages: TopPageRow[];
  drop_off_pages: DropOffPageRow[];
  funnel: FunnelResult;
  conversions: ConversionSummary;
}

export type BehaviorInsightType =
  | 'drop_off'
  | 'funnel'
  | 'traffic_quality'
  | 'page_performance'
  | 'engagement_signal';

export type BehaviorInsightSeverity = 'high' | 'medium' | 'low';
export type BehaviorInsightSourceLayer = 'canonical_analytics' | 'engagement_signal';
export type BehaviorInsightConfidence = 'high' | 'medium' | 'low_confidence';

export interface BehaviorInsight {
  type: BehaviorInsightType;
  severity: BehaviorInsightSeverity;
  message: string;
  metric: number;
  source_layer?: BehaviorInsightSourceLayer;
  confidence?: BehaviorInsightConfidence;
  context?: Record<string, string | number | null>;
}

export interface EngagementInsightReportData {
  engagement_signals: EngagementSignalsDashboardData;
}

const DROP_OFF_RATE_THRESHOLD = 0.5;
const DROP_OFF_ENTRY_THRESHOLD = 10;
const FUNNEL_ENGAGEMENT_DROP_THRESHOLD = 0.4;
const FUNNEL_CONVERSION_DROP_THRESHOLD = 0.7;
const TRAFFIC_SESSION_THRESHOLD = 20;
const TRAFFIC_LOW_CONVERSION_RATE = 0.02;
const PAGE_VISIT_THRESHOLD = 20;
const PAGE_LOW_ENGAGEMENT_RATE = 0.5;
const PAGE_HIGH_ENGAGEMENT_RATE = 1.5;

function severityRank(severity: BehaviorInsightSeverity): number {
  if (severity === 'high') return 3;
  if (severity === 'medium') return 2;
  return 1;
}

function computeImpactScore(insight: BehaviorInsight): number {
  const metricWeight = Math.max(0, insight.metric);
  const contextWeight = Math.max(
    Number(insight.context?.entry_sessions ?? 0),
    Number(insight.context?.sessions ?? 0),
    Number(insight.context?.visits ?? 0),
    Number(insight.context?.users ?? 0),
  );

  return severityRank(insight.severity) * 100000 + metricWeight * 1000 + contextWeight;
}

function normalizePageLabel(pageUrl: string): string {
  return pageUrl.length > 120 ? `${pageUrl.slice(0, 117)}...` : pageUrl;
}

function buildCanonicalInsight(insight: Omit<BehaviorInsight, 'source_layer' | 'confidence'>): BehaviorInsight {
  return {
    ...insight,
    source_layer: 'canonical_analytics',
    confidence: 'high',
  };
}

function computeTrendDelta(current: number, previous: number): number {
  if (previous <= 0) return current > 0 ? 1 : 0;
  return (current - previous) / previous;
}

function sumTrend(points: EngagementTrendPoint[]): number {
  return points.reduce((total, point) => total + point.total_engagement, 0);
}

function topPostInsight(post: EngagementTopPost): BehaviorInsight {
  return {
    type: 'engagement_signal',
    severity: 'medium',
    source_layer: 'engagement_signal',
    confidence: 'high',
    message: `Top social post is driving strong engagement on ${post.platform}`,
    metric: post.engagement_total,
    context: {
      content_id: post.content_id,
      campaign_id: post.campaign_id,
      platform: post.platform,
      post_title: post.title,
      engagement_total: post.engagement_total,
      clicks: post.clicks,
      impressions: post.impressions,
      label: 'Social Engagement (Not Traffic Data)',
    },
  };
}

export function generateBehaviorInsights(reportData: BehaviorInsightReportData): BehaviorInsight[] {
  const insights: BehaviorInsight[] = [];

  for (const page of reportData.drop_off_pages) {
    if (page.drop_off_rate > DROP_OFF_RATE_THRESHOLD && page.entry_sessions > DROP_OFF_ENTRY_THRESHOLD) {
      insights.push(buildCanonicalInsight({
        type: 'drop_off',
        severity: 'high',
        message: `High drop-off detected on ${normalizePageLabel(page.page_url)}`,
        metric: Number(page.drop_off_rate.toFixed(4)),
        context: {
          page_url: page.page_url,
          entry_sessions: page.entry_sessions,
          exit_sessions: page.exit_sessions,
        },
      }));
    }
  }

  const sessionStartStep = reportData.funnel.steps.find((step) => step.step === 'session_start');
  const engagementStep = reportData.funnel.steps.find((step) => step.step === 'engagement');
  const conversionStep = reportData.funnel.steps.find((step) => step.step === 'conversion');

  if (engagementStep && engagementStep.drop_pct > FUNNEL_ENGAGEMENT_DROP_THRESHOLD) {
    insights.push(buildCanonicalInsight({
      type: 'funnel',
      severity: 'high',
      message: 'Users are not engaging after landing',
      metric: Number(engagementStep.drop_pct.toFixed(4)),
      context: {
        from_step: sessionStartStep?.step ?? 'session_start',
        to_step: engagementStep.step,
        users: engagementStep.users,
      },
    }));
  }

  if (conversionStep && conversionStep.drop_pct > FUNNEL_CONVERSION_DROP_THRESHOLD) {
    insights.push(buildCanonicalInsight({
      type: 'funnel',
      severity: 'high',
      message: 'Low conversion efficiency after engagement',
      metric: Number(conversionStep.drop_pct.toFixed(4)),
      context: {
        from_step: engagementStep?.step ?? 'engagement',
        to_step: conversionStep.step,
        users: conversionStep.users,
      },
    }));
  }

  for (const source of reportData.traffic_sources) {
    const conversionRate = source.sessions > 0 ? source.conversions / source.sessions : 0;
    if (source.sessions >= TRAFFIC_SESSION_THRESHOLD && conversionRate < TRAFFIC_LOW_CONVERSION_RATE) {
      const sourceLabel = source.source_medium !== 'unknown'
        ? `${source.traffic_source} / ${source.source_medium}`
        : source.traffic_source;

      insights.push(buildCanonicalInsight({
        type: 'traffic_quality',
        severity: 'medium',
        message: `Traffic from ${sourceLabel} is not converting`,
        metric: Number(conversionRate.toFixed(4)),
        context: {
          traffic_source: source.traffic_source,
          source_medium: source.source_medium,
          sessions: source.sessions,
          conversions: source.conversions,
        },
      }));
    }
  }

  for (const page of reportData.top_pages) {
    const engagementRate = page.visits > 0 ? page.events / page.visits : 0;

    if (page.visits >= PAGE_VISIT_THRESHOLD && engagementRate < PAGE_LOW_ENGAGEMENT_RATE) {
      insights.push(buildCanonicalInsight({
        type: 'page_performance',
        severity: 'medium',
        message: `Page has traffic but low engagement: ${normalizePageLabel(page.page_url)}`,
        metric: Number(engagementRate.toFixed(4)),
        context: {
          page_url: page.page_url,
          visits: page.visits,
          events: page.events,
        },
      }));
    }

    if (page.visits >= PAGE_VISIT_THRESHOLD && engagementRate >= PAGE_HIGH_ENGAGEMENT_RATE && page.conversions === 0) {
      insights.push(buildCanonicalInsight({
        type: 'page_performance',
        severity: 'medium',
        message: `Page engages users but fails to convert: ${normalizePageLabel(page.page_url)}`,
        metric: Number(engagementRate.toFixed(4)),
        context: {
          page_url: page.page_url,
          visits: page.visits,
          events: page.events,
          conversions: page.conversions,
        },
      }));
    }
  }

  return insights.sort((a, b) => computeImpactScore(b) - computeImpactScore(a));
}

export function generateEngagementSignalInsights(
  reportData: EngagementInsightReportData,
): BehaviorInsight[] {
  const engagementData = reportData.engagement_signals;

  if (engagementData.confidence === 'low_confidence') {
    return [];
  }

  const insights: BehaviorInsight[] = [];
  const topPost = engagementData.top_performing_posts[0];
  if (topPost && topPost.engagement_total > 0) {
    insights.push(topPostInsight(topPost));
  }

  const trendPoints = engagementData.engagement_trends;
  if (trendPoints.length >= 2) {
    const currentWindow = trendPoints.slice(-7);
    const previousWindow = trendPoints.slice(-14, -7);
    const delta = computeTrendDelta(sumTrend(currentWindow), sumTrend(previousWindow));

    if (Math.abs(delta) >= 0.15) {
      insights.push({
        type: 'engagement_signal',
        severity: delta > 0 ? 'medium' : 'low',
        source_layer: 'engagement_signal',
        confidence: 'high',
        message: delta > 0
          ? 'Social engagement trend is accelerating'
          : 'Social engagement trend is cooling down',
        metric: Number(delta.toFixed(4)),
        context: {
          period: 'last_7_days_vs_previous_7_days',
          change_pct: Number((delta * 100).toFixed(2)),
          label: 'Social Engagement (Not Traffic Data)',
        },
      });
    }
  }

  const topPlatform = engagementData.platform_comparison[0];
  if (topPlatform && topPlatform.engagement_total > 0) {
    insights.push({
      type: 'engagement_signal',
      severity: 'low',
      source_layer: 'engagement_signal',
      confidence: 'high',
      message: `${topPlatform.platform} is leading social engagement`,
      metric: topPlatform.engagement_total,
      context: {
        platform: topPlatform.platform,
        engagement_total: topPlatform.engagement_total,
        posts: topPlatform.posts,
        label: 'Social Engagement (Not Traffic Data)',
      },
    });
  }

  return insights.sort((a, b) => computeImpactScore(b) - computeImpactScore(a));
}
