
/**
 * GET  /api/admin/rate-limit-config  â€” read current overrides
 * POST /api/admin/rate-limit-config  â€” save new overrides
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
 *   limit:      1â€“1000
 *   windowSecs: 10â€“86400
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  getRateLimitAdminConfig,
  saveRateLimitAdminConfig,
  validateRateLimitConfig,
  type RateLimitAdminConfig,
} from '../../../backend/services/adminRuntimeConfig';
import { requireAdminRateLimit, requireAdminScope } from '../../../backend/services/requestAccessService';
import { recordAdminAudit } from '../../../backend/services/adminAuditService';
import { withIdempotency } from '../../../backend/middleware/withIdempotency';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAdminRateLimit(req, res, 'rl:admin:rate-limit-config', 20, 60))) return;
  const admin = await requireAdminScope(req, res, 'config:rate-limit');
  if (!admin) return;

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
      updatedBy: admin.id,
    };

    await saveRateLimitAdminConfig(updated);
    await recordAdminAudit({
      actorUserId: admin.id,
      action: 'ADMIN_RATE_LIMIT_CONFIG_UPDATE',
      targetType: 'rate_limit_config',
      metadata: { config: updated },
      idempotencyKey: String(req.headers['idempotency-key'] ?? ''),
    });
    return res.status(200).json({ ok: true, config: updated });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
