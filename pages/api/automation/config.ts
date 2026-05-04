import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
/**
 * GET  /api/automation/config?organization_id=...
 *   Returns the current automation config for the caller's org. If no
 *   row exists yet, returns the safe default (enabled=false).
 *
 * POST /api/automation/config
 *   Body: {
 *     organization_id?: string,
 *     enabled?: boolean,
 *     auto_reply_enabled?: boolean,
 *     auto_dm_enabled?: boolean,
 *     min_confidence_level?: 'medium' | 'high',
 *     allowed_actions?: string[],     // restricted to ['reply', 'dm']
 *     daily_limit?: number
 *   }
 *   Upserts the config. Invalid values are either rejected (400) or
 *   normalized to safe defaults by automationConfigStore.
 *
 * Safety:
 *   - Writes go through upsertAutomationConfig which narrows
 *     allowed_actions to the automatable whitelist AND validates
 *     min_confidence_level AND clamps daily_limit â‰¥ 0 BEFORE reaching
 *     the DB CHECK constraints.
 *   - The GLOBAL_AUTOMATION_DISABLED env is reflected in the response
 *     so operators can see the kill switch is active.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import {
  getAutomationConfig,
  upsertAutomationConfig,
  type AutomationConfigPatch,
} from '../../../backend/services/automation/automationConfigStore';
import {
  isGlobalAutomationDisabled,
  AUTOMATABLE_ACTION_TYPES,
} from '../../../backend/services/automation/automationConstants';

function readOrgId(req: NextApiRequest, body: Record<string, unknown>, userDefault: string | undefined): string | undefined {
  const fromQuery = (req.query.organization_id ?? req.query.organizationId ?? req.query.companyId) as string | string[] | undefined;
  const q = Array.isArray(fromQuery) ? fromQuery[0] : fromQuery;
  return (q ?? (body.organization_id as string | undefined) ?? userDefault)?.toString().trim() || undefined;
}

function serialize(config: Awaited<ReturnType<typeof getAutomationConfig>>) {
  return {
    organization_id: config.organization_id,
    enabled: config.enabled,
    auto_reply_enabled: config.auto_reply_enabled,
    auto_dm_enabled: config.auto_dm_enabled,
    min_confidence_level: config.min_confidence_level,
    allowed_actions: config.allowed_actions,
    daily_limit: config.daily_limit,
    updated_at: config.updated_at,
    /** Hard-coded whitelist surfaced so clients can render the limits. */
    automatable_action_whitelist: AUTOMATABLE_ACTION_TYPES,
    /** Reflects process.env.GLOBAL_AUTOMATION_DISABLED. When true, no
     *  automation runs regardless of config.enabled. */
    global_kill_switch: isGlobalAutomationDisabled(),
  };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const body = ((req.body ?? {}) as Record<string, unknown>) || {};
    const organizationId = readOrgId(req, body, (user as { defaultCompanyId?: string })?.defaultCompanyId);

    if (!organizationId) return res.status(400).json({ error: 'organization_id required' });

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    if (req.method === 'GET') {
      const config = await getAutomationConfig(organizationId);
      return res.status(200).json({ success: true, ...serialize(config) });
    }

    // POST â€” validate minimal shape, let the store do hard normalization.
    const patch: AutomationConfigPatch = {};
    const fields: Array<keyof AutomationConfigPatch> = [
      'enabled',
      'auto_reply_enabled',
      'auto_dm_enabled',
      'min_confidence_level',
      'allowed_actions',
      'daily_limit',
    ];
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        (patch as Record<string, unknown>)[field] = body[field as string];
      }
    }

    if (typeof patch.daily_limit === 'number' && !Number.isFinite(patch.daily_limit)) {
      return res.status(400).json({ error: 'daily_limit must be a finite number' });
    }

    const outcome = await upsertAutomationConfig(organizationId, patch);
    if (!outcome.ok || !outcome.config) {
      return res.status(500).json({ error: outcome.error || 'UPSERT_FAILED' });
    }
    return res.status(200).json({ success: true, ...serialize(outcome.config) });
  } catch (err) {
    console.error('[automation/config]', err);
    return res.status(500).json({ error: (err as Error)?.message || 'automation config failed' });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

