/**
 * Response Strategy Intelligence Service
 * Load top strategies for classification + sentiment to guide AI reply generation.
 */

import { supabase } from '../db/supabaseClient';

export const STRATEGY_TYPES = [
  'educational_reply',
  'supportive_reply',
  'solution_reply',
  'redirect_to_resource',
  'call_to_action',
  'neutral_acknowledgement',
] as const;

export type StrategyType = (typeof STRATEGY_TYPES)[number];

export type StrategyIntelligenceRow = {
  strategy_type: string;
  engagement_score: number;
  confidence_score: number;
};

export async function getTopStrategiesForContext(
  organizationId: string,
  classificationCategory: string,
  sentiment: string | null | undefined = 'neutral',
  limit: number = 3
): Promise<StrategyIntelligenceRow[]> {
  if (!organizationId || !classificationCategory) return [];

  let query = supabase
    .from('response_strategy_intelligence')
    .select('strategy_type, engagement_score, confidence_score')
    .eq('organization_id', organizationId)
    .eq('classification_category', classificationCategory);

  if (sentiment != null && sentiment !== '') {
    query = query.eq('sentiment', sentiment);
  }

  const { data, error } = await query
    .order('engagement_score', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('[responseStrategyIntelligence] getTopStrategies error', error.message);
    return [];
  }

  return (data ?? []) as StrategyIntelligenceRow[];
}

export function formatStrategiesForPrompt(strategies: StrategyIntelligenceRow[]): string {
  if (strategies.length === 0) return '';
  return strategies
    .map(
      (s) =>
        `- ${s.strategy_type.replace(/_/g, ' ')} (engagement: ${s.engagement_score.toFixed(1)}, confidence: ${s.confidence_score.toFixed(1)})`
    )
    .join('\n');
}
