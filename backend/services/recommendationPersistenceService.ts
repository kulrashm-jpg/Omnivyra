/**
 * Recommendation Persistence Service
 * Phase 5: Persist recommendations for outcome/feedback linking.
 */

import { supabase } from '../db/supabaseClient';

export type RecommendationPersistenceInput = {
  recommendation_type: string;
  action_summary: string | null;
  supporting_signals: unknown;
  confidence_score: number | null;
};

export type PersistedRecommendation = {
  id: string;
  company_id: string;
  recommendation_type: string;
  action_summary: string | null;
  supporting_signals: unknown;
  confidence_score: number | null;
  created_at: string;
};

/**
 * Persist a recommendation and return its ID.
 */
export async function persistRecommendation(
  companyId: string,
  recommendation: RecommendationPersistenceInput
): Promise<PersistedRecommendation> {
  const { data, error } = await supabase
    .from('intelligence_recommendations')
    .insert({
      company_id: companyId,
      recommendation_type: recommendation.recommendation_type,
      action_summary: recommendation.action_summary,
      supporting_signals: recommendation.supporting_signals,
      confidence_score: recommendation.confidence_score,
    })
    .select('id, company_id, recommendation_type, action_summary, supporting_signals, confidence_score, created_at')
    .single();

  if (error) throw new Error(`intelligence_recommendations insert failed: ${error.message}`);
  return data as PersistedRecommendation;
}
