import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { getRbacConfig, getRbacConfigVersion, saveRbacConfig, RbacConfigValidationError, RbacConfigStaleError } from '../../../backend/services/rbacService';
import { requireAdminRateLimit } from '../../../backend/services/requestAccessService';
import { recordAdminAudit } from '../../../backend/services/adminAuditService';
import { logger } from '../../../backend/services/logger';
import { withIdempotency } from '../../../backend/middleware/withIdempotency';
import { requireCapability } from '../../../backend/security/requireCapability';
import { mayAttemptCapability } from '../../../backend/security/preAuthorization';
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
      // Closure-015L: the stale-edit token the editor sends back on save (null
      // until the proposed versioned schema is deployed).
      const version = await getRbacConfigVersion();
      return res.status(200).json({ ...config, version });
    } catch (err: any) {
      logger.error('super_admin_rbac_load_failed', { message: err?.message || 'Failed to load RBAC configuration' });
      return res.status(500).json({
        error: 'RBAC_LOAD_FAILED',
        message: err?.message || 'Failed to load RBAC configuration',
      });
    }
  }

  if (req.method === 'POST') {
    const { roles, permissions, expectedVersion } = req.body || {};
    if (!permissions || typeof permissions !== 'object') {
      return res.status(400).json({ error: 'permissions_required' });
    }
    try {
      // Closure-015J (R-11): the body is passed through as sent — a missing or
      // malformed `roles` is refused by saveRbacConfig (it used to be replaced by
      // [], which kept only SUPER_ADMIN and dropped every tenant role).
      const updated = await saveRbacConfig({
        roles,
        permissions,
        updatedBy: admin.id,
        expectedVersion,
      });
      await recordAdminAudit({
        actorUserId: admin.id,
        action: 'SUPER_ADMIN_RBAC_UPDATE',
        targetType: 'rbac_config',
        metadata: { roles: updated.roles, permissions: updated.permissions },
        idempotencyKey: String(req.headers['idempotency-key'] ?? ''),
      });
      return res.status(200).json(updated);
    } catch (error: any) {
      // Closure-015L: someone saved since this editor loaded — nothing written.
      if (error instanceof RbacConfigStaleError) {
        return res.status(409).json({
          error: 'RBAC_CONFIG_STALE',
          message: 'The RBAC configuration was changed by another administrator. Reload it and re-apply your edit.',
          currentVersion: error.currentVersion,
        });
      }
      // Closure-015I (H-4) / Closure-015J (R-11): an invalid config is a client
      // error; nothing was written.
      if (error instanceof RbacConfigValidationError) {
        return res.status(400).json({
          error: error.code,
          ...(error.permission ? { permission: error.permission } : {}),
          ...(error.detail ? { detail: error.detail } : {}),
        });
      }
      return res.status(500).json({ error: error?.message || 'Failed to update RBAC config' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default __createApiRoute(withIdempotency(handler, { scope: 'super-admin-rbac', methods: ['POST'], authorize: mayAttemptCapability(IDENTITY_ADMIN) }), { route: '/api/super-admin/rbac' });
