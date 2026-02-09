import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceActionRole, requireTenantScope } from './utils';
import { COMMUNITY_AI_CAPABILITIES } from '../../../backend/services/rbac/communityAiCapabilities';
import { buildCampaignBaselineMetrics } from '../../../backend/services/networkIntelligence/campaignBaselineService';

const readQueryParam = (req: NextApiRequest, key: string): string | null => {
  const value = req.query?.[key];
  return typeof value === 'string' ? value : null;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const scope = await requireTenantScope(req, res);
  if (!scope) return;

  const roleGate = await enforceActionRole({
    req,
    res,
    companyId: scope.organizationId,
    allowedRoles: [...COMMUNITY_AI_CAPABILITIES.VIEW_ACTIONS],
  });
  if (!roleGate) return;

  const platform = readQueryParam(req, 'platform');
  const playbook_id = readQueryParam(req, 'playbook_id');

  try {
    const result = await buildCampaignBaselineMetrics({
      tenant_id: scope.tenantId,
      organization_id: scope.organizationId,
      platform,
      playbook_id,
    });
    return res.status(200).json({
      tenant_id: scope.tenantId,
      organization_id: scope.organizationId,
      filters: { platform, playbook_id },
      ...result,
    });
  } catch (error: any) {
    return res
      .status(500)
      .json({ error: error?.message || 'FAILED_TO_LOAD_CAMPAIGN_BASELINE' });
  }
}
