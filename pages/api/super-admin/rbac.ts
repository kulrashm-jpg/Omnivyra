import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { getRbacConfig, saveRbacConfig } from '../../../backend/services/rbacService';
import { requireAdminRateLimit } from '../../../backend/services/requestAccessService';
import { recordAdminAudit } from '../../../backend/services/adminAuditService';
import { logger } from '../../../backend/services/logger';
import { withIdempotency } from '../../../backend/middleware/withIdempotency';
import { requireCapability } from '../../../backend/security/requireCapability';
import { IDENTITY_ADMIN } from '../../../shared/contracts/security';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:rbac', 20, 60))) return;
  // Phase: Platform Authority Hard Enforcement. RBAC mutation is platform-tier
  // identity admin scope; phishing-resistant + trusted-device step-up enforced
  // automatically via the IDENTITY_ADMIN policy in StepUpPolicyRegistry.
  const guard = await requireCapability(req, res, {
    capability: IDENTITY_ADMIN,
    reason: `rbac config (${req.method})`,
  });
  if (guard.ok !== true) return;
  const admin = { id: guard.principal.userId };

  if (req.method === 'GET') {
    try {
      const config = await getRbacConfig();
      return res.status(200).json(config);
    } catch (err: any) {
      logger.error('super_admin_rbac_load_failed', { message: err?.message || 'Failed to load RBAC configuration' });
      return res.status(500).json({
        error: 'RBAC_LOAD_FAILED',
        message: err?.message || 'Failed to load RBAC configuration',
      });
    }
  }

  if (req.method === 'POST') {
    const { roles, permissions } = req.body || {};
    if (!permissions || typeof permissions !== 'object') {
      return res.status(400).json({ error: 'permissions_required' });
    }
    try {
      const updated = await saveRbacConfig({
        roles: Array.isArray(roles) ? roles : [],
        permissions,
        updatedBy: admin.id,
      });
      await recordAdminAudit({
        actorUserId: admin.id,
        action: 'SUPER_ADMIN_RBAC_UPDATE',
        targetType: 'rbac_config',
        metadata: { roles: Array.isArray(roles) ? roles : [], permissions },
        idempotencyKey: String(req.headers['idempotency-key'] ?? ''),
      });
      return res.status(200).json(updated);
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to update RBAC config' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default __createApiRoute(withIdempotency(handler, { scope: 'super-admin-rbac', methods: ['POST'] }), { route: '/api/super-admin/rbac' });
