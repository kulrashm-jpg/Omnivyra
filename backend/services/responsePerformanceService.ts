/**
 * Response Performance Service
 * Tracks performance of AI-generated replies for the Response Learning Engine.
 */

import { supabase } from '../db/supabaseClient';
import { recordMetric } from './systemHealthMetricsService';

export type RecordReplyInput = {
  organization_id: string;
  thread_id: string;
  message_id: string;
  platform: string;
  ai_generated: boolean;
};

export async function recordReplyPerformance(input: RecordReplyInput): Promise<string | null> {
  if (!input.organization_id || !input.thread_id || !input.message_id || !input.platform) {
    return null;
  }

  const { data, error } = await supabase
    .from('response_performance_metrics')
    .insert({
      organization_id: input.organization_id,
      thread_id: input.thread_id,
      message_id: input.message_id,
      platform: input.platform,
      reply_type: 'reply',
      ai_generated: input.ai_generated ?? false,
      created_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    console.warn('[responsePerformance] recordReplyPerformance error', error.message);
    return null;
  }
  void recordMetric('response_learning_engine', 'replies_recorded', 1, 'count').catch(() => {});
  return (data as { id: string })?.id ?? null;
}

export async function incrementReplyLike(liked_message_id: string): Promise<void> {
  if (!liked_message_id) return;

  const { error } = await supabase.rpc('increment_response_perf_like', {
    p_liked_message_id: liked_message_id,
  });

  if (error) {
    console.warn('[responsePerformance] incrementReplyLike error', error.message);
  } else {
    void recordMetric('response_learning_engine', 'likes_recorded', 1, 'count').catch(() => {});
  }
}

export async function incrementReplyFollowup(
  thread_id: string,
  new_message_platform_created_at: string
): Promise<void> {
  if (!thread_id) return;

  const { error } = await supabase.rpc('increment_response_perf_followup', {
    p_thread_id: thread_id,
    p_new_message_platform_created_at: new_message_platform_created_at,
  });

  if (error) {
    console.warn('[responsePerformance] incrementReplyFollowup error', error.message);
  }
}

export async function markLeadConversion(thread_id: string): Promise<void> {
  if (!thread_id) return;

  const { error } = await supabase
    .from('response_performance_metrics')
    .update({
      lead_conversion: true,
    })
    .eq('thread_id', thread_id)
    .eq('evaluation_window_closed', false);

  if (error) {
    console.warn('[responsePerformance] markLeadConversion error', error.message);
  } else {
    void recordMetric('response_learning_engine', 'lead_conversions', 1, 'count').catch(() => {});
  }
}
