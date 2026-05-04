
/**
 * GET  /api/admin/cron-config  â€” read current cron overrides
 * POST /api/admin/cron-config  â€” save new overrides
 *
 * Auth: super_admin_session cookie
 *
 * POST body:
 * {
 *   jobs: {
 *     "engagementPolling":   { enabled: true,  intervalMultiplier: 2 },
 *     "signalClustering":    { enabled: true,  intervalMultiplier: 1 },
 *     "narrativeEngine":     { enabled: false, intervalMultiplier: 1 },
 *   }
 * }
 *
 * Job keys match the cron.ts snapshot keys (camelCase):
 *   opportunitySlots, governanceAudit, autoOptimization, engagementPolling,
 *   intelligencePolling, signalClustering, signalIntelligence, strategicTheme,
 *   campaignOpportunity, contentOpportunity, narrativeEngine, communityPost,
 *   threadEngine, engagementCapture, feedbackIntelligence, companyTrendRelevance,
 *   performanceIngestion, performanceAggregation, campaignHealthEvaluation,
 *   dailyIntelligence, intelligenceEventCleanup, engagementDigest,
 *   engagementSignalScheduler, engagementSignalArchive, engagementOpportunityScanner,
 *   connectorTokenRefresh, leadThreadQueueCleanup, confidenceCalibration
 *
 * Safe ranges:
 *   enabled:            boolean
 *   intervalMultiplier: 0.1â€“20  (1=normal, 2=half-freq, 0.5=double-freq)
 *
 * Changes apply at the next cron cycle (within 15 minutes).
 * No restart required â€” cron.ts reads config from Redis on each cycle.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  getCronAdminConfig,
  saveCronAdminConfig,
  validateCronConfig,
  type CronAdminConfig,
} from '../../../backend/services/adminRuntimeConfig';
import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import { requireAdminRateLimit, requireSuperAdminUser } from '../../../backend/services/requestAccessService';
import { recordAdminAudit } from '../../../backend/services/adminAuditService';
import { withIdempotency } from '../../../backend/middleware/withIdempotency';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAdminRateLimit(req, res, 'rl:admin:cron-config', 20, 60))) return;
  const admin = await requireSuperAdminUser(req, res);
  if (!admin) return;

  if (req.method === 'GET') {
    const cfg = await getCronAdminConfig();
    return res.status(200).json(cfg);
  }

  if (req.method === 'POST') {
    const body = req.body as unknown;
    const { valid, error, config } = validateCronConfig(body);
    if (!valid || !config) return res.status(400).json({ error });

    const updated: CronAdminConfig = {
      ...config,
      v:         1,
      updatedAt: new Date().toISOString(),
      updatedBy: admin.id,
    };

    await saveCronAdminConfig(updated);
    await recordAdminAudit({
      actorUserId: admin.id,
      action: 'ADMIN_CRON_CONFIG_UPDATE',
      targetType: 'cron_config',
      metadata: { config: updated },
      idempotencyKey: String(req.headers['idempotency-key'] ?? ''),
    });
    return res.status(200).json({ ok: true, config: updated });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default applyAuthGuard({
  requiresAuth: true,
  requiredRole: 'SUPER_ADMIN',
  allowSuperAdminOverride: true,
})(handler);
