import type { NextApiRequest, NextApiResponse } from 'next';
import { listPlaybooks } from '../../../../backend/services/playbooks/playbookService';
import { evaluatePlaybookForEvent } from '../../../../backend/services/playbooks/playbookEvaluator';
import { COMMUNITY_AI_CAPABILITIES } from '../../../../backend/services/rbac/communityAiCapabilities';
import { enforceActionRole, requireTenantScope } from '../utils';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
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

  const { platform, content_type, intent_scores, sentiment, user_type } = req.body || {};
  if (!platform || !content_type || !intent_scores || !sentiment || !user_type) {
    return res.status(400).json({ error: 'Missing evaluation inputs' });
  }

  const playbooks = await listPlaybooks(scope.tenantId, scope.organizationId);
  const active = (playbooks || []).filter((playbook) => playbook.status === 'active');
  const evaluation = evaluatePlaybookForEvent(
    {
      platform,
      content_type,
      intent_scores,
      sentiment,
      user_type,
    },
    active
  );

  return res.status(200).json({
    tenant_id: scope.tenantId,
    organization_id: scope.organizationId,
    ...evaluation,
  });
}
