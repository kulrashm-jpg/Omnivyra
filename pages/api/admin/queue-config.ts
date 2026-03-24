/**
 * GET  /api/admin/queue-config  — read current queue overrides
 * POST /api/admin/queue-config  — save new overrides
 *
 * Auth: super_admin_session cookie
 *
 * POST body:
 * {
 *   queues: {
 *     "publish":            { maxJobsPerCycle: 500, attempts: 1, concurrency: 5 },
 *     "posting":            { maxJobsPerCycle: 300, attempts: 3, concurrency: 5 },
 *     "ai-heavy":           { maxJobsPerCycle: 100, attempts: 2, concurrency: 3 },
 *     "engagement-polling": { maxJobsPerCycle: 200, attempts: 1, concurrency: 5 },
 *   }
 * }
 *
 * Safe ranges (validated server-side):
 *   maxJobsPerCycle: 1–5000
 *   attempts:        0–10
 *   concurrency:     1–50
 *
 * Note: concurrency and attempts affect future worker/queue creation only.
 *       maxJobsPerCycle applies immediately to the next addBulk call.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  getQueueAdminConfig,
  saveQueueAdminConfig,
  validateQueueConfig,
  type QueueAdminConfig,
} from '../../../backend/services/adminRuntimeConfig';

function isSuperAdmin(req: NextApiRequest): boolean {
  return req.cookies?.super_admin_session === '1';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!isSuperAdmin(req)) return res.status(403).json({ error: 'NOT_AUTHORIZED' });

  if (req.method === 'GET') {
    const cfg = await getQueueAdminConfig();
    return res.status(200).json(cfg);
  }

  if (req.method === 'POST') {
    const body = req.body as unknown;
    const { valid, error, config } = validateQueueConfig(body);
    if (!valid || !config) return res.status(400).json({ error });

    const updated: QueueAdminConfig = {
      ...config,
      v:         1,
      updatedAt: new Date().toISOString(),
      updatedBy: 'super_admin',
    };

    await saveQueueAdminConfig(updated);
    return res.status(200).json({ ok: true, config: updated });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
