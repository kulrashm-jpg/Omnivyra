/**
 * Engagement Opportunity Resolution Service
 * Tracks when opportunities are acted upon.
 */

import { supabase } from '../db/supabaseClient';

export async function resolveOpportunityByReply(
  thread_id: string,
  reply_message_id: string | null,
  user_id: string | null
): Promise<number> {
  const { data: opportunities, error: selectError } = await supabase
    .from('engagement_opportunities')
    .select('id')
    .eq('source_thread_id', thread_id)
    .eq('resolved', false);

  if (selectError || !opportunities?.length) return 0;

  const { error: updateError } = await supabase
    .from('engagement_opportunities')
    .update({
      resolved: true,
      resolved_at: new Date().toISOString(),
      resolved_by_message_id: reply_message_id ?? null,
      resolved_by_user_id: user_id ?? null,
      resolution_type: 'manual_reply',
    })
    .eq('source_thread_id', thread_id)
    .eq('resolved', false);

  if (updateError) {
    console.warn('[engagementOpportunityResolution] resolveByReply error', updateError.message);
    return 0;
  }

  return opportunities.length;
}

export async function resolveOpportunityManually(
  opportunity_id: string,
  user_id: string | null
): Promise<boolean> {
  const { error } = await supabase
    .from('engagement_opportunities')
    .update({
      resolved: true,
      resolved_at: new Date().toISOString(),
      resolved_by_user_id: user_id ?? null,
      resolution_type: 'manual_mark_resolved',
    })
    .eq('id', opportunity_id);

  if (error) {
    console.warn('[engagementOpportunityResolution] resolveManually error', error.message);
    return false;
  }

  return true;
}
