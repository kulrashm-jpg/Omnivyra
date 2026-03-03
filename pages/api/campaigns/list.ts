import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
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
  if (user.userId === 'content_architect') {
    return { userId: user.userId, role: Role.COMPANY_ADMIN };
  }
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
    const rawCompanyId =
      (req.query.companyId as string | undefined) ||
      (req.query.company_id as string | undefined);
    const companyId = typeof rawCompanyId === 'string' ? rawCompanyId.trim() : rawCompanyId;
    if (!companyId) {
      return res.status(400).json({ error: 'companyId required' });
    }
    const { role } = await getUserCompanyRole(req, companyId);
    if (!(await hasPermission(role, 'VIEW_CAMPAIGNS'))) {
      return res.status(403).json({ error: 'NOT_ALLOWED' });
    }

    const access = await requireCompanyRole(req, res, companyId, [
      Role.SUPER_ADMIN,
      Role.ADMIN,
      Role.COMPANY_ADMIN,
      Role.CONTENT_MANAGER,
      Role.CONTENT_PLANNER,
      Role.CONTENT_CREATOR,
      Role.CONTENT_ENGAGER,
      Role.VIEWER,
      Role.VIEW_ONLY, // normalized form of VIEWER / CONTENT_ENGAGER
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
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching campaigns:', error);
      return res.status(500).json({ error: 'Failed to fetch campaigns', details: error });
    }

    // Enrich name from theme when campaign name is "Campaign from themes" (show topic of the theme)
    let themeNameByCampaignId: Record<string, string> = {};
    const { data: versionRows } = await supabase
      .from('campaign_versions')
      .select('campaign_id, campaign_snapshot, version')
      .eq('company_id', companyId)
      .in('campaign_id', campaignIds)
      .order('version', { ascending: false });
    const latestByCampaign = new Map<string, { campaign_snapshot: unknown }>();
    for (const row of versionRows || []) {
      const cid = (row as { campaign_id: string }).campaign_id;
      if (!cid || latestByCampaign.has(cid)) continue;
      latestByCampaign.set(cid, {
        campaign_snapshot: (row as { campaign_snapshot: unknown }).campaign_snapshot,
      });
    }
    for (const [cid, { campaign_snapshot }] of latestByCampaign) {
      const snap = campaign_snapshot as { source_strategic_theme?: { polished_title?: string; topic?: string; title?: string } } | null;
      const theme = snap?.source_strategic_theme;
      if (theme && (theme.polished_title ?? theme.topic ?? theme.title)) {
        const name = [theme.polished_title, theme.topic, theme.title].map((t) => (typeof t === 'string' ? t.trim() : '')).find(Boolean);
        if (name) themeNameByCampaignId[cid] = name;
      }
    }

    // Add simple stats for each campaign
    const campaignsWithCounts = (campaigns || []).map(mapCampaignPlaybook).map((campaign) => {
      let displayName = campaign.name || `Campaign ${campaign.id.substring(0, 8)}`;
      if ((campaign.name || '').trim() === 'Campaign from themes' && themeNameByCampaignId[campaign.id]) {
        displayName = themeNameByCampaignId[campaign.id];
      }
      return {
        ...campaign,
        name: displayName,
        stats: {
          goals: 0,
          weeklyPlans: campaign.weekly_themes ? campaign.weekly_themes.length : 0,
          dailyPlans: 0,
          totalContent: campaign.weekly_themes ? campaign.weekly_themes.length : 0
        }
      };
    });

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
