/**
 * Centralized billing-policy resolver (SINGLE READ PATH, default-preserving).
 *
 * Resolves versioned governance knobs from billing_policy_config (migration
 * 20260692) with precedence:
 *
 *   organization-scoped active row → global active row → undefined
 *
 * `undefined` means "no DB policy" → callers MUST fall back to their existing
 * env/compile defaults, giving byte-identical behavior when no row exists.
 *
 * NEVER THROWS: any error (table absent because the migration is not yet
 * applied, transient DB error, malformed value) resolves to undefined → env
 * fallback. This makes the resolver safe to deploy ahead of the migration.
 *
 * Determinism: this is the only DB read; callers invoke it ONCE at the
 * existing fresh-HOLD boundary. Resumed/replayed HOLDs do not reach those
 * call sites (verified Task 5H), so policy is never re-resolved mid-lineage
 * and in-flight executions stay frozen.
 *
 * Scope guard: this layer is config governance ONLY — no wallet/HOLD/ledger/
 * RPC/pricingService changes. Org-level *pricing* is intentionally NOT here.
 */

import { supabase } from '../../db/supabaseClient';
import { logger } from '../logger';

export const BILLING_POLICY_KEYS = [
  'safety_factor',
  'safety_gate_mode',
  'kill_switch',
  'shadow_mode',
  'refine_variant_billing_enabled',
] as const;

export type BillingPolicyKey = (typeof BILLING_POLICY_KEYS)[number];

export interface ResolvedBillingPolicy {
  /** Each present ONLY if an active DB row resolved; else undefined → env. */
  safety_factor?: number;
  safety_gate_mode?: string;
  kill_switch?: boolean;
  shadow_mode?: boolean;
  refine_variant_billing_enabled?: boolean;
}

/**
 * Raw single-key resolution. Returns the jsonb `value` of the winning row
 * (org override beats global), or null when none / on any error.
 */
export async function resolveBillingPolicyValue(
  key: BillingPolicyKey,
  organizationId?: string | null,
): Promise<unknown | null> {
  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('billing_policy_config')
      .select('scope, organization_id, value, effective_from')
      .eq('key', key)
      .eq('is_active', true)
      .lte('effective_from', nowIso)
      .order('effective_from', { ascending: false });

    if (error || !Array.isArray(data) || data.length === 0) return null;

    const rows = data as Array<{
      scope: string;
      organization_id: string | null;
      value: unknown;
    }>;

    if (organizationId) {
      const orgRow = rows.find(
        (r) => r.scope === 'organization' && r.organization_id === organizationId,
      );
      if (orgRow) return orgRow.value ?? null;
    }
    const globalRow = rows.find((r) => r.scope === 'global');
    return globalRow ? (globalRow.value ?? null) : null;
  } catch (err) {
    // Table missing (migration unapplied) or any error → env fallback.
    logger.warn('billing_policy_resolve_failed', {
      key,
      org: organizationId ?? null,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function asNumber(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}
function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim().toLowerCase() : undefined;
}
function asBool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'on') return true;
    if (s === 'false' || s === '0' || s === 'off') return false;
  }
  return undefined;
}

/**
 * Aggregate resolution of all governance knobs for one org. Any field absent
 * (no active row) is left undefined so the consumer applies its env/default.
 * Best-effort: a single failed key never fails the whole resolve.
 */
export async function resolveBillingPolicy(
  organizationId?: string | null,
): Promise<ResolvedBillingPolicy> {
  const [factor, gateMode, kill, shadow, refine] = await Promise.all([
    resolveBillingPolicyValue('safety_factor', organizationId),
    resolveBillingPolicyValue('safety_gate_mode', organizationId),
    resolveBillingPolicyValue('kill_switch', organizationId),
    resolveBillingPolicyValue('shadow_mode', organizationId),
    resolveBillingPolicyValue('refine_variant_billing_enabled', organizationId),
  ]);

  const out: ResolvedBillingPolicy = {};
  const f = asNumber(factor);
  if (f !== undefined) out.safety_factor = Math.min(1, Math.max(0, f));
  const m = asString(gateMode);
  if (m !== undefined) out.safety_gate_mode = m;
  const k = asBool(kill);
  if (k !== undefined) out.kill_switch = k;
  const s = asBool(shadow);
  if (s !== undefined) out.shadow_mode = s;
  const r = asBool(refine);
  if (r !== undefined) out.refine_variant_billing_enabled = r;
  return out;
}
