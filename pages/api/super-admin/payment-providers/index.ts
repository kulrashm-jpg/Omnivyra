/**
 * GET  /api/super-admin/payment-providers
 *   Returns the backend-authoritative provider governance view: every known
 *   provider with its enablement / visibility / maintenance / sandbox state
 *   and the resolved available + visible lists. Carries NO pricing data.
 *
 * PATCH /api/super-admin/payment-providers
 *   Body: { provider: 'razorpay'|'stripe', enabled?, visible_in_checkout?,
 *           maintenance_mode?, subscriptions_enabled?, topups_enabled? }
 *   Toggles ONLY governance flags. NO pricing controls. NO new-provider
 *   registration. Additive UPDATE against payment_provider_config.
 *
 * Gated on BILLING_PLATFORM_MANAGE (SUPER_ADMIN-only, platform-level).
 * Does NOT touch ledger / wallet / HOLD / reconciliation / pricing.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { BILLING_PLATFORM_MANAGE } from '../../../../shared/contracts/security/SecurityCapabilities';
import {
  GOVERNED_PROVIDERS,
  resolveAvailableProviders,
  resolveProviderGovernance,
} from '../../../../backend/services/billing/payments/paymentProviderPolicyResolver';

// Governance flags an operator may toggle. Deliberately excludes any pricing-
// or credential-bearing field; supported_* arrays + priority are config that
// belongs to a migration, not an ad-hoc toggle.
const TOGGLEABLE = [
  'enabled',
  'visible_in_checkout',
  'maintenance_mode',
  'subscriptions_enabled',
  'topups_enabled',
] as const;
type ToggleKey = (typeof TOGGLEABLE)[number];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'PATCH') {
    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const guard = await requireCapability(req, res, {
    capability: BILLING_PLATFORM_MANAGE,
    reason: `super-admin ${req.method === 'GET' ? 'views' : 'updates'} payment-provider governance`,
    resourceId: null,
  });
  if (guard.ok !== true) return;

  // ── GET — governance view ─────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { rows, source } = await resolveProviderGovernance();
    const resolved = await resolveAvailableProviders();
    return res.status(200).json({
      source, // 'db' | 'compiled_default'
      providers: rows.map((r) => ({
        provider: r.provider,
        enabled: r.enabled,
        visible_in_checkout: r.visible_in_checkout,
        subscriptions_enabled: r.subscriptions_enabled,
        topups_enabled: r.topups_enabled,
        maintenance_mode: r.maintenance_mode,
        sandbox_mode: r.sandbox_mode, // metadata visibility only — not toggleable here
        priority: r.priority,
        supported_countries: r.supported_countries,
        supported_currencies: r.supported_currencies,
        supported_payment_methods: r.supported_payment_methods,
      })),
      resolved: {
        available: resolved.available.map((p) => p.provider),
        visible:   resolved.visible.map((p) => p.provider),
        supported_methods: resolved.supported_methods,
        recommended: resolved.recommended, // always null — routing not implemented
      },
    });
  }

  // ── PATCH — toggle governance flags ───────────────────────────────────────
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
  const provider = String(body.provider ?? '').trim();
  if (!GOVERNED_PROVIDERS.includes(provider as (typeof GOVERNED_PROVIDERS)[number])) {
    return res.status(400).json({ error: 'unknown_provider', provider });
  }

  const patch: Partial<Record<ToggleKey, boolean>> = {};
  for (const key of TOGGLEABLE) {
    if (key in body) {
      if (typeof body[key] !== 'boolean') {
        return res.status(400).json({ error: 'invalid_flag_type', field: key });
      }
      patch[key] = body[key] as boolean;
    }
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'no_toggleable_fields', allowed: TOGGLEABLE });
  }

  const { data, error } = await supabase
    .from('payment_provider_config')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('provider', provider)
    .select('provider, enabled, visible_in_checkout, subscriptions_enabled, topups_enabled, maintenance_mode, sandbox_mode')
    .maybeSingle();

  if (error) {
    return res.status(500).json({ error: 'update_failed', message: error.message });
  }
  if (!data) {
    // Table absent (migration unapplied) or no seeded row for this provider.
    return res.status(409).json({
      error: 'provider_row_absent',
      detail: 'payment_provider_config has no row for this provider (apply migration 20260714 / seed first)',
      provider,
    });
  }

  return res.status(200).json({ updated: data });
}
