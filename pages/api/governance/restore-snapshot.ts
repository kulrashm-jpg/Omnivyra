import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * POST /api/governance/restore-snapshot
 * Stage 30 — Restore governance from snapshot. SUPER_ADMIN only.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import {
  restoreGovernanceSnapshot,
  SnapshotPolicyMismatchError,
  SnapshotRestoreInProgressError,
} from '../../../backend/services/GovernanceSnapshotService';
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
  if (!(await requireAdminRateLimit(req, res, 'rl:governance:restore-snapshot', 5, 60, { sensitive: true }))) return;

  const snapshotId = (req.body?.snapshotId as string)?.trim?.();
  if (!snapshotId) {
    return res.status(400).json({ error: 'snapshotId is required' });
  }

  try {
    // Closure-015C (P1): the snapshot's own company is restored, whatever companyId the request
    // named. withRBAC([SUPER_ADMIN]) also admits an INVITED company-scoped SUPER_ADMIN membership;
    // only an active platform super admin may act.
    if (!(await requireActivePlatformSuperAdmin(req, res, 'governance.restore_snapshot'))) return;
    // Closure-015D: a restore also rewrites the platform-global governance_lockdown
    // row from the snapshot (GovernanceSnapshotService.doRestore) — it can release
    // the platform-wide safety gate exactly as /api/governance/unlock does — and
    // replaces the snapshot company's governance audit history. It therefore
    // carries at least the platform-controls authorization: PLATFORM_CONTROLS_MANAGE
    // with its registered passkey + trusted-device step-up, plus audited platform
    // write authority. Checked before the snapshot is read or anything is written.
    const auth = await requireCapability(req, res, { capability: PLATFORM_CONTROLS_MANAGE, reason: 'governance_restore_snapshot', resourceId: snapshotId });
    if (!auth.ok) return;
    if (!(await enforcePlatformWriteAuthority(req, res, auth.principal, PLATFORM_CONTROLS_MANAGE, 'governance.restore_snapshot'))) return;
    const result = await restoreGovernanceSnapshot(snapshotId);
    return res.status(200).json(result);
  } catch (err: any) {
    if (err instanceof SnapshotRestoreInProgressError) {
      return res.status(409).json({
        code: 'SNAPSHOT_RESTORE_IN_PROGRESS',
        message: err.message,
      });
    }
    if (err instanceof SnapshotPolicyMismatchError) {
      return res.status(409).json({
        code: 'SnapshotPolicyMismatch',
        message: err.message,
      });
    }
    if (err?.message?.includes('not found')) {
      return res.status(404).json({ error: 'Snapshot not found' });
    }
    throw err;
  }
}

export default __createApiRoute(withRBAC(handler, [Role.SUPER_ADMIN]), { route: '/api/governance/restore-snapshot' });
