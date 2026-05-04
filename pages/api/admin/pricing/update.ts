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
 *     effective_from?: ISO timestamp
 *   }
 *
 * Auth: super-admin via requireAuthenticatedInternalUser + RBAC check.
 * Rejects unknown action_keys (enforcement layer for D2: "reject unknown
 * action at config time, don't fail runtime requests").
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  requireAdminRateLimit,
  requireAdminScope,
} from '../../../../backend/services/requestAccessService';
import { recordAdminAudit } from '../../../../backend/services/adminAuditService';
import { createServiceRoleMigrationProxy } from '../../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { refreshPricingCache, getActionPricing } from '../../../../backend/services/pricingService';
import { resolveActionKey } from '../../../../backend/services/usageLedgerService';
import { withIdempotency } from '../../../../backend/middleware/withIdempotency';
import { logger } from '../../../../backend/services/logger';

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

  // Versioned insert: deactivate prior active row, then insert new active row.
  // Two statements — acceptable since admin writes are rare and the UNIQUE
  // partial index protects against concurrent duplicate is_active=true rows.
  const { error: deactivateErr } = await supabase
    .from('llm_model_pricing')
    .update({ is_active: false })
    .eq('provider', provider)
    .eq('model_name', modelName)
    .eq('kind', kind)
    .eq('is_active', true);
  if (deactivateErr) {
    logger.error('pricing_deactivate_failed', { message: deactivateErr.message });
    return res.status(500).json({ error: 'Failed to deactivate prior pricing row', code: 'DEACTIVATE_FAILED' });
  }

  const { data, error: insertErr } = await supabase
    .from('llm_model_pricing')
    .insert({
      provider,
      model_name:        modelName,
      kind,
      input_per_1k_usd:  body.input_per_1k_usd,
      output_per_1k_usd: body.output_per_1k_usd,
      effective_from:    effective,
      is_active:         true,
      notes:             body.notes ?? null,
    })
    .select('id')
    .single();

  if (insertErr) {
    logger.error('pricing_insert_failed', { message: insertErr.message });
    return res.status(500).json({ error: 'Failed to insert pricing row', code: 'INSERT_FAILED' });
  }

  await refreshPricingCache();
  await recordAdminAudit({
    actorUserId:    actorId,
    action:         'ADMIN_PRICING_UPDATE_MODEL',
    targetType:     'llm_model_pricing',
    targetId:       (data as any).id,
    metadata:       { provider, model_name: modelName, kind, input_per_1k_usd: body.input_per_1k_usd, output_per_1k_usd: body.output_per_1k_usd, effective_from: effective },
    idempotencyKey: String((data as any).id),
  });
  return res.status(200).json({ ok: true, id: (data as any).id, target: 'model' });
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
      error: `Unknown action_key '${actionKey}'. Add it to PROCESS_TYPE_TO_ACTION_KEY or credit_cost_config first.`,
      code:  'UNKNOWN_ACTION_KEY',
    });
  }

  const effective = body.effective_from ?? new Date().toISOString();

  const { error: deactivateErr } = await supabase
    .from('action_pricing_config')
    .update({ is_active: false })
    .eq('action_key', actionKey)
    .eq('is_active', true);
  if (deactivateErr) {
    logger.error('action_pricing_deactivate_failed', { message: deactivateErr.message });
    return res.status(500).json({ error: 'Failed to deactivate prior action-pricing row', code: 'DEACTIVATE_FAILED' });
  }

  const { data, error: insertErr } = await supabase
    .from('action_pricing_config')
    .insert({
      action_key:      actionKey,
      cost_multiplier: body.cost_multiplier,
      minimum_charge_usd: body.minimum_charge_usd ?? 0,
      ceiling_usd: body.ceiling_usd ?? null,
      effective_from:  effective,
      is_active:       true,
      notes:           body.notes ?? null,
    })
    .select('id')
    .single();

  if (insertErr) {
    logger.error('action_pricing_insert_failed', { message: insertErr.message });
    return res.status(500).json({ error: 'Failed to insert action-pricing row', code: 'INSERT_FAILED' });
  }

  await refreshPricingCache();
  await recordAdminAudit({
    actorUserId:    actorId,
    action:         'ADMIN_PRICING_UPDATE_ACTION',
    targetType:     'action_pricing_config',
    targetId:       (data as any).id,
    metadata:       {
      action_key: actionKey,
      cost_multiplier: body.cost_multiplier,
      minimum_charge_usd: body.minimum_charge_usd ?? 0,
      ceiling_usd: body.ceiling_usd ?? null,
      effective_from: effective,
    },
    idempotencyKey: String((data as any).id),
  });
  return res.status(200).json({ ok: true, id: (data as any).id, target: 'action' });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!(await requireAdminRateLimit(req, res, 'rl:admin:pricing', 20, 60))) return;

  const ctx = await requireAdminScope(req, res, 'pricing:update');
  if (!ctx) return;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/admin/pricing/update', 'pricing:update');
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const target = (body as UpdateBody).target;

  if (target === 'model') {
    return handleModelUpdate(body as ModelUpdateBody, ctx.id, res);
  }
  if (target === 'action') {
    return handleActionUpdate(body as ActionUpdateBody, ctx.id, res);
  }
  return res.status(400).json({ error: "target must be 'model' or 'action'" });
}
