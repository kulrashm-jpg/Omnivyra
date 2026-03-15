/**
 * Engagement Signal Integrity Service
 * Validates signal-activity mappings and detects orphan/invalid data.
 */

import { supabase } from '../db/supabaseClient';

export type IntegrityIssue = {
  type: 'orphan_signal' | 'invalid_activity' | 'missing_campaign';
  signal_id?: string;
  activity_id?: string;
  campaign_id?: string;
  external_post_id?: string;
  detail: string;
};

export type ValidateResult = {
  valid: boolean;
  issues: IntegrityIssue[];
};

/**
 * Validate signals for an activity.
 */
export async function validateSignal(activityId: string): Promise<ValidateResult> {
  const issues: IntegrityIssue[] = [];

  const { data: plan } = await supabase
    .from('daily_content_plans')
    .select('id, campaign_id, external_post_id, scheduled_post_id')
    .or(`id.eq.${activityId},execution_id.eq.${activityId}`)
    .limit(1)
    .maybeSingle();

  if (!plan) {
    issues.push({
      type: 'invalid_activity',
      activity_id: activityId,
      detail: 'Activity not found in daily_content_plans',
    });
    return { valid: false, issues };
  }

  const campaignId = (plan as { campaign_id?: string }).campaign_id;
  if (!campaignId) {
    issues.push({
      type: 'missing_campaign',
      activity_id: activityId,
      detail: 'Activity has no campaign_id',
    });
  }

  const { data: signals } = await supabase
    .from('campaign_activity_engagement_signals')
    .select('id, campaign_id, activity_id')
    .eq('activity_id', activityId);

  for (const s of signals ?? []) {
    const sig = s as { id: string; campaign_id: string; activity_id: string };
    if (sig.campaign_id !== campaignId) {
      issues.push({
        type: 'orphan_signal',
        signal_id: sig.id,
        activity_id: activityId,
        campaign_id: sig.campaign_id,
        detail: 'Signal campaign_id does not match activity campaign',
      });
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Verify external_post_id mapping exists and is resolvable.
 */
export async function verifyPostMapping(external_post_id: string): Promise<{
  found: boolean;
  activity_id?: string;
  campaign_id?: string;
  issues: string[];
}> {
  const issues: string[] = [];

  const { data: byExternal } = await supabase
    .from('daily_content_plans')
    .select('id, campaign_id')
    .eq('external_post_id', external_post_id)
    .limit(1)
    .maybeSingle();

  if (byExternal) {
    return {
      found: true,
      activity_id: (byExternal as { id: string }).id,
      campaign_id: (byExternal as { campaign_id: string }).campaign_id,
      issues: [],
    };
  }

  const { data: byScheduled } = await supabase
    .from('scheduled_posts')
    .select('id')
    .eq('platform_post_id', external_post_id)
    .maybeSingle();

  if (byScheduled) {
    const { data: plan } = await supabase
      .from('daily_content_plans')
      .select('id, campaign_id')
      .eq('scheduled_post_id', (byScheduled as { id: string }).id)
      .maybeSingle();

    if (plan) {
      return {
        found: true,
        activity_id: (plan as { id: string }).id,
        campaign_id: (plan as { campaign_id: string }).campaign_id,
        issues: [],
      };
    }
  }

  issues.push(`external_post_id ${external_post_id} not linked to any activity`);
  return { found: false, issues };
}
