/**
 * Engagement Evaluation Service
 *
 * Triggers Community AI evaluation when engagement (comments) exists for a post.
 * Builds input from scheduled_post + post_comments, calls evaluateEngagement,
 * persists suggested_actions into community_ai_actions (pending only).
 * No auto-execution, no approval, no scoring — wiring only.
 *
 * @see docs/CANONICAL-SOCIAL-PLATFORM-OPERATIONS-DESIGN.md
 */

import { supabase } from '../db/supabaseClient';
import { getScheduledPost } from '../db/queries';
import { getLatestCampaignVersionByCampaignId } from '../db/campaignVersionStore';
import { getProfile } from './companyProfileService';
import { evaluateEngagement } from './communityAiOmnivyraService';

export type EvaluatePostEngagementResult = {
  success: boolean;
  actionsCreated: number;
  error?: string;
};

/**
 * Derive tenant_id and organization_id from scheduled_post's campaign (campaign_versions.company_id).
 * Community AI uses tenant_id === organization_id === company_id in existing patterns.
 */
async function resolveTenantOrg(scheduled_post_id: string): Promise<{
  tenant_id: string;
  organization_id: string;
} | null> {
  const post = await getScheduledPost(scheduled_post_id);
  if (!post?.campaign_id) return null;
  const version = await getLatestCampaignVersionByCampaignId(post.campaign_id);
  if (!version?.company_id) return null;
  const companyId = String(version.company_id).trim();
  if (!companyId) return null;
  return { tenant_id: companyId, organization_id: companyId };
}

/**
 * Resolve brand_voice for organization (company).
 */
async function resolveBrandVoice(organizationId: string): Promise<string> {
  const profile = await getProfile(organizationId, { autoRefine: false });
  const listEntry = Array.isArray(profile?.brand_voice_list) ? profile.brand_voice_list[0] : null;
  const voice = (listEntry ?? profile?.brand_voice ?? '').toString().trim();
  return voice.length > 0 ? voice : 'professional';
}

/**
 * Best-effort dedupe: check if an action already exists by platform + target_id + action_type + suggested_text.
 * No schema change.
 */
/**
 * Best-effort: exists if (platform, target_id, action_type, suggested_text) already present.
 */
async function actionExists(
  tenant_id: string,
  organization_id: string,
  platform: string,
  target_id: string,
  action_type: string,
  suggested_text: string | null
): Promise<boolean> {
  let query = supabase
    .from('community_ai_actions')
    .select('id')
    .eq('tenant_id', tenant_id)
    .eq('organization_id', organization_id)
    .eq('platform', platform)
    .eq('target_id', target_id)
    .eq('action_type', action_type)
    .limit(1);
  if (suggested_text != null && suggested_text !== '') {
    query = query.eq('suggested_text', suggested_text);
  }
  const { data, error } = await query;
  if (error) return true;
  return (data?.length ?? 0) > 0;
}

async function getCommentsForScheduledPost(scheduled_post_id: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('post_comments')
    .select('*')
    .eq('scheduled_post_id', scheduled_post_id)
    .order('platform_created_at', { ascending: true });
  if (error) return [];
  return data ?? [];
}

/**
 * Persist a single suggested action with status pending if not already existing (best-effort dedupe).
 */
async function persistAction(
  tenant_id: string,
  organization_id: string,
  platform: string,
  action: any
): Promise<boolean> {
  const target_id =
    action.target_id ??
    action.targetId ??
    action.post_id ??
    action.postId ??
    action.comment_id ??
    action.commentId ??
    action.profile_id ??
    action.profileId ??
    action.target;
  if (!target_id) return false;
  const action_type = (action.action_type ?? action.actionType ?? '').toString().toLowerCase();
  if (!['like', 'reply', 'share', 'follow', 'schedule'].includes(action_type)) return false;
  const suggested_text =
    action.suggested_text ?? action.suggestedText ?? action.text ?? null;
  const exists = await actionExists(
    tenant_id,
    organization_id,
    platform,
    String(target_id),
    action_type,
    suggested_text != null ? String(suggested_text) : null
  );
  if (exists) return false;
  const { error } = await supabase.from('community_ai_actions').insert({
    tenant_id,
    organization_id,
    platform,
    action_type,
    target_id: String(target_id),
    suggested_text: suggested_text != null ? String(suggested_text) : null,
    tone: action.tone ?? null,
    risk_level: action.risk_level ?? null,
    requires_human_approval: true,
    requires_approval: true,
    status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (error) {
    console.warn('[EngagementEvaluation] insert action failed', error.message);
    return false;
  }
  return true;
}

/**
 * Trigger Community AI evaluation for a scheduled post when engagement exists.
 * Skips if comments count = 0. Persists suggested_actions into community_ai_actions (pending).
 * Does not execute or auto-approve.
 */
export async function evaluatePostEngagement(
  scheduled_post_id: string
): Promise<EvaluatePostEngagementResult> {
  const post = await getScheduledPost(scheduled_post_id);
  if (!post) {
    return { success: false, actionsCreated: 0, error: 'Scheduled post not found' };
  }

  const comments = await getCommentsForScheduledPost(scheduled_post_id);
  if (comments.length === 0) {
    return { success: true, actionsCreated: 0 };
  }

  const tenantOrg = await resolveTenantOrg(scheduled_post_id);
  if (!tenantOrg) {
    return {
      success: false,
      actionsCreated: 0,
      error: 'Could not resolve tenant/org from campaign',
    };
  }

  const brand_voice = await resolveBrandVoice(tenantOrg.organization_id);
  const platform = (post.platform ?? '').toString().trim() || 'linkedin';
  const recentCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recentComments = comments.filter(
    (c: any) => c.platform_created_at && c.platform_created_at >= recentCutoff
  );

  const input = {
    tenant_id: tenantOrg.tenant_id,
    organization_id: tenantOrg.organization_id,
    platform,
    post_data: {
      scheduled_post_id: post.id,
      platform_post_id: post.platform_post_id,
      content: post.content?.slice(0, 500),
      platform,
    },
    engagement_activity: comments,
    engagement_metrics: {
      total_comments: comments.length,
      recent_comments: recentComments.length,
    },
    brand_voice,
    context: { source: 'engagement_evaluation', scheduled_post_id },
  };

  console.log('[EngagementEvaluation] scheduled_post_id=%s comments=%s', scheduled_post_id, comments.length);

  let output;
  try {
    output = await evaluateEngagement(input);
  } catch (e: any) {
    console.warn('[EngagementEvaluation] evaluateEngagement failed', e?.message);
    return {
      success: false,
      actionsCreated: 0,
      error: e?.message ?? 'Evaluation failed',
    };
  }

  const suggested = output.suggested_actions ?? [];
  let actionsCreated = 0;
  for (const action of suggested) {
    const inserted = await persistAction(
      tenantOrg.tenant_id,
      tenantOrg.organization_id,
      platform,
      action
    );
    if (inserted) actionsCreated += 1;
  }

  console.log('[EngagementEvaluation] actions_created=%s', actionsCreated);
  return { success: true, actionsCreated };
}
