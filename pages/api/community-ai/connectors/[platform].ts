import type { NextApiRequest, NextApiResponse } from 'next';
import { requireManageConnectors } from './utils';
import { revokeToken, getConnectorConnectedByUserId } from '../../../../backend/services/platformTokenService';
import { deactivateSocialAccount } from '../../../../backend/auth/tokenStore';

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

  const access = await requireManageConnectors(req, res, organizationId);
  if (!access) return;

  // G4.4 / G2.4: Disconnect allowed for Company Admin, Super Admin, OR connector owner
  const adminRoles = ['COMPANY_ADMIN', 'SUPER_ADMIN'];
  const isAdmin = adminRoles.includes(access.role);
  const connectedBy = await getConnectorConnectedByUserId(tenantId, organizationId, platform);
  const isOwner = connectedBy != null && connectedBy === access.userId;

  if (!isAdmin && !isOwner) {
    return res.status(403).json({
      error: 'FORBIDDEN_ROLE',
      message: 'Only Company Admin or the user who connected the account can disconnect.',
    });
  }

  try {
    // G5.5: Audit log
    console.info('[connector_audit]', JSON.stringify({ user_id: access.userId, company_id: organizationId, platform, action: 'disconnect' }));
    await revokeToken(tenantId, organizationId, platform);
    // Also deactivate publishing layer so social-platforms reflects disconnected state
    await deactivateSocialAccount({ userId: access.userId, companyId: organizationId, platform });
    return res.status(200).json({ success: true, message: 'Account disconnected' });
  } catch (err: any) {
    console.error('[connectors/revoke]', err);
    return res.status(500).json({ error: err?.message ?? 'Failed to revoke token' });
  }
}
