import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/admin/pricing/update
 *
 * Super-admin endpoint for updating the pricing engine tables. Inserts new
 * versioned rows (never overwrites). Old rows get is_active=false; new row
 * gets is_active=true with the caller-supplied effective_from (default now).
 *
 * Body (one of):
 *   {
 *     target: 'model',
 *     provider:   'openai' | 'anthropic' | ...,
 *     model_name: string,
 *     kind:       'completion' | 'embedding',
 *     input_per_1k_usd:  number,
 *     output_per_1k_usd: number,
 *     effective_from?: ISO timestamp
 *   }
 *
 *   {
 *     target: 'action',
 *     action_key:      string,    // must resolve via resolveActionKey or be in credit_cost_config
 *     credit_cost?:    number,    // optional override
 *     cost_multiplier: number,    // 1.0 = no margin adjustment
 *     source_type?:    string,    // carried from the active row when omitted; required for a new action_key
 *     effective_from?: ISO timestamp
 *   }
 *
 * Auth: super-admin via requireAuthenticatedInternalUser + RBAC check.
 * Rejects unknown action_keys (enforcement layer for D2: "reject unknown
 * action at config time, don't fail runtime requests").
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isPlatformSuperAdmin, isSuperAdmin } from '../../../../backend/services/rbacService';
import {
  requireAdminRateLimit,
  requireAuthenticatedInternalUser,
} from '../../../../backend/services/requestAccessService';
import { recordAdminAudit } from '../../../../backend/services/adminAuditService';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getActionPricing } from '../../../../backend/services/pricingService';
import { resolveActionKey } from '../../../../backend/services/usageLedgerService';
import { withIdempotency } from '../../../../backend/middleware/withIdempotency';
import { logger } from '../../../../backend/services/logger';
import {
  applyActionPricingChange,
  applyModelPricingChange,
  ActionPricingInputError,
} from '../../../../backend/services/actionPricingApplyService';

type ModelUpdateBody = {
  target: 'model';
  provider:          string;
  model_name:        string;
  kind?:             'completion' | 'embedding';
  input_per_1k_usd:  number;
  output_per_1k_usd: number;
  effective_from?:   string;
  notes?:            string;
};

type ActionUpdateBody = {
  target: 'action';
  action_key: string;
  cost_multiplier: number;
  minimum_charge_usd?: number;
  ceiling_usd?: number | null;
  effective_from?: string;
  notes?: string;
  /** Optional: carried from the action's active row when omitted; required for a brand-new action_key. */
  source_type?: string;
};

type UpdateBody = ModelUpdateBody | ActionUpdateBody;

function isNonNegativeNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

async function handleModelUpdate(body: ModelUpdateBody, actorId: string, res: NextApiResponse) {
  if (!body.provider || !body.model_name) {
    return res.status(400).json({ error: 'provider + model_name required' });
  }
  const kind = body.kind ?? 'completion';
  if (kind !== 'completion' && kind !== 'embedding') {
    return res.status(400).json({ error: "kind must be 'completion' or 'embedding'" });
  }
  if (!isNonNegativeNumber(body.input_per_1k_usd) || !isNonNegativeNumber(body.output_per_1k_usd)) {
    return res.status(400).json({ error: 'input_per_1k_usd and output_per_1k_usd must be non-negative numbers' });
  }
  if (kind === 'embedding' && body.output_per_1k_usd !== 0) {
    return res.status(400).json({ error: 'embedding rows must have output_per_1k_usd = 0' });
  }

  const provider   = body.provider.toLowerCase().trim();
  const modelName  = body.model_name.toLowerCase().trim();
  const effective  = body.effective_from ?? new Date().toISOString();

  // B-1 follow-up: ONE atomic write (the database function deactivates-then-
  // inserts in a single transaction and carries the token limits). The old
  // two-statement path here is gone.
  let newId: string;
  try {
    const result = await applyModelPricingChange({
      provider,
      modelName,
      kind,
      inputPer1kUsd:  body.input_per_1k_usd,
      outputPer1kUsd: body.output_per_1k_usd,
      effectiveFrom:  effective,
      notes:          body.notes,
    });
    newId = result.id;
  } catch (err) {
    if (err instanceof ActionPricingInputError) {
      return res.status(400).json({ error: err.message, code: 'PRICING_INPUT_REJECTED' });
    }
    logger.error('model_pricing_update_failed', { message: err instanceof Error ? err.message : String(err) });
    return res.status(500).json({ error: 'Failed to apply model-pricing change', code: 'APPLY_FAILED' });
  }

  await recordAdminAudit({
    actorUserId:    actorId,
    action:         'ADMIN_PRICING_UPDATE_MODEL',
    targetType:     'llm_model_pricing',
    targetId:       newId,
    metadata:       { provider, model_name: modelName, kind, input_per_1k_usd: body.input_per_1k_usd, output_per_1k_usd: body.output_per_1k_usd, effective_from: effective },
    idempotencyKey: String(newId),
  });
  return res.status(200).json({ ok: true, id: newId, target: 'model' });
}

async function handleActionUpdate(body: ActionUpdateBody, actorId: string, res: NextApiResponse) {
  if (!body.action_key?.trim()) {
    return res.status(400).json({ error: 'action_key required' });
  }
  if (!isNonNegativeNumber(body.cost_multiplier)) {
    return res.status(400).json({ error: 'cost_multiplier must be a non-negative number' });
  }
  if (body.minimum_charge_usd != null && !isNonNegativeNumber(body.minimum_charge_usd)) {
    return res.status(400).json({ error: 'minimum_charge_usd must be a non-negative number when provided' });
  }
  if (body.ceiling_usd != null && !isNonNegativeNumber(body.ceiling_usd)) {
    return res.status(400).json({ error: 'ceiling_usd must be a non-negative number when provided' });
  }
  if (
    body.ceiling_usd != null &&
    body.minimum_charge_usd != null &&
    body.ceiling_usd < body.minimum_charge_usd
  ) {
    return res.status(400).json({ error: 'ceiling_usd cannot be lower than minimum_charge_usd' });
  }

  const actionKey = body.action_key.trim();

  // Reject unknown action_keys — belt-and-braces against typos. An action is
  // "known" if it resolves via the process_type mapping OR appears in
  // credit_cost_config (legacy) OR is already in action_pricing_config.
  const viaMapping = resolveActionKey(actionKey) !== null;
  let viaOverride = false;
  try {
    await getActionPricing(actionKey);
    viaOverride = true;
  } catch {
    viaOverride = false;
  }
  const { data: legacyMatch } = await supabase
    .from('credit_cost_config')
    .select('action_type')
    .eq('action_type', actionKey)
    .maybeSingle();

  if (!viaMapping && !viaOverride && !legacyMatch) {
    return res.status(400).json({
      error: `Unknown action_key '${actionKey}'. Add it to shared/monetization/featureRegistry.ts or credit_cost_config first.`,
      code:  'UNKNOWN_ACTION_KEY',
    });
  }

  const effective = body.effective_from ?? new Date().toISOString();
  if (body.source_type != null && (typeof body.source_type !== 'string' || !body.source_type.trim())) {
    return res.status(400).json({ error: 'source_type must be a non-empty string when provided', code: 'INVALID_SOURCE_TYPE' });
  }

  // Billing defect B-1: ONE atomic write through the shared helper (the database
  // function deactivates-then-inserts in a single transaction and carries or
  // requires source_type). The old two-statement path here is gone.
  let newId: string;
  try {
    const result = await applyActionPricingChange({
      actionKey,
      costMultiplier:   body.cost_multiplier,
      minimumChargeUsd: body.minimum_charge_usd ?? 0,
      ceilingUsd:       body.ceiling_usd ?? null,
      effectiveFrom:    effective,
      notes:            body.notes,
      sourceType:       body.source_type?.trim(),
    });
    newId = result.id;
  } catch (err) {
    if (err instanceof ActionPricingInputError) {
      return res.status(400).json({ error: err.message, code: 'PRICING_INPUT_REJECTED' });
    }
    logger.error('action_pricing_update_failed', { message: err instanceof Error ? err.message : String(err) });
    return res.status(500).json({ error: 'Failed to apply action-pricing change', code: 'APPLY_FAILED' });
  }

  await recordAdminAudit({
    actorUserId:    actorId,
    action:         'ADMIN_PRICING_UPDATE_ACTION',
    targetType:     'action_pricing_config',
    targetId:       newId,
    metadata:       {
      action_key: actionKey,
      cost_multiplier: body.cost_multiplier,
      minimum_charge_usd: body.minimum_charge_usd ?? 0,
      ceiling_usd: body.ceiling_usd ?? null,
      effective_from: effective,
      source_type: body.source_type?.trim() ?? null,
    },
    idempotencyKey: String(newId),
  });
  return res.status(200).json({ ok: true, id: newId, target: 'action' });
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!(await requireAdminRateLimit(req, res, 'rl:admin:pricing', 20, 60))) return;

  const user = await requireAuthenticatedInternalUser(req, res);
  if (!user) return;
  if (!(await isPlatformSuperAdmin(user.id)) && !(await isSuperAdmin(user.id))) {
    return res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const target = (body as UpdateBody).target;

  if (target === 'model') {
    return handleModelUpdate(body as ModelUpdateBody, user.id, res);
  }
  if (target === 'action') {
    return handleActionUpdate(body as ActionUpdateBody, user.id, res);
  }
  return res.status(400).json({ error: "target must be 'model' or 'action'" });
}

export default __createApiRoute(withIdempotency(handler, { scope: 'admin-pricing-update', methods: ['POST'] }), { route: '/api/admin/pricing/update' });
