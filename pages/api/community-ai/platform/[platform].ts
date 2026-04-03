import type { NextApiRequest, NextApiResponse } from 'next';
import { requireTenantScope, resolveBrandVoice } from '../utils';
import { evaluateEngagement } from '../../../../backend/services/communityAiOmnivyraService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const scope = await requireTenantScope(req, res);
  if (!scope) return;

  const platform = typeof req.query.platform === 'string' ? req.query.platform : null;
  if (!platform) {
    return res.status(400).json({ error: 'platform is required' });
  }

  const brandVoice = await resolveBrandVoice(scope.organizationId);
  const response = {
    tenant_id: scope.tenantId,
    organization_id: scope.organizationId,
    brand_voice: brandVoice,
    platform,
    posts_by_content_type: [],
    engagement_metrics: [],
    goals: [],
  };

  const omnivyra = await evaluateEngagement({
    tenant_id: scope.tenantId,
    organization_id: scope.organizationId,
    platform,
    post_data: null,
    engagement_metrics: response.engagement_metrics,
    goals: response.goals,
    brand_voice: brandVoice,
    context: response,
  });

  return res.status(200).json({
    ...response,
    analysis: omnivyra.analysis,
    suggested_actions: omnivyra.suggested_actions,
    content_improvement: omnivyra.content_improvement,
    safety_classification: omnivyra.safety_classification,
    execution_links: omnivyra.execution_links,
  });
}
