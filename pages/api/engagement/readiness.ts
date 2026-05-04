import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';
import { createServiceRoleMigrationProxy } from '../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');

type ReadinessResponse = {
  connected_platforms: string[];
  active_social_accounts: number;
  published_posts: number;
  ingestion_candidates: number;
  raw_comments: number;
  messages: number;
  threads: number;
  blockers: string[];
};

async function getCompanyUserIds(companyId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('user_company_' + 'roles')
    .select('user_id')
    .eq('company_id', companyId)
    .eq('status', 'active');

  if (error) {
    throw new Error(`Failed to load company users: ${error.message}`);
  }

  return (data ?? []).map((row: { user_id: string }) => row.user_id).filter(Boolean);
}

async function handler(req: NextApiRequest, res: NextApiResponse<ReadinessResponse | { error: string }>) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const organizationId = (req.query.organization_id ?? req.query.organizationId ?? user?.defaultCompanyId) as string | undefined;

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id or organizationId required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    const userIds = await getCompanyUserIds(organizationId);
    if (userIds.length === 0) {
      return res.status(200).json({
        connected_platforms: [],
        active_social_accounts: 0,
        published_posts: 0,
        ingestion_candidates: 0,
        raw_comments: 0,
        messages: 0,
        threads: 0,
        blockers: ['No active company users are linked to this workspace yet.'],
      });
    }

    const { data: accounts, error: accountsError } = await supabase
      .from('social_accounts')
      .select('platform')
      .in('user_id', userIds)
      .eq('is_active', true);

    if (accountsError) {
      throw new Error(`Failed to load social accounts: ${accountsError.message}`);
    }

    const connectedPlatforms = Array.from(
      new Set(
        (accounts ?? [])
          .map((row: { platform: string }) => (row.platform || '').toLowerCase().trim())
          .filter(Boolean)
      )
    ).sort();

    const { data: companyCampaigns, error: campaignsError } = await supabase
      .from('campaigns')
      .select('id')
      .eq('company_id', organizationId);

    if (campaignsError) {
      throw new Error(`Failed to load campaigns: ${campaignsError.message}`);
    }

    const campaignIds = (companyCampaigns ?? []).map((row: { id: string }) => row.id).filter(Boolean);

    let publishedPosts = 0;
    let ingestionCandidates = 0;
    let rawComments = 0;

    if (campaignIds.length > 0) {
      const { data: publishedRows, error: postsError } = await supabase
        .from('scheduled_posts')
        .select('id, platform_post_id, social_account_id')
        .in('campaign_id', campaignIds)
        .eq('status', 'published');

      if (postsError) {
        throw new Error(`Failed to load published posts: ${postsError.message}`);
      }

      const publishedPostIds = (publishedRows ?? []).map((row: { id: string }) => row.id).filter(Boolean);
      publishedPosts = publishedPostIds.length;
      ingestionCandidates = (publishedRows ?? []).filter(
        (row: { platform_post_id?: string | null; social_account_id?: string | null }) =>
          Boolean(row.platform_post_id) && Boolean(row.social_account_id)
      ).length;

      if (publishedPostIds.length > 0) {
        const { count: commentsCount, error: commentsError } = await supabase
          .from('post_comments')
          .select('id', { count: 'exact', head: true })
          .in('scheduled_post_id', publishedPostIds);

        if (commentsError) {
          throw new Error(`Failed to load raw comments: ${commentsError.message}`);
        }

        rawComments = commentsCount ?? 0;
      }
    }

    const [{ count: messagesCount, error: messagesError }, { count: threadsCount, error: threadsError }] = await Promise.all([
      supabase
        .from('engagement_messages')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId),
      supabase
        .from('engagement_threads')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId),
    ]);

    if (messagesError) {
      throw new Error(`Failed to load engagement messages: ${messagesError.message}`);
    }
    if (threadsError) {
      throw new Error(`Failed to load engagement threads: ${threadsError.message}`);
    }

    const blockers: string[] = [];
    if (connectedPlatforms.length === 0) blockers.push('No connected social platform is available for engagement yet.');
    if (publishedPosts === 0) blockers.push('No content has been published from this workspace yet.');
    if (publishedPosts > 0 && ingestionCandidates === 0) blockers.push('Published posts are missing platform post IDs or linked social accounts.');
    if (ingestionCandidates > 0 && rawComments === 0) blockers.push('No external comments or replies have been pulled in for the published posts yet.');
    if (rawComments > 0 && (threadsCount ?? 0) === 0) blockers.push('Raw engagement exists, but unified engagement threads have not been built yet.');

    return res.status(200).json({
      connected_platforms: connectedPlatforms,
      active_social_accounts: accounts?.length ?? 0,
      published_posts: publishedPosts,
      ingestion_candidates: ingestionCandidates,
      raw_comments: rawComments,
      messages: messagesCount ?? 0,
      threads: threadsCount ?? 0,
      blockers,
    });
  } catch (err) {
    const message = (err as Error)?.message ?? 'Failed to load engagement readiness';
    console.error('[engagement/readiness]', message);
    return res.status(500).json({ error: message });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
  requiresOrg: true,
})(handler);

