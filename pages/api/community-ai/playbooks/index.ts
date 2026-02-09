import type { NextApiRequest, NextApiResponse } from 'next';
import { COMMUNITY_AI_CAPABILITIES } from '../../../../backend/services/rbac/communityAiCapabilities';
import {
  createPlaybook,
  deactivatePlaybook,
  listPlaybooks,
  updatePlaybook,
} from '../../../../backend/services/playbooks/playbookService';
import { enforceActionRole, requireTenantScope } from '../utils';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const scope = await requireTenantScope(req, res);
  if (!scope) return;

  if (req.method === 'GET') {
    const roleGate = await enforceActionRole({
      req,
      res,
      companyId: scope.organizationId,
      allowedRoles: [...COMMUNITY_AI_CAPABILITIES.MANAGE_PLAYBOOKS],
    });
    if (!roleGate) return;

    const playbooks = await listPlaybooks(scope.tenantId, scope.organizationId);
    return res.status(200).json({
      tenant_id: scope.tenantId,
      organization_id: scope.organizationId,
      playbooks,
    });
  }

  const roleGate = await enforceActionRole({
    req,
    res,
    companyId: scope.organizationId,
    allowedRoles: [...COMMUNITY_AI_CAPABILITIES.MANAGE_PLAYBOOKS],
  });
  if (!roleGate) return;

  if (req.method === 'POST') {
    const payload = {
      ...(req.body || {}),
      tenant_id: scope.tenantId,
      organization_id: scope.organizationId,
    };
    const created = await createPlaybook(payload);
    return res.status(201).json({ playbook: created });
  }

  if (req.method === 'PUT') {
    const { id, ...rest } = req.body || {};
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    const updated = await updatePlaybook(id, {
      ...rest,
      tenant_id: scope.tenantId,
      organization_id: scope.organizationId,
    });
    return res.status(200).json({ playbook: updated });
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    const updated = await deactivatePlaybook(id, scope.tenantId, scope.organizationId);
    return res.status(200).json({ playbook: updated });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
