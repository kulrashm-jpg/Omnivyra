import { supabase } from '../db/supabaseClient';
import {
  archiveDecisionSourceEntityType,
  createDecisionObjects,
  type PersistedDecisionObject,
} from './decisionObjectService';
import { assertBackgroundJobContext } from './intelligenceExecutionContext';
import { clamp, normalizeText, roundNumber } from './intelligenceEngineUtils';

type CommunityActionRow = {
  id: string;
  platform: string | null;
  sentiment: string | null;
  tone: string | null;
  intent_classification: Record<string, unknown> | null;
  content: string | null;
  suggested_text: string | null;
  message_count: number | null;
  created_at: string;
};

function recentSince(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function normalizedSentiment(row: CommunityActionRow): 'positive' | 'negative' | 'neutral' {
  const classification = row.intent_classification;
  const hinted = typeof classification?.sentiment === 'string' ? String(classification.sentiment) : '';
  const sentiment = normalizeText(row.sentiment) || normalizeText(hinted) || normalizeText(row.tone);
  if (/(negative|complaint|angry|frustrated|critical)/.test(sentiment)) return 'negative';
  if (/(positive|love|support|happy|excited)/.test(sentiment)) return 'positive';
  return 'neutral';
}

function detectTrustGapText(row: CommunityActionRow): boolean {
  const text = normalizeText(row.content) || normalizeText(row.suggested_text);
  return /(scam|trust|fake|spam|fraud|not credible|unreliable|no proof|bad review|poor support)/.test(text);
}

export async function generateBrandTrustIntelligenceDecisions(companyId: string): Promise<PersistedDecisionObject[]> {
  assertBackgroundJobContext('brandTrustIntelligenceService');

  const { data, error } = await supabase
    .from('community_ai_actions')
    .select('id, platform, sentiment, tone, intent_classification, content, suggested_text, message_count, created_at')
    .eq('company_id', companyId)
    .gte('created_at', recentSince(30))
    .order('created_at', { ascending: false })
    .limit(800);

  if (error) {
    throw new Error(`Failed to load community actions for brand trust intelligence: ${error.message}`);
  }

  await archiveDecisionSourceEntityType({
    company_id: companyId,
    report_tier: 'growth',
    source_service: 'brandTrustIntelligenceService',
    entity_type: 'global',
    changed_by: 'system',
  });

  const rows = (data ?? []) as CommunityActionRow[];
  if (rows.length === 0) return [];

  let negative = 0;
  let positive = 0;
  let neutral = 0;
  let trustGapMentions = 0;
  let engagementWeight = 0;
  const platforms = new Set<string>();

  for (const row of rows) {
    const sentiment = normalizedSentiment(row);
    if (sentiment === 'negative') negative += 1;
    else if (sentiment === 'positive') positive += 1;
    else neutral += 1;

    if (detectTrustGapText(row)) trustGapMentions += 1;
    engagementWeight += Number(row.message_count ?? 1);
    if (row.platform) platforms.add(normalizeText(row.platform));
  }

  const total = Math.max(1, rows.length);
  const negativeRate = negative / total;
  const positiveRate = positive / total;
  const trustGapRate = trustGapMentions / total;
  const platformCoverage = platforms.size;

  const decisions = [];

  if (negativeRate >= 0.28) {
    decisions.push({
      company_id: companyId,
      report_tier: 'growth' as const,
      source_service: 'brandTrustIntelligenceService',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'negative_sentiment_risk',
      title: 'Negative sentiment is trending above safe threshold',
      description: 'Community sentiment shows elevated negative tone that can suppress conversion and brand confidence.',
      evidence: {
        window_days: 30,
        total_actions: total,
        negative_count: negative,
        positive_count: positive,
        neutral_count: neutral,
        negative_rate: roundNumber(negativeRate, 4),
      },
      impact_traffic: clamp(30 + Math.round(negativeRate * 80), 0, 100),
      impact_conversion: clamp(45 + Math.round(negativeRate * 95), 0, 100),
      impact_revenue: clamp(42 + Math.round(negativeRate * 90), 0, 100),
      priority_score: clamp(55 + Math.round(negativeRate * 85), 0, 100),
      effort_score: 24,
      confidence_score: 0.83,
      recommendation: 'Deploy trust-repair messaging and rapid support responses for high-risk sentiment threads.',
      action_type: 'adjust_strategy',
      action_payload: {
        remediation_focus: 'sentiment_recovery',
        negative_rate: roundNumber(negativeRate, 4),
      },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    });
  }

  if (platformCoverage <= 1 || (positiveRate < 0.2 && total >= 40)) {
    decisions.push({
      company_id: companyId,
      report_tier: 'growth' as const,
      source_service: 'brandTrustIntelligenceService',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'weak_brand_presence',
      title: 'Brand presence is weak across community channels',
      description: 'Community signal volume is concentrated and positive advocacy is too low to sustain brand trust growth.',
      evidence: {
        active_platforms: [...platforms],
        platform_coverage_count: platformCoverage,
        positive_rate: roundNumber(positiveRate, 4),
        engagement_weight: engagementWeight,
      },
      impact_traffic: clamp(26 + Math.round((1 - positiveRate) * 50), 0, 100),
      impact_conversion: clamp(38 + Math.round((1 - positiveRate) * 55), 0, 100),
      impact_revenue: clamp(36 + Math.round((1 - positiveRate) * 58), 0, 100),
      priority_score: clamp(48 + Math.round((1 - positiveRate) * 52), 0, 100),
      effort_score: 30,
      confidence_score: 0.77,
      recommendation: 'Expand active brand participation across additional channels with trust-forward proof content.',
      action_type: 'fix_distribution',
      action_payload: {
        remediation_focus: 'brand_presence',
        active_platform_count: platformCoverage,
      },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    });
  }

  if (trustGapRate >= 0.12) {
    decisions.push({
      company_id: companyId,
      report_tier: 'growth' as const,
      source_service: 'brandTrustIntelligenceService',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'community_trust_gap',
      title: 'Community trust gap is visible in feedback language',
      description: 'Community conversations contain recurring trust concerns that require proof-led responses.',
      evidence: {
        trust_gap_mentions: trustGapMentions,
        trust_gap_rate: roundNumber(trustGapRate, 4),
        sample_size: total,
      },
      impact_traffic: clamp(22 + Math.round(trustGapRate * 120), 0, 100),
      impact_conversion: clamp(44 + Math.round(trustGapRate * 130), 0, 100),
      impact_revenue: clamp(46 + Math.round(trustGapRate * 125), 0, 100),
      priority_score: clamp(58 + Math.round(trustGapRate * 110), 0, 100),
      effort_score: 20,
      confidence_score: 0.8,
      recommendation: 'Publish trust artifacts (proof, case evidence, response SLAs) and respond to concern clusters quickly.',
      action_type: 'improve_content',
      action_payload: {
        remediation_focus: 'community_trust',
        trust_gap_rate: roundNumber(trustGapRate, 4),
      },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    });
  }

  if (decisions.length === 0) return [];
  return createDecisionObjects(decisions);
}
