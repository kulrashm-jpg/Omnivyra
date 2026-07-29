/**
 * PRODUCTION-IDENTITY-IMPLEMENTATION-001 · Phase A.5 — Canonical Independence Certification.
 *
 * Proves the canonical producer is MATHEMATICALLY INDEPENDENT of legacy-derived identity. The production
 * root cause (Embro) was a self-reinforcing loop in which the DERIVED stored `profile.industry` /
 * `profile.category` (and `entity_archetype` / `industry_review`) fed classification. This suite certifies
 * that none of those derived fields can influence `canonical_understanding`: the producer consumes ONLY
 * observable evidence (name/domain/products facts + grounded AI extraction). Determinism is proven by
 * generating canonical identity with legacy identity PRESENT vs REMOVED and asserting byte-identical output.
 *
 * This phase changes only the (flag-dark) producer's evidence assembly — production behaviour is unchanged.
 */
import {
  produceCanonicalIdentity,
  collectWriteEvidence,
  writeInputsFromProfileAndExtraction,
  type WriteEvidenceInputs,
} from '../../services/companyIntelligence/production/canonicalIdentityProducer';

const ASOF = '2026-07-29T00:00:00.000Z';

// ── Affected tenant #1 — Embro (manufacturing; legacy mislabelled it "Customer Engagement Software") ──
const EMBRO = (legacyIndustry?: string): WriteEvidenceInputs => ({
  companyId: 'embro', asOf: ASOF,
  name: 'Embro Sales & Service', domain: 'embrosales.in',
  products: ['Advanced embroidery machines', 'Industrial sewing machines', 'Genuine spare parts'],
  competitors: [],
  industry: legacyIndustry, // DERIVED legacy field — MUST NOT influence output
  ai: {
    category: 'Industrial embroidery & sewing machinery and service', // grounded (website)
    industry: 'Manufacturing',
    products: ['embroidery machines', 'sewing machines'],
    segments: 'garment manufacturers; embroidery businesses',
    differentiators: 'authorized machinery + installation & technical service',
  },
});

// ── Affected tenant #2 — a second manufacturing tenant with a polluted derived industry ──
const TENANT2 = (legacyIndustry?: string): WriteEvidenceInputs => ({
  companyId: 'acme-textiles', asOf: ASOF,
  name: 'Acme Textiles Machinery', domain: 'acmetex.example',
  products: ['CNC cutting machines', 'Fabric spreading systems'],
  competitors: [],
  industry: legacyIndustry,
  ai: { category: 'Textile manufacturing equipment', industry: 'Manufacturing', products: ['cutting machines'], segments: 'textile factories' },
});

const LEGACY_POLLUTION = 'Customer Engagement, Decision Support';

describe('Phase A.5 · producer is invariant to the legacy derived profile.industry', () => {
  for (const [label, mk] of [['Embro', EMBRO], ['Tenant2', TENANT2]] as const) {
    it(`${label}: canonical identity is byte-identical with legacy industry PRESENT vs REMOVED`, () => {
      const withLegacy = produceCanonicalIdentity(mk(LEGACY_POLLUTION));
      const withoutLegacy = produceCanonicalIdentity(mk(undefined));
      // Determinism certification: the derived legacy identity has ZERO influence on the canonical output.
      expect(withLegacy).toEqual(withoutLegacy);
    });

    it(`${label}: canonical category/industry never inherit the legacy classification tokens`, () => {
      const { legacy, understanding } = produceCanonicalIdentity(mk(LEGACY_POLLUTION));
      const blob = JSON.stringify({ legacy, wv: understanding.facets.worldView.value ?? null });
      expect(blob).not.toMatch(/customer engagement|decision support|retention and lifecycle/i);
    });
  }
});

describe('Phase A.5 · EvidenceSources carries no derived identity', () => {
  it('collectWriteEvidence profile source emits NO industry (derived) — only observable facts', () => {
    const sources = collectWriteEvidence(EMBRO(LEGACY_POLLUTION));
    const hasIndustry = !!sources.profile && 'industry' in sources.profile && sources.profile.industry != null;
    expect(hasIndustry).toBe(false);
    // Observable facts remain present.
    expect(sources.profile?.name).toBe('Embro Sales & Service');
    expect(sources.profile?.domain).toBe('embrosales.in');
  });

  it('write-path mapper never sources profile.industry/category/entity_archetype/industry_review', () => {
    // ProfileFactsLike has no category/entity_archetype/industry_review fields at all (structural exclusion);
    // the derived `industry` field, even when present on the profile, is NOT mapped into the producer inputs.
    const inputs = writeInputsFromProfileAndExtraction(
      { company_id: 'embro', name: 'Embro Sales & Service', website_url: 'embrosales.in', products_services_list: ['Advanced embroidery machines'], industry: LEGACY_POLLUTION, competitors_list: [] },
      { category: { value: 'Industrial embroidery & sewing machinery', source: 'website', confidence: 'High' }, industry: { value: 'Manufacturing', source: 'website' } } as never,
      ASOF,
    );
    expect(inputs.industry ?? null).toBeNull(); // derived profile.industry is NOT carried
    expect(inputs.ai?.category).toBe('Industrial embroidery & sewing machinery'); // grounded evidence preserved
  });

  it('canonical identity is invariant to the full stored legacy identity via the mapper', () => {
    const build = (industry?: string) =>
      produceCanonicalIdentity(
        writeInputsFromProfileAndExtraction(
          { company_id: 'embro', name: 'Embro Sales & Service', website_url: 'embrosales.in', products_services_list: ['Advanced embroidery machines'], industry, competitors_list: [] },
          { category: { value: 'Industrial embroidery & sewing machinery', source: 'website' }, industry: { value: 'Manufacturing', source: 'website' } } as never,
          ASOF,
        ),
      );
    expect(build(LEGACY_POLLUTION)).toEqual(build(undefined));
  });
});
