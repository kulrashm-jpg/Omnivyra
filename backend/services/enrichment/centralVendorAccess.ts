/**
 * MODE B: central (platform) vendor access as a PAID TENANT OPT-IN.
 *
 * Owner decision (2026-11-10): a tenant chooses per vendor between its own key
 * (free; the vendor bills the tenant) and Omnivyra's central access (paid in
 * Omnivyra credits at vendor cost x 1.5). The opt-in is a tenant-admin setting
 * on the existing feature-flag policy store, the same pattern as the Apollo
 * field groups. Credits come from the plan allowance plus top-ups.
 *
 * Quotes ("N Omnivyra credits = 1 vendor unit") come from the SAME pricing
 * function that charges (`resolveVendorUnitCost`), so a quote can never
 * disagree with the charge.
 */
import { upsertFeatureFlag } from '../featureFlagService';
import { PricingMissingError, resolveVendorUnitCost } from '../pricingService';
import { CENTRAL_VENDOR_ACCESS_FLAG_KEY, hasOptedIntoCentralAccess, PLATFORM_CREDENTIAL_KEYS, VENDOR_UNITS } from './providers/funding';
import { PROSPECT_ENRICHMENT_ACTION } from './providers/cost';

/** The platform's default credit rate (organization_credits.credit_rate_usd default). Public quotes only. */
export const STANDARD_CREDIT_RATE_USD = 0.01;

export interface VendorAccessQuote {
  readonly vendor: string;
  readonly unit: string;
  /** Null when Super Admin has not set the vendor's cost: central access is unavailable. */
  readonly creditsPerUnit: number | null;
  readonly available: boolean;
}

/** Vendors that offer central access, in a stable order. */
export const CENTRAL_VENDORS: readonly string[] = Object.freeze(Object.keys(PLATFORM_CREDENTIAL_KEYS).sort());

/**
 * Quote every central vendor. With an org: at THAT org's credit rate (exact).
 * Without: at the standard rate (the public pricing page).
 */
export async function quoteCentralVendorAccess(organizationId?: string | null): Promise<VendorAccessQuote[]> {
  const out: VendorAccessQuote[] = [];
  for (const vendor of CENTRAL_VENDORS) {
    const unit = VENDOR_UNITS[vendor]?.unit ?? 'unit';
    try {
      const priced = await resolveVendorUnitCost({
        provider: vendor, unit, units: 1, actionKey: PROSPECT_ENRICHMENT_ACTION,
        orgId: organizationId ?? 'quote',
        ...(organizationId ? {} : { quoteAtCreditRateUsd: STANDARD_CREDIT_RATE_USD }),
      });
      out.push({ vendor, unit, creditsPerUnit: priced.credits, available: true });
    } catch (e) {
      if (e instanceof PricingMissingError || (e instanceof Error && /Missing action_pricing_config row/.test(e.message))) {
        out.push({ vendor, unit, creditsPerUnit: null, available: false });
        continue;
      }
      throw e;
    }
  }
  return out;
}

export class CentralAccessSelectionRefused extends Error {
  constructor(readonly code: 'unknown_vendor' | 'invalid_selection', readonly vendor?: string) {
    super(`central access selection refused: ${code}${vendor ? ` (${vendor})` : ''}`);
    this.name = 'CentralAccessSelectionRefused';
  }
}

/** The vendors this tenant has opted into. */
export async function readCentralVendorOptIns(organizationId: string): Promise<string[]> {
  const opted: string[] = [];
  for (const v of CENTRAL_VENDORS) if (await hasOptedIntoCentralAccess(organizationId, v)) opted.push(v);
  return opted;
}

/** Set the tenant's opt-ins. Unknown vendors are REFUSED, never dropped. An empty list opts out of all. */
export async function writeCentralVendorOptIns(organizationId: string, vendors: unknown, userId: string): Promise<string[]> {
  if (!Array.isArray(vendors)) throw new CentralAccessSelectionRefused('invalid_selection');
  const clean: string[] = [];
  for (const v of vendors) {
    if (typeof v !== 'string' || !CENTRAL_VENDORS.includes(v)) {
      throw new CentralAccessSelectionRefused('unknown_vendor', String(v).slice(0, 40));
    }
    if (!clean.includes(v)) clean.push(v);
  }
  await upsertFeatureFlag({
    organizationId,
    flagKey: CENTRAL_VENDOR_ACCESS_FLAG_KEY,
    enabled: clean.length > 0,
    rationale: 'Tenant opt-in to paid central data-vendor access (mode B).',
    metadata: { vendors: clean },
    createdBy: userId,
  });
  return clean;
}
