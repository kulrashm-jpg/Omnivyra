import type { NextApiRequest, NextApiResponse } from 'next';
import { evaluateForecastInsights } from '../../../backend/services/communityAiForecastInsightsService';
import { COMMUNITY_AI_CAPABILITIES } from '../../../backend/services/rbac/communityAiCapabilities';
import { enforceActionRole, requireTenantScope, resolveBrandVoice } from './utils';

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

  const platform = typeof req.query?.platform === 'string' ? req.query.platform : null;
  const contentType =
    typeof req.query?.content_type === 'string' ? req.query.content_type : null;

  const brandVoice = await resolveBrandVoice(scope.organizationId);
  const insights = await evaluateForecastInsights({
    tenant_id: scope.tenantId,
    organization_id: scope.organizationId,
    platform,
    content_type: contentType,
    brand_voice: brandVoice,
  });

  return res.status(200).json({
    tenant_id: scope.tenantId,
    organization_id: scope.organizationId,
    explanation_summary: insights.explanation_summary,
    key_drivers: insights.key_drivers,
    risks: insights.risks,
    recommended_actions: insights.recommended_actions,
    confidence_level: insights.confidence_level,
  });
}
