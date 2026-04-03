
/**
 * GET  /api/admin/rate-limit-config  — read current overrides
 * POST /api/admin/rate-limit-config  — save new overrides
 *
 * Auth: super_admin_session cookie
 *
 * POST body:
 * {
 *   endpoints: {
 *     "login":       { limit: 10, windowSecs: 900 },
 *     "otp_send":    { limit: 5,  windowSecs: 3600 },
 *     "uid:invite":  { limit: 10, windowSecs: 3600 },
 *     ...
 *   }
 * }
 *
 * Safe ranges (validated server-side):
 *   limit:      1–1000
 *   windowSecs: 10–86400
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  getRateLimitAdminConfig,
  saveRateLimitAdminConfig,
  validateRateLimitConfig,
  type RateLimitAdminConfig,
} from '../../../backend/services/adminRuntimeConfig';

function isSuperAdmin(req: NextApiRequest): boolean {
  return req.cookies?.super_admin_session === '1';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!isSuperAdmin(req)) return res.status(403).json({ error: 'NOT_AUTHORIZED' });

  if (req.method === 'GET') {
    const cfg = await getRateLimitAdminConfig();
    return res.status(200).json(cfg);
  }

  if (req.method === 'POST') {
    const body = req.body as unknown;
    const { valid, error, config } = validateRateLimitConfig(body);
    if (!valid || !config) return res.status(400).json({ error });

    const updated: RateLimitAdminConfig = {
      ...config,
      v:         1,
      updatedAt: new Date().toISOString(),
      updatedBy: 'super_admin',
    };

    await saveRateLimitAdminConfig(updated);
    return res.status(200).json({ ok: true, config: updated });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
