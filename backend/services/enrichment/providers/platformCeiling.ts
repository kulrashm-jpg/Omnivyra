/**
 * MODE B safety backstop: the PLATFORM-WIDE daily ceiling on central
 * (platform-key) vendor calls, plus an optional per-tenant share of it.
 *
 * Owner (2026-11-10): the tenant's credit balance is the limit for a tenant;
 * this ceiling protects Omnivyra's own vendor account from any one day's
 * runaway use. The per-tenant share is OFF by default (a Super Admin setting).
 *
 * SETTINGS live in the existing billing_policy_config (global rows only; an
 * organisation row can never raise the platform ceiling):
 *   central_vendor_daily_ceiling  {"apollo": 500}        calls per UTC day, per vendor
 *   central_vendor_tenant_share   {"enabled": false, "max_fraction": 0.25}
 *
 * FAILS CLOSED: no ceiling configured for the vendor, an unreadable setting or
 * an unreadable count all REFUSE a central call (the tenant's own key is never
 * affected: this runs only for funding = 'platform').
 *
 * WHAT IS COUNTED: credit HOLDS (credit_transactions, execution_phase 'hold',
 * reference_type 'prospect_enrichment') created since 00:00 UTC. A hold is
 * written BEFORE the vendor call, so in-flight calls count; the attempt
 * ledger's funding/units are written only at close and would miss them. A
 * released hold still counts (it was an attempt against the vendor), which
 * errs on the safe side. Today only Apollo has a platform key, so all such
 * holds are Apollo's; a second platform vendor needs a per-vendor reference.
 * Check-then-act: concurrent calls can overshoot by at most the concurrency.
 */
import { ownedDbTable } from '../../../db/writeOwner';
import { resolveBillingPolicyValue, type BillingPolicyKey } from '../../billing/billingPolicyResolver';

export const CENTRAL_CEILING_POLICY_KEY: BillingPolicyKey = 'central_vendor_daily_ceiling';
export const CENTRAL_TENANT_SHARE_POLICY_KEY: BillingPolicyKey = 'central_vendor_tenant_share';
export const CENTRAL_HOLD_REFERENCE_TYPE = 'prospect_enrichment';

export interface CeilingDeps {
  readPolicy?: (key: BillingPolicyKey) => Promise<unknown | null>;
  countHolds?: (input: { sinceIso: string; organizationId?: string }) => Promise<number | null>;
  now?: () => Date;
}

const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();

async function defaultCountHolds(input: { sinceIso: string; organizationId?: string }): Promise<number | null> {
  try {
    let q = ownedDbTable('credit_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('execution_phase', 'hold')
      .eq('reference_type', CENTRAL_HOLD_REFERENCE_TYPE)
      .gte('created_at', input.sinceIso);
    if (input.organizationId) q = q.eq('organization_id', input.organizationId);
    const res = await q;
    // A null error is not an answer: only a numeric count is.
    if (res.error || typeof res.count !== 'number') return null;
    return res.count;
  } catch {
    return null;
  }
}

function positiveInt(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * The `allow` backstop for makeFundedCostPort: null = allowed, otherwise the
 * refusal reason (a code, shown to the tenant as "central access unavailable").
 */
export function makePlatformDailyCeiling(deps: CeilingDeps = {}) {
  // Global scope only: organizationId null, so an organisation row can never
  // override the platform ceiling or its own share.
  const readPolicy = deps.readPolicy ?? ((key: BillingPolicyKey) => resolveBillingPolicyValue(key, null));
  const countHolds = deps.countHolds ?? defaultCountHolds;
  const now = deps.now ?? (() => new Date());

  return async function allow(input: { organizationId: string; providerId: string }): Promise<string | null> {
    const ceilings = await readPolicy(CENTRAL_CEILING_POLICY_KEY);
    const ceiling = ceilings && typeof ceilings === 'object'
      ? positiveInt((ceilings as Record<string, unknown>)[input.providerId]) : null;
    if (ceiling == null) return 'central_ceiling_not_configured';

    const sinceIso = startOfUtcDay(now());
    const used = await countHolds({ sinceIso });
    if (used == null) return 'central_ceiling_unreadable';
    if (used >= ceiling) return 'central_daily_ceiling_reached';

    const share = await readPolicy(CENTRAL_TENANT_SHARE_POLICY_KEY);
    const s = share && typeof share === 'object' ? share as Record<string, unknown> : null;
    if (s && s.enabled === true) {
      const fraction = typeof s.max_fraction === 'number' && s.max_fraction > 0 && s.max_fraction <= 1 ? s.max_fraction : null;
      if (fraction == null) return 'central_tenant_share_misconfigured';
      const tenantUsed = await countHolds({ sinceIso, organizationId: input.organizationId });
      if (tenantUsed == null) return 'central_ceiling_unreadable';
      if (tenantUsed >= Math.max(1, Math.floor(ceiling * fraction))) return 'central_tenant_share_reached';
    }
    return null;
  };
}
