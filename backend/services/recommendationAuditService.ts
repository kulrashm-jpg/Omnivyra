import { supabase } from '../db/supabaseClient';

export type RecommendationAuditLogInput = {
  recommendation_id?: string | null;
  campaign_id?: string | null;
  company_id?: string | null;
  input_snapshot_hash?: string | null;
  trend_sources_used?: any;
  platform_strategies_used?: any;
  company_profile_used?: any;
  scores_breakdown?: any;
  final_score?: number | null;
  confidence?: number | null;
  historical_accuracy_factor?: number | null;
  policy_id?: string | null;
  policy_weights_used?: any;
};

export const logRecommendationAudit = async (input: RecommendationAuditLogInput): Promise<void> => {
  try {
    const { error } = await supabase.from('recommendation_audit_logs').insert({
      recommendation_id: input.recommendation_id ?? null,
      campaign_id: input.campaign_id ?? null,
      company_id: input.company_id ?? null,
      input_snapshot_hash: input.input_snapshot_hash ?? null,
      trend_sources_used: input.trend_sources_used ?? null,
      platform_strategies_used: input.platform_strategies_used ?? null,
      company_profile_used: input.company_profile_used ?? null,
      scores_breakdown: input.scores_breakdown ?? null,
      final_score: input.final_score ?? null,
      confidence: input.confidence ?? null,
      historical_accuracy_factor: input.historical_accuracy_factor ?? null,
      policy_id: input.policy_id ?? null,
      policy_weights_used: input.policy_weights_used ?? null,
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.warn('Failed to log recommendation audit', error.message);
    }
  } catch (error) {
    console.warn('Recommendation audit logging failed');
  }
};

export const getAuditByRecommendationId = async (id: string) => {
  const { data, error } = await supabase
    .from('recommendation_audit_logs')
    .select('*')
    .eq('recommendation_id', id)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) {
    throw new Error('Failed to load recommendation audit log');
  }
  return data?.[0] ?? null;
};

export const getAuditByCampaignId = async (campaignId: string) => {
  const { data, error } = await supabase
    .from('recommendation_audit_logs')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false });
  if (error) {
    throw new Error('Failed to load campaign audit logs');
  }
  return data ?? [];
};
