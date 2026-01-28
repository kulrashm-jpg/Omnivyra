/**
 * Publish Integration
 * 
 * Integrates P2 services into the publish workflow:
 * - Analytics recording
 * - Activity logging
 * - Error categorization
 */

import { recordPostAnalytics } from '../services/analyticsService';
import { logActivity } from '../services/activityLogger';
import { categorizeError } from '../services/errorRecoveryService';

export interface PublishIntegrationOptions {
  scheduled_post_id: string;
  user_id: string;
  platform: string;
  campaign_id?: string;
  platform_post_id?: string;
  post_url?: string;
}

/**
 * Integrate analytics and activity logging after successful publish
 */
export async function integratePublishSuccess(options: PublishIntegrationOptions): Promise<void> {
  const { scheduled_post_id, user_id, platform, campaign_id, platform_post_id } = options;

  // Record analytics (initial metrics - will be updated when fetching from platform APIs)
  try {
    await recordPostAnalytics(
      scheduled_post_id,
      user_id,
      platform,
      {
        views: 0,
        likes: 0,
        shares: 0,
        comments: 0,
      },
      {}
    );
  } catch (error: any) {
    console.warn('Failed to record analytics:', error.message);
  }

  // Log activity
  try {
    await logActivity(user_id, 'post_published', 'post', scheduled_post_id, {
      campaign_id,
      platform,
      platform_post_id,
    });
  } catch (error: any) {
    console.warn('Failed to log activity:', error.message);
  }
}

/**
 * Integrate error handling with categorization
 */
export async function integratePublishError(
  scheduled_post_id: string,
  platform: string,
  error: any
): Promise<{
  code: string;
  user_message: string;
  recovery_suggestions: string[];
}> {
  const platformError = categorizeError(platform, error);

  // Update scheduled_post with error code
  const { supabase } = await import('../db/supabaseClient');
  await supabase
    .from('scheduled_posts')
    .update({
      error_code: platformError.code,
      error_message: platformError.user_message,
    })
    .eq('id', scheduled_post_id);

  return {
    code: platformError.code,
    user_message: platformError.user_message,
    recovery_suggestions: platformError.recovery_suggestions,
  };
}

