/**
 * Strategic Feedback Service
 *
 * Deterministic analysis of engagement + AI actions to produce strategic insights.
 * Read + analyze + store only. No AI calls, no automation.
 * Foundation for weekly strategy integration.
 */

import { supabase } from '../db/supabaseClient';
import { getLatestCampaignVersionByCampaignId } from '../db/campaignVersionStore';

const NEGATIVE_SIGNALS = ['problem', 'bad', 'issue', 'not working'];
const RECENT_FEEDBACK_HOURS = 24;

export type StrategicFeedbackPayload = {
  insights: string[];
  metrics: {
    total_posts_published: number;
    total_comments: number;
    avg_comments_per_post: number;
    action_counts: { reply: number; like: number; share: number; follow: number };
    comment_signals: {
      negative_count: number;
      question_count: number;
      long_engagement_count: number;
      total_with_signals: number;
    };
  };
  generated_at: string;
};

/**
 * Load scheduled_posts for campaign, post_comments linked by scheduled_post_id,
 * and community_ai_actions linked by target_id (platform_post_id or platform_comment_id) + tenant/org.
 */
async function loadCampaignEngagementData(campaign_id: string): Promise<{
  posts: any[];
  comments: any[];
  actions: any[];
  campaignUserId: string | null;
}> {
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, user_id')
    .eq('id', campaign_id)
    .single();
  if (!campaign?.id) {
    return { posts: [], comments: [], actions: [], campaignUserId: null };
  }

  const { data: posts } = await supabase
    .from('scheduled_posts')
    .select('id, platform, platform_post_id')
    .eq('campaign_id', campaign_id)
    .eq('status', 'published');

  const postList = posts ?? [];
  const postIds = postList.map((p: any) => p.id);
  const platformPostIds = new Set(
    postList.map((p: any) => p.platform_post_id).filter(Boolean)
  );

  let comments: any[] = [];
  if (postIds.length > 0) {
    const { data: commentRows } = await supabase
      .from('post_comments')
      .select('*')
      .in('scheduled_post_id', postIds);
    comments = commentRows ?? [];
  }

  const platformCommentIds = new Set(
    comments.map((c: any) => c.platform_comment_id).filter(Boolean)
  );
  const version = await getLatestCampaignVersionByCampaignId(campaign_id);
  const companyId = version?.company_id ? String(version.company_id) : null;

  let actions: any[] = [];
  if (companyId && (platformPostIds.size > 0 || platformCommentIds.size > 0)) {
    const { data: actionRows } = await supabase
      .from('community_ai_actions')
      .select('*')
      .eq('tenant_id', companyId)
      .eq('organization_id', companyId)
      .in('status', ['pending', 'approved', 'executed']);
    const allActions = actionRows ?? [];
    actions = allActions.filter((a: any) => {
      const tid = (a.target_id ?? '').toString().trim();
      return platformPostIds.has(tid) || platformCommentIds.has(tid);
    });
  }

  return {
    posts: postList,
    comments,
    actions,
    campaignUserId: campaign.user_id ?? null,
  };
}

/**
 * Compute comment signals (negative, question, long) from comment content.
 */
function computeCommentSignals(comments: any[]): {
  negative_count: number;
  question_count: number;
  long_engagement_count: number;
  total_with_signals: number;
} {
  let negative_count = 0;
  let question_count = 0;
  let long_engagement_count = 0;
  const contentSet = new Set<string>();
  for (const c of comments) {
    const text = (c.content ?? '').toString().trim();
    if (!text) continue;
    const lower = text.toLowerCase();
    if (NEGATIVE_SIGNALS.some((w) => lower.includes(w))) negative_count += 1;
    if (text.includes('?')) question_count += 1;
    if (text.length > 120) long_engagement_count += 1;
    contentSet.add(text);
  }
  const total_with_signals =
    comments.filter((c) => {
      const t = (c.content ?? '').toString().trim();
      return (
        t.length > 0 &&
        (NEGATIVE_SIGNALS.some((w) => t.toLowerCase().includes(w)) ||
          t.includes('?') ||
          t.length > 120)
      );
    }).length;
  return {
    negative_count,
    question_count,
    long_engagement_count,
    total_with_signals,
  };
}

/**
 * Generate insight strings from metrics (deterministic rules).
 */
function generateInsights(
  metrics: StrategicFeedbackPayload['metrics'],
  commentSignals: ReturnType<typeof computeCommentSignals>
): string[] {
  const insights: string[] = [];
  const { total_comments, avg_comments_per_post, action_counts } = metrics;
  const totalActions =
    (action_counts.reply ?? 0) +
    (action_counts.like ?? 0) +
    (action_counts.share ?? 0) +
    (action_counts.follow ?? 0);
  const commentCount = total_comments;

  if (avg_comments_per_post < 1 && metrics.total_posts_published > 0) {
    insights.push(
      'Low engagement per post — consider adjusting content hook or format.'
    );
  }

  if (commentCount > 0) {
    const pctQuestion = (commentSignals.question_count / commentCount) * 100;
    if (pctQuestion >= 30) {
      insights.push(
        'High question volume detected — consider more explanatory content.'
      );
    }

    const pctNegative = (commentSignals.negative_count / commentCount) * 100;
    if (pctNegative >= 20) {
      insights.push(
        'High negative feedback detected — review messaging or product clarity.'
      );
    }
  }

  if (totalActions > 0 && action_counts.reply >= totalActions * 0.5) {
    insights.push(
      'Strong conversational engagement — prioritize reply-driven content.'
    );
  }

  return insights;
}

/**
 * Generate strategic feedback for a campaign and optionally store it.
 */
export async function generateStrategicFeedback(
  campaign_id: string
): Promise<StrategicFeedbackPayload> {
  const { posts, comments, actions, campaignUserId } =
    await loadCampaignEngagementData(campaign_id);

  const total_posts_published = posts.length;
  const total_comments = comments.length;
  const avg_comments_per_post =
    total_posts_published > 0
      ? Math.round((total_comments / total_posts_published) * 10) / 10
      : 0;

  const action_counts = {
    reply: actions.filter((a: any) => (a.action_type ?? '').toString().toLowerCase() === 'reply').length,
    like: actions.filter((a: any) => (a.action_type ?? '').toString().toLowerCase() === 'like').length,
    share: actions.filter((a: any) => (a.action_type ?? '').toString().toLowerCase() === 'share').length,
    follow: actions.filter((a: any) => (a.action_type ?? '').toString().toLowerCase() === 'follow').length,
  };

  const comment_signals = computeCommentSignals(comments);

  const metrics: StrategicFeedbackPayload['metrics'] = {
    total_posts_published,
    total_comments,
    avg_comments_per_post,
    action_counts,
    comment_signals,
  };

  const insights = generateInsights(metrics, comment_signals);
  const generated_at = new Date().toISOString();

  const payload: StrategicFeedbackPayload = {
    insights,
    metrics,
    generated_at,
  };

  await storeStrategicFeedback(campaign_id, campaignUserId, payload);

  return payload;
}

const STRATEGIC_FEEDBACK_ACTION_TYPE = 'strategic_feedback_generated';

/**
 * Store feedback in activity_feed (entity_type = campaign, entity_id = campaign_id, metadata = payload).
 * activity_feed requires user_id; use campaign owner when available.
 */
async function storeStrategicFeedback(
  campaign_id: string,
  campaignUserId: string | null,
  payload: StrategicFeedbackPayload
): Promise<void> {
  const user_id = campaignUserId ?? (await getSystemUserId());
  const { error } = await supabase.from('activity_feed').insert({
    user_id,
    action_type: STRATEGIC_FEEDBACK_ACTION_TYPE,
    entity_type: 'campaign',
    entity_id: campaign_id,
    campaign_id,
    metadata: {
      insights: payload.insights,
      metrics_summary: payload.metrics,
      generated_at: payload.generated_at,
    },
    created_at: new Date().toISOString(),
  });
  if (error) {
    console.warn('[strategicFeedback] store failed', error.message);
  }
}

async function getSystemUserId(): Promise<string> {
  const { data } = await supabase
    .from('users')
    .select('id')
    .limit(1)
    .order('created_at', { ascending: true })
    .maybeSingle();
  return data?.id ?? '00000000-0000-0000-0000-000000000000';
}

/**
 * Return the latest stored strategic feedback for a campaign (from activity_feed).
 */
export async function getLatestStrategicFeedback(
  campaign_id: string
): Promise<StrategicFeedbackPayload | null> {
  const { data, error } = await supabase
    .from('activity_feed')
    .select('metadata, created_at')
    .eq('campaign_id', campaign_id)
    .eq('action_type', STRATEGIC_FEEDBACK_ACTION_TYPE)
    .eq('entity_type', 'campaign')
    .eq('entity_id', campaign_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.metadata) return null;
  const meta = data.metadata as Record<string, any>;
  const insights = Array.isArray(meta.insights) ? meta.insights : [];
  const metrics_summary = meta.metrics_summary ?? {};
  const generated_at = meta.generated_at ?? data.created_at ?? new Date().toISOString();
  return {
    insights,
    metrics: metrics_summary,
    generated_at,
  };
}

/**
 * Check if we have recent feedback (within RECENT_FEEDBACK_HOURS).
 */
export async function hasRecentStrategicFeedback(
  campaign_id: string
): Promise<boolean> {
  const cutoff = new Date(Date.now() - RECENT_FEEDBACK_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('activity_feed')
    .select('id')
    .eq('campaign_id', campaign_id)
    .eq('action_type', STRATEGIC_FEEDBACK_ACTION_TYPE)
    .gte('created_at', cutoff)
    .limit(1)
    .maybeSingle();
  return !error && !!data?.id;
}
