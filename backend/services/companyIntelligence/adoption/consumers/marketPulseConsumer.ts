/**
 * COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · U3 · Consumer 3 — Market Pulse adoption seam.
 *
 * Market Pulse obtains its projection-owned interpretive identity — `business_model`, `operating_model`,
 * `domain_role` — through `resolveCompanyProjection().worldView` before the report/prompt/scoring context
 * is built. It NEVER repairs, reinterprets, reclassifies, or overrides canonical understanding; it READS
 * the projected worldView and overlays it onto the market_pulse settings it consumes. Pure & deterministic.
 * Flag OFF (default) ⇒ returns the SAME settings reference, byte-identical (O(1) rollback).
 *
 * Scope: `provider_type` and `solution_domains` are NOT modeled by the current CompanyUnderstanding
 * worldView, so they are NOT routed through the projection here (documented deferral — a model-coverage
 * gap, not this consumer's to fix). Competitors keep their existing discovery/read pipeline (untouched).
 */

import { resolveCompanyProjection } from '../consumerAdapter';
import type { CompanyProfileInput } from '../../fromProfile';
import type { EvidenceSources } from '../../evidence';

/** The market_pulse identity sub-fields this consumer may overlay from the projection. */
export interface MarketPulseIdentityLike {
  business_model?: string | null;
  operating_model?: string | null;
  domain_role?: string | null;
  provider_type?: string | null;         // NOT projection-owned — never overlaid here
  solution_domains?: string[] | null;    // NOT projection-owned — never overlaid here
}
export interface MarketPulseProfileLike { name?: string | null; website_url?: string | null; category?: string | null }

/** Map market_pulse settings (+ profile facts) → projection input. The stored interpretive values seed the
 * profile-derived path so that, absent evidence, the projection echoes them (byte-identical). */
export function marketPulseSettingsToInput(settings: MarketPulseIdentityLike, profile: MarketPulseProfileLike | null | undefined, companyId: string, asOf: string): CompanyProfileInput {
  return {
    companyId,
    asOf,
    name: profile?.name ?? undefined,
    domain: profile?.website_url ?? undefined,
    category: profile?.category ?? undefined,
    businessModel: settings.business_model ?? undefined,
    primaryMotion: settings.operating_model ?? undefined,   // canonical worldView.primaryMotion
    marketPosition: settings.domain_role ?? undefined,      // canonical worldView.marketPosition
  };
}

/**
 * Overlay the projected worldView identity onto the market_pulse settings. Flag OFF (or fail-safe) ⇒ same
 * settings reference (no-op). Flag ON ⇒ projected business_model / operating_model / domain_role (a null
 * projection value never wipes a stored value — abstention-safe). Pure & deterministic.
 */
export function adoptMarketPulseIdentity<T>(settings: T, profile: MarketPulseProfileLike | null | undefined, companyId: string, asOf: string, evidence?: EvidenceSources): T {
  if (settings == null) return settings;
  const s = settings as unknown as MarketPulseIdentityLike;
  const input = marketPulseSettingsToInput(s, profile, companyId, asOf);
  const { source, worldView } = resolveCompanyProjection(input, evidence ? { evidence } : {});
  if (source === 'legacy' || !worldView) return settings; // flag OFF / fail-safe ⇒ untouched, same reference
  return {
    ...(settings as Record<string, unknown>),
    business_model: worldView.businessModel ?? s.business_model,
    operating_model: worldView.operatingModel ?? s.operating_model,
    domain_role: worldView.domainRole ?? s.domain_role,
    // provider_type + solution_domains left as stored (not projection-owned) — competitors untouched.
  } as unknown as T;
}
