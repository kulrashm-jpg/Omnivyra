/**
 * Publish Now Service
 *
 * Minimal wrapper for immediate publish using the canonical pipeline.
 * Reuses the same logic as publishProcessor → platformAdapter.
 * Used by super-admin publish API and any caller that needs "publish now" without enqueueing.
 *
 * @see docs/CANONICAL-SOCIAL-PLATFORM-OPERATIONS-DESIGN.md
 */

import { supabase } from '../db/supabaseClient';
import {
  getScheduledPost,
  updateScheduledPostOnPublish,
  updateScheduledPostOnFailure,
} from '../db/queries';
import { publishToPlatform } from '../adapters/platformAdapter';
import { categorizeError } from './errorRecoveryService';
import { recordPostAnalytics } from './analyticsService';
import { logActivity } from './activityLogger';
import { checkAndCompleteCampaignIfEligible } from './CampaignCompletionService';

export type PublishNowInput = {
  scheduled_post_id: string;
  social_account_id: string;
  user_id: string;
};

export type PublishNowResult = {
  status: 'PUBLISHED' | 'FAILED';
  external_post_id?: string;
  post_url?: string;
  published_at?: string;
  message?: string;
  timestamp: string;
};

/**
 * Publish a scheduled post immediately using the canonical path (platformAdapter).
 * Behaves like a queue job executed synchronously: idempotency, same success/failure updates.
 */
export async function publishNow(input: PublishNowInput): Promise<PublishNowResult> {
  const { scheduled_post_id, social_account_id, user_id } = input;
  const timestamp = new Date().toISOString();

  const scheduledPost = await getScheduledPost(scheduled_post_id);
  if (!scheduledPost) {
    return {
      status: 'FAILED',
      message: `Scheduled post ${scheduled_post_id} not found`,
      timestamp,
    };
  }

  if (scheduledPost.platform_post_id) {
    return {
      status: 'PUBLISHED',
      external_post_id: scheduledPost.platform_post_id,
      post_url: scheduledPost.post_url,
      published_at: scheduledPost.published_at,
      timestamp,
    };
  }

  const result = await publishToPlatform(scheduled_post_id, social_account_id);

  if (result.success && result.platform_post_id) {
    await updateScheduledPostOnPublish(
      scheduled_post_id,
      result.platform_post_id,
      result.post_url || '',
      result.published_at
    );

    try {
      await recordPostAnalytics(
        scheduled_post_id,
        user_id,
        scheduledPost.platform,
        { views: 0, likes: 0, shares: 0, comments: 0 },
        {}
      );
    } catch (e: any) {
      console.warn('publishNow: recordPostAnalytics failed', e?.message);
    }

    try {
      await logActivity(user_id, 'post_published', 'post', scheduled_post_id, {
        campaign_id: scheduledPost.campaign_id,
        platform: scheduledPost.platform,
        platform_post_id: result.platform_post_id,
      });
    } catch (e: any) {
      console.warn('publishNow: logActivity failed', e?.message);
    }

    if (scheduledPost.campaign_id) {
      void checkAndCompleteCampaignIfEligible(scheduledPost.campaign_id).catch(() => {});
    }

    return {
      status: 'PUBLISHED',
      external_post_id: result.platform_post_id,
      post_url: result.post_url,
      published_at: result.published_at?.toISOString(),
      timestamp,
    };
  }

  const platformError = categorizeError(
    scheduledPost.platform,
    result.error || { message: 'Unknown error' }
  );
  // Use the raw message (actual error) so callers can surface it; fall back to user_message
  const errorDetail = platformError.message && platformError.message !== 'Unknown error'
    ? platformError.message
    : platformError.user_message;

  await updateScheduledPostOnFailure(scheduled_post_id, errorDetail);
  await supabase
    .from('scheduled_posts')
    .update({
      error_code: platformError.code,
      error_message: errorDetail,
    })
    .eq('id', scheduled_post_id);

  return {
    status: 'FAILED',
    message: errorDetail,
    timestamp,
  };
}
