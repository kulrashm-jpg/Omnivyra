/**
 * GET  /api/admin/cron-config  — read current cron overrides
 * POST /api/admin/cron-config  — save new overrides
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
 *   intervalMultiplier: 0.1–20  (1=normal, 2=half-freq, 0.5=double-freq)
 *
 * Changes apply at the next cron cycle (within 15 minutes).
 * No restart required — cron.ts reads config from Redis on each cycle.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  getCronAdminConfig,
  saveCronAdminConfig,
  validateCronConfig,
  type CronAdminConfig,
} from '../../../backend/services/adminRuntimeConfig';

function isSuperAdmin(req: NextApiRequest): boolean {
  return req.cookies?.super_admin_session === '1';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!isSuperAdmin(req)) return res.status(403).json({ error: 'NOT_AUTHORIZED' });

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
      updatedBy: 'super_admin',
    };

    await saveCronAdminConfig(updated);
    return res.status(200).json({ ok: true, config: updated });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
