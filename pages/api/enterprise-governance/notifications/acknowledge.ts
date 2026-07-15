import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/enterprise-governance/notifications/acknowledge
 *
 * Acknowledges an operator-facing governance notification so it drops
 * out of the unacked queue + dashboard counts.
 *
 * Body: { id: string }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../../backend/middleware/withRBAC';
import { Role } from '../../../../backend/services/rbacService';
import { requireCompanyContext } from '../../../../backend/services/companyContextGuardService';
import { resolveUserContext } from '../../../../backend/services/userContextService';
import {
  acknowledgeNotification,
  listNotifications,
} from '../../../../backend/services/creator/enterpriseGovernanceNotificationDelivery';

const ALLOWED_ROLES = [
  Role.SUPER_ADMIN,
  Role.COMPANY_ADMIN,
  Role.CONTENT_REVIEWER,
  Role.CONTENT_PUBLISHER,
];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const ctx = await requireCompanyContext({ req, res });
    if (!ctx) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const id = String(body.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id required' });

    // Cross-tenant isolation — verify the notif belongs to this company.
    const owned = listNotifications({ companyId: ctx.companyId, limit: 500 })
      .find((n) => n.id === id);
    if (!owned) return res.status(404).json({ error: 'notification not found' });

    const user = await resolveUserContext(req);
    const result = acknowledgeNotification({ id, userId: user.userId ?? 'unknown' });
    if (!result.ok) return res.status(404).json({ error: result.reason ?? 'failed' });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[enterprise-governance/ack]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'failed to acknowledge',
    });
  }
}

export default __createApiRoute(withRBAC(handler, ALLOWED_ROLES), { route: '/api/enterprise-governance/notifications/acknowledge' });
