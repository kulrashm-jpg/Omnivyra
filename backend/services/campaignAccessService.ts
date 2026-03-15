/**
 * Shared campaign access for API routes.
 * Resolves company from DB (campaign_versions by campaign_id), then checks user company + campaign role.
 * Use for any campaign-scoped endpoint that must enforce multi-tenant access.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../db/supabaseClient';
import { getUserCompanyRole, getCompanyRoleIncludingInvited, Role } from './rbacService';
import {
  resolveEffectiveCampaignRole,
  isCompanyOverrideRole,
  type CampaignAuthContext,
} from './campaignRoleService';
import { resolveUserContext } from './userContextService';

export type CampaignAccessResult = {
  userId: string;
  companyId: string;
  campaignId: string;
  campaignAuth?: CampaignAuthContext;
};

/**
 * Verify authenticated user has access to the campaign.
 * Company is resolved from DB (campaign_versions), not from client.
 * On failure sends 401/404/403 and returns null. On success returns access context.
 */
export async function requireCampaignAccess(
  req: NextApiRequest,
  res: NextApiResponse,
  campaignId: string
): Promise<CampaignAccessResult | null> {
  if (!campaignId || typeof campaignId !== 'string') {
    res.status(400).json({ error: 'Campaign ID is required' });
    return null;
  }

  const { data: campaignRow, error: campaignError } = await supabase
    .from('campaign_versions')
    .select('company_id')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (campaignError || !campaignRow?.company_id) {
    res.status(404).json({ error: 'Campaign not found' });
    return null;
  }

  const companyId = String(campaignRow.company_id);

  // Resolve user context — supports env-based fallback (same as enforceCompanyAccess).
  // When Supabase JWT is unavailable, resolveUserContext falls back to DEV_COMPANY_IDS
  // so the request is not blocked with 403 in development.
  const user = await resolveUserContext(req);
  const userId = user?.userId ?? null;
  if (!userId) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }

  // Fast-path: content_architect or env-listed company — grant COMPANY_ADMIN access.
  const isContentArchitect = userId === 'content_architect';
  const hasEnvAccess = isContentArchitect || user.companyIds.includes(companyId);

  let role: (typeof Role)[keyof typeof Role] | null = null;
  if (hasEnvAccess) {
    role = Role.COMPANY_ADMIN;
  } else {
    // DB role lookup (normal authenticated path).
    const roleResult = await getUserCompanyRole(req, companyId);
    role = roleResult.role;
    if (!role) {
      const invitedRole = await getCompanyRoleIncludingInvited(userId, companyId);
      if (invitedRole) role = invitedRole;
    }
    if (!role) {
      res.status(403).json({ error: 'FORBIDDEN_ROLE' });
      return null;
    }
  }

  let campaignAuth: CampaignAuthContext | undefined;
  if (isCompanyOverrideRole(role)) {
    campaignAuth = { companyRole: role, campaignRole: null, effectiveRole: role, source: 'company' };
  } else {
    const campaignAuthResult = await resolveEffectiveCampaignRole(userId, campaignId, companyId);
    if (campaignAuthResult.error === 'CAMPAIGN_ROLE_REQUIRED') {
      res.status(403).json({ error: 'CAMPAIGN_ROLE_REQUIRED' });
      return null;
    }
    campaignAuth = campaignAuthResult.error
      ? undefined
      : {
          companyRole: campaignAuthResult.companyRole,
          campaignRole: campaignAuthResult.campaignRole,
          effectiveRole: campaignAuthResult.effectiveRole,
          source: campaignAuthResult.source,
        };
  }

  return {
    userId,
    companyId,
    campaignId,
    campaignAuth,
  };
}
