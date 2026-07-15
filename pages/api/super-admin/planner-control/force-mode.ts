import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/super-admin/planner-control/force-mode
 *
 * Emergency operator controls for the planner's cluster overload mode and
 * the distributed semaphore. NOT for routine rollout — use
 * `/planner-control/rollout` for staged rollouts.
 *
 * Body:
 *   { action: 'force_degradation' | 'force_recovery' | 'force_lease_reclamation',
 *     reason?: string,
 *     /** when force_degradation: which mode to force *\/
 *     mode?: 'elevated' | 'degraded' | 'critical'
 *   }
 *
 * Auth: SUPER_ADMIN_DASHBOARD_VIEW. Writes to Redis state. Logged with
 * operator id.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../../shared/contracts/security';
import { logger } from '../../../../backend/services/logger';
import { forceSemaphoreLeaseReclamation } from '../../../../backend/services/plannerFailureRecovery';
import { getInstrumentedStandaloneRedisClient } from '../../../../backend/queue/standaloneRedisClient';

const OVERLOAD_STATE_KEY = 'planner:overload:state';
const ALLOWED_FORCE_MODES = ['elevated', 'degraded', 'critical'] as const;

type Body = {
  action?: 'force_degradation' | 'force_recovery' | 'force_lease_reclamation';
  reason?: string;
  mode?: typeof ALLOWED_FORCE_MODES[number];
};

function modeRank(mode: string): number {
  switch (mode) { case 'normal': return 0; case 'elevated': return 1; case 'degraded': return 2; case 'critical': return 3; }
  return 0;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: 'planner_force_mode_operation',
  });
  if (!auth.ok) return;
  const operatorId =
    (auth.principal as { userId?: string }).userId ??
    (auth.principal as { id?: string }).id ??
    'super-admin';

  const body = (req.body ?? {}) as Body;
  if (!body.action) return res.status(400).json({ error: 'action required' });

  try {
    switch (body.action) {
      case 'force_degradation': {
        if (!body.mode || !ALLOWED_FORCE_MODES.includes(body.mode)) {
          return res.status(400).json({ error: `mode must be one of: ${ALLOWED_FORCE_MODES.join(', ')}` });
        }
        let client;
        try {
          client = getInstrumentedStandaloneRedisClient('planner-control-force');
        } catch (err) {
          return res.status(503).json({ error: 'Redis unavailable; cannot force cluster mode' });
        }
        const now = Date.now();
        await client.hset(OVERLOAD_STATE_KEY, {
          mode: body.mode,
          rank: String(modeRank(body.mode)),
          changed_at: String(now),
          score: '1.0',
          updated_at: String(now),
          forced_by: operatorId,
          forced_reason: body.reason ?? 'manual',
        });
        await client.pexpire(OVERLOAD_STATE_KEY, 60_000);
        logger.warn('planner_force_degradation', {
          operator_id: operatorId,
          forced_mode: body.mode,
          reason: body.reason,
        });
        return res.status(200).json({ ok: true, forced_mode: body.mode });
      }
      case 'force_recovery': {
        let client;
        try {
          client = getInstrumentedStandaloneRedisClient('planner-control-force');
        } catch (err) {
          return res.status(503).json({ error: 'Redis unavailable; cannot force cluster mode' });
        }
        const now = Date.now();
        // Force to 'normal' with rank 0 + score 0. The hysteresis check in
        // the overload coordinator's Lua script is bypassed because we
        // overwrite both rank and changed_at directly.
        await client.hset(OVERLOAD_STATE_KEY, {
          mode: 'normal',
          rank: '0',
          changed_at: String(now),
          score: '0.0',
          updated_at: String(now),
          forced_by: operatorId,
          forced_reason: body.reason ?? 'manual',
        });
        await client.pexpire(OVERLOAD_STATE_KEY, 60_000);
        logger.warn('planner_force_recovery', {
          operator_id: operatorId,
          reason: body.reason,
        });
        return res.status(200).json({ ok: true, forced_mode: 'normal' });
      }
      case 'force_lease_reclamation': {
        const result = await forceSemaphoreLeaseReclamation();
        logger.warn('planner_force_lease_reclamation', {
          operator_id: operatorId,
          reason: body.reason,
          reclaimed: result,
        });
        return res.status(200).json({ ok: true, reclaimed: result });
      }
      default:
        return res.status(400).json({ error: `unknown action: ${String(body.action)}` });
    }
  } catch (err) {
    console.error('[planner-control/force-mode]', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/planner-control/force-mode' });
