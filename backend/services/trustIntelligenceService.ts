import { supabase } from '../db/supabaseClient';
import { assertBackgroundJobContext } from './intelligenceExecutionContext';
import { archiveDecisionSourceEntityType, createDecisionObjects, type PersistedDecisionObject } from './decisionObjectService';

type CommunityRow = {
  sentiment: string | null;
  tone: string | null;
  content: string | null;
  suggested_text: string | null;
};

function sinceDays(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function normalizeSentiment(row: CommunityRow): 'positive' | 'negative' | 'neutral' {
  const sentiment = `${row.sentiment ?? ''} ${row.tone ?? ''}`.toLowerCase();
  if (/(negative|angry|frustrated|complaint|critical)/.test(sentiment)) return 'negative';
  if (/(positive|happy|support|love|excellent)/.test(sentiment)) return 'positive';
  return 'neutral';
}

function hasCredibilitySignal(text: string): boolean {
  return /(proof|case study|testimonial|verified|trusted|credible|authority|review)/.test(text);
}

export async function generateTrustIntelligenceDecisions(companyId: string): Promise<PersistedDecisionObject[]> {
  assertBackgroundJobContext('trustIntelligenceService');

  const { data, error } = await supabase
    .from('community_ai_actions')
    .select('sentiment, tone, content, suggested_text')
    .eq('company_id', companyId)
    .gte('created_at', sinceDays(30))
    .limit(1000);

  if (error) throw new Error(`Failed to load community actions for trust engine: ${error.message}`);

  await archiveDecisionSourceEntityType({
    company_id: companyId,
    report_tier: 'growth',
    source_service: 'trustIntelligenceService',
    entity_type: 'global',
    changed_by: 'system',
  });

  const rows = (data ?? []) as CommunityRow[];
  if (rows.length === 0) return [];

  let negative = 0;
  let positive = 0;
  let credibilitySignals = 0;

  for (const row of rows) {
    const sentiment = normalizeSentiment(row);
    if (sentiment === 'negative') negative += 1;
    else if (sentiment === 'positive') positive += 1;

    const text = `${row.content ?? ''} ${row.suggested_text ?? ''}`.toLowerCase();
    if (hasCredibilitySignal(text)) credibilitySignals += 1;
  }

  const total = rows.length;
  const negativeRate = negative / Math.max(1, total);
  const positiveRate = positive / Math.max(1, total);
  const credibilityRate = credibilitySignals / Math.max(1, total);

  const decisions = [];

  if (negativeRate >= 0.25) {
    decisions.push({
      company_id: companyId,
      report_tier: 'growth' as const,
      source_service: 'trustIntelligenceService',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'sentiment_risk',
      title: 'Negative sentiment trend is above safe operating threshold',
      description: 'Community feedback sentiment has shifted toward a risky negative ratio.',
      evidence: {
        sample_size: total,
        negative_rate: negativeRate,
        positive_rate: positiveRate,
      },
      impact_traffic: 28,
      impact_conversion: 56,
      impact_revenue: 54,
      priority_score: 67,
      effort_score: 20,
      confidence_score: 0.84,
      recommendation: 'Launch trust-repair communication and high-priority response workflows for negative threads.',
      action_type: 'adjust_strategy',
      action_payload: { optimization_focus: 'sentiment_recovery' },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    });
  }

  if (positiveRate < 0.2) {
    decisions.push({
      company_id: companyId,
      report_tier: 'growth' as const,
      source_service: 'trustIntelligenceService',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'brand_trust_gap',
      title: 'Brand trust reinforcement is insufficient',
      description: 'Positive advocacy is too weak to offset negative or neutral trust narratives.',
      evidence: {
        sample_size: total,
        positive_rate: positiveRate,
      },
      impact_traffic: 24,
      impact_conversion: 52,
      impact_revenue: 50,
      priority_score: 63,
      effort_score: 26,
      confidence_score: 0.79,
      recommendation: 'Increase proof-based trust content and customer success amplification.',
      action_type: 'improve_content',
      action_payload: { optimization_focus: 'brand_trust' },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    });
  }

  if (credibilityRate < 0.15) {
    decisions.push({
      company_id: companyId,
      report_tier: 'growth' as const,
      source_service: 'trustIntelligenceService',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'credibility_gap',
      title: 'Credibility cues are underrepresented in active conversations',
      description: 'Low proof/credibility signal density suggests weak trust conversion support.',
      evidence: {
        sample_size: total,
        credibility_signal_rate: credibilityRate,
      },
      impact_traffic: 18,
      impact_conversion: 48,
      impact_revenue: 52,
      priority_score: 61,
      effort_score: 18,
      confidence_score: 0.76,
      recommendation: 'Publish verifiable trust artifacts and incorporate credibility cues in frontline content.',
      action_type: 'improve_content',
      action_payload: { optimization_focus: 'credibility_proof' },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    });
  }

  if (decisions.length === 0) return [];
  return createDecisionObjects(decisions);
}
