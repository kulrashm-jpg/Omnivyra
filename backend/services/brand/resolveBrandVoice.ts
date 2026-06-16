/**
 * Unified Brand Runtime — Phase 2A (content voice adoption).
 *
 * Authoritative brand-voice resolver for the core content-generation path.
 * Prefers BrandRuntime.voice.tone ONLY when a brand_identity row exists
 * (meta.source === 'brand_identity'); otherwise returns the legacy
 * company_profiles.brand_voice value UNCHANGED — so every tenant without a
 * brand row is byte-identical to today (all tenants, until they add brand data).
 *
 * Never throws: resolveBrand is itself fail-safe, and a final catch guarantees
 * the legacy value is returned on any error → brand lookup can never fail
 * content generation.
 *
 * VOICE ONLY — colors/typography/logo/compliance are NOT adopted here. Messaging
 * (ICP, pain points, products, differentiators, archetype, etc.) stays in
 * CompanyIdentity; this composes with it, it does not absorb it.
 */
import { resolveBrand, type BrandRuntime } from './brandRuntime';

export interface ResolveBrandVoiceDeps {
  resolve?: (companyId: string) => Promise<BrandRuntime>;
}

export async function resolveBrandVoice(
  companyId: string | null | undefined,
  legacyVoice: string | undefined,
  deps: ResolveBrandVoiceDeps = {},
): Promise<string | undefined> {
  if (!companyId) return legacyVoice;
  const resolve = deps.resolve ?? ((id: string) => resolveBrand(id));
  try {
    const rt = await resolve(companyId);
    // Only override when the voice is backed by an actual brand_identity row.
    if (rt.meta.source === 'brand_identity') return rt.voice.tone ?? legacyVoice;
    return legacyVoice;
  } catch {
    return legacyVoice;
  }
}
