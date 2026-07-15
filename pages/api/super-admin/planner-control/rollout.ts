import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/super-admin/planner-control/rollout
 *
 * Operator actions on the planner rollout state machine.
 *
 * Body:
 *   { action: 'promote' | 'rollback' | 'pause' | 'resume' | 'reset',
 *     reason?: string,
 *     targetMode?: PlannerRolloutMode,    // promote (force) / rollback
 *     canarySoakMs?: number,              // promote
 *     force?: boolean                     // promote
 *   }
 *
 * Auth: SUPER_ADMIN_DASHBOARD_VIEW. Writes to Redis-backed rollout state
 * and appends to the audit stream. The acting super-admin is recorded as
 * the operator id.
 *
 * Returns the new RolloutState. The orchestrator's promote/rollback/pause/
 * resume/reset never throw — they always return a state object even on
 * invalid transitions (with `last_reason` describing the refusal).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../../shared/contracts/security';
import {
  promote,
  rollback,
  pause,
  resume,
  reset,
  ROLLOUT_ORDER,
} from '../../../../backend/services/plannerRolloutOrchestrator';

type Body = {
  action?: 'promote' | 'rollback' | 'pause' | 'resume' | 'reset';
  reason?: string;
  targetMode?: string;
  canarySoakMs?: number;
  force?: boolean;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: 'planner_rollout_operation',
  });
  if (!auth.ok) return;
  // The principal carries the operator id used in audit logs.
  const operatorId =
    (auth.principal as { userId?: string }).userId ??
    (auth.principal as { id?: string }).id ??
    'super-admin';

  const body = (req.body ?? {}) as Body;
  if (!body.action) return res.status(400).json({ error: 'action is required' });

  // Validate targetMode if supplied.
  if (body.targetMode && !ROLLOUT_ORDER.includes(body.targetMode as never)) {
    return res.status(400).json({
      error: `targetMode must be one of: ${ROLLOUT_ORDER.join(', ')}`,
    });
  }

  try {
    switch (body.action) {
      case 'promote': {
        const state = await promote({
          operatorId,
          reason: body.reason,
          canarySoakMs: body.canarySoakMs,
          force: !!body.force,
          targetMode: body.targetMode as never,
        });
        return res.status(200).json({ state });
      }
      case 'rollback': {
        const state = await rollback({
          operatorId,
          reason: body.reason ?? 'manual_rollback',
          targetMode: body.targetMode as never,
        });
        return res.status(200).json({ state });
      }
      case 'pause': {
        const state = await pause(operatorId, body.reason ?? 'manual_pause');
        return res.status(200).json({ state });
      }
      case 'resume': {
        const state = await resume(operatorId, body.reason ?? 'manual_resume');
        return res.status(200).json({ state });
      }
      case 'reset': {
        const state = await reset(operatorId, body.reason ?? 'manual_reset');
        return res.status(200).json({ state });
      }
      default:
        return res.status(400).json({ error: `unknown action: ${body.action}` });
    }
  } catch (err) {
    console.error('[planner-control/rollout]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/planner-control/rollout' });
