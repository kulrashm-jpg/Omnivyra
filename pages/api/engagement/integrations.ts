/**
 * GET /api/engagement/integrations
 * Returns configured social platforms for the company (from social_accounts + user_company_roles).
 * Used by Engagement Command Center to show only connected platforms in PlatformTabs.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { supabase } from '../../../backend/db/supabaseClient';
import { normalizePlatform } from '../../../utils/platformIcons';

/**
 * Get distinct platforms for users in a company (active social_accounts).
 * SELECT platform FROM social_accounts sa
 * JOIN user_company_roles ucr ON sa.user_id = ucr.user_id
 * WHERE ucr.company_id = companyId AND ucr.status = 'active' AND sa.is_active = true
 */
async function getCompanyPlatforms(companyId: string): Promise<string[]> {
  const { data: roleUsers } = await supabase
    .from('user_company_roles')
    .select('user_id')
    .eq('company_id', companyId)
    .eq('status', 'active');

  const userIds = (roleUsers ?? []).map((r: { user_id: string }) => r.user_id);
  if (userIds.length === 0) return [];

  const { data: accounts } = await supabase
    .from('social_accounts')
    .select('platform')
    .in('user_id', userIds)
    .eq('is_active', true);

  const raw = (accounts ?? []).map((a: { platform: string }) => (a.platform || '').toLowerCase().trim()).filter(Boolean);
  const canonical = Array.from(new Set(raw.map((p) => normalizePlatform(p)))).filter(Boolean);
  return canonical.sort();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const organizationId = (req.query.organization_id ?? req.query.organizationId ?? req.query.companyId) as string | undefined;
  const companyId = organizationId?.trim();
  if (!companyId) {
    return res.status(400).json({ error: 'organization_id, organizationId, or companyId is required' });
  }

  try {
    const access = await enforceCompanyAccess({
      req,
      res,
      companyId,
      requireCampaignId: false,
    });
    if (!access) return;

    let platforms: string[] = [];
    try {
      if (typeof getCompanyPlatforms === 'function') {
        platforms = await getCompanyPlatforms(companyId);
      }
    } catch {
      // ignore
    }
    // No additional fallback; getCompanyPlatforms already covers all sources.

    return res.status(200).json({ platforms });
  } catch (err) {
    console.error('[engagement/integrations]', err);
    return res.status(500).json({
      error: (err as Error)?.message ?? 'Failed to fetch integrations',
    });
  }
}
