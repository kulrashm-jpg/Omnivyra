import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * POST /api/governance/unlock
 * Stage 29 — Release governance lockdown. SUPER_ADMIN only.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { releaseGovernanceLock } from '../../../backend/services/GovernanceLockdownService';
import { requireActivePlatformSuperAdmin } from '../../../backend/security/requireActivePlatformSuperAdmin';
import { requireCapability } from '../../../backend/security/requireCapability';
import { enforcePlatformWriteAuthority } from '../../../backend/security/platformWriteAuthority';
import { PLATFORM_CONTROLS_MANAGE } from '../../../shared/contracts/security';
import { requireAdminRateLimit } from '../../../backend/services/requestAccessService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  // Closure-015J (R-10): Closure-014 (D) per-route write rate limit — before authorization
  // and any business work; sensitive = strict in-process budget when Redis is unavailable.
  if (!(await requireAdminRateLimit(req, res, 'rl:governance:unlock', 5, 60, { sensitive: true }))) return;

  const userId = (req as any).rbac?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Closure-015C (P1): the governance lock is one platform-global row. withRBAC([SUPER_ADMIN]) also admits an INVITED
  // company-scoped SUPER_ADMIN membership; only an active platform super admin may act.
  if (!(await requireActivePlatformSuperAdmin(req, res, 'governance.unlock'))) return;
  // Closure-015D: the lock is a platform-wide safety gate (it blocks campaign
  // mutations for every tenant on integrity risk); releasing it disables that
  // safety. Same authorization as the other platform kill-switches
  // (rollout-control, Closure-009 owner decision): PLATFORM_CONTROLS_MANAGE with
  // its registered passkey + trusted-device step-up, plus audited platform write
  // authority. Checked before any write.
  const auth = await requireCapability(req, res, { capability: PLATFORM_CONTROLS_MANAGE, reason: 'governance_unlock' });
  if (!auth.ok) return;
  if (!(await enforcePlatformWriteAuthority(req, res, auth.principal, PLATFORM_CONTROLS_MANAGE, 'governance.unlock'))) return;
  await releaseGovernanceLock(userId);
  return res.status(200).json({ success: true });
}

export default __createApiRoute(withRBAC(handler, [Role.SUPER_ADMIN]), { route: '/api/governance/unlock' });
