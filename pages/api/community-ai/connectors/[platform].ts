import type { NextApiRequest, NextApiResponse } from 'next';
import { requireManageConnectors } from './utils';
import { revokeToken } from '../../../../backend/services/platformTokenService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const platform = typeof req.query.platform === 'string' ? req.query.platform : '';
  const tenantId = typeof req.query.tenant_id === 'string' ? req.query.tenant_id : '';
  const organizationId = typeof req.query.organization_id === 'string' ? req.query.organization_id : '';

  if (!platform) {
    return res.status(400).json({ error: 'platform is required' });
  }
  if (!tenantId || !organizationId) {
    return res.status(400).json({ error: 'tenant_id and organization_id are required' });
  }

  const access = await requireManageConnectors(req, res, tenantId);
  if (!access) return;

  try {
    await revokeToken(tenantId, organizationId, platform);
    return res.status(200).json({ success: true, message: 'Account disconnected' });
  } catch (err: any) {
    console.error('[connectors/revoke]', err);
    return res.status(500).json({ error: err?.message ?? 'Failed to revoke token' });
  }
}
