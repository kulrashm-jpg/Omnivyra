import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../utils/supabaseClient';
import { resolveUserContext } from '../../../backend/services/userContextService';
import {
  ALL_ROLES,
  getUserCompanyRole,
  getUserRole,
  hasPermission,
  isPlatformSuperAdmin,
  isSuperAdmin,
  Role,
} from '../../../backend/services/rbacService';
import { withRBAC } from '../../../backend/middleware/withRBAC';

const mapCampaignPlaybook = (campaign: any) => ({
  ...campaign,
  // Playbooks are informational only:
  // - Do NOT drive scheduling
  // - Do NOT alter publishing logic
  // - Do NOT affect approvals
  playbook: campaign.virality_playbooks
    ? {
        id: campaign.virality_playbooks.id,
        name: campaign.virality_playbooks.name,
        objective: campaign.virality_playbooks.objective,
        platforms: campaign.virality_playbooks.platforms,
        content_types: campaign.virality_playbooks.content_types,
      }
    : null,
});

const requireCompanyRole = async (
  req: NextApiRequest,
  res: NextApiResponse,
  companyId?: string,
  allowedRoles: Role[] = []
) => {
  if (!companyId) {
    res.status(400).json({ error: 'companyId required' });
    return null;
  }
  const user = await resolveUserContext(req);
  const platformAdmin = await isPlatformSuperAdmin(user.userId);
  if (platformAdmin && allowedRoles.includes(Role.SUPER_ADMIN)) {
    return { userId: user.userId, role: Role.SUPER_ADMIN };
  }
  const legacyAdmin = await isSuperAdmin(user.userId);
  if (legacyAdmin && allowedRoles.includes(Role.SUPER_ADMIN)) {
    console.debug('SUPER_ADMIN_FALLBACK', {
      path: req.url,
      userId: user.userId,
      source: 'rbacService.isSuperAdmin',
    });
    return { userId: user.userId, role: Role.SUPER_ADMIN };
  }
  const { role, error } = await getUserRole(user.userId, companyId);
  if (error === 'COMPANY_ACCESS_DENIED') {
    res.status(403).json({ error: 'COMPANY_ACCESS_DENIED' });
    return null;
  }
  if (error || !role) {
    res.status(403).json({ error: 'NOT_ALLOWED' });
    return null;
  }
  if (!allowedRoles.includes(role)) {
    res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    return null;
  }
  return { userId: user.userId, role };
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const companyId =
      (req.query.companyId as string | undefined) ||
      (req.query.company_id as string | undefined);
    if (!companyId) {
      return res.status(400).json({ error: 'companyId required' });
    }
    const { role } = await getUserCompanyRole(req, companyId);
    if (!(await hasPermission(role, 'view'))) {
      return res.status(403).json({ error: 'NOT_ALLOWED' });
    }

    const access = await requireCompanyRole(req, res, companyId, [
      Role.SUPER_ADMIN,
      Role.ADMIN,
      Role.CONTENT_MANAGER,
      Role.CONTENT_PLANNER,
      Role.CONTENT_CREATOR,
      Role.CONTENT_ENGAGER,
      Role.VIEWER,
    ]);
    if (!access) return;
    // Get all campaigns with simplified fields
    const { data: mappingRows, error: mappingError } = await supabase
      .from('campaign_versions')
      .select('campaign_id')
      .eq('company_id', companyId);

    if (mappingError) {
      console.error('Error fetching campaign mappings:', mappingError);
      return res.status(500).json({ error: 'Failed to fetch campaign mappings', details: mappingError });
    }

    const campaignIds = Array.from(
      new Set((mappingRows || []).map((row) => row.campaign_id).filter(Boolean))
    );

    if (campaignIds.length === 0) {
      return res.status(200).json({
        success: true,
        campaigns: [],
        total: 0,
      });
    }

    const { data: campaigns, error } = await supabase
      .from('campaigns')
      .select(`
        id,
        name,
        description,
        status,
        current_stage,
        timeframe,
        start_date,
        end_date,
        created_at,
        updated_at,
        weekly_themes,
        virality_playbook_id,
        virality_playbooks(id, name, objective, platforms, content_types, company_id)
      `)
      .in('id', campaignIds)
      .or(`virality_playbook_id.is.null,virality_playbooks.company_id.eq.${companyId}`)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching campaigns:', error);
      return res.status(500).json({ error: 'Failed to fetch campaigns', details: error });
    }

    // Add simple stats for each campaign
    const campaignsWithCounts = (campaigns || []).map(mapCampaignPlaybook).map((campaign) => ({
      ...campaign,
      name: campaign.name || `Campaign ${campaign.id.substring(0, 8)}`, // Fallback for missing names
      stats: {
        goals: 0,
        weeklyPlans: campaign.weekly_themes ? campaign.weekly_themes.length : 0,
        dailyPlans: 0,
        totalContent: campaign.weekly_themes ? campaign.weekly_themes.length : 0
      }
    }));

    return res.status(200).json({
      success: true,
      campaigns: campaignsWithCounts,
      total: campaignsWithCounts.length
    });

  } catch (error) {
    console.error('Error in campaigns list API:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export default withRBAC(handler, ALL_ROLES);
