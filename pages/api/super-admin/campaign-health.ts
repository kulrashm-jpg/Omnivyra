import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../backend/services/rbacService';

const requireSuperAdminAccess = async (
  req: NextApiRequest,
  res: NextApiResponse
): Promise<boolean> => {
  const hasSession = req.cookies?.super_admin_session === '1';
  if (hasSession) {
    console.debug('SUPER_ADMIN_LEGACY_SESSION', { path: req.url });
    return true;
  }
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id) {
    const isAdmin = await isPlatformSuperAdmin(user.id);
    if (!isAdmin) {
      res.status(403).json({ error: 'FORBIDDEN_ROLE' });
      return false;
    }
    return true;
  }
  res.status(403).json({ error: 'NOT_AUTHORIZED' });
  return false;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await requireSuperAdminAccess(req, res))) return;

  try {
    const { data: campaigns, error: campaignsError } = await supabase
      .from('campaigns')
      .select('id, company_id, status');

    if (campaignsError) {
      // Table may not exist yet — return empty health rather than 500
      console.warn('[campaign-health] campaigns query failed (table may not be migrated):', campaignsError.message);
      return res.status(200).json({
        total_campaigns: 0,
        active_campaigns: 0,
        approved_strategies: 0,
        proposed_strategies: 0,
        reapproval_required_count: 0,
        campaigns_by_company: [],
      });
    }

    const { data: versions, error: versionsError } = await supabase
      .from('campaign_versions')
      .select('id, campaign_id, status, created_at');

    if (versionsError) {
      // Table may not exist yet — continue with empty versions
      console.warn('[campaign-health] campaign_versions query failed (table may not be migrated):', versionsError.message);
    }

    const campaignRows = campaigns || [];
    const versionRows = versions || [];

    const versionsByCampaign = new Map<string, Array<any>>();
    for (const row of versionRows) {
      if (!row?.campaign_id) continue;
      const key = String(row.campaign_id);
      const list = versionsByCampaign.get(key) || [];
      list.push(row);
      versionsByCampaign.set(key, list);
    }

    const latestByCampaign = new Map<string, any>();
    const approvedExistsByCampaign = new Map<string, boolean>();
    versionsByCampaign.forEach((list, campaignId) => {
      const sorted = [...list].sort((a, b) => {
        const aTime = a?.created_at ? new Date(a.created_at).getTime() : 0;
        const bTime = b?.created_at ? new Date(b.created_at).getTime() : 0;
        return bTime - aTime;
      });
      latestByCampaign.set(campaignId, sorted[0] || null);
      approvedExistsByCampaign.set(
        campaignId,
        sorted.some((row) => row?.status === 'approved')
      );
    });

    let approvedStrategies = 0;
    let proposedStrategies = 0;
    let reapprovalRequiredCount = 0;

    const companyAgg = new Map<
      string,
      { company_id: string; total_campaigns: number; active_campaigns: number; reapproval_required: number }
    >();

    for (const campaign of campaignRows) {
      if (!campaign?.id) continue;
      const campaignId = String(campaign.id);
      const companyId = campaign.company_id ? String(campaign.company_id) : 'unknown';

      const latest = latestByCampaign.get(campaignId);
      const approvedExists = approvedExistsByCampaign.get(campaignId) || false;
      const latestStatus = latest?.status ?? null;

      if (latestStatus === 'approved') approvedStrategies += 1;
      if (latestStatus === 'proposed') proposedStrategies += 1;
      const reapprovalRequired =
        latestStatus === 'proposed' && approvedExists && latest?.id !== undefined;
      if (reapprovalRequired) reapprovalRequiredCount += 1;

      const existing = companyAgg.get(companyId) || {
        company_id: companyId,
        total_campaigns: 0,
        active_campaigns: 0,
        reapproval_required: 0,
      };
      existing.total_campaigns += 1;
      if (campaign.status === 'active') existing.active_campaigns += 1;
      if (reapprovalRequired) existing.reapproval_required += 1;
      companyAgg.set(companyId, existing);
    }

    return res.status(200).json({
      total_campaigns: campaignRows.length,
      active_campaigns: campaignRows.filter((row) => row.status === 'active').length,
      approved_strategies: approvedStrategies,
      proposed_strategies: proposedStrategies,
      reapproval_required_count: reapprovalRequiredCount,
      campaigns_by_company: Array.from(companyAgg.values()),
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'FAILED_TO_BUILD_CAMPAIGN_HEALTH' });
  }
}
