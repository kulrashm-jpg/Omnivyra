/**
 * Opportunity Decision Engine
 * Generates canonical decision objects for opportunity discovery.
 */

import { getMarketingMemoriesByType } from './marketingMemoryService';
import {
  archiveDecisionScope,
  getLatestDecisionObjectsForSource,
  replaceDecisionObjectsForSource,
  type PersistedDecisionObject,
} from './decisionObjectService';
import { assertBackgroundJobContext } from './intelligenceExecutionContext';
import { assertDecisionArray } from './decisionRuntimeGuardService';

export interface OpportunityDetectionInput {
  company_id: string;
  trend_signals: Record<string, unknown>[];
  engagement_health_report: Record<string, unknown> | null;
  strategic_insight_report: Record<string, unknown> | null;
  inbox_signals: Record<string, unknown>[];
}

const TREND_STRENGTH_THRESHOLD = 0.5;
const REPLY_RATE_BENCHMARK = 0.08;
const MEMORY_BOOST_MAX = 15;
const CONTENT_PRODUCTION_LOW_THRESHOLD = 3;
const OPPORTUNITY_TTL_MS = 6 * 60 * 60 * 1000;
const SOURCE_SERVICE = 'opportunityDetectionService';

function extractTrendTopicsWithStrength(signals: Record<string, unknown>[]): Array<{ topic: string; strength?: number }> {
  const output: Array<{ topic: string; strength?: number }> = [];
  const seen = new Set<string>();
  for (const signal of signals) {
    const snapshot = signal?.snapshot as Record<string, unknown> | undefined;
    const emerging = Array.isArray(snapshot?.emerging_trends) ? snapshot.emerging_trends : [];
    const ranked = Array.isArray(snapshot?.ranked_trends) ? snapshot.ranked_trends : [];
    for (const item of [...emerging, ...ranked]) {
      const topic = (item as { topic?: string; name?: string }).topic ?? (item as { topic?: string; name?: string }).name;
      const strength = typeof (item as { strength?: number }).strength === 'number' ? (item as { strength?: number }).strength : 0.7;
      if (topic && typeof topic === 'string') {
        const key = topic.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          output.push({ topic, strength });
        }
      }
    }
  }
  return output;
}

function getTopicsFromCampaigns(strategicReport: Record<string, unknown> | null): Set<string> {
  const topics = new Set<string>();
  const insights = strategicReport?.insights;
  if (!Array.isArray(insights)) return topics;
  for (const insight of insights) {
    const summary = (insight as { summary?: string }).summary;
    if (typeof summary === 'string') {
      summary.toLowerCase().split(/\s+/).forEach((word) => {
        if (word.length > 3) topics.add(word);
      });
    }
  }
  return topics;
}

function getInboxTopicCounts(signals: Record<string, unknown>[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const signal of signals) {
    const message = (signal as { latest_message?: string }).latest_message;
    const intent = (signal as { dominant_intent?: string }).dominant_intent;
    const customerQuestion = (signal as { customer_question?: boolean }).customer_question;
    const text = [message, intent].filter(Boolean).join(' ').toLowerCase();
    if (!text) continue;
    for (const word of text.split(/\s+/).filter((item) => item.length > 4)) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
    if (customerQuestion && message) {
      for (const word of message.toLowerCase().split(/\s+/).filter((item) => item.length > 4)) {
        counts.set(word, (counts.get(word) ?? 0) + 2);
      }
    }
  }
  return counts;
}

function computeOpportunityScore(trendStrength: number, engagementSignal: number, strategicSignal: number): number {
  return Math.min(100, Math.max(0, ((0.4 * trendStrength) + (0.35 * engagementSignal) + (0.25 * strategicSignal)) * 100));
}

async function getMemoryBoost(companyId: string): Promise<number> {
  try {
    const [contentMemories, narrativeMemories] = await Promise.all([
      getMarketingMemoriesByType(companyId, 'content_performance', 10),
      getMarketingMemoriesByType(companyId, 'narrative_performance', 10),
    ]);
    let boost = 0;
    for (const memory of contentMemories) {
      const averageEngagement = (memory.memory_value?.avg_engagement as number) ?? 0;
      if (averageEngagement > 0.05) boost += Math.min(5, averageEngagement * 50);
    }
    for (const memory of narrativeMemories) {
      const score = (memory.memory_value?.engagement_score as number) ?? 0;
      if (score > 50) boost += Math.min(5, (score - 50) / 10);
    }
    return Math.min(MEMORY_BOOST_MAX, boost);
  } catch {
    return 0;
  }
}

export async function detectOpportunities(input: OpportunityDetectionInput): Promise<PersistedDecisionObject[]> {
  assertBackgroundJobContext('opportunityDetectionService');

  const narrativeBoost = await getMemoryBoost(input.company_id);
  const trendTopics = extractTrendTopicsWithStrength(input.trend_signals);
  const campaignTopics = getTopicsFromCampaigns(input.strategic_insight_report);
  const inboxTopicCounts = getInboxTopicCounts(input.inbox_signals);
  const replyRate = typeof input.engagement_health_report?.engagement_rate === 'number'
    ? input.engagement_health_report.engagement_rate
    : 0;
  const contentLow = input.inbox_signals.length < CONTENT_PRODUCTION_LOW_THRESHOLD;
  const strategicInsights = input.strategic_insight_report?.insights;
  const decisions = [];

  for (const trend of trendTopics) {
    const strength = trend.strength ?? 0.7;
    const topicLower = trend.topic.toLowerCase();
    const covered = [...campaignTopics].some((item) => item.includes(topicLower) || topicLower.includes(item));
    if (strength > TREND_STRENGTH_THRESHOLD && !covered) {
      const confidence = Math.min(1, strength * 0.9);
      const score = Math.min(100, Math.round(computeOpportunityScore(strength, 0.5, 0.6) + narrativeBoost));
      decisions.push({
        company_id: input.company_id,
        report_tier: 'growth' as const,
        source_service: SOURCE_SERVICE,
        entity_type: 'global' as const,
        entity_id: null,
        issue_type: 'market_opportunity',
        title: 'Emerging industry topic not yet addressed',
        description: `Emerging industry topic "${trend.topic}" is not yet addressed by the current strategy.`,
        evidence: {
          trend_topic: trend.topic,
          trend_strength: strength,
          campaign_topics: [...campaignTopics],
          supporting_signals: ['trend.emerging_topic', 'campaign.coverage_gap'],
        },
        impact_traffic: Math.min(100, score),
        impact_conversion: Math.min(100, Math.round(score * 0.75)),
        impact_revenue: Math.min(100, Math.round(score * 0.8)),
        priority_score: Math.min(100, score),
        effort_score: 35,
        confidence_score: confidence,
        recommendation: `Incorporate "${trend.topic}" into campaign strategy or content themes.`,
        action_type: 'launch_campaign',
        action_payload: {
          trend_topic: trend.topic,
          source: 'trend_signal',
        },
        status: 'open' as const,
        last_changed_by: 'system' as const,
      });
    }
  }

  if (replyRate > REPLY_RATE_BENCHMARK && contentLow) {
    const confidence = Math.min(1, replyRate * 4);
    const score = Math.min(100, Math.round(computeOpportunityScore(0.6, replyRate * 5, 0.5) + narrativeBoost));
    decisions.push({
      company_id: input.company_id,
      report_tier: 'growth' as const,
      source_service: SOURCE_SERVICE,
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'engagement_opportunity',
      title: 'Audience responding strongly with limited content',
      description: 'Audience response is strong, but content coverage is still limited.',
      evidence: {
        reply_rate: replyRate,
        inbox_signal_count: input.inbox_signals.length,
        supporting_signals: ['engagement.reply_rate_high', 'content.production_low'],
      },
      impact_traffic: Math.min(100, Math.round(score * 0.7)),
      impact_conversion: Math.min(100, Math.round(score * 0.85)),
      impact_revenue: score,
      priority_score: score,
      effort_score: 30,
      confidence_score: confidence,
      recommendation: 'Increase production around the topic clusters already generating audience response.',
      action_type: 'improve_content',
      action_payload: {
        source: 'engagement_signal',
        reply_rate: replyRate,
      },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    });
  }

  if (Array.isArray(strategicInsights)) {
    for (const insight of strategicInsights) {
      if ((insight as { insight_category?: string }).insight_category === 'market_trend') {
        const confidence = (insight as { confidence?: number }).confidence ?? 0.7;
        const score = Math.min(100, Math.round(computeOpportunityScore(0.7, 0.5, confidence) + narrativeBoost));
        decisions.push({
          company_id: input.company_id,
          report_tier: 'growth' as const,
          source_service: SOURCE_SERVICE,
          entity_type: 'global' as const,
          entity_id: null,
          issue_type: 'strategic_market_opportunity',
          title: (insight as { title?: string }).title ?? 'Market trend opportunity',
          description: (insight as { summary?: string }).summary ?? 'Strategic insight indicates market opportunity.',
          evidence: {
            strategic_insight: insight,
            supporting_signals: ['strategic_insight.market_trend'],
          },
          impact_traffic: Math.min(100, Math.round(score * 0.8)),
          impact_conversion: Math.min(100, Math.round(score * 0.85)),
          impact_revenue: score,
          priority_score: score,
          effort_score: 40,
          confidence_score: confidence,
          recommendation: (insight as { recommended_action?: string }).recommended_action ?? 'Review and act on market trend insight.',
          action_type: 'launch_campaign',
          action_payload: {
            source: 'strategic_signal',
            title: (insight as { title?: string }).title ?? null,
          },
          status: 'open' as const,
          last_changed_by: 'system' as const,
        });
      }
    }
  }

  for (const [topic, count] of [...inboxTopicCounts.entries()].filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1]).slice(0, 3)) {
    const confidence = Math.min(1, 0.5 + count * 0.15);
    const score = Math.min(100, Math.round(computeOpportunityScore(0.6, 0.6, 0.5) + narrativeBoost));
    decisions.push({
      company_id: input.company_id,
      report_tier: 'growth' as const,
      source_service: SOURCE_SERVICE,
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'content_gap',
      title: `Repeated audience interest: ${topic}`,
      description: `Audience conversations repeatedly mention "${topic}".`,
      evidence: {
        topic,
        mention_count: count,
        supporting_signals: ['inbox.repeated_topic', 'inbox.audience_demand'],
      },
      impact_traffic: Math.min(100, Math.round(score * 0.65)),
      impact_conversion: Math.min(100, Math.round(score * 0.8)),
      impact_revenue: score,
      priority_score: score,
      effort_score: 25,
      confidence_score: confidence,
      recommendation: `Create content that directly addresses "${topic}".`,
      action_type: 'improve_content',
      action_payload: {
        topic,
        mention_count: count,
      },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    });
  }

  if (decisions.length === 0) {
    await archiveDecisionScope({
      company_id: input.company_id,
      report_tier: 'growth',
      source_service: SOURCE_SERVICE,
      entity_type: 'global',
      entity_id: null,
      changed_by: 'system',
    });
    return [];
  }

  const persisted = await replaceDecisionObjectsForSource(decisions);
  return assertDecisionArray('opportunityDetectionService.detectOpportunities', persisted);
}

export async function getLatestOpportunityReport(companyId: string): Promise<PersistedDecisionObject[] | null> {
  return getLatestDecisionObjectsForSource({
    companyId,
    reportTier: 'growth',
    sourceService: SOURCE_SERVICE,
    entityType: 'global',
    entityId: null,
    ttlMs: OPPORTUNITY_TTL_MS,
  });
}
