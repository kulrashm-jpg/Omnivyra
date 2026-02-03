import type { NextApiRequest, NextApiResponse } from 'next';
import { requireTenantScope, resolveBrandVoice } from './utils';
import { evaluateEngagement } from '../../../backend/services/communityAiOmnivyraService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const scope = await requireTenantScope(req, res);
  if (!scope) return;

  const brandVoice = await resolveBrandVoice(scope.organizationId);
  const response = {
    tenant_id: scope.tenantId,
    organization_id: scope.organizationId,
    brand_voice: brandVoice,
    priority_items: {
      underperforming_posts: [],
      unanswered_comments: [],
      pending_actions: [],
      influencer_opportunities: [],
      network_opportunities: [],
    },
    platform_overview: [],
    content_type_summary: [],
    action_summary: {
      pending: 0,
      scheduled: 0,
      completed: 0,
      skipped: 0,
    },
  };

  const omnivyra = await evaluateEngagement({
    tenant_id: scope.tenantId,
    organization_id: scope.organizationId,
    platform: null,
    post_data: null,
    metrics: null,
    goals: null,
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

