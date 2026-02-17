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

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const snapshotId = (req.body?.snapshotId as string)?.trim?.();
  if (!snapshotId) {
    return res.status(400).json({ error: 'snapshotId is required' });
  }

  try {
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

export default withRBAC(handler, [Role.SUPER_ADMIN]);
