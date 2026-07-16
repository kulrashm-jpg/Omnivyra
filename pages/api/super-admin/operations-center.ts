import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * /api/super-admin/operations-center — read-only Production Operations Center.
 *
 * Surfaces repository-owned operational state (rollout flags incl.
 * canonical-grounding, version/deployment fingerprint, runtime/queue/cron
 * topology, single-points-of-failure) for Super Admin. Read-only; no runtime
 * behaviour change. Same auth posture as /api/super-admin/observability.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '../../../backend/security/requireCapability';
import { requireAdminRateLimit } from '../../../backend/services/requestAccessService';
import { CONTENT_PUBLISH } from '../../../shared/contracts/security/SecurityCapabilities';
import { getOperationsCenterSnapshot } from '../../../backend/services/operationsCenterService';
// Side-effect import: loading the adapter registers the `canonical-grounding`
// rollout flag so it appears in the snapshot's flag registry.
import '../../../backend/services/context/canonicalProfileAdapter';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:operations-center', 60, 60))) return;

  const guard = await requireCapability(req, res, {
    capability: CONTENT_PUBLISH,
    reason: 'operator reads operations center snapshot',
  });
  if (guard.ok !== true) return;

  try {
    return res.status(200).json(getOperationsCenterSnapshot());
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'snapshot failed' });
  }
}

export default __createApiRoute(handler, { route: '/api/super-admin/operations-center' });
