import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET  /api/enterprise-governance/alerts         — list active operational alerts
 * POST /api/enterprise-governance/alerts         — trigger an evaluation pass + return fired
 *
 * Read + run surface for the bounded enterprise-governance alerting
 * rules engine. Read is always safe; POST runs a synchronous evaluation
 * pass (linear over the bounded event ring + review/escalation stores).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { requireCompanyContext } from '../../../backend/services/companyContextGuardService';
import {
  listActiveAlerts,
  evaluateGovernanceAlerts,
  alertingDiagnostics,
  type EnterpriseAlertSeverity,
} from '../../../backend/services/creator/enterpriseGovernanceAlerting';
import { listNotifications, notificationDeliveryDiagnostics } from '../../../backend/services/creator/enterpriseGovernanceNotificationDelivery';

const ALLOWED_ROLES = [
  Role.SUPER_ADMIN,
  Role.COMPANY_ADMIN,
  Role.CONTENT_REVIEWER,
  Role.CONTENT_PUBLISHER,
];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const ctx = await requireCompanyContext({ req, res });
    if (!ctx) return;

    if (req.method === 'GET') {
      const severity = (req.query.severity as string)?.trim();
      const validSeverity = (['info', 'warning', 'critical'] as const).includes(severity as EnterpriseAlertSeverity)
        ? (severity as EnterpriseAlertSeverity) : undefined;
      const alerts = listActiveAlerts({ companyId: ctx.companyId, severity: validSeverity });
      const notifications = listNotifications({
        companyId: ctx.companyId,
        acknowledged: false,
        limit: 100,
      });
      return res.status(200).json({
        companyId: ctx.companyId,
        alerts,
        notifications,
        diagnostics: {
          alerting: alertingDiagnostics(),
          notifications: notificationDeliveryDiagnostics(),
        },
      });
    }

    if (req.method === 'POST') {
      const fired = evaluateGovernanceAlerts({ companyIds: [ctx.companyId] });
      return res.status(200).json({ companyId: ctx.companyId, firedThisPass: fired });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[enterprise-governance/alerts]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'failed to load alerts',
    });
  }
}

export default __createApiRoute(withRBAC(handler, ALLOWED_ROLES), { route: '/api/enterprise-governance/alerts' });
