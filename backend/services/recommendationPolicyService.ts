import { supabase } from '../db/supabaseClient';

export type RecommendationPolicyWeights = {
  trend_score: number;
  geo_fit: number;
  audience_fit: number;
  category_fit: number;
  platform_fit: number;
  health_multiplier: number;
  historical_accuracy: number;
  effort_penalty: number;
};

export type RecommendationPolicy = {
  id: string;
  name: string;
  is_active: boolean;
  weights: RecommendationPolicyWeights;
  created_at?: string;
  updated_at?: string;
};

const clamp = (value: number, min = 0, max = 5) => Math.min(Math.max(value, min), max);

export const validatePolicy = (weights: RecommendationPolicyWeights) => {
  const requiredKeys: Array<keyof RecommendationPolicyWeights> = [
    'trend_score',
    'geo_fit',
    'audience_fit',
    'category_fit',
    'platform_fit',
    'health_multiplier',
    'historical_accuracy',
    'effort_penalty',
  ];
  for (const key of requiredKeys) {
    const value = weights[key];
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return { ok: false, message: `${key} must be a number` };
    }
    if (value < 0 || value > 5) {
      return { ok: false, message: `${key} must be between 0 and 5` };
    }
  }
  return { ok: true };
};

const sanitizeWeights = (weights: RecommendationPolicyWeights): RecommendationPolicyWeights => ({
  trend_score: clamp(weights.trend_score),
  geo_fit: clamp(weights.geo_fit),
  audience_fit: clamp(weights.audience_fit),
  category_fit: clamp(weights.category_fit),
  platform_fit: clamp(weights.platform_fit),
  health_multiplier: clamp(weights.health_multiplier),
  historical_accuracy: clamp(weights.historical_accuracy),
  effort_penalty: clamp(weights.effort_penalty),
});

export const getActivePolicy = async (): Promise<RecommendationPolicy | null> => {
  const { data, error } = await supabase
    .from('recommendation_policies')
    .select('*')
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1);
  if (error) {
    throw new Error('Failed to load recommendation policy');
  }
  return data?.[0] ?? null;
};

export const updatePolicy = async (
  id: string,
  weights: RecommendationPolicyWeights
): Promise<RecommendationPolicy> => {
  const sanitized = sanitizeWeights(weights);

  const { data, error } = await supabase
    .from('recommendation_policies')
    .update({
      weights: sanitized,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error('Failed to update recommendation policy');
  }

  return data as RecommendationPolicy;
};
