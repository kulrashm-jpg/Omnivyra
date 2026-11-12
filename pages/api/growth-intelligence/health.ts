/**
 * GET /api/growth-intelligence/health
 * Diagnostics endpoint to validate Growth Intelligence system operation.
 * Phase-1 Read-Only. SELECT queries only.
 * Auth: RBAC COMPANY_ADMIN, VIEW_ONLY, CONTENT_*
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { resolveCampaignIdsForCompany } from '../../../backend/services/growthIntelligence';
import { tenantChildTableOf, tenantContextFor, tenantTable } from '../../../backend/db/tenantTable';

/** tenantChildTableOf verifies at most 200 parents per call; larger sets are counted chunk by chunk. */
const PARENT_CHUNK = 200;
/** PostgREST returns at most max-rows (1000 by default) per unpaginated read: ids are paged explicitly. */
const PAGE = 1000;
function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type SystemHealth = 'healthy' | 'partial' | 'empty';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const companyId = (req.query.companyId as string)?.trim?.();
  if (!companyId) {
    return res.status(400).json({ success: false, error: 'companyId is required' });
  }

  try {
    const access = await enforceCompanyAccess({ req, res, companyId });
    if (!access) return;
    // S2 tenant seam (e1): every count below is read under the context of THIS access check.
    const tenant = tenantContextFor(access, companyId);

    // The tenant's OWN campaigns (the former member-created fallback counted other companies' campaigns).
    const campaignIds = await resolveCampaignIdsForCompany(tenant);
    const campaignCount = campaignIds.length;

    let scheduledPostCount = 0;
    let analyticsRecords = 0;

    // scheduled_posts is a child of campaigns: tenantChildTableOf verifies every campaign is this tenant's in one
    // read per chunk (a foreign id refuses the whole call) before the posts are read.
    const postIds: string[] = [];
    for (const part of chunks(campaignIds, PARENT_CHUNK)) {
      const posts = await tenantChildTableOf('scheduled_posts', tenant, part);
      const { count, error: countErr } = await posts.select('id', { count: 'exact', head: true });
      if (countErr) throw new Error('scheduled posts unreadable');
      scheduledPostCount += count ?? 0;
      // Ids feed the analytics count. Paged with a stable order: an unpaginated read stops at PostgREST's
      // max-rows (1000) and used to undercount analyticsRecords for large accounts (e9: a shown metric being wrong
      // is a finding).
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await posts.select('id').order('id', { ascending: true }).range(from, from + PAGE - 1);
        if (error) throw new Error('scheduled posts unreadable');
        const rows = (data ?? []) as Array<{ id?: string | null }>;
        for (const r of rows) if (r.id) postIds.push(r.id);
        if (rows.length < PAGE) break;
      }
    }

    // content_analytics has no tenant column (registry: UNCLASSIFIED); it is read ONLY for post ids that were
    // just read through the seam above, so every counted row belongs to this tenant's posts. Exact counts per chunk.
    // TODO(S2): once 55's migration 20270217000026 (content_analytics.company_id, denormalised + backfilled) lands,
    // read content_analytics through the seam directly instead of by verified post ids.
    for (const part of chunks(postIds, PARENT_CHUNK)) {
      const { count, error } = await supabase
        .from('content_analytics')
        .select('id', { count: 'exact', head: true })
        .in('scheduled_post_id', part);
      if (error) throw new Error('content analytics unreadable');
      analyticsRecords += count ?? 0;
    }

    const { count: communityCount, error: communityErr } = await tenantTable('community_ai_actions', tenant)
      .select('id', { count: 'exact', head: true });
    if (communityErr) throw new Error('community actions unreadable');
    const communityActions = communityCount ?? 0;

    const { count: opportunityCount, error: opportunityErr } = await tenantTable('theme_company_relevance', tenant)
      .select('id', { count: 'exact', head: true });
    if (opportunityErr) throw new Error('opportunity signals unreadable');
    const opportunitySignals = opportunityCount ?? 0;

    const hasCampaigns = campaignCount > 0;
    const hasScheduledPosts = scheduledPostCount > 0;
    const hasAnalytics = analyticsRecords > 0;
    const hasCommunityData = communityActions > 0;
    const hasOpportunitySignals = opportunitySignals > 0;

    let systemHealth: SystemHealth = 'empty';
    if (hasCampaigns && hasScheduledPosts) {
      systemHealth = 'healthy';
    } else if (hasCampaigns) {
      systemHealth = 'partial';
    }

    return res.status(200).json({
      success: true,
      data: {
        companyId,
        authorizedCompanyId: tenant.companyId,
        counts: {
          campaigns: campaignCount,
          scheduledPosts: scheduledPostCount,
          analyticsRecords,
          communityActions,
          opportunitySignals,
        },
        flags: {
          hasCampaigns,
          hasScheduledPosts,
          hasAnalytics,
          hasCommunityData,
          hasOpportunitySignals,
        },
        systemHealth,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Health check failed';
    return res.status(500).json({ success: false, error: message });
  }
}

export default withRBAC(handler, [
  Role.COMPANY_ADMIN,
  Role.VIEW_ONLY,
  Role.CONTENT_CREATOR,
  Role.CONTENT_REVIEWER,
  Role.CONTENT_PUBLISHER,
  Role.SUPER_ADMIN,
]);
