/**
 * Outcome Tracking Engine
 * Phase 5: Tracks real-world outcomes from recommendations.
 * Types: content_published, campaign_created, feature_built, competitive_response, market_entry
 */

import { supabase } from '../db/supabaseClient';

export type OutcomeType =
  | 'content_published'
  | 'campaign_created'
  | 'feature_built'
  | 'competitive_response'
  | 'market_entry';

export type OutcomeRecord = {
  company_id: string;
  recommendation_id: string | null;
  outcome_type: OutcomeType;
  success_score: number;
  created_at?: string;
};

export type OutcomeRow = {
  id: string;
  company_id: string;
  recommendation_id: string | null;
  outcome_type: string;
  success_score: number | null;
  created_at: string;
};

const VALID_OUTCOMES = new Set<OutcomeType>([
  'content_published',
  'campaign_created',
  'feature_built',
  'competitive_response',
  'market_entry',
]);

/**
 * Record an outcome. Uses ON CONFLICT DO NOTHING for recommendation-backed outcomes.
 */
export async function recordOutcome(
  input: OutcomeRecord
): Promise<{ id: string | null; inserted: boolean }> {
  const successScore = Math.min(1, Math.max(0, input.success_score ?? 0));
  if (!VALID_OUTCOMES.has(input.outcome_type as OutcomeType)) {
    throw new Error(`Invalid outcome_type: ${input.outcome_type}`);
  }

  const row = {
    company_id: input.company_id,
    recommendation_id: input.recommendation_id ?? null,
    outcome_type: input.outcome_type,
    success_score: successScore,
  };

  if (input.recommendation_id) {
    const { data, error } = await supabase
      .from('intelligence_outcomes')
      .upsert(row, {
        onConflict: 'company_id,recommendation_id,outcome_type',
        ignoreDuplicates: true,
      })
      .select('id')
      .single();

    if (error) throw new Error(`intelligence_outcomes insert failed: ${error.message}`);
    const inserted = !!data;
    return { id: data?.id ?? null, inserted };
  }

  const { data, error } = await supabase
    .from('intelligence_outcomes')
    .insert(row)
    .select('id')
    .single();

  if (error) throw new Error(`intelligence_outcomes insert failed: ${error.message}`);
  return { id: data?.id ?? null, inserted: true };
}

/**
 * Fetch outcome history for a company.
 */
export async function getOutcomeHistory(
  companyId: string,
  options?: { limit?: number }
): Promise<OutcomeRow[]> {
  const { data, error } = await supabase
    .from('intelligence_outcomes')
    .select('id, company_id, recommendation_id, outcome_type, success_score, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(options?.limit ?? 100);

  if (error) throw new Error(`Failed to fetch outcomes: ${error.message}`);
  return (data ?? []) as OutcomeRow[];
}
