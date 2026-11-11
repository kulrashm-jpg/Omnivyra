import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * GET /api/cron/anomaly-sweep
 *
 * Cross-instance anomaly sweep — queries auth_audit_logs globally to detect
 * distributed attacks that are invisible to any single instance's in-process
 * counters.
 *
 * Schedule: every 2 minutes (configured in vercel.json).
 * Can also be triggered manually by a super admin.
 *
 * Auth:
 *   - Vercel cron calls: validated via CRON_SECRET header
 *   - Manual calls: CRON_CONFIG_MANAGE on a platform SUPER_ADMIN principal,
 *     with step-up (2026-11-11: the legacy super-admin cookie and the
 *     bare SUPER_ADMIN role check are gone)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { runAnomalySweep } from '../../../lib/anomaly/sweepDetector';
import { bearerTokenMatches } from '../../../backend/security/constantTimeEqual';
import { requireCapability } from '../../../backend/security/requireCapability';
import { CRON_CONFIG_MANAGE } from '../../../shared/contracts/security';

async function authorize(req: NextApiRequest, res: NextApiResponse): Promise<boolean> {
  // Vercel cron secret (set CRON_SECRET env var, Vercel sends it automatically)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && bearerTokenMatches(req.headers.authorization, cronSecret)) return true;
  // A person: capability + platform authority + step-up (requireCapability answers 401/403).
  const guard = await requireCapability(req, res, {
    capability: CRON_CONFIG_MANAGE,
    reason: 'manual trigger cron:anomaly-sweep',
    requirePlatformAuthority: true,
    requireStepUp: true,
  });
  return guard.ok === true;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await authorize(req, res))) return;

  try {
    const result = await runAnomalySweep();
    console.log(JSON.stringify({
      level: 'INFO',
      event: 'anomaly_sweep_complete',
      ...result,
      ts: new Date().toISOString(),
    }));
    return res.status(200).json({ ok: true, ...result });
  } catch (err: any) {
    console.error('[anomaly-sweep] error:', err?.message);
    return res.status(500).json({ error: 'Sweep failed', details: err?.message });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/cron/anomaly-sweep' });
