import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * POST /api/super-admin/rollout-control — the single canonical operator write
 * surface for the GENERIC rollout kit (lib/platform/rollout).
 *
 * Mutates the SAME admin-config namespace that resolution already reads
 * (ROLLOUT_CONFIG_KEY via loadAdminConfig). It introduces no parallel rollout
 * system, storage, registry, or evaluation — it only exposes the existing
 * override fields (mode / killed / enforceTenants) through setRolloutOverride().
 * Planner-specific controls (planner-control/*) are unaffected. Kill switches
 * and env controls retain priority; an override never overrides an env-kill.
 *
 * Body:
 *   { flagKey: string,
 *     action: 'set-mode' | 'kill' | 'unkill' | 'set-tenants' | 'clear',
 *     mode?: 'off' | 'shadow' | 'enforce',   // set-mode
 *     tenants?: string[],                     // set-tenants (canary allowlist)
 *     reason?: string }
 *
 * Auth: SUPER_ADMIN_DASHBOARD_VIEW (same gate as planner-control/force-mode).
 * Every mutation is recorded via recordAdminAudit (existing framework).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '../../../backend/security/requireCapability';
import { requireAdminRateLimit } from '../../../backend/services/requestAccessService';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../shared/contracts/security';
import { recordAdminAudit } from '../../../backend/services/adminAuditService';
import {
  getRolloutFlag,
  type RolloutMode,
  type RolloutOverridePatch,
} from '../../../lib/platform/rollout';
import { setRolloutOverride, resolveRollout } from '../../../lib/platform/rolloutAdmin';
// Side-effect import: registers the `canonical-grounding` flag so it is a valid
// write target (same registration the read surface relies on).
import '../../../backend/services/context/canonicalProfileAdapter';

const ALLOWED_MODES: RolloutMode[] = ['off', 'shadow', 'enforce'];
const ALLOWED_ACTIONS = ['set-mode', 'kill', 'unkill', 'set-tenants', 'clear'] as const;

type Action = typeof ALLOWED_ACTIONS[number];
type Body = { flagKey?: string; action?: Action; mode?: RolloutMode; tenants?: string[]; reason?: string };

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:rollout-control', 30, 60))) return;

  const auth = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: 'rollout_override_mutation',
  });
  if (!auth.ok) return;
  const operatorId =
    (auth.principal as { userId?: string }).userId ??
    (auth.principal as { id?: string }).id ??
    'super-admin';

  const body = (req.body ?? {}) as Body;
  const flagKey = typeof body.flagKey === 'string' ? body.flagKey.trim() : '';
  if (!flagKey) return res.status(400).json({ error: 'flagKey required' });
  const flag = getRolloutFlag(flagKey);
  if (!flag) return res.status(404).json({ error: `unknown rollout flag: ${flagKey}` });
  if (!body.action || !ALLOWED_ACTIONS.includes(body.action)) {
    return res.status(400).json({ error: `action must be one of: ${ALLOWED_ACTIONS.join(', ')}` });
  }

  // Map the operator action onto the existing override fields. No new semantics.
  let patch: RolloutOverridePatch;
  switch (body.action) {
    case 'set-mode':
      if (!body.mode || !ALLOWED_MODES.includes(body.mode)) {
        return res.status(400).json({ error: `mode must be one of: ${ALLOWED_MODES.join(', ')}` });
      }
      patch = { mode: body.mode };
      break;
    case 'kill':
      patch = { killed: true };
      break;
    case 'unkill':
      patch = { killed: false };
      break;
    case 'set-tenants': {
      const tenants = Array.isArray(body.tenants)
        ? body.tenants.map((t) => String(t).trim()).filter(Boolean)
        : [];
      // Empty list clears the allowlist (back to env/none); a list is the canary cohort.
      patch = { enforceTenants: tenants.length ? tenants : null };
      break;
    }
    case 'clear':
      patch = { clear: true };
      break;
    default:
      return res.status(400).json({ error: `unknown action: ${String(body.action)}` });
  }

  try {
    const { previous, next } = await setRolloutOverride(flagKey, patch);
    const resolved = await resolveRollout(flag); // effective decision after the write (re-reads namespace)

    await recordAdminAudit({
      actorUserId: operatorId,
      action: `rollout.override.${body.action}`,
      targetType: 'rollout_flag',
      targetId: flagKey,
      metadata: {
        previous,
        next,
        resolvedMode: resolved.mode,
        resolvedSource: resolved.source,
        reason: body.reason ?? null,
      },
    });

    return res.status(200).json({ ok: true, flagKey, previous, next, resolved });
  } catch (err) {
    // Redis-absent (env-only deployment) surfaces as 503, not a 500 — the
    // operator learns the override transport is unavailable, env controls remain.
    const msg = err instanceof Error ? err.message : 'rollout override failed';
    const redisless = /Redis not configured/i.test(msg);
    return res.status(redisless ? 503 : 500).json({ error: msg });
  }
}

export default __createApiRoute(handler, { route: '/api/super-admin/rollout-control' });
