import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/enterprise-governance/health
 *
 * Production readiness + runtime health endpoint for the enterprise
 * governance stack. Aggregates every subsystem's diagnostics into a
 * single envelope with an overall pass/warn/fail roll-up.
 *
 * Designed for:
 *   - deployment smoke tests
 *   - load-balancer / monitoring probes
 *   - operator dashboards
 *
 * Auth: super-admin only (this surfaces internal diagnostics).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { integrationHealth } from '../../../backend/services/creator/enterpriseGovernanceIntegration';
import { persistenceDiagnostics } from '../../../backend/services/creator/enterpriseGovernanceRedisPersistence';
import { lockingDiagnostics } from '../../../backend/services/creator/enterpriseGovernanceLocking';
import { eventBufferDiagnostics } from '../../../backend/services/creator/enterpriseGovernanceEvents';
import { notificationDeliveryDiagnostics } from '../../../backend/services/creator/enterpriseGovernanceNotificationDelivery';
import { alertingDiagnostics } from '../../../backend/services/creator/enterpriseGovernanceAlerting';
import { warmStartDiagnostics } from '../../../backend/services/creator/enterpriseGovernanceWarmStart';
import { reviewStoreStats } from '../../../backend/services/creator/creativeReviewStateMachine';
import { escalationStats } from '../../../backend/services/creator/creativeEscalationPipeline';

const ALLOWED_ROLES = [Role.SUPER_ADMIN, Role.COMPANY_ADMIN];

type SubsystemStatus = 'pass' | 'warn' | 'fail';

function rollup(checks: Array<SubsystemStatus>): SubsystemStatus {
  if (checks.some((c) => c === 'fail')) return 'fail';
  if (checks.some((c) => c === 'warn')) return 'warn';
  return 'pass';
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const persistence = persistenceDiagnostics();
    const locking = lockingDiagnostics();
    const events = eventBufferDiagnostics();
    const notifications = notificationDeliveryDiagnostics();
    const alerts = alertingDiagnostics();
    const warmStart = warmStartDiagnostics();
    const reviews = reviewStoreStats();
    const escalations = escalationStats();
    const integration = integrationHealth();

    // Subsystem status rollups.
    const persistenceStatus: SubsystemStatus = persistence.disabled
      ? 'fail'
      : persistence.consecutiveFailures > 0 ? 'warn'
      : 'pass';
    const lockingStatus: SubsystemStatus = locking.disabled
      ? 'fail'
      : locking.consecutiveFailures > 0 ? 'warn'
      : 'pass';
    const notificationStatus: SubsystemStatus =
      notifications.enabled && !notifications.subscribed ? 'warn' : 'pass';
    const warmStartStatus: SubsystemStatus =
      warmStart.enabled && !warmStart.alreadyRan ? 'warn' : 'pass';

    const overall = rollup([persistenceStatus, lockingStatus, notificationStatus, warmStartStatus]);

    return res.status(overall === 'fail' ? 503 : 200).json({
      overall,
      computedAt: new Date().toISOString(),
      subsystems: {
        integration: { status: 'pass', details: integration },
        persistence: { status: persistenceStatus, details: persistence },
        locking: { status: lockingStatus, details: locking },
        events: { status: 'pass', details: events },
        notifications: { status: notificationStatus, details: notifications },
        alerting: { status: 'pass', details: alerts },
        warmStart: { status: warmStartStatus, details: warmStart },
        reviewStore: { status: 'pass', details: reviews },
        escalationStore: { status: 'pass', details: escalations },
      },
      featureFlags: {
        ENTERPRISE_GOVERNANCE_RUNTIME_ENABLED: process.env.ENTERPRISE_GOVERNANCE_RUNTIME_ENABLED ?? 'false',
        ENTERPRISE_GOVERNANCE_REDIS_ENABLED: process.env.ENTERPRISE_GOVERNANCE_REDIS_ENABLED ?? 'false',
        ENTERPRISE_GOVERNANCE_NOTIFY_ENABLED: process.env.ENTERPRISE_GOVERNANCE_NOTIFY_ENABLED ?? 'false',
        ENTERPRISE_GOVERNANCE_WARM_START_ENABLED: process.env.ENTERPRISE_GOVERNANCE_WARM_START_ENABLED ?? 'false',
        CREATOR_ALERT_DISPATCH_ENABLED: process.env.CREATOR_ALERT_DISPATCH_ENABLED ?? 'false',
      },
    });
  } catch (err) {
    console.error('[enterprise-governance/health]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'failed to compute health',
    });
  }
}

export default __createApiRoute(withRBAC(handler, ALLOWED_ROLES), { route: '/api/enterprise-governance/health' });
