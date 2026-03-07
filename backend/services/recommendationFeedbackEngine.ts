/**
 * Recommendation Feedback Engine
 * Phase 5: Feedback with spam protection (1 per recommendation per user per hour)
 */

import { supabase } from '../db/supabaseClient';

export type FeedbackType = 'accepted' | 'ignored' | 'executed' | 'successful' | 'failed';

export type FeedbackRecord = {
  company_id: string;
  recommendation_id: string;
  user_id: string;
  feedback_type: FeedbackType;
  feedback_score?: number | null;
};

const FEEDBACK_SCORE: Record<FeedbackType, number> = {
  accepted: 0.7,
  ignored: 0.2,
  executed: 0.8,
  successful: 1,
  failed: 0.3,
};

const THROTTLE_HOURS = 1;

/**
 * Record feedback. Enforces 1 feedback per recommendation per user per hour.
 */
export async function recordFeedback(
  input: FeedbackRecord
): Promise<{ id: string | null; inserted: boolean; throttle_hit?: boolean }> {
  const since = new Date();
  since.setHours(since.getHours() - THROTTLE_HOURS);
  const sinceStr = since.toISOString();

  const { data: recent } = await supabase
    .from('recommendation_feedback')
    .select('id')
    .eq('recommendation_id', input.recommendation_id)
    .eq('user_id', input.user_id)
    .gte('created_at', sinceStr)
    .limit(1);

  if (recent && recent.length > 0) {
    return { id: null, inserted: false, throttle_hit: true };
  }

  const feedbackScore = input.feedback_score ?? FEEDBACK_SCORE[input.feedback_type as FeedbackType];

  const { data, error } = await supabase
    .from('recommendation_feedback')
    .insert({
      company_id: input.company_id,
      recommendation_id: input.recommendation_id,
      user_id: input.user_id,
      feedback_type: input.feedback_type,
      feedback_score: Math.min(1, Math.max(0, feedbackScore)),
    })
    .select('id')
    .single();

  if (error) throw new Error(`recommendation_feedback insert failed: ${error.message}`);
  return { id: data?.id ?? null, inserted: true };
}

/**
 * Get feedback for a company.
 */
export async function getFeedbackForCompany(
  companyId: string,
  options?: { limit?: number }
): Promise<Array<{
  id: string;
  recommendation_id: string;
  user_id: string;
  feedback_type: string;
  feedback_score: number | null;
  created_at: string;
}>> {
  const { data, error } = await supabase
    .from('recommendation_feedback')
    .select('id, recommendation_id, user_id, feedback_type, feedback_score, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(options?.limit ?? 100);

  if (error) throw new Error(`Failed to fetch feedback: ${error.message}`);
  return (data ?? []) as Array<{
    id: string;
    recommendation_id: string;
    user_id: string;
    feedback_type: string;
    feedback_score: number | null;
    created_at: string;
  }>;
}
