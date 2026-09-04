import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * GET /api/admin/engagement-claimed-unknown
 *
 * Read-only operator surface for browser dispatches whose delivery state cannot
 * be determined.
 *
 * A browser command (every supported DM) is queued solely by its
 * community_ai_actions row. If an extension claimed it and the result never
 * arrived — the claimant crashed, the tab closed, or its late callback was
 * rejected — then the platform action may or may not have happened, and nothing
 * in the system can tell which.
 *
 * These rows are deliberately excluded from every automatic path:
 *   - the abandoned-dispatch sweep refuses them (it requires lease_id IS NULL);
 *   - a renewal-capable client is never re-offered them;
 *   - they are NOT marked failed, which would imply nothing was sent;
 *   - they are NOT retried, which would risk sending twice.
 *
 * This endpoint only lists them. It performs no writes, offers no retry action,
 * and never reports delivery as successful — `delivery` is always 'unknown',
 * because that is the honest answer.
 *
 * Query: ?organization_id=<uuid>&limit=<1..500>
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '../../../backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../shared/contracts/security';
import { listClaimedUnknownDispatches } from '../../../backend/services/engagementDispatchRecoveryService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const guard = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: 'engagement claimed-unknown dispatch review',
  });
  if (guard.ok !== true) return;

  try {
    const organizationId = (req.query.organization_id ?? req.query.organizationId) as string | undefined;
    const limitRaw = parseInt(String(req.query.limit ?? 100), 10);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 100;

    const rows = await listClaimedUnknownDispatches({
      organizationId: organizationId ?? null,
      limit,
    });

    return res.status(200).json({
      success: true,
      count: rows.length,
      // Stated in the payload so no consumer can render these as failures or
      // as deliveries. Operator judgement is required per row.
      guidance:
        'Delivery is UNKNOWN for every row. Do not retry and do not mark failed. ' +
        'Confirm on the platform whether the message was actually sent before acting.',
      dispatches: rows,
    });
  } catch (err) {
    const message = (err as Error)?.message ?? 'Failed to list claimed-unknown dispatches';
    console.error('[admin/engagement-claimed-unknown]', message);
    return res.status(500).json({ error: message });
  }
}

export default __createApiRoute(handler, { route: '/api/admin/engagement-claimed-unknown' });
