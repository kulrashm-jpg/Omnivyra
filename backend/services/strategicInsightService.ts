/**
 * Strategic Decision Engine
 * Generates canonical decision objects from campaign health, trend, and inbox signals.
 */

import { supabase } from '../db/supabaseClient';
import { getMarketingMemoriesByType } from './marketingMemoryService';
import {
  archiveDecisionScope,
  getLatestDecisionObjectsForSource,
  replaceDecisionObjectsForSource,
  type PersistedDecisionObject,
} from './decisionObjectService';
import { assertBackgroundJobContext } from './intelligenceExecutionContext';
import { assertDecisionArray } from './decisionRuntimeGuardService';

export interface StrategicInsight {
  title: string;
  summary: string;
  insight_type: string;
  insight_category: string;
  confidence: number;
  supporting_signals: string[];
  recommended_action: string;
  impact_score: number;
}

export interface StrategicInsightReport {
  report_id: string;
  generated_at: string;
  campaign_id: string;
  company_id: string;
  insights: StrategicInsight[];
}

export interface StrategicInsightInput {
  company_id: string;
  campaign_id: string;
  campaign_health_report: Record<string, unknown> | null;
  engagement_health_report: Record<string, unknown> | null;
  trend_signals: Record<string, unknown>[];
  inbox_signals: Record<string, unknown>[];
}

const REPLY_RATE_THRESHOLD = 0.05;
const MEMORY_IMPACT_BOOST_MAX = 10;
const INSIGHT_TTL_MS = 6 * 60 * 60 * 1000;
const INSIGHT_RETENTION_LIMIT = 30;
const ANALYSIS_VERSION = 'decision_strategic_v2.0';
const SOURCE_SERVICE = 'strategicInsightService';

function getHealthFlags(report: Record<string, unknown> | null): Record<string, boolean> {
  const flags = report?.health_flags;
  return (flags && typeof flags === 'object') ? (flags as Record<string, boolean>) : {};
}

function getCampaignNarrativeTopics(report: Record<string, unknown> | null): Set<string> {
  const topics = new Set<string>();
  const summary = report?.health_summary;
  if (typeof summary === 'string') {
    summary.toLowerCase().split(/\s+/).forEach((word) => {
      if (word.length > 3) topics.add(word);
    });
  }
  const topCategories = report?.top_issue_categories;
  if (Array.isArray(topCategories)) {
    topCategories.forEach((item) => topics.add(String(item).toLowerCase()));
  }
  return topics;
}

function extractTrendTopics(signals: Record<string, unknown>[]): Array<{ topic: string; strength?: number }> {
  const output: Array<{ topic: string; strength?: number }> = [];
  for (const signal of signals) {
    const snapshot = signal?.snapshot as Record<string, unknown> | undefined;
    const emerging = Array.isArray(snapshot?.emerging_trends) ? snapshot.emerging_trends : [];
    const ranked = Array.isArray(snapshot?.ranked_trends) ? snapshot.ranked_trends : [];

    for (const item of [...emerging, ...ranked]) {
      const topic = (item as { topic?: string; name?: string }).topic ?? (item as { topic?: string; name?: string }).name;
      if (topic && typeof topic === 'string') {
        output.push({ topic: topic.toLowerCase(), strength: 0.7 });
      }
    }
  }
  return output;
}

function computeConfidence(trendStrength: number, engagementStrength: number, healthSeverity: number): number {
  const weighted = (0.35 * trendStrength) + (0.35 * engagementStrength) + (0.3 * (1 - healthSeverity));
  return Math.min(1, Math.max(0, weighted));
}

async function getMemoryImpactBoost(companyId: string): Promise<number> {
  try {
    const memories = await getMarketingMemoriesByType(companyId, 'narrative_performance', 5);
    let boost = 0;
    for (const memory of memories) {
      const score = (memory.memory_value?.engagement_score as number) ?? 0;
      if (score > 60) boost += Math.min(3, (score - 60) / 20);
    }
    return Math.min(MEMORY_IMPACT_BOOST_MAX, boost);
  } catch {
    return 0;
  }
}

function rankByImpact(decisions: PersistedDecisionObject[]): PersistedDecisionObject[] {
  return [...decisions].sort((a, b) => {
    const revenue = (b.impact_revenue ?? 0) - (a.impact_revenue ?? 0);
    if (revenue !== 0) return revenue;
    const conversion = (b.impact_conversion ?? 0) - (a.impact_conversion ?? 0);
    if (conversion !== 0) return conversion;
    const traffic = (b.impact_traffic ?? 0) - (a.impact_traffic ?? 0);
    if (traffic !== 0) return traffic;
    return (b.confidence_score ?? 0) - (a.confidence_score ?? 0);
  });
}

async function getCampaignCompanyId(campaignId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('campaigns')
    .select('company_id')
    .eq('id', campaignId)
    .maybeSingle();

  if (error) return null;
  return (data?.company_id as string | undefined) ?? null;
}

export async function generateStrategicInsights(input: StrategicInsightInput): Promise<PersistedDecisionObject[]> {
  assertBackgroundJobContext('strategicInsightService');
  const memoryBoost = await getMemoryImpactBoost(input.company_id);
  const healthFlags = getHealthFlags(input.campaign_health_report);
  const narrativeTopics = getCampaignNarrativeTopics(input.campaign_health_report);
  const trendTopics = extractTrendTopics(input.trend_signals);
  const engagement = input.engagement_health_report ?? {};
  const replyRate = typeof engagement.engagement_rate === 'number' ? engagement.engagement_rate : 0;
  const replyRateLow = replyRate < REPLY_RATE_THRESHOLD;
  const healthScore =
    typeof input.campaign_health_report?.health_score === 'number'
      ? (input.campaign_health_report.health_score as number)
      : 50;
  const healthSeverity = healthScore < 40 ? 0.8 : healthScore < 60 ? 0.5 : 0.2;

  const pendingDecisions = [];

  if ((healthFlags.has_metadata_issues || healthFlags.missing_metadata) && replyRateLow) {
    const confidence = computeConfidence(0.6, 0.4, healthSeverity);
    pendingDecisions.push({
      company_id: input.company_id,
      report_tier: 'growth' as const,
      source_service: SOURCE_SERVICE,
      entity_type: 'campaign' as const,
      entity_id: input.campaign_id,
      issue_type: 'cta_clarity_gap',
      title: 'CTA clarity may be reducing engagement',
      description: 'Metadata issues and low reply rates indicate that the campaign CTA is not clear enough for the audience.',
      evidence: {
        source_service: SOURCE_SERVICE,
        analysis_version: ANALYSIS_VERSION,
        campaign_health_flags: healthFlags,
        reply_rate: replyRate,
        supporting_signals: ['campaign_health.metadata_issues', 'engagement.reply_rate_low'],
      },
      impact_traffic: Math.round(Math.min(100, 42 + memoryBoost)),
      impact_conversion: Math.round(Math.min(100, 78 + memoryBoost)),
      impact_revenue: Math.round(Math.min(100, 74 + memoryBoost)),
      priority_score: Math.round(Math.min(100, 76 + memoryBoost)),
      effort_score: 20,
      confidence_score: confidence,
      recommendation: 'Clarify the CTA and tighten campaign metadata so every activity points to one clear next step.',
      action_type: 'fix_cta',
      action_payload: {
        campaign_id: input.campaign_id,
        focus_area: 'cta_and_metadata',
        supporting_signals: ['campaign_health.metadata_issues', 'engagement.reply_rate_low'],
      },
      status: 'open' as const,
    });
  }

  const emittedTopics = new Set<string>();
  for (const trend of trendTopics) {
    const topicLower = trend.topic.toLowerCase();
    if (emittedTopics.has(topicLower)) continue;

    const covered = [...narrativeTopics].some((item) => item.includes(topicLower) || topicLower.includes(item));
    if (covered) continue;

    emittedTopics.add(topicLower);
    const confidence = computeConfidence(trend.strength ?? 0.7, 0.5, healthSeverity);
    pendingDecisions.push({
      company_id: input.company_id,
      report_tier: 'growth' as const,
      source_service: SOURCE_SERVICE,
      entity_type: 'campaign' as const,
      entity_id: input.campaign_id,
      issue_type: 'market_shift',
      title: 'Emerging trend not reflected in campaign',
      description: `An emerging market topic "${trend.topic}" is not represented in the campaign narrative or content mix.`,
      evidence: {
        source_service: SOURCE_SERVICE,
        analysis_version: ANALYSIS_VERSION,
        trend_topic: trend.topic,
        trend_strength: trend.strength ?? 0.7,
        campaign_topics: [...narrativeTopics],
        supporting_signals: ['trend.emerging_topic', 'campaign.narrative_gap'],
      },
      impact_traffic: Math.round(Math.min(100, 68 + memoryBoost)),
      impact_conversion: Math.round(Math.min(100, 52 + memoryBoost)),
      impact_revenue: Math.round(Math.min(100, 60 + memoryBoost)),
      priority_score: Math.round(Math.min(100, 72 + memoryBoost)),
      effort_score: 35,
      confidence_score: confidence,
      recommendation: `Introduce "${trend.topic}" into campaign themes, hooks, and supporting content before competitors capture the demand.`,
      action_type: 'improve_content',
      action_payload: {
        campaign_id: input.campaign_id,
        trend_topic: trend.topic,
        execution_target: 'campaign_theme_refresh',
      },
      status: 'open' as const,
    });
  }

  if (healthScore < 50 && input.inbox_signals.length > 0) {
    const confidence = computeConfidence(0.5, 0.6, healthSeverity);
    pendingDecisions.push({
      company_id: input.company_id,
      report_tier: 'growth' as const,
      source_service: SOURCE_SERVICE,
      entity_type: 'campaign' as const,
      entity_id: input.campaign_id,
      issue_type: 'content_gap',
      title: 'Campaign health and inbox activity are misaligned',
      description: 'Audience activity exists, but the campaign narrative is not matching the conversations driving engagement.',
      evidence: {
        source_service: SOURCE_SERVICE,
        analysis_version: ANALYSIS_VERSION,
        campaign_health_score: healthScore,
        inbox_signal_count: input.inbox_signals.length,
        supporting_signals: ['campaign_health.low_score', 'inbox.has_activity'],
      },
      impact_traffic: Math.round(Math.min(100, 50 + memoryBoost)),
      impact_conversion: Math.round(Math.min(100, 70 + memoryBoost)),
      impact_revenue: Math.round(Math.min(100, 72 + memoryBoost)),
      priority_score: Math.round(Math.min(100, 74 + memoryBoost)),
      effort_score: 30,
      confidence_score: confidence,
      recommendation: 'Realign content themes and campaign positioning to the messages that are already driving inbound audience response.',
      action_type: 'improve_content',
      action_payload: {
        campaign_id: input.campaign_id,
        focus_area: 'message_alignment',
        inbox_signal_count: input.inbox_signals.length,
      },
      status: 'open' as const,
    });
  }

  if (pendingDecisions.length === 0) {
    await archiveDecisionScope({
      company_id: input.company_id,
      report_tier: 'growth',
      source_service: SOURCE_SERVICE,
      entity_type: 'campaign',
      entity_id: input.campaign_id,
      changed_by: 'system',
    });
    return [];
  }

  const persisted = await replaceDecisionObjectsForSource(pendingDecisions);
  return assertDecisionArray('strategicInsightService.generateStrategicInsights', rankByImpact(persisted));
}

export async function getLatestStrategicInsightReport(
  campaignId: string
): Promise<PersistedDecisionObject[] | null> {
  const companyId = await getCampaignCompanyId(campaignId);
  if (!companyId) return null;

  return getLatestDecisionObjectsForSource({
    companyId,
    reportTier: 'growth',
    sourceService: SOURCE_SERVICE,
    entityType: 'campaign',
    entityId: campaignId,
    ttlMs: INSIGHT_TTL_MS,
  });
}
