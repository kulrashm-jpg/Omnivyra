import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * Planner feature governance control.
 *
 * GET — return registry + recent audit trail.
 * POST — body: { action: 'register' | 'add_rule' | 'remove_rule' | 'evaluate', ... }
 *
 * Auth: SUPER_ADMIN_DASHBOARD_VIEW.
 *
 * Actions:
 *   register   : { action, key, description, default }
 *   add_rule   : { action, featureKey, scopeType, scopeValue?, percent?, effect, note? }
 *   remove_rule: { action, featureKey, ruleId }
 *   evaluate   : { action, key, ctx: { orgId, environment, instanceId, evaluationKey } }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../../shared/contracts/security';
import {
  registerFeature,
  addRule,
  removeRule,
  isFeatureEnabled,
  listFeatures,
  readFeatureAuditTrail,
  type FeatureScopeType,
} from '../../../../backend/services/plannerFeatureGovernance';

const ALLOWED_SCOPE_TYPES: FeatureScopeType[] = ['global', 'org', 'env', 'instance', 'percent'];
const ALLOWED_EFFECTS = ['on', 'off', 'default'] as const;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: 'planner_feature_governance',
  });
  if (!auth.ok) return;
  const operatorId =
    (auth.principal as { userId?: string }).userId ??
    (auth.principal as { id?: string }).id ??
    'super-admin';

  if (req.method === 'GET') {
    const [features, audit] = await Promise.all([listFeatures(), readFeatureAuditTrail(50)]);
    return res.status(200).json({ features, audit });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const action = body.action;

  try {
    switch (action) {
      case 'register': {
        if (typeof body.key !== 'string') return res.status(400).json({ error: 'key required' });
        const entry = await registerFeature({
          key: body.key,
          description: String(body.description ?? ''),
          default: !!body.default,
          operatorId,
        });
        return res.status(200).json({ feature: entry });
      }
      case 'add_rule': {
        if (typeof body.featureKey !== 'string') return res.status(400).json({ error: 'featureKey required' });
        if (!ALLOWED_SCOPE_TYPES.includes(body.scopeType as FeatureScopeType)) {
          return res.status(400).json({ error: `scopeType must be one of: ${ALLOWED_SCOPE_TYPES.join(', ')}` });
        }
        if (!ALLOWED_EFFECTS.includes(body.effect as never)) {
          return res.status(400).json({ error: `effect must be one of: ${ALLOWED_EFFECTS.join(', ')}` });
        }
        const entry = await addRule({
          featureKey: body.featureKey,
          scopeType: body.scopeType as FeatureScopeType,
          scopeValue: typeof body.scopeValue === 'string' ? body.scopeValue : undefined,
          percent: typeof body.percent === 'number' ? body.percent : undefined,
          effect: body.effect as 'on' | 'off' | 'default',
          note: typeof body.note === 'string' ? body.note : undefined,
          operatorId,
        });
        if (!entry) return res.status(404).json({ error: 'feature not found' });
        return res.status(200).json({ feature: entry });
      }
      case 'remove_rule': {
        if (typeof body.featureKey !== 'string' || typeof body.ruleId !== 'string') {
          return res.status(400).json({ error: 'featureKey and ruleId required' });
        }
        const entry = await removeRule(body.featureKey, body.ruleId, operatorId);
        if (!entry) return res.status(404).json({ error: 'feature not found' });
        return res.status(200).json({ feature: entry });
      }
      case 'evaluate': {
        if (typeof body.key !== 'string') return res.status(400).json({ error: 'key required' });
        const ctx = (body.ctx ?? {}) as Record<string, unknown>;
        const result = await isFeatureEnabled(body.key, {
          orgId: typeof ctx.orgId === 'string' ? ctx.orgId : null,
          environment: typeof ctx.environment === 'string' ? ctx.environment : undefined,
          instanceId: typeof ctx.instanceId === 'string' ? ctx.instanceId : undefined,
          evaluationKey: typeof ctx.evaluationKey === 'string' ? ctx.evaluationKey : undefined,
        });
        return res.status(200).json({ result });
      }
      default:
        return res.status(400).json({ error: `unknown action: ${String(action)}` });
    }
  } catch (err) {
    console.error('[planner-control/features]', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/planner-control/features' });
