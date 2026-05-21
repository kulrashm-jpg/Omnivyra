/**
 * Canonical billing-geography capture service.
 *
 * THE single write path for lightweight billing geography. Both HTTP
 * surfaces — PUT /api/billing/profile and PUT /api/billing/context —
 * delegate here, so there is exactly ONE persistence authority and ONE
 * target table: company_billing_profiles.
 *
 * This consolidation removes the prior divergent write to the separate
 * billing_context table. The resolver (resolveOrgBillingContext) still READS
 * billing_context as precedence-tier #1 for backward read compatibility, but
 * NOTHING in the codebase writes that table any more — there is no divergent
 * country/currency persistence and no conflicting update path.
 *
 * Persistence is PARTIAL + ADDITIVE + IDEMPOTENT:
 *  - only billing geography (+ billing_email on first insert) is written;
 *  - billing_address jsonb is merged (existing keys preserved);
 *  - re-sending the same input converges the row.
 *
 * PRICING-BLIND. No checkout. No tax engine. No ledger/wallet/HOLD contact.
 */

import { supabase } from '../../../db/supabaseClient';
import { resolveOrgBillingContext, type OrgBillingContext } from './orgBillingContextResolver';

const ISO_COUNTRY = /^[A-Za-z]{2}$/;
const ISO_CURRENCY = /^[A-Za-z]{3}$/;

export interface NormalizedBillingGeography {
  /** ISO-3166-1 alpha-2, uppercased, or null when not supplied. */
  country: string | null;
  /** ISO-4217, uppercased, or null when not supplied. */
  currency: string | null;
  /** Trimmed region, or null when not supplied. */
  region: string | null;
}

export type NormalizeResult =
  | { ok: true; value: NormalizedBillingGeography }
  | { ok: false; error: string; detail: string };

/**
 * Validate + normalize a raw capture body. Accepts BOTH field-name
 * conventions so the two endpoints stay backward compatible:
 *   - billing_country
 *   - preferred_currency  OR  billing_currency
 *   - billing_region
 */
export function normalizeBillingGeographyInput(body: unknown): NormalizeResult {
  const b = (body && typeof body === 'object') ? body as Record<string, unknown> : {};
  const rawCountry = typeof b.billing_country === 'string' ? b.billing_country.trim() : null;
  const rawCurrency =
    typeof b.preferred_currency === 'string' ? b.preferred_currency.trim()
    : typeof b.billing_currency === 'string' ? b.billing_currency.trim()
    : null;
  const rawRegion = typeof b.billing_region === 'string' ? b.billing_region.trim() : null;

  if (rawCountry !== null && !ISO_COUNTRY.test(rawCountry)) {
    return { ok: false, error: 'invalid_billing_country', detail: 'expected ISO-3166-1 alpha-2' };
  }
  if (rawCurrency !== null && !ISO_CURRENCY.test(rawCurrency)) {
    return { ok: false, error: 'invalid_billing_currency', detail: 'expected ISO-4217' };
  }
  if (rawRegion !== null && rawRegion.length > 120) {
    return { ok: false, error: 'invalid_billing_region', detail: 'max 120 chars' };
  }
  if (rawCountry === null && rawCurrency === null && rawRegion === null) {
    return { ok: false, error: 'no_billing_fields', detail: 'at least one of billing_country / currency / region required' };
  }

  return {
    ok: true,
    value: {
      country: rawCountry ? rawCountry.toUpperCase() : null,
      currency: rawCurrency ? rawCurrency.toUpperCase() : null,
      region: rawRegion,
    },
  };
}

export interface CaptureArgs {
  organizationId: string;
  /** Used as billing_email ONLY when creating the first partial row. */
  sessionEmail: string | null;
  geography: NormalizedBillingGeography;
}

export type CaptureResult =
  | { ok: true; context: OrgBillingContext }
  | { ok: false; code: 'billing_email_unavailable' | 'company_billing_profiles_unavailable' | 'profile_read_failed' | 'profile_capture_failed'; message?: string };

/**
 * Canonical persistence: partial, additive, idempotent upsert into
 * company_billing_profiles. Returns the freshly-resolved billing context so
 * callers report authoritative geography.
 */
export async function captureBillingProfileGeography(args: CaptureArgs): Promise<CaptureResult> {
  const { organizationId, sessionEmail, geography } = args;

  // Read existing row to MERGE additively (preserve all non-geography data).
  let existing: { billing_address?: unknown; billing_email?: unknown } | null = null;
  {
    const { data, error } = await supabase
      .from('company_billing_profiles')
      .select('billing_address, billing_email')
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (error && !String(error.message ?? '').toLowerCase().includes('does not exist')) {
      return { ok: false, code: 'profile_read_failed', message: error.message };
    }
    existing = (data as typeof existing) ?? null;
  }

  // billing_email is NOT NULL. Preserve the existing value; on first capture
  // use the authenticated principal's email. Neither present → cannot create.
  const billingEmail = (typeof existing?.billing_email === 'string' && existing.billing_email)
    ? existing.billing_email
    : (sessionEmail && sessionEmail.length > 0 ? sessionEmail : null);
  if (!billingEmail) {
    return { ok: false, code: 'billing_email_unavailable' };
  }

  // Merge geography into the existing billing_address jsonb.
  const existingAddress = (existing?.billing_address && typeof existing.billing_address === 'object')
    ? existing.billing_address as Record<string, unknown>
    : {};
  const mergedAddress: Record<string, unknown> = { ...existingAddress };
  if (geography.country !== null) mergedAddress.country = geography.country;
  if (geography.region !== null) mergedAddress.region = geography.region;

  const payload: Record<string, unknown> = {
    organization_id: organizationId,
    billing_email: billingEmail,
    billing_address: mergedAddress,
    updated_at: new Date().toISOString(),
  };
  if (geography.currency !== null) payload.currency_preference = geography.currency;

  const { error: upsertErr } = await supabase
    .from('company_billing_profiles')
    .upsert(payload, { onConflict: 'organization_id' });

  if (upsertErr) {
    if (String(upsertErr.message ?? '').toLowerCase().includes('does not exist')) {
      return { ok: false, code: 'company_billing_profiles_unavailable', message: 'apply migration 20260664' };
    }
    return { ok: false, code: 'profile_capture_failed', message: upsertErr.message };
  }

  const context = await resolveOrgBillingContext(organizationId);
  return { ok: true, context };
}
